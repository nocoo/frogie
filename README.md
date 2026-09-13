<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" height="128" alt="Frogie Logo" />
</p>

<h1 align="center">Frogie</h1>

<p align="center">在浏览器中管理本地项目的 AI 对话、工具执行和会话历史。</p>

<p align="center">
  <a href="docs/README.en.md">English</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-f9f1e1?logo=bun&logoColor=000" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=fff" alt="TypeScript" />
  <img src="https://img.shields.io/badge/React-20232a?logo=react&logoColor=61dafb" alt="React" />
  <img src="https://img.shields.io/badge/Hono-E36002?logo=hono&logoColor=fff" alt="Hono" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT License" />
</p>

## 这是什么

Frogie 是面向个人开发者的本地 Web 编程助手。浏览器展示对话与工具执行过程，Bun 服务连接配置好的模型接口，在本机项目目录中读写文件、执行命令，并保存会话。多个工作区可以共用这套界面，各自保留会话和 MCP 配置。

当前引擎直接使用 Anthropic SDK。对话、工具调用和模型列表都要求兼容 Anthropic 接口；列表中出现 GPT、Gemini 等名称时，仍然需要能转换协议的上游服务。

项目仍处于早期阶段：业务 API 和 WebSocket 会校验 Google 登录会话，未配置认证时会拒绝业务请求；WebSocket 还会校验浏览器来源。工具会自动执行，使用服务进程的系统权限，也没有可靠的工作区沙箱。运行时仍应限制网络访问，只用于自己控制的设备和项目。

## 功能

- **流式对话**：展示正文、模型返回的 thinking 内容、工具参数与结果，可在会话中切换模型。
- **本地工具**：内置读取文件、写入文件、列目录、执行 Shell 命令和简单文件名搜索五项工具。
- **工作区与会话**：关联已有目录，创建、重命名、删除和继续会话；Fork 复制当前对话历史，不复制项目文件。
- **stdio MCP**：按工作区保存服务命令、参数和环境变量，连接后把工具加入对话。配置类型包含 SSE / HTTP，但这两种传输尚未实现。
- **系统提示词**：编辑全局提示词层，按工作区覆盖、启停或恢复，并预览组合结果。预览只列内置工具，实际对话再加入已连接的 MCP 工具。
- **会话用量**：展示轮次、token 和估算费用，按配置限制每次请求的轮次与估算预算。长对话达到估算阈值时会尝试生成摘要；摘要请求使用同一模型服务。

## 使用

完成下方源码启动与登录配置后，打开 `http://localhost:7033`：

1. 在 **Settings** 填入 API Base URL、API Key 和默认模型。Base URL 不带末尾的 `/v1`，例如 `https://api.anthropic.com`；SDK 会添加接口路径。初始设置仍指向旧的本地代理地址，需要先改成实际服务。
2. 在 **Workspaces** 添加一个已经存在的项目目录，再创建会话。目录选择与 Finder 打开功能依赖 macOS；其他环境可直接填写路径。
3. 发送任务，在对话中查看工具执行结果。需要额外工具时，为工作区添加可运行的 stdio MCP 服务；需要调整行为时进入 **System Prompts**。

设置、工作区、会话索引与 MCP 配置存放在 `~/.frogie/frogie.db`；对话正文存放在 `~/.frogie/sessions/<id>/transcript.json`。API Key 在本地数据库中以明文保存，接口显示时才做遮盖。消息在本次查询完成后写入，异常退出时当前轮次可能尚未落盘。对话和相关工具输出会发送到配置的模型服务。

费用来自本地固定单价表，用于请求间的估算控制，不等同于服务商账单或硬性扣费上限。

## 开发

需要 Bun、Node.js 22.13+（或 24+）和 Git。内置命令工具依赖 `sh`、`find`、`head`；macOS 目录选择另用 `osascript` 和 `open`。

```bash
git clone https://github.com/nocoo/frogie.git
cd frogie
bun install --frozen-lockfile
cp .env.example .env
```

编辑根目录 `.env`，替换占位值。当前前端没有免登录本地模式，三个认证变量都需要有效配置。

```dotenv
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
JWT_SECRET=replace-with-a-random-secret
PORT=7034
BASE_URL=http://localhost:7033
ALLOWED_EMAILS=you@example.com
```

在 Google OAuth 客户端中登记回调地址 `http://localhost:7033/api/auth/callback`。这里的 `BASE_URL` 指向前端：Vite 会把 `/api` 和 `/ws` 代理到 7034，登录回调后才能回到同一界面。登录 cookie 带有 `Secure` 属性；Chromium 的 localhost 开发环境可用，自定义域名需要 HTTPS。`ALLOWED_EMAILS` 为空时接受任何通过验证的 Google 账号，但业务 API 和 WebSocket 仍要求有效登录会话。

```bash
bun run dev
```

| 命令 | 用途 |
| --- | --- |
| `bun run dev:server` | 启动 Bun / Hono 服务，默认端口 7034 |
| `bun run dev:web` | 启动 Vite 界面，默认端口 7033 |
| `bun run build` | 构建服务端与前端 |
| `bun run typecheck` | 检查两个包的 TypeScript 类型 |
| `bun run lint` | 运行 ESLint |

当前启动入口读取 `PORT`，数据目录默认为 `~/.frogie`。独立配置模块中的 `FROGIE_HOST`、`FROGIE_PORT` 和 `FROGIE_DB_PATH` 尚未接入该入口；隔离运行需要通过 `startServer({ port, dataDir, dbPath })` 显式配置。默认启动也没有限制为仅监听回环地址。

构建产物在 `packages/server/dist` 和 `packages/web/dist`。后端尚未挂载前端静态资源，部署时需要自行配置静态文件服务与 HTTP / WebSocket 代理。

## 测试

在仓库根目录运行：

| 范围 | 命令 |
| --- | --- |
| 单元测试：数据层、路由、引擎转换与前端状态 | `bun run test` |
| 同一组测试及覆盖率 | `bun run test:coverage` |
| API 路由测试子集 | `bun run test:l2` |
| Chromium 浏览器测试 | `bunx playwright install chromium`，然后 `bun run test:l3` |

`test:l2` 是 Vitest 中的路由测试，不需要启动真实模型服务。Node 下的默认测试会跳过依赖 Bun 原生服务的启动用例。

浏览器测试只启动 7033 前端，并通过内存 fixture 模拟登录、业务 API 与 WebSocket。Workspace、Session、Settings 和 Chat 操作不会启动真实后端，也不会读取或修改默认 `~/.frogie` 数据，可作为隔离的日常回归检查。

## 技术栈

| 技术 | 用途 |
| --- | --- |
| TypeScript / Bun | 工作区代码、服务运行与构建 |
| Hono / WebSocket | HTTP API 与流式会话事件 |
| Anthropic SDK | 模型调用、自定义工具循环与摘要请求 |
| MCP TypeScript SDK | stdio 服务连接和工具发现 |
| SQLite | 配置与会话索引；Bun 运行时使用 `bun:sqlite`，Node 测试使用 `better-sqlite3` |
| React / Vite / Zustand | 网页界面、开发服务与客户端状态 |
| Tailwind CSS / Radix UI | 样式与交互组件 |
| react-markdown / remark-gfm / rehype-highlight | Markdown 和代码高亮 |
| Vitest / Playwright | 单元、路由与浏览器测试 |

## 文档

- [文档索引](docs/README.md)：架构与功能设计。部分文档保留了早期 SDK、传输和配置方案，当前行为以本 README 与源码为准。
- [系统提示词设计](docs/features/01-system-prompt-builder.md)：提示词层、继承与预览约定。
- [服务入口](packages/server/src/index.ts)、[工具实现](packages/server/src/engine/builtin-tools.ts)、[MCP 客户端](packages/server/src/mcp/client.ts)：运行与扩展的主要入口。

## 许可证

[MIT](LICENSE)
