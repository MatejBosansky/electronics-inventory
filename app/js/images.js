/* Electronics Inventory — image preparation before saving.
 * Photos (e.g. from a phone camera) are scaled down and a small thumbnail is created for the lists. */
(function (App) {
  'use strict';

  const FULL_MAX = 1600;
  const THUMB_MAX = 480;
  const KEEP_ORIGINAL_BYTES = 700 * 1024;
  const KEEPABLE = ['image/jpeg', 'image/png', 'image/webp'];
  const ACCEPT = 'image/*';
  const EXTENSIONS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif' };

  let webpSupported = null;

  function canEncodeWebp() {
    if (webpSupported === null) {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      webpSupported = canvas.toDataURL('image/webp').startsWith('data:image/webp');
    }
    return webpSupported;
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve({ img, url });
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`“${blob.name || 'file'}” is not an image this browser can read.`));
      };
      img.src = url;
    });
  }

  function drawScaled(source, width, height, max) {
    const scale = Math.min(1, max / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function hasTransparency(canvas) {
    const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 3; i < data.length; i += 16) if (data[i] < 250) return true;
    return false;
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image.'))), type, quality);
    });
  }

  async function encode(canvas, mayHaveAlpha, quality) {
    if (canEncodeWebp()) {
      const blob = await toBlob(canvas, 'image/webp', quality);
      if (blob.type === 'image/webp') return blob;
    }
    if (mayHaveAlpha && hasTransparency(canvas)) return toBlob(canvas, 'image/png');
    return toBlob(canvas, 'image/jpeg', quality);
  }

  /**
   * Prepares an image file for storage.
   * @param {Blob} file
   * @returns {Promise<{full: {blob: Blob, ext: string}, thumb: {blob: Blob, ext: string}}>}
   */
  async function prepare(file) {
    const { img, url } = await loadImage(file);
    try {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (!width || !height) throw new Error('The image has no size.');
      const mayHaveAlpha = file.type !== 'image/jpeg';
      const fullCanvas = drawScaled(img, width, height, FULL_MAX);
      const keepOriginal = Math.max(width, height) <= FULL_MAX
        && file.size <= KEEP_ORIGINAL_BYTES
        && KEEPABLE.includes(file.type);
      const full = keepOriginal ? file : await encode(fullCanvas, mayHaveAlpha, 0.86);
      const thumbCanvas = drawScaled(fullCanvas, fullCanvas.width, fullCanvas.height, THUMB_MAX);
      const thumb = await encode(thumbCanvas, mayHaveAlpha, 0.8);
      return {
        full: { blob: full, ext: EXTENSIONS[full.type] || 'jpg' },
        thumb: { blob: thumb, ext: EXTENSIONS[thumb.type] || 'jpg' },
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  App.images = { prepare, ACCEPT };
})(window.App = window.App || {});
