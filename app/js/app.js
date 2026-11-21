/* Electronics Inventory — application start-up, routing and global events.
 * Routes (hash based, so the app also works when index.html is opened from disk):
 *   #/                    list
 *   #/part/<id>           part detail
 *   #/part/<id>/edit      edit form
 *   #/new[?category=…]    new part (also ?from=<id> to duplicate)
 *   #/settings/<tab>      settings */
(function (App) {
  'use strict';

  const U = App.util;
  const ui = App.ui;
  const icon = App.icon;

  const PREFS_KEY = 'electronics-inventory.ui';
  const POLL_MS = 10_000;

  function loadPrefs() {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
    } catch (err) {
      return {};
    }
  }

  const prefs = loadPrefs();

  const state = {
    view: 'boot',
    category: null,
    place: typeof prefs.place === 'string' ? prefs.place : '', // '' = all places
    query: '',
    facets: {},
    sort: prefs.sort || 'name',
    layout: prefs.layout || (window.matchMedia('(max-width: 640px)').matches ? 'list' : 'grid'),
    collapsedFacets: new Set(),
    expandedFacets: new Set(),
    showEmptyCategories: false,
    settingsTab: 'general',
    error: null,
    reconnectHandle: null,
  };
  App.state = state;

  function savePrefs() {
    prefs.sort = state.sort;
    prefs.layout = state.layout;
    prefs.place = state.place;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch (err) {
      // Preferences are optional.
    }
  }

  // ---------------------------------------------------------------------------
  // Theme

  const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

  function applyTheme() {
    const theme = prefs.theme;
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    const dark = theme === 'dark' || (theme !== 'light' && darkQuery.matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#14171c' : '#ffffff';
  }

  function setTheme(theme) {
    prefs.theme = theme === 'light' || theme === 'dark' ? theme : undefined;
    savePrefs();
    applyTheme();
  }

  // ---------------------------------------------------------------------------
  // Navigation

  const nav = {
    go(hash) {
      if (location.hash === hash) {
        route();
        return;
      }
      history.pushState({ inApp: true }, '', hash);
      route();
    },
    replace(hash) {
      history.replaceState(history.state, '', hash);
      route();
    },
    /** Goes back when the previous entry belongs to the app, otherwise replaces with `fallback`. */
    back(fallback = '#/') {
      if (history.state && history.state.inApp) history.back();
      else nav.replace(fallback);
    },
  };
  App.nav = nav;

  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query] = raw.split('?');
    let parts;
    try {
      parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    } catch (err) {
      parts = [];
    }
    return { parts, params: new URLSearchParams(query || '') };
  }

  let routing = Promise.resolve();

  function route() {
    routing = routing.then(applyRoute, applyRoute);
    return routing;
  }

  async function applyRoute() {
    if (!App.store.inv || !['inventory', 'settings'].includes(state.view)) return;
    const hash = location.hash || '#/';
    const { parts, params } = parseHash();

    if (App.partView.editing && App.partView.editHash !== hash) {
      if (App.partView.dirty) {
        const editHash = App.partView.editHash;
        const ok = await ui.confirm({
          title: 'Discard changes?',
          message: 'Your changes to this part have not been saved.',
          confirmLabel: 'Discard',
          danger: true,
        });
        if (!ok) {
          history.pushState({ inApp: true }, '', editHash);
          return;
        }
      }
      App.partView.closeEdit();
    }

    if (parts[0] === 'settings') {
      state.view = 'settings';
      state.settingsTab = parts[1] || 'general';
      App.partView.closeDetail();
      ui.closeSheet(ui.$('#dlg-filters'));
      render();
      return;
    }

    const wasSettings = state.view === 'settings';
    state.view = 'inventory';
    render();
    if (wasSettings) window.scrollTo(0, 0);

    if (parts[0] === 'part' && parts[1]) {
      App.partView.openDetail(parts[1]);
      if (parts[2] === 'edit') App.partView.openEdit(parts[1], { hash });
    } else if (parts[0] === 'new') {
      App.partView.closeDetail();
      App.partView.openEdit(null, { category: params.get('category'), from: params.get('from'), hash });
    } else {
      App.partView.closeDetail();
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering

  function updateStatus() {
    const pill = ui.$('#storage-pill');
    const fs = App.store.fs;
    if (!fs || !App.store.inv) {
      pill.hidden = true;
      return;
    }
    const kindIcon = { server: 'server', folder: 'folder', browser: 'database' }[fs.kind];
    const busy = App.store.busy;
    pill.hidden = false;
    pill.classList.toggle('is-busy', busy);
    pill.title = busy ? 'Saving…' : `Storage: ${fs.detail}`;
    pill.innerHTML = `${busy ? '<span class="spinner spinner--sm"></span>' : icon(kindIcon)}<span class="status-pill__label">${U.esc(fs.label)}</span>`;
  }

  function updateChrome() {
    const inv = App.store.inv;
    const title = inv ? inv.settings.title : 'Electronics Inventory';
    document.title = title;
    ui.$('#brand-title').textContent = title;
    updateStatus();
  }

  function render() {
    ui.$('#app').dataset.view = state.view;
    updateChrome();
    if (state.view === 'inventory') App.list.render();
    else if (state.view === 'settings') App.settingsView.render();
    else App.start.render(state);
  }

  let frame = 0;
  function renderSoon() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      render();
    });
  }

  function setQuery(value, { render: doRender = true } = {}) {
    ui.$('#search').value = value;
    state.query = value;
    if (doRender) renderSoon();
  }

  // ---------------------------------------------------------------------------
  // Storage life cycle

  let pollTimer = 0;

  function poll() {
    if (document.visibilityState !== 'visible' || !App.store.inv) return;
    App.store.checkExternal().catch(() => {});
  }

  function startPolling() {
    if (!pollTimer) pollTimer = setInterval(poll, POLL_MS);
  }

  async function openStorage(fs) {
    state.view = 'boot';
    render();
    try {
      await App.store.open(fs);
      state.error = null;
      enterInventory();
    } catch (err) {
      console.error(err);
      state.error = err;
      state.view = 'error';
      render();
    }
  }

  function enterInventory() {
    state.view = 'inventory';
    startPolling();
    route();
  }

  function showStart() {
    App.partView.closeEdit();
    App.partView.closeDetail();
    App.store.close();
    state.view = 'welcome';
    history.replaceState(null, '', '#/');
    render();
  }

  function afterRestore() {
    state.category = null;
    state.facets = {};
    setQuery('', { render: false });
    if (state.view === 'error' || state.view === 'boot') {
      state.error = null;
      enterInventory();
    } else {
      nav.go('#/');
    }
  }

  // ---------------------------------------------------------------------------
  // Events

  function onClick(event) {
    const el = event.target.closest('[data-action]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    const handler = App.actions[el.dataset.action];
    if (!handler) return;
    if (el.tagName === 'A') {
      // Let the browser handle "open in new tab" clicks.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
    }
    Promise.resolve()
      .then(() => handler(el, event))
      .catch((err) => ui.errorToast(err));
  }

  function onKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (U.isTypingTarget(event.target) || document.querySelector('dialog[open]')) return;
    if (state.view !== 'inventory') return;
    if (event.key === '/') {
      event.preventDefault();
      ui.$('#search').focus();
    } else if (event.key === 'n') {
      event.preventDefault();
      App.actions['new-part']();
    }
  }

  function bindEvents() {
    document.addEventListener('click', onClick);
    document.addEventListener('change', (event) => App.list.handleChange(event));
    document.addEventListener('toggle', (event) => App.list.handleToggle(event), true);
    document.addEventListener('submit', (event) => App.settingsView.handleSubmit(event));
    document.addEventListener('error', (event) => ui.handleImageError(event), true);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('popstate', () => route());
    window.addEventListener('hashchange', () => route());
    window.addEventListener('focus', poll);
    document.addEventListener('visibilitychange', poll);
    darkQuery.addEventListener('change', applyTheme);

    const search = ui.$('#search');
    const onSearch = U.debounce(() => {
      state.query = search.value;
      if (state.view === 'inventory') renderSoon();
    }, 120);
    search.addEventListener('input', onSearch);
    search.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && search.value) {
        event.preventDefault();
        setQuery('');
      } else if (event.key === 'Enter') {
        search.blur();
      }
    });
    search.addEventListener('focus', () => {
      if (state.view === 'settings') nav.go('#/');
    });

    ui.bindDismiss(ui.$('#dlg-filters'), () => ui.closeSheet(ui.$('#dlg-filters')));
    App.partView.bindDialogs();

    let lastSyncToast = 0;
    const syncToast = (message) => {
      // Agents and other devices may change many things in a row: one hint now and then is enough.
      if (Date.now() - lastSyncToast < 20_000) return;
      lastSyncToast = Date.now();
      ui.toast(message, { timeout: 2500 });
    };

    App.store.on((event) => {
      if (event.type === 'saving' || event.type === 'idle') updateStatus();
      if (event.type === 'change') {
        renderSoon();
        App.partView.refresh();
        if (event.external) syncToast('Updated with changes made elsewhere.');
        else if (event.reloaded && event.label !== 'restore') syncToast('Merged with changes made elsewhere.');
      }
    });
  }

  Object.assign(App.actions, {
    home() {
      state.category = null;
      state.facets = {};
      setQuery('', { render: false });
      nav.go('#/');
    },
    async 'load-demo'() {
      const count = await App.demo.load();
      ui.toast(`${U.plural(count, 'example part')} added. They are tagged “example”.`);
    },
    async 'storage-folder'() {
      let fs;
      try {
        fs = await App.storage.pickFolder();
      } catch (err) {
        if (err && err.name === 'AbortError') return;
        ui.errorToast(err, 'Cannot use this folder');
        return;
      }
      await openStorage(fs);
    },
    async 'storage-browser'() {
      await openStorage(await App.storage.useBrowser());
    },
    async 'storage-reconnect'() {
      await openStorage(await App.storage.reconnectFolder(state.reconnectHandle));
    },
    async 'storage-forget'() {
      await App.storage.forgetLocal();
      showStart();
    },
    'retry-load'() {
      if (App.store.fs) openStorage(App.store.fs);
      else window.location.reload();
    },
    'open-data-settings'() {
      nav.go('#/settings/data');
    },
    'clear-search'() {
      setQuery('');
      ui.$('#search').focus();
    },
  });

  // ---------------------------------------------------------------------------
  // Start

  async function boot() {
    applyTheme();
    for (const el of document.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
    if (/^https?:$/.test(location.protocol)) {
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'manifest.webmanifest';
      document.head.appendChild(link);
    }
    bindEvents();
    render();

    const server = await App.storage.detectServer();
    if (server) {
      await openStorage(server);
      return;
    }
    let local = null;
    try {
      local = await App.storage.restoreLocal();
    } catch (err) {
      console.warn('Could not restore the local storage choice', err);
    }
    if (local && local.fs) {
      await openStorage(local.fs);
    } else if (local && local.handle) {
      state.reconnectHandle = local.handle;
      state.view = 'reconnect';
      render();
    } else {
      state.view = 'welcome';
      render();
    }
  }

  App.main = {
    get prefs() {
      return prefs;
    },
    savePrefs,
    setTheme,
    render,
    renderSoon,
    setQuery,
    showStart,
    afterRestore,
  };

  boot();
})(window.App = window.App || {});
