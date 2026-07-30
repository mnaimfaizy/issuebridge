"""Extract the exact mark from the second AI logo export."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "source" / "issuebridge-logo-ai-v2.png"
MARK_OUT = ROOT / "mark.png"


def remove_black_background(image: Image.Image) -> Image.Image:
    """Convert the export's baked black background to transparency.

    The supplied PNG is RGB rather than RGBA. Its mark is isolated from the
    wordmark and AI badge before this conversion.
    """
    image = image.convert("RGBA")
    pixels = image.load()
    assert pixels is not None

    for y in range(image.height):
        for x in range(image.width):
            r, g, b, _ = pixels[x, y]
            intensity = max(r, g, b)
            if intensity <= 4:
                pixels[x, y] = (0, 0, 0, 0)
            elif intensity < 28:
                # Preserve antialiasing without retaining a black fringe.
                alpha = round((intensity - 4) / 24 * 255)
                scale = 255 / max(alpha, 1)
                pixels[x, y] = (
                    min(255, round(r * scale)),
                    min(255, round(g * scale)),
                    min(255, round(b * scale)),
                    alpha,
                )
            else:
                pixels[x, y] = (r, g, b, 255)
    return image


def main() -> None:
    source = Image.open(SRC).convert("RGB")

    # The exact mark occupies this upper-center region. This deliberately
    # excludes both the lower "ISSUE BRIDGE" text and top-right AI badge.
    region = source.crop((250, 125, 750, 410))
    mark = remove_black_background(region)
    alpha = mark.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        raise RuntimeError("No mark pixels found in source crop")
    mark = mark.crop(bbox)

    pad = 28
    mw, mh = mark.size
    side = max(mw, mh) + (pad * 2)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.paste(mark, ((side - mw) // 2, (side - mh) // 2), mark)

    out = square.resize((1024, 1024), Image.Resampling.LANCZOS)
    out.save(MARK_OUT, "PNG")
    print("wrote", MARK_OUT, out.size, "from exact crop", bbox)


if __name__ == "__main__":
    main()
