# 03 - Core

## 模块目标

`packages/core/` 提供从 Squad 文件到 Pi Harness 的公共接入能力。Dashboard 调试端与集成项目使用同一套解析、装配、权限和观察协议，业务模型、工具实现、认证与运行数据仍归各运行端所有。

首期以 `@earendil-works/pi-durable`、`@earendil-works/pi-ai`、`@earendil-works/chord` 的 `1.1.0` 发布版为接口基线，统一锁定实际依赖版本。Node 运行端满足 Pi 的 `>=22.19.0` 要求。Pi Durable 的实验性接口通过明确版本和接入测试管理，升级作为独立变更验证。

Pi Durable 提供持久执行，Pi AI 提供模型接入，Chord 提供状态与携带取消信号的 `Context`。公共异步运行入口沿用该 `Context`。

术语沿用 [项目定位](01-project-positioning.md)，文件格式见 [Squads](05-squads.md)，参考宿主见 [Dashboard](04-dashboard.md)，验证分工见 [Tests](06-tests.md) 与 [Evals](07-evals.md)。

## 职责切分

| 部分 | 输入与输出 | 主要职责 |
| --- | --- | --- |
| 定义 | MD、Skills、Scripts → `DefinitionBundle` | 解析目录、校验引用、计算版本、输出可装配定义与诊断 |
| 协议 | 运行端能力与 Pi 状态 → 公共数据结构 | 统一绑定、操作结果、观察数据、错误和产物引用 |
| 运行接入 | 定义、宿主资源 → Pi Harness | 配置角色、建立会话、投递输入、派发子会话、检查权限 |

首期在 `src/definitions/`、`src/protocol/`、`src/runtime/` 内组织这些职责。浏览器入口只暴露协议类型与无运行时副作用的状态转换；文件解析和 Pi 宿主入口分别加载。React、Basalt、HTTP 服务和 SQLite 文件位置由应用选择。

公共能力直接使用 Pi 的 `Harness`、`Conversation`、`Submission`、`Task`、`Document`、Tool 与 Extension。界面层的数据投影保留这些身份和语义。

### 最小公共入口

以下是首期公共包的导出契约，具体数据与行为由本文后续章节定义：

| 导出入口 | 函数或类型 | 契约 |
| --- | --- | --- |
| `./definitions` | `loadDefinition(root)` | 从授权目录解析、校验并返回含文件内容和摘要的 `DefinitionBundle` |
| `./runtime` | `checkBinding(definition, binding, capabilities)` | 返回字段、引用和能力诊断，检查阶段保持只读 |
| `./runtime` | `openRuntime(options, context)` | 校验绑定后打开 Pi Harness，返回 `RuntimeHandle` |
| `./protocol` | `RuntimeScope`、`RuntimeDescription`、`RuntimeError`、`ObservationFrame` 及操作输入输出 | 浏览器可用的数据契约 |
| `./testing` | `registerRuntimeConformance({ createHost })` | 注册同一组宿主符合性测试，回调与用例见 [Tests](06-tests.md) |

`options` 包含宿主稳定的 `runtimeId`、`definition`、`binding`、已取得独占权的 Pi `storage`、`models`、`registry`，以及宿主提供的 `artifacts` 读写、`scripts` 执行和 `authorization` 检查；需要时传入受控 `env`。宿主先执行 `checkBinding` 与版本预检，再打开存储并交给 `openRuntime`。预算与能力上限来自绑定配置。宿主完成认证，把可信调用者身份交给授权检查；模型和工具权限在各自执行入口再次检查。

`RuntimeHandle` 暴露原生 `harness`、落实下文操作的 `service` 和 `close(context)`。打开成功后由该句柄管理存储关闭；打开失败时清理已接纳的存储句柄，宿主最后释放独占锁。新建与恢复共用入口，恢复完成预检后才启用 Pi 调度。宿主通过 `service` 接入公共行为，通过原生 Harness 和 Extension 实现业务能力。

## 定义解析与校验

加载一次 Squad，依次完成以下工作：

1. 在调用方授权的定义根目录内读取文件，识别 Squad、唯一主控角色、嵌套子角色、技能和工作流。
2. 解析 Markdown 的 YAML frontmatter 和正文。frontmatter 承载机器字段，正文承载提示词与工作说明。
3. 校验字段、标识符、模型配置、角色层级、工作流步骤图、引用和脚本入口，保留文件路径与字段位置供界面定位。
4. 将规范化角色、引用关系和原文件清单组成只读 `DefinitionBundle`，计算内容摘要。
5. 与运行端的模型目录、工具和 Extension 清单匹配，产生绑定诊断与最终 Agent 配置。

YAML 使用成熟解析库，结构校验复用 Pi 生态已有的 TypeBox。解析阶段按普通数据处理文件；Extension 的可执行代码由宿主显式安装。

定义路径使用根目录内的相对路径。读取、编辑和打包统一检查路径归属，首期接纳普通文件与真实目录；标识符大小写、重复键、未知字段、断开的引用和越界路径都形成明确错误。

诊断包含 `code`、`message`、`path`，有位置时包含 `line`、`field`。结构和能力错误阻止绑定；建议性诊断单独呈现。文件校验可以离线完成，凭据和沙箱可用性在运行端预检。

### Workflow 图与 Markdown

Workflow 的节点、连线、入口和坐标保存在同一 MD 的 frontmatter，步骤说明保存在按节点 ID 对应的正文段落，格式见 [Squads](05-squads.md)。Core 提供解析、校验、序列化和执行指导渲染，Dashboard 将这个普通数据结构映射为画布组件的数据。

- 节点 ID 在 Workflow 内唯一，引用 Squad 中已有的 Role；一个 Role 可以出现在多个步骤中。
- 入口、连线端点和正文段落必须对应有效节点，全部节点从入口可达；相同起终点的连线唯一，坐标为有限数值。
- 从入口节点解析 `entryRole`，从节点引用推导 `participants`。角色目录决定派发权限，连线说明交接与条件，能力检查沿用角色、Workflow 和宿主授权的交集。
- 保存时稳定排列节点与连线，保留正文内容及节点对应关系。图与源码往返转换保持定义语义，诊断可以定位到节点、连线或正文段落。

执行指导按入口、节点 ID、角色、步骤正文和连线说明稳定生成，并附上目标、输入输出与验收要求。回路表达模型复核与迭代的指导，执行和终止仍由 Pi、模型行为与宿主预算共同决定。坐标参与定义版本摘要，渲染给模型的说明只包含工作语义。

Core 的图结构属于可移植定义格式；React Flow 的组件、选中状态、视口和事件类型由 Dashboard 管理。

## 定义版本与绑定

### 公共数据

| 数据 | 核心内容 |
| --- | --- |
| `DefinitionBundle` | `schemaVersion`、`squadId`、`projectId`、角色树、技能、工作流、文件清单、`contentHash`、可用时的 `gitCommit` |
| `RuntimeScope` | `environmentId`、`squadId`、`harnessId`，共同定位一份已绑定的运行存储 |
| `ProjectBinding` | `projectId`、`RuntimeScope`、定义引用、环境微调、授权范围 |
| `RuntimeDescription` | `protocolVersion`、稳定的 `runtimeId`、`RuntimeScope`、绑定摘要、Pi 与宿主版本、模型目录、工具与扩展能力、可用操作 |
| `ConversationBinding` | `roleId`、定义摘要、实际配置摘要、可选 `workflowId`、用户可读标题 |
| `ArtifactRef` | `RuntimeScope`、不透明 `id`、名称、媒体类型、字节数、内容摘要，以及可选的来源会话与任务 |

`schemaVersion` 描述定义格式，`protocolVersion` 描述接入协议，`contentHash` 标识定义内容。三者分别演进。首期均只接受各自明确支持的版本。

内容摘要覆盖排序后的相对路径、文件字节和必要的文件模式，包括脚本及其资源。Git commit 表示来源；未提交的编辑通过内容摘要精确标识。运行端保存这份不可变文件快照，恢复时使用同一份内容。

`environmentId` 由宿主标识独立配置范围，`harnessId` 由宿主在创建存储时分配并保存，重启保持原值。这两个字段是 Frogie 的绑定身份；Conversation、Submission 与 Task 继续使用 Pi 原始 ID。Dashboard 的 Local／E2E 是宿主对环境的分类，集成项目按自己的方式组织环境。

### 生效方式

同一环境中的 Squad 与 Harness 一一对应。一个环境可以登记多个 Squad，每个 Squad 使用自己的 Harness 和存储。每个 Harness 绑定一份定义快照和一份环境配置；各会话记录采用的角色与实际配置。

Dashboard 保存文件后重新校验，用户再选择快照进行调试。定义编辑与已启动运行相互独立。首期验证新定义时建立新的调试环境，原环境保留原定义和运行数据，便于继续、恢复与比较。

环境微调限于模型、思考等级及收窄后的能力配置。角色提示词、技能、工作流和脚本的调整形成新的定义版本。界面同时展示定义值、环境微调和最终生效值。

创建会话时可以在环境允许范围内选择模型与思考等级；会话配置在其工作期间固定。调整后的配置用于新会话，已存在会话按保存的配置继续。

## 角色装配与会话

### Agent 配置

角色按以下次序装配：

1. 使用 Squad 默认的模型和思考等级，再应用角色字段与获准的环境微调。
2. 从宿主 `Models` 解析 `{ provider, modelId }`，按 Pi 的模型能力检查 `thinkingLevel`。
3. 将声明的 Extension 与 Tool 名称解析为已安装对象，向 Pi 传入明确的选择数组。
4. 组合 Squad 公共说明、当前角色正文和引用技能正文，形成稳定的 `instructions`；选择工作流时追加从步骤图与正文渲染的执行指导。
5. 保存角色绑定信息，并使用 Pi 的 `agent` 创建参数或事务内 `configure()` 完成配置。

装配后的说明附上目录派生的直接子角色 ID 与名称、获准脚本入口及产物引用方式，模型据此调用通用工具。

目录中的上级角色表示分工和派发关系。子角色使用自身定义和 Squad 默认值，拥有独立的提示词、模型和工具集合。技能首期按引用完整装载，资源与脚本通过受控工具访问。

自由发挥会话按角色目标工作；流程指导会话额外装载 Workflow 的步骤、交接和输出要求。每次输入包含本次目标与产物引用，由模型决定具体执行。必须成立的业务约束由工具和验收代码检查。

创建 Workflow 入口会话时校验角色与解析得到的 `entryRole` 一致。入口角色装载完整工作流指导，派发子会话接收具体任务，并在绑定中继承 Workflow ID 与能力上限。每个子角色仍使用自己的能力声明，恢复时从保存的绑定重新应用限制。

### 会话的创建者

| 入口 | Pi 操作 | 生命周期 |
| --- | --- | --- |
| 环境首次启动 | `harness.root()` | 创建或取得主控角色的根会话 |
| 用户开始新对话，或业务创建工作单元 | `harness.createConversation()` | 宿主拥有的 `ownerless` 会话，可跨多次输入继续使用 |
| 模型向下派发工作 | Tool 内事务创建 task-owned Conversation | 子会话的工作归派发 Tool Task 所有 |
| 业务需要独立后台协作 | 宿主 Extension 使用 Pi background Task | 由业务明确创建、投递和停止，按 Pi 的后台所有权运行 |

同一角色可以创建多个会话。会话 ID 由 Pi 生成，角色 ID 属于定义；界面分别展示定义树和实际会话树。

首期通用派发工具 `delegate` 承载前台协作。可派发目标来自当前角色的直接子角色。业务通过普通会话和原生 Extension 接入长期或后台工作，沿用相同观察协议。

### 前台派发

`delegate` 接收目标 `roleId`、任务 Markdown 与可选产物引用，返回子会话 ID、Submission ID、终态、实际答复和产物引用。

工具在 `api.commit()` 内先按 `api.taskId` 查找已拥有的子会话；存在时复用，不存在时创建并装配目标角色。子会话采用 `ownership: { kind: "task", taskId: api.taskId }`，输入的 `requestId` 从该派发任务身份稳定派生。

工具通过 `api.details()` 保存子会话关联，等待 Pi Submission 后读取真实 answer entry，再将结果交回父会话。派发登记为 `replay: "safe"`，其安全性由已保存的所有权和输入去重保证。父任务的失败与取消按 Pi 所有权向下传播。

每个 `delegate` Tool Task 对应一个子会话，重放该任务时复用原会话；新的工具调用产生新的 Task 和子会话，即使目标 Role 相同。同一轮多个派发可以由 Pi 并行执行。宿主限制活跃子工作数量和总请求预算，超出子工作限额的派发返回配额错误；父会话等待子会话时释放模型请求并发名额。

## 运行接入协议

### 最小操作集

| Service 操作 | 输入与结果 |
| --- | --- |
| `describe` | 返回 `RuntimeDescription`，包含身份、协议、绑定和当前授权 |
| `listConversations`、`getConversation` | 分页条件或 Conversation ID → Pi 记录、角色绑定与当前状态 |
| `listEntries` | Conversation ID、Pi 分页条件 → 原始 entries 与下一页游标 |
| `createConversation` | Role ID、可选 Workflow 与获准配置 → 新 Conversation ID 和绑定 |
| `submit` | Conversation ID、Pi Submission draft → 已持久接纳的 Submission ID |
| `observeConversation` | Conversation ID → Pi `ConversationWatch`，传输层按下文封装 |
| `getSubmission` | Submission ID → Pi 原始状态、已存在的 answer entry 或失败原因 |
| `cancel` | Conversation ID、可选的排队 Submission ID → Pi 取消结果 |
| `compact` | Conversation ID、可选保留要求 → 原生压缩 Task ID，按 Pi 状态观察完成 |
| `inspect` | 返回活跃任务图、`inspect()` 诊断与用量 |
| `storeInputArtifact` | Conversation ID、名称、媒体类型与有界内容 → 已授权的输入 `ArtifactRef` |
| `readArtifact` | `ArtifactRef.id` → 授权范围内的内容与摘要 |

各操作接收 `scope`、对应 `input`、可信调用者身份和 `context`。所有 Pi ID、分页游标与状态使用发布版本的原类型；JSON 传输保留其值。取消指定 Submission 时同时核对所属 Conversation；工具产物的写入由 `write_artifact` 使用同一产物存储完成。HTTP 中的产物内容统一用 `contentBase64` 字段承载，按解码后的实际字节执行大小与摘要检查。

操作、响应和观察事件携带 `RuntimeScope`，会话、输入、任务与产物按该范围验证归属。运行端在接纳请求时固定存储目标；界面切换后，已经接纳的工作仍属于原 Harness，新上下文重新读取自己的快照。错误统一携带稳定 `code`、可读原因、关联对象和可否重试，底层 Pi 的状态与原因保留在诊断中。

协议与传输分开：本地 Dashboard 使用同源 HTTP 请求和服务端推送，集成方可以将同样的操作映射到自己的接口与认证体系。公共包提供数据和处理能力，业务项目负责网络服务。

### 观察帧与错误

HTTP 观察帧使用 `{ type, scope, conversationId, value }`：`type` 为 `snapshot` 或 `update`，`value` 为 Pi 的已提交 `ConversationView`。连接先发送 watch 取得的完整值，再按同一个 watch 的顺序发送完整更新值，客户端据此替换投影。断开或缓冲溢出后重新取得快照，观察数据的读取与持续订阅来自同一次 watch 获取。

`RuntimeError` 包含 `code`、`message`、`retryable` 及可用时的 `scope`、对象 ID 和字段诊断。首期公共错误分类如下：

| `code` | 含义 |
| --- | --- |
| `invalid_definition`、`invalid_request` | 定义校验失败或请求字段无效 |
| `unsupported_version` | 定义格式、接入协议或存储运行版本不受当前实现支持 |
| `binding_mismatch`、`capability_missing` | 定义或作用域与绑定不符，或模型、扩展、沙箱等必需能力缺失 |
| `unauthenticated`、`forbidden`、`not_found` | 身份无效、动作未授权，或授权范围内对象不存在 |
| `conversation_busy`、`budget_exhausted` | Pi 拒绝 busy 投递，或宿主额度、并发与期限限制被触发 |
| `storage_in_use`、`runtime_unavailable` | 存储已有所有者，或宿主当前不可用 |

临时连接故障及可解除的 busy、并发限制可标记重试；授权、字段、版本和已耗尽额度需要先处理相应条件。写请求按原身份与去重约定处理。Pi 执行失败保留原始状态及原因，与协议错误分别呈现。宿主预检在打开存储前报告版本实际值和支持值，待采用匹配实现后再恢复。

### 输入、等待与取消

- 输入端为一次意图分配 `requestId`，网络重试复用同一 ID 和内容。Pi 按会话去重，接纳成功后才确认投递。
- `whenBusy` 使用 Pi 的 `followUp`、`steer`、`reject`。普通 Chat 默认 `followUp`；界面明确区分排队输入与插话。
- 被动记录使用 `type: "write"`，其含义是追加记录；需要模型工作的输入使用 `type: "input"`。
- 输入状态沿用 `queued`、`placed`、`done`、`unanswered`。Run 可以接收多份输入，以 `pi.live.run.taskId` 及关联 Submission 定位。
- 取消等待只结束当前观察者的等待。停止执行显式调用 `Submission.abort()` 或 `Conversation.abort()`；后台工作使用 Pi 对应的取消选项。

### 权限与扩展

用户侧按动作授权定义读取、定义编辑、运行观察、输入投递、取消和评估启动，并限定项目与环境。单用户本地环境由启动者获得这些能力，集成项目映射自己的身份系统。

Agent 工具权限取角色声明、工作流限制与宿主授权的交集。运行端在绑定时确认必需能力，并统一包裹登记的工具入口，依据已保存角色绑定检查身份、资源和操作。检查覆盖首次执行与恢复进入，权限收回在下一次受控操作时生效。

权限收回后，新输入接纳、新模型请求与每次工具进入使用最新授权。已经开始的调用按原超时与取消规则结束；需要终止在途工作时，宿主另行调用 Pi 取消并结束相应沙箱。历史记录继续按观察和产物读取权限提供。

Extension 由宿主代码安装并记录版本，MD 只引用它的名称。首期校验工具名称的唯一性，明确工具参数、重放策略和输出范围。宿主 Extension 属于受信代码；Agent 可调用的脚本属于沙箱工作负载。

通用工具随公共接入提供：

| Tool | 公共语义 | 宿主提供 |
| --- | --- | --- |
| `delegate` | 创建和等待已定义的子角色 | Harness、能力授权与运行预算 |
| `read_artifact` | 读取获准的输入或输出引用 | 产物存储和访问检查 |
| `write_artifact` | 保存 Markdown 等结果并返回不可变引用 | 内容存储、大小上限与提交回执 |
| `run_script` | 按 Skill 与 Script 标识执行已声明入口 | 沙箱执行器、资源限制与结果收集 |

脚本调用使用结构化输入与输出，程序、入口和解释器来自已绑定的定义与宿主白名单。业务工具继续通过 Pi `defineTool()` 和 Extension 接入。工具回传业务结果与 `ArtifactRef`，界面展示通用信息，业务 UI 可以增加自己的呈现。

Pi 的 `replay` 是 Tool 注册属性。首期 `run_script` 登记为 `replay: "safe"`，接纳经宿主确认可安全重放的脚本；其准入和授权检查在每次进入工具时执行。默认 unsafe 的外部副作用通过独立业务 Tool 表达，由该 Tool 定义重放语义。

脚本执行依次核对绑定定义中的 `replay: safe` 声明、宿主对该版本入口的启用，以及当前角色、Workflow 与宿主的权限交集。三项同时满足后才读取可复用回执或启动沙箱，重放沿用同一检查顺序。

`read_artifact` 读取不可变内容，`write_artifact` 通过宿主的稳定操作键和回执实现幂等，两者均登记为安全重放。用户提交的输入产物由宿主保存并授予当前会话访问权，来源类型与 Agent 生成产物分别记录。

## 持久化与恢复

### 保存位置

Pi 保存会话、输入、历史、Task 检查点和原生 Documents。Core 增加接入所需的少量 Pi Documents：Session 范围的 `frogie.binding` 保存 `RuntimeScope` 和定义版本，`frogie.budget` 保存已授权额度、计数与截止点；Conversation 范围的 `frogie.role` 保存角色、工作流与配置关联。

这些记录与对应配置通过 Pi commit 一起写入；定义文件快照、产物和业务副作用回执保存在宿主的运行目录。会话历史以 Pi 存储为准，Dashboard 按需读取。

本地参考实现使用 `openNodeSqliteStorage()`。每份存储只由一个宿主进程持有，运行端在打开前取得独占所有权。进程崩溃恢复依据 Pi SQLite 的 WAL 提交语义；机器掉电与磁盘损坏另属存储运维范围。

### 恢复顺序

1. 确认运行目录身份并取得独占权，读取已绑定的定义与环境配置。
2. 校验快照摘要、Pi 版本、宿主版本、Extension 实现和沙箱能力。
3. 重建 `Models`、Registry、工具和执行环境，再打开原存储。
4. 使用 `inspect()` 核对未完成工作，向观察者提供当前快照。
5. 在授权和运行预算满足后调用 `resume()`，继续原会话与原 Submission。

Registry 中的函数、凭据和外部环境由宿主重新提供。缺少定义或实现时返回可定位诊断，待条件恢复再启动调度。恢复入口在预检完成前保持只读；提交、等待等会启动 Pi 调度的调用同样受该入口控制。

`replay: "safe"` 表示工具实现能够安全重复执行。业务副作用使用稳定操作键和幂等回执处理“外部写入已完成、Pi 结果尚未提交”的窗口。其余工具保持 Pi 默认的中断结果，由后续工作决定处理方式。

输入去重、工具重放和业务副作用分别验证。模型请求恢复可能重发，用量采用 Pi 已回报的记录；中断且未回报的用量保留为未知，模型账单以提供方计费为准。

## 观察、诊断与资源边界

### 上下文压缩

上下文压缩使用 Pi 原生 `CompactionPolicy`：自动阈值通过 `enabled`、`reserveTokens`、`keepRecentTokens` 和 `backgroundTokens` 配置，手动操作调用 Conversation 的 `compact()`。策略作为宿主绑定配置持久保存，并按实际模型窗口校验。

压缩结果通过 Pi Task、摘要 entry 与上下文状态观察；完成后模型使用新的上下文，原始历史仍由 Pi 保存。重启恢复沿用已提交摘要与会话身份，压缩请求同样经过模型权限、并发、预算和用量记录。Dashboard 展示压缩状态及失败原因。

### 运行观察

会话观察以 `watch()` 或 `viewState()` 的已提交状态为依据。每次连接先获取快照；断线、慢消费者或缓冲溢出后用新快照替换本地投影。传输层只承担当前状态同步。

活跃 Task 使用 `taskGraph()`，阻塞原因使用 `inspect()`；已结束任务和会话关系从 Pi 保存的记录、entries 与工具 details 读取。UI 分别显示连接状态、Pi 执行状态和业务验收结果。

每次运行可追溯到环境、定义摘要、角色、实际模型与思考等级、Conversation、Submission、Task 和产物。Pi 提供的 token、费用和耗时按原值展示，缺失价格或计量信息标为未知。

宿主统一限制模型请求并发、请求次数、运行期限、工具超时和产物大小。首期按 Harness 绑定分配预算，覆盖其中的全部会话与派发，发起调用前持久预扣次数，恢复沿用已消耗预算和原截止点。追加额度由宿主授权并记录，已有消耗保留；每次评估使用独立环境与预算。

模型请求计数在 `Models` 接入处执行，包含子会话、压缩和重试；提供方内部自动重试关闭，重试由 Pi 的持久化机制驱动。工具计数包含恢复进入，回执单独记录实际外部执行次数。预算耗尽由宿主控制器发起 Pi 取消并返回诊断。

### 预算的并发与中断语义

- 取得模型并发名额后，宿主在同一 Pi Session commit 中读取并校验剩余额度与截止点，再递增 `frogie.budget`。并发请求在这条提交线上依次准入，预扣失败时请求保持未发送并释放名额。
- 每次底层调用只经过一处计数入口；`completeSimple` 对 stream 的内部复用计为同一次调用。恢复或重试实际发起的新请求重新预扣，即使属于同一个 Pi Task。
- 预扣提交成功后才调用模型。若在提交与发送之间中断，原预扣按已占用保留；重启沿用已保存计数，新尝试另行计数。请求预算采用保守准入计数，提供方已确认用量和未知费用分别报告。
- 启动、读取快照和检查恢复条件只读取预算。模型等待并发名额期间响应取消和期限，到期释放等待；父会话等待子任务时继续沿用既有并发规则。

工具进入额度也通过同一 Session 提交准入，进入次数与实际脚本执行次数分别记录，安全重放读取回执也消耗一次工具进入额度。恢复沿用已持久化的额度、消耗与截止点，授权追加同样进入持久化记录。

脚本通过宿主提供的本地 OS 沙箱执行。模型凭据留在宿主，脚本只获得明确输入、只读定义资源和自身临时目录。Pi 的 `NodeExecutionEnv` 提供文件与命令能力；实际隔离边界由承载它或脚本执行器的宿主建立。

Dashboard 参考宿主默认安装 `frogie` 的四个通用工具，按角色显式选择，脚本能力由独立沙箱执行器提供。它的 Harness `env` 保持未配置，普通宿主文件与命令能力留在受信服务代码。集成方可以安装业务 Extension；需要文件或命令工具时，同时提供满足隔离要求的 ExecutionEnv 与对应授权。

## MVP 完成条件

- 同一组公共函数可被 Dashboard 调试端和独立最小宿主加载，业务工具通过 Extension 提供。
- 一份 MD Squad 能解析、校验、冻结并装配成多个不同角色的 Pi Conversation。
- 前台派发、排队输入、取消、重连和 SQLite 进程恢复保持 Pi 原始身份与状态。
- 权限和脚本隔离由运行端执行，Markdown、工具结果和界面状态能够追溯到同一份定义。
- 确定性测试验证协议边界，真实模型评估验证协作、工具、产物与恢复的完整路径。

## 接口依据

- [Pi Durable 1.1.0 README](https://unpkg.com/@earendil-works/pi-durable@1.1.0/README.md)
- [Pi Durable 1.1.0 Harness 类型](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/types.d.ts)
- [Pi Durable 1.1.0 存储与任务类型](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/types.d.ts)
- [Pi Durable 1.1.0 变更记录](https://unpkg.com/@earendil-works/pi-durable@1.1.0/CHANGELOG.md)
