import os
import struct
import zlib


def _chunk(tag: bytes, data: bytes) -> bytes:
    out = struct.pack(">I", len(data)) + tag + data
    out += struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return out


def make_png(path: str, size: int) -> None:
    rows = []
    dark = (17, 24, 39)      # #111827
    amber = (255, 211, 122)  # #ffd37a
    m = size // 4
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            if m <= x < size - m and m <= y < size - m:
                px = amber
            else:
                px = dark
            row.extend(px)
        rows.append(bytes(row))
    raw = b"".join(rows)
    png = b"\x89PNG\r\n\x1a\n"
    png += _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += _chunk(b"IDAT", zlib.compress(raw, 9))
    png += _chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    for s in (16, 48, 128):
        make_png(os.path.join(here, "icons", f"icon{s}.png"), s)
    print("icons written:", os.listdir(os.path.join(here, "icons")))