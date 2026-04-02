# Frogie

> Local-first web shell for an agent engine

Frogie is a browser-based interface that wraps [open-agent-sdk](https://github.com/codeany-ai/open-agent-sdk-typescript), providing multi-workspace management, session persistence, and rich UI for AI-assisted coding workflows. It runs locally on your machine with full filesystem access.

## Key Features

- **Web UI**: Rich chat interface with tool visualization, session management
- **Local-first**: Runs on your machine, full filesystem access (no sandbox)
- **Multi-workspace**: Work on multiple projects with isolated sessions and MCP configs
- **open-agent-sdk Engine**: Agentic loop, tool execution, MCP client, session persistence
- **Anthropic API**: Native support for Claude models via Anthropic Messages API

## Architecture

```
Browser (React) ──WebSocket──▶ Frogie Server (Hono) ──▶ open-agent-sdk ──▶ Anthropic API
                                     │
                                     ├── SQLite (session index, workspace config)
                                     └── MCP Servers (local spawn)
```

See [docs/architecture/](./docs/architecture/) for detailed design.

## Status

**Pre-alpha** - Architecture design phase

## License

MIT
