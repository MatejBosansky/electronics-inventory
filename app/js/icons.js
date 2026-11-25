/* Electronics Inventory — inline SVG icon set (24×24, stroked with currentColor). */
(function (App) {
  'use strict';

  const DOT = 'stroke-width="2.6"';

  const ICONS = {
    // Interface
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    chevronDown: '<path d="m6 9 6 6 6-6"/>',
    arrowUp: '<path d="M12 19V5M6 11l6-6 6 6"/>',
    arrowDown: '<path d="M12 5v14M6 13l6 6 6-6"/>',
    arrowLeft: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    filter: '<path d="M4 5h16l-6 7.5V18l-4 2v-7.5L4 5z"/>',
    grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
    list: `<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01" ${DOT}/>`,
    settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
    edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L7 19.5"/>',
    camera: '<path d="M4 8h3l1.8-2.5h6.4L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    box: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9"/>',
    pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L11.6 6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.6-1.6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    database: '<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6"/><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3"/>',
    server: `<rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01" ${DOT}/>`,
    tag: '<path d="M3.5 12.5v-8a1 1 0 0 1 1-1h8l8 8a1.4 1.4 0 0 1 0 2l-7 7a1.4 1.4 0 0 1-2 0z"/><circle cx="8" cy="8" r="1.5"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01" stroke-width="3"/>',
    history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3.5 4v4h4"/><path d="M12 8v4.5l3 2"/>',
    alert: '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>',
    sort: '<path d="M4 7h10M4 12h7M4 17h4M17 5v14M14 16l3 3 3-3"/>',
    file: '<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4"/>',
    // Categories
    board: '<rect x="3" y="6" width="18" height="13" rx="2"/><rect x="7.5" y="10" width="5" height="5" rx="1"/><path d="M15.5 10.5h2M15.5 14.5h2M6 6V3.5M9.5 6V3.5M13 6V3.5M16.5 6V3.5"/>',
    wireless: '<path d="M12 13v8"/><circle cx="12" cy="11" r="2"/><path d="M8.2 7.2a5.4 5.4 0 0 0 0 7.6M15.8 7.2a5.4 5.4 0 0 1 0 7.6M5.4 4.4a9.4 9.4 0 0 0 0 13.2M18.6 4.4a9.4 9.4 0 0 1 0 13.2"/>',
    sensor: '<path d="M3 12h4l2.5-6 5 12 2.5-6h4"/>',
    display: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    power: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    motor: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 4v5.5M12 14.5V20M4 12h5.5M14.5 12H20"/>',
    switch: '<rect x="2.5" y="7.5" width="19" height="9" rx="4.5"/><circle cx="16.5" cy="12" r="2.5"/>',
    led: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3z"/>',
    audio: '<path d="M11 5 6.5 9h-3v6h3L11 19z"/><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12"/>',
    input: '<rect x="4" y="13" width="16" height="7" rx="2"/><path d="M12 13V8.5"/><circle cx="12" cy="6" r="2.5"/>',
    chip: '<rect x="5" y="5" width="14" height="14" rx="2.5"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 2.5V5M15 2.5V5M9 19v2.5M15 19v2.5M2.5 9H5M2.5 15H5M19 9h2.5M19 15h2.5"/>',
    transistor: '<circle cx="12" cy="12" r="8.5"/><path d="M10 7.5v9M3.5 12H10M10 10l5-3.5V3.5M10 14l5 3.5v3"/>',
    resistor: '<path d="M2.5 12H6l1.5-3.5 3 7 3-7 3 7 1.5-3.5h3.5"/>',
    plug: '<path d="M9 3v5M15 3v5M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0z"/><path d="M12 17v4"/>',
    usb: '<circle cx="12" cy="19.5" r="1.8"/><path d="M12 17.7V4M9.5 6.5 12 4l2.5 2.5M12 14.5 8 12V9.5M12 12.5l4-2V8"/><rect x="14.8" y="5.6" width="2.4" height="2.4"/><circle cx="8" cy="8.3" r="1.2"/>',
    hub: '<rect x="6" y="7.5" width="15.5" height="9" rx="2"/><path d="M2.5 12H6M9.5 12h2M13.5 12h2M17.5 12h1"/>',
    droplet: '<path d="M12 3.5c-3.3 4.1-5.5 7.3-5.5 10.3a5.5 5.5 0 0 0 11 0c0-3-2.2-6.2-5.5-10.3z"/><path d="M9.3 14.3a2.8 2.8 0 0 0 2.4 2.6"/>',
    wrench: '<path d="M14.5 4.5a4.5 4.5 0 0 0-5.3 6l-5.7 5.7a2 2 0 0 0 2.8 2.8l5.7-5.7a4.5 4.5 0 0 0 6-5.3l-2.7 2.7-2.6-.6-.6-2.6z"/>',
    nut: '<path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z"/><circle cx="12" cy="12" r="3.2"/>',
    shapes: '<circle cx="7.5" cy="7.5" r="3.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><path d="m7.5 13.5 4 6.5h-8z"/><circle cx="16.5" cy="16.5" r="3.5"/>',
  };

  /** Icons offered for categories in the settings. */
  const CATEGORY_ICONS = [
    'board', 'wireless', 'sensor', 'display', 'power', 'motor', 'switch', 'led', 'audio',
    'input', 'chip', 'transistor', 'resistor', 'plug', 'usb', 'hub', 'wrench', 'nut', 'droplet', 'shapes', 'box',
  ];

  function icon(name, className = '') {
    const body = ICONS[name] || ICONS.shapes;
    return `<svg class="icon${className ? ` ${className}` : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  App.icon = icon;
  App.CATEGORY_ICONS = CATEGORY_ICONS;
})(window.App = window.App || {});
