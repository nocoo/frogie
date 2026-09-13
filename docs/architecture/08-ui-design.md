# 08 - UI Design

## Overview

Frogie's web UI uses the published `@nocoo/basalt` package. Basalt owns application chrome,
theme and accent state, common controls, overlays, page headings, and nested surfaces. Frogie
owns routing, authentication, workspace/session behavior, chat presentation, and product data.

The package version declared in `packages/web/package.json` and resolved in `bun.lock` is the
source of truth. The app does not keep local copies of Basalt controls.

## Stack

| Layer | Choice |
| --- | --- |
| Framework | React 19 |
| Build | Vite and Tailwind CSS 4 |
| Components and chrome | `@nocoo/basalt` |
| Icons | Lucide React |
| State | Zustand |
| Routing | React Router |
| Markdown | react-markdown, remark-gfm, rehype-highlight |

## Provider tree

`packages/web/src/App.tsx` mounts one provider tree for login and authenticated routes:

```text
ThemeProvider
└── AccentProvider
    └── BrowserRouter
        └── LinkProvider
            └── TooltipProvider
                └── AuthProvider
                    ├── Routes
                    └── Toaster
```

`LinkProvider` maps Basalt links to React Router while leaving external, mail, and telephone
links as native anchors. `ThemeProvider` owns the light/dark/system setting. A pre-render script
in `main.tsx` applies the stored or system theme before React paints.

Frogie's default accent is green. `AccentProvider` receives the light and dark HSL values as a
`primary` palette override; components consume the resulting `--basalt-*` semantic tokens.

## CSS contract

`packages/web/src/index.css` follows Basalt's Tailwind integration order:

```css
@source "../node_modules/@nocoo/basalt/dist/**/*.{js,jsx,ts,tsx}";
@import "@nocoo/basalt/styles/tailwind";
@import "tailwindcss";
```

Application styles use prefixed utilities such as `bg-basalt-background`,
`bg-basalt-card`, `bg-basalt-secondary`, `text-basalt-foreground`, and
`border-basalt-border`. Frogie does not redeclare Basalt color tokens. Local CSS is limited to
chat entrance/loading animations, typography, and keyboard-key presentation.

Basalt's current chart contract is a fixed five-color cycle. Any future Frogie charts must use
`getChartColor(index)` or modulo indexing and must not assume the former 24-color palette.

## Application chrome

`DashboardLayout` composes the public chrome primitives:

```text
AppShell
├── AppSkipLink
├── AppSidebar (desktop) or Sheet + AppSidebar (mobile)
└── AppMain
    ├── AppHeader
    └── ContentIsland
        └── current route
```

- Desktop sidebar width and collapse motion are owned by `Sidebar`.
- Below 768 CSS pixels the in-flow sidebar is replaced with a named left `Sheet`.
- `AppHeader` contains ancestor breadcrumbs, the current route title, the GitHub link, and the
  theme control.
- `ContentIsland` owns the page surface and scrolling. The chat route removes island padding so
  its message list and composer can reach the surface edges.
- The sidebar header displays the project logo, product name, and `APP_VERSION`; the footer uses
  `SidebarUser` and retains the logout action.

Workspace and session lists are Frogie-specific composites. Their triggers, popovers, dialogs,
inputs, tooltips, and buttons are Basalt controls; their data and navigation remain in Frogie
viewmodels.

## Login

`LoginPage` stays outside `AppShell`. It preserves Frogie's portrait identity badge and Google
OAuth behavior while using Basalt `Button`, `ThemeToggle`, surfaces, and semantic tokens. The
page has three visual bands: green identity header, credential body, and secure-auth footer.
Authentication URLs and error handling remain application-owned.

## Pages and surfaces

Authenticated settings pages follow one hierarchy:

1. `AppHeader` supplies route context.
2. `PageHeader` supplies the page title, description, and page actions.
3. `LayerCard` supplies top-level content surfaces.
4. Basalt inputs, selects, switches, tabs, dialogs, badges, and scroll areas supply controls.

`WorkspacesPage`, `PromptsPage`, and `SettingsPage` use this hierarchy directly. Product-specific
pieces such as workspace color swatches, prompt content previews, thinking blocks, tool-call
status, and chat bubbles remain local compositions built from Basalt controls and tokens.

## MVVM boundary

The UI retains Frogie's MVVM split:

```text
pages and components
        │ bind to
        ▼
Zustand viewmodels and hooks
        │ call
        ▼
HTTP/WebSocket APIs and typed models
```

Views may own focus, native form events, and responsive state. Fetching, mutations, session
selection, prompt assembly, model selection, and chat streaming stay in viewmodels.

## Accessibility and responsive behavior

- The shell begins with an `AppSkipLink` targeting `AppMain`.
- Icon-only controls have accessible names and decorative icons are hidden where appropriate.
- Dialog, sheet, popover, select, dropdown, tooltip, and switch semantics come from Basalt.
- The mobile sheet closes on route changes and restores document scrolling when dismissed.
- Light, dark, and system theme modes are supported; the green accent is contrast-adjusted by
  Basalt's semantic accent implementation.

## Verification

UI changes must pass root typecheck, lint, build, and Vitest commands. Browser verification must
cover the login badge in light and dark mode, authenticated desktop chrome, the three settings
routes, and the 390px mobile header/sidebar flow. The repository's Playwright suite still needs
an isolated authenticated fixture before it can run safely against arbitrary local data.
