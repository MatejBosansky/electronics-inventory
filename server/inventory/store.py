"""Reading and writing the data folder (inventory.json, images/, backups/).

Every change runs as a transaction: read inventory.json, apply the change, write a new file and
atomically rename it into place - but only if nobody (the web app, another device) replaced the
file in the meantime; otherwise the change is applied again on the newer data.
"""
import os
import re
import tempfile
import threading
from datetime import datetime
from pathlib import Path

from . import model

INVENTORY = "inventory.json"
SNAPSHOT_DIR = "backups"
MAX_SNAPSHOTS = 40
WRITABLE_RE = re.compile(r"^(inventory\.json|(images|images/thumbs|backups)/[A-Za-z0-9][A-Za-z0-9._-]*)$")
DELETABLE_RE = re.compile(r"^(images|images/thumbs|backups)/[A-Za-z0-9][A-Za-z0-9._-]*$")


class InventoryError(Exception):
    """An error meant for the caller (HTTP status + machine-readable code + message)."""

    def __init__(self, message, status=400, code="bad_request", details=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.details = details


def not_found(message):
    return InventoryError(message, 404, "not_found")


class DataStore:
    def __init__(self, root, defaults):
        self.root = Path(root).expanduser().resolve()
        self.defaults = defaults
        self._lock = threading.RLock()
        self._snapshot_day = None

    # ------------------------------------------------------------------ paths and files

    def resolve(self, rel):
        parts = [part for part in str(rel).split("/") if part]
        if not parts or any(part in (".", "..") or part.startswith(".") for part in parts):
            raise InventoryError(f"Invalid path: {rel}")
        path = self.root.joinpath(*parts)
        try:
            path.resolve().relative_to(self.root)
        except ValueError as err:
            raise InventoryError(f"Invalid path: {rel}") from err
        return path

    @staticmethod
    def signature(path):
        try:
            stat = path.stat()
        except FileNotFoundError:
            return None
        return (stat.st_ino, stat.st_size, stat.st_mtime_ns)

    def write_atomic(self, rel, data):
        """Writes bytes to a temporary file in .tmp/ and renames it into place."""
        path = self.resolve(rel)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._write_temp(data)
        os.replace(temp_path, path)

    def _write_temp(self, data):
        temp_dir = self.root / ".tmp"
        temp_dir.mkdir(parents=True, exist_ok=True)
        fd, temp_path = tempfile.mkstemp(dir=temp_dir)
        try:
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.chmod(temp_path, 0o664)
        except BaseException:
            Path(temp_path).unlink(missing_ok=True)
            raise
        return temp_path

    def read_bytes(self, rel):
        path = self.resolve(rel)
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def remove(self, rel):
        path = self.resolve(rel)
        try:
            path.unlink()
            return True
        except FileNotFoundError:
            return False

    def list_dir(self, rel):
        path = self.resolve(rel) if rel else self.root
        if not path.is_dir():
            return []
        out = []
        for entry in sorted(os.scandir(path), key=lambda item: item.name):
            if entry.name.startswith("."):
                continue
            stat = entry.stat()
            out.append({"name": entry.name, "dir": entry.is_dir(), "size": stat.st_size, "mtime": stat.st_mtime})
        return out

    # ------------------------------------------------------------------ inventory

    @property
    def inventory_path(self):
        return self.root / INVENTORY

    def _read(self):
        path = self.inventory_path
        for _ in range(3):
            before = self.signature(path)
            if before is None:
                return None, None
            try:
                data = path.read_text(encoding="utf-8")
            except FileNotFoundError:
                continue
            if self.signature(path) == before:
                return data, before
        raise InventoryError("inventory.json is changing too fast; try again.", 409, "conflict")

    def load(self):
        """The current inventory (normalized). A missing file gives an empty inventory."""
        data, _ = self._read()
        if data is None:
            return model.create_inventory(self.defaults)
        try:
            return model.parse_inventory(data, self.defaults)
        except model.FormatError as err:
            raise InventoryError(str(err), 500, "invalid_inventory") from err

    def transaction(self, mutate):
        """Runs mutate(inventory) on fresh data and saves the result. Returns mutate's result."""
        with self._lock:
            for _ in range(5):
                data, before = self._read()
                if data is None:
                    inv = model.create_inventory(self.defaults)
                else:
                    try:
                        inv = model.parse_inventory(data, self.defaults)
                    except model.FormatError as err:
                        raise InventoryError(str(err), 500, "invalid_inventory") from err
                result = mutate(inv)
                inv["updatedAt"] = model.now_iso()
                if self._commit(model.serialize(inv).encode("utf-8"), data, before):
                    return result
            raise InventoryError("inventory.json keeps being changed by someone else; try again.", 409, "conflict")

    def _commit(self, payload, previous_text, previous_signature):
        self._snapshot_if_needed(previous_text)
        path = self.inventory_path
        path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = self._write_temp(payload)
        if self.signature(path) != previous_signature:
            Path(temp_path).unlink(missing_ok=True)
            return False
        os.replace(temp_path, path)
        self._ensure_new_etag(path, previous_signature)
        return True

    @staticmethod
    def _ensure_new_etag(path, previous_signature):
        """nginx's ETag is "<mtime seconds>-<size>": make sure it changes even within the same second."""
        if not previous_signature:
            return
        _, old_size, old_mtime_ns = previous_signature
        stat = path.stat()
        old_seconds = old_mtime_ns // 1_000_000_000
        if stat.st_size == old_size and int(stat.st_mtime) <= old_seconds:
            os.utime(path, ns=(stat.st_atime_ns, (old_seconds + 1) * 1_000_000_000))

    # ------------------------------------------------------------------ snapshots

    def _snapshot_if_needed(self, previous_text):
        """Keeps the state from before the first change of each day (same naming as the web app)."""
        if previous_text is None:
            return
        day = datetime.now().strftime("%Y-%m-%d")
        if self._snapshot_day == day:
            return
        rel = f"{SNAPSHOT_DIR}/inventory-{day}.json"
        if not self.resolve(rel).exists():
            self.write_atomic(rel, previous_text.encode("utf-8"))
            self._prune_snapshots()
        self._snapshot_day = day

    def _prune_snapshots(self):
        directory = self.root / SNAPSHOT_DIR
        snapshots = sorted(
            (entry for entry in directory.glob("inventory-*.json") if entry.is_file()),
            key=lambda entry: (entry.stat().st_mtime, entry.name),
            reverse=True,
        )
        for old in snapshots[MAX_SNAPSHOTS:]:
            old.unlink(missing_ok=True)

    # ------------------------------------------------------------------ images

    def save_image(self, base_name, full, full_ext, thumb=None, thumb_ext=None):
        """Stores an image (and optional thumbnail) under a new unique name."""
        base = f"{model.slugify(base_name, 40) or 'image'}-{model.random_token(5)}"
        image = {"src": f"images/{base}.{full_ext}"}
        self.write_atomic(image["src"], full)
        if thumb:
            image["thumb"] = f"images/thumbs/{base}.{thumb_ext}"
            self.write_atomic(image["thumb"], thumb)
        return image
