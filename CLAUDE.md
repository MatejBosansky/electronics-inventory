# Notes for AI assistants

## Project rules

- Everything in this repository is in English: code, comments, UI texts, docs, commit messages.
  No UI translations.
- The repository is meant to be shareable: never commit inventory data (`data/` is git-ignored),
  personal details, host names, IP addresses or passwords.
- No build step. The web app has no dependencies and must keep working when `app/index.html` is
  opened from disk (`file://`), so it uses classic `<script>` files, not ES modules or `fetch()` of
  local files. The server uses the Python 3.9+ standard library only (Pillow is optional).
- Each app script attaches to the global `App` namespace; load order is defined in `app/index.html`.
  Escape every value that goes into HTML with `App.util.esc`. Click handlers are registered by
  `data-action` name in `App.actions` and dispatched from `app/js/app.js`.

## Architecture

- `app/js/defaults.js` — default categories and properties. The part between the BEGIN/END markers
  must stay strict JSON: the server reads it too.
- `app/js/schema.js` — data format and normalization; `server/inventory/model.py` mirrors it and both
  must produce the same JSON (keys, order, formatting).
- `app/js/storage.js` — `ServerFS` (WebDAV-style `data/`, conditional saves through
  `PUT api/inventory.json` with `If-Match`), `FolderFS` (File System Access API), `BrowserFS`
  (IndexedDB). Same file layout everywhere.
- `app/js/store.js` — every change goes through `commit()`, which reloads when the file changed
  elsewhere and retries on conflicts.
- `server/inventory/operations.py` — the operation registry: one definition per operation gives the
  MCP tool, the REST route and the OpenAPI entry. `store.py` does transactional writes and snapshots,
  `mcp.py` the JSON-RPC protocol, `web.py` HTTP (app, `/data/`, `/api/`, `/mcp`).
- `docker/nginx.conf` — what the `web` container serves and which paths are writable; it proxies
  `/api/` and `/mcp` to the `api` container. `server/inventory/web.py` must stay compatible with it
  (same `/data/` paths, methods, headers, ETags and JSON listings).

## Testing changes

```bash
for f in app/js/*.js; do node --check "$f"; done
python3 server/inventory_server.py --data /tmp/inventory-test --port 8765
```

Open http://localhost:8765 and try the change on desktop and mobile widths, light and dark theme
("Load example parts" on an empty inventory gives test data). Test the API with curl
(`/api/parts`, `/api/openapi.json`) and MCP with JSON-RPC POSTs to `/mcp`, or
`--stdio --data /tmp/inventory-test` with JSON lines on stdin.

## Working with someone's inventory

Prefer the MCP tools (or the REST API) over editing `inventory.json` by hand — they validate input,
download and resize photos, keep snapshots and never lose concurrent changes. Usual flow:
`get_schema` → `search_parts` (avoid duplicates) → `add_parts` / `update_part` / `adjust_stock`.
Reuse existing category ids, property keys and location codes. See `docs/AGENTS.md`.

If only the files are available (no server), edit `inventory.json` following
`docs/DATA_FORMAT.md`: keep 2-space indentation, unique slug ids, ISO timestamps, and add photos to
`images/` (≤ 1600 px) with thumbnails in `images/thumbs/` (≤ 480 px) under new, unique file names.
