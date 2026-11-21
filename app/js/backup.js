/* Electronics Inventory — backup, export and restore.
 * A full backup is a ZIP with the same layout as the data folder:
 *   <folder>/inventory.json, <folder>/images/…, <folder>/images/thumbs/…
 * so unzipping it gives a folder that can be used directly (Docker volume or local folder). */
(function (App) {
  'use strict';

  const U = App.util;
  const S = App.schema;
  const store = App.store;

  const IMAGE_PATH = /^images\/(thumbs\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

  function backupName() {
    return `electronics-inventory-backup-${U.localDate()}`;
  }

  /** Downloads a ZIP with inventory.json and all images. */
  async function downloadZip(onProgress) {
    const folder = backupName();
    const entries = [{ name: `${folder}/inventory.json`, data: store.serialize(store.inv) }];
    const files = await store.listImageFiles();
    let done = 0;
    for (const file of files) {
      const blob = await store.fs.readBlob(file.path);
      if (blob) entries.push({ name: `${folder}/${file.path}`, data: blob });
      done += 1;
      if (onProgress) onProgress(`Reading images ${done}/${files.length}`);
    }
    if (onProgress) onProgress('Creating ZIP…');
    const zip = await App.zip.create(entries);
    U.downloadBlob(zip, `${folder}.zip`);
    return { files: entries.length, size: zip.size };
  }

  function downloadJson() {
    const blob = new Blob([store.serialize(store.inv)], { type: 'application/json' });
    U.downloadBlob(blob, `inventory-${U.localDate()}.json`);
  }

  function csvCell(value) {
    const text = String(value ?? '');
    return /[",\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  /** Spreadsheet-friendly export of all parts (one row per part, one column per property). */
  function downloadCsv() {
    const inv = store.inv;
    const fields = S.fieldMap(inv);
    const specKeys = [];
    for (const field of inv.fields) if (inv.parts.some((part) => part.specs[field.key] !== undefined)) specKeys.push(field.key);
    for (const part of inv.parts) for (const key of Object.keys(part.specs)) if (!specKeys.includes(key)) specKeys.push(key);

    const header = ['ID', 'Name', 'Category', 'Quantity', 'Locations', 'Tags', 'Description', 'Notes', 'Links', 'Images',
      'Created', 'Updated', ...specKeys.map((key) => S.fieldDef(fields, key).label)];
    const rows = [header];
    for (const part of inv.parts) {
      const category = S.categoryById(inv, part.category);
      rows.push([
        part.id,
        part.name,
        category ? category.name : part.category,
        S.quantityText(S.stockSummary(part)),
        part.stock.map((row) => `${row.location || 'Unassigned'}: ${row.qty ?? '?'}`).join('; '),
        part.tags.join(', '),
        part.description,
        part.notes,
        part.links.map((link) => link.url).join(' '),
        part.images.map((image) => image.src).join(' '),
        part.createdAt,
        part.updatedAt,
        ...specKeys.map((key) => S.specText(S.fieldDef(fields, key), part.specs[key])),
      ]);
    }
    const csv = `﻿${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
    U.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `inventory-${U.localDate()}.csv`);
  }

  // ---------------------------------------------------------------------------
  // Restore

  function isJunk(name) {
    return name.startsWith('__MACOSX/') || /(^|\/)\.[^/]*$/.test(name) || /(^|\/)Thumbs\.db$/i.test(name);
  }

  /**
   * Turns a list of {name, blob(), text()} entries into a restore plan.
   * Accepts any folder prefix, e.g. "electronics-inventory-backup-2026-01-01/inventory.json".
   */
  async function planFromEntries(entries) {
    const usable = entries.filter((entry) => !isJunk(entry.name));
    const candidates = usable
      .filter((entry) => /(^|\/)inventory\.json$/.test(entry.name))
      .sort((a, b) => a.name.length - b.name.length);
    if (!candidates.length) throw new Error('No inventory.json was found in the selection.');
    const main = candidates[0];
    const prefix = main.name.slice(0, main.name.length - 'inventory.json'.length);
    const inventory = store.parseInventory(await main.text());
    const files = [];
    let skipped = 0;
    for (const entry of usable) {
      if (!entry.name.startsWith(prefix)) continue;
      const path = entry.name.slice(prefix.length);
      if (!path.startsWith('images/')) continue;
      if (IMAGE_PATH.test(path)) files.push({ path, entry });
      else skipped += 1;
    }
    return { inventory, files, skipped };
  }

  async function planFromFile(file) {
    if (/\.json$/i.test(file.name) || file.type === 'application/json') {
      const inventory = store.parseInventory(await file.text());
      return { inventory, files: [], skipped: 0 };
    }
    const entries = await App.zip.read(file);
    return planFromEntries(entries);
  }

  /** From an <input webkitdirectory> selection. */
  function planFromFolderFiles(files) {
    const entries = files.map((file) => ({
      name: file.webkitRelativePath || file.name,
      blob: async () => file,
      text: () => file.text(),
    }));
    return planFromEntries(entries);
  }

  function summarize(plan) {
    const parts = plan.inventory.parts.length;
    const images = plan.files.filter((file) => !file.path.startsWith('images/thumbs/')).length;
    return { parts, images, thumbs: plan.files.length - images, skipped: plan.skipped };
  }

  /** Writes the images, then replaces inventory.json (the old one is kept as a snapshot). */
  async function applyPlan(plan, onProgress) {
    let done = 0;
    for (const file of plan.files) {
      const blob = await file.entry.blob();
      const typed = blob.type ? blob : new Blob([blob], { type: U.mimeFor(file.path) });
      await store.fs.writeBlob(file.path, typed);
      done += 1;
      if (onProgress) onProgress(`Writing images ${done}/${plan.files.length}`);
    }
    if (onProgress) onProgress('Writing inventory…');
    await store.replaceInventory(plan.inventory, 'before-restore');
  }

  App.backup = {
    downloadZip,
    downloadJson,
    downloadCsv,
    planFromFile,
    planFromFolderFiles,
    summarize,
    applyPlan,
  };
})(window.App = window.App || {});
