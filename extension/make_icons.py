"""Generate Bookmata extension icons (16/48/128) — an open book with a rising
chart drawn on its pages. Pure-stdlib PNG writer (RGBA)."""
import os
import struct
import zlib


def _chunk(tag: bytes, data: bytes) -> bytes:
    out = struct.pack(">I", len(data)) + tag + data
    out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return out


def write_png(path: str, px) -> None:
    size = len(px)
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            r, g, b, a = px[y][x]
            row.extend((r, g, b, a))
        rows.append(bytes(row))
    raw = b"".join(rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw, 9))
    png += _chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


def inside_round(x, y, rad, size):
    if rad <= 0:
        return 0 <= x < size and 0 <= y < size
    il, it, ir2, ib = rad, rad, size - rad, size - rad
    if il <= x <= ir2 and it <= y <= ib:
        return True
    for cx, cy in ((il, it), (ir2, it), (il, ib), (ir2, ib)):
        if (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad:
            return True
    return False


def fill_rect(px, x0, y0, x1, y1, col, size):
    x0 = max(0, x0)
    y0 = max(0, y0)
    x1 = min(size - 1, x1)
    y1 = min(size - 1, y1)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px[y][x] = col


def fill_poly(px, poly, col, size):
    ys = [p[1] for p in poly]
    ymin = max(0, min(ys))
    ymax = min(size - 1, max(ys))
    n = len(poly)
    for y in range(ymin, ymax + 1):
        xs = []
        for i in range(n):
            x1, y1 = poly[i]
            x2, y2 = poly[(i + 1) % n]
            if y1 == y2:
                continue
            if (y1 <= y < y2) or (y2 <= y < y1):
                t = (y - y1) / (y2 - y1)
                xs.append(x1 + t * (x2 - x1))
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            xa = max(0, int(xs[k]))
            xb = min(size - 1, int(xs[k + 1]))
            for x in range(xa, xb + 1):
                px[y][x] = col


def make_icon(size):
    S = size
    px = [[(0, 0, 0, 0) for _ in range(S)] for _ in range(S)]
    base = (30, 41, 59, 255)        # slate-800
    paper = (248, 250, 252, 255)    # slate-50
    spine = (51, 65, 85, 255)       # slate-700 fold
    green = (52, 211, 153, 255)     # emerald-400
    green_dark = (16, 185, 129, 255)  # emerald-500

    rad = max(2, S // 6)
    for y in range(S):
        for x in range(S):
            if inside_round(x + 0.5, y + 0.5, rad, S):
                px[y][x] = base

    mid = S // 2
    left = int(S * 0.14)
    right = int(S * 0.86)
    topBook = int(S * 0.30)
    botBook = int(S * 0.80)
    spineTop = int(S * 0.36)

    # open book: two pages rising to the spine
    fill_poly(px, [(left, botBook), (left, topBook), (mid, spineTop), (mid, botBook)], paper, S)
    fill_poly(px, [(right, botBook), (right, topBook), (mid, spineTop), (mid, botBook)], paper, S)
    # spine fold
    for y in range(spineTop, botBook + 1):
        for x in range(max(0, mid - 1), min(S, mid + 2)):
            px[y][x] = spine

    # rising chart bars on the right page
    ybase = botBook - int(S * 0.06)
    barW = max(2, int(S * 0.055))
    x0 = mid + int(S * 0.05)
    x1 = x0 + barW
    x2 = mid + int(S * 0.16)
    h1 = int(S * 0.10)
    h2 = int(S * 0.17)
    h3 = int(S * 0.25)
    fill_rect(px, x0, ybase - h1, x1, ybase, green, S)
    fill_rect(px, x2, ybase - h2, x2 + barW, ybase, green, S)
    fill_rect(px, x2 + int(S * 0.11), ybase - h3, x2 + int(S * 0.11) + barW, ybase, green_dark, S)
    return px


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "icons")
    os.makedirs(out, exist_ok=True)
    for s in (16, 48, 128):
        write_png(os.path.join(out, f"icon{s}.png"), make_icon(s))
    print("icons written:", sorted(os.listdir(out)))