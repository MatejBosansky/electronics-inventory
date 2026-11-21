"""Default fields and categories, shared with the web app (app/js/defaults.js)."""
import json
import os
from pathlib import Path

DEFAULTS_FILE = Path(__file__).resolve().parents[2] / "app" / "js" / "defaults.js"
BEGIN = "/* BEGIN DEFAULTS */"
END = "/* END DEFAULTS */"


def load_defaults(path=None):
    """Reads the JSON block between the BEGIN/END markers of defaults.js."""
    source = Path(path or os.environ.get("INVENTORY_DEFAULTS") or DEFAULTS_FILE)
    text = source.read_text(encoding="utf-8")
    try:
        body = text.split(BEGIN, 1)[1].split(END, 1)[0]
    except IndexError as err:
        raise RuntimeError(f"{source}: default markers not found") from err
    data = json.loads(body)
    if not isinstance(data.get("fields"), list) or not isinstance(data.get("categories"), list):
        raise RuntimeError(f"{source}: 'fields' and 'categories' lists are required")
    return data
