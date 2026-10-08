# 文档索引

本目录持续记录项目定位、开发约定和各模块设计。开始任务时先浏览索引，核对本目录的实际文件，再按任务范围阅读相关文档及其引用。

## 文档目录

| 文档 | 内容 |
| --- | --- |
| [01 - 项目定位](01-project-positioning.md) | 项目目的、统一术语、Squad 与 Harness 的关系、主要模块和职责归属 |
| [02 - 仓库结构与开发约定](02-repository-and-workflow.md) | Monorepo、数据与 seed 归属、MVVM、TDD、原子提交及 Git 检查原则 |
| [03 - Core](03-core.md) | 定义与工作流图解析、公共入口与运行协议、角色装配、权限、持久预算、恢复与观察 |
| [04 - Dashboard](04-dashboard.md) | Basalt 与 React Flow 设计台、全局切换、三模式隔离、模型与独立运行端连接、调试及沙箱 |
| [05 - Squads](05-squads.md) | MD 与步骤图规范、Skill 标识、显式能力与脚本契约，以及 zeppelin 的完整定义与界面搭建目标 |
| [06 - Tests](06-tests.md) | 6DQ L1、宿主符合性与恢复、从零搭建 zeppelin 的必需 E2E、环境隔离和 TDD 交付顺序 |
| [07 - Evals](07-evals.md) | 使用界面搭建快照，在独立 Local 环境按持久预算完成两个真实模型场景与恢复项的证据闭环 |
| [Logo 说明](logo.md) | 图稿、来源记录与衍生文件生成方式 |

## 维护约定

新增设计文档采用 `NN-topic.md` 连续编号，并在索引中加入链接和内容说明。调整或移动文档时同步更新索引与相关引用，各模块的具体设计在后续文档中逐步展开。

项目规范见根目录 [AGENTS.md](../AGENTS.md)，项目概述见根目录 [README.md](../README.md)。
