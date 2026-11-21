/* Electronics Inventory — browsing: categories, filters and the list of parts. */
(function (App) {
  'use strict';

  const U = App.util;
  const S = App.schema;
  const F = App.filters;
  const ui = App.ui;
  const icon = App.icon;
  const esc = U.esc;

  const FACET_LIMIT = 8;

  let lastResult = null;

  function locationDot(inv, code) {
    const location = S.locationByCode(inv, code);
    const color = location ? location.color : 'transparent';
    return `<i class="dot${location ? '' : ' dot--none'}" style="--dot:${esc(color)}"></i>`;
  }

  function placeholder(category) {
    return `<div class="placeholder">${icon(category ? category.icon : 'shapes')}</div>`;
  }

  function quantityLabel(part) {
    const text = S.quantityText(S.stockSummary(part));
    return `${text} ${text === '1' ? 'pc' : 'pcs'}`;
  }

  function locationsHtml(inv, part, max = 3) {
    const rows = part.stock.filter((row) => row.location);
    if (!rows.length) return '';
    const shown = rows.slice(0, max).map((row) => `<span class="loc">${locationDot(inv, row.location)}${esc(row.location)}</span>`);
    if (rows.length > max) shown.push(`<span class="loc loc--more">+${rows.length - max}</span>`);
    return shown.join('');
  }

  function partHref(part) {
    return `#/part/${encodeURIComponent(part.id)}`;
  }

  function cardHtml(inv, fields, part) {
    const category = S.categoryById(inv, part.category);
    const badges = S.partBadges(inv, part, fields, 4);
    const image = part.images[0];
    return `
      <a class="card${S.inStock(part) ? '' : ' is-out'}" href="${partHref(part)}" data-action="open-part" data-id="${esc(part.id)}">
        <div class="card__media">${image ? ui.imageTag(image) : placeholder(category)}</div>
        <div class="card__body">
          <div class="card__category">${esc(category ? category.name : part.category)}</div>
          <h3 class="card__title">${esc(part.name)}</h3>
          ${badges.length ? `<div class="badges">${badges.map((b) => `<span class="badge-spec">${esc(b)}</span>`).join('')}</div>` : ''}
          <div class="card__foot">
            <span class="qty">${esc(quantityLabel(part))}</span>
            <span class="locs">${locationsHtml(inv, part)}</span>
          </div>
        </div>
      </a>`;
  }

  function rowHtml(inv, fields, part) {
    const category = S.categoryById(inv, part.category);
    const badges = S.partBadges(inv, part, fields, 3);
    const image = part.images[0];
    return `
      <a class="row${S.inStock(part) ? '' : ' is-out'}" href="${partHref(part)}" data-action="open-part" data-id="${esc(part.id)}">
        <div class="row__media">${image ? ui.imageTag(image) : placeholder(category)}</div>
        <div class="row__main">
          <h3 class="row__title">${esc(part.name)}</h3>
          <div class="row__sub">
            <span class="row__category">${esc(category ? category.name : part.category)}</span>
            ${badges.map((b) => `<span class="badge-spec">${esc(b)}</span>`).join('')}
          </div>
        </div>
        <div class="row__side">
          <span class="qty">${esc(quantityLabel(part))}</span>
          <span class="locs">${locationsHtml(inv, part, 2)}</span>
        </div>
      </a>`;
  }

  // ---------------------------------------------------------------------------
  // Facets (shared by the sidebar and the mobile filter sheet)

  function facetsHtml(inv, state, facets) {
    if (!facets.length) {
      return '<p class="muted small facet-empty">Filters appear here once parts have properties to compare.</p>';
    }
    return facets.map((facet) => {
      const expanded = state.expandedFacets.has(facet.key);
      const visible = expanded
        ? facet.options
        : facet.options.filter((option, i) => i < FACET_LIMIT || option.selected);
      const hidden = facet.options.length - visible.length;
      return `
        <details class="facet" data-facet="${esc(facet.key)}"${state.collapsedFacets.has(facet.key) ? '' : ' open'}>
          <summary class="facet__summary">
            <span class="facet__label">${esc(facet.label)}</span>
            ${facet.active ? `<span class="facet__badge">${facet.active}</span>` : ''}
            ${icon('chevronDown', 'facet__chevron')}
          </summary>
          <div class="facet__options">
            ${visible.map((option) => `
              <label class="opt${option.count === 0 && !option.selected ? ' is-empty' : ''}">
                <input type="checkbox" data-facet-key="${esc(facet.key)}" value="${esc(option.value)}"${option.selected ? ' checked' : ''}>
                ${facet.key === F.LOCATION ? locationDot(inv, option.value === F.NONE ? null : option.value) : ''}
                <span class="opt__label">${esc(option.label)}</span>
                <span class="opt__count">${option.count}</span>
              </label>`).join('')}
            ${hidden > 0 || expanded ? `
              <button type="button" class="link-btn facet__more" data-action="facet-more" data-key="${esc(facet.key)}">
                ${expanded ? 'Show fewer' : `Show ${hidden} more`}
              </button>` : ''}
          </div>
        </details>`;
    }).join('');
  }

  function activeFilterCount(state) {
    return Object.values(state.facets).reduce((sum, set) => sum + (set ? set.size : 0), 0);
  }

  // ---------------------------------------------------------------------------
  // Rendering

  function renderSidebar(inv, state, result) {
    const counts = F.countByCategory(inv, state.query);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const showAll = state.showEmptyCategories || inv.parts.length === 0;
    const empty = inv.categories.filter((cat) => !counts.get(cat.id) && cat.id !== state.category).length;
    const categories = inv.categories.filter((cat) => showAll || counts.get(cat.id) || cat.id === state.category);
    const filtersActive = activeFilterCount(state);

    ui.$('#sidebar').innerHTML = `
      <section class="sidebar__section">
        <h2 class="sidebar__heading">Categories</h2>
        <nav class="catnav">
          <button type="button" class="catnav__item${state.category ? '' : ' is-active'}" data-action="category" data-id="">
            ${icon('grid')}<span class="catnav__name">All parts</span><span class="catnav__count">${total}</span>
          </button>
          ${categories.map((cat) => `
            <button type="button" class="catnav__item${cat.id === state.category ? ' is-active' : ''}${counts.get(cat.id) ? '' : ' is-empty'}"
              data-action="category" data-id="${esc(cat.id)}">
              ${icon(cat.icon)}<span class="catnav__name">${esc(cat.name)}</span><span class="catnav__count">${counts.get(cat.id) || 0}</span>
            </button>`).join('')}
          ${inv.parts.length && empty ? `
            <button type="button" class="link-btn catnav__toggle" data-action="toggle-empty-categories">
              ${state.showEmptyCategories ? 'Hide empty categories' : `Show ${empty} empty ${empty === 1 ? 'category' : 'categories'}`}
            </button>` : ''}
        </nav>
      </section>
      <section class="sidebar__section">
        <div class="sidebar__heading-row">
          <h2 class="sidebar__heading">Filters</h2>
          ${filtersActive ? '<button type="button" class="link-btn" data-action="clear-filters">Clear</button>' : ''}
        </div>
        <div class="facets">${facetsHtml(inv, state, result.facets)}</div>
      </section>`;
  }

  function emptyInventoryHtml() {
    return `
      <div class="empty">
        <div class="empty__icon">${icon('box')}</div>
        <h2>Your inventory is empty</h2>
        <p class="muted">Add parts with photos, properties and the box they are stored in.</p>
        <div class="empty__actions">
          <button type="button" class="btn btn--primary" data-action="new-part">${icon('plus')}<span>Add the first part</span></button>
          <button type="button" class="btn" data-action="load-demo">Load example parts</button>
        </div>
        <p class="muted small">Have a backup? Restore it in <a href="#/settings/data" data-action="open-settings" data-tab="data">Settings → Data &amp; backup</a>.</p>
      </div>`;
  }

  function noResultsHtml(state) {
    return `
      <div class="empty">
        <div class="empty__icon">${icon('search')}</div>
        <h2>No parts match</h2>
        <p class="muted">${state.query ? `Nothing found for “${esc(state.query)}” with the current filters.` : 'Try removing some filters.'}</p>
        <div class="empty__actions">
          <button type="button" class="btn" data-action="reset-view">Clear search and filters</button>
        </div>
      </div>`;
  }

  function renderMain(inv, state, result) {
    const fields = S.fieldMap(inv);
    const counts = F.countByCategory(inv, state.query);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const chipCategories = inv.categories.filter((cat) => counts.get(cat.id) || cat.id === state.category);
    const filtersActive = activeFilterCount(state);
    const { results } = result;
    const category = state.category ? S.categoryById(inv, state.category) : null;

    let list;
    if (!inv.parts.length) list = emptyInventoryHtml();
    else if (!results.length) list = noResultsHtml(state);
    else {
      const render = state.layout === 'list' ? rowHtml : cardHtml;
      list = `<div class="results results--${state.layout}">${results.map((part) => render(inv, fields, part)).join('')}</div>`;
    }

    ui.$('#main').innerHTML = `
      ${inv.parts.length ? `
        <div class="catbar" aria-label="Categories">
          <button type="button" class="cat-chip${state.category ? '' : ' is-active'}" data-action="category" data-id="">All <span>${total}</span></button>
          ${chipCategories.map((cat) => `
            <button type="button" class="cat-chip${cat.id === state.category ? ' is-active' : ''}" data-action="category" data-id="${esc(cat.id)}">
              ${esc(cat.name)} <span>${counts.get(cat.id) || 0}</span>
            </button>`).join('')}
        </div>
        <div class="toolbar">
          <button type="button" class="btn btn--sm toolbar__filters" data-action="open-filters">
            ${icon('filter')}<span>Filters</span>${filtersActive ? `<span class="count-badge">${filtersActive}</span>` : ''}
          </button>
          <p class="toolbar__count"><strong>${results.length}</strong> ${results.length === 1 ? 'part' : 'parts'}${category ? ` in ${esc(category.name)}` : ''}</p>
          <label class="select-wrap" title="Sort">
            ${icon('sort')}
            <select data-change="sort" aria-label="Sort by">
              ${Object.entries(F.SORT_LABELS).map(([value, label]) => `<option value="${value}"${state.sort === value ? ' selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <div class="seg" role="group" aria-label="Layout">
            <button type="button" class="seg__btn${state.layout === 'grid' ? ' is-active' : ''}" data-action="layout" data-layout="grid" aria-label="Grid" aria-pressed="${state.layout === 'grid'}">${icon('grid')}</button>
            <button type="button" class="seg__btn${state.layout === 'list' ? ' is-active' : ''}" data-action="layout" data-layout="list" aria-label="List" aria-pressed="${state.layout === 'list'}">${icon('list')}</button>
          </div>
        </div>
        ${result.chips.length ? `
          <div class="chips">
            ${result.chips.map((chip) => `
              <button type="button" class="chip" data-action="remove-filter" data-key="${esc(chip.key)}" data-value="${esc(chip.value)}" aria-label="Remove filter ${esc(chip.label)}">
                <span>${esc(chip.label)}</span>${icon('x')}
              </button>`).join('')}
            <button type="button" class="link-btn" data-action="clear-filters">Clear all</button>
          </div>` : ''}` : ''}
      ${list}`;
    ui.hydrateImages(ui.$('#main'));
  }

  function renderFiltersDialog(inv, state, result) {
    const dialog = ui.$('#dlg-filters');
    if (!dialog.open) return;
    const body = dialog.querySelector('.sheet__body');
    const scroll = body ? body.scrollTop : 0;
    dialog.innerHTML = `
      <header class="sheet__header">
        <h2 class="sheet__title">Filters</h2>
        <button type="button" class="btn btn--icon" data-action="close-filters" aria-label="Close">${icon('x')}</button>
      </header>
      <div class="sheet__body facets">${facetsHtml(inv, state, result.facets)}</div>
      <footer class="sheet__footer">
        <button type="button" class="btn" data-action="clear-filters"${activeFilterCount(state) ? '' : ' disabled'}>Clear</button>
        <button type="button" class="btn btn--primary" data-action="close-filters">Show ${U.plural(result.results.length, 'part')}</button>
      </footer>`;
    dialog.querySelector('.sheet__body').scrollTop = scroll;
  }

  function render() {
    const inv = App.store.inv;
    const state = App.state;
    if (!inv) return;
    lastResult = F.apply(inv, state);
    renderSidebar(inv, state, lastResult);
    renderMain(inv, state, lastResult);
    renderFiltersDialog(inv, state, lastResult);
  }

  // ---------------------------------------------------------------------------
  // Events

  function toggleFacet(key, value, on) {
    const state = App.state;
    const set = state.facets[key] || new Set();
    if (on) set.add(value);
    else set.delete(value);
    if (set.size) state.facets[key] = set;
    else delete state.facets[key];
    App.main.renderSoon();
  }

  /** Handles `change` events of list controls. Returns true when handled. */
  function handleChange(event) {
    const el = event.target;
    if (el.matches('input[data-facet-key]')) {
      toggleFacet(el.dataset.facetKey, el.value, el.checked);
      return true;
    }
    if (el.matches('select[data-change="sort"]')) {
      App.state.sort = el.value;
      App.main.savePrefs();
      App.main.renderSoon();
      return true;
    }
    return false;
  }

  /** Keeps track of which filter groups are collapsed (the `toggle` event does not bubble). */
  function handleToggle(event) {
    const el = event.target;
    if (!(el instanceof HTMLDetailsElement) || !el.dataset.facet) return;
    if (el.open) App.state.collapsedFacets.delete(el.dataset.facet);
    else App.state.collapsedFacets.add(el.dataset.facet);
  }

  Object.assign(App.actions, {
    category(el) {
      const state = App.state;
      const id = el.dataset.id || null;
      if (state.category !== id) {
        // Property filters belong to a category; location, stock and tag filters are kept.
        for (const key of Object.keys(state.facets)) if (!key.startsWith('@')) delete state.facets[key];
      }
      state.category = id;
      if (App.state.view !== 'inventory') App.nav.go('#/');
      App.main.renderSoon();
      if (window.scrollY > 0) window.scrollTo({ top: 0 });
    },
    'open-part'(el) {
      App.nav.go(`#/part/${encodeURIComponent(el.dataset.id)}`);
    },
    'open-filters'() {
      const dialog = ui.$('#dlg-filters');
      ui.openSheet(dialog);
      render();
    },
    'close-filters'() {
      ui.closeSheet(ui.$('#dlg-filters'));
    },
    'clear-filters'() {
      App.state.facets = {};
      App.main.renderSoon();
    },
    'reset-view'() {
      App.state.facets = {};
      App.main.setQuery('');
    },
    'remove-filter'(el) {
      toggleFacet(el.dataset.key, el.dataset.value, false);
    },
    'facet-more'(el) {
      const set = App.state.expandedFacets;
      if (set.has(el.dataset.key)) set.delete(el.dataset.key);
      else set.add(el.dataset.key);
      App.main.renderSoon();
    },
    layout(el) {
      App.state.layout = el.dataset.layout === 'list' ? 'list' : 'grid';
      App.main.savePrefs();
      App.main.renderSoon();
    },
    'toggle-empty-categories'() {
      App.state.showEmptyCategories = !App.state.showEmptyCategories;
      App.main.renderSoon();
    },
  });

  App.list = {
    render,
    handleChange,
    handleToggle,
    locationDot,
    placeholder,
    quantityLabel,
    get lastResult() {
      return lastResult;
    },
  };
})(window.App = window.App || {});
