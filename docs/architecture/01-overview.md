# 01 - Project Overview

## Vision

Frogie is a **web-based Claude Code** - bringing the full power of an AI coding agent to the browser. Users can interact with an intelligent assistant that can read, write, and execute code in their local workspace, all through a web interface.

## Core Goals

1. **Browser-native Experience**
   - No complex CLI setup required
   - Rich web UI for chat, tool visualization, and session management
   - Works on any device with a browser

2. **Full Agent Capabilities**
   - Multi-turn conversations with persistent context
   - 30+ built-in tools for file operations, shell execution, search
   - MCP server integration for extended capabilities
   - Automatic context compression for long sessions

3. **Flexible Backend Connection**
   - Connect to any OpenAI-compatible API endpoint
   - Works with Raven Proxy, direct Anthropic API, or other providers
   - Independent URL and Token configuration

4. **Multi-workspace Support**
   - Work on multiple projects simultaneously
   - Isolated sessions, MCP configs, and tool execution contexts per workspace

## Non-Goals (v1)

- Mobile-first design (desktop browser is primary target)
- Collaborative editing (single-user focus)
- Cloud-hosted agent execution (local proxy required)

## Reference Projects

This project synthesizes the best ideas from:

| Project | What We Take |
|---------|--------------|
| **Claude Code CLI** | Tool system prompts, permission model, Skill concept |
| **open-agent-sdk** | Agentic loop structure, context compression, MCP client |
| **Raven Proxy** | Proven API forwarding, token management patterns |

## Target Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser (Frogie UI)                 │
│  React + Tailwind + shadcn/ui                       │
│  - Chat interface                                    │
│  - Tool visualization                                │
│  - Session management                                │
│  - Workspace selector                                │
└─────────────────────────┬───────────────────────────┘
                          │ WebSocket
┌─────────────────────────▼───────────────────────────┐
│                  Frogie Agent Server                 │
│  Bun/Node.js + Hono                                 │
│  - Agentic loop engine                              │
│  - Tool executor (with sandbox)                     │
│  - MCP connection manager                           │
│  - Session persistence (SQLite)                     │
└─────────────────────────┬───────────────────────────┘
                          │ HTTP (OpenAI-compatible)
┌─────────────────────────▼───────────────────────────┐
│              LLM API Provider                        │
│  (Raven Proxy / Anthropic API / Other)              │
└─────────────────────────────────────────────────────┘
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Runtime | Bun | Fast startup, native TypeScript, good DX |
| Web Framework | Hono | Lightweight, fast, good WebSocket support |
| Frontend | React + Vite | Modern, fast HMR, rich ecosystem |
| Database | SQLite (better-sqlite3) | Simple, no external deps, sufficient for single-user |
| API Format | OpenAI-compatible | Works with many providers, well-documented |
| Communication | WebSocket | Bidirectional, supports streaming, interrupts |
