#!/usr/bin/env python3
"""Create texture JPEGs from the credited source maps.

Requires Pillow. Source files are mars.jpg, clouds.jpg, and moon.jpg.
Downloads missing sources only with --download. Refuses existing output folders.
"""

import argparse
from pathlib import Path
import shutil
from urllib.request import urlopen

from PIL import Image, ImageEnhance


def main():
    """Write textures and credits to a new directory."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--download", action="store_true", help="Download missing source maps")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    sources = {
        "arrakis.jpg": ("mars.jpg", "8k_mars.jpg"),
        "caladan-clouds.jpg": ("clouds.jpg", "8k_earth_clouds.jpg"),
        "moon.jpg": ("moon.jpg", "2k_moon.jpg"),
    }
    if args.output_dir.exists():
        parser.error("--output-dir must be a new directory")
    if args.download:
        args.source_dir.mkdir(parents=True, exist_ok=True)
    for source_file, download_file in sources.values():
        source = args.source_dir / source_file
        if not source.exists() and args.download:
            url = f"https://www.solarsystemscope.com/textures/download/{download_file}"
            with urlopen(url, timeout=120) as response:
                source.write_bytes(response.read())
        if not source.is_file():
            parser.error(f"Missing source map: {source}")

    args.output_dir.mkdir(parents=True)
    for name, (source_file, _) in sources.items():
        with Image.open(args.source_dir / source_file) as source:
            if name == "arrakis.jpg":
                resized = source.convert("RGB").resize((4096, 2048), Image.Resampling.LANCZOS)
                muted = ImageEnhance.Color(resized).enhance(0.26)
                # Integer truncation retains the original recoloring.
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
        print(f"Wrote {name}: {destination.stat().st_size} bytes")
    shutil.copyfile(root / "src" / "assets" / "CREDITS.txt", args.output_dir / "CREDITS.txt")


if __name__ == "__main__":
    main()
