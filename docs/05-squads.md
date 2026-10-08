# 05 - Squads

## 定义的组织方式

`squads/` 保存用户设计的协作定义。一个 Squad 由 Markdown 骨架、Skills、资源和脚本组成；目录表达角色归属，文件内容表达职责、配置与工作指导。

以下文件约定属于 Frogie 定义层，装配时使用 [Core](03-core.md) 规定的 Pi Agent、Conversation、Tool 与 Extension。相同文件可以由 Dashboard 或集成项目加载。

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

Squad、Role、Skill 和 Workflow 的 ID 使用 `^[a-z][a-z0-9-]*$`。ID 与对应目录或文件名一致，显示名称通过 `title` 表达。引用使用 ID，资源路径相对所属 Skill 目录解析。

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

能力数组显式填写，空数组表示该项为空。Core 安装的通用工具属于 `frogie` Extension，业务 Extension 由宿主提供。技能内容用于指导使用，工具和脚本权限由声明与宿主授权共同决定。

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

Skill 采用 `SKILL.md`、`name`、`description` 的基本形式。Frogie 的可执行入口放在 `frogie` 命名空间中：

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

正文描述适用情形、输入输出、操作步骤和资源路径。脚本声明只包含 ID、入口、受支持解释器和重放语义。宿主核对安全重放声明，并在自己的授权配置中启用对应入口。

`run_script` 接收 Skill 与 Script ID，以及 JSON 输入。宿主按固定入口启动沙箱，将输入写入 stdin，读取 stdout 的单份 JSON 结果，stderr 保留有界诊断。脚本成功以退出码 `0` 和有效输出共同判定，详细业务结构由该 Skill 与其测试约定。

脚本使用只读的 Skill 资源和自身临时目录。输出交给宿主保存为产物；需要访问业务系统的能力由相应业务 Tool 提供。

### Workflow

| frontmatter 字段 | 含义 |
| --- | --- |
| `id`、`title` | 工作流身份与名称 |
| `entryRole` | 接受工作流输入的角色 ID |
| `participants` | 工作说明引用的角色 ID，供校验和展示 |
| `tools`、`scripts` | 可选的能力上限，作用于本次工作及其派发子工作 |

正文按“目标、输入、步骤、输出、验收要点”组织。步骤使用有序 Markdown 列表，说明由谁处理什么输入、交给谁以及需要产出什么。

Workflow 是提交给模型的指导。`participants` 和步骤说明用于表达预期协作；运行端实际执行权限由角色树与能力交集检查。Dashboard 将定义步骤与真实任务分别展示。

用户创建会话时选择自由发挥或某个 Workflow。自由发挥只装载角色和技能；Workflow 会话固定采用该工作说明，后续输入继续该上下文。

## 编辑、装配与运行归属

Dashboard 的新增、复制、移动和编辑最终作用于上述文件。复制角色时产生新的稳定 ID，技能按引用复用；同一角色的多次执行通过新 Conversation 表达。

版本冻结将整个 Squad 及引用的资源、脚本打包为不可变快照。运行端记录定义摘要和自己的配置，实际会话、历史、SQLite、模型凭据与执行结果保存在该环境内。

业务集成方需要提供已声明的模型、Tools、Extensions、沙箱与产物存储。其输入经公共协议投递，输出按 Pi answer entry 和产物引用取得；自己的 UI 可编辑同一格式的定义，也可展示业务专属结果。

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

所有角色均可读取获准的输入产物并写出结果。`command`、`operations`、`crew` 获得 `delegate`；`engineering`、`logistics` 额外获得 `run_script`，入口限定为 `resource-budget/calculate`。

派发时父会话传入本次任务和输入产物引用。子会话可读取该授权范围并返回自己的结果；父会话通过派发回执取得输出引用。产物访问根据工作关联在宿主校验。

叶子角色用明确的结论、依据、约束与待协调项回复。主控综合多个回复，检查冲突后提交最终 Markdown；中间角色负责自己子树内的协调。

### 资源计算 Skill

`resource-budget/calculate` 是首个真实脚本，只做确定性的额度计算：

```text
demand = sum(allocations.amount)
remaining = available - reserve - demand
withinBudget = remaining >= 0
```

输入包含若干带 ID 的预算，每项给出可用量、保留量和分配列表；输出按 ID 返回总需求、剩余额度和是否满足预算。一个预算内使用同一单位，由输入资料标明。

脚本校验非负有限数值、必需字段和重复 ID，使用稳定输出。它读取 stdin、写 stdout，适合安全重放。资源是否应当分配、哪项需求更优先，仍由角色结合资料判断。

### 两种工作方式

`emergency-transit` 用于流程指导：

1. 主控读取紧急简报，明确目标、必要保留量和交付要求。
2. `operations` 协调 `navigation` 与 `tactical`，形成路线和护航建议。
3. `engineering` 与 `logistics` 核对关键负载、供电和资源要求，使用脚本计算候选方案。
4. 主控汇总冲突，选择可执行方案并输出 `plan.md`。

这条 Workflow 参与者为 `command`、`operations`、`navigation`、`tactical`、`engineering`、`logistics`，能力上限覆盖相应通用工具与唯一计算脚本。

自由发挥场景由用户向主控提交生活目标。主控自行安排 `crew`、`medical`、`habitat` 与 `logistics` 协作，形成生活与资源方案。它复用同一套角色和技能，通过另一类目标验证定义的组合能力。

输入简报和实际输出保存在运行端产物区。评估用的固定简报与验收数据放在 `evals/`，具体数值和断言由评估文档维护。

## MVP 交付与复用

首期实现时交付一份可校验的 `zeppelin` 定义、四个 Skills、一个受控脚本和一条 Workflow。Dashboard 可以浏览九个角色，编辑文件、选择环境、发起两类工作并查看真实结果。

角色定义与运行适配分别验证：新增业务项目通过自己的 Squad 文件和宿主 Extension 接入，Core 与 Dashboard 继续按同一文件格式和公共协议工作。测试与评估安排见 [文档索引](README.md)。
