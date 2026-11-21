# Electronics Inventory

A small, self-hosted web app for keeping track of electronic components: development boards,
sensors, displays, modules, passives and everything else in your boxes.

- **Browse by category** with photos, quantities and the box each part is stored in.
- **Filter by properties**: Wi-Fi standard, Bluetooth version, Thread, Zigbee, interfaces, display
  type, sensor type, … — filters are built automatically from the properties your parts have.
- **Locations with quantities**: a part can be split across several boxes (e.g. 2 in `A1`, 8 in `K2`),
  amounts can be unknown, and `−`/`+` buttons update stock when you take something out.
- **Add, edit and remove parts** in the app, including photos straight from a phone camera
  (scaled down automatically, thumbnails are generated).
- **AI agents**: an MCP server and a REST API let assistants such as Claude search the inventory,
  add parts, update stock and attach photos.
- **Customizable**: categories, properties (fields) and locations are edited in Settings.
- **Mobile and desktop layouts**, light and dark theme.
- **Your data is plain files**: one `inventory.json` plus an `images/` folder. Back it up by copying
  the folder, or download a ZIP from the app. Automatic daily snapshots of `inventory.json`.
- **No build step**: plain HTML, CSS and JavaScript; the server is Python 3 standard library
  (Pillow optional, for resizing photos added through the API).

## Running it

There are three ways to run the app. All of them use the same data layout, so a data folder can be
moved between them.

### 1. Docker (home server, NAS, Raspberry Pi, Jetson, …)

```bash
git clone <this repository> electronics-inventory
cd electronics-inventory
cp .env.example .env        # optional: port, data folder, file owner, password
docker compose up -d --build
```

Open `http://<server>:8080`. Two containers are started:

- `web` — nginx with the app and the data folder,
- `api` — the REST API (`/api/`) and the MCP server (`/mcp`), reached through `web`.

The images build on amd64 and arm64. The database lives in `./data` next to `docker-compose.yml`
(configurable with `INVENTORY_DATA`). Set `PUID`/`PGID` in `.env` to your user's ids (`id -u`,
`id -g`) so the files in the data folder belong to you. To update:
`git pull && docker compose up -d --build`.

### 2. Open `app/index.html` directly (no server)

Double-click `app/index.html`. On first start the app asks where to keep the data:

- **Open a data folder** (Chrome, Edge and other Chromium-based browsers): the app reads and writes
  `inventory.json` and the photos in a folder you choose, exactly like the server does. You can use
  the `data/` folder of this repository (it is ignored by git) or a copy of the server's data folder.
- **Keep it in this browser** (any browser): the data stays in the browser's storage (IndexedDB).
  Use *Settings → Data & backup → Full backup* regularly.

The MCP server and the REST API need the server (option 1 or 3).

### 3. Python server without Docker

```bash
python3 server/inventory_server.py                 # http://localhost:8000, data in ./data
python3 server/inventory_server.py --data ~/inventory-data --port 8080
```

One process serves the app, the data folder, the REST API and the MCP server. It needs Python 3.9+
and nothing else; with Pillow installed (`pip install pillow`) photos added through the API are
scaled down too. It listens on `127.0.0.1` by default; `--host 0.0.0.0` makes it reachable from
other devices (there is no password).

## AI agents: MCP and REST API

With the server running, the same set of operations is available as MCP tools and as REST
endpoints:

| Tool | What it does |
| --- | --- |
| `get_overview` | Counts per category and location, stock status, recent changes |
| `get_schema` | Category ids, properties (with types and suggested values), location codes |
| `search_parts` | Text search plus filters: category, location, stock, tags, property values |
| `get_part` | All details of a part (optionally with its photo) |
| `add_parts` | Add one or many parts (with photo URLs); skips duplicates by name |
| `update_part` | Change fields; properties are merged |
| `adjust_stock` / `set_stock` / `move_stock` | Take out / add pieces, set or move stock |
| `add_image` | Attach a photo from a URL or base64 data |
| `delete_part` | Remove a part |
| `upsert_location`, `delete_location`, `upsert_field`, `upsert_category` | Manage boxes, properties, categories |

Connect **Claude Code** (Settings → General in the app shows the exact address):

```bash
claude mcp add --transport http inventory http://<server>:8080/mcp
```

The **REST API** is described at `/api/openapi.json`, e.g. boards with Thread (any version):

```bash
curl 'http://<server>:8080/api/parts?category=dev-boards&spec.thread=*'
```

Clients that only support stdio (e.g. Claude Desktop) can use the server script as a bridge, and the
MCP server can also run directly on a local data folder. See [docs/AGENTS.md](docs/AGENTS.md) for
client configuration, all endpoints and the filter syntax.

Changes made by agents show up in the open app within about 10 seconds. While the API is running,
concurrent writes never overwrite each other: the API applies changes in transactions, and the app
saves through the server with `If-Match`, re-applying its change when someone else saved in between.

## Data and backups

```
data/
  inventory.json        the whole database: parts, categories, properties, locations
  images/               photos (resized to max. 1600 px)
  images/thumbs/        thumbnails for the lists
  backups/              automatic snapshots of inventory.json (one per day, newest 40 kept)
```

- **Back up** by copying the data folder (e.g. `rsync -a data/ /backup/inventory/`), or use
  *Settings → Data & backup → Full backup (.zip)*. The ZIP has the same layout and can be unzipped
  and used as a data folder.
- **Restore** in *Settings → Data & backup* from a ZIP, an `inventory.json` or a data folder.
  The current state is saved as a snapshot first.
- **Snapshots**: before the first change of each day the previous `inventory.json` is copied to
  `backups/`. They can be restored in the app; photos are not part of snapshots.
- **Export** to CSV for spreadsheets.
- Deleting a part keeps its photos; *Find unused photos* in Settings removes them.

The format of `inventory.json` is described in [docs/DATA_FORMAT.md](docs/DATA_FORMAT.md).

## Configuration (Docker)

All settings are optional; put them in `.env` (see `.env.example`).

| Variable | Default | Meaning |
| --- | --- | --- |
| `INVENTORY_PORT` | `8080` | Port on the host |
| `INVENTORY_BIND` | `0.0.0.0` | Host address to listen on |
| `INVENTORY_DATA` | `./data` | Data folder on the host |
| `PUID` / `PGID` | `1000` | Owner of the files written into the data folder |
| `AUTH_USER` / `AUTH_PASSWORD` | empty | Enables HTTP basic auth (app, API and MCP) when both are set |
| `INVENTORY_PUBLIC_URL` | empty | Address used in links returned by the API, e.g. `http://server:8080` |

## Security

The app has no user accounts. Anyone who can open it can also change the data — through the app,
the data folder, the REST API or MCP. Keep it on your LAN or behind a VPN such as
[Tailscale](https://tailscale.com/), or set `AUTH_USER` and `AUTH_PASSWORD` (then MCP and API clients
must send an `Authorization: Basic …` header). If you expose it to the internet, put it behind HTTPS
(a reverse proxy) *and* use basic auth. Write requests from other websites are refused (Origin check),
and the API does not download photos from local addresses.

With Tailscale you can also get HTTPS inside your tailnet with
`tailscale serve --bg http://localhost:8080`.

## Data folder over HTTP

The web app reads and writes the data folder directly under `/data/` (served by nginx in Docker, or
by the Python server):

| Path | Methods |
| --- | --- |
| `/data/inventory.json` | `GET`, `HEAD`, `PUT` |
| `/data/images/<file>`, `/data/images/thumbs/<file>`, `/data/backups/<file>` | `GET`, `HEAD`, `PUT`, `DELETE` |
| `/data/<dir>/` | `GET` → JSON directory listing |

Scripts and agents should prefer the REST API or MCP, which validate input and never lose
concurrent changes.

## Project layout

```
app/                     the web app (index.html, css/, js/, icons/)
  js/defaults.js         default categories and properties (shared with the server)
  js/schema.js           data format and normalization
  js/storage.js          storage back ends: server, local folder, browser
  js/store.js            loading, saving, conflict handling, snapshots
server/inventory_server.py   server: app, data folder, REST API, MCP (also stdio)
server/inventory/        data model, operations, MCP and HTTP handling
server/Dockerfile        image of the "api" container
docker/                  nginx config and start-up script of the "web" image
tools/make_icons.py      renders the PNG app icons
docs/                    data format and agent documentation
```

## Browser support

Current versions of Chrome, Edge, Firefox and Safari (desktop and mobile). The *data folder*
option of the file mode needs a Chromium-based browser; everything else works everywhere.
