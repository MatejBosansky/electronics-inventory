/* Electronics Inventory — data format: defaults, normalization and display helpers.
 * The whole database is one JSON document (inventory.json) plus image files.
 * See docs/DATA_FORMAT.md for the format description. */
(function (App) {
  'use strict';

  const U = App.util;

  const FORMAT = 'electronics-inventory';
  const VERSION = 2; // 2: locations have a `place`
  const DEFAULT_TITLE = 'Electronics Inventory';
  const FIELD_TYPES = ['text', 'number', 'select', 'multi', 'bool'];
  const FIELD_TYPE_LABELS = {
    text: 'Text',
    number: 'Number',
    select: 'Choice (one value)',
    multi: 'Choices (several values)',
    bool: 'Yes / no',
  };
  const LOCATION_COLORS = [
    '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04',
    '#16a34a', '#0d9488', '#0891b2', '#6b7280', '#111827', '#e5e7eb',
  ];
  const DEFAULT_LOCATION_COLOR = '#6b7280';
  const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;
  const SAFE_FILE_PATH = /^images\/(thumbs\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

  // Default properties and categories live in defaults.js (shared with the Python server).
  const DEFAULT_FIELDS = App.defaults.fields;
  const DEFAULT_CATEGORIES = App.defaults.categories;

  const FALLBACK_CATEGORY = 'other';

  const str = (value) => (value === null || value === undefined ? '' : String(value));
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function createInventory() {
    return {
      format: FORMAT,
      version: VERSION,
      updatedAt: U.nowIso(),
      settings: { title: DEFAULT_TITLE },
      fields: clone(DEFAULT_FIELDS),
      categories: clone(DEFAULT_CATEGORIES),
      locations: [],
      parts: [],
    };
  }

  function normalizeOptions(options) {
    if (!Array.isArray(options)) return undefined;
    const list = U.uniqueStrings(options.map(str));
    return list.length ? list : undefined;
  }

  function normalizeField(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const key = str(raw.key).trim();
    if (!KEY_PATTERN.test(key)) return null;
    const type = FIELD_TYPES.includes(raw.type) ? raw.type : 'text';
    const field = { key, label: str(raw.label).trim() || key, type };
    const unit = str(raw.unit).trim();
    if (unit) field.unit = unit;
    const options = normalizeOptions(raw.options);
    if (options && (type === 'select' || type === 'multi')) field.options = options;
    return field;
  }

  function normalizeFields(raw) {
    if (!Array.isArray(raw)) return clone(DEFAULT_FIELDS);
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      const field = normalizeField(item);
      if (field && !seen.has(field.key)) {
        seen.add(field.key);
        out.push(field);
      }
    }
    return out;
  }

  function normalizeCategory(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const name = str(raw.name).trim();
    const id = str(raw.id).trim() || U.slugify(name);
    if (!id) return null;
    const fields = Array.isArray(raw.fields) ? [...new Set(raw.fields.map(str).filter((k) => KEY_PATTERN.test(k)))] : [];
    return { id, name: name || id, icon: str(raw.icon).trim() || 'shapes', fields };
  }

  function normalizeCategories(raw) {
    if (!Array.isArray(raw)) return clone(DEFAULT_CATEGORIES);
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      const category = normalizeCategory(item);
      if (category && !seen.has(category.id)) {
        seen.add(category.id);
        out.push(category);
      }
    }
    return out;
  }

  function normalizeLocationCode(value) {
    return str(value).trim().slice(0, 32);
  }

  function normalizeColor(value) {
    const text = str(value).trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : DEFAULT_LOCATION_COLOR;
  }

  /** Place a location belongs to (e.g. "Place 1"); '' = none. */
  function normalizePlace(value) {
    return str(value).trim().slice(0, 60);
  }

  function normalizeLocation(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const code = normalizeLocationCode(raw.code ?? raw.id);
    if (!code) return null;
    return {
      code,
      name: str(raw.name).trim() || code,
      place: normalizePlace(raw.place),
      color: normalizeColor(raw.color),
      notes: str(raw.notes),
    };
  }

  /** Places that differ only in case get one spelling (the first one used). */
  function unifyPlaces(locations) {
    const spelling = new Map();
    for (const location of locations) {
      if (!location.place) continue;
      const key = location.place.toLowerCase();
      if (spelling.has(key)) location.place = spelling.get(key);
      else spelling.set(key, location.place);
    }
    return locations;
  }

  function normalizeLocations(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      const location = normalizeLocation(item);
      if (location && !seen.has(location.code.toLowerCase())) {
        seen.add(location.code.toLowerCase());
        out.push(location);
      }
    }
    return unifyPlaces(out);
  }

  function normalizeTags(raw) {
    const list = Array.isArray(raw) ? raw.map(str).join(',') : str(raw);
    return U.splitList(list).map((tag) => tag.slice(0, 40));
  }

  function normalizeStock(raw, legacy) {
    let rows = raw;
    // Shorthand accepted for hand-written data: { "quantity": 3, "location": "A1" }.
    if (!Array.isArray(rows) && legacy && (legacy.quantity !== undefined || legacy.location !== undefined)) {
      rows = [{ location: legacy.location, qty: legacy.quantity }];
    }
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => row && typeof row === 'object')
      .map((row) => ({
        location: normalizeLocationCode(row.location) || null,
        qty: U.parseQty(row.qty ?? row.quantity),
      }));
  }

  function normalizeSpecValue(value) {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (Array.isArray(value)) {
      const list = U.uniqueStrings(value.map(str));
      return list.length ? list : undefined;
    }
    const text = str(value).trim();
    return text ? text : undefined;
  }

  function normalizeSpecs(raw) {
    const specs = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return specs;
    for (const [key, value] of Object.entries(raw)) {
      if (!KEY_PATTERN.test(key)) continue;
      const normalized = normalizeSpecValue(value);
      if (normalized !== undefined) specs[key] = normalized;
    }
    return specs;
  }

  function isRemoteUrl(path) {
    return /^https?:\/\//i.test(str(path));
  }

  function isSafeImagePath(path) {
    return SAFE_FILE_PATH.test(path) || isRemoteUrl(path);
  }

  function normalizeImages(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const src = str(typeof item === 'string' ? item : item && item.src).trim();
      if (!src || !isSafeImagePath(src)) continue;
      const image = { src };
      const thumb = str(item && item.thumb).trim();
      if (thumb && isSafeImagePath(thumb)) image.thumb = thumb;
      out.push(image);
    }
    return out;
  }

  function normalizeLinks(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const item of raw) {
      const url = U.safeUrl(typeof item === 'string' ? item : item && item.url);
      if (!url) continue;
      out.push({ label: str(item && item.label).trim() || U.hostname(url) || 'Link', url });
    }
    return out;
  }

  /** Brings one part into canonical shape (stable key order for readable diffs). */
  function normalizePart(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const now = U.nowIso();
    const name = str(raw.name).trim() || 'Unnamed part';
    const createdAt = str(raw.createdAt) || now;
    return {
      id: str(raw.id).trim() || U.slugify(name) || 'part',
      name,
      category: str(raw.category).trim() || FALLBACK_CATEGORY,
      description: str(raw.description).trim(),
      tags: normalizeTags(raw.tags),
      stock: normalizeStock(raw.stock, raw),
      specs: normalizeSpecs(raw.specs),
      images: normalizeImages(raw.images),
      links: normalizeLinks(raw.links),
      notes: str(raw.notes).replace(/\s+$/, ''),
      createdAt,
      updatedAt: str(raw.updatedAt) || createdAt,
    };
  }

  /**
   * Adds categories and locations that parts refer to but the lists do not contain.
   * New locations get `options.place` (e.g. the place the user is working in).
   */
  function ensureReferences(inv, part, options = {}) {
    if (!inv.categories.some((cat) => cat.id === part.category)) {
      const known = DEFAULT_CATEGORIES.find((cat) => cat.id === part.category);
      inv.categories.push(known ? clone(known) : {
        id: part.category,
        name: part.category.replace(/[-_]+/g, ' ').replace(/^./, (ch) => ch.toUpperCase()),
        icon: 'shapes',
        fields: [],
      });
    }
    for (const row of part.stock) {
      if (!row.location) continue;
      const match = inv.locations.find((loc) => loc.code.toLowerCase() === row.location.toLowerCase());
      if (match) row.location = match.code;
      else {
        inv.locations.push({
          code: row.location,
          name: row.location,
          place: normalizePlace(options.place),
          color: DEFAULT_LOCATION_COLOR,
          notes: '',
        });
      }
    }
  }

  function normalizeInventory(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw Object.assign(new Error('inventory.json must contain a JSON object.'), { code: 'format' });
    }
    if (raw.format !== undefined && raw.format !== FORMAT) {
      throw Object.assign(new Error(`inventory.json has an unknown format "${raw.format}".`), { code: 'format' });
    }
    const version = Number(raw.version || VERSION);
    if (version > VERSION) {
      throw Object.assign(
        new Error(`inventory.json uses data format ${version}, but this app only knows format ${VERSION}. Update the app.`),
        { code: 'format' },
      );
    }
    const inv = {
      format: FORMAT,
      version: VERSION,
      updatedAt: str(raw.updatedAt) || U.nowIso(),
      settings: { title: str(raw.settings && raw.settings.title).trim() || DEFAULT_TITLE },
      fields: normalizeFields(raw.fields),
      categories: normalizeCategories(raw.categories),
      locations: normalizeLocations(raw.locations),
      parts: [],
    };
    const ids = new Set();
    for (const item of Array.isArray(raw.parts) ? raw.parts : []) {
      const part = normalizePart(item);
      if (!part) continue;
      part.id = U.uniqueId(part.id, ids);
      ids.add(part.id);
      ensureReferences(inv, part);
      inv.parts.push(part);
    }
    return inv;
  }

  // ---------------------------------------------------------------------------
  // Lookups and display helpers

  function fieldMap(inv) {
    return new Map(inv.fields.map((field) => [field.key, field]));
  }

  function categoryById(inv, id) {
    return inv.categories.find((cat) => cat.id === id) || null;
  }

  function locationByCode(inv, code) {
    if (!code) return null;
    const lower = String(code).toLowerCase();
    return inv.locations.find((loc) => loc.code.toLowerCase() === lower) || null;
  }

  /** Places in the order of their first location. */
  function places(inv) {
    const out = [];
    for (const location of inv.locations) if (location.place && !out.includes(location.place)) out.push(location.place);
    return out;
  }

  /** Place of a location code ('' when the location has none or does not exist). */
  function placeOf(inv, code) {
    const location = locationByCode(inv, code);
    return location ? location.place : '';
  }

  /** Field definition for a key; unknown keys become plain text fields. */
  function fieldDef(fields, key) {
    return fields.get(key) || { key, label: key, type: 'text', custom: true };
  }

  /** Ordered spec keys for a part: its category's fields first, then any extra keys. */
  function specKeysFor(inv, part) {
    const category = categoryById(inv, part.category);
    const keys = category ? category.fields.filter((key) => part.specs[key] !== undefined) : [];
    for (const key of Object.keys(part.specs)) if (!keys.includes(key)) keys.push(key);
    return keys;
  }

  function specText(def, value) {
    if (value === undefined || value === null || value === '') return '';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.join(', ');
    const text = String(value);
    return def && def.unit ? `${text} ${def.unit}` : text;
  }

  /** Short labels shown on part cards (e.g. "Wi-Fi 6 (2.4 GHz)", "Bluetooth 5.3", "Thread 1.3", "Zigbee"). */
  function partBadges(inv, part, fields, max = 4) {
    const badges = [];
    for (const key of specKeysFor(inv, part)) {
      if (badges.length >= max) break;
      const def = fieldDef(fields, key);
      const value = part.specs[key];
      if (value === false) continue;
      if (value === true) {
        badges.push(def.label);
      } else if (Array.isArray(value)) {
        for (const item of value.slice(0, max - badges.length)) badges.push(item);
      } else {
        const text = specText(def, value);
        if (text.length > 26 || /^none$/i.test(text)) continue; // "None" (e.g. no USB connector) says nothing on a card
        const bare = /^[\d.,]+$/.test(String(value)) && !def.unit;
        badges.push(bare ? `${def.label} ${text}` : text);
      }
    }
    return badges.slice(0, max);
  }

  function stockSummary(part) {
    let total = 0;
    let unknown = false;
    for (const row of part.stock) {
      if (row.qty === null || row.qty === undefined) unknown = true;
      else total += row.qty;
    }
    return { total: U.roundQty(total), unknown, rows: part.stock.length };
  }

  /** "12", "12+" (some amounts unknown) or "?" (all unknown). */
  function quantityText(summary) {
    if (summary.unknown && summary.total === 0) return '?';
    return summary.unknown ? `${summary.total}+` : String(summary.total);
  }

  function inStock(part) {
    return part.stock.some((row) => row.qty === null || row.qty === undefined || row.qty > 0);
  }

  /** Merges stock rows that point to the same location. */
  function mergeStock(rows) {
    const map = new Map();
    for (const row of rows) {
      const key = row.location ? row.location.toLowerCase() : '';
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { location: row.location || null, qty: row.qty ?? null });
      } else if (existing.qty === null || row.qty === null || row.qty === undefined) {
        existing.qty = null;
      } else {
        existing.qty = U.roundQty(existing.qty + row.qty);
      }
    }
    return [...map.values()];
  }

  /** camelCase key for a new field label, unique among `taken`. */
  function fieldKeyFromLabel(label, taken) {
    const words = U.fold(label).replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    let key = words.map((word, i) => (i ? word[0].toUpperCase() + word.slice(1) : word)).join('').slice(0, 40);
    if (!key || !/^[a-z]/.test(key)) key = `field${key ? key[0].toUpperCase() + key.slice(1) : ''}`;
    let unique = key;
    let n = 2;
    while (taken.has(unique)) unique = `${key}${n++}`;
    return unique;
  }

  App.schema = {
    FORMAT,
    VERSION,
    DEFAULT_TITLE,
    FIELD_TYPES,
    FIELD_TYPE_LABELS,
    LOCATION_COLORS,
    DEFAULT_LOCATION_COLOR,
    KEY_PATTERN,
    SAFE_FILE_PATH,
    FALLBACK_CATEGORY,
    DEFAULT_FIELDS,
    DEFAULT_CATEGORIES,
    createInventory,
    normalizeInventory,
    normalizePart,
    normalizeField,
    normalizeCategory,
    normalizeLocation,
    normalizeLocationCode,
    normalizePlace,
    unifyPlaces,
    normalizeTags,
    ensureReferences,
    isRemoteUrl,
    fieldMap,
    fieldDef,
    categoryById,
    locationByCode,
    places,
    placeOf,
    specKeysFor,
    specText,
    partBadges,
    stockSummary,
    quantityText,
    inStock,
    mergeStock,
    fieldKeyFromLabel,
  };
})(window.App = window.App || {});
