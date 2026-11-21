"""HTTP server: the web app, the data folder (WebDAV-style, like the nginx image), the REST API and MCP.

    /            the app (static files)                     -- unless api_only
    /data/...    GET, HEAD, PUT, DELETE + JSON listings     -- unless api_only
    /api/...     REST API (see /api/openapi.json)
    /mcp         MCP, Streamable HTTP transport (JSON responses)
"""
import email.utils
import json
import logging
import mimetypes
import os
import re
import shutil
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

from . import __version__, images, model, openapi
from .mcp import PROTOCOL_VERSIONS, McpServer
from .operations import OPERATIONS, Context
from .store import DELETABLE_RE, INVENTORY, WRITABLE_RE, InventoryError

MAX_BODY = 40 * 1024 * 1024
ROUTES = [(re.compile("^" + re.sub(r"{(\w+)}", r"(?P<\1>[^/]+)", op.path) + "/?$"), op) for op in OPERATIONS]

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/webp", ".webp")
mimetypes.add_type("image/avif", ".avif")
mimetypes.add_type("text/javascript", ".js")

log = logging.getLogger("inventory.web")


def http_date(timestamp):
    return email.utils.formatdate(timestamp, usegmt=True)


def etag(stat):
    """Same format as nginx: "<mtime seconds hex>-<size hex>"."""
    return f'"{int(stat.st_mtime):x}-{stat.st_size:x}"'


class InventoryHTTPServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, store, *, app_dir=None, api_only=False, public_url=None):
        super().__init__(address, Handler)
        self.store = store
        self.app_dir = Path(app_dir).resolve() if app_dir else None
        self.api_only = api_only
        self.public_url = public_url
        self.mcp = McpServer(store, public_url)


class Handler(BaseHTTPRequestHandler):
    server_version = f"ElectronicsInventory/{__version__}"

    # ------------------------------------------------------------------ plumbing

    def log_message(self, fmt, *args):
        if "/api/health" not in self.path:
            log.info("%s %s", self.address_string(), fmt % args)

    @property
    def url_path(self):
        return unquote(urlsplit(self.path).path)

    def base_url(self):
        if self.server.public_url:
            return self.server.public_url
        host = self.headers.get("X-Forwarded-Host") or self.headers.get("Host")
        if not host:
            return None
        scheme = self.headers.get("X-Forwarded-Proto") or "http"
        prefix = (self.headers.get("X-Forwarded-Prefix") or "").rstrip("/")
        return f"{scheme}://{host.split(',')[0].strip()}{prefix}/"

    def origin_allowed(self):
        """Blocks cross-site requests from browsers (CSRF / DNS rebinding); non-browser clients send no Origin."""
        origin = self.headers.get("Origin")
        if not origin or origin == "null":
            return origin is None
        host = (self.headers.get("X-Forwarded-Host") or self.headers.get("Host") or "").split(",")[0].strip()
        return urlsplit(origin).netloc.lower() == host.lower()

    def read_body(self):
        length = self.headers.get("Content-Length")
        if length is None:
            if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
                raise InventoryError("Chunked request bodies are not supported; send Content-Length.", 411,
                                     "length_required")
            return b""
        size = int(length)
        if size > MAX_BODY:
            raise InventoryError("Request body too large.", 413, "too_large")
        data = b""
        while len(data) < size:
            chunk = self.rfile.read(min(size - len(data), 1 << 16))
            if not chunk:
                break
            data += chunk
        if len(data) < size:
            raise InventoryError("Incomplete request body.", 400, "bad_request")
        return data

    def send_bytes(self, status, body, content_type, headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

    def send_json(self, status, data, headers=None):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_bytes(status, body, "application/json; charset=utf-8", headers)

    def send_error_json(self, status, code, message, headers=None):
        self.send_json(status, {"error": {"code": code, "message": message}}, headers)

    # ------------------------------------------------------------------ methods

    def do_GET(self):
        self.dispatch()

    def do_HEAD(self):
        self.dispatch()

    def do_POST(self):
        self.dispatch()

    def do_PUT(self):
        self.dispatch()

    def do_PATCH(self):
        self.dispatch()

    def do_DELETE(self):
        self.dispatch()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def dispatch(self):
        path = self.url_path
        try:
            if path == "/mcp" or path.startswith("/mcp/"):
                self.handle_mcp()
            elif path == "/api" or path.startswith("/api/"):
                self.handle_api(path)
            elif not self.server.api_only and (path == "/data" or path.startswith("/data/")):
                self.handle_data(path)
            elif not self.server.api_only and self.server.app_dir:
                self.handle_static(path)
            else:
                self.send_error_json(404, "not_found", "Not found")
        except InventoryError as err:
            self.send_error_json(err.status, err.code, err.message)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            log.error("Request %s %s failed:\n%s", self.command, self.path, traceback.format_exc())
            self.send_error_json(500, "internal_error", "Internal server error")

    # ------------------------------------------------------------------ MCP

    def handle_mcp(self):
        if not self.origin_allowed():
            self.send_error_json(403, "forbidden", "Cross-origin requests are not allowed.")
            return
        if self.command != "POST":
            self.send_error_json(405, "method_not_allowed", "Use POST (Streamable HTTP, JSON responses).",
                                 {"Allow": "POST"})
            return
        version = self.headers.get("MCP-Protocol-Version")
        if version and version not in PROTOCOL_VERSIONS:
            self.send_error_json(400, "unsupported_protocol_version", f"Unsupported MCP protocol version {version}.")
            return
        try:
            payload = json.loads(self.read_body() or b"null")
        except json.JSONDecodeError:
            self.send_json(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}})
            return
        response = self.server.mcp.handle_payload(payload, self.base_url())
        if response is None:
            self.send_response(202)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        body = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_bytes(200, body, "application/json")

    # ------------------------------------------------------------------ REST API

    def handle_api(self, path):
        if path.rstrip("/") in ("/api", ""):
            self.send_json(200, self.api_index())
            return
        if path == "/api/health":
            self.send_json(200, {"status": "ok", "version": __version__, "image_resizing": images.HAVE_PILLOW,
                                 "inventory_cas": True})
            return
        if path == "/api/inventory.json":
            self.put_inventory()
            return
        if path == "/api/openapi.json":
            self.send_json(200, openapi.document(self.base_url()))
            return
        if self.command not in ("GET", "HEAD") and not self.origin_allowed():
            self.send_error_json(403, "forbidden", "Cross-origin requests are not allowed.")
            return
        allowed = []
        for pattern, op in ROUTES:
            match = pattern.match(path)
            if not match:
                continue
            allowed.append(op.method)
            method = "GET" if self.command == "HEAD" else self.command
            if op.method != method:
                continue
            args = self.api_arguments(op, {key: unquote(value) for key, value in match.groupdict().items()})
            result = op.handler(Context(self.server.store, self.base_url()), args)
            if isinstance(result, dict):
                result.pop("_image", None)
            self.send_json(200, result)
            return
        if allowed:
            self.send_error_json(405, "method_not_allowed", f"Allowed: {', '.join(sorted(set(allowed)))}",
                                 {"Allow": ", ".join(sorted(set(allowed)))})
        else:
            self.send_error_json(404, "not_found", "Unknown API endpoint; see /api/ and /api/openapi.json.")

    def put_inventory(self):
        """Compare-and-swap write of the whole inventory.json, used by the web app.

        The app sends `If-Match: <ETag it based its change on>`; the file is replaced only if it is
        still that version (else 412 and the app re-applies its change on the newer file). This closes
        the gap between the app's read and write that plain WebDAV PUT leaves open.
        """
        if self.command != "PUT":
            self.send_error_json(405, "method_not_allowed", "Use PUT with If-Match.", {"Allow": "PUT"})
            return
        if not self.origin_allowed():
            self.send_error_json(403, "forbidden", "Cross-origin requests are not allowed.")
            return
        if_match = self.headers.get("If-Match")
        if not if_match:
            self.send_error_json(428, "precondition_required", "Send If-Match with the ETag of the version you read.")
            return
        body = self.read_body()
        store = self.server.store
        try:
            model.parse_inventory(body.decode("utf-8"), store.defaults)
        except (model.FormatError, UnicodeDecodeError) as err:
            raise InventoryError(f"Refusing to save an invalid inventory: {err}", 400, "invalid_inventory") from err
        wanted = [tag.strip().removeprefix("W/") for tag in if_match.split(",")]
        path = store.inventory_path
        with store._lock:
            before = store.signature(path)
            current = etag(path.stat()) if before else None
            if "*" not in wanted and current not in wanted:
                headers = {"ETag": current} if current else {}
                self.send_error_json(412, "precondition_failed", "inventory.json was changed elsewhere.", headers)
                return
            store.write_atomic(INVENTORY, body)
            store._ensure_new_etag(path, before)
            new_tag = etag(path.stat())
        self.send_response(204)
        self.send_header("ETag", new_tag)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def api_index(self):
        return {
            "name": "electronics-inventory",
            "version": __version__,
            "openapi": "/api/openapi.json",
            "mcp": "/mcp",
            "endpoints": [{"operation": op.name, "method": op.method, "path": op.path, "summary": op.title}
                          for op in OPERATIONS],
        }

    def api_arguments(self, op, path_args):
        query = parse_qsl(urlsplit(self.path).query, keep_blank_values=False)
        args = {}
        if op.method in ("GET", "DELETE"):
            specs = {}
            for name, value in query:
                if name in op.query:
                    args[name] = value
                elif name.startswith("spec.") and op.name == "search_parts":
                    self.add_spec_filter(specs, name[5:], value)
            if specs:
                args["specs"] = specs
        else:
            content_type = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            body = self.read_body()
            if op.name == "add_image" and content_type.startswith("image/"):
                args = {"_bytes": body, **{name: value for name, value in query if name == "cover"}}
            elif body.strip():
                try:
                    data = json.loads(body)
                except json.JSONDecodeError as err:
                    raise InventoryError(f"Invalid JSON body: {err}", 400, "invalid_json") from err
                if op.name == "add_parts" and isinstance(data, list):
                    data = {"parts": data}
                elif op.name == "add_parts" and isinstance(data, dict) and "parts" not in data:
                    data = {"parts": [data]}
                if not isinstance(data, dict):
                    raise InventoryError("The JSON body must be an object.", 400, "invalid_json")
                args = data
        args.update(path_args)
        return args

    @staticmethod
    def add_spec_filter(specs, key, value):
        if key.endswith(".min") or key.endswith(".max"):
            name, bound = key.rsplit(".", 1)
            specs.setdefault(name, {})[bound] = float(value)
        elif value in ("true", "false"):
            specs[key] = value == "true"
        elif "," in value:
            specs[key] = [item.strip() for item in value.split(",") if item.strip()]
        else:
            specs[key] = value

    # ------------------------------------------------------------------ data folder (like nginx)

    def handle_data(self, path):
        store = self.server.store
        rel = "/".join(part for part in path[len("/data"):].split("/") if part)
        storage_header = {"X-Inventory-Storage": "webdav"}
        if any(part.startswith(".") or part == ".." for part in rel.split("/") if part):
            self.send_bytes(403, b"Forbidden\n", "text/plain", storage_header)
            return
        target = store.root.joinpath(*rel.split("/")) if rel else store.root
        if self.command in ("GET", "HEAD"):
            if target.is_dir():
                self.send_listing(target)
            elif target.is_file():
                self.send_file(target, storage_header, cache="no-store" if rel == INVENTORY else "no-cache")
            else:
                self.send_bytes(404, b"Not found\n", "text/plain", storage_header)
            return
        if not self.origin_allowed():
            self.send_bytes(403, b"Cross-origin requests are not allowed\n", "text/plain", storage_header)
            return
        if self.command == "PUT" and WRITABLE_RE.match(rel):
            body = self.read_body()
            existed = target.exists()
            if rel == INVENTORY:
                with store._lock:  # do not interleave with API transactions
                    store.write_atomic(rel, body)
            else:
                store.write_atomic(rel, body)
            self.send_bytes(204 if existed else 201, b"", "text/plain", storage_header)
            return
        if self.command == "DELETE" and DELETABLE_RE.match(rel):
            if store.remove(rel):
                self.send_bytes(204, b"", "text/plain", storage_header)
            else:
                self.send_bytes(404, b"Not found\n", "text/plain", storage_header)
            return
        self.send_bytes(403 if self.command in ("PUT", "DELETE") else 405, b"Not allowed\n", "text/plain",
                        storage_header)

    def send_listing(self, directory):
        items = []
        for entry in sorted(os.scandir(directory), key=lambda item: item.name):
            if entry.name.startswith("."):
                continue
            stat = entry.stat()
            item = {"name": entry.name, "type": "directory" if entry.is_dir() else "file", "mtime": http_date(stat.st_mtime)}
            if entry.is_file():
                item["size"] = stat.st_size
            items.append(item)
        body = json.dumps(items).encode("utf-8")
        self.send_bytes(200, body, "application/json", {"X-Inventory-Storage": "webdav"})

    def send_file(self, path, extra_headers=None, cache="no-cache"):
        stat = path.stat()
        tag = etag(stat)
        headers = {"ETag": tag, "Last-Modified": http_date(stat.st_mtime), **(extra_headers or {})}
        if self.headers.get("If-None-Match") == tag:
            self.send_response(304)
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("Cache-Control", cache)
            self.end_headers()
            return
        content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type.endswith(("json", "javascript")):
            content_type += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(stat.st_size))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        for name, value in headers.items():
            self.send_header(name, value)
        self.end_headers()
        if self.command != "HEAD":
            with path.open("rb") as source:
                shutil.copyfileobj(source, self.wfile)

    # ------------------------------------------------------------------ static app

    def handle_static(self, path):
        if self.command not in ("GET", "HEAD"):
            self.send_bytes(405, b"Method not allowed\n", "text/plain", {"Allow": "GET, HEAD"})
            return
        root = self.server.app_dir
        parts = [part for part in path.split("/") if part]
        if any(part.startswith(".") for part in parts):
            self.send_bytes(404, b"Not found\n", "text/plain")
            return
        target = root.joinpath(*parts) if parts else root
        try:
            target.resolve().relative_to(root)
        except ValueError:
            self.send_bytes(404, b"Not found\n", "text/plain")
            return
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            self.send_bytes(404, b"Not found\n", "text/plain")
            return
        self.send_file(target)
