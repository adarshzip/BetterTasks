#!/usr/bin/env python3
"""
Generates the extension icons.

Written as a script rather than checked in as opaque binaries so the icons are
reproducible from source and the build needs no image dependency. The mark is a
checklist: two rules and a tick, which is about as much detail as survives at
16px.

Run: python3 scripts/make-icons.py
"""
import struct
import zlib
from pathlib import Path

BG = (26, 115, 232)  # Google blue, matching the panel's light-mode accent
FG = (255, 255, 255)
SUPERSAMPLE = 6  # rendered large and averaged down, for smooth edges
SIZES = (16, 32, 48, 128)


def inside_rounded_rect(px, py, size, radius):
    """Whether a point falls inside a rounded square filling the canvas."""
    if not (0 <= px < size and 0 <= py < size):
        return False
    cx = min(max(px, radius), size - radius)
    cy = min(max(py, radius), size - radius)
    return (px - cx) ** 2 + (py - cy) ** 2 <= radius * radius


def near_segment(px, py, x1, y1, x2, y2, width):
    """Whether a point lies within `width` of a line segment, for strokes."""
    dx, dy = x2 - x1, y2 - y1
    length2 = dx * dx + dy * dy
    t = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length2))
    nx, ny = x1 + t * dx, y1 + t * dy
    return (px - nx) ** 2 + (py - ny) ** 2 <= (width / 2) ** 2


def render(size):
    """Returns RGBA rows for one icon, supersampled then averaged down."""
    big = size * SUPERSAMPLE
    unit = big / 128.0
    radius = 28 * unit

    # Positioned on a 128-unit grid so every size renders identically.
    strokes = (
        (34 * unit, 44 * unit, 96 * unit, 44 * unit, 11 * unit),
        (34 * unit, 68 * unit, 74 * unit, 68 * unit, 11 * unit),
        (36 * unit, 94 * unit, 54 * unit, 110 * unit, 13 * unit),
        (54 * unit, 110 * unit, 98 * unit, 76 * unit, 13 * unit),
    )

    samples = SUPERSAMPLE * SUPERSAMPLE
    rows = []

    for y in range(size):
        row = bytearray()
        for x in range(size):
            r = g = b = 0
            covered = 0

            for sy in range(SUPERSAMPLE):
                py = y * SUPERSAMPLE + sy + 0.5
                for sx in range(SUPERSAMPLE):
                    px = x * SUPERSAMPLE + sx + 0.5
                    if not inside_rounded_rect(px, py, big, radius):
                        continue

                    colour = FG if any(near_segment(px, py, *s) for s in strokes) else BG
                    r += colour[0]
                    g += colour[1]
                    b += colour[2]
                    covered += 1

            if covered == 0:
                row += bytes((0, 0, 0, 0))
            else:
                # Colour averaged over covered samples only, so edge pixels take
                # the shape's colour rather than fading towards black.
                row += bytes((r // covered, g // covered, b // covered, covered * 255 // samples))

        rows.append(bytes(row))

    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def main():
    out = Path(__file__).resolve().parent.parent / "public" / "icons"
    out.mkdir(parents=True, exist_ok=True)

    for size in SIZES:
        write_png(out / f"icon-{size}.png", size, render(size))
        print(f"wrote icon-{size}.png")


if __name__ == "__main__":
    main()
