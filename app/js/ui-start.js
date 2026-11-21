/* Electronics Inventory — start screens: loading, choosing storage, reconnecting, errors. */
(function (App) {
  'use strict';

  const U = App.util;
  const ui = App.ui;
  const icon = App.icon;
  const esc = U.esc;

  function bootHtml() {
    return '<div class="start"><div class="start__loading"><span class="spinner"></span><span>Loading inventory…</span></div></div>';
  }

  function welcomeHtml() {
    const folder = App.storage.folderSupported;
    const fromFile = location.protocol === 'file:';
    return `
      <div class="start">
        <div class="start__card">
          <div class="start__logo">${icon('chip')}</div>
          <h1 class="start__title">Electronics Inventory</h1>
          <p class="muted">Choose where this inventory is kept on this device.</p>
          <div class="start__options">
            <button type="button" class="option-card" data-action="storage-folder"${folder ? '' : ' disabled'}>
              <span class="option-card__icon">${icon('folder')}</span>
              <span class="option-card__body">
                <span class="option-card__title">Open a data folder${folder ? ' <span class="pill pill--accent">Recommended</span>' : ''}</span>
                <span class="option-card__text">inventory.json and the photos are stored as plain files in a folder you pick — the same layout the server uses, so copying the folder is a full backup. Pick an empty folder to start a new inventory.</span>
                ${folder ? '' : '<span class="option-card__note">Not available in this browser — use Chrome, Edge or another Chromium-based browser.</span>'}
              </span>
            </button>
            <button type="button" class="option-card" data-action="storage-browser">
              <span class="option-card__icon">${icon('database')}</span>
              <span class="option-card__body">
                <span class="option-card__title">Keep it in this browser</span>
                <span class="option-card__text">Works in every browser. The data stays in this browser only, so download a full backup now and then (Settings → Data &amp; backup).</span>
              </span>
            </button>
          </div>
          <p class="start__hint muted small">
            ${fromFile ? 'Opened directly from disk. ' : ''}Hosting it with Docker? Open the app through the server address instead — the data is then stored on the server automatically.
          </p>
        </div>
      </div>`;
  }

  function reconnectHtml(state) {
    const name = state.reconnectHandle ? state.reconnectHandle.name : '';
    return `
      <div class="start">
        <div class="start__card">
          <div class="start__logo">${icon('folder')}</div>
          <h1 class="start__title">Reconnect the data folder</h1>
          <p class="muted">The browser needs your permission again to use the folder <strong>${esc(name)}</strong>.</p>
          <div class="start__actions">
            <button type="button" class="btn btn--primary" data-action="storage-reconnect">Allow access</button>
            <button type="button" class="btn" data-action="storage-forget">Choose something else</button>
          </div>
        </div>
      </div>`;
  }

  function errorHtml(state) {
    const err = state.error || {};
    const fs = App.store.fs;
    const broken = err.code === 'parse' || err.code === 'format';
    return `
      <div class="start">
        <div class="start__card start__card--wide">
          <div class="start__logo start__logo--danger">${icon('alert')}</div>
          <h1 class="start__title">The inventory could not be opened</h1>
          <p class="error-text">${esc(err.message || String(err))}</p>
          ${broken ? `
            <p class="muted small">inventory.json in the data folder was probably edited by hand or by a script. Fix the file and try again,
            or restore one of the automatic snapshots below (the broken file is kept as a snapshot too).</p>` : ''}
          <div class="start__actions">
            <button type="button" class="btn btn--primary" data-action="retry-load">${icon('refresh')}<span>Try again</span></button>
            ${fs && fs.kind !== 'server' ? '<button type="button" class="btn" data-action="storage-forget">Choose other storage</button>' : ''}
          </div>
          ${broken && fs ? '<div class="start__snapshots" data-panel="snapshots"><p class="muted small">Loading snapshots…</p></div>' : ''}
        </div>
      </div>`;
  }

  function render(state) {
    ui.$('#sidebar').innerHTML = '';
    const main = ui.$('#main');
    if (state.view === 'welcome') main.innerHTML = welcomeHtml();
    else if (state.view === 'reconnect') main.innerHTML = reconnectHtml(state);
    else if (state.view === 'error') {
      main.innerHTML = errorHtml(state);
      App.settingsView.loadSnapshots(main);
    } else main.innerHTML = bootHtml();
  }

  App.start = { render };
})(window.App = window.App || {});
