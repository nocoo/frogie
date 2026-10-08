# 02 - 仓库结构与开发约定

## Monorepo 组织

采用 workspace monorepo，首期设置一个公共包和一个 Dashboard 应用。公共包面向所有集成方，Dashboard 使用同一公共包实现管理界面和本地调试端。概念与归属沿用 [01 - 项目定位](01-project-positioning.md)。

下列目录和检查入口作为工程初始化约定，随对应功能建立。根目录统一管理工作区、单一依赖锁文件和开发命令，各工作区声明自己的依赖与导出入口。

```text
frogie/
  AGENTS.md
  README.md
  Retrospective.md
  package.json
  apps/
    dashboard/
      package.json
      src/
        cli.ts
        server/
          runtime/
        client/
          models/
          viewmodels/
          views/
      public/
  packages/
    core/
      package.json
      src/
        contracts/
        definitions/
        runtime/
        client/
        testing/
  squads/
    <squad-id>/
      SQUAD.md
      roles/
      skills/
      workflows/
  tests/
    integration/
    e2e/
    fixtures/
  evals/
    cases/
  scripts/
  .husky/
    pre-commit
    pre-push
  docs/
  assets/brand/
  logo.png
  LICENSE
```

## 代码职责

### 公共包

`packages/core` 提供集成方与本地调试端共同使用的能力，通过包的公开入口导出。

| 目录 | 职责 |
| --- | --- |
| `src/contracts/` | 共享类型、数据校验和接入协议，供浏览器与运行端使用 |
| `src/definitions/` | Squad 的 MD 解析、目录关系、引用校验、版本识别与配置装配 |
| `src/runtime/` | Pi 接入、Squad 与 Harness 绑定、权限检查、持久化约定和观察诊断 |
| `src/client/` | 面向使用方 UI 的调用、订阅和交互状态能力，与具体视觉组件分离 |
| `src/testing/` | 模拟模型与工具、可复用的协议符合性测试，供不同 Harness 接入实现使用 |

公共包按职责提供独立导出入口。浏览器使用 `contracts` 和 `client`；文件读取、Pi 运行与存储接入位于宿主侧。依赖方向为应用依赖公共包，公共包围绕 Pi Durable 实现能力。Pi 及其相关依赖统一版本，Dashboard 通过公开入口使用公共实现。

### Dashboard 与本地调试端

`apps/dashboard` 是本地应用，也是公共接入能力的第一个使用方。

| 目录 | 职责 |
| --- | --- |
| `src/cli.ts` | 本地启动入口、参数和应用生命周期 |
| `src/server/` | 本地 API、定义文件编辑、授权检查和运行端连接 |
| `src/server/runtime/` | Harness 参考接入：提供存储、模型和执行环境，承载调试及恢复 |
| `src/client/models/` | 界面领域数据与服务调用 |
| `src/client/viewmodels/` | 页面状态、用户操作和异步协调 |
| `src/client/views/` | 展示与交互组件，消费 ViewModel |
| `public/` | Dashboard 静态资源 |

界面采用 MVVM。业务逻辑、协议转换和权限判断放在可测试的模型、服务或 ViewModel 中；最终授权由服务端和运行端执行。本地调试端复用公共包创建和托管 Pi Harness，各集成项目按同样方式接入。界面模板从已验证的交互中提取，通过公共入口使用能力。

现有 `packages/web/public/` 保存的 logo 衍生文件，在 Dashboard 初始化时迁入 `apps/dashboard/public/`，同时更新 `scripts/resize-logos.py` 的生成目标。原图和来源记录继续保存在 `logo.png` 与 `assets/brand/`。

## Squad 定义目录

`squads/` 保存本仓库管理的协作定义，每个 Squad 有独立目录。目录示例如下：

```text
squads/<squad-id>/
  SQUAD.md
  roles/
    coordinator/
      ROLE.md
      children/
        writer/
          ROLE.md
  skills/
    <skill-id>/
      SKILL.md
      scripts/
  workflows/
    <workflow-id>.md
```

- `SQUAD.md` 是协作定义入口，描述角色组合、入口安排和工作流引用。
- `ROLE.md` 保存角色定义；`children/` 内的角色目录表达所属角色的子角色关系。
- `SKILL.md` 保存技能说明，通过相对路径引用配套脚本和资源。
- `workflows/` 保存面向模型的流程指导，由 Squad 或角色引用。

上述层级属于 Frogie 定义约定，由公共解析器装配到 Pi。字段和引用格式在定义协议中细化。同一角色可以形成多个会话实例，实例身份与历史由运行端持有。

定义和脚本作为源文件纳入 Git，Dashboard 的编辑结果体现为仓库差异。提交时同时检查 MD、目录关系和脚本引用。

## 运行数据与测试材料

| 内容 | 位置与归属 |
| --- | --- |
| 定义、脚本、固定评估用例 | 仓库内，随 Git 记录版本 |
| 日常调试 SQLite、会话历史和产物 | 仓库外的本地数据目录，按项目、Squad 和环境隔离 |
| 集成方运行数据 | 集成项目指定的存储，由其 Harness 持有 |
| 模型密钥和业务凭据 | 本机私有配置，通过运行端注入 |
| 测试数据库、文件和浏览器配置 | 每次测试独立创建的临时目录 |
| 构建产物、覆盖率和评估报告 | 忽略的生成目录或测试临时目录 |

测试使用模拟模型、工具和凭据。测试入口验证临时目录归属和测试环境标识，再初始化、重置或清理数据；进程和文件清理限定在本次测试创建的资源。真实模型评估使用显式授权的独立执行入口。

## 测试与 Evaluation 布局

- **L1 单元测试**：`*.test.ts` 与被测代码放在同一模块，覆盖解析、校验、权限、状态转换和 ViewModel 行为。测试依赖使用同目录的小型 fixture 或 `tests/fixtures/` 中的公共材料。
- **协议符合性测试**：可复用用例位于 `packages/core/src/testing/`。各运行端调用同一套用例验证约定，包含真实存储和恢复的测试在集成测试中执行。
- **L2 集成测试**：`tests/integration/` 通过真实本地 API、SQLite 和模块组合验证接入行为，覆盖全部 API 端点与方法组合及其授权、失败路径。
- **L3 完整流程**：`tests/e2e/` 验证 CLI 启动、Dashboard 编辑和本地调试等完整用户操作。
- **Agent 效果评估**：`evals/cases/` 保存输入、预期结果和验收条件；执行器通过公共协议使用调试运行端，结果关联定义版本。

按测试驱动方式开发：先写表达预期行为的测试，再实现最小可用功能，检查通过后提交。首期落实 L1；L2、L3 和真实模型评估随对应能力补充。

## 检查入口

根 `package.json` 统一提供以下脚本。工程初始化时先实现 L1 所需入口和 Husky 安装流程，其余入口随对应功能建立；可执行命令以实际 `package.json` 为准。

| 脚本 | 职责 |
| --- | --- |
| `check:docs` | 检查文档链接与格式 |
| `check:definitions` | 解析并校验仓库中的 Squad、角色和技能引用 |
| `typecheck` | 检查全部工作区的严格类型 |
| `lint` | 只读检查代码规则和格式 |
| `test:coverage` | 运行完整 L1 单测并执行覆盖率阈值检查 |
| `build` | 构建公共包及其导出入口、Dashboard 服务端与界面 |
| `gate:l1` | 汇总提交前所需检查 |
| `gate:push` | 汇总当前阶段的推送前检查 |

`.husky/` 负责调用入口，快照准备、检查执行与结果汇总放在 `scripts/`。手动验证和 hooks 使用同一套检查逻辑。

## Pre-commit

提交前执行 L1，检查对象为 **Git 暂存快照**，包含待提交的源码、定义、配置和测试。检查在独立临时目录运行，工作区和暂存区保持原样。

1. 执行文档与定义校验，以及全部工作区的类型、lint 和格式检查。
2. 运行完整单元测试和覆盖率检查，语句、分支、函数、行四项分别达到 95%。纯展示 View 的逻辑交由 ViewModel 测试，完整交互由 L3 验证。
3. 要求零错误、零警告；测试失败、覆盖率不足、必需测试为空、跳过或聚焦测试导致用例遗漏、缺少必需工具、超时等情况均返回失败并拦截提交。
4. 检查只读运行，格式修复作为正常编辑进入下一次暂存。正常代码改动的提交检查目标为 30 秒内。

`squads/` 中的 MD、技能脚本和引用变化属于行为变更，与应用代码一起接受检查。首期使用完整检查范围，保证跨工作区影响得到验证。

## Pre-push

推送前检查 **实际待推送的提交**。入口读取 Git hook 标准输入中的本地与远端 ref、SHA，按目标提交建立独立快照；多个 ref 分别确认，新分支覆盖目标树及该推送引入的历史，删除分支按删除操作处理。

首期 `gate:push` 复核目标提交的 L1，并验证公共包与 Dashboard 构建。对应能力建立后，将 L2 集成测试和 G2 依赖漏洞、密钥扫描纳入同一入口，常规执行目标为 3 分钟内。

各阶段明确所需检查及其范围，所有必需检查成功后才允许推送。依赖扫描检查目标提交的锁文件，密钥扫描覆盖待推送内容及其引入的提交历史；缺失必需工具或执行失败会拦截推送。L3 在 CI 或显式手动入口执行；D1 的测试隔离约定贯穿所有测试。

本地验证完成后，按用户授权执行推送，再核对远端提交。汇报时分别说明本地检查、推送结果和对应提交的 CI 结果。

## AI 工作约定

1. 开始前读取根 `AGENTS.md`、01 和本文，查看 Git 状态并确认本次改动范围。发现他人的并行修改时先与用户确认。
2. 共享能力放入 `packages/core`，本地应用与调试配置放入 `apps/dashboard`，协作行为定义放入 `squads/`；通过包的公开入口复用代码。
3. 修改定义时同步验证解析结果和引用；修改公共协议时同步维护调试端接入及符合性测试；修改界面行为时补充对应 ViewModel 测试。
4. 每次逻辑变更完成后，检查具体文件并原子提交。使用显式路径暂存，保留正常 hooks；提交信息采用英文 Conventional Commits，小写祈使句，长度不超过 50 个字符。
5. 推送、发布及真实模型调用按用户授权执行。说明实际执行过的检查及结果，操作复盘写入根 `Retrospective.md`。

根 `AGENTS.md` 保存稳定规则及文档入口，本文维护目录和工作流约定。实现检查脚本后，在根 `AGENTS.md` 中记录准确命令、适用范围和实际执行条件。
