# Frogie

> Web-based Claude Code - A browser-native AI coding agent

Frogie is a web-based implementation of Claude Code, enabling AI-powered coding assistance directly in the browser. It connects to a local proxy layer to execute tools (file operations, shell commands, MCP servers) while providing a rich chat interface for multi-turn agent conversations.

## Key Features

- **Browser-native**: No complex local setup required, operate entirely through web interface
- **Agentic Loop**: Full agent loop with tool execution, context compression, and multi-turn conversations
- **Tool Execution**: 30+ built-in tools (Bash, Read, Write, Edit, Glob, Grep, etc.)
- **MCP Support**: Connect to Model Context Protocol servers (stdio, SSE, HTTP)
- **Multi-workspace**: Work on multiple projects with isolated sessions and configurations
- **Permission Control**: Configurable permission levels for dangerous operations

## Architecture

See [docs/](./docs/) for detailed architecture documentation.

## Status

**Pre-alpha** - Architecture design phase

## License

MIT
