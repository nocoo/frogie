<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" height="128" alt="Frogie 标志" />
</p>

<h1 align="center">Frogie</h1>

<p align="center">集中设计 Agent 定义，由各业务项目在本地独立运行。</p>

<p align="center">
  <a href="docs/README.md">文档</a>
</p>

<p align="center">
  <a href="https://github.com/earendil-works/pi/tree/main/packages/durable"><img src="https://img.shields.io/badge/Foundation-Pi%20Durable-557A46" alt="执行基础：Pi Durable" /></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT 许可证" />
</p>

## 这是什么

Frogie 面向使用 [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable) 运行本地 Agent 的项目，目标是提供统一的定义设计台和公共接入能力。

随着接入项目增多，每个项目都可能形成自己的术语、角色配置、会话管理和恢复逻辑。Frogie 希望统一这些基础机制，让用户能从一个入口理解和维护各项目的 Agent，同时保留不同业务各自的工作方式。

用户在设计台中定义和整理角色、提示词、技能与协作关系。业务项目加载指定版本的定义，提供自己的业务工具，并负责本地执行和状态保存。

## 目标能力

- **跨项目的统一视图**：用同一套概念理解各项目的角色、职责、协作关系、模型选择和工具权限。
- **可移植的定义**：以结构化 Markdown 文件组织提示词、技能和工作流，配套脚本保留为源文件。
- **两种执行指导模式**：允许 Agent 自由安排工作，也可以提供包含输入、输出和交接要求的流程说明，由 Agent 自行理解和执行。
- **公共 Pi 接入能力**：复用定义加载和运行接入代码，沿用 Pi Durable 的会话、提交、任务、扩展与存储语义。
- **本地沙箱执行**：利用本机文件、工具和算力，通过权限与隔离机制约束执行。

## 项目边界

| 事项 | 归属 |
| --- | --- |
| 定义的编写、整理，以及公共接入代码 | Frogie |
| 业务工具、认证、触发入口、界面接入和强制业务规则 | 使用方项目 |
| 持久化执行机制与状态提交 | 由使用方项目承载的 Pi Durable |
| 会话、SQLite 状态、凭据和执行产物 | 各项目的本地运行端 |

实际权限由角色定义和使用方授权共同限定。工具限制、沙箱隔离和业务审批由运行端代码执行。

模型可以来自远程服务，也可以来自兼容的本地服务。各项目在设计界面关闭后仍可独立运行。

## 本地体验

运行 `pnpm dev` 构建并启动 Local，通过终端输出的一次性链接打开 `https://frogie.dev.hexly.ai`。本机 Caddy 将该域名转发到 `127.0.0.1:7033`。

Local 使用真实的 OpenAI-compatible Chat Completions 模型。服务端从 `data/local-model.json` 读取私有配置，也可通过 `FROGIE_MODEL_CONFIG` 指定文件；密钥仅留在服务端。配置格式如下，将示例值替换为自己的模型配置：

```json
{
  "baseUrl": "http://127.0.0.1:3425/v1",
  "apiKey": "your-api-key",
  "modelId": "your-model-id",
  "contextWindow": 128000,
  "maxTokens": 4096,
  "thinkingLevel": "low"
}
```

模型地址接受 HTTPS 或 loopback HTTP。Local 在 `data/local/dashboard/` 保存定义副本、运行身份与会话 SQLite，重启继续使用原状态；更换绑定定义或模型时沿用 Core 的一致性校验。点击“对话”发送消息后才调用模型，费用按模型服务计费。

`FROGIE_MODE=e2e pnpm dev` 启动 Pi 官方确定性模型替身，每次在 `data/e2e/` 创建独立目录，不读取 Local 模型配置。当前入口由启动参数固定环境，右上角分段控件显示实际环境。完整 Workflow 画布、真实多角色派发与界面跨环境切换继续按设计文档实现。

## 项目接入

本地业务项目可通过 `@frogie/core/host` 接入，使用 Frogie 管理的角色定义，提供自己的模型配置、工具、业务状态与界面。his.fm 的角色和完整提示词维护在 `squads/hisfm/`，执行进程、网站审批与音频产物留在 his.fm。

`pnpm build:core` 生成可独立安装的 JavaScript 与类型声明，随后在 `packages/core` 内运行 `npm pack` 打包。接入契约与包更新方式见 [项目集成](docs/09-project-integration.md)。

## 文档

本项目文档统一使用中文，完整目录见 [文档索引](docs/README.md)。设计文档按编号持续补充，索引随文档更新。

## 许可证

[MIT](LICENSE)
