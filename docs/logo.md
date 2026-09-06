# Frogie identity

The approved September 2026 identity keeps the seated singing frog, green and yellow facets, and rainbow notes. A deeper sage field, quiet curved motifs, and shallow shadows form the presentation icon.

| Asset | Role |
| --- | --- |
| `logo.png` | Native 2048 × 2048 transparent foreground; canonical artwork |
| `assets/brand/icon.png` | Approved square icon, including background and shadows |
| `assets/brand/icon-rounded.png` | Rounded presentation with transparent corners; large README and social images |
| `assets/brand/provenance.json` | Approval, source archive, and master checksums |

The hexly.ai study at `artwork/logo-family/frogie/2026-09-06-01/` preserves the previous logo, prompt, untouched Azure gpt-image-2 generation, masks, layers, and every finishing pass. This local adoption uses finishing `03`, the owner's deeper-background refinement. Its transparent foreground is byte-identical to adopted finishing `02`. The [local logo gallery](https://index.dev.hexly.ai/logos/frogie) presents the selected identity and its history. Publication of this follow-up remains paused.

Regenerate all checked-in application derivatives with Python and Pillow:

```bash
uv run --with pillow --no-project scripts/resize-logos.py
```

Sidebar and login images use the transparent foreground at 24 and 80 px. The PNG favicon and verified 16/32 px ICO entries are also transparent, with no tile, background motif, or extra crop. README uses the rounded presentation at 128 px. Apple touch uses the square master because the operating system applies its own corners. The Open Graph image places the rounded icon on the existing dark field. Preserve the approved framing and never rebuild the sage background from a flat fill.

The icon background is `#BBCB9E`; the artwork's sampled leaf green is `#86C32C`. Existing UI theme tokens, including primary `#21C45D`, remain their own documented palette. Musical notes belong to the mascot; Frogie is an AI agent workspace.

Shared usage and adoption SOP: `hexly.ai/docs/07-logo-usage-sop.md`. Audit both sidebar states, login, README, browser metadata, and the two complete review pages after regeneration.
