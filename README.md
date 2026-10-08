<p align="center">
  <img src="assets/brand/icon-rounded.png" width="128" height="128" alt="Frogie 标志" />
</p>

<h1 align="center">Frogie</h1>

<p align="center">集中设计 Agent 定义，由各业务项目在本地独立运行。</p>

<p align="center">
  <a href="docs/">文档</a>
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

## 文档

本项目文档统一使用中文。设计文档放在 [docs/](docs/) 下，新增文档使用编号文件名；保留的 logo 说明维持原文件名。

- [01 - 项目定位](docs/01-project-positioning.md)：项目目的、定义方式和职责划分。
- [Logo 说明](docs/logo.md)：原始图稿、来源记录和衍生文件生成方式。

## 许可证

[MIT](LICENSE)
