#!/usr/bin/env python3
"""Make the pixel-art rotated "watchbro" logo for the onboard (320x240) sidebar.

Rotated like the TV layout (-60deg), but sized so the whole word fits in the
box, drawn straight onto the onboard logo box's pixel grid (1 bit, no
smoothing) so it stays sharp.

    pip install pillow
    python3 scripts/build_onboard_logo.py
"""

import math
import os
import sys

from PIL import Image

BOX_W, BOX_H = 66, 52     # inside of the 70x54 onboard logo box (2px border, no top border)
ANGLE = int(os.environ.get("LOGO_ANGLE", 60))  # CSS rotate(-60deg) = 60deg anticlockwise
MARGIN = 1                # empty pixels kept round the word
SUPER = 16                # draw big, then reduce to the pixel grid
THRESHOLD = 0.40          # how much of a pixel must be covered to be drawn


def build(src_path, out_path, preview_path=None):
    src = Image.open(src_path).convert("RGBA")
    alpha = src.getchannel("A")
    if alpha.getextrema() == (255, 255):
        alpha = src.convert("L").point(lambda v: 255 - v)
    alpha = alpha.crop(alpha.getbbox())

    a = math.radians(ANGLE)
    rot_w = alpha.width * math.cos(a) + alpha.height * math.sin(a)
    rot_h = alpha.width * math.sin(a) + alpha.height * math.cos(a)
    scale = min((BOX_W - 2 * MARGIN) / rot_w, (BOX_H - 2 * MARGIN) / rot_h) * SUPER
    big = alpha.resize((round(alpha.width * scale), round(alpha.height * scale)), Image.LANCZOS)
    big = big.rotate(ANGLE, resample=Image.BICUBIC, expand=True)

    canvas = Image.new("L", (BOX_W * SUPER, BOX_H * SUPER), 0)
    canvas.paste(big, ((canvas.width - big.width) // 2, (canvas.height - big.height) // 2))
    small = canvas.resize((BOX_W, BOX_H), Image.BOX)

    cut = round(255 * THRESHOLD)
    out = Image.new("RGBA", (BOX_W, BOX_H), (0, 0, 0, 0))
    px = out.load()
    for y in range(BOX_H):
        for x in range(BOX_W):
            if small.getpixel((x, y)) >= cut:
                px[x, y] = (0, 0, 0, 255)
    out.save(out_path, optimize=True)

    if preview_path:
        bg = Image.new("RGBA", out.size, (181, 181, 181, 255))
        bg.alpha_composite(out)
        bg.resize((BOX_W * 6, BOX_H * 6), Image.NEAREST).save(preview_path)
    print("Wrote %s (%dx%d)" % (out_path, BOX_W, BOX_H))


if __name__ == "__main__":
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    build(os.path.join(root, "images", "watchbro.png"),
          os.path.join(root, "images", "watchbro-onboard.png"),
          sys.argv[1] if len(sys.argv) > 1 else None)
