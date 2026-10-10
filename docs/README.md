# 文档索引

本目录持续记录项目定位、开发约定和各模块设计。开始任务时先浏览索引，核对本目录的实际文件，再按任务范围阅读相关文档及其引用。

## 文档目录

| 文档 | 内容 |
| --- | --- |
| [01 - 项目定位](01-project-positioning.md) | 个人多 Agent 管理平台、Pi 术语、Squad 与 Harness 关系、本地集中执行和两端独立闭环 |
| [02 - 仓库结构与开发约定](02-repository-and-workflow.md) | Daemon／Dashboard／Core／SDK 的 monorepo 划分、MVVM、TDD、原子提交和质量门禁 |
| [03 - Core](03-core.md) | 私有定义装配、Pi 接入、权限、持久预算、恢复及分页执行投影 |
| [04 - Dashboard](04-dashboard.md) | Basalt 与 React Flow、项目全景、定义编排、任务与历史观察、预算授权、聊天、认证管理与本地调试 |
| [05 - Squads](05-squads.md) | 私有 MD 与步骤图规范、Skill 与脚本契约、zeppelin 定义和多 Squad 验证材料 |
| [06 - Tests](06-tests.md) | 6DQ L1、多 Harness 和恢复、SDK 符合性、完整搭建及双端自治 E2E |
| [07 - Evals](07-evals.md) | 真实模型协作与恢复、本地双项目历史检查、his.fm 完整作品及回执验收 |
| [08 - MVP 实施](08-mvp-implementation.md) | 实现起点、文档审阅、本地闭环、SDK 与 his.fm、其他业务的顺序与阶段门槛 |
| [09 - 项目集成](09-project-integration.md) | 使用方与 Frogie 的职责、his.fm 调整位置、完整生产路径和后续业务接入 |
| [10 - 本地 Daemon](10-local-daemon.md) | 项目登记、多 Harness 生命周期、存储、权限、离线自治和观察调试 |
| [11 - 通信 SDK](11-communication-sdk.md) | 出站 WSS、双向认证、高级接口、实时观察、可靠投递、业务工具和包发布边界 |
| [Logo 说明](logo.md) | 图稿、来源记录与衍生文件生成方式 |

## 维护约定

新增设计文档采用 `NN-topic.md` 连续编号，并在索引中加入链接和内容说明。调整或移动文档时同步更新索引与相关引用，各模块的具体设计在后续文档中逐步展开。

项目规范见根目录 [AGENTS.md](../AGENTS.md)，项目概述见根目录 [README.md](../README.md)。
