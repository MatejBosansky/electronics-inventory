"""Operations on the inventory, shared by the REST API and the MCP server.

Each operation has a name (= MCP tool name and OpenAPI operationId), a JSON Schema for its
arguments, a REST route and a handler `handler(ctx, args) -> dict`.
"""
import re
from dataclasses import dataclass, field
from typing import Callable, Optional
from urllib.parse import quote

from . import images, model
from .store import InventoryError, not_found

LOCATION_COLORS = [
    "#2563eb", "#7c3aed", "#db2777", "#dc2626", "#ea580c", "#ca8a04",
    "#16a34a", "#0d9488", "#0891b2", "#6b7280", "#111827", "#e5e7eb",
]
CATEGORY_ICONS = [
    "board", "wireless", "sensor", "display", "power", "motor", "switch", "led", "audio",
    "input", "chip", "transistor", "resistor", "plug", "usb", "hub", "wrench", "nut", "droplet", "shapes", "box",
]
SORTS = ("name", "number", "updated", "created", "quantity")


class Context:
    """Per-request context: the data store and the public base URL used for links."""

    def __init__(self, store, base_url=None):
        self.store = store
        self.base_url = base_url.rstrip("/") + "/" if base_url else None

    def part_url(self, part_id):
        return f"{self.base_url}#/part/{quote(part_id)}" if self.base_url else None

    def file_url(self, path):
        if model.is_remote(path):
            return path
        return f"{self.base_url}data/{path}" if self.base_url else f"data/{path}"


@dataclass
class Operation:
    name: str
    title: str
    description: str
    method: str
    path: str
    schema: dict
    handler: Callable
    read_only: bool = False
    destructive: bool = False
    idempotent: bool = False
    query: tuple = ()
    path_params: tuple = field(default_factory=tuple)


OPERATIONS = []


def operation(name, title, method, path, schema, *, read_only=False, destructive=False, idempotent=False, query=()):
    def register(handler):
        OPERATIONS.append(Operation(
            name=name, title=title, description=(handler.__doc__ or "").strip(), method=method, path=path,
            schema=schema, handler=handler, read_only=read_only, destructive=destructive,
            idempotent=idempotent, query=tuple(query), path_params=tuple(re.findall(r"{(\w+)}", path)),
        ))
        return handler
    return register


def get_operation(name):
    return next((op for op in OPERATIONS if op.name == name), None)


# --------------------------------------------------------------------------- argument helpers

def obj(properties, required=(), description=None):
    schema = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        schema["required"] = list(required)
    if description:
        schema["description"] = description
    return schema


def string(description, **extra):
    return {"type": "string", "description": description, **extra}


def arg_str(args, name, required=False):
    value = args.get(name)
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            raise InventoryError(f"'{name}' is required.", 400, "invalid_arguments")
        return None
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        raise InventoryError(f"'{name}' must be a string.", 400, "invalid_arguments")
    return str(value).strip()


def arg_number(args, name, required=False):
    value = args.get(name)
    if value is None:
        if required:
            raise InventoryError(f"'{name}' is required.", 400, "invalid_arguments")
        return None
    if isinstance(value, bool):
        raise InventoryError(f"'{name}' must be a number.", 400, "invalid_arguments")
    try:
        number = float(value)
    except (TypeError, ValueError) as err:
        raise InventoryError(f"'{name}' must be a number.", 400, "invalid_arguments") from err
    return model.clean_number(number)


def arg_bool(args, name):
    value = args.get(name)
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str) and value.lower() in ("true", "1", "yes"):
        return True
    if isinstance(value, str) and value.lower() in ("false", "0", "no"):
        return False
    raise InventoryError(f"'{name}' must be true or false.", 400, "invalid_arguments")


def arg_list(args, name):
    value = args.get(name)
    if value is None:
        return None
    if isinstance(value, str):
        return model.split_list(value)
    if not isinstance(value, list):
        raise InventoryError(f"'{name}' must be a list.", 400, "invalid_arguments")
    return value


def known_ids(items, key, limit=60):
    values = [item[key] for item in items]
    shown = ", ".join(values[:limit])
    return shown + (", …" if len(values) > limit else "")


def require_category(inv, category_id):
    if not model.find_category(inv, category_id):
        raise InventoryError(
            f'Unknown category "{category_id}". Use one of: {known_ids(inv["categories"], "id")} '
            "(or create it with upsert_category).", 400, "unknown_category")


def require_part(inv, part_id):
    part = model.find_part(inv, part_id)
    if not part:
        raise not_found(f'No part with id "{part_id}". Use search_parts to find ids.')
    return part


def _number_option(field_def, value):
    """A number given for a text or select property, as text; "5" matches the option "5.0" and the like."""
    for option in field_def.get("options") or []:
        try:
            if float(option) == float(value):
                return option
        except ValueError:
            continue
    return str(value)


def coerce_specs(fields, specs, warnings, prefix=""):
    """Converts values to the type of their field. None values are kept (they mean 'remove')."""
    if specs is None:
        return None
    if not isinstance(specs, dict):
        raise InventoryError(f"{prefix}'specs' must be an object.", 400, "invalid_arguments")
    out = {}
    for key, value in specs.items():
        if not model.KEY_RE.match(str(key)):
            raise InventoryError(f"{prefix}invalid property key {key!r}.", 400, "invalid_arguments")
        field_def = fields.get(key)
        if not field_def:
            warnings.append(f"{prefix}property '{key}' is not defined (stored as text; define it with upsert_field "
                            "to get a label, type and filter).")
        if value is None:
            out[key] = None
            continue
        kind = field_def["type"] if field_def else None
        if kind == "bool" and not isinstance(value, bool):
            if str(value).strip().lower() in ("true", "yes", "1"):
                value = True
            elif str(value).strip().lower() in ("false", "no", "0"):
                value = False
            else:
                raise InventoryError(f"{prefix}property '{key}' expects true or false.", 400, "invalid_arguments")
        elif kind == "number" and isinstance(value, str):
            try:
                value = model.clean_number(float(value.replace(",", ".")))
            except ValueError:
                pass  # keep text such as "3.3-5"
        elif kind == "multi" and not isinstance(value, list):
            value = model.split_list(value)
        elif kind == "select" and isinstance(value, bool):
            options = ", ".join(field_def.get("options") or [])
            raise InventoryError(f"{prefix}property '{key}' expects a value" + (f" such as {options}" if options else "")
                                 + ", not true/false.", 400, "invalid_arguments")
        elif kind in ("text", "select") and isinstance(value, (int, float)):
            value = _number_option(field_def, value)
        elif kind in ("text", "select") and isinstance(value, list):
            value = ", ".join(str(item) for item in value)
        out[key] = value
    return out


def stock_rows(value, prefix=""):
    if value is None:
        return None
    if not isinstance(value, list):
        raise InventoryError(f"{prefix}'stock' must be a list of {{location, qty}}.", 400, "invalid_arguments")
    rows = []
    for row in value:
        if not isinstance(row, dict):
            raise InventoryError(f"{prefix}stock rows must be objects.", 400, "invalid_arguments")
        qty = row.get("qty", row.get("quantity"))
        if qty is not None and model.parse_qty(qty) is None and str(qty).strip() not in ("", "?"):
            raise InventoryError(f"{prefix}invalid quantity {qty!r}.", 400, "invalid_arguments")
        rows.append({"location": row.get("location"), "qty": qty})
    return rows


def use_rows(value, prefix=""):
    """Validates a list of uses ({project, qty, note}); qty defaults to 1."""
    if value is None:
        return None
    if not isinstance(value, list):
        raise InventoryError(f"{prefix}'uses' must be a list of {{project, qty, note}}.", 400, "invalid_arguments")
    rows = []
    for row in value:
        if not isinstance(row, dict) or not model.normalize_project(row.get("project")):
            raise InventoryError(f"{prefix}each use needs a 'project' name.", 400, "invalid_arguments")
        qty = row.get("qty", row.get("quantity", 1))
        if qty is not None and model.parse_qty(qty) is None and str(qty).strip() not in ("", "?"):
            raise InventoryError(f"{prefix}invalid quantity {qty!r} for project {row.get('project')!r}.", 400,
                                 "invalid_arguments")
        if model.parse_qty(qty) == 0:
            raise InventoryError(f"{prefix}the amount in project {row.get('project')!r} must be more than 0.", 400,
                                 "invalid_arguments")
        rows.append({"project": row.get("project"), "qty": qty, "note": row.get("note") or ""})
    return rows


def _project_name(inv, name, part=None):
    """A project name spelled like other parts already use it (case-insensitive); `part` is not looked at."""
    lower = model.normalize_project(name).lower()
    for other in inv["parts"]:
        if other is part:
            continue
        for use in other["uses"]:
            if use["project"].lower() == lower:
                return use["project"]
    return model.normalize_project(name)


def _canonical_uses(inv, uses, part=None):
    """Spells project names like the other parts do and merges uses of the same project."""
    for use in uses:
        use["project"] = _project_name(inv, use["project"], part)
    return model.merge_uses(uses)


# --------------------------------------------------------------------------- output helpers

def quantity_value(summary):
    return None if summary["unknown"] and summary["total"] == 0 else summary["total"]


def stock_out(inv, row, detail=False):
    """A stock row for output, with the location's place (and name in details)."""
    location = model.find_location(inv, row["location"])
    out = {"location": row["location"]}
    if detail:
        out["location_name"] = location["name"] if location else None
        out["place"] = location["place"] or None if location else None
    elif location and location["place"]:
        out["place"] = location["place"]
    out["qty"] = row["qty"]
    return out


def part_summary(ctx, inv, part):
    summary = model.stock_summary(part)
    out = {
        "id": part["id"],
        "name": part["name"],
        "category": part["category"],
        "quantity": quantity_value(summary),
        "quantity_text": summary["text"],
        "stock": [stock_out(inv, row) for row in part["stock"]],
        "specs": part["specs"],
    }
    if part["uses"]:
        out["uses"] = part["uses"]
    if part["numbers"]:
        out["numbers"] = part["numbers"]
    if part["tags"]:
        out["tags"] = part["tags"]
    if part["description"]:
        out["description"] = part["description"][:240]
    if part["images"]:
        out["images"] = len(part["images"])
    url = ctx.part_url(part["id"])
    if url:
        out["url"] = url
    return out


def part_detail(ctx, inv, part):
    fields = model.field_map(inv)
    category = model.find_category(inv, part["category"])
    summary = model.stock_summary(part)
    keys = [key for key in (category["fields"] if category else []) if key in part["specs"]]
    keys += [key for key in part["specs"] if key not in keys]
    out = {
        "id": part["id"],
        "name": part["name"],
        "numbers": part["numbers"],
        "category": part["category"],
        "category_name": category["name"] if category else part["category"],
        "description": part["description"],
        "tags": part["tags"],
        "quantity": quantity_value(summary),
        "quantity_text": summary["text"],
        "stock": [],
        "uses": part["uses"],
        "specs": part["specs"],
        "properties": [
            {"key": key, "label": model.field_def(fields, key)["label"],
             "value": part["specs"][key], "text": model.spec_text(model.field_def(fields, key), part["specs"][key])}
            for key in keys
        ],
        "images": [],
        "links": part["links"],
        "notes": part["notes"],
        "createdAt": part["createdAt"],
        "updatedAt": part["updatedAt"],
    }
    out["stock"] = [stock_out(inv, row, detail=True) for row in part["stock"]]
    for image in part["images"]:
        entry = {"src": image["src"], "url": ctx.file_url(image["src"])}
        if image.get("thumb"):
            entry["thumb"] = image["thumb"]
            entry["thumb_url"] = ctx.file_url(image["thumb"])
        out["images"].append(entry)
    url = ctx.part_url(part["id"])
    if url:
        out["url"] = url
    return out


# --------------------------------------------------------------------------- schemas

STOCK_ROW = obj({
    "location": {"type": ["string", "null"], "description": "Location code (see get_schema); null = unassigned."},
    "qty": {"type": ["number", "null"], "minimum": 0, "description": "Amount at this location; null = unknown."},
}, required=["location"])
STOCK_LIST = {"type": "array", "items": STOCK_ROW,
              "description": "Where the part is stored. The total quantity is the sum of all rows."}
LINK_LIST = {"type": "array", "description": "Datasheets, shops, docs.",
             "items": obj({"label": string("Short label, e.g. Datasheet."), "url": string("http(s) URL.")},
                          required=["url"])}
SPECS = {
    "type": "object",
    "description": ("Property values by field key from get_schema: text, numbers, true/false or lists of strings "
                    "for multi fields. Example: {\"mcu\": \"ESP32-C6\", \"wifi\": \"Wi-Fi 6 (2.4 GHz)\", "
                    "\"bluetooth\": \"5.3\", \"thread\": \"1.3\", \"interfaces\": [\"I2C\", \"SPI\"]}."),
    "additionalProperties": {"type": ["string", "number", "boolean", "array", "null"]},
}
TAGS = {"type": "array", "items": {"type": "string"}, "description": "Free keywords."}
NUMBERS = {"type": "array", "items": {"type": "string"},
           "description": "ID numbers written on the part's bag or label, e.g. [\"57\"] or [\"B-12\"]; unique."}
USE_LIST = {"type": "array", "items": obj({
    "project": string("Project name, e.g. Weather station (reuse names from get_schema)."),
    "qty": {"type": ["number", "null"], "minimum": 0, "description": "Pieces in the project (default 1; null = unknown)."},
    "note": string("Optional short note: where or how it is used."),
}, required=["project"]), "description": "Pieces built into projects. They are not counted in the stock."}
PART_ID = string("Part id (from search_parts or get_part).")
NEW_PART = obj({
    "name": string("Name, e.g. ESP32-C6-DevKitC-1."),
    "numbers": NUMBERS,
    "category": string("Category id from get_schema, e.g. dev-boards."),
    "description": string("One or two sentences."),
    "tags": TAGS,
    "stock": STOCK_LIST,
    "uses": {**USE_LIST, "description": USE_LIST["description"] + " For parts that are already in a project."},
    "specs": SPECS,
    "links": LINK_LIST,
    "notes": string("Free text (pinout, purchase details, …)."),
    "image_urls": {"type": "array", "items": {"type": "string"}, "maxItems": 5,
                   "description": "Optional photo URLs; they are downloaded and stored with the part."},
}, required=["name", "category"])


# --------------------------------------------------------------------------- read operations

@operation("get_overview", "Inventory overview", "GET", "/api/overview", obj({}), read_only=True)
def get_overview(ctx, args):
    """Counts of parts per category, place, location and project, stock status and recently changed parts.
    A good first call."""
    inv = ctx.store.load()
    parts = inv["parts"]
    per_category, per_location, per_place, per_project, unassigned = {}, {}, {}, {}, 0
    for part in parts:
        for project in {use["project"] for use in part["uses"]}:
            per_project[project] = per_project.get(project, 0) + 1
        per_category[part["category"]] = per_category.get(part["category"], 0) + 1
        codes = {row["location"] for row in part["stock"] if row["location"]}
        for code in codes:
            per_location[code] = per_location.get(code, 0) + 1
        for place in {model.place_of(inv, code) for code in codes} - {""}:
            per_place[place] = per_place.get(place, 0) + 1
        if any(row["location"] is None for row in part["stock"]) or not part["stock"]:
            unassigned += 1
    summaries = [model.stock_summary(part) for part in parts]
    recent = sorted(parts, key=lambda part: part["updatedAt"], reverse=True)[:5]
    return {
        "title": inv["settings"]["title"],
        "updatedAt": inv["updatedAt"],
        "parts": len(parts),
        "pieces_known": model.round_qty(sum(summary["total"] for summary in summaries)),
        "out_of_stock": sum(1 for part in parts if not model.in_stock(part)),
        "in_use": sum(1 for part in parts if part["uses"]),
        "unknown_quantity": sum(1 for summary in summaries if summary["unknown"]),
        "unassigned_or_unstored": unassigned,
        "categories": [{"id": cat["id"], "name": cat["name"], "parts": per_category.get(cat["id"], 0)}
                       for cat in inv["categories"]],
        "places": [{"name": place, "locations": sum(1 for loc in inv["locations"] if loc["place"] == place),
                    "parts": per_place.get(place, 0)} for place in model.places(inv)],
        "locations": [{"code": loc["code"], "name": loc["name"], "place": loc["place"] or None,
                       "parts": per_location.get(loc["code"], 0)} for loc in inv["locations"]],
        "projects": [{"name": project, "parts": per_project[project]} for project in model.projects(inv)],
        "recently_changed": [{"id": part["id"], "name": part["name"], "updatedAt": part["updatedAt"]}
                             for part in recent],
        "app_url": ctx.base_url,
    }


@operation("get_schema", "Categories, properties and locations", "GET", "/api/schema", obj({}), read_only=True)
def get_schema(ctx, args):
    """Category ids, property definitions (key, label, type, unit, suggested values), location codes, the
    places the locations belong to and the projects parts are used in. Reuse these when adding or updating parts."""
    inv = ctx.store.load()
    return {
        "categories": inv["categories"],
        "fields": inv["fields"],
        "locations": inv["locations"],
        "places": model.places(inv),
        "projects": model.projects(inv),
        "field_types": {
            "text": "free text", "number": "number (unit in 'unit')", "select": "one value, suggestions in 'options'",
            "multi": "list of values, suggestions in 'options'", "bool": "true / false",
        },
        "category_icons": CATEGORY_ICONS,
    }


def _natural_key(value):
    return [int(chunk) if chunk.isdigit() else chunk for chunk in re.split(r"(\d+)", model.fold(value))]


def _spec_matches(field_def, value, condition):
    kind = field_def["type"] if field_def else "text"
    present = value is not None and value != "" and value is not False
    if isinstance(condition, dict):
        if "min" in condition or "max" in condition:
            try:
                number = float(value)
            except (TypeError, ValueError):
                return False
            if "min" in condition and condition["min"] is not None and number < float(condition["min"]):
                return False
            if "max" in condition and condition["max"] is not None and number > float(condition["max"]):
                return False
            return True
        raise InventoryError("Spec conditions are a value, a list of values, true/false, \"*\" or {min, max}.",
                             400, "invalid_arguments")
    if condition == "*":
        return present
    if isinstance(condition, bool):
        if kind == "bool":
            return (value is True) == condition
        return present == condition
    options = condition if isinstance(condition, list) else [condition]
    wanted = {model.fold(option) for option in options}
    values = value if isinstance(value, list) else [] if value is None else [value]
    return any(model.fold(item) in wanted for item in values)


def _query_parts(ctx, inv, args):
    fields = model.field_map(inv)
    parts = list(inv["parts"])
    category = arg_str(args, "category")
    if category:
        require_category(inv, category)
        parts = [part for part in parts if part["category"] == category]
    tokens = model.fold(arg_str(args, "query") or "").split()
    if tokens:
        # Same as the app: "#57" is exactly that ID number, and "b12" also finds the ID number "B-12".
        parts = [part for part in parts if all(
            model.has_number(part, token) if token.startswith("#") and len(token) > 1
            else token in model.haystack(inv, fields, part) or model.has_number(part, token)
            for token in tokens)]
    location = arg_str(args, "location")
    if location:
        if location.lower() in ("none", "unassigned"):
            parts = [part for part in parts if any(row["location"] is None for row in part["stock"])]
        else:
            found = model.find_location(inv, location)
            if not found:
                raise InventoryError(f'Unknown location "{location}". Known: {known_ids(inv["locations"], "code")}.',
                                     400, "unknown_location")
            parts = [part for part in parts if any(row["location"] == found["code"] for row in part["stock"])]
    number = arg_str(args, "number")
    if number:
        parts = [part for part in parts if model.has_number(part, number)]
    places = arg_list(args, "place")
    if places:
        found_places = set()
        for place in places:
            found_place = model.find_place(inv, place)
            if not found_place:
                known = ", ".join(model.places(inv)) or "none yet (set 'place' with upsert_location)"
                raise InventoryError(f'Unknown place "{place}". Known: {known}.', 400, "unknown_place")
            found_places.add(found_place)
        codes = {loc["code"] for loc in inv["locations"] if loc["place"] in found_places}
        parts = [part for part in parts if any(row["location"] in codes for row in part["stock"])]
    projects = arg_list(args, "project")
    if projects:
        found_projects = set()
        for project in projects:
            found_project = model.find_project(inv, project)
            if not found_project:
                known = ", ".join(model.projects(inv)) or "none yet (see use_part)"
                raise InventoryError(f'Unknown project "{project}". Known: {known}.', 400, "unknown_project")
            found_projects.add(found_project)
        parts = [part for part in parts if any(use["project"] in found_projects for use in part["uses"])]
    used = arg_bool(args, "in_use")
    if used is not None:
        parts = [part for part in parts if bool(part["uses"]) == used]
    stocked = arg_bool(args, "in_stock")
    if stocked is not None:
        parts = [part for part in parts if model.in_stock(part) == stocked]
    tags = arg_list(args, "tags")
    if tags:
        wanted = {model.fold(tag) for tag in tags}
        parts = [part for part in parts if any(model.fold(tag) in wanted for tag in part["tags"])]
    specs = args.get("specs")
    if specs:
        if not isinstance(specs, dict):
            raise InventoryError("'specs' must be an object of property conditions.", 400, "invalid_arguments")
        for key, condition in specs.items():
            parts = [part for part in parts if _spec_matches(fields.get(key), part["specs"].get(key), condition)]
    sort = arg_str(args, "sort") or "name"
    if sort not in SORTS:
        raise InventoryError(f"'sort' must be one of {', '.join(SORTS)}.", 400, "invalid_arguments")
    if sort == "name":
        parts.sort(key=lambda part: _natural_key(part["name"]))
    elif sort == "number":
        parts.sort(key=lambda part: (not part["numbers"], _natural_key(part["numbers"][0]) if part["numbers"] else [],
                                     _natural_key(part["name"])))
    elif sort in ("updated", "created"):
        key = "updatedAt" if sort == "updated" else "createdAt"
        parts.sort(key=lambda part: part[key], reverse=True)
    else:
        parts.sort(key=lambda part: (-(quantity_value(model.stock_summary(part)) or 0), _natural_key(part["name"])))
    if len(tokens) == 1:
        # A search for one ID number lists the part with that number first.
        parts.sort(key=lambda part: not model.has_number(part, tokens[0]))
    return parts


@operation("search_parts", "Search parts", "GET", "/api/parts", obj({
    "query": string("Words that must all appear (name, description, notes, tags, property values, locations, projects)."),
    "category": string("Category id, e.g. dev-boards."),
    "number": string("ID number written on the part's bag or label, e.g. 57 or B-12 (exact; case and dashes ignored)."),
    "location": string("Location code, or \"none\" for parts with unassigned stock."),
    "place": {"type": "array", "items": {"type": "string"},
              "description": "Place names from get_schema, e.g. [\"Place 1\", \"Place 3\"]: parts with stock in any of them."},
    "project": {"type": "array", "items": {"type": "string"},
                "description": "Project names from get_schema, e.g. [\"Weather station\"]: parts in use in any of them."},
    "in_use": {"type": "boolean", "description": "true = only parts built into projects, false = only parts not in use."},
    "in_stock": {"type": "boolean", "description": "true = only parts with stock, false = only out of stock."},
    "tags": {"type": "array", "items": {"type": "string"}, "description": "Parts having any of these tags."},
    "specs": {
        "type": "object",
        "description": ("Property conditions, all must match: a value (\"ESP32-C6\"), a list of accepted values "
                        "([\"5.0\", \"5.3\"]), true/false for yes/no properties, \"*\" for any value, or "
                        "{\"min\": 1, \"max\": 2} for numbers. Example: {\"thread\": \"*\", \"zigbee\": true}."),
        "additionalProperties": True,
    },
    "sort": {"type": "string", "enum": list(SORTS), "description": "Default: name."},
    "limit": {"type": "integer", "minimum": 1, "maximum": 500, "description": "Default 50."},
    "offset": {"type": "integer", "minimum": 0},
}), read_only=True, query=("query", "category", "number", "location", "place", "project", "in_use", "in_stock", "tags",
                           "sort", "limit", "offset"))
def search_parts(ctx, args):
    """Finds parts by text, ID number, category, place, location, project, stock and property values (e.g. boards with
    Thread or Bluetooth 5.x). Returns compact summaries (stock rows name their place, uses the projects the part is
    built into); use get_part for all details."""
    inv = ctx.store.load()
    parts = _query_parts(ctx, inv, args)
    limit = int(arg_number(args, "limit") or 50)
    offset = int(arg_number(args, "offset") or 0)
    limit = max(1, min(limit, 500))
    page = parts[offset:offset + limit]
    return {"total": len(parts), "offset": offset, "limit": limit,
            "parts": [part_summary(ctx, inv, part) for part in page]}


@operation("get_part", "Get part details", "GET", "/api/parts/{id}", obj({
    "id": PART_ID,
    "include_image": {"type": "boolean", "description": "MCP only: also return the cover photo (thumbnail)."},
}, required=["id"]), read_only=True, query=("include_image",))
def get_part(ctx, args):
    """All details of one part: stock per location, pieces in use in projects, properties with labels, links, notes
    and photo URLs."""
    inv = ctx.store.load()
    part = require_part(inv, arg_str(args, "id", required=True))
    result = part_detail(ctx, inv, part)
    if arg_bool(args, "include_image") and part["images"]:
        image = part["images"][0]
        path = image.get("thumb") or image["src"]
        if not model.is_remote(path):
            data = ctx.store.read_bytes(path)
            kind = images.sniff(data or b"")
            if data and kind:
                mime = {"jpg": "image/jpeg", "png": "image/png", "gif": "image/gif", "webp": "image/webp",
                        "avif": "image/avif"}[kind]
                result["_image"] = {"data": data, "mimeType": mime}
    return result


# --------------------------------------------------------------------------- write operations

def _require_free_numbers(inv, part):
    """ID numbers identify one part each (they are written on its bag)."""
    for number in part["numbers"]:
        other = model.part_by_number(inv, number, except_id=part["id"])
        if other:
            raise InventoryError(f'ID number "{number}" is already used by "{other["name"]}" ({other["id"]}).', 409,
                                 "conflict")


def _prepare_images(ctx, name, urls, warnings, prefix=""):
    stored = []
    for url in urls or []:
        try:
            full, full_ext, thumb, thumb_ext = images.prepare(images.download(url))
            stored.append(ctx.store.save_image(name, full, full_ext, thumb, thumb_ext))
        except InventoryError as err:
            warnings.append(f"{prefix}photo {url} skipped: {err.message}")
    return stored


@operation("add_parts", "Add parts", "POST", "/api/parts", obj({
    "parts": {"type": "array", "items": NEW_PART, "minItems": 1, "maxItems": 200},
    "on_duplicate": {"type": "string", "enum": ["skip", "add"],
                     "description": "What to do when a part with the same name exists. Default skip "
                                    "(use adjust_stock to add pieces of an existing part)."},
}, required=["parts"]))
def add_parts(ctx, args):
    """Adds one or more new parts. Category ids, property keys and location codes come from get_schema;
    unknown location codes are created. Returns the new ids, skipped duplicates and warnings."""
    items = args.get("parts")
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list) or not items:
        raise InventoryError("'parts' must be a non-empty list.", 400, "invalid_arguments")
    if len(items) > 200:
        raise InventoryError("At most 200 parts per call.", 400, "invalid_arguments")
    on_duplicate = arg_str(args, "on_duplicate") or "skip"
    if on_duplicate not in ("skip", "add"):
        raise InventoryError("'on_duplicate' must be skip or add.", 400, "invalid_arguments")

    inv = ctx.store.load()
    fields = model.field_map(inv)
    existing_names = {part["name"].lower(): part["id"] for part in inv["parts"]}
    warnings, skipped, prepared = [], [], []
    for index, raw in enumerate(items):
        prefix = f"parts[{index}]: "
        if not isinstance(raw, dict):
            raise InventoryError(f"{prefix}must be an object.", 400, "invalid_arguments")
        unknown = set(raw) - set(NEW_PART["properties"])
        if unknown:
            raise InventoryError(f"{prefix}unknown keys {sorted(unknown)}.", 400, "invalid_arguments")
        name = arg_str(raw, "name")
        if not name:
            raise InventoryError(f"{prefix}'name' is required.", 400, "invalid_arguments")
        category = arg_str(raw, "category")
        if not category:
            raise InventoryError(f"{prefix}'category' is required.", 400, "invalid_arguments")
        require_category(inv, category)
        if on_duplicate == "skip" and name.lower() in existing_names:
            skipped.append({"name": name, "existing_id": existing_names[name.lower()],
                            "reason": "a part with this name exists"})
            continue
        specs = coerce_specs(fields, raw.get("specs"), warnings, prefix) or {}
        part = {
            "name": name,
            "numbers": model.normalize_numbers(raw.get("numbers")),
            "category": category,
            "description": raw.get("description") or "",
            "tags": raw.get("tags") or [],
            "stock": stock_rows(raw.get("stock"), prefix) or [],
            "uses": use_rows(raw.get("uses"), prefix) or [],
            "specs": {key: value for key, value in specs.items() if value is not None},
            "links": raw.get("links") or [],
            "notes": raw.get("notes") or "",
            "images": _prepare_images(ctx, name, raw.get("image_urls"), warnings, prefix),
        }
        prepared.append(part)
        existing_names[name.lower()] = None

    def mutate(inv):
        taken = {part["id"] for part in inv["parts"]}
        created, notes = [], []
        for raw in prepared:
            now = model.now_iso()
            part_id = model.unique_id(model.slugify(raw["name"]) or "part", taken)
            part = model.normalize_part({**raw, "id": part_id, "createdAt": now, "updatedAt": now})
            part["stock"] = model.merge_stock(part["stock"])
            part["uses"] = _canonical_uses(inv, part["uses"])
            _require_free_numbers(inv, part)
            notes.extend(model.ensure_references(inv, part, ctx.store.defaults))
            inv["parts"].append(part)
            taken.add(part_id)
            entry = {"id": part_id, "name": part["name"], "quantity_text": model.stock_summary(part)["text"]}
            if ctx.part_url(part_id):
                entry["url"] = ctx.part_url(part_id)
            created.append(entry)
        return created, notes

    created, notes = ctx.store.transaction(mutate) if prepared else ([], [])
    warnings.extend(f"created {note}" for note in notes)
    return {"created": created, "skipped": skipped, "warnings": warnings}


@operation("update_part", "Update a part", "PATCH", "/api/parts/{id}", obj({
    "id": PART_ID,
    "name": string("New name."),
    "numbers": {**NUMBERS, "description": "Replaces the ID numbers ([] removes them)."},
    "category": string("New category id."),
    "description": string("Replaces the description."),
    "notes": string("Replaces the notes."),
    "tags": {**TAGS, "description": "Replaces all tags."},
    "specs": {**SPECS, "description": SPECS["description"] + " Merged into the existing values; null removes a property."},
    "replace_specs": {"type": "boolean", "description": "Replace all properties instead of merging."},
    "stock": {**STOCK_LIST, "description": "Replaces all stock rows (to change one amount use adjust_stock)."},
    "uses": {**USE_LIST, "description": "Replaces the list of pieces in use ([] removes them; the stock does not change). "
                                        "To move pieces between the stock and a project use use_part / return_part."},
    "links": {**LINK_LIST, "description": "Replaces all links."},
    "images": {"type": "array", "items": {"type": "string"},
               "description": "Existing image 'src' paths to keep, in order (first = cover). Omitted ones are "
                              "detached. To add photos use add_image."},
}, required=["id"]), idempotent=True)
def update_part(ctx, args):
    """Changes fields of an existing part. Only the given fields change; specs are merged."""
    part_id = arg_str(args, "id", required=True)
    inv = ctx.store.load()
    warnings = []
    specs = coerce_specs(model.field_map(inv), args.get("specs"), warnings)
    stock = stock_rows(args.get("stock"))
    uses = use_rows(args.get("uses"))

    def mutate(inv):
        part = require_part(inv, part_id)
        raw = dict(part)
        if "name" in args:
            name = arg_str(args, "name")
            if not name:
                raise InventoryError("'name' cannot be empty.", 400, "invalid_arguments")
            raw["name"] = name
        if "category" in args:
            category = arg_str(args, "category", required=True)
            require_category(inv, category)
            raw["category"] = category
        for key in ("description", "notes"):
            if key in args:
                raw[key] = args.get(key) or ""
        if "tags" in args:
            raw["tags"] = args.get("tags") or []
        if "numbers" in args:
            raw["numbers"] = args.get("numbers") or []
        if "links" in args:
            raw["links"] = args.get("links") or []
        if stock is not None:
            raw["stock"] = stock
        if uses is not None:
            raw["uses"] = uses
        if specs is not None:
            merged = {} if arg_bool(args, "replace_specs") else dict(part["specs"])
            for key, value in specs.items():
                if value is None:
                    merged.pop(key, None)
                else:
                    merged[key] = value
            raw["specs"] = merged
        if "images" in args:
            by_src = {image["src"]: image for image in part["images"]}
            order = arg_list(args, "images") or []
            missing = [src for src in order if src not in by_src]
            if missing:
                raise InventoryError(f"Unknown image paths {missing}; see get_part for the current ones.", 400,
                                     "invalid_arguments")
            raw["images"] = [by_src[src] for src in order]
        updated = model.normalize_part({**raw, "id": part_id, "createdAt": part["createdAt"],
                                        "updatedAt": model.now_iso()})
        updated["stock"] = model.merge_stock(updated["stock"])
        if uses is not None:
            updated["uses"] = _canonical_uses(inv, updated["uses"], part)
        _require_free_numbers(inv, updated)
        notes = model.ensure_references(inv, updated, ctx.store.defaults)
        inv["parts"][inv["parts"].index(part)] = updated
        return part_detail(ctx, inv, updated), notes

    detail, notes = ctx.store.transaction(mutate)
    warnings.extend(f"created {note}" for note in notes)
    return {"part": detail, "warnings": warnings}


@operation("delete_part", "Delete a part", "DELETE", "/api/parts/{id}", obj({"id": PART_ID}, required=["id"]),
           destructive=True, idempotent=True)
def delete_part(ctx, args):
    """Removes a part from the inventory (its photos stay on disk; a daily snapshot of inventory.json exists).
    Returns the removed part so it could be added again."""
    part_id = arg_str(args, "id", required=True)

    def mutate(inv):
        part = require_part(inv, part_id)
        inv["parts"].remove(part)
        return part

    removed = ctx.store.transaction(mutate)
    return {"deleted": part_id, "part": removed}


def _stock_row(part, location):
    key = (location or "").lower()
    return next((row for row in part["stock"] if (row["location"] or "").lower() == key), None)


def _canonical_location(inv, location):
    if location is None:
        return None
    found = model.find_location(inv, location)
    return found["code"] if found else model.normalize_location_code(location) or None


@operation("adjust_stock", "Change the amount at a location", "POST", "/api/parts/{id}/stock/adjust", obj({
    "id": PART_ID,
    "location": {"type": ["string", "null"], "description": "Location code; null = the unassigned row."},
    "delta": {"type": "number", "description": "Pieces to add (positive) or take out (negative)."},
}, required=["id", "location", "delta"]))
def adjust_stock(ctx, args):
    """Adds or removes pieces at one location, e.g. delta -2 when two pieces were used up (pieces built into a
    project: use_part). Creates the location row when adding to a location the part is not stored in yet."""
    part_id = arg_str(args, "id", required=True)
    delta = arg_number(args, "delta", required=True)
    if delta == 0:
        raise InventoryError("'delta' must not be 0.", 400, "invalid_arguments")
    location = arg_str(args, "location")

    def mutate(inv):
        part = require_part(inv, part_id)
        code = _canonical_location(inv, location)
        row = _stock_row(part, code)
        if row is None:
            if delta < 0:
                raise InventoryError(f"{part['name']} is not stored in {code or 'the unassigned row'}.", 409,
                                     "insufficient_stock")
            row = {"location": code, "qty": delta}
            part["stock"].append(row)
        elif row["qty"] is None:
            raise InventoryError(f"The amount of {part['name']} in {code or 'unassigned'} is unknown; "
                                 "set it with set_stock first.", 409, "unknown_quantity")
        else:
            new_qty = model.round_qty(row["qty"] + delta)
            if new_qty < 0:
                raise InventoryError(f"Only {row['qty']} of {part['name']} in {code or 'unassigned'}; "
                                     f"cannot take {-delta}.", 409, "insufficient_stock")
            row["qty"] = new_qty
        part["updatedAt"] = model.now_iso()
        notes = model.ensure_references(inv, part, ctx.store.defaults)
        return {"id": part_id, "location": row["location"], "qty": row["qty"],
                "quantity_text": model.stock_summary(part)["text"], "notes": notes}

    return ctx.store.transaction(mutate)


@operation("set_stock", "Set all stock rows", "PUT", "/api/parts/{id}/stock", obj({
    "id": PART_ID,
    "stock": STOCK_LIST,
}, required=["id", "stock"]), idempotent=True)
def set_stock(ctx, args):
    """Replaces where a part is stored and how many pieces are at each location."""
    part_id = arg_str(args, "id", required=True)
    rows = stock_rows(args.get("stock"))
    if rows is None:
        raise InventoryError("'stock' is required.", 400, "invalid_arguments")

    def mutate(inv):
        part = require_part(inv, part_id)
        part["stock"] = model.merge_stock(model.normalize_stock(rows))
        part["updatedAt"] = model.now_iso()
        notes = model.ensure_references(inv, part, ctx.store.defaults)
        return {"id": part_id, "stock": part["stock"], "quantity_text": model.stock_summary(part)["text"],
                "notes": notes}

    return ctx.store.transaction(mutate)


@operation("move_stock", "Move pieces between locations", "POST", "/api/parts/{id}/stock/move", obj({
    "id": PART_ID,
    "from_location": {"type": ["string", "null"], "description": "Source location code (null = unassigned)."},
    "to_location": {"type": ["string", "null"], "description": "Target location code (null = unassigned)."},
    "qty": {"type": ["number", "null"], "description": "Pieces to move; omit or null to move everything."},
}, required=["id", "from_location", "to_location"]))
def move_stock(ctx, args):
    """Moves pieces of a part from one location to another (e.g. from a spare box to the working box)."""
    part_id = arg_str(args, "id", required=True)
    source = arg_str(args, "from_location")
    target = arg_str(args, "to_location")
    qty = arg_number(args, "qty")
    if qty is not None and qty <= 0:
        raise InventoryError("'qty' must be positive.", 400, "invalid_arguments")

    def mutate(inv):
        part = require_part(inv, part_id)
        source_code = _canonical_location(inv, source)
        target_code = _canonical_location(inv, target)
        if (source_code or "").lower() == (target_code or "").lower():
            raise InventoryError("Source and target are the same.", 400, "invalid_arguments")
        row = _stock_row(part, source_code)
        if row is None:
            raise InventoryError(f"{part['name']} is not stored in {source_code or 'unassigned'}.", 409,
                                 "insufficient_stock")
        if qty is None:
            moved = row["qty"]
            part["stock"].remove(row)
        else:
            if row["qty"] is None:
                raise InventoryError("The amount at the source is unknown; move everything (omit qty) or "
                                     "set it with set_stock first.", 409, "unknown_quantity")
            if qty > row["qty"]:
                raise InventoryError(f"Only {row['qty']} at {source_code or 'unassigned'}.", 409,
                                     "insufficient_stock")
            moved = qty
            row["qty"] = model.round_qty(row["qty"] - qty)
        part["stock"] = model.merge_stock(part["stock"] + [{"location": target_code, "qty": moved}])
        part["updatedAt"] = model.now_iso()
        notes = model.ensure_references(inv, part, ctx.store.defaults)
        return {"id": part_id, "stock": part["stock"], "quantity_text": model.stock_summary(part)["text"],
                "notes": notes}

    return ctx.store.transaction(mutate)


def _use_location(inv, location):
    """A location argument: a code, or "unassigned" (unless a location has that code) for the unassigned row."""
    if location.lower() == "unassigned" and not model.find_location(inv, location):
        return None
    return _canonical_location(inv, location)


def _use_result(inv, part, **extra):
    return {"id": part["id"], **extra, "stock": [stock_out(inv, row) for row in part["stock"]],
            "quantity_text": model.stock_summary(part)["text"], "uses": part["uses"]}


@operation("use_part", "Use pieces in a project", "POST", "/api/parts/{id}/uses", obj({
    "id": PART_ID,
    "project": string("Project name, e.g. Weather station; reuse the spelling from get_schema → projects."),
    "qty": {"type": "number", "minimum": 0, "description": "Pieces built into the project. Default 1."},
    "from_location": {"type": ["string", "null"],
                      "description": "Location code the pieces were taken from (its amount goes down; \"unassigned\" "
                                     "= the unassigned row). null = they were not in stock."},
    "note": string("Optional short note: where or how it is used, e.g. sensor on GPIO 4."),
}, required=["id", "project", "from_location"]))
def use_part(ctx, args):
    """Marks pieces of a part as built into a project: they leave the stock at from_location and are listed in the
    part's uses until return_part takes them back. More pieces for the same project add up; a note replaces the old
    one."""
    part_id = arg_str(args, "id", required=True)
    project = model.normalize_project(arg_str(args, "project", required=True))
    qty = arg_number(args, "qty")
    qty = 1 if qty is None else qty
    if qty <= 0:
        raise InventoryError("'qty' must be positive.", 400, "invalid_arguments")
    if "from_location" not in args:
        raise InventoryError("'from_location' is required: the location code the pieces were taken from, or null "
                             "when they were not in stock.", 400, "invalid_arguments")
    source = arg_str(args, "from_location")
    note = (arg_str(args, "note") or "")[:200]

    def mutate(inv):
        part = require_part(inv, part_id)
        taken_from = None
        if source is not None:
            code = _use_location(inv, source)
            row = _stock_row(part, code)
            if row is None:
                raise InventoryError(f"{part['name']} is not stored in {code or 'the unassigned row'}.", 409,
                                     "insufficient_stock")
            if row["qty"] is not None:
                if qty > row["qty"]:
                    raise InventoryError(f"Only {row['qty']} of {part['name']} in {code or 'unassigned'}; "
                                         f"cannot take {qty}.", 409, "insufficient_stock")
                row["qty"] = model.round_qty(row["qty"] - qty)
            taken_from = row["location"] or "unassigned"
        name = _project_name(inv, project)
        use = next((item for item in part["uses"] if item["project"].lower() == name.lower()), None)
        if use:
            use["qty"] = None if use["qty"] is None else model.round_qty(use["qty"] + qty)
            if note:
                use["note"] = note
        else:
            use = {"project": name, "qty": qty, "note": note}
            part["uses"].append(use)
        part["updatedAt"] = model.now_iso()
        return _use_result(inv, part, project=use["project"], in_project=use["qty"], taken_from=taken_from)

    return ctx.store.transaction(mutate)


@operation("return_part", "Return pieces from a project", "POST", "/api/parts/{id}/uses/return", obj({
    "id": PART_ID,
    "project": string("Project the pieces come out of (see the part's uses)."),
    "qty": {"type": ["number", "null"], "minimum": 0, "description": "Pieces; omit or null for all of them."},
    "to_location": {"type": ["string", "null"],
                    "description": "Location code to put the pieces back into (\"unassigned\" = the unassigned row). "
                                   "null = they do not go back to stock (used up, broken or given away)."},
}, required=["id", "project", "to_location"]))
def return_part(ctx, args):
    """Takes pieces out of a project: back into the stock at to_location, or with to_location null just off the
    project. The project disappears from the part's uses when no pieces are left in it."""
    part_id = arg_str(args, "id", required=True)
    project = arg_str(args, "project", required=True)
    qty = arg_number(args, "qty")
    if qty is not None and qty <= 0:
        raise InventoryError("'qty' must be positive.", 400, "invalid_arguments")
    if "to_location" not in args:
        raise InventoryError("'to_location' is required: the location code to put the pieces back into, or null "
                             "when they are used up.", 400, "invalid_arguments")
    target = arg_str(args, "to_location")

    def mutate(inv):
        part = require_part(inv, part_id)
        use = next((item for item in part["uses"] if item["project"].lower() == project.lower()), None)
        if use is None:
            known = ", ".join(item["project"] for item in part["uses"]) or "none"
            raise InventoryError(f'{part["name"]} is not in use in "{project}". Its projects: {known}.', 409,
                                 "not_in_use")
        if qty is not None and use["qty"] is not None and qty > use["qty"]:
            raise InventoryError(f"Only {use['qty']} of {part['name']} in use in {use['project']}.", 409,
                                 "insufficient_stock")
        amount = use["qty"] if qty is None else qty
        if qty is None or (use["qty"] is not None and qty >= use["qty"]):
            part["uses"].remove(use)
        elif use["qty"] is not None:
            use["qty"] = model.round_qty(use["qty"] - qty)
        returned_to = None
        notes = []
        if target is not None:
            code = _use_location(inv, target)
            row = _stock_row(part, code)
            if row is None:
                part["stock"].append({"location": code, "qty": amount})
            else:
                row["qty"] = None if row["qty"] is None or amount is None else model.round_qty(row["qty"] + amount)
            returned_to = code or "unassigned"
            notes = model.ensure_references(inv, part, ctx.store.defaults)
        part["updatedAt"] = model.now_iso()
        return _use_result(inv, part, project=use["project"], returned=amount, returned_to=returned_to, notes=notes)

    return ctx.store.transaction(mutate)


@operation("add_image", "Add a photo to a part", "POST", "/api/parts/{id}/images", obj({
    "id": PART_ID,
    "url": string("http(s) URL of the photo to download."),
    "data_base64": string("The photo as base64 (or a data: URL), instead of url."),
    "cover": {"type": "boolean", "description": "Make it the first (cover) photo."},
}, required=["id"]))
def add_image(ctx, args):
    """Downloads (url) or decodes (data_base64) a photo, scales it down, creates a thumbnail and attaches it
    to the part. The REST endpoint also accepts the raw image as request body (Content-Type image/*)."""
    part_id = arg_str(args, "id", required=True)
    inv = ctx.store.load()
    part = require_part(inv, part_id)
    if args.get("_bytes") is not None:
        data = args["_bytes"]
    elif arg_str(args, "url"):
        data = images.download(arg_str(args, "url"))
    elif arg_str(args, "data_base64"):
        data = images.decode_base64(args["data_base64"])
    else:
        raise InventoryError("Give 'url' or 'data_base64'.", 400, "invalid_arguments")
    full, full_ext, thumb, thumb_ext = images.prepare(data)
    image = ctx.store.save_image(part["name"], full, full_ext, thumb, thumb_ext)
    cover = bool(arg_bool(args, "cover"))

    def mutate(inv):
        current = require_part(inv, part_id)
        if cover:
            current["images"].insert(0, image)
        else:
            current["images"].append(image)
        current["updatedAt"] = model.now_iso()
        return len(current["images"])

    count = ctx.store.transaction(mutate)
    result = {"id": part_id, "image": {**image, "url": ctx.file_url(image["src"])}, "images": count}
    if not thumb:
        result["note"] = "Stored without resizing (Pillow is not installed on the server)."
    return result


# --------------------------------------------------------------------------- locations, fields, categories

def _join_place(inv, place, location):
    """A place written in another case joins the existing place of that name."""
    lower = place.lower()
    others = (loc["place"] for loc in inv["locations"] if loc is not location and loc["place"])
    return next((name for name in others if name.lower() == lower), place) if place else ""


@operation("upsert_location", "Create or edit a location", "PUT", "/api/locations/{code}", obj({
    "code": string("Location code, e.g. A1 (the label on the box)."),
    "name": string("Descriptive name, e.g. Blue box."),
    "place": string("Place the location is in, e.g. Place 1 (see get_schema places); \"\" = none."),
    "color": string("#rrggbb color of the box."),
    "notes": string("Where it is, what goes in it."),
    "rename_to": string("New code; all parts are updated."),
}, required=["code"]), idempotent=True)
def upsert_location(ctx, args):
    """Creates a location (box, drawer, shelf) or changes its name, place, color, notes or code."""
    code = arg_str(args, "code", required=True)
    rename_to = arg_str(args, "rename_to")

    def mutate(inv):
        location = model.find_location(inv, code)
        if location is None:
            used = {loc["color"] for loc in inv["locations"]}
            location = model.normalize_location({
                "code": code, "name": args.get("name") or code, "place": args.get("place") or "",
                "color": args.get("color") or next((c for c in LOCATION_COLORS if c not in used), LOCATION_COLORS[0]),
                "notes": args.get("notes") or "",
            })
            if not location:
                raise InventoryError("Invalid location code.", 400, "invalid_arguments")
            location["place"] = _join_place(inv, location["place"], location)
            inv["locations"].append(location)
            created = True
        else:
            created = False
            if "name" in args:
                location["name"] = str(args.get("name") or "").strip() or location["code"]
            if "place" in args:
                location["place"] = _join_place(inv, model.normalize_place(args.get("place")), location)
            if "color" in args:
                location["color"] = model.normalize_color(args.get("color"))
            if "notes" in args:
                location["notes"] = str(args.get("notes") or "")
        if rename_to and rename_to != location["code"]:
            clash = model.find_location(inv, rename_to)
            if clash and clash is not location:
                raise InventoryError(f'Location "{rename_to}" already exists.', 409, "conflict")
            old = location["code"]
            location["code"] = model.normalize_location_code(rename_to)
            if location["name"] == old and "name" not in args:
                location["name"] = location["code"]
            for part in inv["parts"]:
                for row in part["stock"]:
                    if row["location"] == old:
                        row["location"] = location["code"]
        return {"location": location, "created": created}

    return ctx.store.transaction(mutate)


@operation("delete_location", "Delete a location", "DELETE", "/api/locations/{code}", obj({
    "code": string("Location code."),
    "move_to": string("Location code to move its stock to; omitted = stock becomes unassigned."),
}, required=["code"]), destructive=True, query=("move_to",))
def delete_location(ctx, args):
    """Removes a location. Stock stored there moves to 'move_to' or becomes unassigned."""
    code = arg_str(args, "code", required=True)
    move_to = arg_str(args, "move_to")

    def mutate(inv):
        location = model.find_location(inv, code)
        if not location:
            raise not_found(f'No location "{code}".')
        target = None
        if move_to:
            target_location = model.find_location(inv, move_to)
            if not target_location:
                raise InventoryError(f'Unknown target location "{move_to}".', 400, "unknown_location")
            target = target_location["code"]
        inv["locations"].remove(location)
        affected = 0
        for part in inv["parts"]:
            if any(row["location"] == location["code"] for row in part["stock"]):
                for row in part["stock"]:
                    if row["location"] == location["code"]:
                        row["location"] = target
                part["stock"] = model.merge_stock(part["stock"])
                affected += 1
        return {"deleted": location["code"], "parts_moved": affected, "moved_to": target}

    return ctx.store.transaction(mutate)


def _field_key_from_label(label, taken):
    words = re.sub(r"[^a-z0-9]+", " ", model.fold(label)).split()
    key = "".join(word if i == 0 else word[:1].upper() + word[1:] for i, word in enumerate(words))[:40]
    if not key or not key[0].isalpha():
        key = "field" + (key[:1].upper() + key[1:] if key else "")
    return model.unique_id(key, taken).replace("-", "")


@operation("upsert_field", "Create or edit a property", "POST", "/api/fields", obj({
    "key": string("Existing key to edit, or the key for a new property (letters/digits, starting with a letter). "
                  "Omit to derive it from the label."),
    "label": string("Display name, e.g. Max frequency."),
    "type": {"type": "string", "enum": list(model.FIELD_TYPES)},
    "unit": string("Unit shown after values, e.g. MHz."),
    "options": {"type": "array", "items": {"type": "string"}, "description": "Suggested values for select/multi."},
    "categories": {"type": "array", "items": {"type": "string"},
                   "description": "Category ids that should use this property (it is added to their list)."},
}), idempotent=True)
def upsert_field(ctx, args):
    """Defines a new property (field) or changes an existing one, and optionally adds it to categories.
    Properties become filters in the app."""
    key = arg_str(args, "key")
    field_type = arg_str(args, "type")
    if field_type and field_type not in model.FIELD_TYPES:
        raise InventoryError(f"'type' must be one of {', '.join(model.FIELD_TYPES)}.", 400, "invalid_arguments")
    categories = arg_list(args, "categories") or []

    def mutate(inv):
        existing = next((item for item in inv["fields"] if key and item["key"] == key), None)
        if existing:
            raw = dict(existing)
            for name in ("label", "unit", "options"):
                if name in args:
                    raw[name] = args.get(name)
            if field_type:
                raw["type"] = field_type
            updated = model.normalize_field(raw)
            inv["fields"][inv["fields"].index(existing)] = updated
            created = False
        else:
            label = arg_str(args, "label")
            if not label:
                raise InventoryError("'label' is required for a new property.", 400, "invalid_arguments")
            taken = {item["key"] for item in inv["fields"]}
            new_key = key or _field_key_from_label(label, taken)
            if not model.KEY_RE.match(new_key):
                raise InventoryError("Invalid key (letters, digits, _ or -, starting with a letter).", 400,
                                     "invalid_arguments")
            updated = model.normalize_field({"key": new_key, "label": label, "type": field_type or "text",
                                             "unit": args.get("unit"), "options": args.get("options")})
            inv["fields"].append(updated)
            created = True
        for category_id in categories:
            require_category(inv, category_id)
            category = model.find_category(inv, category_id)
            if updated["key"] not in category["fields"]:
                category["fields"].append(updated["key"])
        return {"field": updated, "created": created,
                "categories": [cat["id"] for cat in inv["categories"] if updated["key"] in cat["fields"]]}

    return ctx.store.transaction(mutate)


@operation("upsert_category", "Create or edit a category", "POST", "/api/categories", obj({
    "id": string("Existing category id to edit; omit to create a new one."),
    "name": string("Display name."),
    "icon": {"type": "string", "enum": CATEGORY_ICONS},
    "fields": {"type": "array", "items": {"type": "string"},
               "description": "Property keys used by this category, in display order (replaces the list)."},
}), idempotent=True)
def upsert_category(ctx, args):
    """Creates a category or changes its name, icon or list of properties. New categories are placed before
    'other', which stays the catch-all at the end."""
    category_id = arg_str(args, "id")
    keys = arg_list(args, "fields")

    def mutate(inv):
        known = {item["key"] for item in inv["fields"]}
        if keys is not None:
            missing = [key for key in keys if key not in known]
            if missing:
                raise InventoryError(f"Unknown property keys {missing}; define them with upsert_field first.", 400,
                                     "unknown_field")
        category = model.find_category(inv, category_id) if category_id else None
        if category:
            if "name" in args and arg_str(args, "name"):
                category["name"] = arg_str(args, "name")
            if "icon" in args and args.get("icon"):
                category["icon"] = str(args["icon"])
            if keys is not None:
                category["fields"] = list(dict.fromkeys(keys))
            return {"category": category, "created": False}
        name = arg_str(args, "name")
        if not name:
            raise InventoryError("'name' is required for a new category.", 400, "invalid_arguments")
        taken = {item["id"] for item in inv["categories"]}
        new_id = category_id or model.unique_id(model.slugify(name) or "category", taken)
        if new_id in taken:
            raise InventoryError(f'Category "{new_id}" already exists.', 409, "conflict")
        category = model.normalize_category({"id": new_id, "name": name, "icon": args.get("icon") or "shapes",
                                             "fields": keys or []})
        other = next((i for i, cat in enumerate(inv["categories"]) if cat["id"] == model.FALLBACK_CATEGORY), None)
        inv["categories"].insert(len(inv["categories"]) if other is None else other, category)
        return {"category": category, "created": True}

    return ctx.store.transaction(mutate)
