"""Assemble a clean Chrome Web Store package for Bookmata.

Copies only the runtime files into dist/bookmata/ (manifest at the root) and
writes dist/bookmata-<version>.zip. Development files (tests, fixtures,
make_*.py, etc.) are excluded.
"""
import json
import os
import shutil
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = HERE
OUT = os.path.join(os.path.dirname(HERE), "dist")

TOP_LEVEL = [
    "manifest.json",
    "background.js",
    "content.js",
    "sidepanel.html",
    "sidepanel.js",
    "sidepanel.css",
    "formatter.js",
    "formatter.css",
    "engine.js",
]
DIRS = ["lib", "fonts", "icons"]


def main() -> None:
    version = json.load(open(os.path.join(SRC, "manifest.json"), encoding="utf-8"))["version"]
    app = os.path.join(OUT, "bookmata")
    if os.path.exists(app):
        shutil.rmtree(app)
    os.makedirs(app, exist_ok=True)

    missing = [f for f in TOP_LEVEL if not os.path.isfile(os.path.join(SRC, f))]
    if missing:
        raise SystemExit("missing top-level files: " + ", ".join(missing))

    for f in TOP_LEVEL:
        shutil.copy2(os.path.join(SRC, f), os.path.join(app, f))

    for d in DIRS:
        src_dir = os.path.join(SRC, d)
        if not os.path.isdir(src_dir):
            continue
        for root, _dirs, files in os.walk(src_dir):
            rel = os.path.relpath(root, src_dir)
            dst_dir = os.path.join(app, d, rel) if rel != "." else os.path.join(app, d)
            os.makedirs(dst_dir, exist_ok=True)
            for name in files:
                shutil.copy2(os.path.join(root, name), os.path.join(dst_dir, name))

    zip_path = os.path.join(OUT, f"bookmata-{version}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, _dirs, files in os.walk(app):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, app))

    print("dist built ->", os.path.relpath(app, os.path.dirname(HERE)))
    print("zip        ->", os.path.relpath(zip_path, os.path.dirname(HERE)))


if __name__ == "__main__":
    main()