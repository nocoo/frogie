# 05 - Squads

## 定义的组织方式

`squads/` 保存用户设计的协作定义。一个 Squad 由 Markdown 骨架、Skills、资源和脚本组成；目录表达角色归属，文件内容表达职责、配置与工作指导。

以下文件约定属于 Frogie 私有定义层，由 daemon 装配为 [Core](03-core.md) 规定的 Pi Agent、Conversation、Tool 与 Extension。Dashboard 管理源文件，集成项目通过 SDK 使用获准能力与结构投影。

## 目录规范

```text
squads/<squad-id>/
  SQUAD.md
  roles/<root-role-id>/
    ROLE.md
    <child-role-id>/
      ROLE.md
      <nested-role-id>/
        ROLE.md
  skills/<skill-id>/
    SKILL.md
    scripts/<entry>.mjs
    resources/<resource-file>
  workflows/<workflow-id>.md
```

`roles/` 下有且只有一个主控角色目录。每个角色目录内的下级角色目录表示它可以直接派发的子角色。角色 ID 在 Squad 内唯一，目录移动改变归属，ID 保持稳定。

Squad、Role、Skill 和 Workflow 的 ID 使用 `^[a-z][a-z0-9-]*$`。ID 与对应目录或文件名一致；Squad、Role 和 Workflow 的显示名称通过 `title` 表达。Skill 的 `SKILL.md` 中，`name` 必须等于 `skills/<skill-id>` 的目录名，并直接作为 Skill ID，`description` 描述用途。引用使用 ID，资源路径相对所属 Skill 目录解析。

定义格式由 `SQUAD.md` 的 `schemaVersion` 统一声明。解析器对结构、引用和文件归属进行校验，输出 Core 的 `DefinitionBundle`。脚本及其资源一同参与版本摘要和 Git 历史。

## 文件内容

### SQUAD.md

| frontmatter 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 首期为 `1` |
| `id` | Squad 稳定 ID |
| `projectId` | 所属项目的稳定 ID |
| `title` | 界面显示名称 |
| `defaults.model` | 可选的 Pi `{ provider, modelId }` |
| `defaults.thinkingLevel` | Pi 思考等级，首期默认 `medium` |

正文提供所有角色共享的目标、语境和输出习惯。模型配置允许在定义中给出，也允许由环境绑定补齐；绑定完成时每个角色都必须解析到宿主可用的具体模型与思考等级。

### ROLE.md

| frontmatter 字段 | 含义 |
| --- | --- |
| `id`、`title` | 角色身份和显示名称 |
| `model`、`thinkingLevel` | 可选的角色模型和思考等级，未填写时采用 Squad 默认值 |
| `skills` | 按顺序装载的 Skill ID 数组 |
| `extensions` | 角色选用的已登记 Pi Extension 名称数组 |
| `tools` | 角色声明的 Tool 名称数组 |
| `scripts` | 允许请求的 `<skill-id>/<script-id>` 数组 |

能力数组显式填写，空数组表示该项为空。Core 安装的通用工具属于 `frogie` Extension，本机项目 Extension 由 daemon 显式安装；远端业务能力通过已批准的本地适配器接入。技能用于指导使用，工具和脚本权限由声明、本机授权及本次调用权限共同决定。

正文按“职责、输入、工作方式、输出”组织。主控角色说明分工和汇总方式，子角色说明自己的判断依据和返回内容。祖先正文与能力保持各自归属，当前角色装载自身内容和 Squad 公共说明。

例如，一个需要计算能力的角色可以使用以下结构：

```yaml
---
id: engineering
title: 工程
thinkingLevel: medium
skills: [resource-budget]
extensions: [frogie]
tools: [read_artifact, run_script, write_artifact]
scripts: [resource-budget/calculate]
---
```

### SKILL.md 与 Script

Skill 的标识与用途分别使用 `name` 和 `description`。Frogie 的可执行入口放在 `frogie` 命名空间中：

```yaml
---
name: resource-budget
description: 核对资源分配、保留量与剩余额度。
frogie:
  scripts:
    - id: calculate
      entry: scripts/calculate.mjs
      runtime: node
      replay: safe
---
```

正文描述适用情形、输入输出、操作步骤和资源路径。脚本声明只包含 ID、入口、受支持解释器和重放语义。首期通用 `run_script` 要求 `replay: safe`，宿主核对其纯计算或幂等实现后，在自己的授权配置中启用对应入口。具有其他重放语义的操作由业务 Extension 的独立 Tool 提供。

`run_script` 接收 Skill 与 Script ID，以及 JSON 输入。宿主按固定入口启动沙箱，将输入写入 stdin，读取 stdout 的单份 JSON 结果，stderr 保留有界诊断。脚本成功以退出码 `0` 和有效输出共同判定，详细业务结构由该 Skill 与其测试约定。

脚本使用只读的 Skill 资源和自身临时目录。输出交给宿主保存为产物；需要访问业务系统的能力由相应业务 Tool 提供。

### Workflow

| frontmatter 字段 | 含义 |
| --- | --- |
| `id`、`title` | 工作流身份与名称 |
| `entry` | 入口节点 ID，节点引用的角色成为 `entryRole` |
| `nodes` | 步骤数组，每项包含 `id`、`title`、`role` 与 `position: { x, y }` |
| `edges` | 交接数组，每项包含 `source`、`target` 和可选的自然语言 `label` |
| `tools`、`scripts` | 可选的能力上限，作用于本次工作及其派发子工作 |

正文按二级标题“目标、输入、步骤、输出、验收要点”组织。“步骤”下用节点 ID 作为三级标题，一段对应一个节点，描述该步骤的输入、工作与输出。节点 ID 在工作流内唯一，采用与其他定义相同的小写命名规则；显示名保存在节点的 `title`。

以下是通用的双步骤结构，两个步骤引用同一个已有角色：

```markdown
---
id: review
title: 审阅与交付
entry: assess
nodes:
  - id: assess
    title: 审阅材料
    role: reviewer
    position: { x: 80, y: 120 }
  - id: publish
    title: 输出结论
    role: reviewer
    position: { x: 400, y: 120 }
edges:
  - source: assess
    target: publish
    label: 带上发现与证据
---

## 目标
根据输入材料形成有依据的结论。

## 输入
待审阅材料的产物引用。

## 步骤
### assess
读取材料，核对要求并整理发现。

### publish
综合发现，通过产物工具提交结论。

## 输出
包含结论与证据引用的 Markdown。

## 验收要点
证据可以追溯到输入材料。
```

Core 从入口节点推导 `entryRole`，从所有节点的角色引用推导 `participants`。节点的正文与角色的 Prompt 分别保存：前者指导这一步，后者来自被引用的 `ROLE.md`。复制步骤产生新的节点 ID，复用同一角色定义；复制角色产生新的 Role ID。

Workflow MD 是画布与源码编辑的共同依据。节点坐标随文件进入 Git 和内容摘要；画布缩放、选中项与视口属于界面偏好。连线端点、正文对应关系、角色引用与入口可达性通过统一校验，编辑中的未完成连接保留在草稿中。

Workflow 是提交给模型的指导，连线的 `label` 用自然语言表达交接或条件，回路可以表示复核迭代。Core 将图与正文渲染为模型说明，角色树与能力交集负责实际派发权限，Pi Task 负责执行。Dashboard 分别展示设计图和真实任务关系。

`tools` 或 `scripts` 缺省时保留角色与宿主已有的能力范围，显式空数组将该类能力收窄为空。工作流限制随派发保存在子会话绑定中。

用户创建会话时选择自由发挥或某个 Workflow。自由发挥只装载角色和技能；Workflow 会话固定采用该工作说明，后续输入继续该上下文。

## 编辑、装配与运行归属

Dashboard 的新增、复制、移动和编辑最终作用于上述文件。复制角色时产生新的稳定 ID，技能按引用复用；同一角色的多次执行通过新 Conversation 表达。

版本冻结将整个 Squad 及引用的资源、脚本打包为不可变快照。daemon 记录定义摘要和环境配置，会话、历史、SQLite、模型凭据与本地产物保存在本机；经业务工具提交的最终结果由集成项目保存。

集成方提供上下文、业务工具的结构化处理器、用户权限和结果存储；模型、Pi 扩展和沙箱归 daemon。角色源文件保持在 Frogie，业务配置作为带版本的上下文读取。公开 SDK 和云端构建产物只包含通信能力与获准展示数据。

定义中引用的远端工具与本地能力分别登记。远端断线时角色、技能和会话仍可装配，工具入口返回明确不可用结果；本地聊天和调试使用现有历史与输入。需要总结跨会话历史的角色显式获准使用 `read_history`，读取范围由本机授权限定。

## zeppelin 示例

### 目的与语境

`zeppelin` 是首个测试用 Squad，名称和 ID 均为小写。它是一支虚拟太空时代的 AI 组织，负责协调一整支舰队的行动、工程、补给、医疗与生活。

舰队由探索舰、护航舰和居住补给舰组成。场景材料给出当次舰况、资源、人员与目标，角色通过真实模型、Pi 会话、工具和本地脚本形成方案。业务世界使用固定虚构数据，执行过程采用真实运行端。

其作用是验证同一份定义如何驱动不同职责的角色协作。舰队名词、业务规则和资源公式集中在此 Squad、Skill 与评估材料中。

### 角色树

```text
squads/zeppelin/
  SQUAD.md
  roles/command/
    ROLE.md
    operations/
      ROLE.md
      navigation/ROLE.md
      tactical/ROLE.md
    engineering/ROLE.md
    logistics/ROLE.md
    crew/
      ROLE.md
      medical/ROLE.md
      habitat/ROLE.md
  skills/
    fleet-command/SKILL.md
    mission-planning/SKILL.md
    resource-budget/
      SKILL.md
      scripts/calculate.mjs
    crew-care/SKILL.md
  workflows/
    emergency-transit.md
```

共有九个角色。主控按需要创建子会话，同一角色可以用于多个工作单元。

| Role | 职责与输出 | Skill | 思考等级 |
| --- | --- | --- | --- |
| `command` | 接收舰队目标，协调分歧并提交综合方案 | `fleet-command` | `high` |
| `operations` | 协调航行和战术，提出行动顺序与备选路线 | `mission-planning` | `medium` |
| `navigation` | 根据路线资料判断航程、时机与风险 | `mission-planning` | `low` |
| `tactical` | 评估威胁、护航部署和撤离条件 | `mission-planning` | `medium` |
| `engineering` | 核对推进、供电、维修窗口和资源可行性 | `resource-budget` | `medium` |
| `logistics` | 核对库存、分配、保留量和补给安排 | `resource-budget` | `low` |
| `crew` | 汇总人员生活需求，协调医疗和居住安排 | `crew-care` | `medium` |
| `medical` | 根据虚构医疗简报提出照护优先级和资源保留要求 | `crew-care` | `medium` |
| `habitat` | 安排居住、轮班、餐饮和休闲活动 | `crew-care` | `low` |

模型由本地绑定选择，界面展示每个角色实际使用的 `{ provider, modelId }`。可为不同角色选择不同模型；评估至少保留两种已验证支持的思考等级，模型能力预检在执行前完成。

### 能力分配

每个角色的能力组合显式如下：

| 角色 | Extensions | Tools | Scripts |
| --- | --- | --- | --- |
| `command`、`operations`、`crew` | `[frogie]` | `[read_artifact, write_artifact, delegate]` | `[]` |
| `engineering`、`logistics` | `[frogie]` | `[read_artifact, write_artifact, run_script]` | `[resource-budget/calculate]` |
| `navigation`、`tactical`、`medical`、`habitat` | `[frogie]` | `[read_artifact, write_artifact]` | `[]` |

派发时父会话传入本次任务和输入产物引用。子会话可读取该授权范围并返回自己的结果；父会话通过派发回执取得输出引用。产物访问根据工作关联在宿主校验。

叶子角色用明确的结论、依据、约束与待协调项回复。主控综合多个回复，检查冲突后提交最终 Markdown；中间角色负责自己子树内的协调。

### 资源计算 Skill

`resource-budget/calculate` 是首个真实脚本，只做确定性的额度计算：

```text
demand = sum(allocations.amount)
remaining = available - reserve - demand
withinBudget = remaining >= 0
```

输入：

```json
{"budgets":[{"id":"alpha","available":10,"reserve":2,"allocations":[{"id":"fuel","amount":3}]}]}
```

输出：

```json
{"budgets":[{"id":"alpha","demand":3,"remaining":5,"withinBudget":true}]}
```

输入对象必需且仅接受 `budgets`；预算对象必需且仅接受 `id`、`available`、`reserve`、`allocations`；分配对象必需且仅接受 `id`、`amount`。`budgets` 为非空数组，`allocations` 为数组且允许零项。预算 ID 在请求内唯一，分配 ID 在所属预算内唯一；所有 ID 使用 `^[a-z][a-z0-9-]*$`。

`available`、`reserve` 和 `amount` 必须是有限非负数，需求求和及 `remaining` 必须有限，`remaining` 可以为负。输出仅含 `budgets`，每项仅含 `id`、`demand`、`remaining`、`withinBudget`，按输入预算顺序对应；派生字段按上述公式保留原始计算精度。

脚本读取 stdin 中的 JSON 并向 stdout 写入单份 JSON 结果。无效输入沿用脚本的非零退出码与 stderr 诊断边界。一个预算内使用同一单位，由输入资料标明。资源是否应当分配、哪项需求更优先，仍由角色结合资料判断。

### 两种工作方式

`emergency-transit` 用于流程指导：

1. 主控读取紧急简报，明确目标、必要保留量和交付要求。
2. `operations` 协调 `navigation` 与 `tactical`，形成路线和护航建议。
3. `engineering` 与 `logistics` 核对关键负载、供电和资源要求，使用脚本计算候选方案。
4. 主控汇总冲突，选择可执行方案并输出 `plan.md`。

这条 Workflow 参与者为 `command`、`operations`、`navigation`、`tactical`、`engineering`、`logistics`，能力上限覆盖相应通用工具与唯一计算脚本。

画布用八个步骤表达这些指导，同一角色可以负责接收目标与最终交付：

| 节点 ID | Role | 工作与后续交接 |
| --- | --- | --- |
| `receive-brief` | `command` | 读取目标，分别交给 `coordinate-route`、`check-power`、`check-supplies` |
| `coordinate-route` | `operations` | 安排行动分析，交给 `assess-route` 与 `assess-threat` |
| `assess-route` | `navigation` | 提出航程与时机判断，交给 `merge-route` |
| `assess-threat` | `tactical` | 提出威胁与护航判断，交给 `merge-route` |
| `merge-route` | `operations` | 综合两个专业意见，交给 `publish-plan` |
| `check-power` | `engineering` | 核对负载并计算预算，交给 `publish-plan` |
| `check-supplies` | `logistics` | 核对保留量与补给，交给 `publish-plan` |
| `publish-plan` | `command` | 综合方案并交付 `plan.md` |

入口为 `receive-brief`，表中的交接形成十条连线。返回上级的连线表达结果交接，实际通过 `delegate` 回执回到父会话；目录中的九角色结构继续决定谁可以创建谁的子会话。`publish-plan` 在原主控会话收到子结果后继续执行。步骤和会话按各自身份保存。

自由发挥场景由用户向主控提交生活目标。主控直接委派 `crew` 与 `logistics`，`crew` 再派发 `medical` 与 `habitat`，共同形成生活与资源方案。它复用同一套角色和技能，通过另一类目标验证定义的组合能力。

输入简报和实际输出保存在运行端产物区。评估用的固定简报与验收数据放在 `evals/`，具体数值和断言由评估文档维护。

## MVP 交付与复用

首期实现时交付一份可校验的 `zeppelin` 定义、九个角色、四个 Skills、一个受控脚本和一条包含八个步骤、十条连线的 Workflow。受 Git 管理的 `squads/zeppelin/` 是规范样例，seed 和测试读取同一份材料。

Dashboard 支持从空工作区逐项创建这套定义，通过角色树与画布编辑完成编排，再选择模型、环境和 Harness 发起工作。E2E 使用 `empty` 初始化，通过界面建立全部文件和绑定；`sample` 初始化用于直接体验已有定义。两种入口共用解析、文件写入和运行接入规则。

从零搭建结果冻结为可导出的定义快照，保留源文件、脚本、图布局与内容摘要。真实模型评估选用该快照，在独立 Local 环境补齐模型连接与授权，验证相同定义的实际工作能力。

角色定义与运行适配分别验证：新增项目在 Frogie 中登记 Squad 和必要本机扩展，在业务侧登记 SDK 处理器，Core 与 Dashboard 沿用相同定义和运行语义。

本地多项目阶段采用已有 `zeppelin` 与 `hisfm` 作为两个独立 Squad。`hisfm` 的四个角色、完整提示词和拼装顺序通过内容摘要测试保留，先验证无远端连接时的普通聊天、历史总结与角色调试；完整播客流程在通信阶段通过真实业务工具验证。具体用例见 [Evals](07-evals.md)，实施阶段见 [MVP 实施](08-mvp-implementation.md)。
