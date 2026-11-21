/* Electronics Inventory — search, faceted filters and sorting.
 * Within one filter the chosen values are OR-ed, different filters are AND-ed.
 * Counts next to each value show how many parts would match with the other filters applied. */
(function (App) {
  'use strict';

  const U = App.util;
  const S = App.schema;

  const ANY = '__any__';
  const NONE = '__none__';
  const LOCATION = '@location';
  const STOCK = '@stock';
  const TAGS = '@tags';
  const MAX_TEXT_VALUES = 40;

  const haystacks = new WeakMap();

  function haystack(inv, fields, part) {
    let text = haystacks.get(part);
    if (text !== undefined) return text;
    const category = S.categoryById(inv, part.category);
    const bits = [part.id, part.name, part.description, part.notes, category ? category.name : '', ...part.tags];
    for (const [key, value] of Object.entries(part.specs)) {
      const def = S.fieldDef(fields, key);
      if (value === true) bits.push(def.label);
      else if (value !== false) bits.push(S.specText(def, value));
    }
    for (const row of part.stock) {
      const location = S.locationByCode(inv, row.location);
      if (location) bits.push(location.code, location.name);
    }
    for (const link of part.links) bits.push(link.label);
    text = U.fold(bits.join(' \u0001 '));
    haystacks.set(part, text);
    return text;
  }

  /** Values of one filter dimension for a part (always an array of strings). */
  function valuesOf(inv, fields, part, key) {
    if (key === LOCATION) {
      const codes = part.stock.map((row) => row.location || NONE);
      return codes.length ? [...new Set(codes)] : [NONE];
    }
    if (key === STOCK) return [S.inStock(part) ? 'in' : 'out'];
    if (key === TAGS) return part.tags;
    const def = S.fieldDef(fields, key);
    const value = part.specs[key];
    if (def.type === 'bool') return [value === true ? 'Yes' : 'No'];
    if (value === undefined || value === null || value === '') return [];
    if (Array.isArray(value)) return value.map(String);
    return [String(value)];
  }

  function matchesFacet(inv, fields, part, key, selected) {
    const values = valuesOf(inv, fields, part, key);
    for (const choice of selected) {
      if (choice === ANY ? values.length > 0 : values.includes(choice)) return true;
    }
    return false;
  }

  function matchesAll(inv, fields, part, facets, skipKey) {
    for (const [key, selected] of Object.entries(facets)) {
      if (key === skipKey || !selected || !selected.size) continue;
      if (!matchesFacet(inv, fields, part, key, selected)) return false;
    }
    return true;
  }

  /** Keys of spec fields offered as filters for the current scope. */
  function facetKeys(inv, base, categoryId) {
    const used = new Map(); // key -> Set of categories using it
    for (const part of base) {
      for (const key of Object.keys(part.specs)) {
        if (!used.has(key)) used.set(key, new Set());
        used.get(key).add(part.category);
      }
    }
    if (categoryId) {
      const category = S.categoryById(inv, categoryId);
      const keys = category ? category.fields.filter((key) => used.has(key)) : [];
      for (const key of used.keys()) if (!keys.includes(key)) keys.push(key);
      return keys;
    }
    // Across all categories only properties shared by several categories make sense
    // (e.g. Wi-Fi or Bluetooth on boards and modules).
    const order = inv.fields.map((field) => field.key);
    return [...used.entries()]
      .filter(([, categories]) => categories.size > 1)
      .map(([key]) => key)
      .sort((a, b) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999));
  }

  function sortOptions(inv, def, key, counts) {
    const entries = [...counts.entries()];
    if (key === LOCATION) {
      const order = inv.locations.map((loc) => loc.code);
      return entries.sort((a, b) => {
        const ia = a[0] === NONE ? 1e6 : order.indexOf(a[0]);
        const ib = b[0] === NONE ? 1e6 : order.indexOf(b[0]);
        return ia - ib || U.collator.compare(a[0], b[0]);
      });
    }
    if (key === STOCK) return entries.sort((a) => (a[0] === 'in' ? -1 : 1));
    if (def && def.type === 'bool') return entries.sort((a) => (a[0] === 'Yes' ? -1 : 1));
    if (def && (def.type === 'select' || def.type === 'multi') && def.options) {
      return entries.sort((a, b) => {
        const ia = def.options.indexOf(a[0]);
        const ib = def.options.indexOf(b[0]);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0 || ib >= 0) return ia >= 0 ? -1 : 1;
        return b[1] - a[1] || U.collator.compare(a[0], b[0]);
      });
    }
    if (def && def.type === 'number') return entries.sort((a, b) => Number(a[0]) - Number(b[0]));
    return entries.sort((a, b) => b[1] - a[1] || U.collator.compare(a[0], b[0]));
  }

  function optionLabel(inv, def, key, value) {
    if (key === LOCATION) {
      if (value === NONE) return 'Unassigned';
      const location = S.locationByCode(inv, value);
      return location && location.name !== location.code ? `${location.code} · ${location.name}` : value;
    }
    if (key === STOCK) return value === 'in' ? 'In stock' : 'Out of stock';
    if (def && def.unit && def.type === 'number') return `${value} ${def.unit}`;
    return value;
  }

  function buildFacet(inv, fields, base, facets, key, label, def) {
    const selected = facets[key] || new Set();
    const pool = base.filter((part) => matchesAll(inv, fields, part, facets, key));
    const counts = new Map();
    let withValue = 0;
    for (const part of pool) {
      const values = valuesOf(inv, fields, part, key);
      if (values.length) withValue += 1;
      for (const value of new Set(values)) counts.set(value, (counts.get(value) || 0) + 1);
    }
    for (const value of selected) if (value !== ANY && !counts.has(value)) counts.set(value, 0);
    let options = sortOptions(inv, def, key, counts).map(([value, count]) => ({
      value,
      count,
      label: optionLabel(inv, def, key, value),
      selected: selected.has(value),
    }));
    const isTextLike = def && (def.type === 'text' || def.type === 'number');
    if (isTextLike && options.length > MAX_TEXT_VALUES && !selected.size) return null;
    // When only some parts have the property, "Any" separates them from the rest, so the filter
    // is useful even with a single value (e.g. the same Wi-Fi version on every board that has Wi-Fi).
    const offerAny = def && def.type !== 'bool' && withValue > 0 && withValue < pool.length;
    if (options.length < 2 && !offerAny && !selected.size) return null;
    if (offerAny) {
      options = [{ value: ANY, count: withValue, label: 'Any', selected: selected.has(ANY) }, ...options];
    }
    return { key, label, type: def ? def.type : key, options, active: selected.size };
  }

  function searchParts(inv, fields, parts, query) {
    const tokens = U.fold(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return parts;
    return parts.filter((part) => {
      const text = haystack(inv, fields, part);
      return tokens.every((token) => text.includes(token));
    });
  }

  /** Number of parts per category that match the search text (ignores the other filters). */
  function countByCategory(inv, query) {
    const counts = new Map();
    for (const part of searchParts(inv, S.fieldMap(inv), inv.parts, query)) {
      counts.set(part.category, (counts.get(part.category) || 0) + 1);
    }
    return counts;
  }

  /**
   * Applies the view state to the inventory.
   * @param {object} inv
   * @param {{category: string|null, query: string, facets: Object<string, Set<string>>, sort: string}} view
   */
  function apply(inv, view) {
    const fields = S.fieldMap(inv);
    const inCategory = view.category ? inv.parts.filter((part) => part.category === view.category) : inv.parts;
    const base = searchParts(inv, fields, inCategory, view.query);

    const facets = [];
    const push = (facet) => {
      if (facet) facets.push(facet);
    };
    push(buildFacet(inv, fields, base, view.facets, STOCK, 'Stock', null));
    push(buildFacet(inv, fields, base, view.facets, LOCATION, 'Location', null));
    for (const key of facetKeys(inv, base, view.category)) {
      const def = S.fieldDef(fields, key);
      push(buildFacet(inv, fields, base, view.facets, key, def.label, def));
    }
    push(buildFacet(inv, fields, base, view.facets, TAGS, 'Tags', { type: 'text' }));

    const results = sortParts(base.filter((part) => matchesAll(inv, fields, part, view.facets, null)), view.sort);

    const chips = [];
    for (const [key, selected] of Object.entries(view.facets)) {
      if (!selected || !selected.size) continue;
      const def = key.startsWith('@') ? null : S.fieldDef(fields, key);
      const label = key === LOCATION ? 'Location' : key === STOCK ? 'Stock' : key === TAGS ? 'Tag' : def.label;
      for (const value of selected) {
        const valueLabel = value === ANY ? 'Any' : optionLabel(inv, def, key, value);
        chips.push({ key, value, label: `${label}: ${valueLabel}` });
      }
    }
    return { base, results, facets, chips };
  }

  function quantity(part) {
    const summary = S.stockSummary(part);
    return summary.unknown && summary.total === 0 ? -1 : summary.total;
  }

  const SORTS = {
    name: (a, b) => U.collator.compare(a.name, b.name),
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    qtyDesc: (a, b) => quantity(b) - quantity(a) || U.collator.compare(a.name, b.name),
    qtyAsc: (a, b) => quantity(a) - quantity(b) || U.collator.compare(a.name, b.name),
  };

  const SORT_LABELS = {
    name: 'Name',
    updated: 'Recently changed',
    created: 'Recently added',
    qtyDesc: 'Most in stock',
    qtyAsc: 'Least in stock',
  };

  function sortParts(parts, sort) {
    return [...parts].sort(SORTS[sort] || SORTS.name);
  }

  App.filters = { ANY, NONE, LOCATION, STOCK, TAGS, apply, countByCategory, sortParts, SORT_LABELS };
})(window.App = window.App || {});
