# inventory.json — data format (version 2)

The whole inventory is a single JSON document, `inventory.json`, stored in the data folder next to
the `images/` folder. The app writes it pretty-printed (2 spaces) with a stable key order, so it
diffs well and is easy to edit by hand or with scripts.

The app is forgiving when reading: missing fields get defaults, unknown categories and locations
referenced by parts are added automatically, and invalid values are dropped. It refuses to open a
file that is not valid JSON (and offers to restore a snapshot instead).

## Top level

```json
{
  "format": "electronics-inventory",
  "version": 2,
  "updatedAt": "2026-01-15T18:30:00Z",
  "settings": { "title": "Electronics Inventory" },
  "fields": [ … ],
  "categories": [ … ],
  "locations": [ … ],
  "parts": [ … ]
}
```

| Key | Description |
| --- | --- |
| `format` | Always `"electronics-inventory"`. |
| `version` | Format version. The app refuses files with a newer version than it knows and saves older ones in the current version (2 added `place` to locations). |
| `updatedAt` | Time of the last change (ISO 8601, UTC). |
| `settings.title` | Name shown in the header. |
| `fields` | Property definitions (see below). If missing, the defaults are used. |
| `categories` | Categories and the properties each uses. If missing, the defaults are used. |
| `locations` | Boxes, drawers, shelves. |
| `parts` | The parts. |

## Fields (properties)

```json
{ "key": "bluetooth", "label": "Bluetooth", "type": "select", "options": ["4.2", "5.0", "5.3"] }
```

| Key | Description |
| --- | --- |
| `key` | Identifier used in `part.specs`. Letters, digits, `_` and `-`, starting with a letter. |
| `label` | Display name. |
| `type` | `text`, `number`, `select` (one value), `multi` (list of values) or `bool`. |
| `unit` | Optional unit shown after the value, e.g. `"MHz"`. |
| `options` | Optional suggested values for `select` and `multi`. Other values are allowed too. |

Every property becomes a filter when parts in the current view have different values for it, or
when only some of them have it (the filter then also offers "Any").
In the "All parts" view only properties used by parts of several categories are offered.

Some default keys: `mcu`, `chip`, `wifi`, `bluetooth`, `bluetoothClassic`, `thread`, `zigbee`,
`lora`, `ethernet`, `protocols`, `interfaces`, `flash`, `psram`, `usbConnector`, `usbSerial`,
`logicLevel`, `measures`, `displayType`, `diagonal`, `resolution`, `driver`, `powerType`,
`inputVoltage`, `outputVoltage`, `maxCurrent`, `supplyVoltage`, `package`, `value`.
See `app/js/defaults.js` for the full list.

## Categories

```json
{ "id": "dev-boards", "name": "Development boards", "icon": "board", "fields": ["mcu", "wifi", "bluetooth"] }
```

`fields` lists the property keys used by the category, in display order (form, detail, filters).
Default category ids: `dev-boards`, `comm`, `sensors`, `displays`, `power`, `motors`, `switching`,
`leds`, `audio`, `input`, `ics`, `discretes`, `passives`, `connectors`, `adapters`, `tools`,
`mechanical`, `other`. Icons: see `CATEGORY_ICONS` in `app/js/icons.js`.

## Locations

```json
{ "code": "A1", "name": "Blue organizer", "place": "Place 1", "color": "#2563eb", "notes": "Shelf above the desk" }
```

`code` is the short label written on the box and the identifier used by parts (unique, compared
case-insensitively). `color` is a `#rrggbb` color used for the dot shown next to the code.
`place` groups locations by where they are (e.g. `"Place 1"` and `"Place 2"`, or the stock of an
e-shop); `""` means none. Places are just these names: the app lists the distinct ones and can show
the parts of one place at a time. Names differing only in case are merged into the first spelling.

## Parts

```json
{
  "id": "esp32-c6-devkitc-1",
  "name": "ESP32-C6-DevKitC-1",
  "category": "dev-boards",
  "description": "Espressif development board with Wi-Fi 6, BLE 5.3 and 802.15.4.",
  "tags": ["espressif", "matter"],
  "stock": [
    { "location": "A1", "qty": 2 },
    { "location": "K2", "qty": null }
  ],
  "specs": {
    "mcu": "ESP32-C6",
    "wifi": "Wi-Fi 6 (2.4 GHz)",
    "bluetooth": "5.3",
    "thread": "1.3",
    "interfaces": ["I2C", "SPI", "UART"]
  },
  "images": [
    { "src": "images/esp32-c6-devkitc-1-a8k2p.jpg", "thumb": "images/thumbs/esp32-c6-devkitc-1-a8k2p.webp" }
  ],
  "links": [{ "label": "Datasheet", "url": "https://example.com/esp32-c6.pdf" }],
  "notes": "Free text, multiple lines.",
  "createdAt": "2026-01-15T18:30:00Z",
  "updatedAt": "2026-01-15T18:30:00Z"
}
```

| Key | Description |
| --- | --- |
| `id` | Unique, stable identifier (used in URLs: `#/part/<id>`). Generated from the name when created. |
| `name` | Required. |
| `category` | Category `id`. |
| `description` | Short description (one or two sentences). |
| `tags` | Free keywords; searchable and filterable. |
| `stock` | Where the part is and how many: `location` is a location code or `null` (unassigned), `qty` a number or `null` when unknown. The total quantity is the sum. An empty list means the part is not stored anywhere (out of stock). |
| `specs` | Property values by field key: strings, numbers, booleans or lists of strings (for `multi`). Keys without a field definition are shown as plain text. |
| `images` | Photos, first one is the cover. `src` is a path inside the data folder (`images/…`) or an `http(s)` URL; `thumb` is optional (the list then uses `src`). |
| `links` | Datasheets, shops, documentation: `{ "label", "url" }` with `http(s)` URLs. |
| `notes` | Free text. URLs become links. |
| `createdAt` / `updatedAt` | ISO 8601 timestamps. |

Shorthand accepted when reading (normalized on the next save): `"quantity": 3, "location": "A1"`
instead of `stock`, and plain strings in `images` and `links`.

## Images

- Stored in `images/`, thumbnails in `images/thumbs/`.
- File names: letters, digits, `.`, `_` and `-`, starting with a letter or digit (other names are
  rejected by the server). The app uses `<part-name-slug>-<random>.<ext>`.
- Never overwrite an existing image with different content; add a new file and reference it, so
  browsers do not show a cached old picture.
- Recommended size: max. 1600 px for `src`, max. 480 px for `thumb` (JPEG, PNG or WebP).

## Snapshots

`backups/inventory-YYYY-MM-DD.json` holds the state before the first change of that day;
`backups/inventory-YYYY-MM-DD-HHMMSS-<reason>.json` are made manually or before a restore. The
newest 40 are kept.
