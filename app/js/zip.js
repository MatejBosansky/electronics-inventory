/* Electronics Inventory — minimal ZIP writer (stored entries) and reader (stored + deflate).
 * Backups are written uncompressed: images are already compressed and this keeps the code small.
 * The reader also accepts deflate-compressed archives (e.g. a folder zipped by the OS). */
(function (App) {
  'use strict';

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date) {
    const year = Math.max(1980, date.getFullYear());
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    };
  }

  async function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof data === 'string') return new TextEncoder().encode(data);
    if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    throw new TypeError('Unsupported ZIP entry data.');
  }

  /**
   * Creates a ZIP archive.
   * @param {{name: string, data: Blob|Uint8Array|ArrayBuffer|string}[]} entries
   * @param {(done: number, total: number) => void} [onProgress]
   * @returns {Promise<Blob>}
   */
  async function create(entries, onProgress) {
    const encoder = new TextEncoder();
    const stamp = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;
    let done = 0;

    for (const entry of entries) {
      const name = encoder.encode(entry.name);
      const data = await toBytes(entry.data);
      const crc = crc32(data);

      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true); // version needed
      local.setUint16(6, 0x0800, true); // UTF-8 file names
      local.setUint16(8, 0, true); // stored
      local.setUint16(10, stamp.time, true);
      local.setUint16(12, stamp.date, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, data.length, true);
      local.setUint32(22, data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      chunks.push(local, name, data);

      const header = new DataView(new ArrayBuffer(46));
      header.setUint32(0, 0x02014b50, true);
      header.setUint16(4, 20, true); // version made by
      header.setUint16(6, 20, true); // version needed
      header.setUint16(8, 0x0800, true);
      header.setUint16(10, 0, true);
      header.setUint16(12, stamp.time, true);
      header.setUint16(14, stamp.date, true);
      header.setUint32(16, crc, true);
      header.setUint32(20, data.length, true);
      header.setUint32(24, data.length, true);
      header.setUint16(28, name.length, true);
      header.setUint32(42, offset, true);
      central.push(header, name);

      offset += 30 + name.length + data.length;
      done += 1;
      if (onProgress) onProgress(done, entries.length);
    }

    const centralSize = central.reduce((sum, part) => sum + part.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, end], { type: 'application/zip' });
  }

  async function extract(zip, entry) {
    const head = new DataView(await zip.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error(`Damaged ZIP entry: ${entry.name}`);
    const start = entry.localOffset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const data = zip.slice(start, start + entry.compressedSize);
    if (entry.method === 0) return data;
    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('This browser cannot read compressed ZIP files. Use a newer browser.');
      }
      const stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).blob();
    }
    throw new Error(`Unsupported ZIP compression method ${entry.method} (${entry.name}).`);
  }

  /**
   * Lists the files of a ZIP archive.
   * @param {Blob} zip
   * @returns {Promise<{name: string, size: number, blob: () => Promise<Blob>, text: () => Promise<string>}[]>}
   */
  async function read(zip) {
    const tailLength = Math.min(zip.size, 65557);
    const tail = new DataView(await zip.slice(zip.size - tailLength).arrayBuffer());
    let eocd = -1;
    for (let i = tail.byteLength - 22; i >= 0; i--) {
      if (tail.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('This file is not a ZIP archive.');
    const count = tail.getUint16(eocd + 10, true);
    const centralSize = tail.getUint32(eocd + 12, true);
    const centralOffset = tail.getUint32(eocd + 16, true);
    if (count === 0xffff || centralOffset === 0xffffffff) throw new Error('ZIP64 archives are not supported.');

    const central = new DataView(await zip.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
    const decoder = new TextDecoder();
    const entries = [];
    let p = 0;
    for (let n = 0; n < count; n++) {
      if (central.getUint32(p, true) !== 0x02014b50) throw new Error('The ZIP directory is damaged.');
      const method = central.getUint16(p + 10, true);
      const compressedSize = central.getUint32(p + 20, true);
      const size = central.getUint32(p + 24, true);
      const nameLength = central.getUint16(p + 28, true);
      const extraLength = central.getUint16(p + 30, true);
      const commentLength = central.getUint16(p + 32, true);
      const localOffset = central.getUint32(p + 42, true);
      const name = decoder.decode(new Uint8Array(central.buffer, central.byteOffset + p + 46, nameLength));
      p += 46 + nameLength + extraLength + commentLength;
      if (!name.endsWith('/')) entries.push({ name, size, method, compressedSize, localOffset });
    }

    return entries.map((entry) => ({
      name: entry.name,
      size: entry.size,
      blob: () => extract(zip, entry),
      text: async () => (await extract(zip, entry)).text(),
    }));
  }

  App.zip = { create, read, crc32 };
})(window.App = window.App || {});
