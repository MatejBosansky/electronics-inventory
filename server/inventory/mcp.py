"""Minimal Model Context Protocol server (JSON-RPC 2.0) exposing the inventory operations as tools.

Transport-independent: `McpServer.handle_payload()` takes a decoded JSON-RPC message (or batch) and
returns the response object(s), or None when nothing has to be sent back (notifications).
Used by the Streamable HTTP endpoint (/mcp) and by the stdio mode.
"""
import base64
import json
import logging
import traceback

from . import __version__
from .operations import OPERATIONS, Context, get_operation
from .store import InventoryError

PROTOCOL_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
LATEST_VERSION = PROTOCOL_VERSIONS[0]

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603

INSTRUCTIONS = """\
Inventory of electronic components (development boards, sensors, displays, modules, passives, …).
- Start with get_schema (category ids, property keys with types and suggested values, location codes) and reuse
  those values; get_overview gives counts.
- Quantities are stored per location as stock rows {location, qty}; qty null means unknown, location null means
  unassigned.
- Locations can belong to a place (e.g. Place 1 and Place 2, or the stock of an e-shop): get_schema
  lists the places, search_parts accepts one or more in place, and stock rows name the place of
  their location.
- Parts can have ID numbers written on their bags or labels ("57", "B-12"): search_parts number=57 finds the
  part; numbers are unique.
- Pieces built into a project are listed in the part's uses {project, qty, note}, not in the stock: use_part
  moves them out of a location into a project, return_part puts them back (or removes them when used up).
  get_schema lists the project names; search_parts filters by project or in_use.
- Before adding a part, search_parts for it; to record more pieces of an existing part use adjust_stock.
- Property filters in search_parts: {"zigbee": true}, {"thread": "*"} (any value), {"bluetooth": ["5.0", "5.3"]},
  {"diagonal": {"min": 1}}. Thread and Bluetooth values are versions ("1.3", "5.3").
- Changes appear in the web app within seconds. A daily snapshot of inventory.json is kept in backups/.
"""

log = logging.getLogger("inventory.mcp")


def tool_definitions():
    tools = []
    for op in OPERATIONS:
        tools.append({
            "name": op.name,
            "title": op.title,
            "description": op.description,
            "inputSchema": op.schema,
            "annotations": {
                "title": op.title,
                "readOnlyHint": op.read_only,
                "destructiveHint": op.destructive,
                "idempotentHint": op.idempotent or op.read_only,
                "openWorldHint": op.name in ("add_image", "add_parts"),
            },
        })
    return tools


def _error(message_id, code, message, data=None):
    error = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": message_id, "error": error}


def _result(message_id, result):
    return {"jsonrpc": "2.0", "id": message_id, "result": result}


class McpServer:
    def __init__(self, store, base_url=None):
        self.store = store
        self.base_url = base_url

    def context(self, base_url=None):
        return Context(self.store, base_url or self.base_url)

    # --------------------------------------------------------------- dispatch

    def handle_payload(self, payload, base_url=None):
        """Handles one message or a batch. Returns a response, a list of responses or None."""
        if isinstance(payload, list):
            if not payload:
                return _error(None, INVALID_REQUEST, "Empty batch")
            responses = [response for response in (self.handle_message(item, base_url) for item in payload)
                         if response is not None]
            return responses or None
        return self.handle_message(payload, base_url)

    def handle_message(self, message, base_url=None):
        if not isinstance(message, dict) or message.get("jsonrpc") != "2.0":
            return _error(message.get("id") if isinstance(message, dict) else None, INVALID_REQUEST,
                          "Invalid JSON-RPC message")
        method = message.get("method")
        message_id = message.get("id")
        is_notification = "id" not in message
        if method is None:
            return None  # a response from the client (we never send requests); ignore
        if is_notification:
            return None  # notifications/initialized, notifications/cancelled, …
        params = message.get("params") or {}
        if not isinstance(params, dict):
            return _error(message_id, INVALID_PARAMS, "params must be an object")
        try:
            if method == "initialize":
                return _result(message_id, self.initialize(params))
            if method == "ping":
                return _result(message_id, {})
            if method == "tools/list":
                return _result(message_id, {"tools": tool_definitions()})
            if method == "tools/call":
                return self.call_tool(message_id, params, base_url)
            if method in ("resources/list", "resources/templates/list", "prompts/list"):
                key = {"resources/list": "resources", "resources/templates/list": "resourceTemplates",
                       "prompts/list": "prompts"}[method]
                return _result(message_id, {key: []})
            return _error(message_id, METHOD_NOT_FOUND, f"Method not found: {method}")
        except Exception:  # never let a bug kill the transport
            log.error("MCP %s failed:\n%s", method, traceback.format_exc())
            return _error(message_id, INTERNAL_ERROR, "Internal error")

    def initialize(self, params):
        requested = params.get("protocolVersion")
        version = requested if requested in PROTOCOL_VERSIONS else LATEST_VERSION
        return {
            "protocolVersion": version,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": "electronics-inventory", "title": "Electronics Inventory", "version": __version__},
            "instructions": INSTRUCTIONS,
        }

    def call_tool(self, message_id, params, base_url=None):
        name = params.get("name")
        op = get_operation(name) if isinstance(name, str) else None
        if op is None:
            return _error(message_id, INVALID_PARAMS, f"Unknown tool: {name}")
        arguments = params.get("arguments") or {}
        if not isinstance(arguments, dict):
            return _error(message_id, INVALID_PARAMS, "arguments must be an object")
        try:
            result = op.handler(self.context(base_url), arguments)
        except InventoryError as err:
            text = f"Error ({err.code}): {err.message}"
            return _result(message_id, {"content": [{"type": "text", "text": text}], "isError": True})
        except Exception:
            log.error("Tool %s failed:\n%s", name, traceback.format_exc())
            return _result(message_id, {"content": [{"type": "text", "text": "Error: internal server error"}],
                                        "isError": True})
        content = []
        image = result.pop("_image", None) if isinstance(result, dict) else None
        content.append({"type": "text", "text": json.dumps(result, ensure_ascii=False)})
        if image:
            content.append({"type": "image", "data": base64.b64encode(image["data"]).decode("ascii"),
                            "mimeType": image["mimeType"]})
        return _result(message_id, {"content": content, "isError": False})
