# AI agents: MCP server and REST API

The server (`server/inventory_server.py`, the `api` container in Docker) exposes one set of
operations in two ways:

- **MCP** (Model Context Protocol) at `/mcp` — for AI assistants such as Claude Code, Claude Desktop
  or IDE agents. Each operation is a tool.
- **REST** under `/api/` — for scripts and other tools. Described by `/api/openapi.json`.

Both work on the same data as the web app; changes appear in an open app within about 10 seconds.

## Connecting MCP clients

The server speaks the *Streamable HTTP* transport (JSON responses, no sessions) and supports
protocol versions 2025-06-18, 2025-03-26 and 2024-11-05.

**Claude Code**

```bash
claude mcp add --transport http inventory http://server:8080/mcp
```

With basic auth enabled (`AUTH_USER` / `AUTH_PASSWORD`):

```bash
claude mcp add --transport http inventory http://server:8080/mcp \
  --header "Authorization: Basic $(printf '%s' 'user:password' | base64)"
```

**Clients that only support stdio** (e.g. Claude Desktop): run the server script as a bridge to the
running server. In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "inventory": {
      "command": "python3",
      "args": ["/path/to/electronics-inventory/server/inventory_server.py", "--stdio",
               "--remote", "http://server:8080/mcp"]
    }
  }
}
```

Add `"--header", "Authorization: Basic …"` to `args` when basic auth is enabled.

**Without a server**, the MCP server can work directly on a local data folder (for example the folder
the web app uses in file mode):

```json
{
  "mcpServers": {
    "inventory": {
      "command": "python3",
      "args": ["/path/to/electronics-inventory/server/inventory_server.py", "--stdio",
               "--data", "/path/to/inventory-data"]
    }
  }
}
```

## Tools / endpoints

| Tool (MCP) | REST | Purpose |
| --- | --- | --- |
| `get_overview` | `GET /api/overview` | Counts per category, place and location, stock status, recent changes |
| `get_schema` | `GET /api/schema` | Categories, properties (key, label, type, unit, options), locations, places |
| `search_parts` | `GET /api/parts` | Search and filter; returns summaries |
| `get_part` | `GET /api/parts/{id}` | Full details, property labels, photo URLs (MCP: optionally the photo) |
| `add_parts` | `POST /api/parts` | Add up to 200 parts; `image_urls` are downloaded |
| `update_part` | `PATCH /api/parts/{id}` | Change fields; `specs` are merged, `null` removes a property |
| `delete_part` | `DELETE /api/parts/{id}` | Remove a part (returns it) |
| `adjust_stock` | `POST /api/parts/{id}/stock/adjust` | `{location, delta}` — e.g. `-2` when two were used |
| `set_stock` | `PUT /api/parts/{id}/stock` | Replace all `{location, qty}` rows |
| `move_stock` | `POST /api/parts/{id}/stock/move` | Move pieces between locations |
| `add_image` | `POST /api/parts/{id}/images` | Photo from `url` or `data_base64` (REST also: raw image body) |
| `upsert_location` | `PUT /api/locations/{code}` | Create or edit a box (name, `place`, color, notes); `rename_to` updates all parts |
| `delete_location` | `DELETE /api/locations/{code}?move_to=` | Remove a box, moving its stock |
| `upsert_field` | `POST /api/fields` | Define a property and add it to categories |
| `upsert_category` | `POST /api/categories` | Create or edit a category |

Errors are returned as MCP tool results with `isError: true`, and by REST as
`{"error": {"code", "message"}}` with an HTTP status (400, 404, 409, …).

### Searching

`search_parts` arguments: `query` (all words must match name, description, notes, tags, property
values or locations), `category`, `location` (`"none"` = unassigned), `place` (one or more places:
parts with stock in any of them; REST: comma separated), `in_stock`, `tags`, `sort`
(`name`, `updated`, `created`, `quantity`), `limit`, `offset` and `specs` — property conditions that
must all match:

| Condition | Meaning |
| --- | --- |
| `{"zigbee": true}` | yes/no property is yes |
| `{"thread": "*"}` | has any value (here: any Thread version) |
| `{"mcu": "ESP32-C6"}` | equals (case-insensitive; for list properties: contains) |
| `{"bluetooth": ["5.0", "5.3"]}` | any of these values |
| `{"diagonal": {"min": 1, "max": 2}}` | numeric range |

REST uses query parameters: `?query=esp32&category=dev-boards&spec.thread=1.3,1.4&spec.bluetooth=5.0,5.3`
and `spec.diagonal.min=1`.

### Places

Locations can belong to a place, e.g. Place 1 and Place 2, or the stock of an e-shop (`place` on the
location, `""` = none; `get_schema` lists the places). `search_parts` with `place` (one name or a
list) returns parts that have stock in any of them, and stock rows in results name the place of
their location, so "how many are in Place 2" is the sum of the rows with that place. Put a box into
a place with `upsert_location {"code": "N1", "place": "Place 2"}`; a name differing only in case
joins the existing place.

### Adding parts

```json
{
  "parts": [{
    "name": "ESP32-C6-DevKitC-1",
    "category": "dev-boards",
    "description": "Espressif board with Wi-Fi 6, BLE 5.3 and 802.15.4.",
    "tags": ["espressif"],
    "stock": [{"location": "A1", "qty": 2}, {"location": "K2", "qty": null}],
    "specs": {"mcu": "ESP32-C6", "wifi": "Wi-Fi 6 (2.4 GHz)", "bluetooth": "5.3", "thread": "1.3"},
    "links": [{"label": "Datasheet", "url": "https://example.com/esp32-c6.pdf"}],
    "image_urls": ["https://example.com/esp32-c6.jpg"]
  }]
}
```

- Use category ids, property keys and location codes from `get_schema`. Unknown location codes are
  created; unknown property keys are stored and reported as warnings (define them with
  `upsert_field`).
- A part whose name already exists is skipped (`on_duplicate: "add"` adds it anyway). To record more
  pieces of an existing part use `adjust_stock`.
- `qty: null` means the amount is unknown.

## Consistency

- Every change is a transaction: the server reads `inventory.json`, applies the change and replaces
  the file atomically, retrying if the file was changed in the meantime.
- The web app saves through `PUT /api/inventory.json` with `If-Match` when the API is available, so
  changes from the app and from agents never overwrite each other.
- Before the first change of each day the previous `inventory.json` is copied to `backups/`.
- Photos are stored in `images/` (max. 1600 px) with thumbnails in `images/thumbs/` when Pillow is
  installed (it is in the Docker image).
