#!/usr/bin/env python3
"""Recreate the preserved texture JPEGs from the credited source maps.

Requires Pillow. Source and output hashes must match provenance/texture-manifest.json.
Downloads missing sources only with --download. Refuses existing output folders.
"""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
from urllib.request import urlopen

from PIL import Image, ImageEnhance


def main():
    """Write textures and credits to a new directory, rejecting hash mismatches."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--download", action="store_true", help="Download missing source maps")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    manifest = json.loads((root / "provenance" / "texture-manifest.json").read_text())
    if args.output_dir.exists():
        parser.error("--output-dir must be a new directory")
    if args.download:
        args.source_dir.mkdir(parents=True, exist_ok=True)
    for name, entry in manifest.items():
        source = args.source_dir / entry["source_file"]
        if not source.exists() and args.download:
            with urlopen(entry["source_url"], timeout=120) as response:
                source.write_bytes(response.read())
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        if digest != entry["source_sha256"]:
            raise ValueError(f"Source hash differs for {name}: {digest}")

    args.output_dir.mkdir(parents=True)
    for name, entry in manifest.items():
        with Image.open(args.source_dir / entry["source_file"]) as source:
            if name == "arrakis.jpg":
                resized = source.convert("RGB").resize((4096, 2048), Image.Resampling.LANCZOS)
                muted = ImageEnhance.Color(resized).enhance(0.26)
                # Integer truncation reproduces the preserved recoloring exactly.
                channels = [
                    channel.point([min(255, int(value * factor)) for value in range(256)])
                    for channel, factor in zip(muted.split(), (1.16, 1.03, 0.77))
                ]
                prepared = Image.merge("RGB", channels)
                quality = 91
            else:
                size = (2048, 1024) if name == "caladan-clouds.jpg" else (1024, 512)
                prepared = source.convert("L").resize(size, Image.Resampling.LANCZOS)
                quality = 92
            destination = args.output_dir / name
            prepared.save(destination, quality=quality, optimize=True, progressive=True)
        digest = hashlib.sha256(destination.read_bytes()).hexdigest()
        if digest != entry["output_sha256"]:
            raise ValueError(f"Output hash differs for {name}; check Pillow and JPEG encoder: {digest}")
        print(f"Verified {name}: {destination.stat().st_size} bytes; SHA256 {digest}")
    shutil.copyfile(root / "src" / "assets" / "CREDITS.txt", args.output_dir / "CREDITS.txt")


if __name__ == "__main__":
    main()
