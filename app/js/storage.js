/* Electronics Inventory — storage back ends.
 * Every back end exposes the same small "file system" so the data layout is identical everywhere:
 *   inventory.json, images/<file>, images/thumbs/<file>, backups/<snapshot>.json
 *
 *   ServerFS  – the Docker image (nginx with WebDAV PUT/DELETE on /data/) or server/inventory_server.py
 *   FolderFS  – a folder on this computer via the File System Access API (Chrome, Edge…)
 *   BrowserFS – IndexedDB inside this browser (works everywhere, incl. index.html opened from disk)
 */
(function (App) {
  'use strict';

  const DB_NAME = 'electronics-inventory';
  const PREF_KEY = 'electronics-inventory.storage';
  const FOLDER_HANDLE_KEY = 'data-folder';

  // ---------------------------------------------------------------------------
  // IndexedDB helpers

  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) {
          reject(new Error('This browser has no IndexedDB storage.'));
          return;
        }
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
          if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Could not open browser storage.'));
        request.onblocked = () => reject(new Error('Browser storage is blocked by another open tab of this app.'));
      });
      dbPromise.catch(() => {
        dbPromise = null;
      });
    }
    return dbPromise;
  }

  async function idb(storeName, mode, makeRequest) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = makeRequest(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request ? request.result : undefined);
      tx.onerror = () => reject(tx.error || (request && request.error) || new Error('Browser storage error.'));
      tx.onabort = () => reject(tx.error || new Error('Browser storage transaction was aborted (storage full?).'));
    });
  }

  const kv = {
    get: (key) => idb('kv', 'readonly', (store) => store.get(key)),
    set: (key, value) => idb('kv', 'readwrite', (store) => store.put(value, key)),
    delete: (key) => idb('kv', 'readwrite', (store) => store.delete(key)),
  };

  function splitPath(path) {
    const parts = String(path).split('/').filter(Boolean);
    if (!parts.length || parts.some((part) => part === '.' || part === '..')) {
      throw new Error(`Invalid storage path: ${path}`);
    }
    return parts;
  }

  // ---------------------------------------------------------------------------
  // Server (nginx WebDAV)

  async function httpError(response, action) {
    let hint = '';
    if (response.status === 401) hint = ' (sign-in required)';
    else if (response.status === 403 || response.status === 405) hint = ' (the server does not allow this)';
    else if (response.status === 413) hint = ' (file is too large for the server)';
    return new Error(`${action} failed: HTTP ${response.status}${hint}`);
  }

  function versionFrom(headers) {
    return headers.get('ETag') || `${headers.get('Last-Modified') || ''}|${headers.get('Content-Length') || ''}`;
  }

  class ServerFS {
    constructor(base = 'data/') {
      this.kind = 'server';
      this.base = base;
      this.label = 'Server';
      this.detail = `${location.host}/${base}`;
      this.cas = undefined;
      this.casCheckedAt = 0;
    }

    url(path) {
      return this.base + splitPath(path).map(encodeURIComponent).join('/');
    }

    async stat(path) {
      const response = await fetch(this.url(path), { method: 'HEAD', cache: 'no-store' });
      if (response.status === 404) return null;
      if (!response.ok) throw await httpError(response, `Reading ${path}`);
      return {
        version: versionFrom(response.headers),
        size: Number(response.headers.get('Content-Length')) || 0,
        mtime: Date.parse(response.headers.get('Last-Modified')) || 0,
      };
    }

    async readText(path) {
      const response = await fetch(this.url(path), { cache: 'no-store' });
      if (response.status === 404) return null;
      if (!response.ok) throw await httpError(response, `Reading ${path}`);
      return { text: await response.text(), version: versionFrom(response.headers) };
    }

    async readBlob(path) {
      const response = await fetch(this.url(path), { cache: 'no-store' });
      if (response.status === 404) return null;
      if (!response.ok) throw await httpError(response, `Reading ${path}`);
      return response.blob();
    }

    async write(path, body, type) {
      const response = await fetch(this.url(path), {
        method: 'PUT',
        body,
        headers: { 'Content-Type': type || 'application/octet-stream' },
      });
      if (!response.ok) throw await httpError(response, `Saving ${path}`);
      return this.stat(path);
    }

    /** True when the inventory server's API offers compare-and-swap writes of inventory.json. */
    async casAvailable() {
      if (this.cas === undefined || (this.cas === false && Date.now() - this.casCheckedAt > 60_000)) {
        this.casCheckedAt = Date.now();
        try {
          const response = await fetch('api/health', { cache: 'no-store' });
          const health = response.ok ? await response.json() : null;
          this.cas = Boolean(health && health.inventory_cas);
        } catch (err) {
          this.cas = false;
        }
      }
      return this.cas;
    }

    /**
     * With `ifMatch` (the ETag the change is based on) inventory.json is written through the API,
     * which replaces the file only if it is still that version; otherwise this throws an error with
     * code "conflict". Without the API it falls back to a plain WebDAV PUT.
     */
    async writeText(path, text, { ifMatch = null } = {}) {
      if (path === 'inventory.json' && ifMatch && /^(W\/)?"/.test(ifMatch) && await this.casAvailable()) {
        const response = await fetch('api/inventory.json', {
          method: 'PUT',
          body: text,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'If-Match': ifMatch },
        });
        if (response.status === 412) {
          throw Object.assign(new Error('inventory.json was changed elsewhere.'), { code: 'conflict' });
        }
        if (response.ok) {
          // The ETag of exactly the version we wrote (a later HEAD could already see someone else's write).
          const tag = response.headers.get('ETag');
          return tag ? { version: tag, size: text.length, mtime: Date.now() } : this.stat(path);
        }
        if (![404, 405, 501, 502, 503, 504].includes(response.status)) {
          throw await httpError(response, 'Saving inventory.json');
        }
        this.cas = false; // API not reachable right now: plain PUT below
      }
      return this.write(path, text, 'application/json; charset=utf-8');
    }

    writeBlob(path, blob) {
      return this.write(path, blob, blob.type || App.util.mimeFor(path));
    }

    async remove(path) {
      const response = await fetch(this.url(path), { method: 'DELETE' });
      if (response.status === 404) return false;
      if (!response.ok) throw await httpError(response, `Deleting ${path}`);
      return true;
    }

    async list(dir) {
      const response = await fetch(`${this.url(dir)}/`, { cache: 'no-store', headers: { Accept: 'application/json' } });
      if (response.status === 404) return [];
      if (!response.ok) throw await httpError(response, `Listing ${dir}`);
      const items = await response.json();
      return items
        .filter((item) => item.type === 'file' && !item.name.startsWith('.'))
        .map((item) => ({ name: item.name, size: Number(item.size) || 0, mtime: Date.parse(item.mtime) || 0 }));
    }
  }

  // ---------------------------------------------------------------------------
  // Folder on this computer (File System Access API)

  const isNotFound = (err) => err && (err.name === 'NotFoundError' || err.name === 'TypeMismatchError');

  class FolderFS {
    constructor(handle) {
      this.kind = 'folder';
      this.handle = handle;
      this.label = handle.name;
      this.detail = `Folder “${handle.name}” on this computer`;
    }

    async dir(parts, create) {
      let dir = this.handle;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
      return dir;
    }

    async file(path, create) {
      const parts = splitPath(path);
      const name = parts.pop();
      const dir = await this.dir(parts, create);
      return dir.getFileHandle(name, { create });
    }

    async getFile(path) {
      try {
        return await (await this.file(path, false)).getFile();
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    }

    async stat(path) {
      const file = await this.getFile(path);
      return file ? { version: `${file.lastModified}:${file.size}`, size: file.size, mtime: file.lastModified } : null;
    }

    async readText(path) {
      const file = await this.getFile(path);
      return file ? { text: await file.text(), version: `${file.lastModified}:${file.size}` } : null;
    }

    readBlob(path) {
      return this.getFile(path);
    }

    async write(path, data) {
      const handle = await this.file(path, true);
      const writable = await handle.createWritable();
      try {
        await writable.write(data);
        await writable.close();
      } catch (err) {
        await writable.abort().catch(() => {});
        throw err;
      }
      return this.stat(path);
    }

    writeText(path, text) {
      return this.write(path, text);
    }

    writeBlob(path, blob) {
      return this.write(path, blob);
    }

    async remove(path) {
      const parts = splitPath(path);
      const name = parts.pop();
      try {
        const dir = await this.dir(parts, false);
        await dir.removeEntry(name);
        return true;
      } catch (err) {
        if (isNotFound(err)) return false;
        throw err;
      }
    }

    async list(dir) {
      let handle;
      try {
        handle = await this.dir(splitPath(dir), false);
      } catch (err) {
        if (isNotFound(err)) return [];
        throw err;
      }
      const out = [];
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind !== 'file' || name.startsWith('.')) continue;
        const file = await entry.getFile();
        out.push({ name, size: file.size, mtime: file.lastModified });
      }
      return out;
    }
  }

  // ---------------------------------------------------------------------------
  // This browser (IndexedDB)

  let lastMtime = 0;
  function nextMtime() {
    const now = Date.now();
    lastMtime = now > lastMtime ? now : lastMtime + 1;
    return lastMtime;
  }

  class BrowserFS {
    constructor() {
      this.kind = 'browser';
      this.label = 'This browser';
      this.detail = 'Browser storage (IndexedDB) on this device';
    }

    async record(path) {
      return idb('files', 'readonly', (store) => store.get(splitPath(path).join('/')));
    }

    async stat(path) {
      const rec = await this.record(path);
      return rec ? { version: `${rec.mtime}:${rec.size}`, size: rec.size, mtime: rec.mtime } : null;
    }

    async readText(path) {
      const rec = await this.record(path);
      if (!rec) return null;
      const text = typeof rec.data === 'string' ? rec.data : await rec.data.text();
      return { text, version: `${rec.mtime}:${rec.size}` };
    }

    async readBlob(path) {
      const rec = await this.record(path);
      if (!rec) return null;
      return rec.data instanceof Blob ? rec.data : new Blob([rec.data], { type: App.util.mimeFor(path) });
    }

    async put(path, data, size) {
      const rec = { path: splitPath(path).join('/'), data, size, mtime: nextMtime() };
      await idb('files', 'readwrite', (store) => store.put(rec));
      return { version: `${rec.mtime}:${rec.size}`, size: rec.size, mtime: rec.mtime };
    }

    writeText(path, text) {
      return this.put(path, text, text.length);
    }

    writeBlob(path, blob) {
      return this.put(path, blob, blob.size);
    }

    async remove(path) {
      const key = splitPath(path).join('/');
      const existed = await this.record(key);
      if (!existed) return false;
      await idb('files', 'readwrite', (store) => store.delete(key));
      return true;
    }

    async list(dir) {
      const prefix = `${splitPath(dir).join('/')}/`;
      const records = await idb('files', 'readonly', (store) => store.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`)));
      return records
        .filter((rec) => !rec.path.slice(prefix.length).includes('/'))
        .map((rec) => ({ name: rec.path.slice(prefix.length), size: rec.size, mtime: rec.mtime }));
    }
  }

  // ---------------------------------------------------------------------------
  // Choosing a back end

  const folderSupported = typeof window.showDirectoryPicker === 'function';

  /** Returns a ServerFS when the page is served by the inventory server (Docker / dev server). */
  async function detectServer() {
    if (!/^https?:$/.test(location.protocol)) return null;
    try {
      const response = await fetch('data/inventory.json', { method: 'HEAD', cache: 'no-store' });
      if (response.headers.get('X-Inventory-Storage') === 'webdav') return new ServerFS('data/');
    } catch (err) {
      // Not served by the inventory server.
    }
    return null;
  }

  function preference() {
    try {
      return localStorage.getItem(PREF_KEY);
    } catch (err) {
      return null;
    }
  }

  function setPreference(value) {
    try {
      if (value) localStorage.setItem(PREF_KEY, value);
      else localStorage.removeItem(PREF_KEY);
    } catch (err) {
      // Storage may be unavailable (private mode); the choice is simply not remembered.
    }
  }

  /**
   * Restores the storage chosen earlier on this device.
   * @returns {Promise<null | {fs: object} | {handle: FileSystemDirectoryHandle}>}
   *   `{handle}` means the folder is known but the browser needs a click to grant access again.
   */
  async function restoreLocal() {
    const pref = preference();
    if (pref === 'browser') return { fs: new BrowserFS() };
    if (pref === 'folder' && folderSupported) {
      const handle = await kv.get(FOLDER_HANDLE_KEY).catch(() => null);
      if (!handle) return null;
      const state = await handle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt');
      return state === 'granted' ? { fs: new FolderFS(handle) } : { handle };
    }
    return null;
  }

  /** Must be called from a click handler (the browser asks for permission). */
  async function reconnectFolder(handle) {
    const state = await handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') throw new Error('Access to the folder was not granted.');
    setPreference('folder');
    return new FolderFS(handle);
  }

  /** Lets the user pick a data folder. Must be called from a click handler. */
  async function pickFolder() {
    if (!folderSupported) throw new Error('This browser cannot open folders. Use Chrome or Edge, or browser storage.');
    const handle = await window.showDirectoryPicker({ id: 'electronics-inventory', mode: 'readwrite' });
    await kv.set(FOLDER_HANDLE_KEY, handle).catch(() => {});
    setPreference('folder');
    return new FolderFS(handle);
  }

  async function useBrowser() {
    await openDb();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    setPreference('browser');
    return new BrowserFS();
  }

  /** Forgets the local choice so the start screen is shown again (data is not deleted). */
  async function forgetLocal() {
    setPreference(null);
    await kv.delete(FOLDER_HANDLE_KEY).catch(() => {});
  }

  App.storage = {
    ServerFS,
    FolderFS,
    BrowserFS,
    folderSupported,
    detectServer,
    restoreLocal,
    reconnectFolder,
    pickFolder,
    useBrowser,
    forgetLocal,
  };
})(window.App = window.App || {});
