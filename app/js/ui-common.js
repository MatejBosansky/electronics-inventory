/* Electronics Inventory — shared UI pieces: dialogs, toasts, confirmations, images. */
(function (App) {
  'use strict';

  const U = App.util;
  const icon = App.icon;

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  // ---------------------------------------------------------------------------
  // Dialog sheets

  function openSheet(dialog) {
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add('has-dialog');
  }

  function closeSheet(dialog) {
    if (dialog.open) dialog.close();
    if (!$$('dialog[open]').length) document.documentElement.classList.remove('has-dialog');
  }

  /**
   * Calls `onDismiss` for Escape and for clicks on the backdrop, instead of closing directly,
   * so routed dialogs can go back in history.
   */
  function bindDismiss(dialog, onDismiss) {
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      onDismiss();
    });
    dialog.addEventListener('mousedown', (event) => {
      dialog.dataset.downOnBackdrop = String(event.target === dialog);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && dialog.dataset.downOnBackdrop === 'true') onDismiss();
    });
    dialog.addEventListener('close', () => {
      if (!$$('dialog[open]').length) document.documentElement.classList.remove('has-dialog');
    });
  }

  // ---------------------------------------------------------------------------
  // Toasts

  /** Keeps toasts above open modal dialogs (which live in the browser's top layer). */
  function raiseToasts(host) {
    if (typeof host.showPopover === 'function') {
      try {
        if (host.matches(':popover-open')) host.hidePopover();
        host.showPopover();
      } catch (err) {
        // Not fatal: the toast is still shown, just possibly behind a dialog.
      }
      return;
    }
    const dialogs = $$('dialog[open]');
    const target = dialogs.length ? dialogs[dialogs.length - 1] : document.body;
    if (host.parentElement !== target) target.appendChild(host);
  }

  function toast(message, { kind = 'info', action = null, onAction = null, timeout = 4500 } = {}) {
    const host = $('#toasts');
    raiseToasts(host);
    const el = document.createElement('div');
    el.className = `toast toast--${kind}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.innerHTML = `<span class="toast__text">${U.esc(message)}</span>${
      action ? `<button type="button" class="toast__action">${U.esc(action)}</button>` : ''
    }<button type="button" class="toast__close" aria-label="Dismiss">${icon('x')}</button>`;
    const remove = () => {
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 200);
    };
    el.querySelector('.toast__close').addEventListener('click', remove);
    if (action) {
      el.querySelector('.toast__action').addEventListener('click', () => {
        remove();
        if (onAction) onAction();
      });
    }
    host.appendChild(el);
    if (timeout) setTimeout(remove, kind === 'error' ? Math.max(timeout, 8000) : timeout);
    return remove;
  }

  function errorToast(err, prefix = '') {
    console.error(err);
    const message = err && err.message ? err.message : String(err);
    return toast(prefix ? `${prefix}: ${message}` : message, { kind: 'error' });
  }

  // ---------------------------------------------------------------------------
  // Confirmation and small form dialogs

  function confirm({ title, message = '', confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false, html = '' }) {
    const dialog = $('#dlg-confirm');
    dialog.innerHTML = `
      <form method="dialog" class="alert">
        <h2 class="alert__title">${U.esc(title)}</h2>
        ${message ? `<p class="alert__message">${U.esc(message)}</p>` : ''}
        ${html}
        <div class="alert__actions">
          <button type="submit" value="cancel" class="btn">${U.esc(cancelLabel)}</button>
          <button type="submit" value="ok" class="btn ${danger ? 'btn--danger' : 'btn--primary'}">${U.esc(confirmLabel)}</button>
        </div>
      </form>`;
    return new Promise((resolve) => {
      const done = () => {
        dialog.removeEventListener('close', done);
        const ok = dialog.returnValue === 'ok';
        const form = dialog.querySelector('form');
        resolve(ok ? (html ? new FormData(form) : true) : false);
        if (!$$('dialog[open]').length) document.documentElement.classList.remove('has-dialog');
      };
      dialog.returnValue = 'cancel';
      dialog.addEventListener('close', done);
      openSheet(dialog);
      const primary = dialog.querySelector('button[value="ok"]');
      if (primary && !html) primary.focus();
    });
  }

  /**
   * Shows a form in a modal dialog.
   * `onSubmit(formData, form)` may throw (the error is shown and the dialog stays open)
   * or return false to keep the dialog open. Resolves with the returned value, or null when cancelled.
   */
  function formDialog({ title, body, submitLabel = 'Save', onSubmit, onRender = null, wide = false }) {
    const dialog = $('#dlg-form');
    dialog.classList.toggle('sheet--wide', wide);
    dialog.innerHTML = `
      <form class="sheet__form" novalidate>
        <header class="sheet__header">
          <h2 class="sheet__title">${U.esc(title)}</h2>
          <button type="button" class="btn btn--icon" data-close aria-label="Close">${icon('x')}</button>
        </header>
        <div class="sheet__body">${body}<p class="form-error" hidden></p></div>
        <footer class="sheet__footer">
          <button type="button" class="btn" data-close>Cancel</button>
          <button type="submit" class="btn btn--primary">${U.esc(submitLabel)}</button>
        </footer>
      </form>`;
    const form = dialog.querySelector('form');
    const errorEl = dialog.querySelector('.form-error');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        closeSheet(dialog);
        resolve(value);
      };
      dialog.oncancel = (event) => {
        event.preventDefault();
        finish(null);
      };
      for (const button of $$('[data-close]', dialog)) button.addEventListener('click', () => finish(null));
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        errorEl.hidden = true;
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        try {
          const result = await onSubmit(new FormData(form), form);
          if (result !== false) finish(result === undefined ? true : result);
        } catch (err) {
          errorEl.textContent = err && err.message ? err.message : String(err);
          errorEl.hidden = false;
        } finally {
          submit.disabled = false;
        }
      });
      openSheet(dialog);
      if (onRender) onRender(form);
      const first = form.querySelector('input:not([type="hidden"]):not([type="color"]), select, textarea');
      if (first && window.matchMedia('(pointer: fine)').matches) first.focus();
    });
  }

  /** Small progress overlay for long operations (backup, restore). */
  function progress(message) {
    const el = document.createElement('div');
    el.className = 'progress-overlay';
    el.innerHTML = `<div class="progress-box"><span class="spinner"></span><span class="progress-text">${U.esc(message)}</span></div>`;
    document.body.appendChild(el);
    return {
      update(text) {
        el.querySelector('.progress-text').textContent = text;
      },
      close() {
        el.remove();
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Images

  /**
   * HTML for an image stored in the data folder. With server storage the URL is direct;
   * for folder/browser storage the file is loaded lazily when it scrolls into view.
   */
  function imageTag(image, { thumb = true, alt = '', className = '' } = {}) {
    const path = thumb && image.thumb ? image.thumb : image.src;
    const fallback = path !== image.src ? image.src : '';
    const url = App.store.imageUrlSync(path);
    const common = `alt="${U.esc(alt)}" class="${U.esc(className)}" decoding="async"${
      fallback ? ` data-fallback="${U.esc(fallback)}"` : ''
    }`;
    if (url) return `<img src="${U.esc(url)}" loading="lazy" ${common}>`;
    return `<img data-path="${U.esc(path)}" ${common}>`;
  }

  let observer = null;

  function loadInto(img, path) {
    App.store.imageUrl(path).then((url) => {
      img.src = url;
    }).catch(() => img.classList.add('is-broken'));
  }

  /** Resolves pending data-path images inside `root`. */
  function hydrateImages(root) {
    const pendingImages = $$('img[data-path]:not([src])', root);
    if (!pendingImages.length) return;
    if (!observer && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          loadInto(entry.target, entry.target.dataset.path);
        }
      }, { rootMargin: '400px' });
    }
    for (const img of pendingImages) {
      if (observer) observer.observe(img);
      else loadInto(img, img.dataset.path);
    }
  }

  /** Falls back from a missing thumbnail to the full image (wired once, globally). */
  function handleImageError(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    const fallback = img.dataset.fallback;
    if (fallback) {
      delete img.dataset.fallback;
      const url = App.store.imageUrlSync(fallback);
      if (url) img.src = url;
      else loadInto(img, fallback);
    } else {
      img.classList.add('is-broken');
    }
  }

  // ---------------------------------------------------------------------------
  // Lightbox

  function lightbox(images, start = 0, title = '') {
    const dialog = $('#dlg-lightbox');
    let index = start;
    const render = () => {
      const image = images[index];
      dialog.innerHTML = `
        <div class="lightbox__bar">
          <span class="lightbox__title">${U.esc(title)}${images.length > 1 ? ` · ${index + 1}/${images.length}` : ''}</span>
          <button type="button" class="btn btn--icon btn--on-dark" data-lb="close" aria-label="Close">${icon('x')}</button>
        </div>
        <div class="lightbox__stage" data-lb="close">${imageTag(image, { thumb: false, alt: title, className: 'lightbox__img' })}</div>
        ${images.length > 1 ? `
          <button type="button" class="lightbox__nav lightbox__nav--prev" data-lb="prev" aria-label="Previous image">${icon('back')}</button>
          <button type="button" class="lightbox__nav lightbox__nav--next" data-lb="next" aria-label="Next image">${icon('chevronRight')}</button>` : ''}`;
      hydrateImages(dialog);
    };
    const step = (delta) => {
      index = (index + delta + images.length) % images.length;
      render();
    };
    dialog.onclick = (event) => {
      const target = event.target.closest('[data-lb]');
      if (!target) return;
      if (event.target.tagName === 'IMG') return;
      const action = target.dataset.lb;
      if (action === 'close') closeSheet(dialog);
      if (action === 'prev') step(-1);
      if (action === 'next') step(1);
    };
    dialog.onkeydown = (event) => {
      if (event.key === 'ArrowLeft') step(-1);
      if (event.key === 'ArrowRight') step(1);
    };
    render();
    openSheet(dialog);
  }

  /** Click handlers by `data-action` name; modules add their own, app.js dispatches. */
  App.actions = App.actions || {};

  App.ui = {
    $,
    $$,
    openSheet,
    closeSheet,
    bindDismiss,
    toast,
    errorToast,
    confirm,
    formDialog,
    progress,
    imageTag,
    hydrateImages,
    handleImageError,
    lightbox,
  };
})(window.App = window.App || {});
