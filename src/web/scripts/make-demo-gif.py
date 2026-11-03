"""Assemble docs/media/frames/*.png (from e2e/media.spec.ts) into docs/media/demo.gif.

Needs Pillow; the miner's environment has it:
    src/miner/.venv/bin/python -I src/web/scripts/make-demo-gif.py
"""

import sys
from pathlib import Path

from PIL import Image

media = Path(__file__).resolve().parents[3] / "docs" / "media"
frames = sorted((media / "frames").glob("*.png"))
if not frames:
    sys.exit("no frames: run MEDIA=1 npx playwright test e2e/media.spec.ts first")
width = 960
images = []
for f in frames:
    im = Image.open(f).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    images.append(im.convert("P", palette=Image.ADAPTIVE, colors=128))
images[0].save(media / "demo.gif", save_all=True, append_images=images[1:], duration=2200, loop=0, optimize=True)
print(f"{len(images)} frames -> {media / 'demo.gif'}")
