#!/usr/bin/env python3
"""Generate the 1200x630 Open Graph cover for the landing page.

Run from vite-app/:  python3 scripts/make-og-cover.py
Requires Pillow:     python3 -m pip install --user Pillow
"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
BG = (3, 7, 18)
INDIGO = (129, 140, 248)
VIOLET = (167, 139, 250)
SLATE = (148, 163, 184)
WHITE = (255, 255, 255)

FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
]


def load_font(size, index=0):
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size, index=index)
            except (OSError, ValueError):
                continue
    return ImageFont.load_default()


img = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Subtle grid, matching the .grid-bg utility in src/index.css.
for x in range(0, W, 48):
    draw.line([(x, 0), (x, H)], fill=(10, 16, 34), width=1)
for y in range(0, H, 48):
    draw.line([(0, y), (W, y)], fill=(10, 16, 34), width=1)

# Accent glow, top-left.
glow = Image.new("RGB", (W, H), BG)
gdraw = ImageDraw.Draw(glow)
gdraw.ellipse([-260, -320, 640, 420], fill=(28, 28, 82))
img = Image.blend(img, glow, 0.55)
draw = ImageDraw.Draw(img)

# Logo mark.
draw.rounded_rectangle([80, 74, 140, 134], radius=18, fill=(99, 102, 241))
mark_font = load_font(34, index=1)
draw.text((110, 104), "A", font=mark_font, fill=WHITE, anchor="mm")

brand_font = load_font(30, index=1)
draw.text((158, 104), "ASOS", font=brand_font, fill=WHITE, anchor="lm")

# Eyebrow.
eyebrow_font = load_font(20)
draw.text((80, 240), "THE FUTURE OF SALES", font=eyebrow_font, fill=INDIGO)

# Headline.
head_font = load_font(78, index=1)
draw.text((80, 286), "Close deals while", font=head_font, fill=WHITE)
draw.text((80, 378), "you sleep.", font=head_font, fill=VIOLET)

# Subheadline.
sub_font = load_font(27)
draw.text(
    (80, 492),
    "AI agents qualify every lead, diagnose their problem,",
    font=sub_font,
    fill=SLATE,
)
draw.text((80, 528), "and send the perfect WhatsApp message.", font=sub_font, fill=SLATE)

out = os.path.join(os.path.dirname(__file__), "..", "public", "og-cover.png")
img.save(os.path.normpath(out), "PNG", optimize=True)
print("wrote", os.path.normpath(out), img.size)
