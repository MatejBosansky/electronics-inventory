#!/usr/bin/env python3
"""Electronics Inventory server: web app, data folder, REST API and MCP. Python 3.9+ standard library
(Pillow, when installed, is used to scale down photos added through the API).

    # Web app + data + API + MCP on http://localhost:8000 (data in ./data)
    python3 server/inventory_server.py
    python3 server/inventory_server.py --data ~/inventory-data --host 0.0.0.0 --port 8080

    # Only the REST API and MCP (used in Docker, where nginx serves the app and the data)
    python3 server/inventory_server.py --api-only --host 0.0.0.0 --data /srv/data

    # MCP over stdio for local MCP clients, working directly on a data folder
    python3 server/inventory_server.py --stdio --data ~/inventory-data

    # MCP over stdio, forwarded to a running server (for clients that only support stdio)
    python3 server/inventory_server.py --stdio --remote http://server:8080/mcp
"""
import argparse
import json
import logging
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from inventory import __version__  # noqa: E402
from inventory.defaults import load_defaults  # noqa: E402
from inventory.mcp import McpServer  # noqa: E402
from inventory.store import DataStore  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def run_stdio(server):
    """MCP stdio transport: one JSON-RPC message per line on stdin/stdout, logs on stderr."""
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            response = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}}
        else:
            response = server.handle_payload(payload)
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def run_bridge(url, headers):
    """Forwards stdio MCP messages to a Streamable HTTP MCP endpoint (JSON or SSE responses)."""
    session = None
    protocol = None
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        request_headers = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream",
                           **headers}
        if session:
            request_headers["Mcp-Session-Id"] = session
        if protocol:
            request_headers["MCP-Protocol-Version"] = protocol
        request = urllib.request.Request(url, data=line.encode("utf-8"), headers=request_headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=300) as response:
                session = response.headers.get("Mcp-Session-Id") or session
                body = response.read().decode("utf-8")
                kind = response.headers.get("Content-Type", "")
        except urllib.error.HTTPError as err:
            message = _request_id(line)
            if message is not None:
                error = {"code": -32000, "message": f"HTTP {err.code} from {url}: {err.reason}"}
                sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message, "error": error}) + "\n")
                sys.stdout.flush()
            continue
        except (urllib.error.URLError, OSError) as err:
            message = _request_id(line)
            if message is not None:
                error = {"code": -32000, "message": f"Cannot reach {url}: {err}"}
                sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": message, "error": error}) + "\n")
                sys.stdout.flush()
            continue
        messages = []
        if "text/event-stream" in kind:
            data = []
            for event_line in body.splitlines() + [""]:
                if event_line.startswith("data:"):
                    data.append(event_line[5:].lstrip())
                elif not event_line and data:
                    messages.append("\n".join(data))
                    data = []
        elif body.strip():
            messages.append(body)
        for message in messages:
            parsed = json.loads(message)
            if isinstance(parsed, dict) and isinstance(parsed.get("result"), dict):
                protocol = parsed["result"].get("protocolVersion", protocol)
            sys.stdout.write(json.dumps(parsed, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def _request_id(line):
    try:
        message = json.loads(line)
    except json.JSONDecodeError:
        return None
    return message.get("id") if isinstance(message, dict) else None


def main():
    parser = argparse.ArgumentParser(
        description="Electronics Inventory server (web app, data folder, REST API, MCP).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("\n\n", 1)[1],
    )
    parser.add_argument("--data", type=Path, default=Path(os.environ.get("INVENTORY_DATA") or ROOT / "data"),
                        help="data folder (default: ./data, or $INVENTORY_DATA)")
    parser.add_argument("--host", default=os.environ.get("INVENTORY_HOST", "127.0.0.1"),
                        help="address to listen on (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=int(os.environ.get("INVENTORY_PORT_INTERNAL", "8000")),
                        help="port (default 8000)")
    parser.add_argument("--api-only", action="store_true", help="serve only /api and /mcp (no app, no /data)")
    parser.add_argument("--public-url", default=os.environ.get("INVENTORY_PUBLIC_URL") or None,
                        help="public address used in links returned by the API, e.g. http://server:8080")
    parser.add_argument("--stdio", action="store_true", help="run as an MCP server on stdin/stdout")
    parser.add_argument("--remote", help="with --stdio: forward to this MCP endpoint URL instead of using --data")
    parser.add_argument("--header", action="append", default=[],
                        help='with --remote: extra HTTP header, e.g. "Authorization: Basic …" (repeatable)')
    parser.add_argument("--quiet", action="store_true", help="log only warnings and errors")
    args = parser.parse_args()

    logging.basicConfig(level=logging.WARNING if args.quiet or args.stdio else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", stream=sys.stderr)

    if args.stdio and args.remote:
        headers = {}
        for header in args.header:
            name, _, value = header.partition(":")
            headers[name.strip()] = value.strip()
        run_bridge(args.remote, headers)
        return

    store = DataStore(args.data, load_defaults())
    if args.stdio:
        run_stdio(McpServer(store, args.public_url))
        return

    from inventory.web import InventoryHTTPServer  # imported late: not needed for stdio

    store.root.mkdir(parents=True, exist_ok=True)
    server = InventoryHTTPServer((args.host, args.port), store, app_dir=ROOT / "app", api_only=args.api_only,
                                 public_url=args.public_url)
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0", "::") else args.host
    what = "API + MCP" if args.api_only else "app + data + API + MCP"
    logging.info("Electronics Inventory %s: http://%s:%s/ (%s, data: %s)", __version__, shown, args.port, what,
                 store.root)
    if args.host not in ("127.0.0.1", "localhost", "::1") and not args.api_only:
        logging.warning("Reachable from other devices without a password; use it only on a trusted network.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
