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
    foreground = Image.open(ROOT / "logo.png").convert("RGBA")
    square = Image.open(BRAND / "icon.png").convert("RGBA")
    rounded = Image.open(BRAND / "icon-rounded.png").convert("RGBA")
    if foreground.size != (2048, 2048) or square.size != foreground.size or rounded.size != foreground.size:
        raise ValueError("Expected the approved native 2048 × 2048 icon masters")
    if foreground.getchannel("A").getextrema() != (0, 255):
        raise ValueError("The foreground must preserve transparent space and opaque artwork")
    PUBLIC.mkdir(parents=True, exist_ok=True)

    for size in [24, 80]:
        resize(foreground, size).save(PUBLIC / f"logo-{size}.png")
    resize(foreground, 32).save(PUBLIC / "favicon.png")
    ico_sizes = [(16, 16), (32, 32)]
    foreground.save(PUBLIC / "favicon.ico", sizes=ico_sizes)
    with Image.open(PUBLIC / "favicon.ico") as icon:
        if icon.ico.sizes() != set(ico_sizes):
            raise ValueError("Favicon is missing an expected resolution")
    resize(square, 180).convert("RGB").save(PUBLIC / "apple-touch-icon.png")

    og = Image.new("RGB", (1200, 630), (15, 15, 15))
    icon = resize(rounded, 252)
    og.paste(icon, ((1200 - 252) // 2, (630 - 252) // 2), icon)
    og.save(PUBLIC / "og-image.png")
    print("Generated sidebar, login, favicon (16 + 32), Apple touch, and OG assets.")


if __name__ == "__main__":
    main()
