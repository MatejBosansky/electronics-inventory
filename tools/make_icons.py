#!/usr/bin/env python3
"""Renders the PNG app icons (same artwork as app/icons/icon.svg) with the standard library only.

    python3 tools/make_icons.py

The PNGs are full-bleed squares, as required for iOS home screen icons and maskable web app icons.
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "app" / "icons"
BACKGROUND = (0x0F, 0x76, 0x6E)
FOREGROUND = (0xFF, 0xFF, 0xFF)
STROKE = 3.2  # in the 64-unit artwork space

# Artwork in a 64×64 space: two rounded rectangles and eight pins (line segments).
ROUNDED_RECTS = [(18, 18, 28, 28, 5), (26, 26, 12, 12, 2)]
SEGMENTS = [
    ((26, 11), (26, 18)), ((38, 11), (38, 18)), ((26, 46), (26, 53)), ((38, 46), (38, 53)),
    ((11, 26), (18, 26)), ((11, 38), (18, 38)), ((46, 26), (53, 26)), ((46, 38), (53, 38)),
]


def rounded_rect_distance(px, py, x, y, w, h, r):
    cx, cy = x + w / 2, y + h / 2
    qx = abs(px - cx) - (w / 2 - r)
    qy = abs(py - cy) - (h / 2 - r)
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    inside = min(max(qx, qy), 0.0)
    return outside + inside - r


def segment_distance(px, py, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def foreground_distance(x, y):
    d = min(abs(rounded_rect_distance(x, y, *rect)) for rect in ROUNDED_RECTS)
    d = min(d, min(segment_distance(x, y, a, b) for a, b in SEGMENTS))
    return d - STROKE / 2


def render(size):
    scale = 64 / size  # artwork units per pixel
    rows = bytearray()
    for j in range(size):
        rows.append(0)  # PNG filter type: none
        y = (j + 0.5) * scale
        for i in range(size):
            x = (i + 0.5) * scale
            coverage = max(0.0, min(1.0, 0.5 - foreground_distance(x, y) / scale))
            for k in range(3):
                rows.append(round(BACKGROUND[k] + (FOREGROUND[k] - BACKGROUND[k]) * coverage))
    return bytes(rows)


def png(size):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(render(size), 9)) + chunk(b"IEND", b"")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, size in (("apple-touch-icon.png", 180), ("icon-192.png", 192), ("icon-512.png", 512)):
        (OUT / name).write_bytes(png(size))
        print(f"wrote {OUT / name}")


if __name__ == "__main__":
    main()
