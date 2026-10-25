# /// script
# requires-python = ">=3.11"
# dependencies = ["Pillow==12.0.0"]
# ///
"""Create the desert study's lunar map from Solar System Scope's 8K source."""

import argparse
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("source", type=Path, help="Downloaded 8k_moon.jpg")
arguments = parser.parse_args()
output = Path(__file__).parent.parent / "src" / "assets" / "moon.jpg"
with Image.open(arguments.source) as source:
    source.convert("L").resize((4096, 2048), Image.Resampling.LANCZOS).save(
        output, quality=93, optimize=True, progressive=True
    )
print(output)
