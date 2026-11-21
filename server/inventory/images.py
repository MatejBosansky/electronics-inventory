"""Getting images from URLs or base64 data and preparing them like the web app does.

With Pillow installed, photos are scaled to max. 1600 px and a 480 px thumbnail is created.
Without Pillow the original file is stored as it is (the app then uses it for the lists too).
"""
import base64
import binascii
import io
import ipaddress
import socket
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from .store import InventoryError

try:  # optional dependency
    from PIL import Image, ImageOps, features

    HAVE_PILLOW = True
except ImportError:  # pragma: no cover - depends on the environment
    HAVE_PILLOW = False

MAX_BYTES = 20 * 1024 * 1024
FULL_MAX = 1600
THUMB_MAX = 480
KEEP_ORIGINAL_BYTES = 700 * 1024
USER_AGENT = "electronics-inventory/1.0 (image download)"


def sniff(data):
    """File extension for supported image bytes, else None."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[4:12] in (b"ftypavif", b"ftypavis"):
        return "avif"
    return None


def _check_host(host):
    """Refuses loopback, link-local and similar addresses (basic protection against SSRF)."""
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as err:
        raise InventoryError(f"Cannot resolve host {host}.", 400, "download_failed") from err
    for info in infos:
        address = ipaddress.ip_address(info[4][0].split("%", 1)[0])
        if address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified:
            raise InventoryError(f"Downloading from {host} is not allowed.", 400, "download_failed")


def _check_url(url):
    parts = urlsplit(str(url or ""))
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise InventoryError("Image URL must be an http(s) URL.", 400, "download_failed")
    _check_host(parts.hostname)


class _CheckedRedirects(urllib.request.HTTPRedirectHandler):
    """Applies the same host check to every redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_OPENER = urllib.request.build_opener(_CheckedRedirects)


def download(url):
    _check_url(url)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*;q=0.5"})
    try:
        with _OPENER.open(request, timeout=20) as response:
            data = response.read(MAX_BYTES + 1)
    except (urllib.error.URLError, TimeoutError, OSError) as err:
        raise InventoryError(f"Could not download {url}: {err}", 400, "download_failed") from err
    if len(data) > MAX_BYTES:
        raise InventoryError("The image is larger than 20 MB.", 400, "image_too_large")
    return data


def decode_base64(value):
    raw = str(value or "")
    if raw.startswith("data:"):
        raw = raw.split(",", 1)[-1]
    try:
        data = base64.b64decode(raw, validate=False)
    except (binascii.Error, ValueError) as err:
        raise InventoryError("data_base64 is not valid base64.", 400, "invalid_image") from err
    if len(data) > MAX_BYTES:
        raise InventoryError("The image is larger than 20 MB.", 400, "image_too_large")
    return data


def _encode(image, has_alpha, quality):
    buffer = io.BytesIO()
    if features.check("webp"):
        image.convert("RGBA" if has_alpha else "RGB").save(buffer, "WEBP", quality=quality, method=4)
        return buffer.getvalue(), "webp"
    if has_alpha:
        image.convert("RGBA").save(buffer, "PNG", optimize=True)
        return buffer.getvalue(), "png"
    image.convert("RGB").save(buffer, "JPEG", quality=quality, optimize=True, progressive=True)
    return buffer.getvalue(), "jpg"


def _scaled(image, size):
    copy = image.copy()
    copy.thumbnail((size, size), Image.LANCZOS)
    return copy


def prepare(data):
    """Returns (full_bytes, full_ext, thumb_bytes_or_None, thumb_ext_or_None)."""
    kind = sniff(data)
    if not HAVE_PILLOW:
        if kind not in ("jpg", "png", "gif", "webp"):
            raise InventoryError("Unsupported image (use JPEG, PNG, GIF or WebP).", 400, "invalid_image")
        return data, kind, None, None
    try:
        image = Image.open(io.BytesIO(data))
        image.load()
    except Exception as err:  # Pillow raises many different errors for bad input
        raise InventoryError("The file is not an image that can be read.", 400, "invalid_image") from err
    orientation = image.getexif().get(0x0112, 1) if hasattr(image, "getexif") else 1
    image = ImageOps.exif_transpose(image)
    has_alpha = image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info)
    width, height = image.size
    keep = (kind in ("jpg", "png", "webp") and max(width, height) <= FULL_MAX
            and len(data) <= KEEP_ORIGINAL_BYTES and orientation in (None, 1))
    if keep:
        full, full_ext = data, kind
    else:
        full, full_ext = _encode(_scaled(image, FULL_MAX), has_alpha, 86)
    thumb, thumb_ext = _encode(_scaled(image, THUMB_MAX), has_alpha, 80)
    return full, full_ext, thumb, thumb_ext
