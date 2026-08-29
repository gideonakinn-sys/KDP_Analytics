"""Generate extension/lib/vfs_serif.js — base64-embedded PT Serif fonts for
pdfmake (registered as the 'Serif' font family)."""
import base64
import os

HERE = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(HERE, "fonts")
OUT = os.path.join(HERE, "lib", "vfs_serif.js")

SRC = {
    "ptserif-regular.ttf": "pt-serif-v19-latin-regular.ttf",
    "ptserif-bold.ttf": "pt-serif-v19-latin-700.ttf",
    "ptserif-italic.ttf": "pt-serif-v19-latin-italic.ttf",
    "ptserif-bolditalic.ttf": "pt-serif-v19-latin-700italic.ttf",
}


def b64(path):
    with open(path, "rb") as fh:
        return base64.b64encode(fh.read()).decode("ascii")


vfs = {}
for alias, filename in SRC.items():
    vfs[alias] = b64(os.path.join(FONTS, filename))

lines = [
    "(function(){",
    "  try {",
    "    if (!window.pdfMake) return;",
    "    window.pdfMake.vfs = Object.assign({}, window.pdfMake.vfs || {}, {",
]
for alias, data in vfs.items():
    lines.append(f'      "{alias}": "{data}",')
lines += [
    "    });",
    "    window.pdfMake.fonts = Object.assign({}, window.pdfMake.fonts || {}, {",
    "      Serif: { normal: \"ptserif-regular.ttf\", bold: \"ptserif-bold.ttf\", italics: \"ptserif-italic.ttf\", bolditalics: \"ptserif-bolditalic.ttf\" }",
    "    });",
    "  } catch(e){}",
    "})();",
]

with open(OUT, "w", encoding="utf-8") as fh:
    fh.write("\n".join(lines))
print("wrote", os.path.relpath(OUT), os.path.getsize(OUT), "bytes")