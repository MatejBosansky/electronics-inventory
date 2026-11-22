/* Electronics Inventory — settings: locations, categories, properties, data & backup. */
(function (App) {
  'use strict';

  const U = App.util;
  const S = App.schema;
  const ui = App.ui;
  const icon = App.icon;
  const esc = U.esc;

  const TABS = [
    { id: 'general', label: 'General' },
    { id: 'locations', label: 'Locations' },
    { id: 'categories', label: 'Categories' },
    { id: 'fields', label: 'Properties' },
    { id: 'data', label: 'Data & backup' },
  ];

  function countBy(parts, fn) {
    const counts = new Map();
    for (const part of parts) {
      for (const key of fn(part)) counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  // ---------------------------------------------------------------------------
  // General

  function generalHtml(inv) {
    const theme = App.main.prefs.theme || 'system';
    const totals = inv.parts.reduce((sum, part) => sum + S.stockSummary(part).total, 0);
    const images = inv.parts.reduce((sum, part) => sum + part.images.length, 0);
    return `
      <section class="card-section">
        <h2 class="section-title">Inventory</h2>
        <form class="inline-form" data-form="settings-title">
          <div class="field">
            <label class="field__label" for="set-title">Name</label>
            <input type="text" id="set-title" name="title" value="${esc(inv.settings.title)}" maxlength="80" autocomplete="off">
          </div>
          <button type="submit" class="btn btn--primary">Save</button>
        </form>
        <p class="muted small">Shown in the header and the browser tab, on every device.</p>
      </section>
      <section class="card-section">
        <h2 class="section-title">Appearance</h2>
        <div class="seg seg--labels" role="radiogroup" aria-label="Theme">
          ${[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].map(([value, label]) => `
            <button type="button" class="seg__btn${theme === value ? ' is-active' : ''}" data-action="set-theme" data-theme="${value}"
              role="radio" aria-checked="${theme === value}">${label}</button>`).join('')}
        </div>
        <p class="muted small">Saved on this device only.</p>
      </section>
      <section class="card-section">
        <h2 class="section-title">AI agents (MCP &amp; REST API)</h2>
        <div data-panel="agents"><p class="muted small">Checking…</p></div>
      </section>
      <section class="card-section">
        <h2 class="section-title">Summary</h2>
        <dl class="stats">
          <div><dt>Parts</dt><dd>${inv.parts.length}</dd></div>
          <div><dt>Pieces</dt><dd>${U.roundQty(totals)}</dd></div>
          <div><dt>Locations</dt><dd>${inv.locations.length}</dd></div>
          <div><dt>Photos</dt><dd>${images}</dd></div>
        </dl>
        <p class="muted small">Data format version ${S.VERSION}. Last change ${esc(U.formatDateTime(inv.updatedAt))}.</p>
      </section>`;
  }

  function copyFieldHtml(label, value) {
    return `
      <div class="copy-field">
        <span class="field__label">${esc(label)}</span>
        <div class="copy-row">
          <input type="text" readonly value="${esc(value)}" aria-label="${esc(label)}" spellcheck="false">
          <button type="button" class="btn btn--sm" data-action="copy-value">${icon('copy')}<span>Copy</span></button>
        </div>
      </div>`;
  }

  /** Shows the MCP / REST addresses when the app is served by the inventory server. */
  async function loadAgentsPanel(root) {
    const panel = root.querySelector('[data-panel="agents"]');
    if (!panel) return;
    let health = null;
    if (/^https?:$/.test(location.protocol)) {
      try {
        const response = await fetch('api/health', { cache: 'no-store' });
        if (response.ok) health = await response.json();
      } catch (err) {
        health = null;
      }
    }
    if (!health || health.status !== 'ok') {
      panel.innerHTML = `
        <p class="muted small">Not available here. When the app runs with its server (Docker image or
        <code>python3 server/inventory_server.py</code>), AI assistants can use the inventory through an MCP server and a REST API.</p>`;
      return;
    }
    const base = new URL('.', location.href.split('#')[0]);
    const mcp = new URL('mcp', base).href;
    const api = new URL('api/', base).href;
    panel.innerHTML = `
      <p class="small">AI assistants can search, add and update parts through MCP (e.g. Claude Code, Claude Desktop, IDE agents)
        or the REST API (scripts and other tools).</p>
      ${copyFieldHtml('MCP server (Streamable HTTP)', mcp)}
      ${copyFieldHtml('Add to Claude Code', `claude mcp add --transport http inventory ${mcp}`)}
      ${copyFieldHtml('REST API', api)}
      <p class="muted small">API description: <a href="${esc(new URL('openapi.json', api).href)}" target="_blank" rel="noopener">OpenAPI</a>.
        With basic auth enabled, clients must send an <code>Authorization: Basic …</code> header.
        ${health.image_resizing ? '' : 'Photos added through the API are stored without resizing (Pillow is not installed on the server).'}</p>`;
  }

  // ---------------------------------------------------------------------------
  // Locations

  function locationItemHtml(loc, counts) {
    return `
      <li class="item">
        <i class="dot dot--lg" style="--dot:${esc(loc.color)}"></i>
        <div class="item__main">
          <div class="item__title"><strong>${esc(loc.code)}</strong>${loc.name !== loc.code ? ` <span class="muted">· ${esc(loc.name)}</span>` : ''}</div>
          ${loc.notes ? `<div class="item__sub muted small">${esc(loc.notes)}</div>` : ''}
        </div>
        <span class="item__meta muted small">${U.plural(counts.get(loc.code) || 0, 'part')}</span>
        <div class="item__actions">
          <button type="button" class="btn btn--icon btn--sm" data-action="location-show" data-code="${esc(loc.code)}" title="Show its parts" aria-label="Show parts in ${esc(loc.code)}">${icon('search')}</button>
          <button type="button" class="btn btn--icon btn--sm" data-action="location-edit" data-code="${esc(loc.code)}" title="Edit" aria-label="Edit ${esc(loc.code)}">${icon('edit')}</button>
          <button type="button" class="btn btn--icon btn--sm" data-action="location-delete" data-code="${esc(loc.code)}" title="Delete" aria-label="Delete ${esc(loc.code)}">${icon('trash')}</button>
        </div>
      </li>`;
  }

  function locationsHtml(inv) {
    const counts = countBy(inv.parts, (part) => new Set(part.stock.map((row) => row.location).filter(Boolean)));
    const sorted = [...inv.locations].sort((a, b) => U.collator.compare(a.code, b.code));
    const places = S.places(inv);
    // Grouped by place once there are places; locations without one come last.
    const groups = places.length
      ? [...places, ''].map((place) => ({ place, items: sorted.filter((loc) => loc.place === place) })).filter((group) => group.items.length)
      : [{ place: null, items: sorted }];
    return `
      <section class="card-section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Locations</h2>
            <p class="muted small">Boxes, drawers and shelves. The code is the short label on the box (e.g. A1); stock entries refer to it.
              Give locations a place (e.g. Place 1 and Place 2) to choose in the list where to search.</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" data-action="location-new">${icon('plus')}<span>Add location</span></button>
        </div>
        ${sorted.length ? groups.map((group) => `
          ${group.place === null ? '' : `
            <div class="place-head">
              ${icon('pin')}
              <h3 class="place-head__title">${group.place ? esc(group.place) : 'No place'}</h3>
              <span class="muted small">${U.plural(group.items.length, 'location')}</span>
              ${group.place ? `<button type="button" class="btn btn--icon btn--sm" data-action="place-rename" data-place="${esc(group.place)}" title="Rename place" aria-label="Rename place ${esc(group.place)}">${icon('edit')}</button>` : ''}
            </div>`}
          <ul class="item-list">${group.items.map((loc) => locationItemHtml(loc, counts)).join('')}</ul>`).join('')
          : '<p class="muted">No locations yet. They are also created automatically when you type a new code in a part’s stock.</p>'}
      </section>`;
  }

  function locationDialog(code) {
    const inv = App.store.inv;
    const loc = code ? S.locationByCode(inv, code) : null;
    const used = new Set(inv.locations.map((item) => item.color));
    const color = loc ? loc.color : S.LOCATION_COLORS.find((item) => !used.has(item)) || S.LOCATION_COLORS[0];
    const custom = !S.LOCATION_COLORS.includes(color);
    const place = loc ? loc.place : App.filters.activePlaces(inv, App.state.places)[0] || '';
    const body = `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="loc-code">Code <em class="req">*</em></label>
          <input type="text" id="loc-code" name="code" value="${esc(loc ? loc.code : '')}" maxlength="32" required
            autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="e.g. A1">
        </div>
        <div class="field">
          <label class="field__label" for="loc-name">Name</label>
          <input type="text" id="loc-name" name="name" value="${esc(loc && loc.name !== loc.code ? loc.name : '')}" maxlength="80" placeholder="e.g. Blue box">
        </div>
        <div class="field field--full">
          <label class="field__label" for="loc-place">Place</label>
          <input type="text" id="loc-place" name="place" value="${esc(place)}" maxlength="60" list="dl-places" autocomplete="off" placeholder="e.g. Place 1">
          <datalist id="dl-places">${S.places(inv).map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist>
          <p class="field__hint">Optional. Groups locations by where they are, e.g. Place 1 and Place 2; the list can then show only the places you tick.</p>
        </div>
        <fieldset class="field field--full">
          <legend class="field__label">Color</legend>
          <div class="swatches">
            ${S.LOCATION_COLORS.map((item) => `
              <label class="swatch" title="${item}">
                <input type="radio" name="color" value="${item}"${item === color ? ' checked' : ''}>
                <i style="--dot:${item}"></i><span class="sr-only">${item}</span>
              </label>`).join('')}
            <label class="swatch swatch--custom" title="Custom color">
              <input type="radio" name="color" value="custom"${custom ? ' checked' : ''}>
              <input type="color" name="customColor" value="${esc(color)}" aria-label="Custom color">
            </label>
          </div>
        </fieldset>
        <div class="field field--full">
          <label class="field__label" for="loc-notes">Notes</label>
          <textarea id="loc-notes" name="notes" rows="2" placeholder="Where it is, what goes in it…">${esc(loc ? loc.notes : '')}</textarea>
        </div>
      </div>`;
    return ui.formDialog({
      title: loc ? `Edit location ${loc.code}` : 'New location',
      body,
      submitLabel: loc ? 'Save' : 'Add location',
      onRender(form) {
        form.elements.namedItem('customColor').addEventListener('input', () => {
          form.querySelector('input[name="color"][value="custom"]').checked = true;
        });
      },
      onSubmit(data) {
        const codeValue = String(data.get('code') || '').trim();
        if (!codeValue) throw new Error('Please enter a code.');
        const pick = data.get('color');
        return App.store.saveLocation(loc ? loc.code : null, {
          code: codeValue,
          name: String(data.get('name') || '').trim() || codeValue,
          place: String(data.get('place') || ''),
          color: pick === 'custom' ? data.get('customColor') : pick,
          notes: String(data.get('notes') || ''),
        });
      },
    });
  }

  function placeDialog(place) {
    const inv = App.store.inv;
    const count = inv.locations.filter((loc) => loc.place === place).length;
    const body = `
      <div class="field">
        <label class="field__label" for="place-name">Name</label>
        <input type="text" id="place-name" name="name" value="${esc(place)}" maxlength="60" autocomplete="off">
        <p class="field__hint">Changes the place of ${U.plural(count, 'location')}. Leave it empty to remove the place from them.</p>
      </div>`;
    return ui.formDialog({
      title: 'Rename place',
      body,
      submitLabel: 'Save',
      async onSubmit(data) {
        await App.store.renamePlace(place, String(data.get('name') || ''));
        if (App.state.places.includes(place)) {
          // Keep the place chosen in the list under its new name (dropped when it was removed).
          const name = S.normalizePlace(data.get('name')).toLowerCase();
          const renamed = S.places(App.store.inv).find((item) => item.toLowerCase() === name);
          App.state.places = [...new Set(App.state.places.map((item) => (item === place ? renamed : item)).filter(Boolean))];
          App.main.savePrefs();
        }
      },
    });
  }

  async function deleteLocation(code) {
    const inv = App.store.inv;
    const used = inv.parts.filter((part) => part.stock.some((row) => row.location === code)).length;
    if (!used) {
      const ok = await ui.confirm({ title: `Delete location ${code}?`, confirmLabel: 'Delete', danger: true });
      if (ok) await App.store.deleteLocation(code, null);
      return;
    }
    const others = inv.locations.filter((loc) => loc.code !== code);
    const result = await ui.confirm({
      title: `Delete location ${code}?`,
      message: `${U.plural(used, 'part')} ${used === 1 ? 'is' : 'are'} stored there. Where should ${used === 1 ? 'it' : 'they'} go?`,
      confirmLabel: 'Delete',
      danger: true,
      html: `
        <div class="field">
          <label class="field__label" for="loc-target">Move stock to</label>
          <select id="loc-target" name="target">
            <option value="">Unassigned</option>
            ${others.map((loc) => `<option value="${esc(loc.code)}">${esc(loc.code)}${loc.name !== loc.code ? ` · ${esc(loc.name)}` : ''}</option>`).join('')}
          </select>
        </div>`,
    });
    if (result) await App.store.deleteLocation(code, result.get('target') || null);
  }

  // ---------------------------------------------------------------------------
  // Categories

  function categoriesHtml(inv) {
    const counts = countBy(inv.parts, (part) => [part.category]);
    return `
      <section class="card-section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Categories</h2>
            <p class="muted small">Each category has its own list of properties for the form, the detail and the filters.</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" data-action="category-new">${icon('plus')}<span>Add category</span></button>
        </div>
        <ul class="item-list">
          ${inv.categories.map((cat, i) => `
            <li class="item">
              <span class="item__icon">${icon(cat.icon)}</span>
              <div class="item__main">
                <div class="item__title"><strong>${esc(cat.name)}</strong></div>
                <div class="item__sub muted small">${U.plural(cat.fields.length, 'property', 'properties')}</div>
              </div>
              <span class="item__meta muted small">${U.plural(counts.get(cat.id) || 0, 'part')}</span>
              <div class="item__actions">
                <button type="button" class="btn btn--icon btn--sm" data-action="category-up" data-id="${esc(cat.id)}" aria-label="Move up"${i === 0 ? ' disabled' : ''}>${icon('arrowUp')}</button>
                <button type="button" class="btn btn--icon btn--sm" data-action="category-down" data-id="${esc(cat.id)}" aria-label="Move down"${i === inv.categories.length - 1 ? ' disabled' : ''}>${icon('arrowDown')}</button>
                <button type="button" class="btn btn--icon btn--sm" data-action="category-edit" data-id="${esc(cat.id)}" aria-label="Edit ${esc(cat.name)}">${icon('edit')}</button>
                <button type="button" class="btn btn--icon btn--sm" data-action="category-delete" data-id="${esc(cat.id)}" aria-label="Delete ${esc(cat.name)}">${icon('trash')}</button>
              </div>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  function orderItemHtml(fields, key) {
    const def = S.fieldDef(fields, key);
    return `
      <li class="order-item" data-key="${esc(key)}">
        <input type="hidden" name="fields" value="${esc(key)}">
        <span class="order-item__label">${esc(def.label)}</span>
        <span class="muted small">${esc(S.FIELD_TYPE_LABELS[def.type] || def.type)}</span>
        <button type="button" class="btn btn--icon btn--xs" data-order="up" aria-label="Move up">${icon('arrowUp')}</button>
        <button type="button" class="btn btn--icon btn--xs" data-order="down" aria-label="Move down">${icon('arrowDown')}</button>
        <button type="button" class="btn btn--icon btn--xs" data-order="remove" aria-label="Remove">${icon('x')}</button>
      </li>`;
  }

  function categoryDialog(id) {
    const inv = App.store.inv;
    const fields = S.fieldMap(inv);
    const cat = id ? S.categoryById(inv, id) : null;
    const selected = cat ? cat.fields : [];
    const current = cat ? cat.icon : 'shapes';
    const body = `
      <div class="field">
        <label class="field__label" for="cat-name">Name <em class="req">*</em></label>
        <input type="text" id="cat-name" name="name" value="${esc(cat ? cat.name : '')}" maxlength="60" required autocomplete="off">
      </div>
      <fieldset class="field">
        <legend class="field__label">Icon</legend>
        <div class="icon-picker">
          ${App.CATEGORY_ICONS.map((name) => `
            <label class="icon-choice" title="${name}">
              <input type="radio" name="icon" value="${name}"${current === name ? ' checked' : ''}>
              <span>${icon(name)}</span><span class="sr-only">${name}</span>
            </label>`).join('')}
        </div>
      </fieldset>
      <fieldset class="field">
        <legend class="field__label">Properties</legend>
        <p class="field__hint">Shown in this order in the form, the detail and the filters.</p>
        <ol class="order-list" data-order-list>${selected.map((key) => orderItemHtml(fields, key)).join('')}</ol>
        <select data-order-add aria-label="Add property">
          <option value="">Add property…</option>
          ${inv.fields.filter((field) => !selected.includes(field.key)).map((field) => `<option value="${esc(field.key)}">${esc(field.label)}</option>`).join('')}
        </select>
      </fieldset>`;
    return ui.formDialog({
      title: cat ? `Edit category “${cat.name}”` : 'New category',
      body,
      wide: true,
      submitLabel: cat ? 'Save' : 'Add category',
      onRender(form) {
        const list = form.querySelector('[data-order-list]');
        const add = form.querySelector('[data-order-add]');
        list.addEventListener('click', (event) => {
          const button = event.target.closest('[data-order]');
          if (!button) return;
          const item = button.closest('li');
          const op = button.dataset.order;
          if (op === 'up' && item.previousElementSibling) list.insertBefore(item, item.previousElementSibling);
          if (op === 'down' && item.nextElementSibling) list.insertBefore(item.nextElementSibling, item);
          if (op === 'remove') {
            const key = item.dataset.key;
            item.remove();
            add.appendChild(new Option(S.fieldDef(fields, key).label, key));
          }
        });
        add.addEventListener('change', () => {
          const key = add.value;
          if (!key) return;
          list.insertAdjacentHTML('beforeend', orderItemHtml(fields, key));
          add.querySelector(`option[value="${CSS.escape(key)}"]`).remove();
          add.value = '';
        });
      },
      onSubmit(data) {
        return App.store.saveCategory(id, {
          name: data.get('name'),
          icon: data.get('icon'),
          fields: data.getAll('fields'),
        });
      },
    });
  }

  async function deleteCategory(id) {
    const inv = App.store.inv;
    const cat = S.categoryById(inv, id);
    if (!cat) return;
    if (inv.categories.length <= 1) {
      ui.toast('At least one category is needed.', { kind: 'error' });
      return;
    }
    const used = inv.parts.filter((part) => part.category === id).length;
    const others = inv.categories.filter((item) => item.id !== id);
    const result = await ui.confirm({
      title: `Delete category “${cat.name}”?`,
      message: used ? `${U.plural(used, 'part')} will be moved to another category.` : 'It contains no parts.',
      confirmLabel: 'Delete',
      danger: true,
      html: used ? `
        <div class="field">
          <label class="field__label" for="cat-target">Move parts to</label>
          <select id="cat-target" name="target">
            ${others.map((item) => `<option value="${esc(item.id)}"${item.id === S.FALLBACK_CATEGORY ? ' selected' : ''}>${esc(item.name)}</option>`).join('')}
          </select>
        </div>` : '',
    });
    if (!result) return;
    await App.store.deleteCategory(id, result instanceof FormData ? result.get('target') : null);
    if (App.state.category === id) App.state.category = null;
  }

  // ---------------------------------------------------------------------------
  // Properties (fields)

  function fieldsHtml(inv) {
    const inCategories = new Map(inv.fields.map((field) => [field.key, inv.categories.filter((cat) => cat.fields.includes(field.key)).length]));
    const onParts = countBy(inv.parts, (part) => Object.keys(part.specs));
    return `
      <section class="card-section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Properties</h2>
            <p class="muted small">Properties describe parts (e.g. Wi-Fi, Bluetooth version, interface) and become filters.</p>
          </div>
          <button type="button" class="btn btn--primary btn--sm" data-action="field-new">${icon('plus')}<span>Add property</span></button>
        </div>
        <ul class="item-list">
          ${inv.fields.map((field) => `
            <li class="item">
              <div class="item__main">
                <div class="item__title"><strong>${esc(field.label)}</strong>${field.unit ? ` <span class="muted">(${esc(field.unit)})</span>` : ''}</div>
                <div class="item__sub muted small"><code>${esc(field.key)}</code> · ${esc(S.FIELD_TYPE_LABELS[field.type])}${field.options ? ` · ${U.plural(field.options.length, 'suggestion')}` : ''}</div>
              </div>
              <span class="item__meta muted small">${U.plural(inCategories.get(field.key) || 0, 'category', 'categories')} · ${U.plural(onParts.get(field.key) || 0, 'part')}</span>
              <div class="item__actions">
                <button type="button" class="btn btn--icon btn--sm" data-action="field-edit" data-key="${esc(field.key)}" aria-label="Edit ${esc(field.label)}">${icon('edit')}</button>
                <button type="button" class="btn btn--icon btn--sm" data-action="field-delete" data-key="${esc(field.key)}" aria-label="Delete ${esc(field.label)}">${icon('trash')}</button>
              </div>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  /** Create or edit a property. Resolves with its key, or null when cancelled. */
  function fieldDialog(key, { categoryId = null } = {}) {
    const inv = App.store.inv;
    const def = key ? inv.fields.find((field) => field.key === key) : null;
    const inCategories = def
      ? inv.categories.filter((cat) => cat.fields.includes(key)).map((cat) => cat.id)
      : categoryId ? [categoryId] : [];
    const type = def ? def.type : 'text';
    const body = `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="fld-label">Name <em class="req">*</em></label>
          <input type="text" id="fld-label" name="label" value="${esc(def ? def.label : '')}" maxlength="60" required autocomplete="off" placeholder="e.g. Max frequency">
        </div>
        <div class="field">
          <label class="field__label" for="fld-type">Type</label>
          <select id="fld-type" name="type">
            ${S.FIELD_TYPES.map((item) => `<option value="${item}"${item === type ? ' selected' : ''}>${esc(S.FIELD_TYPE_LABELS[item])}</option>`).join('')}
          </select>
        </div>
        <div class="field" data-show-for="text number select">
          <label class="field__label" for="fld-unit">Unit</label>
          <input type="text" id="fld-unit" name="unit" value="${esc(def && def.unit ? def.unit : '')}" maxlength="16" autocomplete="off" placeholder="e.g. MHz">
        </div>
        <div class="field field--full" data-show-for="select multi">
          <label class="field__label" for="fld-options">Suggested values</label>
          <textarea id="fld-options" name="options" rows="4" placeholder="One per line">${esc(def && def.options ? def.options.join('\n') : '')}</textarea>
          <span class="field__hint">Other values can still be typed in the form.</span>
        </div>
        ${def ? `<p class="field field--full muted small">Key in inventory.json: <code>${esc(def.key)}</code></p>` : ''}
        <fieldset class="field field--full">
          <legend class="field__label">Use in categories</legend>
          <div class="check-grid">
            ${inv.categories.map((cat) => `
              <label class="check"><input type="checkbox" name="categories" value="${esc(cat.id)}"${inCategories.includes(cat.id) ? ' checked' : ''}>
              <span>${esc(cat.name)}</span></label>`).join('')}
          </div>
        </fieldset>
      </div>`;
    return ui.formDialog({
      title: def ? `Edit property “${def.label}”` : 'New property',
      body,
      wide: true,
      submitLabel: def ? 'Save' : 'Add property',
      onRender(form) {
        const select = form.elements.namedItem('type');
        const sync = () => {
          for (const el of form.querySelectorAll('[data-show-for]')) el.hidden = !el.dataset.showFor.split(' ').includes(select.value);
        };
        select.addEventListener('change', sync);
        sync();
      },
      onSubmit(data) {
        return App.store.saveField(key, {
          label: data.get('label'),
          type: data.get('type'),
          unit: data.get('unit'),
          options: String(data.get('options') || '').split('\n'),
        }, data.getAll('categories'));
      },
    });
  }

  async function deleteField(key) {
    const inv = App.store.inv;
    const def = inv.fields.find((field) => field.key === key);
    if (!def) return;
    const used = inv.parts.filter((part) => part.specs[key] !== undefined).length;
    const ok = await ui.confirm({
      title: `Delete property “${def.label}”?`,
      message: used
        ? `${U.plural(used, 'part')} ${used === 1 ? 'has' : 'have'} a value for it. The values stay stored on the parts and are shown as extra properties.`
        : 'No part uses it.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) await App.store.deleteField(key);
  }

  // ---------------------------------------------------------------------------
  // Data & backup

  const STORAGE_TEXT = {
    server: 'Everything is stored on the server in its data folder (the Docker volume, e.g. ./data next to docker-compose.yml). Copying that folder is a complete backup.',
    folder: 'Everything is stored as plain files in the folder you picked. Copying that folder is a complete backup.',
    browser: 'Everything is stored inside this browser only. Download a full backup regularly — clearing the browser’s site data deletes the inventory.',
  };
  const STORAGE_ICON = { server: 'server', folder: 'folder', browser: 'database' };

  function dataHtml() {
    const fs = App.store.fs;
    return `
      <section class="card-section">
        <h2 class="section-title">Storage</h2>
        <div class="storage-card">
          <span class="storage-card__icon">${icon(STORAGE_ICON[fs.kind])}</span>
          <div>
            <div class="storage-card__title">${esc(fs.kind === 'server' ? 'Server' : fs.kind === 'folder' ? 'Folder on this computer' : 'This browser')}</div>
            <div class="muted small">${esc(fs.detail)}</div>
          </div>
        </div>
        <p class="muted small">${esc(STORAGE_TEXT[fs.kind])}</p>
        ${fs.kind !== 'server' ? `<button type="button" class="btn btn--sm" data-action="storage-change">${icon('refresh')}<span>Use a different storage…</span></button>` : ''}
      </section>
      <section class="card-section">
        <h2 class="section-title">Backup &amp; export</h2>
        <div class="button-row">
          <button type="button" class="btn btn--primary" data-action="backup-zip">${icon('download')}<span>Full backup (.zip)</span></button>
          <button type="button" class="btn" data-action="backup-json">${icon('file')}<span>inventory.json</span></button>
          <button type="button" class="btn" data-action="backup-csv">${icon('file')}<span>Spreadsheet (.csv)</span></button>
        </div>
        <p class="muted small">The ZIP contains inventory.json and all photos in the same layout as the data folder — unzipped, it can be used as a data folder again.</p>
      </section>
      <section class="card-section">
        <h2 class="section-title">Restore</h2>
        <div class="button-row">
          <button type="button" class="btn" data-action="restore-file">${icon('upload')}<span>From backup file…</span></button>
          <button type="button" class="btn" data-action="restore-folder">${icon('folder')}<span>From data folder…</span></button>
        </div>
        <p class="muted small">Replaces the current inventory with the backup (.zip or inventory.json). The current state is kept as a snapshot first.</p>
      </section>
      <section class="card-section">
        <div class="section-head">
          <div>
            <h2 class="section-title">Snapshots</h2>
            <p class="muted small">Automatic copy of inventory.json before the first change of each day (photos are not included).</p>
          </div>
          <button type="button" class="btn btn--sm" data-action="snapshot-create">${icon('plus')}<span>Snapshot now</span></button>
        </div>
        <div data-panel="snapshots"><p class="muted small">Loading…</p></div>
      </section>
      <section class="card-section">
        <h2 class="section-title">Maintenance</h2>
        <div data-panel="maintenance">
          <button type="button" class="btn btn--sm" data-action="find-unused-images">${icon('image')}<span>Find unused photos</span></button>
        </div>
      </section>`;
  }

  function snapshotLabel(name) {
    const match = /^inventory-(\d{4}-\d{2}-\d{2})(?:-(\d{2})(\d{2})(\d{2}))?(?:-([a-z-]+))?\.json$/.exec(name);
    if (!match) return name;
    const [, date, hh, mm, ss, reason] = match;
    const time = hh ? ` ${hh}:${mm}:${ss}` : '';
    const kind = reason ? reason.replace(/-/g, ' ') : 'daily';
    return `${date}${time} · ${kind}`;
  }

  function snapshotsHtml(snapshots) {
    if (!snapshots.length) return '<p class="muted small">No snapshots yet. The first one is made with the first change of the day.</p>';
    return `
      <ul class="item-list item-list--compact">
        ${snapshots.map((snap) => `
          <li class="item">
            <span class="item__icon">${icon('history')}</span>
            <div class="item__main">
              <div class="item__title">${esc(snapshotLabel(snap.name))}</div>
              <div class="item__sub muted small">${esc(U.formatBytes(snap.size))}</div>
            </div>
            <div class="item__actions">
              <button type="button" class="btn btn--icon btn--sm" data-action="snapshot-download" data-name="${esc(snap.name)}" title="Download" aria-label="Download snapshot">${icon('download')}</button>
              <button type="button" class="btn btn--sm" data-action="snapshot-restore" data-name="${esc(snap.name)}">Restore</button>
            </div>
          </li>`).join('')}
      </ul>`;
  }

  async function loadSnapshots(root = document) {
    const panel = root.querySelector('[data-panel="snapshots"]');
    if (!panel) return;
    try {
      panel.innerHTML = snapshotsHtml(await App.store.listSnapshots());
    } catch (err) {
      panel.innerHTML = `<p class="error-text small">${esc(err.message || err)}</p>`;
    }
  }

  async function restorePlan(plan) {
    const summary = App.backup.summarize(plan);
    const ok = await ui.confirm({
      title: 'Replace the inventory?',
      message: `The backup contains ${U.plural(summary.parts, 'part')} and ${U.plural(summary.images, 'photo')}. `
        + `It replaces the current ${U.plural(App.store.inv ? App.store.inv.parts.length : 0, 'part')}; the current state is kept as a snapshot.`
        + (summary.skipped ? ` ${summary.skipped} file(s) with unsupported names will be skipped.` : ''),
      confirmLabel: 'Restore',
      danger: true,
    });
    if (!ok) return;
    const progress = ui.progress('Restoring…');
    try {
      await App.backup.applyPlan(plan, (text) => progress.update(text));
      progress.close();
      ui.toast('Backup restored.');
      App.main.afterRestore();
    } catch (err) {
      progress.close();
      ui.errorToast(err, 'Restore failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering

  const RENDER = {
    general: generalHtml,
    locations: locationsHtml,
    categories: categoriesHtml,
    fields: fieldsHtml,
    data: dataHtml,
  };

  let lastTab = null;

  function render() {
    const inv = App.store.inv;
    const tab = RENDER[App.state.settingsTab] ? App.state.settingsTab : 'general';
    const main = ui.$('#main');
    const scroll = lastTab === tab ? window.scrollY : 0;
    lastTab = tab;
    ui.$('#sidebar').innerHTML = '';
    main.innerHTML = `
      <div class="settings">
        <header class="settings__header">
          <button type="button" class="btn btn--icon" data-action="close-settings" aria-label="Back">${icon('back')}</button>
          <h1 class="settings__title">Settings</h1>
        </header>
        <nav class="tabs" aria-label="Settings sections">
          ${TABS.map((item) => `
            <a class="tab${item.id === tab ? ' is-active' : ''}" href="#/settings/${item.id}" data-action="settings-tab" data-tab="${item.id}"
              ${item.id === tab ? 'aria-current="page"' : ''}>${item.label}</a>`).join('')}
        </nav>
        <div class="settings__body">${RENDER[tab](inv)}</div>
      </div>`;
    if (tab === 'data') loadSnapshots(main);
    if (tab === 'general') loadAgentsPanel(main);
    window.scrollTo(0, scroll);
  }

  function handleSubmit(event) {
    const form = event.target;
    if (form.dataset.form !== 'settings-title') return false;
    event.preventDefault();
    const title = String(new FormData(form).get('title') || '').trim() || S.DEFAULT_TITLE;
    App.store.updateSettings({ title }).then(() => ui.toast('Saved.', { timeout: 2000 })).catch((err) => ui.errorToast(err));
    return true;
  }

  async function run(task) {
    try {
      await task();
    } catch (err) {
      ui.errorToast(err);
    }
  }

  Object.assign(App.actions, {
    'open-settings'(el) {
      App.nav.go(`#/settings/${el.dataset.tab || App.state.settingsTab || 'general'}`);
    },
    'close-settings'() {
      App.nav.back('#/');
    },
    'settings-tab'(el) {
      App.nav.replace(`#/settings/${el.dataset.tab}`);
    },
    'set-theme'(el) {
      App.main.setTheme(el.dataset.theme);
      render();
    },
    async 'copy-value'(el) {
      const input = el.closest('.copy-row').querySelector('input');
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (err) {
        // The Clipboard API needs HTTPS; fall back to selecting the text.
        input.focus();
        input.select();
        if (!document.execCommand('copy')) {
          ui.toast('Press Ctrl+C / ⌘C to copy the selected text.');
          return;
        }
      }
      ui.toast('Copied.', { timeout: 1500 });
    },
    'location-new'() {
      run(() => locationDialog(null));
    },
    'location-edit'(el) {
      run(() => locationDialog(el.dataset.code));
    },
    'location-delete'(el) {
      run(() => deleteLocation(el.dataset.code));
    },
    'place-rename'(el) {
      run(() => placeDialog(el.dataset.place));
    },
    'location-show'(el) {
      App.state.category = null;
      const place = S.placeOf(App.store.inv, el.dataset.code); // the list must include this location
      App.state.places = place ? [place] : [];
      App.main.savePrefs();
      App.state.facets = { [App.filters.LOCATION]: new Set([el.dataset.code]) };
      App.main.setQuery('', { render: false });
      App.nav.go('#/');
    },
    'category-new'() {
      run(() => categoryDialog(null));
    },
    'category-edit'(el) {
      run(() => categoryDialog(el.dataset.id));
    },
    'category-delete'(el) {
      run(() => deleteCategory(el.dataset.id));
    },
    'category-up'(el) {
      run(() => App.store.moveCategory(el.dataset.id, -1));
    },
    'category-down'(el) {
      run(() => App.store.moveCategory(el.dataset.id, 1));
    },
    'field-new'() {
      run(() => fieldDialog(null));
    },
    'field-edit'(el) {
      run(() => fieldDialog(el.dataset.key));
    },
    'field-delete'(el) {
      run(() => deleteField(el.dataset.key));
    },
    async 'backup-zip'() {
      const progress = ui.progress('Preparing backup…');
      try {
        const result = await App.backup.downloadZip((text) => progress.update(text));
        ui.toast(`Backup downloaded (${U.formatBytes(result.size)}).`);
      } catch (err) {
        ui.errorToast(err, 'Backup failed');
      } finally {
        progress.close();
      }
    },
    'backup-json'() {
      App.backup.downloadJson();
    },
    'backup-csv'() {
      App.backup.downloadCsv();
    },
    async 'restore-file'() {
      const [file] = await U.pickFiles({ accept: '.zip,.json,application/zip,application/json' });
      if (!file) return;
      const progress = ui.progress('Reading backup…');
      let plan;
      try {
        plan = await App.backup.planFromFile(file);
      } catch (err) {
        ui.errorToast(err, 'Cannot use this file');
        return;
      } finally {
        progress.close();
      }
      await restorePlan(plan);
    },
    async 'restore-folder'() {
      const files = await U.pickFiles({ directory: true });
      if (!files.length) return;
      let plan;
      try {
        plan = await App.backup.planFromFolderFiles(files);
      } catch (err) {
        ui.errorToast(err, 'Cannot use this folder');
        return;
      }
      await restorePlan(plan);
    },
    async 'snapshot-create'() {
      try {
        const name = await App.store.createSnapshot('manual');
        ui.toast(`Snapshot ${snapshotLabel(name)} saved.`, { timeout: 2500 });
        loadSnapshots();
      } catch (err) {
        ui.errorToast(err, 'Snapshot failed');
      }
    },
    async 'snapshot-download'(el) {
      try {
        const blob = await App.store.fs.readBlob(`${App.store.SNAPSHOT_DIR}/${el.dataset.name}`);
        if (blob) U.downloadBlob(new Blob([blob], { type: 'application/json' }), el.dataset.name);
      } catch (err) {
        ui.errorToast(err);
      }
    },
    async 'snapshot-restore'(el) {
      const name = el.dataset.name;
      let snapshot;
      try {
        snapshot = await App.store.readSnapshot(name);
      } catch (err) {
        ui.errorToast(err, 'Cannot read snapshot');
        return;
      }
      const ok = await ui.confirm({
        title: `Restore snapshot ${snapshotLabel(name)}?`,
        message: `It contains ${U.plural(snapshot.parts.length, 'part')}. The current inventory.json is kept as a snapshot first.`,
        confirmLabel: 'Restore',
        danger: true,
      });
      if (!ok) return;
      try {
        await App.store.replaceInventory(snapshot, 'before-restore');
        ui.toast('Snapshot restored.');
        App.main.afterRestore();
      } catch (err) {
        ui.errorToast(err, 'Restore failed');
      }
    },
    async 'find-unused-images'() {
      const panel = document.querySelector('[data-panel="maintenance"]');
      try {
        const unused = await App.store.findUnusedImages();
        const size = unused.reduce((sum, file) => sum + file.size, 0);
        panel.innerHTML = unused.length
          ? `<p>${U.plural(unused.length, 'file')} (${esc(U.formatBytes(size))}) are not used by any part — e.g. photos of deleted parts.</p>
             <button type="button" class="btn btn--danger btn--sm" data-action="delete-unused-images">${icon('trash')}<span>Delete unused photos</span></button>`
          : '<p class="muted small">All photos are in use.</p>';
      } catch (err) {
        ui.errorToast(err);
      }
    },
    async 'delete-unused-images'() {
      const unused = await App.store.findUnusedImages();
      const ok = await ui.confirm({
        title: `Delete ${U.plural(unused.length, 'file')}?`,
        message: 'They cannot be restored afterwards (only from a full backup).',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      const deleted = await App.store.deleteFiles(unused.map((file) => file.path));
      ui.toast(`Deleted ${U.plural(deleted, 'file')}.`);
      App.actions['find-unused-images']();
    },
    async 'storage-change'() {
      const ok = await ui.confirm({
        title: 'Use a different storage?',
        message: 'The current data stays where it is. To take it along, download a full backup first and restore it in the new storage.',
        confirmLabel: 'Continue',
      });
      if (!ok) return;
      await App.storage.forgetLocal();
      App.main.showStart();
    },
  });

  App.settingsView = { render, handleSubmit, fieldDialog, snapshotsHtml, loadSnapshots };
})(window.App = window.App || {});
