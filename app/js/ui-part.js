/* Electronics Inventory — part detail sheet and the add / edit form. */
(function (App) {
  'use strict';

  const U = App.util;
  const S = App.schema;
  const ui = App.ui;
  const icon = App.icon;
  const esc = U.esc;

  const detailDialog = () => ui.$('#dlg-part');
  const editDialog = () => ui.$('#dlg-edit');

  let detailId = null;
  let edit = null; // { id, isNew, draft, dirty, busyImages, hash }
  let lastLocation = '';

  // ---------------------------------------------------------------------------
  // Detail

  function galleryHtml(part, category) {
    if (!part.images.length) return `<div class="gallery gallery--empty">${App.list.placeholder(category)}</div>`;
    return `
      <div class="gallery">
        <button type="button" class="gallery__main" data-action="view-image" data-index="0" aria-label="Enlarge photo">
          ${ui.imageTag(part.images[0], { thumb: false, alt: part.name })}
        </button>
        ${part.images.length > 1 ? `
          <div class="gallery__thumbs">
            ${part.images.map((image, i) => `
              <button type="button" class="gallery__thumb" data-action="view-image" data-index="${i}" aria-label="Photo ${i + 1}">
                ${ui.imageTag(image)}
              </button>`).join('')}
          </div>` : ''}
      </div>`;
  }

  function stockHtml(inv, part) {
    if (!part.stock.length) return '<p class="muted">Not stored anywhere yet. Edit the part to add a location.</p>';
    const summary = S.stockSummary(part);
    const rows = part.stock.map((row) => {
      const location = S.locationByCode(inv, row.location);
      const name = location && location.name !== location.code ? location.name : '';
      const place = location ? location.place : '';
      const qty = row.qty;
      return `
        <li class="stock__row">
          <span class="stock__loc">
            ${App.list.locationDot(inv, row.location)}
            <strong>${esc(row.location || 'Unassigned')}</strong>
            ${name ? `<span class="muted">${esc(name)}</span>` : ''}
            ${place ? `<span class="stock__place">${icon('pin')}${esc(place)}</span>` : ''}
          </span>
          <span class="stepper">
            <button type="button" class="btn btn--icon btn--sm" data-action="qty" data-loc="${esc(row.location || '')}" data-delta="-1"
              aria-label="Take one out"${qty === null || qty <= 0 ? ' disabled' : ''}>${icon('minus')}</button>
            <span class="stepper__value"${qty === null ? ' title="Amount unknown"' : ''}>${qty === null ? '?' : esc(qty)}</span>
            <button type="button" class="btn btn--icon btn--sm" data-action="qty" data-loc="${esc(row.location || '')}" data-delta="1"
              aria-label="Add one"${qty === null ? ' disabled' : ''}>${icon('plus')}</button>
          </span>
        </li>`;
    }).join('');
    return `
      <ul class="stock">${rows}</ul>
      ${part.stock.length > 1 ? `<p class="stock__total">Total <strong>${esc(S.quantityText(summary))}</strong></p>` : ''}`;
  }

  /** Pieces built into projects, with buttons to return them or change the record. */
  function usesHtml(part) {
    if (!part.uses.length) return '';
    return `
      <section class="panel">
        <h3 class="panel__title">In use</h3>
        <ul class="uses">
          ${part.uses.map((use) => `
            <li class="use">
              <span class="use__qty"${use.qty === null ? ' title="Amount unknown"' : ''}>${esc(use.qty === null ? '?' : use.qty)}×</span>
              <div class="use__main">
                <button type="button" class="link-btn use__project" data-action="project-show" data-project="${esc(use.project)}"
                  title="Show all parts in this project">${esc(use.project)}</button>
                ${use.note ? `<span class="use__note">${U.linkify(use.note)}</span>` : ''}
              </div>
              <div class="use__actions">
                <button type="button" class="btn btn--sm" data-action="use-return" data-project="${esc(use.project)}">Return</button>
                <button type="button" class="btn btn--icon btn--sm" data-action="use-edit" data-project="${esc(use.project)}"
                  title="Edit" aria-label="Edit the use in ${esc(use.project)}">${icon('edit')}</button>
              </div>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  /** "A1 · Blue box (2 pcs)" for choosing a stock row. */
  function stockOptionLabel(inv, row) {
    const location = S.locationByCode(inv, row.location);
    const name = location && location.name !== location.code ? ` · ${location.name}` : '';
    const amount = row.qty === null ? 'amount unknown' : `${row.qty} ${row.qty === 1 ? 'pc' : 'pcs'}`;
    return `${row.location || 'Unassigned'}${name} (${amount})`;
  }

  /** Puts pieces of a part into a project; they leave the stock row chosen in "Taken from". */
  function useDialog(part) {
    const inv = App.store.inv;
    const available = part.stock.find((row) => row.qty === null || row.qty > 0);
    const body = `
      <div class="form-grid">
        <div class="field field--full">
          <label class="field__label" for="use-project">Project <em class="req">*</em></label>
          <input type="text" id="use-project" name="project" maxlength="80" list="dl-projects" autocomplete="off" required
            placeholder="e.g. Weather station">
          ${datalist('dl-projects', S.projects(inv))}
        </div>
        <div class="field">
          <label class="field__label" for="use-qty">Pieces <em class="req">*</em></label>
          <input type="text" id="use-qty" name="qty" value="1" inputmode="decimal" autocomplete="off" required>
        </div>
        ${part.stock.length ? `
          <div class="field">
            <label class="field__label" for="use-from">Taken from</label>
            <select id="use-from" name="from">
              ${part.stock.map((row) => `<option value="loc:${esc(row.location || '')}"${row === available ? ' selected' : ''}${row.qty === 0 ? ' disabled' : ''}>
                ${esc(stockOptionLabel(inv, row))}</option>`).join('')}
              <option value="none"${available ? '' : ' selected'}>Not from stock</option>
            </select>
          </div>` : ''}
        <div class="field field--full">
          <label class="field__label" for="use-note">Note</label>
          <input type="text" id="use-note" name="note" maxlength="200" autocomplete="off"
            placeholder="Where or how, e.g. sensor on GPIO 4">
        </div>
      </div>
      <p class="field__hint">The pieces leave the stock and are listed under “In use” until you return them.</p>`;
    return ui.formDialog({
      title: `Use ${part.name}`,
      body,
      submitLabel: 'Use in project',
      async onSubmit(data) {
        if (!S.normalizeProject(data.get('project'))) throw new Error('Please enter a project.');
        const qty = U.parseQty(String(data.get('qty') || ''));
        if (!qty) throw new Error('Please enter how many pieces are used.');
        const from = String(data.get('from') || 'none');
        const project = await App.store.useInProject(part.id, {
          project: data.get('project'),
          qty,
          note: data.get('note'),
          takeFrom: from.startsWith('loc:'),
          location: from.startsWith('loc:') ? from.slice(4) || null : null,
        });
        ui.toast(`${U.plural(qty, 'piece')} in use in ${project}.`, { timeout: 3000 });
        return project;
      },
    });
  }

  /** Takes pieces out of a project and puts them back into a location. */
  function returnDialog(part, use) {
    const inv = App.store.inv;
    const own = part.stock.map((row) => row.location || '');
    const others = inv.locations.filter((loc) => !own.some((code) => code.toLowerCase() === loc.code.toLowerCase()));
    const selected = own.length ? own[0] : defaultLocation(inv);
    const option = (code, label) => `<option value="loc:${esc(code)}"${code.toLowerCase() === selected.toLowerCase() ? ' selected' : ''}>${esc(label)}</option>`;
    const body = `
      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="ret-qty">Pieces</label>
          <input type="text" id="ret-qty" name="qty" value="${esc(use.qty === null ? '' : use.qty)}" inputmode="decimal"
            autocomplete="off" placeholder="All">
        </div>
        <div class="field">
          <label class="field__label" for="ret-to">Put back in</label>
          <select id="ret-to" name="to">
            ${part.stock.map((row) => option(row.location || '', stockOptionLabel(inv, row))).join('')}
            ${others.length ? `<optgroup label="${part.stock.length ? 'Other locations' : 'Locations'}">
              ${others.map((loc) => option(loc.code, loc.name !== loc.code ? `${loc.code} · ${loc.name}` : loc.code)).join('')}
            </optgroup>` : ''}
            ${own.includes('') ? '' : option('', 'Unassigned')}
          </select>
        </div>
      </div>
      <p class="field__hint">${use.qty === null ? 'The amount in use is unknown; leave Pieces empty to return all of them.'
        : `${U.plural(use.qty, 'piece')} in use in ${esc(use.project)}.`}</p>`;
    return ui.formDialog({
      title: `Return from ${use.project}`,
      body,
      submitLabel: 'Return',
      async onSubmit(data) {
        const qtyText = String(data.get('qty') || '').trim();
        if (qtyText && !U.parseQty(qtyText)) throw new Error(`“${qtyText}” is not a valid amount.`);
        const location = String(data.get('to') || 'loc:').slice(4) || null;
        const amount = await App.store.returnFromProject(part.id, { project: use.project, qty: qtyText || null, putBack: true, location });
        ui.toast(`${amount === null ? 'Pieces' : U.plural(amount, 'piece')} back in ${location || 'Unassigned'}.`, { timeout: 3000 });
      },
    });
  }

  /** Corrects a use (project, amount, note) without touching the stock, or removes it. */
  function editUseDialog(part, use) {
    const inv = App.store.inv;
    const body = `
      <div class="form-grid">
        <div class="field field--full">
          <label class="field__label" for="use-project">Project <em class="req">*</em></label>
          <input type="text" id="use-project" name="project" value="${esc(use.project)}" maxlength="80" list="dl-projects"
            autocomplete="off" required>
          ${datalist('dl-projects', S.projects(inv))}
        </div>
        <div class="field">
          <label class="field__label" for="use-qty">Pieces</label>
          <input type="text" id="use-qty" name="qty" value="${esc(use.qty === null ? '' : use.qty)}" inputmode="decimal"
            autocomplete="off" placeholder="?">
        </div>
        <div class="field field--full">
          <label class="field__label" for="use-note">Note</label>
          <input type="text" id="use-note" name="note" value="${esc(use.note)}" maxlength="200" autocomplete="off"
            placeholder="Where or how it is used">
        </div>
      </div>
      <p class="field__hint">This corrects the record only; the stock does not change. To put pieces back in a box, use Return.</p>
      <input type="hidden" name="intent" value="save">
      <button type="button" class="link-btn link-btn--danger use-remove" data-remove>Remove from this project…</button>`;
    return ui.formDialog({
      title: `In use in ${use.project}`,
      body,
      submitLabel: 'Save',
      onRender(form) {
        form.querySelector('[data-remove]').addEventListener('click', () => {
          form.elements.namedItem('intent').value = 'remove';
          form.requestSubmit();
        });
      },
      async onSubmit(data, form) {
        if (data.get('intent') === 'remove') {
          form.elements.namedItem('intent').value = 'save';
          const ok = await ui.confirm({
            title: `Remove ${part.name} from ${use.project}?`,
            message: 'Do this when it is used up, broken or given away. The stock does not change.',
            confirmLabel: 'Remove',
            danger: true,
          });
          if (!ok) return false;
          await App.store.saveUse(part.id, use.project, null);
          ui.toast(`Removed from ${use.project}.`, { timeout: 3000 });
          return true;
        }
        if (!S.normalizeProject(data.get('project'))) throw new Error('Please enter a project.');
        await App.store.saveUse(part.id, use.project, { project: data.get('project'), qty: data.get('qty'), note: data.get('note') });
        return true;
      },
    });
  }

  function specsHtml(inv, part) {
    const fields = S.fieldMap(inv);
    const keys = S.specKeysFor(inv, part);
    if (!keys.length) return '';
    return `<dl class="specs">${keys.map((key) => {
      const def = S.fieldDef(fields, key);
      const value = part.specs[key];
      let html;
      if (value === true) html = `<span class="yes">${icon('check')}Yes</span>`;
      else if (value === false) html = '<span class="muted">No</span>';
      else if (Array.isArray(value)) html = value.map((item) => `<span class="pill">${esc(item)}</span>`).join(' ');
      else html = U.linkify(S.specText(def, value));
      return `<div class="specs__row"><dt>${esc(def.label)}</dt><dd>${html}</dd></div>`;
    }).join('')}</dl>`;
  }

  function renderDetail() {
    const dialog = detailDialog();
    const inv = App.store.inv;
    const part = App.store.partById(detailId);
    if (!part) {
      dialog.innerHTML = `
        <header class="sheet__header">
          <button type="button" class="btn btn--icon" data-action="close-part" aria-label="Close">${icon('back')}</button>
          <h2 class="sheet__title" id="part-title">Part not found</h2>
        </header>
        <div class="sheet__body"><div class="empty"><p class="muted">This part does not exist (any more).</p></div></div>`;
      return;
    }
    const oldBody = dialog.querySelector('.sheet__body');
    const scroll = oldBody && dialog.dataset.partId === part.id ? oldBody.scrollTop : 0;
    const category = S.categoryById(inv, part.category);
    const specs = specsHtml(inv, part);
    dialog.dataset.partId = part.id;
    dialog.innerHTML = `
      <header class="sheet__header">
        <button type="button" class="btn btn--icon" data-action="close-part" aria-label="Close">${icon('back')}</button>
        <h2 class="sheet__title" id="part-title">${esc(part.name)}</h2>
        <div class="sheet__actions">
          <button type="button" class="btn btn--icon" data-action="duplicate-part" title="Duplicate" aria-label="Duplicate">${icon('copy')}</button>
          <button type="button" class="btn btn--icon" data-action="delete-part" title="Delete" aria-label="Delete">${icon('trash')}</button>
          <button type="button" class="btn btn--primary btn--sm" data-action="edit-part">${icon('edit')}<span>Edit</span></button>
        </div>
      </header>
      <div class="sheet__body">
        <article class="detail">
          ${galleryHtml(part, category)}
          <div class="detail__head">
            ${App.list.numbersHtml(part, 'id-pill')}
            <button type="button" class="cat-pill" data-action="category-from-detail" data-id="${esc(part.category)}">
              ${icon(category ? category.icon : 'shapes')}<span>${esc(category ? category.name : part.category)}</span>
            </button>
            ${part.tags.map((tag) => `<span class="tag">${icon('tag')}${esc(tag)}</span>`).join('')}
          </div>
          ${part.description ? `<p class="detail__desc">${U.linkify(part.description)}</p>` : ''}
          <section class="panel">
            <div class="panel__head">
              <h3 class="panel__title">Stock</h3>
              <button type="button" class="btn btn--sm" data-action="use-part">${icon('wrench')}<span>Use in project</span></button>
            </div>
            ${stockHtml(inv, part)}
          </section>
          ${usesHtml(part)}
          ${specs ? `<section class="panel"><h3 class="panel__title">Properties</h3>${specs}</section>` : ''}
          ${part.notes ? `<section class="panel"><h3 class="panel__title">Notes</h3><div class="notes">${U.linkify(part.notes)}</div></section>` : ''}
          ${part.links.length ? `
            <section class="panel">
              <h3 class="panel__title">Links</h3>
              <ul class="links">
                ${part.links.map((link) => `
                  <li><a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">
                    ${icon('external')}<span class="links__label">${esc(link.label)}</span><span class="muted small">${esc(U.hostname(link.url))}</span>
                  </a></li>`).join('')}
              </ul>
            </section>` : ''}
          <p class="detail__meta muted small">
            ID <code>${esc(part.id)}</code> · Added ${esc(U.formatDateTime(part.createdAt))} · Changed ${esc(U.formatDateTime(part.updatedAt))}
          </p>
        </article>
      </div>`;
    dialog.querySelector('.sheet__body').scrollTop = scroll;
    ui.hydrateImages(dialog);
  }

  function openDetail(id) {
    const changed = detailId !== id;
    detailId = id;
    if (changed || !detailDialog().open) renderDetail();
    ui.openSheet(detailDialog());
  }

  function closeDetail() {
    detailId = null;
    ui.closeSheet(detailDialog());
  }

  function refresh() {
    if (detailId && detailDialog().open) renderDetail();
  }

  // ---------------------------------------------------------------------------
  // Editor: draft handling

  /** The places chosen in the list ([] = all places). */
  function currentPlaces(inv) {
    return App.filters.activePlaces(inv, App.state.places);
  }

  /** Location offered for a new part: the last one used, or the first one of the first chosen place. */
  function defaultLocation(inv) {
    const places = currentPlaces(inv);
    if (!places.length || places.includes(S.placeOf(inv, lastLocation))) return lastLocation;
    const first = inv.locations.find((loc) => loc.place === places[0]);
    return first ? first.code : '';
  }

  function emptyDraft(categoryId) {
    return {
      name: '',
      category: categoryId,
      description: '',
      notes: '',
      tagsText: '',
      numbersText: '',
      stock: [{ location: defaultLocation(App.store.inv), qty: '1' }],
      uses: [],
      specs: {},
      images: [],
      links: [],
    };
  }

  function draftFromPart(part) {
    return {
      name: part.name,
      category: part.category,
      description: part.description,
      notes: part.notes,
      tagsText: part.tags.join(', '),
      numbersText: part.numbers.join(', '),
      stock: part.stock.map((row) => ({ location: row.location || '', qty: row.qty === null ? '' : String(row.qty) })),
      uses: part.uses.map((use) => ({ ...use })), // changed on the part page, kept as they are here
      specs: structuredClone(part.specs),
      images: part.images.map((image) => ({ ...image })),
      links: part.links.map((link) => ({ ...link })),
    };
  }

  function valuesUsed(inv, key) {
    const values = new Set();
    for (const part of inv.parts) {
      const value = part.specs[key];
      if (Array.isArray(value)) value.forEach((item) => values.add(String(item)));
      else if (value !== undefined && typeof value !== 'boolean') values.add(String(value));
    }
    return [...values].sort(U.collator.compare);
  }

  function multiChoices(inv, def) {
    return [...new Set([...(def.options || []), ...valuesUsed(inv, def.key)])];
  }

  function buildSpecs(inv, specs) {
    const fields = S.fieldMap(inv);
    const out = {};
    for (const [key, raw] of Object.entries(specs)) {
      const def = S.fieldDef(fields, key);
      if (def.type === 'bool') {
        if (raw === true) out[key] = true;
      } else if (def.type === 'multi') {
        const list = Array.isArray(raw) ? raw.map((item) => String(item).trim()).filter(Boolean) : U.splitList(raw);
        if (list.length) out[key] = [...new Set(list)];
      } else if (def.type === 'number') {
        const text = String(raw ?? '').trim();
        if (!text) continue;
        const n = Number(text.replace(',', '.'));
        out[key] = Number.isFinite(n) ? n : text;
      } else {
        const text = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'boolean' ? (raw ? 'Yes' : '') : String(raw ?? '').trim();
        if (text) out[key] = text;
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Editor: rendering

  function datalist(id, values) {
    return `<datalist id="${esc(id)}">${values.map((value) => `<option value="${esc(value)}"></option>`).join('')}</datalist>`;
  }

  function controlHtml(inv, def, value, removable) {
    const key = def.key;
    const id = `spec-${key}`;
    const remove = removable
      ? `<button type="button" class="btn btn--icon btn--xs" data-action="edit-remove-spec" data-key="${esc(key)}" aria-label="Remove ${esc(def.label)}">${icon('x')}</button>`
      : '';
    const unit = def.unit ? ` <span class="muted">(${esc(def.unit)})</span>` : '';
    const top = `<div class="field__top"><label class="field__label" for="${esc(id)}">${esc(def.label)}${unit}</label>${remove}</div>`;

    if (def.type === 'bool') {
      return `
        <div class="field field--switch">
          <label class="switch-label" for="${esc(id)}">
            <input type="checkbox" class="switch" id="${esc(id)}" data-bind="spec:${esc(key)}" data-kind="bool"${value === true ? ' checked' : ''}>
            <span>${esc(def.label)}</span>
          </label>
          ${remove}
        </div>`;
    }
    if (def.type === 'multi') {
      const selected = Array.isArray(value) ? value.map(String) : value ? U.splitList(value) : [];
      const choices = multiChoices(inv, def);
      const extras = selected.filter((item) => !choices.includes(item));
      return `
        <div class="field field--full">
          ${top}
          <div class="pills" role="group" aria-label="${esc(def.label)}">
            ${choices.map((choice) => {
              const on = selected.includes(choice);
              return `<button type="button" class="pill-toggle${on ? ' is-on' : ''}" data-action="edit-toggle-multi" data-key="${esc(key)}"
                data-value="${esc(choice)}" aria-pressed="${on}">${esc(choice)}</button>`;
            }).join('')}
          </div>
          <input type="text" id="${esc(id)}" data-bind="multi:${esc(key)}" value="${esc(extras.join(', '))}"
            placeholder="Other values, comma separated" autocomplete="off">
        </div>`;
    }
    const listId = `dl-${id}`;
    const suggestions = [...new Set([...(def.options || []), ...valuesUsed(inv, key)])];
    const text = Array.isArray(value) ? value.join(', ') : value === undefined || value === null ? '' : String(value);
    return `
      <div class="field">
        ${top}
        <input type="text" id="${esc(id)}" data-bind="spec:${esc(key)}" value="${esc(text)}" autocomplete="off"
          ${def.type === 'number' ? 'inputmode="decimal"' : ''} ${suggestions.length ? `list="${esc(listId)}"` : ''}>
        ${suggestions.length ? datalist(listId, suggestions) : ''}
      </div>`;
  }

  function specsEditorHtml(inv, draft) {
    const fields = S.fieldMap(inv);
    const category = S.categoryById(inv, draft.category);
    const keys = category ? [...category.fields] : [];
    const extra = Object.keys(draft.specs).filter((key) => !keys.includes(key));
    const controls = [
      ...keys.map((key) => controlHtml(inv, S.fieldDef(fields, key), draft.specs[key], false)),
      ...extra.map((key) => controlHtml(inv, S.fieldDef(fields, key), draft.specs[key], true)),
    ].join('');
    const addable = inv.fields.filter((field) => !keys.includes(field.key) && !extra.includes(field.key));
    return `
      <div class="spec-grid">${controls || '<p class="muted small">This category has no properties yet. Add one below.</p>'}</div>
      <div class="spec-add">
        <select data-change="edit-add-spec" aria-label="Add a property">
          <option value="">Add property…</option>
          ${addable.map((field) => `<option value="${esc(field.key)}">${esc(field.label)}</option>`).join('')}
          <option value="__new__">New property…</option>
        </select>
      </div>`;
  }

  function imagesEditorHtml(draft) {
    return `
      <div class="img-edit">
        ${draft.images.map((image, i) => `
          <div class="img-tile">
            ${image.pending ? `<img src="${esc(image.preview)}" alt="">` : ui.imageTag(image)}
            ${i === 0 ? '<span class="img-tile__badge">Cover</span>' : ''}
            <div class="img-tile__actions">
              ${i > 0 ? `<button type="button" class="img-tile__btn" data-action="edit-image-cover" data-index="${i}" title="Use as cover" aria-label="Use as cover">${icon('arrowLeft')}</button>` : ''}
              <button type="button" class="img-tile__btn" data-action="edit-image-remove" data-index="${i}" title="Remove" aria-label="Remove photo">${icon('x')}</button>
            </div>
          </div>`).join('')}
        ${edit.busyImages ? '<div class="img-tile img-tile--busy"><span class="spinner"></span></div>' : ''}
        <button type="button" class="img-add" data-action="edit-add-images">${icon('camera')}<span>Add photos</span></button>
      </div>
      <p class="muted small">You can also drop images here or paste them. Large photos are scaled down automatically.</p>`;
  }

  /** Locations for the stock suggestions: those of the chosen places first. */
  function locationOptions(inv) {
    const places = currentPlaces(inv);
    if (!places.length) return inv.locations;
    const chosen = (loc) => places.includes(loc.place);
    return [...inv.locations.filter(chosen), ...inv.locations.filter((loc) => !chosen(loc))];
  }

  function stockEditorHtml(draft) {
    return `
      <div class="stock-edit">
        ${draft.stock.length ? '<div class="stock-edit__head"><span>Location</span><span>Amount</span></div>' : ''}
        ${draft.stock.map((row, i) => `
          <div class="stock-edit__row">
            <input type="text" list="dl-locations" data-bind="stock:${i}:location" value="${esc(row.location)}"
              placeholder="Box code" aria-label="Location" autocomplete="off" autocapitalize="characters" spellcheck="false">
            <input type="text" inputmode="decimal" data-bind="stock:${i}:qty" value="${esc(row.qty)}" placeholder="?"
              aria-label="Amount" autocomplete="off">
            <button type="button" class="btn btn--icon" data-action="edit-remove-stock" data-index="${i}" aria-label="Remove location">${icon('trash')}</button>
          </div>`).join('')}
        <button type="button" class="btn btn--sm" data-action="edit-add-stock">${icon('plus')}<span>Add location</span></button>
      </div>`;
  }

  function linksEditorHtml(draft) {
    return `
      <div class="links-edit">
        ${draft.links.map((link, i) => `
          <div class="links-edit__row">
            <input type="text" data-bind="link:${i}:label" value="${esc(link.label)}" placeholder="Label, e.g. Datasheet" aria-label="Link label" autocomplete="off">
            <input type="url" data-bind="link:${i}:url" value="${esc(link.url)}" placeholder="https://…" aria-label="Link address" inputmode="url" autocomplete="off">
            <button type="button" class="btn btn--icon" data-action="edit-remove-link" data-index="${i}" aria-label="Remove link">${icon('trash')}</button>
          </div>`).join('')}
        <button type="button" class="btn btn--sm" data-action="edit-add-link">${icon('plus')}<span>Add link</span></button>
      </div>`;
  }

  function renderEdit() {
    if (!edit) return;
    const dialog = editDialog();
    const inv = App.store.inv;
    const draft = edit.draft;
    const nextNumbers = S.nextNumbers(inv, draft.category);
    const oldBody = dialog.querySelector('.sheet__body');
    const scroll = oldBody ? oldBody.scrollTop : 0;
    const active = document.activeElement && dialog.contains(document.activeElement) ? document.activeElement.dataset.bind : null;

    dialog.innerHTML = `
      <form class="sheet__form editor" novalidate>
        <header class="sheet__header">
          <button type="button" class="btn btn--icon" data-action="edit-cancel" aria-label="Close">${icon('x')}</button>
          <h2 class="sheet__title" id="edit-title">${edit.isNew ? 'New part' : `Edit ${esc(draft.name || 'part')}`}</h2>
        </header>
        <div class="sheet__body">
          <div class="form-grid">
            <div class="field field--full">
              <label class="field__label" for="edit-name">Name <em class="req">*</em></label>
              <input type="text" id="edit-name" data-bind="name" value="${esc(draft.name)}" maxlength="200" autocomplete="off"
                placeholder="e.g. ESP32-C6-DevKitC-1" required>
            </div>
            <div class="field">
              <label class="field__label" for="edit-numbers">ID number</label>
              <input type="text" id="edit-numbers" data-bind="numbersText" value="${esc(draft.numbersText)}" maxlength="80"
                placeholder="${esc(`e.g. ${nextNumbers[0] || '57'}`)}" autocomplete="off" spellcheck="false">
              <p class="field__hint">Written on the part’s bag or label${nextNumbers.length ? `. Next free: ${nextNumbers.map((number) => `
                <button type="button" class="link-btn" data-action="edit-use-number" data-number="${esc(number)}">${esc(number)}</button>`).join(',')}` : ''}</p>
            </div>
            <div class="field">
              <label class="field__label" for="edit-category">Category</label>
              <select id="edit-category" data-bind="category">
                ${inv.categories.map((cat) => `<option value="${esc(cat.id)}"${cat.id === draft.category ? ' selected' : ''}>${esc(cat.name)}</option>`).join('')}
              </select>
            </div>
            <div class="field field--full">
              <label class="field__label" for="edit-tags">Tags</label>
              <input type="text" id="edit-tags" data-bind="tagsText" value="${esc(draft.tagsText)}" placeholder="Comma separated" autocomplete="off">
            </div>
            <div class="field field--full">
              <label class="field__label" for="edit-description">Short description</label>
              <textarea id="edit-description" data-bind="description" rows="2" placeholder="What it is, in a sentence or two">${esc(draft.description)}</textarea>
            </div>
          </div>
          <section class="form-section">
            <h3 class="form-section__title">Photos</h3>
            ${imagesEditorHtml(draft)}
          </section>
          <section class="form-section">
            <div class="form-section__head">
              <h3 class="form-section__title">Stock</h3>
              <span class="muted small">Leave the amount empty when unknown.</span>
            </div>
            ${stockEditorHtml(draft)}
            ${draft.uses.length ? `
              <p class="edit-uses muted small">${icon('wrench')}<span>Also in use, not counted here:
                ${esc(draft.uses.map((use) => `${use.qty === null ? '?' : use.qty} × ${use.project}`).join(', '))}.
                Return or change it on the part page.</span></p>` : ''}
          </section>
          <section class="form-section">
            <h3 class="form-section__title">Properties</h3>
            ${specsEditorHtml(inv, draft)}
          </section>
          <section class="form-section">
            <h3 class="form-section__title">Links</h3>
            ${linksEditorHtml(draft)}
          </section>
          <section class="form-section">
            <h3 class="form-section__title"><label for="edit-notes">Notes</label></h3>
            <textarea id="edit-notes" data-bind="notes" rows="5" placeholder="Pinout, purchase details…">${esc(draft.notes)}</textarea>
          </section>
          <p class="form-error" role="alert" hidden></p>
        </div>
        <footer class="sheet__footer">
          <button type="button" class="btn" data-action="edit-cancel">Cancel</button>
          <button type="submit" class="btn btn--primary"${edit.saving ? ' disabled' : ''}>${edit.saving ? 'Saving…' : edit.isNew ? 'Add part' : 'Save changes'}</button>
        </footer>
      </form>
      <datalist id="dl-locations">
        ${locationOptions(inv).map((loc) => `<option value="${esc(loc.code)}">${esc(loc.place ? `${loc.name} · ${loc.place}` : loc.name)}</option>`).join('')}
      </datalist>`;

    dialog.querySelector('.sheet__body').scrollTop = scroll;
    if (active) {
      const el = dialog.querySelector(`[data-bind="${CSS.escape(active)}"]`);
      if (el) el.focus();
    }
    ui.hydrateImages(dialog);
  }

  // ---------------------------------------------------------------------------
  // Editor: lifecycle

  function openEdit(id, { category = null, from = null, hash = '' } = {}) {
    const inv = App.store.inv;
    if (edit && edit.hash === hash) {
      ui.openSheet(editDialog());
      return;
    }
    let draft;
    if (id) {
      const part = App.store.partById(id);
      if (!part) {
        ui.toast('This part does not exist (any more).', { kind: 'error' });
        App.nav.replace('#/');
        return;
      }
      draft = draftFromPart(part);
    } else if (from && App.store.partById(from)) {
      draft = draftFromPart(App.store.partById(from));
      draft.name = `${draft.name} (copy)`;
      draft.numbersText = ''; // an ID number belongs to one part
      draft.uses = []; // the copy is another piece, not built into those projects
    } else {
      const fallback = App.state.category || (S.categoryById(inv, 'dev-boards') ? 'dev-boards' : inv.categories[0].id);
      draft = emptyDraft(category && S.categoryById(inv, category) ? category : fallback);
    }
    edit = { id, isNew: !id, draft, dirty: false, busyImages: 0, saving: false, hash };
    renderEdit();
    ui.openSheet(editDialog());
    if (!id && window.matchMedia('(pointer: fine)').matches) editDialog().querySelector('#edit-name').focus();
  }

  function closeEdit() {
    if (edit) {
      for (const image of edit.draft.images) if (image.pending && image.preview) URL.revokeObjectURL(image.preview);
    }
    edit = null;
    ui.closeSheet(editDialog());
  }

  function fallbackHash(session) {
    return session && session.id ? `#/part/${encodeURIComponent(session.id)}` : '#/';
  }

  async function requestCloseEdit() {
    if (!edit) {
      App.nav.back('#/');
      return;
    }
    const session = edit;
    if (session.dirty) {
      const ok = await ui.confirm({
        title: 'Discard changes?',
        message: 'Your changes to this part have not been saved.',
        confirmLabel: 'Discard',
        danger: true,
      });
      if (!ok || edit !== session) return;
    }
    closeEdit();
    App.nav.back(fallbackHash(session));
  }

  async function addImageFiles(files) {
    const session = edit;
    if (!session) return;
    const images = files.filter((file) => file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name));
    if (!images.length) {
      if (files.length) ui.toast('Only image files can be added.', { kind: 'error' });
      return;
    }
    session.busyImages += images.length;
    renderEdit();
    for (const file of images) {
      try {
        const prepared = await App.images.prepare(file);
        if (edit !== session) return;
        session.draft.images.push({ pending: true, prepared, preview: URL.createObjectURL(prepared.thumb.blob) });
        session.dirty = true;
      } catch (err) {
        ui.errorToast(err);
      } finally {
        if (edit === session) {
          session.busyImages -= 1;
          renderEdit();
        }
      }
    }
  }

  function showError(message, selector) {
    const dialog = editDialog();
    const el = dialog.querySelector('.form-error');
    el.textContent = message;
    el.hidden = false;
    const target = selector ? dialog.querySelector(selector) : el;
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (selector) target.focus({ preventScroll: true });
    }
  }

  async function save() {
    const session = edit;
    if (!session || session.saving) return;
    const inv = App.store.inv;
    const draft = session.draft;
    editDialog().querySelector('.form-error').hidden = true;

    const name = draft.name.trim();
    if (!name) {
      showError('Please enter a name.', '[data-bind="name"]');
      return;
    }
    const numbers = S.normalizeNumbers(draft.numbersText);
    for (const number of numbers) {
      const other = S.partByNumber(inv, number, session.isNew ? null : session.id);
      if (other) {
        showError(`ID number ${S.numberLabel(number)} is already used by “${other.name}”.`, '[data-bind="numbersText"]');
        return;
      }
    }
    if (session.busyImages) {
      showError('Please wait until the photos are processed.');
      return;
    }
    const stock = [];
    for (const [i, row] of draft.stock.entries()) {
      const location = S.normalizeLocationCode(row.location);
      const qtyText = String(row.qty ?? '').trim();
      if (!location && !qtyText) continue;
      const qty = U.parseQty(qtyText);
      if (qtyText && qtyText !== '?' && qty === null) {
        showError(`“${qtyText}” is not a valid amount.`, `[data-bind="stock:${i}:qty"]`);
        return;
      }
      stock.push({ location: location || null, qty });
    }
    const links = [];
    for (const [i, link] of draft.links.entries()) {
      const text = link.url.trim();
      if (!text && !link.label.trim()) continue;
      const url = U.safeUrl(text);
      if (!url) {
        showError(`“${text}” is not a valid http(s) link.`, `[data-bind="link:${i}:url"]`);
        return;
      }
      links.push({ label: link.label.trim(), url });
    }
    const knownLocations = new Set(inv.locations.map((loc) => loc.code.toLowerCase()));
    const newLocations = [...new Set(stock.map((row) => row.location).filter((code) => code && !knownLocations.has(code.toLowerCase())))];
    // New box codes typed here belong to the place the user is working in (the first one chosen).
    const place = currentPlaces(inv)[0] || '';

    session.saving = true;
    renderEdit();
    try {
      for (let i = 0; i < draft.images.length; i++) {
        const image = draft.images[i];
        if (!image.pending) continue;
        const saved = await App.store.saveImage(image.prepared, name);
        URL.revokeObjectURL(image.preview);
        draft.images[i] = saved;
      }
      const data = {
        name,
        numbers,
        category: draft.category,
        description: draft.description,
        tags: draft.tagsText,
        stock,
        uses: draft.uses,
        specs: buildSpecs(App.store.inv, draft.specs),
        images: draft.images.map((image) => (image.thumb ? { src: image.src, thumb: image.thumb } : { src: image.src })),
        links,
        notes: draft.notes,
      };
      const id = session.isNew
        ? await App.store.addPart(data, { place })
        : await App.store.updatePart(session.id, data, { place });
      const lastRow = stock.filter((row) => row.location).pop();
      if (lastRow) lastLocation = lastRow.location;
      closeEdit();
      if (session.isNew) App.nav.replace(`#/part/${encodeURIComponent(id)}`);
      else App.nav.back(`#/part/${encodeURIComponent(id)}`);
      ui.toast(session.isNew ? 'Part added.' : 'Changes saved.', { timeout: 2500 });
      if (newLocations.length) {
        ui.toast(`New location ${newLocations.map((code) => `“${code}”`).join(', ')} added${place ? ` to ${place}` : ''}. Name it in Settings → Locations.`, {
          action: 'Open',
          onAction: () => App.nav.go('#/settings/locations'),
          timeout: 7000,
        });
      }
    } catch (err) {
      if (edit === session) {
        session.saving = false;
        renderEdit();
        showError(err && err.message ? err.message : String(err));
      }
      console.error(err);
    }
  }

  // ---------------------------------------------------------------------------
  // Editor: events

  function onEditInput(event) {
    if (!edit) return;
    const el = event.target;
    const bind = el.dataset.bind;
    if (!bind) return;
    const draft = edit.draft;
    const [kind, a, b] = bind.split(':');
    if (kind === 'category') {
      if (event.type !== 'change') return;
      draft.category = el.value;
      edit.dirty = true;
      renderEdit();
      return;
    }
    edit.dirty = true;
    if (['name', 'description', 'notes', 'tagsText', 'numbersText'].includes(kind)) draft[kind] = el.value;
    else if (kind === 'stock') draft.stock[Number(a)][b] = el.value;
    else if (kind === 'link') draft.links[Number(a)][b] = el.value;
    else if (kind === 'spec') draft.specs[a] = el.dataset.kind === 'bool' ? el.checked : el.value;
    else if (kind === 'multi') {
      const def = S.fieldDef(S.fieldMap(App.store.inv), a);
      const choices = multiChoices(App.store.inv, def);
      const current = Array.isArray(draft.specs[a]) ? draft.specs[a] : [];
      draft.specs[a] = [...current.filter((item) => choices.includes(item)), ...U.splitList(el.value)];
    }
  }

  async function onEditChange(event) {
    const el = event.target;
    if (!edit || !el.matches('select[data-change="edit-add-spec"]')) return;
    let key = el.value;
    el.value = '';
    if (!key) return;
    if (key === '__new__') {
      const session = edit;
      key = await App.settingsView.fieldDialog(null, { categoryId: session.draft.category });
      if (!key || edit !== session) return;
      const def = S.fieldDef(S.fieldMap(App.store.inv), key);
      if (!(key in session.draft.specs)) session.draft.specs[key] = def.type === 'bool' ? true : def.type === 'multi' ? [] : '';
    } else {
      const def = S.fieldDef(S.fieldMap(App.store.inv), key);
      edit.draft.specs[key] = def.type === 'bool' ? true : def.type === 'multi' ? [] : '';
    }
    edit.dirty = true;
    renderEdit();
    const input = editDialog().querySelector(`#spec-${CSS.escape(key)}`);
    if (input) input.focus();
  }

  function bindDialogs() {
    const dialog = editDialog();
    dialog.addEventListener('input', onEditInput);
    dialog.addEventListener('change', (event) => {
      onEditInput(event);
      onEditChange(event);
    });
    dialog.addEventListener('submit', (event) => {
      event.preventDefault();
      save();
    });
    dialog.addEventListener('dragover', (event) => {
      if (!edit || !event.dataTransfer || !Array.from(event.dataTransfer.types).includes('Files')) return;
      event.preventDefault();
      dialog.classList.add('is-dropping');
    });
    dialog.addEventListener('dragleave', (event) => {
      if (event.target === dialog || !dialog.contains(event.relatedTarget)) dialog.classList.remove('is-dropping');
    });
    dialog.addEventListener('drop', (event) => {
      if (!edit || !event.dataTransfer || !event.dataTransfer.files.length) return;
      event.preventDefault();
      dialog.classList.remove('is-dropping');
      addImageFiles(Array.from(event.dataTransfer.files));
    });
    dialog.addEventListener('paste', (event) => {
      if (!edit || !event.clipboardData) return;
      const files = Array.from(event.clipboardData.files || []).filter((file) => file.type.startsWith('image/'));
      if (!files.length) return;
      event.preventDefault();
      addImageFiles(files);
    });
    ui.bindDismiss(dialog, requestCloseEdit);
    ui.bindDismiss(detailDialog(), () => App.nav.back('#/'));

    // Browsers may close a dialog without a cancelable event (e.g. Escape pressed twice).
    // Our own close paths reset the state first, so anything else is treated as a dismissal.
    dialog.addEventListener('close', () => {
      if (!edit) return;
      if (edit.dirty) {
        ui.openSheet(dialog);
        requestCloseEdit();
      } else {
        const session = edit;
        closeEdit();
        App.nav.back(fallbackHash(session));
      }
    });
    detailDialog().addEventListener('close', () => {
      if (detailId) {
        detailId = null;
        App.nav.back('#/');
      }
    });
  }

  Object.assign(App.actions, {
    'new-part'() {
      const category = App.state.category;
      App.nav.go(category ? `#/new?category=${encodeURIComponent(category)}` : '#/new');
    },
    'close-part'() {
      App.nav.back('#/');
    },
    'edit-part'() {
      if (detailId) App.nav.go(`#/part/${encodeURIComponent(detailId)}/edit`);
    },
    'duplicate-part'() {
      if (detailId) App.nav.go(`#/new?from=${encodeURIComponent(detailId)}`);
    },
    async 'delete-part'() {
      const part = App.store.partById(detailId);
      if (!part) return;
      const ok = await ui.confirm({
        title: `Delete “${part.name}”?`,
        message: 'The part is removed from the inventory. Its photos stay on disk until you clean up unused images.',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        const removed = await App.store.deletePart(part.id);
        App.nav.back('#/');
        if (removed) {
          ui.toast(`Deleted “${part.name}”.`, {
            action: 'Undo',
            timeout: 9000,
            onAction: () => App.store.restorePart(removed.part, removed.index).catch((err) => ui.errorToast(err)),
          });
        }
      } catch (err) {
        ui.errorToast(err, 'Could not delete');
      }
    },
    async qty(el) {
      if (!detailId) return;
      try {
        await App.store.adjustQuantity(detailId, el.dataset.loc || null, Number(el.dataset.delta));
      } catch (err) {
        ui.errorToast(err);
      }
    },
    'use-part'() {
      const part = App.store.partById(detailId);
      if (part) useDialog(part);
    },
    'use-return'(el) {
      const part = App.store.partById(detailId);
      const use = part && part.uses.find((item) => item.project === el.dataset.project);
      if (use) returnDialog(part, use);
    },
    'use-edit'(el) {
      const part = App.store.partById(detailId);
      const use = part && part.uses.find((item) => item.project === el.dataset.project);
      if (use) editUseDialog(part, use);
    },
    'project-show'(el) {
      // All parts of the project, wherever they came from.
      const state = App.state;
      state.category = null;
      state.places = [];
      App.main.savePrefs();
      state.facets = { [App.filters.PROJECT]: new Set([el.dataset.project]) };
      App.main.setQuery('', { render: false });
      App.nav.back('#/');
      App.main.renderSoon();
    },
    'view-image'(el) {
      const part = App.store.partById(detailId);
      if (part && part.images.length) ui.lightbox(part.images, Number(el.dataset.index) || 0, part.name);
    },
    'category-from-detail'(el) {
      const state = App.state;
      if (state.category !== el.dataset.id) {
        for (const key of Object.keys(state.facets)) if (!key.startsWith('@')) delete state.facets[key];
      }
      state.category = el.dataset.id;
      App.nav.back('#/');
      App.main.renderSoon();
    },
    'edit-cancel'() {
      requestCloseEdit();
    },
    'edit-use-number'(el) {
      if (!edit) return;
      edit.draft.numbersText = el.dataset.number;
      edit.dirty = true;
      const input = editDialog().querySelector('[data-bind="numbersText"]');
      input.value = el.dataset.number;
      input.focus();
    },
    'edit-add-stock'() {
      edit.draft.stock.push({ location: '', qty: '' });
      edit.dirty = true;
      renderEdit();
      const inputs = editDialog().querySelectorAll('[data-bind$=":location"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    'edit-remove-stock'(el) {
      edit.draft.stock.splice(Number(el.dataset.index), 1);
      edit.dirty = true;
      renderEdit();
    },
    'edit-add-link'() {
      edit.draft.links.push({ label: '', url: '' });
      edit.dirty = true;
      renderEdit();
      const inputs = editDialog().querySelectorAll('[data-bind$=":label"]');
      if (inputs.length) inputs[inputs.length - 1].focus();
    },
    'edit-remove-link'(el) {
      edit.draft.links.splice(Number(el.dataset.index), 1);
      edit.dirty = true;
      renderEdit();
    },
    'edit-remove-spec'(el) {
      delete edit.draft.specs[el.dataset.key];
      edit.dirty = true;
      renderEdit();
    },
    'edit-toggle-multi'(el) {
      const { key, value } = el.dataset;
      const current = Array.isArray(edit.draft.specs[key]) ? edit.draft.specs[key] : [];
      const on = !current.includes(value);
      edit.draft.specs[key] = on ? [...current, value] : current.filter((item) => item !== value);
      edit.dirty = true;
      el.classList.toggle('is-on', on);
      el.setAttribute('aria-pressed', String(on));
    },
    async 'edit-add-images'() {
      const files = await U.pickFiles({ accept: App.images.ACCEPT, multiple: true });
      addImageFiles(files);
    },
    'edit-image-remove'(el) {
      const [removed] = edit.draft.images.splice(Number(el.dataset.index), 1);
      if (removed && removed.pending && removed.preview) URL.revokeObjectURL(removed.preview);
      edit.dirty = true;
      renderEdit();
    },
    'edit-image-cover'(el) {
      const [image] = edit.draft.images.splice(Number(el.dataset.index), 1);
      edit.draft.images.unshift(image);
      edit.dirty = true;
      renderEdit();
    },
  });

  App.partView = {
    bindDialogs,
    openDetail,
    closeDetail,
    refresh,
    openEdit,
    closeEdit,
    get editing() {
      return Boolean(edit);
    },
    get dirty() {
      return Boolean(edit && edit.dirty);
    },
    get editHash() {
      return edit ? edit.hash : '';
    },
    get detailId() {
      return detailId;
    },
  };
})(window.App = window.App || {});
