#!/usr/bin/env python3
"""Build the 3x5 pixel font used by the onboard (320x240) screen mode.

Every glyph is drawn on a grid where one font pixel = 1/6 em, so at
font-size 12px each font pixel is exactly 2x2 screen pixels (18px = 3x3).
The font is embedded into onboard.css between the PIXEL-FONT markers.

    pip install fonttools
    python3 scripts/build_pixel_font.py
"""

import base64
import io
import os
import re
import unicodedata

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

PX = 100          # font units per font pixel
UPM = 6 * PX      # 12px font-size -> 2 screen px per font pixel
ASCENT = 6 * PX   # 5 rows of caps + 1 row of space above
DESCENT = 2 * PX  # 1 row for , ; descenders + 1 row of space

# Rows top to bottom. Row 6 (optional) sits below the baseline.
GLYPHS = {
    "5": ["###", "#..", "###", "..#", "###"],
    "0": ["###", "#.#", "#.#", "#.#", "###"],
    "1": [".#.", "##.", ".#.", ".#.", "###"],
    "2": ["###", "..#", "###", "#..", "###"],
    "3": ["###", "..#", "###", "..#", "###"],
    "4": ["#.#", "#.#", "###", "..#", "..#"],
    "6": ["###", "#..", "###", "#.#", "###"],
    "7": ["###", "..#", "..#", ".#.", ".#."],
    "8": ["###", "#.#", "###", "#.#", "###"],
    "9": ["###", "#.#", "###", "..#", "###"],
    "A": [".#.", "#.#", "###", "#.#", "#.#"],
    "B": ["##.", "#.#", "##.", "#.#", "##."],
    "C": [".##", "#..", "#..", "#..", ".##"],
    "D": ["##.", "#.#", "#.#", "#.#", "##."],
    "E": ["###", "#..", "##.", "#..", "###"],
    "F": ["###", "#..", "##.", "#..", "#.."],
    "G": [".##", "#..", "#.#", "#.#", ".##"],
    "H": ["#.#", "#.#", "###", "#.#", "#.#"],
    "I": ["###", ".#.", ".#.", ".#.", "###"],
    "J": ["..#", "..#", "..#", "#.#", ".#."],
    "K": ["#.#", "#.#", "##.", "#.#", "#.#"],
    "L": ["#..", "#..", "#..", "#..", "###"],
    "M": ["#.#", "###", "###", "#.#", "#.#"],
    "N": ["##.", "#.#", "#.#", "#.#", "#.#"],
    "O": [".#.", "#.#", "#.#", "#.#", ".#."],
    "P": ["##.", "#.#", "##.", "#..", "#.."],
    "Q": [".#.", "#.#", "#.#", "###", ".##"],
    "R": ["##.", "#.#", "##.", "#.#", "#.#"],
    "S": [".##", "#..", ".#.", "..#", "##."],
    "T": ["###", ".#.", ".#.", ".#.", ".#."],
    "U": ["#.#", "#.#", "#.#", "#.#", "###"],
    "V": ["#.#", "#.#", "#.#", "#.#", ".#."],
    "W": ["#.#", "#.#", "###", "###", "#.#"],
    "X": ["#.#", "#.#", ".#.", "#.#", "#.#"],
    "Y": ["#.#", "#.#", ".#.", ".#.", ".#."],
    "Z": ["###", "..#", ".#.", "#..", "###"],
    ".": [".", ".", ".", ".", "#"],
    ",": [".", ".", ".", ".", "#", "#"],
    ":": [".", "#", ".", "#", "."],
    ";": [".", "#", ".", "#", "#"],
    "!": ["#", "#", "#", ".", "#"],
    "'": ["#", "#", ".", ".", "."],
    "|": ["#", "#", "#", "#", "#"],
    '"': ["#.#", "#.#", "...", "...", "..."],
    "-": ["...", "...", "###", "...", "..."],
    "+": ["...", ".#.", "###", ".#.", "..."],
    "=": ["...", "###", "...", "###", "..."],
    "*": ["...", "#.#", ".#.", "#.#", "..."],
    "/": ["..#", "..#", ".#.", "#..", "#.."],
    "\\": ["#..", "#..", ".#.", "..#", "..#"],
    "?": ["##.", "..#", ".#.", "...", ".#."],
    "(": [".#", "#.", "#.", "#.", ".#"],
    ")": ["#.", ".#", ".#", ".#", "#."],
    "[": ["##", "#.", "#.", "#.", "##"],
    "]": ["##", ".#", ".#", ".#", "##"],
    "<": ["..#", ".#.", "#..", ".#.", "..#"],
    ">": ["#..", ".#.", "..#", ".#.", "#.."],
    "_": ["...", "...", "...", "...", "###"],
    "&": [".#.", "#.#", ".#.", "#.#", ".##"],
    "%": ["#.#", "..#", ".#.", "#..", "#.#"],
    "#": ["#.#", "###", "#.#", "###", "#.#"],
    "@": ["###", "#.#", "###", "#..", ".##"],
    "~": ["...", "##.", ".##", "...", "..."],
    "^": [".#.", "#.#", "...", "...", "..."],
    "$": [".##", "##.", ".#.", ".##", "##."],
    "\u00a3": [".##", "#..", "###", "#..", "###"],   # pound
    "\u20ac": [".##", "###", "#..", "###", ".##"],   # euro
    "\u00b0": ["##", "##", "..", "..", ".."],        # degree
    "\u00d7": ["...", "#.#", ".#.", "#.#", "..."],   # multiply
    "\u2022": ["..", "##", "##", "..", ".."],        # bullet
    "\u00b7": [".", ".", "#", ".", "."],             # middle dot
    "\u2026": [".....", ".....", ".....", ".....", "#.#.#"],  # ellipsis
    "\u2013": ["...", "...", "###", "...", "..."],   # en dash
    "\u2014": ["....", "....", "####", "....", "...."],  # em dash
    "\u2191": [".#.", "###", ".#.", ".#.", ".#."],   # up arrow
    "\u2193": [".#.", ".#.", ".#.", "###", ".#."],   # down arrow
    "\u2190": ["....", ".#..", "####", ".#..", "...."],  # left arrow
    "\u2192": ["....", "..#.", "####", "..#.", "...."],  # right arrow
    "\u2630": ["###", "...", "###", "...", "###"],   # menu (trigram)
    "\u25b6": ["#..", "##.", "###", "##.", "#.."],   # play
    "\u25b8": ["#..", "##.", "###", "##.", "#.."],
    "\u23fa": [".#.", "###", "###", "###", ".#."],   # record
    "\u25cf": [".#.", "###", "###", "###", ".#."],
}

ALIASES = {
    "\u2018": "'", "\u2019": "'", "\u201a": ",", "\u2032": "'",
    "\u201c": '"', "\u201d": '"', "\u201e": '"',
    "\u2010": "-", "\u2011": "-", "\u2212": "-", "\u2015": "\u2014",
    "\u00a0": " ", "\u2009": " ", "\u202f": " ",
    "\u00df": "S", "\u00e6": "E", "\u00c6": "E", "\u0153": "E", "\u0152": "E",
    "\u00f8": "O", "\u00d8": "O", "\u0131": "I", "\u0142": "L", "\u0141": "L",
    "\u0111": "D", "\u0110": "D", "\u00f0": "D", "\u00d0": "D",
}

SPACE_WIDTH = 2   # font pixels (plus 1 gap = 3)


def glyph_name(ch):
    return "space" if ch == " " else "uni%04X" % ord(ch)


def draw(rows):
    pen = TTGlyphPen(None)
    for r, row in enumerate(rows):
        top = (5 - r) * PX
        bottom = top - PX
        c = 0
        while c < len(row):
            if row[c] != "#":
                c += 1
                continue
            start = c
            while c < len(row) and row[c] == "#":
                c += 1
            x0, x1 = start * PX, c * PX
            pen.moveTo((x0, bottom))
            pen.lineTo((x0, top))
            pen.lineTo((x1, top))
            pen.lineTo((x1, bottom))
            pen.closePath()
    return pen.glyph()


def build():
    shapes = GLYPHS

    order = [".notdef", "space"]
    glyphs = {".notdef": draw(["###", "#.#", "#.#", "#.#", "###"]), "space": draw([])}
    metrics = {".notdef": (4 * PX, 0), "space": ((SPACE_WIDTH + 1) * PX, 0)}
    cmap = {0x20: "space"}

    for ch, rows in shapes.items():
        name = glyph_name(ch)
        order.append(name)
        glyphs[name] = draw(rows)
        width = max(len(r) for r in rows)
        metrics[name] = ((width + 1) * PX, 0)
        cmap[ord(ch)] = name

    def target(ch):
        if ch in ALIASES:
            ch = ALIASES[ch]
        if ch == " ":
            return "space"
        if ch.upper() in shapes and len(ch.upper()) == 1:
            return glyph_name(ch.upper())
        base = unicodedata.normalize("NFD", ch)[:1].upper()
        if base in shapes:
            return glyph_name(base)
        return None

    for cp in list(range(0x61, 0x7B)) + list(range(0xA0, 0x180)) + [ord(k) for k in ALIASES]:
        ch = chr(cp)
        if cp in cmap:
            continue
        name = target(ch)
        if name:
            cmap[cp] = name

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=-DESCENT, lineGap=0)
    fb.setupNameTable({"familyName": "TVH Pixel", "styleName": "Regular"})
    fb.setupOS2(
        sTypoAscender=ASCENT, sTypoDescender=-DESCENT, sTypoLineGap=0,
        usWinAscent=ASCENT, usWinDescent=DESCENT, sxHeight=5 * PX, sCapHeight=5 * PX,
        fsSelection=0x40,
    )
    fb.setupPost(isFixedPitch=0)
    buf = io.BytesIO()
    fb.save(buf)
    return buf.getvalue()


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    data = build()
    css_path = os.path.join(root, "onboard.css")
    face = (
        "/* PIXEL-FONT-START (generated by scripts/build_pixel_font.py) */\n"
        "@font-face {\n"
        "\tfont-family: \"TVH Pixel\";\n"
        "\tsrc: url(data:font/ttf;base64,%s) format(\"truetype\");\n"
        "\tfont-weight: normal;\n"
        "\tfont-style: normal;\n"
        "}\n"
        "/* PIXEL-FONT-END */" % base64.b64encode(data).decode("ascii")
    )
    with open(css_path, encoding="utf-8") as f:
        css = f.read()
    pattern = re.compile(r"/\* PIXEL-FONT-START.*?PIXEL-FONT-END \*/", re.S)
    if pattern.search(css):
        css = pattern.sub(lambda m: face, css)
    else:
        css = face + "\n\n" + css
    with open(css_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(css)
    print("Embedded %d byte font into %s" % (len(data), css_path))


if __name__ == "__main__":
    main()
