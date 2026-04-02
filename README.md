<p align="center">
  <img src="logo.png" width="128" height="128" alt="Frogie Logo"/>
</p>

<h1 align="center">Frogie</h1>

<p align="center">
  <strong>Local-first web shell for an agent engine</strong><br>
  Agentic Chat · Multi-workspace · MCP Integration · Session Persistence
</p>

<p align="center">
  <img src="https://img.shields.io/badge/runtime-Bun-f9f1e1?logo=bun" alt="Bun">
  <img src="https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/React-19-61dafb?logo=react" alt="React">
  <img src="https://img.shields.io/badge/Hono-4-orange?logo=hono" alt="Hono">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License">
</p>

---

## 这是什么

Frogie 是一个浏览器端的 Agent 交互界面，封装了 [open-agent-sdk](https://github.com/codeany-ai/open-agent-sdk-typescript)，提供多工作区管理、会话持久化和丰富的工具可视化。它运行在本地机器上，拥有完整的文件系统访问权限——类似 Claude Code CLI 的 Web 版本。

```
┌─────────────────────────────────────────────────────┐
│              Browser (localhost:7033)               │
│  React 19 + Vite 7 + Tailwind CSS 4                │
└─────────────────────────┬───────────────────────────┘
                          │ WebSocket
┌─────────────────────────▼───────────────────────────┐
│              Frogie Server (localhost:7034)         │
│  Bun + Hono + open-agent-sdk                       │
└───────────┬─────────────────────────┬───────────────┘
            │                         │
┌───────────▼───────────┐   ┌────────▼────────┐
│    Anthropic API      │   │   MCP Servers   │
│    (Claude)           │   │   (local spawn) │
└───────────────────────┘   └─────────────────┘
```

## 功能

### Web 界面

- **Chat Panel** — 实时流式对话，支持 thinking blocks 展示
- **Tool Visualization** — 工具调用过程可视化，输入/输出实时展示
- **Model Selector** — 会话级别的模型切换，支持多提供商（Claude/GPT/Gemini）
- **Session Management** — 会话列表、历史记录、Fork 功能

### Agent 引擎

- **Agentic Loop** — 基于 open-agent-sdk 的多轮对话循环
- **Built-in Tools** — 30+ 内置工具（文件操作、Shell 执行、搜索）
- **MCP Integration** — 支持 stdio/sse/http 三种传输协议
- **Context Compaction** — 自动上下文压缩，支持长会话

### 工作区

- **Multi-workspace** — 多项目并行，独立的会话和 MCP 配置
- **Local-first** — 数据存储在本地 SQLite，隐私优先
- **Full Access** — 无沙箱限制，拥有用户完整权限

## 安装

```bash
# 克隆仓库
git clone https://github.com/nocoo/frogie.git
cd frogie

# 安装依赖
bun install

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入必要配置

# 启动开发服务器
bun run dev
```

访问 http://localhost:7033 开始使用。

## 项目结构

```
frogie/
├── packages/
│   ├── server/              # Hono 后端
│   │   ├── src/
│   │   │   ├── auth/        # Google OAuth + JWT
│   │   │   ├── db/          # SQLite 数据层
│   │   │   ├── engine/      # Agent 引擎适配
│   │   │   ├── mcp/         # MCP 客户端管理
│   │   │   └── routes/      # API 路由
│   │   └── package.json
│   └── web/                 # React 前端
│       ├── src/
│       │   ├── components/  # UI 组件
│       │   ├── pages/       # 页面
│       │   └── viewmodels/  # 状态管理 (Zustand)
│       └── package.json
├── docs/                    # 架构文档
├── tests/                   # E2E 测试 (Playwright)
├── scripts/                 # 构建脚本
└── package.json
```

## 技术栈

| 层 | 技术 |
|---|---|
| Runtime | [Bun](https://bun.sh/) |
| Backend | [Hono](https://hono.dev/) + WebSocket |
| Frontend | [React 19](https://react.dev/) + [Vite 7](https://vite.dev/) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Database | SQLite ([bun:sqlite](https://bun.sh/docs/api/sqlite)) |
| Agent | [open-agent-sdk](https://github.com/codeany-ai/open-agent-sdk-typescript) |
| Auth | Google OAuth + JWT |

## 开发

### 环境要求

- [Bun](https://bun.sh/) >= 1.0
- Node.js >= 20（部分工具需要）

### 常用命令

| 命令 | 说明 |
|---|---|
| `bun run dev` | 启动开发服务器（前后端并行） |
| `bun run dev:server` | 仅启动后端 (localhost:7034) |
| `bun run dev:web` | 仅启动前端 (localhost:7033) |
| `bun run build` | 构建生产版本 |
| `bun run typecheck` | TypeScript 类型检查 |
| `bun run lint` | ESLint 检查 |
| `bun run test` | 运行单元测试 |

## 测试

| 层 | 内容 | 触发时机 |
|---|---|---|
| L1 Unit | ViewModel、工具函数、数据转换 | pre-commit |
| L2 Integration | API 端点、WebSocket、数据库操作 | pre-push |
| L3 E2E | Playwright 浏览器测试 | CI/手动 |

```bash
# 单元测试
bun run test

# E2E 测试
bun run test:l3
```

## 文档

| 文档 | 说明 |
|---|---|
| [架构概览](docs/architecture/01-overview.md) | 项目愿景和架构设计 |
| [系统架构](docs/architecture/02-system-architecture.md) | 详细系统设计 |
| [Agent 引擎](docs/architecture/03-agent-engine.md) | Agent 循环和工具系统 |
| [API 协议](docs/architecture/07-api-protocol.md) | WebSocket 和 REST API |

## License

[MIT](LICENSE) © 2026
