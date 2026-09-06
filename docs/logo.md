# Frogie identity

The approved September 2026 identity keeps the seated singing frog, green and yellow facets, and rainbow notes. A pale sage field, quiet curved motifs, and shallow shadows form the application icon.

| Asset | Role |
| --- | --- |
| `logo.png` | Native 2048 × 2048 transparent foreground; canonical artwork |
| `assets/brand/icon.png` | Approved square icon, including background and shadows |
| `assets/brand/icon-rounded.png` | Approved rounded icon with transparent corners; README and in-app presentation |
| `assets/brand/provenance.json` | Approval, source archive, and master checksums |

The [hexly.ai study](https://github.com/nocoo/hexly.ai/tree/aeeac5d/artwork/logo-family/frogie/2026-09-06-01) preserves the previous logo, prompt, untouched Azure gpt-image-2 generation, masks, layers, and both finishing passes. This promotion uses finishing `02` without regeneration or recoloring. The [public logo gallery](https://hexly.ai/?view=logos&project=frogie) presents the current identity and its history.

Regenerate all checked-in application derivatives with Python and Pillow:

```bash
uv run --with pillow --no-project scripts/resize-logos.py
```

Sidebar and login images use the rounded master at 24 and 80 px. The favicon contains both 16 and 32 px entries. Apple touch uses the square master because the operating system applies its own corners. The Open Graph image places the rounded icon on the existing dark field. Never wrap the artwork in a circular crop or rebuild the approved sage background from a flat fill.

The icon background is `#DCE6CA`; the artwork's sampled leaf green is `#86C32C`. Existing UI theme tokens, including primary `#21C45D`, remain their own documented palette. Musical notes belong to the mascot; Frogie is an AI agent workspace.
