/* Electronics Inventory — shared helpers (no dependencies). */
(function (App) {
  'use strict';

  const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  /** Escapes any value for use inside HTML text or a quoted attribute. */
  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
  }

  /** Lower-cases and strips diacritics; used for search and slugs. */
  function fold(value) {
    return String(value ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  function slugify(value, maxLength = 48) {
    const slug = fold(value).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return slug.slice(0, maxLength).replace(/-+$/, '');
  }

  /** Returns `base`, or `base-2`, `base-3`… whichever is not in `taken`. */
  function uniqueId(base, taken) {
    const root = base || 'item';
    let id = root;
    let n = 2;
    while (taken.has(id)) id = `${root}-${n++}`;
    return id;
  }

  /** Short random token for file names (works in insecure contexts too). */
  function randomToken(length = 6) {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  }

  function nowIso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  const pad = (n) => String(n).padStart(2, '0');

  /** Local date as YYYY-MM-DD. */
  function localDate(date = new Date()) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  /** Local timestamp safe for file names: YYYY-MM-DD-HHMMSS. */
  function fileStamp(date = new Date()) {
    return `${localDate(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  function formatDateTime(value) {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
  }

  function plural(count, word, pluralWord) {
    return `${count} ${count === 1 ? word : pluralWord || `${word}s`}`;
  }

  /** Returns a normalized URL string for http(s)/mailto links, otherwise null. */
  function safeUrl(value) {
    const text = String(value ?? '').trim();
    if (!text) return null;
    try {
      const url = new URL(text);
      return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.href : null;
    } catch (err) {
      return null;
    }
  }

  function hostname(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, '');
    } catch (err) {
      return '';
    }
  }

  const URL_PATTERN = /\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]]/g;

  /** Escapes text and turns bare http(s) URLs into links. */
  function linkify(text) {
    const source = String(text ?? '');
    let html = '';
    let last = 0;
    for (const match of source.matchAll(URL_PATTERN)) {
      html += esc(source.slice(last, match.index));
      const href = safeUrl(match[0]);
      html += href
        ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(match[0])}</a>`
        : esc(match[0]);
      last = match.index + match[0].length;
    }
    return html + esc(source.slice(last));
  }

  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  /** Opens a native file picker and resolves with the chosen files ([] when cancelled). */
  function pickFiles({ accept = '', multiple = false, directory = false } = {}) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.multiple = multiple;
      if (directory) input.webkitdirectory = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        resolve(Array.from(input.files || []));
        input.remove();
      });
      input.addEventListener('cancel', () => {
        resolve([]);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  /** Parses a quantity: '' / '?' / null → null (unknown), otherwise a non-negative number. */
  function parseQty(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : null;
    const text = String(value).trim().replace(',', '.');
    if (!text || text === '?') return null;
    const n = Number(text);
    return Number.isFinite(n) ? Math.max(0, n) : null;
  }

  function roundQty(n) {
    return Math.round(n * 1000) / 1000;
  }

  /** Splits "a, b; c" into trimmed, de-duplicated values. */
  function splitList(value) {
    const out = [];
    const seen = new Set();
    for (const item of String(value ?? '').split(/[,;\n]/)) {
      const text = item.trim();
      const key = text.toLowerCase();
      if (text && !seen.has(key)) {
        seen.add(key);
        out.push(text);
      }
    }
    return out;
  }

  /** Trimmed, non-empty, de-duplicated strings (keeps the first spelling). */
  function uniqueStrings(list) {
    const out = [];
    const seen = new Set();
    for (const item of list) {
      const text = String(item ?? '').trim();
      const key = text.toLowerCase();
      if (text && !seen.has(key)) {
        seen.add(key);
        out.push(text);
      }
    }
    return out;
  }

  const MIME_BY_EXT = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    json: 'application/json',
  };

  function mimeFor(path) {
    const ext = String(path).split('.').pop().toLowerCase();
    return MIME_BY_EXT[ext] || 'application/octet-stream';
  }

  App.util = {
    esc,
    fold,
    slugify,
    uniqueId,
    randomToken,
    nowIso,
    localDate,
    fileStamp,
    formatDateTime,
    formatBytes,
    plural,
    safeUrl,
    hostname,
    linkify,
    collator,
    debounce,
    downloadBlob,
    pickFiles,
    isTypingTarget,
    parseQty,
    roundQty,
    splitList,
    uniqueStrings,
    mimeFor,
  };
})(window.App = window.App || {});
