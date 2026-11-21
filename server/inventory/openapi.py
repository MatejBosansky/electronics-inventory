"""OpenAPI 3.1 description of the REST API, generated from the operation registry."""
import copy

from . import __version__
from .operations import OPERATIONS

ERROR_SCHEMA = {
    "type": "object",
    "properties": {
        "error": {
            "type": "object",
            "properties": {"code": {"type": "string"}, "message": {"type": "string"}},
            "required": ["code", "message"],
        }
    },
}

SEARCH_SPEC_PARAMETER = {
    "name": "spec.{key}",
    "in": "query",
    "description": ("Property filter, e.g. spec.zigbee=true, spec.thread=* (any value), spec.bluetooth=5.0,5.3 "
                    "(any of), spec.diagonal.min=1 / spec.diagonal.max=2 (numbers)."),
    "schema": {"type": "string"},
}


def _query_schema(schema):
    """Query parameters are strings on the wire; keep type info for documentation only."""
    result = copy.deepcopy(schema)
    if result.get("type") == "array":
        result["description"] = (result.get("description", "") + " Comma separated.").strip()
        result = {"type": "string", "description": result["description"]}
    return result


def document(base_url=None):
    paths = {}
    for op in OPERATIONS:
        properties = op.schema.get("properties", {})
        parameters = [{"name": name, "in": "path", "required": True, "schema": {"type": "string"},
                       "description": properties.get(name, {}).get("description", "")}
                      for name in op.path_params]
        entry = {
            "operationId": op.name,
            "summary": op.title,
            "description": op.description,
            "responses": {
                "200": {"description": "Result", "content": {"application/json": {"schema": {"type": "object"}}}},
                "4XX": {"description": "Error", "content": {"application/json": {"schema": ERROR_SCHEMA}}},
            },
        }
        if op.method in ("GET", "DELETE"):
            for name in op.query:
                parameter = {"name": name, "in": "query", "schema": _query_schema(properties.get(name, {}))}
                if properties.get(name, {}).get("description"):
                    parameter["description"] = properties[name]["description"]
                parameters.append(parameter)
            if op.name == "search_parts":
                parameters.append(SEARCH_SPEC_PARAMETER)
        else:
            body = copy.deepcopy(op.schema)
            for name in op.path_params:
                body.get("properties", {}).pop(name, None)
                if name in body.get("required", []):
                    body["required"] = [item for item in body["required"] if item != name]
            if not body.get("required"):
                body.pop("required", None)
            content = {"application/json": {"schema": body}}
            if op.name == "add_image":
                content["image/*"] = {"schema": {"type": "string", "format": "binary"}}
            entry["requestBody"] = {"required": op.name != "add_image", "content": content}
        if parameters:
            entry["parameters"] = parameters
        paths.setdefault(op.path, {})[op.method.lower()] = entry
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Electronics Inventory API",
            "version": __version__,
            "description": ("REST API of a self-hosted electronics parts inventory. The same operations are "
                            "available as MCP tools at /mcp."),
        },
        "servers": [{"url": (base_url or "/").rstrip("/") or "/"}],
        "paths": paths,
    }
