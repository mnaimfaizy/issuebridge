"""Build dark/light Issuebridge lockup PNGs from brand/mark.png."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
MARK = ROOT / "mark.png"
OUT_DARK = ROOT / "lockup-dark.png"
OUT_LIGHT = ROOT / "lockup-light.png"
ASSETS = ROOT.parent / "src" / "assets" / "brand"


def load_font(size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf",
        r"C:\Windows\Fonts\seguisb.ttf",
        r"C:\Windows\Fonts\arialbd.ttf",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def build_lockup(word_rgba: tuple[int, int, int, int], out: Path) -> None:
    mark = Image.open(MARK).convert("RGBA")
    # Sidebar-scale friendly horizontal lockup.
    mark_h = 256
    ratio = mark_h / mark.height
    mark_w = int(mark.width * ratio)
    mark = mark.resize((mark_w, mark_h), Image.Resampling.LANCZOS)

    font = load_font(120)
    text = "Issuebridge"
    # Measure text
    probe = Image.new("RGBA", (10, 10), (0, 0, 0, 0))
    draw = ImageDraw.Draw(probe)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]

    gap = 48
    pad_x, pad_y = 32, 40
    width = pad_x + mark_w + gap + tw + pad_x
    height = pad_y + max(mark_h, th) + pad_y
    canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    mark_y = (height - mark_h) // 2
    canvas.paste(mark, (pad_x, mark_y), mark)

    draw = ImageDraw.Draw(canvas)
    text_x = pad_x + mark_w + gap
    text_y = (height - th) // 2 - bbox[1]
    draw.text((text_x, text_y), text, font=font, fill=word_rgba)

    canvas.save(out, "PNG")
    print("wrote", out, canvas.size)


def main() -> None:
    ASSETS.mkdir(parents=True, exist_ok=True)
    # Dark navy wordmark for light UI / README on light bg
    build_lockup((13, 44, 62, 255), OUT_DARK)
    # Light wordmark for dark UI
    build_lockup((245, 248, 250, 255), OUT_LIGHT)

    # Runtime copies
    for name in ("mark.png", "lockup-dark.png", "lockup-light.png"):
        src = ROOT / name
        if src.exists():
            dest = ASSETS / name
            dest.write_bytes(src.read_bytes())
            print("copied", dest)


if __name__ == "__main__":
    main()
