<p align="center">
  <img src="../assets/brand/icon-rounded.png" width="128" height="128" alt="Frogie Logo" />
</p>

<h1 align="center">Frogie</h1>

<p align="center">Manage AI conversations, tool execution and session history for local projects in your browser.</p>

<p align="center">
  <a href="../README.md">简体中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-f9f1e1?logo=bun&logoColor=000" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb" alt="React" />
  <img src="https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=fff" alt="Hono" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

## What it does

Frogie is a local web coding assistant for individual developers. The browser shows conversations and tool activity; a Bun service connects to your configured model API, reads and writes project files, runs commands and saves sessions. Multiple workspaces share the interface while keeping their own sessions and MCP configuration.

The current engine uses the Anthropic SDK directly. Conversations, tool calls and model listing require an Anthropic-compatible API. GPT, Gemini or other names in the model list still require an upstream service that translates the protocol.

The project is at an early stage. Business APIs and WebSocket connections enforce the Google sign-in session and fail closed when authentication is not configured; browser WebSocket upgrades also validate their origin. Tools still execute automatically with the server process's system permissions, and there is no reliable workspace sandbox. Restrict network access and use it only with devices and projects you control.

## Features

- **Streaming chat**: view text, thinking content returned by the model, tool arguments and results; switch models within a session.
- **Local tools**: five built-in tools cover reading files, writing files, listing directories, running shell commands and simple filename searches.
- **Workspaces and sessions**: associate existing directories, create, rename, delete and resume sessions. Fork copies the current conversation history, without copying project files.
- **stdio MCP**: store commands, arguments and environment variables per workspace, then add connected tools to conversations. SSE and HTTP configuration types exist, but those transports are not implemented.
- **System prompts**: edit global prompt layers, override, enable, disable or reset them per workspace, and preview the assembled prompt. Preview includes built-in tools; actual conversations also include connected MCP tools.
- **Usage display**: see turns, tokens and estimated cost; configure per-query turn and estimated-budget limits. Long conversations trigger an attempt to summarize history at an estimated threshold, using the same model service.

## Usage

After completing the source setup and sign-in configuration below, open `http://localhost:7033`:

1. In **Settings**, enter an API Base URL, API Key and default model. Omit the trailing `/v1`, for example `https://api.anthropic.com`; the SDK adds endpoint paths. Initial settings still point to an old local proxy address, so replace it with your actual service.
2. In **Workspaces**, add an existing project directory and create a session. The directory picker and Open in Finder actions depend on macOS; on other systems, enter the path directly.
3. Send a task and inspect tool results in the conversation. Add a runnable stdio MCP server to a workspace for additional tools, or use **System Prompts** to adjust instructions.

Settings, workspaces, session indexes and MCP configuration live in `~/.frogie/frogie.db`. Conversation content is stored in `~/.frogie/sessions/<id>/transcript.json`. API keys are stored as plaintext in the local database and masked only in API responses. Messages are written after the current query finishes; an unexpected exit can leave the current turn unsaved. Conversations and relevant tool output are sent to the configured model service.

Cost comes from a local fixed-price table and supports estimated checks between model requests. It does not reconcile provider bills or impose a hard spending cap.

## Development

You need Bun, Node.js 22.13+ (or 24+) and Git. Built-in command tools use `sh`, `find` and `head`; the macOS directory actions also use `osascript` and `open`.

```bash
git clone https://github.com/nocoo/frogie.git
cd frogie
bun install --frozen-lockfile
cp .env.example .env
```

Edit the root `.env` and replace the placeholders. The current frontend has no local mode that skips sign-in, so all three authentication variables need valid configuration.

```dotenv
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
JWT_SECRET=replace-with-a-random-secret
PORT=7034
BASE_URL=http://localhost:7033
ALLOWED_EMAILS=you@example.com
```

Register `http://localhost:7033/api/auth/callback` in your Google OAuth client. `BASE_URL` points to the frontend: Vite proxies `/api` and `/ws` to port 7034 so the callback returns to the same interface. Sign-in cookies use `Secure`; Chromium supports this on localhost for development, while custom domains need HTTPS. An empty `ALLOWED_EMAILS` allows any verified Google account that signs in successfully; the resulting session is still required for business APIs and WebSocket connections.

```bash
bun run dev
```

| Command | Purpose |
| --- | --- |
| `bun run dev:server` | Start the Bun / Hono service on port 7034 by default |
| `bun run dev:web` | Start the Vite interface on port 7033 by default |
| `bun run build` | Build the server and frontend |
| `bun run typecheck` | Check TypeScript in both packages |
| `bun run lint` | Run ESLint |

The startup entry reads `PORT` and defaults to `~/.frogie` for data. `FROGIE_HOST`, `FROGIE_PORT` and `FROGIE_DB_PATH` from the separate configuration module are not wired into that entry. Isolated runs require explicit `startServer({ port, dataDir, dbPath })` configuration. Default startup does not restrict listening to loopback interfaces.

Build output goes to `packages/server/dist` and `packages/web/dist`. The backend does not serve frontend assets, so deployment requires a separate static file server and HTTP / WebSocket proxy configuration.

## Tests

Run these from the repository root:

| Scope | Command |
| --- | --- |
| Unit tests: data, routes, engine transforms and frontend state | `bun run test` |
| The same suite with coverage | `bun run test:coverage` |
| API route test subset | `bun run test:l2` |
| Chromium browser tests | `bunx playwright install chromium`, then `bun run test:l3` |

`test:l2` runs route tests in Vitest and does not require a live model service. The default Node-based suite skips startup tests that depend on Bun's native server.

The existing browser runner starts or reuses ports 7033 / 7034 and the default `~/.frogie` data. Its tests create sessions, change settings and attempt to send messages; no login fixture or independent data directory is provided yet. Prepare an isolated test instance, login state, existing test directories and a mock model API before running it. This is not a side-effect-free check for your everyday instance.

## Stack

| Technology | Role |
| --- | --- |
| TypeScript / Bun | Workspace code, service runtime and builds |
| Hono / WebSocket | HTTP API and streaming session events |
| Anthropic SDK | Model calls, custom tool loop and summary requests |
| MCP TypeScript SDK | stdio connections and tool discovery |
| SQLite | Configuration and session indexes; `bun:sqlite` at runtime, `better-sqlite3` for Node tests |
| React / Vite / Zustand | Web interface, development server and client state |
| Tailwind CSS / Radix UI | Styling and interactive components |
| react-markdown / remark-gfm / rehype-highlight | Markdown rendering and code highlighting |
| Vitest / Playwright | Unit, route and browser tests |

## Documentation

- [Documentation index](README.md): architecture and feature designs. Some documents retain earlier SDK, transport and configuration plans; this README and the source describe current behavior.
- [System prompt design](features/01-system-prompt-builder.md): prompt layers, inheritance and preview conventions.
- [Server entry](../packages/server/src/index.ts), [built-in tools](../packages/server/src/engine/builtin-tools.ts) and [MCP client](../packages/server/src/mcp/client.ts): starting points for running and extending the application.

## License

[MIT](../LICENSE)
