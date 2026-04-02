#!/usr/bin/env python3
"""
Logo Resize Script for Frogie

Generates all derived logo assets from the source logo.png (2048x2048 RGBA).
Follows Basalt B-3 specification: single-source pattern.

Usage:
    python scripts/resize-logos.py

Requirements:
    pip install Pillow
"""

from pathlib import Path
from PIL import Image

# Paths (Monorepo structure)
ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
PUBLIC = ROOT / "packages" / "web" / "public"

# Brand background color for OG image (dark theme)
OG_BG = (15, 15, 15)


def resize(img: Image.Image, size: int) -> Image.Image:
    """Resize image to square size using LANCZOS resampling."""
    return img.resize((size, size), Image.LANCZOS)


def generate_public_assets(img: Image.Image) -> None:
    """Generate public/ assets for component <img src> references."""
    PUBLIC.mkdir(parents=True, exist_ok=True)

    # Standard sizes per B-3 spec
    assets = [
        (24, "logo-24.png"),   # Sidebar logo
        (80, "logo-80.png"),   # Login page avatar, loading screen
    ]

    for size, name in assets:
        resized = resize(img, size)
        resized.save(PUBLIC / name, "PNG")
        print(f"  {name} ({size}x{size})")


def generate_favicon_assets(img: Image.Image) -> None:
    """Generate favicon and browser icons for Vite project."""
    # For Vite projects, these go in public/

    # favicon.ico (16 + 32 multi-size)
    ico_16 = resize(img, 16)
    ico_32 = resize(img, 32)
    ico_path = PUBLIC / "favicon.ico"
    ico_16.save(ico_path, format="ICO", append_images=[ico_32], sizes=[(16, 16), (32, 32)])
    print(f"  favicon.ico (16+32)")

    # favicon.png (32x32) for modern browsers
    favicon_png = resize(img, 32)
    favicon_png.save(PUBLIC / "favicon.png", "PNG")
    print(f"  favicon.png (32x32)")

    # Apple touch icon (180x180)
    apple_icon = resize(img, 180)
    apple_icon.save(PUBLIC / "apple-touch-icon.png", "PNG")
    print(f"  apple-touch-icon.png (180x180)")


def generate_og_image(img: Image.Image) -> None:
    """Generate Open Graph image (1200x630) with centered logo."""
    og_width, og_height = 1200, 630

    # Create RGB canvas with brand background
    og = Image.new("RGB", (og_width, og_height), OG_BG)

    # Scale logo to 40% of canvas height
    logo_size = int(og_height * 0.4)  # ~252px
    logo_resized = resize(img, logo_size)

    # Center logo on canvas
    x = (og_width - logo_size) // 2
    y = (og_height - logo_size) // 2

    # Paste with alpha mask (RGBA -> RGB)
    og.paste(logo_resized, (x, y), logo_resized)

    og.save(PUBLIC / "og-image.png", "PNG")
    print(f"  og-image.png (1200x630)")


def main() -> None:
    if not SOURCE.exists():
        print(f"Error: Source logo not found at {SOURCE}")
        return

    print(f"Source: {SOURCE}")
    img = Image.open(SOURCE).convert("RGBA")
    print(f"Size: {img.size[0]}x{img.size[1]}")
    print()

    print("Generating public/ assets...")
    generate_public_assets(img)
    print()

    print("Generating favicon assets...")
    generate_favicon_assets(img)
    print()

    print("Generating OG image...")
    generate_og_image(img)
    print()

    print("Done!")


if __name__ == "__main__":
    main()
