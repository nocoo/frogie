# Frogie

Local web coding assistant: chat, tools, MCP, and session history on the developer machine.
Profile: ts-worker-web
Direction: [docs/architecture/01-overview.md](docs/architecture/01-overview.md). Frameworks must not rewrite this file.

## Sources of Truth

This file is the **contract**. Hooks, CI, and config are **enforcement**. If they disagree, that is a failure — raise enforcement to match this file; never lower the contract to a weaker hook.

| Fact | Where |
|---|---|
| Agent handbook | this file |
| Human docs | README.md, `docs/**` |
| Version | root `package.json` `"version"` as `1.2.3`, display `v1.2.3` |
| Enforcement | `.husky/*`, `.github/workflows/ci.yml`, `vitest.config.ts` |
| Machine rules | global `AGENTS.md`, `rules/git-commit.md` |
| Accidents | [Retrospective.md](Retrospective.md) |
| Env files | `.env.example` tracked. Runtime: `FROGIE_PORT`, `FROGIE_HOST`, `FROGIE_DB_PATH` |

## Project Invariants

- Business HTTP/WebSocket require a Google login session; unconfigured auth must reject. WebSocket also checks Origin.
- Tools run with the server process UID. There is no reliable workspace sandbox — restrict network and use only owned machines/repos.
- Engine is Anthropic SDK / Anthropic-compatible APIs only, even when the UI lists other model names.
- Default DB is `~/.frogie/frogie.db`. Tests must not use that path.
- SSE/HTTP MCP transports are not implemented; stdio MCP is.
- Do not invent Cloudflare Worker/D1 infrastructure.

## Stack / Layout

| Component | Choice |
|---|---|
| Language | TypeScript 7 (`@typescript/native`) |
| Package manager | Bun (workspace `packages/*`) |
| Runtime | Vite web :7033 + Hono/Bun server default :7034 (`FROGIE_PORT`) |
| Lint | ESLint `--max-warnings 0` |
| Tests | Vitest projects server+web; Playwright `test:l3` |
| Data | SQLite `FROGIE_DB_PATH` (default `~/.frogie/frogie.db`) |

```
packages/server/src  packages/web/src
tests/e2e  docs/{architecture,features,implementation}
```

MVVM: viewmodels have no View/DOM imports; routes stay thin.

## Commands

```bash
bun install
bun run dev                 # parallel web :7033 + server (default :7034)
bun run typecheck           # server then web tsc --noEmit
bun run lint                # eslint . --max-warnings 0
bun run build
bun run test:coverage       # vitest --coverage (current thresholds ≪ 95%)
bun run test:l2             # vitest run packages/server/src/routes/
bun run test:l3             # playwright (baseURL http://localhost:7033)
```

## Verification

Status: `enforced` | `planned` | `manual` | `N/A`.
6DQ = L1/L2/L3 + G1/G2 + D1. Required L1 bar is four metrics each ≥ 95%. Do not treat the current 50/44/37/50 thresholds as that bar.

| Change | Proof | Status | Evidence |
|---|---|---|---|
| Logic | L1 Vitest ≥ 95% four metrics | planned | `vitest.config.ts` thresholds lines 50 / functions 44 / branches 37 / statements 50; pre-commit and CI run `test:coverage` at that weaker gate |
| API / schema | L2 real HTTP 100% routes | planned | `test:l2` exists; CI `l2-command`; **commented out** in pre-push. Route tests are in-process, not a local listen harness |
| UI path | L3 Playwright | planned | `playwright.config.ts` + `test:l3`; not in CI quality.yml |
| Types / lint | G1 0 error, 0 warning | enforced | pre-commit typecheck+lint; CI same |
| Deps / secrets | G2 osv-scanner + gitleaks fail on miss | planned | pre-push runs both with `\|\| echo` non-blocking; CI quality.yml default security + `osv-scanner.toml` |
| Test isolation | D1 per-run SQLite ≠ `~/.frogie/frogie.db` | planned | no persist-to/`_test_marker`; do not point tests at the default home DB |
| Bundler output | `bun run build` | planned | not in hooks |
| Docs | architecture/features if behavior changed | manual | human review |
| Release | version + changelog | planned | CHANGELOG.md exists; no release workflow |

| Hook | Verifies | Budget | Runs |
|---|---|---|---|
| pre-commit | typecheck, lint, `test:coverage` | <30s target | G1 + L1 at **current** thresholds |
| pre-push | osv/gitleaks **warnings only**; L2 commented | <3min | not a failing G2/L2 gate |

Hooks check-only. `--no-verify` forbidden.

## Resources / Isolation

| Purpose | Port / resource | Isolation |
|---|---|---|
| Dev web | 7033 | Vite |
| Dev API | 7034 (`FROGIE_PORT`) host `0.0.0.0` | SQLite `FROGIE_DB_PATH` |
| L3 | 7033 Playwright | local UI; must not use prod credentials |

E2E never touches prod data stores.

## Operations / Release

No production deploy. Local personal assistant only.

## Retrospective

| Kind | Where |
|---|---|
| Accident narrative | [Retrospective.md](Retrospective.md) |
| Project-specific rule that will recur | one line here (cap ~10) |
| Cross-project lesson | nmem / global `AGENTS.md` / `rules/` |
| Deterministically checkable rule | hook or test, not prose |

- Unset `GIT_DIR` / `GIT_INDEX_FILE` / related vars before tests inside commit hooks.
- Do not treat non-blocking osv/gitleaks warnings as a passing G2 gate.
