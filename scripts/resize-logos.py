#!/usr/bin/env python3
"""Generate application assets from the approved icon masters (Pillow 11+)."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BRAND = ROOT / "assets" / "brand"
PUBLIC = ROOT / "packages" / "web" / "public"


def resize(image: Image.Image, size: int) -> Image.Image:
    return image.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    square = Image.open(BRAND / "icon.png").convert("RGBA")
    rounded = Image.open(BRAND / "icon-rounded.png").convert("RGBA")
    if square.size != (2048, 2048) or rounded.size != (2048, 2048):
        raise ValueError("Expected the approved native 2048 × 2048 icon masters")
    PUBLIC.mkdir(parents=True, exist_ok=True)

    for size in [24, 80]:
        resize(rounded, size).save(PUBLIC / f"logo-{size}.png")
    resize(rounded, 32).save(PUBLIC / "favicon.png")
    rounded.save(PUBLIC / "favicon.ico", sizes=[(16, 16), (32, 32)])
    resize(square, 180).convert("RGB").save(PUBLIC / "apple-touch-icon.png")

    og = Image.new("RGB", (1200, 630), (15, 15, 15))
    icon = resize(rounded, 252)
    og.paste(icon, ((1200 - 252) // 2, (630 - 252) // 2), icon)
    og.save(PUBLIC / "og-image.png")
    print("Generated sidebar, login, favicon (16 + 32), Apple touch, and OG assets.")


if __name__ == "__main__":
    main()
