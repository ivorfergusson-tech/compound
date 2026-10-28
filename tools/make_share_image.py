"""Draws img/share.png, the 1200x630 card WhatsApp, LinkedIn and X show when the site is linked.

Run: python tools/make_share_image.py  (needs Pillow; uses Windows fonts)
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "img" / "share.png"
FONTS = Path("C:/Windows/Fonts")

# Dark theme colours from css/app.css
BG, SURFACE, TEXT, TEXT_2, ACCENT, ON_ACCENT = "#0F1418", "#182027", "#E8EDF1", "#C3CDD5", "#3CC4AE", "#0F1418"
STRANDS = [("Money", "#4FC98A"), ("Investing", "#8DB2FF"), ("Trading", "#F5A462"), ("Industry", "#C3A6FF")]


def font(name, size):
    return ImageFont.truetype(str(FONTS / name), size)


def main():
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(im)

    # Logo tile, as in the favicon
    d.rounded_rectangle((80, 80, 200, 200), radius=30, fill=ACCENT)
    d.text((140, 142), "£", font=font("arialbd.ttf", 80), fill=ON_ACCENT, anchor="mm")
    d.text((232, 140), "Compound", font=font("segoeuib.ttf", 76), fill=TEXT, anchor="lm")

    d.text((80, 290), "A free UK finance course", font=font("segoeuib.ttf", 58), fill=TEXT)
    d.text((80, 372), "32 lessons, quizzes, calculators and a leaderboard.", font=font("segoeui.ttf", 34), fill=TEXT_2)

    # Strand pills
    x, f = 80, font("segoeuib.ttf", 30)
    for label, colour in STRANDS:
        w = d.textlength(label, font=f) + 56
        d.rounded_rectangle((x, 480, x + w, 540), radius=30, fill=SURFACE, outline=colour, width=3)
        d.text((x + w / 2, 510), label, font=f, fill=colour, anchor="mm")
        x += w + 20

    OUT.parent.mkdir(exist_ok=True)
    im.save(OUT, optimize=True)
    print(f"Wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
