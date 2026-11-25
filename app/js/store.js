/* Electronics Inventory — the inventory store.
 * Holds the loaded inventory, serializes every change into inventory.json and guards against
 * lost updates: before each write it checks whether the file changed elsewhere (another device,
 * a script, an AI assistant editing the JSON) and, if so, re-applies the change on the newer data. */
(function (App) {
  'use strict';

  const U = App.util;
  const S = App.schema;

  const INVENTORY = 'inventory.json';
  const SNAPSHOT_DIR = 'backups';
  const MAX_SNAPSHOTS = 40;

  const listeners = new Set();
  const urlCache = new Map();
  let fs = null;
  let inv = null;
  let version = null;
  let queue = Promise.resolve();
  let pending = 0;
  let snapshotDay = null;

  function emit(event) {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error(err);
      }
    }
  }

  function on(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function serialize(data) {
    return `${JSON.stringify(data, null, 2)}\n`;
  }

  function parseInventory(text) {
    let raw;
    try {
      raw = JSON.parse(text);
    } catch (err) {
      throw Object.assign(new Error(`inventory.json is not valid JSON: ${err.message}`), { code: 'parse' });
    }
    return S.normalizeInventory(raw);
  }

  /** Runs tasks one after another so writes never overlap. */
  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  function resetUrls() {
    for (const url of urlCache.values()) URL.revokeObjectURL(url);
    urlCache.clear();
  }

  async function open(nextFs) {
    resetUrls();
    fs = nextFs;
    inv = null;
    version = null;
    snapshotDay = null;
    queue = Promise.resolve(); // a read that hangs on the previous storage must not block this one
    await enqueue(load);
  }

  /** Detaches from the current storage (used when the user switches storage). */
  function close() {
    resetUrls();
    fs = null;
    inv = null;
    version = null;
    snapshotDay = null;
  }

  async function load() {
    const target = fs;
    const result = await target.readText(INVENTORY);
    if (fs !== target) return; // another storage was opened meanwhile
    if (result) {
      inv = parseInventory(result.text);
      version = result.version;
    } else {
      const fresh = S.createInventory();
      const stat = await fs.writeText(INVENTORY, serialize(fresh));
      inv = fresh;
      version = stat ? stat.version : null;
    }
    emit({ type: 'load' });
  }

  function reload() {
    return enqueue(load);
  }

  /**
   * Applies `mutate(draft)` to the newest inventory and saves it.
   * The draft is a copy, so a failing mutation or write leaves the loaded data untouched.
   * On the inventory server the write is conditional (If-Match); when someone else saved in
   * between, the newer file is loaded and `mutate` runs again.
   */
  function commit(label, mutate) {
    return enqueue(async () => {
      pending += 1;
      emit({ type: 'saving' });
      try {
        let reloaded = false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const current = await fs.stat(INVENTORY);
          if (current && current.version !== version) {
            const result = await fs.readText(INVENTORY);
            if (result) {
              inv = parseInventory(result.text);
              version = result.version;
              reloaded = true;
            }
          }
          const draft = structuredClone(inv);
          const outcome = mutate(draft);
          draft.updatedAt = U.nowIso();
          await snapshotIfNeeded();
          let stat;
          try {
            stat = await fs.writeText(INVENTORY, serialize(draft), { ifMatch: current ? version : null });
          } catch (err) {
            if (err && err.code === 'conflict') {
              version = null; // changed between our read and write: reload and apply again
              continue;
            }
            throw err;
          }
          inv = draft;
          version = stat ? stat.version : null;
          emit({ type: 'change', label, reloaded });
          return outcome;
        }
        throw new Error('inventory.json keeps being changed elsewhere. Please try again.');
      } finally {
        pending -= 1;
        emit({ type: 'idle' });
      }
    });
  }

  /** Reloads when inventory.json was changed elsewhere. Returns true when it did. */
  async function checkExternal() {
    if (!fs || !inv || pending > 0) return false;
    let current;
    try {
      current = await fs.stat(INVENTORY);
    } catch (err) {
      return false;
    }
    if (!current || current.version === version) return false;
    return enqueue(async () => {
      const result = await fs.readText(INVENTORY);
      if (!result || result.version === version) return false;
      inv = parseInventory(result.text);
      version = result.version;
      emit({ type: 'change', label: 'external', external: true });
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // Snapshots (backups/inventory-*.json)

  async function listSnapshots() {
    const files = await fs.list(SNAPSHOT_DIR);
    return files
      .filter((file) => /^inventory-.*\.json$/.test(file.name))
      .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));
  }

  async function pruneSnapshots() {
    const snapshots = await listSnapshots();
    for (const old of snapshots.slice(MAX_SNAPSHOTS)) {
      await fs.remove(`${SNAPSHOT_DIR}/${old.name}`).catch(() => {});
    }
  }

  /** Keeps the state from before the first change of each day. */
  async function snapshotIfNeeded() {
    const day = U.localDate();
    if (snapshotDay === day) return;
    const path = `${SNAPSHOT_DIR}/inventory-${day}.json`;
    if (!(await fs.stat(path))) {
      const current = await fs.readText(INVENTORY);
      if (current) {
        await fs.writeText(path, current.text);
        await pruneSnapshots();
      }
    }
    snapshotDay = day;
  }

  /** Saves the current inventory.json (or the given text) as a named snapshot. */
  async function createSnapshot(reason = 'manual', text = null) {
    const content = text ?? (await fs.readText(INVENTORY))?.text ?? serialize(inv);
    const name = `inventory-${U.fileStamp()}-${reason}.json`;
    await fs.writeText(`${SNAPSHOT_DIR}/${name}`, content);
    await pruneSnapshots();
    return name;
  }

  async function readSnapshot(name) {
    const result = await fs.readText(`${SNAPSHOT_DIR}/${name}`);
    if (!result) throw new Error(`Snapshot ${name} was not found.`);
    return parseInventory(result.text);
  }

  /** Replaces the whole inventory (restore). The previous file is kept as a snapshot first. */
  async function replaceInventory(next, reason = 'before-restore') {
    const current = await fs.readText(INVENTORY).catch(() => null);
    if (current) await createSnapshot(reason, current.text);
    return enqueue(async () => {
      const draft = S.normalizeInventory(structuredClone(next));
      draft.updatedAt = U.nowIso();
      const stat = await fs.writeText(INVENTORY, serialize(draft));
      inv = draft;
      version = stat ? stat.version : null;
      snapshotDay = null;
      emit({ type: 'change', label: 'restore', reloaded: true });
    });
  }

  // ---------------------------------------------------------------------------
  // Parts

  function partById(id) {
    return inv ? inv.parts.find((part) => part.id === id) || null : null;
  }

  function buildPart(data, id, createdAt) {
    const now = U.nowIso();
    const part = S.normalizePart({ ...data, id, createdAt: createdAt || now, updatedAt: now });
    part.stock = S.mergeStock(part.stock);
    part.uses = S.mergeUses(part.uses);
    return part;
  }

  /** `options.place`: place of locations that the part's stock creates. */
  function addPart(data, options = {}) {
    return commit('add', (draft) => {
      const taken = new Set(draft.parts.map((part) => part.id));
      const id = U.uniqueId(U.slugify(data.name) || 'part', taken);
      const part = buildPart(data, id);
      S.ensureReferences(draft, part, options);
      draft.parts.push(part);
      return id;
    });
  }

  function updatePart(id, data, options = {}) {
    return commit('update', (draft) => {
      const index = draft.parts.findIndex((part) => part.id === id);
      const part = buildPart(data, id, index >= 0 ? draft.parts[index].createdAt : null);
      S.ensureReferences(draft, part, options);
      if (index >= 0) draft.parts[index] = part;
      else draft.parts.push(part); // deleted elsewhere meanwhile: keep the user's edit
      return id;
    });
  }

  function deletePart(id) {
    return commit('delete', (draft) => {
      const index = draft.parts.findIndex((part) => part.id === id);
      if (index < 0) return null;
      const [part] = draft.parts.splice(index, 1);
      return { part, index };
    });
  }

  function restorePart(part, index) {
    return commit('restore-part', (draft) => {
      if (!draft.parts.some((item) => item.id === part.id)) {
        draft.parts.splice(Math.min(index, draft.parts.length), 0, part);
        S.ensureReferences(draft, part);
      }
      return part.id;
    });
  }

  function draftPart(draft, id) {
    const part = draft.parts.find((item) => item.id === id);
    if (!part) throw new Error('This part no longer exists.');
    return part;
  }

  /** Stock row of a part at a location code (null or '' = the unassigned row). */
  function stockRow(part, location) {
    const key = location ? location.toLowerCase() : '';
    return part.stock.find((item) => (item.location ? item.location.toLowerCase() : '') === key) || null;
  }

  function useOf(part, project) {
    const key = String(project || '').toLowerCase();
    return part.uses.find((use) => use.project.toLowerCase() === key) || null;
  }

  /** Changes the quantity at one location by `delta` (e.g. -1 when a part is used). */
  function adjustQuantity(id, location, delta) {
    return commit('quantity', (draft) => {
      const part = draftPart(draft, id);
      const row = stockRow(part, location);
      if (!row) throw new Error('This location is no longer listed for the part.');
      if (row.qty === null) throw new Error('The amount is unknown. Set it in the editor first.');
      row.qty = Math.max(0, U.roundQty(row.qty + delta));
      part.updatedAt = U.nowIso();
      return row.qty;
    });
  }

  // ---------------------------------------------------------------------------
  // Projects: pieces built into a project are listed in `uses` instead of the stock.

  /**
   * Puts `qty` pieces into a project. With `takeFrom` they leave the stock at `location`
   * (null = the unassigned row); a project of the same name gets the pieces added.
   * Returns the project name as stored.
   */
  function useInProject(id, { project, qty, note = '', takeFrom = false, location = null }) {
    return commit('use', (draft) => {
      const part = draftPart(draft, id);
      const name = S.projectByName(draft, project) || S.normalizeProject(project);
      if (!name) throw new Error('Please enter a project.');
      const amount = U.parseQty(qty);
      if (!amount) throw new Error('Please enter how many pieces are used.');
      if (takeFrom) {
        const row = stockRow(part, location);
        if (!row) throw new Error('This location is no longer listed for the part.');
        if (row.qty !== null) {
          if (amount > row.qty) throw new Error(`Only ${row.qty} in ${row.location || 'Unassigned'}.`);
          row.qty = U.roundQty(row.qty - amount);
        }
      }
      const text = String(note || '').trim().slice(0, 200);
      const existing = useOf(part, name);
      if (existing) {
        existing.qty = existing.qty === null ? null : U.roundQty(existing.qty + amount);
        if (text) existing.note = text;
      } else {
        part.uses.push({ project: name, qty: amount, note: text });
      }
      part.updatedAt = U.nowIso();
      return name;
    });
  }

  /**
   * Takes `qty` pieces (empty = all of them) out of a project. With `putBack` they return to the
   * stock at `location` (null = the unassigned row); otherwise they are gone (used up, broken).
   * Returns the amount taken out (null when it was unknown).
   */
  function returnFromProject(id, { project, qty = null, putBack = true, location = null }) {
    return commit('use-return', (draft) => {
      const part = draftPart(draft, id);
      const use = useOf(part, project);
      if (!use) throw new Error(`This part is no longer in use in ${project}.`);
      const all = qty === null || qty === undefined || String(qty).trim() === '';
      const amount = all ? use.qty : U.parseQty(qty);
      if (!all && !amount) throw new Error('Please enter how many pieces come back.');
      if (!all && use.qty !== null && amount > use.qty) throw new Error(`Only ${use.qty} in use in ${use.project}.`);
      if (all || (use.qty !== null && amount >= use.qty)) part.uses.splice(part.uses.indexOf(use), 1);
      else if (use.qty !== null) use.qty = U.roundQty(use.qty - amount);
      if (putBack) {
        const row = stockRow(part, location);
        if (!row) part.stock.push({ location: location || null, qty: amount });
        else row.qty = row.qty === null || amount === null ? null : U.roundQty(row.qty + amount);
        S.ensureReferences(draft, part);
      }
      part.updatedAt = U.nowIso();
      return amount;
    });
  }

  /** Changes a use (project, amount, note) without touching the stock; `data === null` removes it. */
  function saveUse(id, project, data) {
    return commit('use-edit', (draft) => {
      const part = draftPart(draft, id);
      const use = useOf(part, project);
      if (!use) throw new Error(`This part is no longer in use in ${project}.`);
      const index = part.uses.indexOf(use);
      part.uses.splice(index, 1);
      if (data === null) {
        part.updatedAt = U.nowIso();
        return null;
      }
      const name = S.projectByName(draft, data.project) || S.normalizeProject(data.project);
      if (!name) throw new Error('Please enter a project.');
      const qtyText = String(data.qty ?? '').trim();
      const amount = U.parseQty(qtyText);
      if (qtyText && qtyText !== '?' && amount === null) throw new Error(`“${qtyText}” is not a valid amount.`);
      if (amount === 0) throw new Error('The amount must be more than 0. To take the part off the project, remove it.');
      part.uses.splice(index, 0, { project: name, qty: amount, note: String(data.note || '').trim().slice(0, 200) });
      part.uses = S.mergeUses(part.uses);
      part.updatedAt = U.nowIso();
      return name;
    });
  }

  // ---------------------------------------------------------------------------
  // Settings: locations, categories, fields

  function updateSettings(patch) {
    return commit('settings', (draft) => {
      Object.assign(draft.settings, patch);
    });
  }

  function saveLocation(oldCode, data) {
    return commit('location', (draft) => {
      const location = S.normalizeLocation(data);
      if (!location) throw new Error('The location needs a code.');
      // A place written in another case joins the existing place of that name.
      const place = location.place.toLowerCase();
      const same = place && draft.locations.find((loc) => loc.place.toLowerCase() === place && loc.code !== oldCode);
      if (same) location.place = same.place;
      const clash = draft.locations.find((loc) => loc.code.toLowerCase() === location.code.toLowerCase()
        && (!oldCode || loc.code.toLowerCase() !== oldCode.toLowerCase()));
      if (clash) throw new Error(`Location code “${location.code}” is already used.`);
      const index = oldCode ? draft.locations.findIndex((loc) => loc.code === oldCode) : -1;
      if (index >= 0) {
        draft.locations[index] = location;
        if (oldCode !== location.code) {
          for (const part of draft.parts) {
            for (const row of part.stock) if (row.location === oldCode) row.location = location.code;
          }
        }
      } else {
        draft.locations.push(location);
      }
      S.unifyPlaces(draft.locations);
      return location.code;
    });
  }

  /** Renames a place in all its locations; an empty name removes the place from them. */
  function renamePlace(from, to) {
    return commit('place', (draft) => {
      const name = S.normalizePlace(to);
      let changed = 0;
      for (const location of draft.locations) {
        if (location.place !== from) continue;
        location.place = name;
        changed += 1;
      }
      S.unifyPlaces(draft.locations);
      return changed;
    });
  }

  /** Removes a location; its stock moves to `target` (a code) or becomes unassigned. */
  function deleteLocation(code, target) {
    return commit('location-delete', (draft) => {
      draft.locations = draft.locations.filter((loc) => loc.code !== code);
      for (const part of draft.parts) {
        if (!part.stock.some((row) => row.location === code)) continue;
        for (const row of part.stock) if (row.location === code) row.location = target || null;
        part.stock = S.mergeStock(part.stock);
      }
    });
  }

  function saveCategory(oldId, data) {
    return commit('category', (draft) => {
      const name = String(data.name || '').trim();
      if (!name) throw new Error('The category needs a name.');
      const fields = (data.fields || []).filter((key) => draft.fields.some((field) => field.key === key));
      if (oldId) {
        const category = draft.categories.find((cat) => cat.id === oldId);
        if (!category) throw new Error('This category no longer exists.');
        Object.assign(category, { name, icon: data.icon || category.icon, fields });
        return category.id;
      }
      const taken = new Set(draft.categories.map((cat) => cat.id));
      const id = U.uniqueId(U.slugify(name) || 'category', taken);
      draft.categories.push({ id, name, icon: data.icon || 'shapes', fields });
      return id;
    });
  }

  function moveCategory(id, delta) {
    return commit('category-order', (draft) => {
      const index = draft.categories.findIndex((cat) => cat.id === id);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= draft.categories.length) return;
      const [category] = draft.categories.splice(index, 1);
      draft.categories.splice(target, 0, category);
    });
  }

  function deleteCategory(id, target) {
    return commit('category-delete', (draft) => {
      if (draft.categories.length <= 1) throw new Error('At least one category is needed.');
      const fallback = target || draft.categories.find((cat) => cat.id !== id).id;
      draft.categories = draft.categories.filter((cat) => cat.id !== id);
      for (const part of draft.parts) if (part.category === id) part.category = fallback;
    });
  }

  function saveField(oldKey, data, categoryIds = null) {
    return commit('field', (draft) => {
      const label = String(data.label || '').trim();
      if (!label) throw new Error('The property needs a name.');
      let key = oldKey;
      if (!key) {
        key = S.fieldKeyFromLabel(label, new Set(draft.fields.map((field) => field.key)));
      }
      const field = S.normalizeField({ ...data, key, label });
      const index = draft.fields.findIndex((item) => item.key === key);
      if (index >= 0) draft.fields[index] = field;
      else draft.fields.push(field);
      if (Array.isArray(categoryIds)) {
        for (const category of draft.categories) {
          const has = category.fields.includes(key);
          const wanted = categoryIds.includes(category.id);
          if (wanted && !has) category.fields.push(key);
          if (!wanted && has) category.fields = category.fields.filter((item) => item !== key);
        }
      }
      return key;
    });
  }

  /** Removes a property definition. Values already stored on parts are kept. */
  function deleteField(key) {
    return commit('field-delete', (draft) => {
      draft.fields = draft.fields.filter((field) => field.key !== key);
      for (const category of draft.categories) category.fields = category.fields.filter((item) => item !== key);
    });
  }

  // ---------------------------------------------------------------------------
  // Images

  /** Writes a prepared image (see App.images.prepare) and returns its paths. */
  async function saveImage(prepared, baseName) {
    const base = `${U.slugify(baseName, 40) || 'image'}-${U.randomToken(5)}`;
    const src = `images/${base}.${prepared.full.ext}`;
    const thumb = `images/thumbs/${base}.${prepared.thumb.ext}`;
    await fs.writeBlob(src, prepared.full.blob);
    await fs.writeBlob(thumb, prepared.thumb.blob);
    return { src, thumb };
  }

  /** Synchronous URL when one exists (server or remote images); null when it must be loaded. */
  function imageUrlSync(path) {
    if (!path) return null;
    if (S.isRemoteUrl(path)) return path;
    if (fs && fs.kind === 'server') return fs.url(path);
    return urlCache.get(path) || null;
  }

  async function imageUrl(path) {
    const direct = imageUrlSync(path);
    if (direct) return direct;
    const blob = await fs.readBlob(path);
    if (!blob) throw new Error(`Missing image ${path}`);
    const url = URL.createObjectURL(blob);
    urlCache.set(path, url);
    return url;
  }

  function referencedFiles() {
    const used = new Set();
    for (const part of inv.parts) {
      for (const image of part.images) {
        used.add(image.src);
        if (image.thumb) used.add(image.thumb);
      }
    }
    return used;
  }

  async function listImageFiles() {
    const out = [];
    for (const dir of ['images', 'images/thumbs']) {
      for (const file of await fs.list(dir)) out.push({ path: `${dir}/${file.name}`, size: file.size });
    }
    return out;
  }

  async function findUnusedImages() {
    const used = referencedFiles();
    return (await listImageFiles()).filter((file) => !used.has(file.path));
  }

  async function deleteFiles(paths) {
    let deleted = 0;
    for (const path of paths) {
      if (await fs.remove(path).catch(() => false)) deleted += 1;
      const url = urlCache.get(path);
      if (url) {
        URL.revokeObjectURL(url);
        urlCache.delete(path);
      }
    }
    return deleted;
  }

  App.store = {
    INVENTORY,
    SNAPSHOT_DIR,
    on,
    open,
    close,
    reload,
    commit,
    checkExternal,
    serialize,
    parseInventory,
    get inv() {
      return inv;
    },
    get fs() {
      return fs;
    },
    get busy() {
      return pending > 0;
    },
    partById,
    addPart,
    updatePart,
    deletePart,
    restorePart,
    adjustQuantity,
    useInProject,
    returnFromProject,
    saveUse,
    updateSettings,
    saveLocation,
    deleteLocation,
    renamePlace,
    saveCategory,
    moveCategory,
    deleteCategory,
    saveField,
    deleteField,
    saveImage,
    imageUrl,
    imageUrlSync,
    listImageFiles,
    findUnusedImages,
    deleteFiles,
    listSnapshots,
    readSnapshot,
    createSnapshot,
    replaceInventory,
  };
})(window.App = window.App || {});
