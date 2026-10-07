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
  <img src="https://img.shields.io/badge/Status-Design%20Stage-8A6D3B" alt="状态：设计阶段" />
  <img src="https://img.shields.io/badge/License-MIT-green" alt="MIT 许可证" />
</p>

## 这是什么

Frogie 面向使用 [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable) 运行本地 Agent 的项目，提供统一的定义设计台和公共接入能力，目前处于设计阶段。

随着接入项目增多，每个项目都可能形成自己的术语、角色配置、会话管理和恢复逻辑。Frogie 希望统一这些基础机制，让用户能从一个入口理解和维护各项目的 Agent，同时保留不同业务各自的工作方式。

用户在设计台中定义和整理角色、提示词、技能与协作关系。业务项目加载指定版本的定义，提供自己的业务工具，并负责本地执行和状态保存。设计台不集中托管各项目的运行过程。

## 目标能力

以下是产品目标，尚未实现。

- **跨项目的统一视图**：用同一套概念理解各项目的角色、职责、协作关系、模型选择和工具权限。
- **可移植的定义**：以结构化 Markdown 文件组织提示词、技能和工作流，配套脚本保留为源文件。
- **两种执行指导模式**：允许 Agent 自由安排工作，也可以提供包含输入、输出和交接要求的流程说明。流程用于指导模型，不保证模型严格遵循。
- **公共 Pi 接入能力**：复用定义加载和运行接入代码，沿用 Pi Durable 的会话、提交、任务、扩展与存储语义。
- **本地沙箱执行**：利用本机文件、工具和算力，通过实际的权限与隔离机制约束执行，而非只靠提示词。沙箱能力仍待实现。

## 项目边界

| 事项 | 归属 |
| --- | --- |
| 定义的编写、整理，以及公共接入代码 | Frogie |
| 业务工具、认证、触发入口、界面接入和强制业务规则 | 使用方项目 |
| 持久化执行机制与状态提交 | 由使用方项目承载的 Pi Durable |
| 会话、SQLite 状态、凭据和执行产物 | 各项目的本地运行端，不属于设计台 |

定义可以声明所需能力，但不能授予使用方未授权的权限。流程说明不能替代工具限制、沙箱隔离或业务审批。

本地执行不等于本地模型推理：模型可以来自远程服务，也可以来自兼容的本地服务。关闭设计界面，不应中断已经独立运行的项目。

## 开发状态

旧应用已移除。当前仓库保留项目文档、MIT 许可证，以及 logo 原图、衍生尺寸和生成资料。尚无可运行的应用、可安装的运行库，也没有应用构建或测试命令。

具体技术选型和接入约定将另行编写文档。[Logo 说明](docs/logo.md) 记录了保留的视觉标识及其衍生文件生成方式。

## 参考项目

- [Pi Durable](https://github.com/earendil-works/pi/tree/main/packages/durable)：本项目沿用的执行基础，不是要替换的框架。
- [his.fm](https://github.com/nocoo/his.fm)：本地常驻主控，根据需求动态派发工作给专家会话。
- [Giraffe](https://github.com/nocoo/giraffe)：由本地宿主代码组织流程，模型会话参与分析、规划、执行和审查。

这两个应用是参考实现，目前尚未接入 Frogie。公共基础应当支持它们保留不同的业务控制方式。

## 文档

本项目文档统一使用中文。设计文档放在 [docs/](docs/) 下，新增文档使用编号文件名；保留的 logo 说明维持原文件名。

- [01 - 项目定位](docs/01-project-positioning.md)：项目目的、职责边界和参考项目。
- [Logo 说明](docs/logo.md)：原始图稿、来源记录和衍生文件生成方式。

## 许可证

[MIT](LICENSE)
