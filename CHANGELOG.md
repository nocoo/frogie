# Changelog

All notable changes to this project will be documented in this file.

## [0.1.1] - 2026-06-11

### Security

- Upgrade `hono` to 4.12.25 — patches GHSA-2gcr-mfcq-wcc3, GHSA-3hrh-pfw6-9m5x, GHSA-f577-qrjj-4474, GHSA-xrhx-7g5j-rcj5 (#42)
- Upgrade `react-router` to 7.17.0 — patches GHSA-8x6r-g9mw-2r78 (#48)
- Override `qs` to ≥6.15.2 (transitive) — patches GHSA-q8mj-m7cp-5q26 (#45)

### Changed

- Upgrade `lucide-react` to 1.17.0; brand icons removed in v1, re-extract `GithubIcon` via `createLucideIcon` (#44)
- Upgrade `sonner` to 2.0.7 (#49)
- Upgrade `tailwind-merge` to 3.6.0 (#50)
- Upgrade `@anthropic-ai/sdk` to 0.104.1 (#16)
- Bump `@radix-ui/react-*` (avatar, collapsible, dialog, dropdown-menu, label, popover, scroll-area, select, separator, slot, switch, tabs, tooltip) to latest minor/patch (#19–#31)
- Bump `react`, `react-dom` to 19.2.7 and `@types/react` to 19.2.17 (#35, #46, #47)
- Bump `vite` 8.0.16, `tailwindcss` 4.3.0, `@tailwindcss/vite` 4.3.0, `@vitejs/plugin-react` 6.0.2 (#32, #36, #51, #55)
- Bump dev tooling: `vitest` 4.1.8, `@vitest/coverage-v8` 4.1.8, `eslint` 10.4.1, `typescript-eslint` 8.61.0, `bun-types` 1.3.14, `@types/bun` 1.3.14, `@types/node` 25.9.3, `@playwright/test` 1.60.0 (#18, #33, #37, #39, #40, #54, #56, #59)
- Bump runtime deps: `zod` 4.4.3, `zustand` 5.0.14, `@hono/zod-validator` 0.8.0, `better-sqlite3` 12.10.0, `express-rate-limit` 8.5.2 (#17, #38, #41, #57, #58)
