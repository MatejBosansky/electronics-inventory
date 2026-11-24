"""Data model of inventory.json: normalization and helpers.

Mirrors app/js/schema.js so that data written by the server looks exactly like data written by
the web app (same keys, key order and formatting). See docs/DATA_FORMAT.md.
"""
import copy
import json
import re
import secrets
import unicodedata
from datetime import datetime, timezone
from urllib.parse import urlsplit

FORMAT = "electronics-inventory"
VERSION = 4  # 2: locations have a "place"; 3: parts have "numbers"; 4: parts have "uses"
DEFAULT_TITLE = "Electronics Inventory"
FIELD_TYPES = ("text", "number", "select", "multi", "bool")
FALLBACK_CATEGORY = "other"
DEFAULT_LOCATION_COLOR = "#6b7280"
KEY_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,47}$")
SAFE_IMAGE_RE = re.compile(r"^images/(thumbs/)?[A-Za-z0-9][A-Za-z0-9._-]*$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"


class FormatError(ValueError):
    """inventory.json cannot be used (invalid JSON, unknown format or newer version)."""


# --------------------------------------------------------------------------- small helpers

def now_iso():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def text(value):
    return "" if value is None else str(value)


def fold(value):
    """Lower-cases and strips diacritics (for search and slugs)."""
    decomposed = unicodedata.normalize("NFD", text(value))
    return "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn").lower()


def slugify(value, max_length=48):
    slug = re.sub(r"[^a-z0-9]+", "-", fold(value)).strip("-")
    return slug[:max_length].rstrip("-")


def unique_id(base, taken):
    root = base or "item"
    candidate = root
    n = 2
    while candidate in taken:
        candidate = f"{root}-{n}"
        n += 1
    return candidate


def random_token(length=5):
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(length))


def clean_number(value):
    """Integral floats become ints so JSON looks like the app's output (1 instead of 1.0)."""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def round_qty(value):
    return clean_number(round(value * 1000) / 1000)


def parse_qty(value):
    """None, '' and '?' mean unknown; otherwise a non-negative number."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return clean_number(max(0, value)) if value == value and abs(value) != float("inf") else None
    raw = text(value).strip().replace(",", ".")
    if raw in ("", "?"):
        return None
    try:
        number = float(raw)
    except ValueError:
        return None
    return clean_number(max(0.0, number)) if number == number and abs(number) != float("inf") else None


def unique_strings(items):
    out, seen = [], set()
    for item in items:
        value = text(item).strip()
        key = value.lower()
        if value and key not in seen:
            seen.add(key)
            out.append(value)
    return out


def split_list(value):
    return unique_strings(re.split(r"[,;\n]", text(value)))


def safe_url(value):
    raw = text(value).strip()
    if not raw:
        return None
    try:
        parts = urlsplit(raw)
    except ValueError:
        return None
    if parts.scheme in ("http", "https") and parts.netloc:
        return raw
    if parts.scheme == "mailto" and parts.path:
        return raw
    return None


def hostname(url):
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def is_remote(path):
    return bool(re.match(r"^https?://", text(path), re.I))


def is_safe_image_path(path):
    return bool(SAFE_IMAGE_RE.match(path)) or is_remote(path)


# --------------------------------------------------------------------------- normalization

def normalize_field(raw):
    if not isinstance(raw, dict):
        return None
    key = text(raw.get("key")).strip()
    if not KEY_RE.match(key):
        return None
    field_type = raw.get("type") if raw.get("type") in FIELD_TYPES else "text"
    field = {"key": key, "label": text(raw.get("label")).strip() or key, "type": field_type}
    unit = text(raw.get("unit")).strip()
    if unit:
        field["unit"] = unit
    options = raw.get("options")
    if isinstance(options, list) and field_type in ("select", "multi"):
        cleaned = unique_strings(options)
        if cleaned:
            field["options"] = cleaned
    return field


def normalize_fields(raw, defaults):
    if not isinstance(raw, list):
        return copy.deepcopy(defaults["fields"])
    out, seen = [], set()
    for item in raw:
        field = normalize_field(item)
        if field and field["key"] not in seen:
            seen.add(field["key"])
            out.append(field)
    return out


def normalize_category(raw):
    if not isinstance(raw, dict):
        return None
    name = text(raw.get("name")).strip()
    category_id = text(raw.get("id")).strip() or slugify(name)
    if not category_id:
        return None
    fields = []
    for key in raw.get("fields") or []:
        key = text(key)
        if KEY_RE.match(key) and key not in fields:
            fields.append(key)
    return {"id": category_id, "name": name or category_id, "icon": text(raw.get("icon")).strip() or "shapes",
            "fields": fields}


def normalize_categories(raw, defaults):
    if not isinstance(raw, list):
        return copy.deepcopy(defaults["categories"])
    out, seen = [], set()
    for item in raw:
        category = normalize_category(item)
        if category and category["id"] not in seen:
            seen.add(category["id"])
            out.append(category)
    return out


def normalize_location_code(value):
    return text(value).strip()[:32]


def normalize_color(value):
    raw = text(value).strip()
    return raw.lower() if COLOR_RE.match(raw) else DEFAULT_LOCATION_COLOR


def normalize_place(value):
    """Place a location belongs to (e.g. "Place 1"); "" = none."""
    return text(value).strip()[:60]


def normalize_location(raw):
    if not isinstance(raw, dict):
        return None
    code = normalize_location_code(raw.get("code", raw.get("id")))
    if not code:
        return None
    return {"code": code, "name": text(raw.get("name")).strip() or code, "place": normalize_place(raw.get("place")),
            "color": normalize_color(raw.get("color")), "notes": text(raw.get("notes"))}


def unify_places(locations):
    """Places that differ only in case get one spelling (the first one used)."""
    spelling = {}
    for location in locations:
        if not location["place"]:
            continue
        key = location["place"].lower()
        if key in spelling:
            location["place"] = spelling[key]
        else:
            spelling[key] = location["place"]
    return locations


def normalize_locations(raw):
    if not isinstance(raw, list):
        return []
    out, seen = [], set()
    for item in raw:
        location = normalize_location(item)
        if location and location["code"].lower() not in seen:
            seen.add(location["code"].lower())
            out.append(location)
    return unify_places(out)


def number_key(number):
    """Comparison key of an ID number: case and punctuation do not matter ("B-12" = "b12")."""
    return re.sub(r"[^a-z0-9]", "", fold(number))


def normalize_numbers(raw):
    """ID numbers written on a part's bag or label, e.g. "57" or "B-12" (same rules as the app)."""
    items = raw if isinstance(raw, list) else [] if raw is None else [raw]
    out, seen = [], set()
    for item in items:
        if isinstance(item, float) and item.is_integer():
            item = int(item)
        for piece in re.split(r"[,;\s]+", text(item)):
            number = re.sub(r"^#+", "", piece)[:24]
            key = number_key(number)
            if key and key not in seen:
                seen.add(key)
                out.append(number)
    return out


def normalize_tags(raw):
    joined = ",".join(text(item) for item in raw) if isinstance(raw, list) else text(raw)
    return [tag[:40] for tag in split_list(joined)]


def normalize_stock(raw, legacy=None):
    rows = raw
    if not isinstance(rows, list) and isinstance(legacy, dict) and ("quantity" in legacy or "location" in legacy):
        rows = [{"location": legacy.get("location"), "qty": legacy.get("quantity")}]
    if not isinstance(rows, list):
        return []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        qty = row.get("qty", row.get("quantity"))
        out.append({"location": normalize_location_code(row.get("location")) or None, "qty": parse_qty(qty)})
    return out


def normalize_project(value):
    """Name of a project a part is used in, e.g. "Weather station"."""
    return text(value).strip()[:80]


def normalize_uses(raw):
    """Pieces built into projects: [{project, qty, note}]; they are not part of the stock."""
    if not isinstance(raw, list):
        return []
    out = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        project = normalize_project(row.get("project"))
        if not project:
            continue
        qty = row.get("qty")
        if qty is None:
            qty = row.get("quantity")
        out.append({"project": project, "qty": parse_qty(qty), "note": text(row.get("note")).strip()[:200]})
    return out


def unify_projects(parts):
    """Projects that differ only in case get one spelling (the first one used)."""
    spelling = {}
    for part in parts:
        for use in part["uses"]:
            key = use["project"].lower()
            if key in spelling:
                use["project"] = spelling[key]
            else:
                spelling[key] = use["project"]
    return parts


def normalize_spec_value(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return clean_number(value) if value == value and abs(value) != float("inf") else None
    if isinstance(value, list):
        items = unique_strings(value)
        return items or None
    raw = text(value).strip()
    return raw or None


def normalize_specs(raw):
    specs = {}
    if not isinstance(raw, dict):
        return specs
    for key, value in raw.items():
        if not KEY_RE.match(text(key)):
            continue
        normalized = normalize_spec_value(value)
        if normalized is not None:
            specs[key] = normalized
    return specs


def normalize_images(raw):
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        src = text(item if isinstance(item, str) else (item or {}).get("src") if isinstance(item, dict) else "").strip()
        if not src or not is_safe_image_path(src):
            continue
        image = {"src": src}
        thumb = text(item.get("thumb")).strip() if isinstance(item, dict) else ""
        if thumb and is_safe_image_path(thumb):
            image["thumb"] = thumb
        out.append(image)
    return out


def normalize_links(raw):
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        url = safe_url(item if isinstance(item, str) else (item or {}).get("url") if isinstance(item, dict) else None)
        if not url:
            continue
        label = text(item.get("label")).strip() if isinstance(item, dict) else ""
        out.append({"label": label or hostname(url) or "Link", "url": url})
    return out


def normalize_part(raw):
    """Canonical part dict (stable key order) or None for unusable input."""
    if not isinstance(raw, dict):
        return None
    now = now_iso()
    name = text(raw.get("name")).strip() or "Unnamed part"
    created = text(raw.get("createdAt")) or now
    return {
        "id": text(raw.get("id")).strip() or slugify(name) or "part",
        "name": name,
        "numbers": normalize_numbers(raw.get("numbers") if raw.get("numbers") is not None else raw.get("number")),
        "category": text(raw.get("category")).strip() or FALLBACK_CATEGORY,
        "description": text(raw.get("description")).strip(),
        "tags": normalize_tags(raw.get("tags")),
        "stock": normalize_stock(raw.get("stock"), raw),
        "uses": normalize_uses(raw.get("uses")),
        "specs": normalize_specs(raw.get("specs")),
        "images": normalize_images(raw.get("images")),
        "links": normalize_links(raw.get("links")),
        "notes": text(raw.get("notes")).rstrip(),
        "createdAt": created,
        "updatedAt": text(raw.get("updatedAt")) or created,
    }


def merge_stock(rows):
    merged = {}
    for row in rows:
        key = (row.get("location") or "").lower()
        if key not in merged:
            merged[key] = {"location": row.get("location") or None, "qty": row.get("qty")}
            continue
        existing = merged[key]
        if existing["qty"] is None or row.get("qty") is None:
            existing["qty"] = None
        else:
            existing["qty"] = round_qty(existing["qty"] + row["qty"])
    return list(merged.values())


def merge_uses(rows):
    """Merges uses of the same project: amounts add up, the first note is kept."""
    merged = {}
    for row in rows:
        key = row["project"].lower()
        if key not in merged:
            merged[key] = {"project": row["project"], "qty": row.get("qty"), "note": row.get("note") or ""}
            continue
        existing = merged[key]
        if existing["qty"] is None or row.get("qty") is None:
            existing["qty"] = None
        else:
            existing["qty"] = round_qty(existing["qty"] + row["qty"])
        if not existing["note"]:
            existing["note"] = row.get("note") or ""
    return list(merged.values())


def ensure_references(inv, part, defaults):
    """Adds categories and locations a part refers to; returns a list of created ones."""
    created = []
    if not any(cat["id"] == part["category"] for cat in inv["categories"]):
        known = next((cat for cat in defaults["categories"] if cat["id"] == part["category"]), None)
        if known:
            inv["categories"].append(copy.deepcopy(known))
        else:
            name = re.sub(r"[-_]+", " ", part["category"])
            inv["categories"].append({"id": part["category"], "name": name[:1].upper() + name[1:], "icon": "shapes",
                                      "fields": []})
        created.append(f"category {part['category']}")
    for row in part["stock"]:
        if not row["location"]:
            continue
        match = find_location(inv, row["location"])
        if match:
            row["location"] = match["code"]
        else:
            inv["locations"].append({"code": row["location"], "name": row["location"], "place": "",
                                     "color": DEFAULT_LOCATION_COLOR, "notes": ""})
            created.append(f"location {row['location']}")
    return created


def create_inventory(defaults):
    return {
        "format": FORMAT,
        "version": VERSION,
        "updatedAt": now_iso(),
        "settings": {"title": DEFAULT_TITLE},
        "fields": copy.deepcopy(defaults["fields"]),
        "categories": copy.deepcopy(defaults["categories"]),
        "locations": [],
        "parts": [],
    }


def normalize_inventory(raw, defaults):
    if not isinstance(raw, dict):
        raise FormatError("inventory.json must contain a JSON object.")
    if raw.get("format") not in (None, FORMAT):
        raise FormatError(f'inventory.json has an unknown format "{raw.get("format")}".')
    try:
        version = int(raw.get("version") or VERSION)
    except (TypeError, ValueError) as err:
        raise FormatError("inventory.json has an invalid version.") from err
    if version > VERSION:
        raise FormatError(f"inventory.json uses data format {version}; this server knows format {VERSION}.")
    settings = raw.get("settings") if isinstance(raw.get("settings"), dict) else {}
    inv = {
        "format": FORMAT,
        "version": VERSION,
        "updatedAt": text(raw.get("updatedAt")) or now_iso(),
        "settings": {"title": text(settings.get("title")).strip() or DEFAULT_TITLE},
        "fields": normalize_fields(raw.get("fields"), defaults),
        "categories": normalize_categories(raw.get("categories"), defaults),
        "locations": normalize_locations(raw.get("locations")),
        "parts": [],
    }
    ids = set()
    for item in raw.get("parts") if isinstance(raw.get("parts"), list) else []:
        part = normalize_part(item)
        if not part:
            continue
        part["id"] = unique_id(part["id"], ids)
        ids.add(part["id"])
        ensure_references(inv, part, defaults)
        inv["parts"].append(part)
    unify_projects(inv["parts"])
    return inv


def parse_inventory(data, defaults):
    try:
        raw = json.loads(data)
    except json.JSONDecodeError as err:
        raise FormatError(f"inventory.json is not valid JSON: {err}") from err
    return normalize_inventory(raw, defaults)


def serialize(inv):
    """Same layout as the web app: 2-space indentation and a trailing newline."""
    return json.dumps(inv, indent=2, ensure_ascii=False) + "\n"


# --------------------------------------------------------------------------- lookups

def field_map(inv):
    return {field["key"]: field for field in inv["fields"]}


def field_def(fields, key):
    return fields.get(key) or {"key": key, "label": key, "type": "text"}


def find_category(inv, category_id):
    return next((cat for cat in inv["categories"] if cat["id"] == category_id), None)


def find_location(inv, code):
    if not code:
        return None
    lower = text(code).lower()
    return next((loc for loc in inv["locations"] if loc["code"].lower() == lower), None)


def has_number(part, number):
    key = number_key(number)
    return bool(key) and any(number_key(item) == key for item in part["numbers"])


def part_by_number(inv, number, except_id=None):
    """The part that has this ID number, ignoring the part `except_id`."""
    return next((part for part in inv["parts"] if part["id"] != except_id and has_number(part, number)), None)


def places(inv):
    """Places in the order of their first location."""
    out = []
    for location in inv["locations"]:
        if location["place"] and location["place"] not in out:
            out.append(location["place"])
    return out


def find_place(inv, name):
    """The stored spelling of a place name (case-insensitive), or None."""
    lower = text(name).strip().lower()
    return next((place for place in places(inv) if place.lower() == lower), None) if lower else None


def place_of(inv, code):
    location = find_location(inv, code)
    return location["place"] if location else ""


def projects(inv):
    """Projects in the order they were first used."""
    out = []
    for part in inv["parts"]:
        for use in part["uses"]:
            if use["project"] not in out:
                out.append(use["project"])
    return out


def find_project(inv, name):
    """The stored spelling of a project name (case-insensitive), or None."""
    lower = normalize_project(name).lower()
    return next((project for project in projects(inv) if project.lower() == lower), None) if lower else None


def find_part(inv, part_id):
    return next((part for part in inv["parts"] if part["id"] == part_id), None)


def stock_summary(part):
    total, unknown = 0, False
    for row in part["stock"]:
        if row["qty"] is None:
            unknown = True
        else:
            total += row["qty"]
    total = round_qty(total)
    if unknown and total == 0:
        label = "?"
    elif unknown:
        label = f"{total}+"
    else:
        label = str(total)
    return {"total": total, "unknown": unknown, "text": label}


def use_summary(part):
    """Pieces in use, like stock_summary."""
    total, unknown = 0, False
    for use in part["uses"]:
        if use["qty"] is None:
            unknown = True
        else:
            total += use["qty"]
    total = round_qty(total)
    label = "?" if unknown and total == 0 else f"{total}+" if unknown else str(total)
    return {"total": total, "unknown": unknown, "text": label}


def in_stock(part):
    return any(row["qty"] is None or row["qty"] > 0 for row in part["stock"])


def spec_text(field, value):
    if value is None or value == "":
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, list):
        return ", ".join(text(item) for item in value)
    unit = field.get("unit") if field else None
    return f"{value} {unit}" if unit else text(value)


def haystack(inv, fields, part):
    """Searchable text of a part (same content as the app's search)."""
    category = find_category(inv, part["category"])
    bits = [part["id"], part["name"], part["description"], part["notes"], category["name"] if category else ""]
    bits.extend(part["numbers"])
    bits.extend(part["tags"])
    for key, value in part["specs"].items():
        field = field_def(fields, key)
        if value is True:
            bits.append(field["label"])
        elif value is not False:
            bits.append(spec_text(field, value))
    for row in part["stock"]:
        location = find_location(inv, row["location"])
        if location:
            bits.extend([location["code"], location["name"]])
    for use in part["uses"]:
        bits.extend([use["project"], use["note"]])
    bits.extend(link["label"] for link in part["links"])
    return fold(" \u0001 ".join(text(bit) for bit in bits))
