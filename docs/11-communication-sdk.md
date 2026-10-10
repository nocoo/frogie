# 11 - 通信 SDK

## 目标与边界

`packages/sdk/` 提供公开 npm 通信包，使业务项目像使用自己的服务一样查询 Agent、提交工作、实时观察执行、读取历史和接收结果。执行和历史的权威来源在本机 Frogie，网络断开、数据陈旧和业务写回状态通过接口明确表达。

SDK 只包含协议、数据校验、客户端、连接适配、状态投影及符合性测试。Pi、私有 Core、Squad、Prompt、Skills、Scripts 和秘密由本机维护。包名在发布前验证 npm scope 的归属和可用性，文档中的 `@frogie/sdk` 表示目标入口。

## 通信结构

```text
浏览器 -> 业务项目 HTTPS API / WS 或 SSE
                     |
               SDK Gateway
                     ^
                     | 认证 WSS，双向传输
                     | 本机主动建立
               Frogie Connector
                     |
               Daemon -> Core -> Pi Harness
                     ^
                     | 本地管理接口
               Frogie Dashboard
```

本机主动连接固定远端 origin 的 WSS 入口，连接保持后双方均可发送请求与响应。本地管理接口仅监听 loopback。各业务项目部署自己的 Gateway，本机分别管理这些连接。

Cloudflare 集成采用 Worker 认证入口和 Durable Object WebSocket 协调，优先复用已有业务数据库存放投递记录。DO 按已认证的项目与远端环境路由，使用 Hibernation API，重建时从存储和连接附件恢复协调信息。其他平台可以实现同一 Gateway 契约。

浏览器使用业务项目原有身份访问同源 API；Gateway 校验后代理到 Frogie。设备凭据始终留在两端服务代码中，浏览器不直接连接本机。

## 双向认证与绑定

### 配对

1. 项目拥有者登录业务管理端，创建短时有效、一次性的配对会话。会话绑定项目、远端环境、预期能力和发起人，服务端保存凭证摘要并限制尝试次数。
2. 用户在本机 Dashboard 输入远端地址和配对凭证，核对项目身份，选择本地 Squad／Harness 及能力范围。
3. Connector 通过该 origin 的 HTTPS 交换凭证；Gateway 原子消费配对会话，建立设备与项目绑定，返回设备凭据及双方确认的绑定信息。
4. 本机保存凭据引用、固定 origin、预期项目与环境；后续 WSS 握手使用设备凭据，双方再次核对绑定、协议和能力。

云端身份由固定 origin 的 TLS 证书及用户确认的配对绑定验证；本机身份由 Gateway 验证项目专属设备凭据。握手返回的项目与环境必须匹配已保存绑定，TLS、应用绑定与权限各自承担清晰职责。

正式连接使用 HTTPS／WSS，验证证书并拒绝跨 origin 重定向。测试只使用启动器明确登记的 loopback 来源与虚构凭据。配对是显式授权，网络中收到的地址和工具内容不会改变本机登记。

### 权限与凭据生命周期

绑定限定 `projectId`、远端环境、设备、`RuntimeScope`、允许的操作、业务资源和可导出的观察字段。权限分成两方向：远端可请求的 Agent 能力，以及 Frogie 可调用的远端业务能力。

Gateway 将用户认证结果映射成可信调用上下文，包括主体、获准资源和审批依据。本机同时检查设备绑定与本地政策。远端通过认证也只取得该连接范围，本机管理权限保持独立。

会话绑定单独记录来源、可见主体与业务资源范围。本地新会话默认仅本地可见，分享到项目是显式授权；远端创建的会话绑定对应用户和资源，子会话、历史、工具结果与产物继承收窄后的可见范围。主控 Role 可以用于多个入口会话，连接授权不自动开放该 Harness 的全部历史。

列表、全局计数、任务图与历史检索在应用可见范围后生成，私有会话不会通过汇总数量或关联字段被附带导出。

每个 Conversation 固定执行授权域，包括来源、执行主体、资源范围和能力上限。`submit`、`followUp` 和 `steer` 只能进入相同执行域；另一执行域创建同 Role 的新会话。分享观察权限独立于执行授权，授权扩大通过新会话生效，权限收回在每次准入与副作用入口重新检查。

Gateway 对查询、事件投递、缓存读取与文件下载持续执行当前授权。订阅期间权限撤销时结束对应订阅，清除不可继续使用的缓存与待发帧；已导出的业务数据按项目自己的保留规则管理。

设备秘密本地以受限文件权限保存，服务端保存可验证的摘要和撤销状态。连接具有短时租约，重连或续租重新校验凭据和权限；授权撤销使现有租约失效，并在每次敏感操作进入时生效。轮换通过拥有者批准的新凭据替换原凭据，已有执行保持原请求身份。

断开连接只改变在线能力；撤销授权同时阻止该连接的新提交和业务操作。已由其接纳的工作按保存的取消政策处理，未来副作用入口再次检查授权。本地用户自己的会话保持独立。

从本地 Dashboard 发起远端业务操作时，Gateway 使用配对时拥有者明确授予的设备服务身份和资源范围；来自网站的工作使用原用户授权与设备能力的交集。两类来源分别记录，人工审批仍由项目核对，设备身份不隐式代替审批者。

## 连接状态

| 状态 | 含义与界面行为 |
| --- | --- |
| `unpaired` | 尚未建立授权绑定，展示配对入口 |
| `connecting` | 正在连接或等待重试，展示最近错误和下次重试信息 |
| `online` | 身份、协议和连接租约有效；具体能力另看 Harness 与工具状态 |
| `offline` | 当前没有有效通道，展示最后确认的在线信息 |
| `unauthorized` | 凭据失效、撤销或授权不足，等待拥有者处理 |
| `incompatible` | 协议或必需能力不匹配，展示实际与支持版本 |

心跳和租约判断在线，重连采用有上限的指数退避与抖动。认证或协议错误等待配置处理，普通网络故障自动重连。远端断线不推断本机任务已停止。

状态响应同时包含连接信息、数据新鲜度、各 Harness 的执行可用性和远端业务能力。业务站点基本功能独立于此状态；Agent 操作可明确返回 `remote_unavailable`。

## 数据与高级接口

以下是服务契约，方法名以发布类型为准。本地 Dashboard 使用同一运行投影，额外调用仅本地开放的项目、定义、模型与凭据管理接口。

| 能力组 | 操作 | 主要返回内容 |
| --- | --- | --- |
| 发现与在线 | `describe`、`getConnection`、`observeConnection`、`listSquads` | 支持版本、权限、连接状态、授权 Squad 摘要与能力 |
| 全景 | `getOverview`、`observeOverview` | 各 Harness 的活跃会话与任务数、当前动作、阻塞原因和用量摘要 |
| 会话 | `listConversations`、`getConversation`、`createConversation` | Role、父子关联、生效模型、Workflow 及 Pi 身份 |
| 历史 | `listEntries`、`searchHistory`、`getContextSummary` | 分页历史、受限关键词检索、已保存摘要及来源引用 |
| 输入与控制 | `submit`、`getSubmission`、`cancel`、`compact` | 接纳回执、Pi Submission 或 Task 身份及原生状态 |
| 执行细节 | `observeConversation`、`getTask`、`observeTaskGraph`、`inspect` | 消息、模型进展、父子所有权、工具调用与结果、错误和等待原因 |
| 产物 | `listArtifacts`、`getArtifact`、`prepareArtifactTransfer` | 授权产物引用、来源、摘要及有期限的传输许可 |
| 业务上下文 | `context.read` | 资源身份、版本、获取时间、有界内容及内容摘要 |
| 业务效果 | `operation.execute`、`operation.get`、`observeOperation` | 稳定操作 ID、业务版本、审批、交付状态及最终回执 |

历史检索首期采用本地分页与明确关键词，限定项目和会话范围。总结是一次显式提交给已授权角色的工作，读取历史的接口本身不触发模型。`getContextSummary` 返回已经保存的摘要与上下文状态。

SDK 定义可序列化 DTO，自带运行时校验，不引用 Pi 的运行或类型包。Core 映射发布版本的原生 ID、状态与语义；来源 ID 保持值和类型的可逆编码，`runTaskId` 指向 Pi Run Task，传输 `requestId` 与业务 `operationId` 分别关联。

网络 `submit` 接收用户输入和明确授权的业务上下文；角色与模型选择限于绑定允许的配置。Pi 被动 `write`、任意 Entry／Document、工具结果和内部配置写入只由受信本机适配器生成。远端业务回执经过操作关联与 schema 校验后，由适配器写入运行记录。

业务状态使用独立的带命名空间数据载荷和资源引用。SDK 校验通用封套与业务方声明的 schema，业务页面可以把同一工具调用显示为自己的业务动作；Frogie 显示角色、工具与执行链。

公开接口通过授权投影提供必要信息：默认不传完整 Prompt、Skill 正文、模型秘密、主机路径或任意 Pi Document。模型公开输出、可见工具参数和结果按字段脱敏；SDK 的“完整执行细节”指获准的执行证据。模型内部推理不是必需交付字段。

## 查询与实时观察

查询、命令和订阅共用版本化消息封套：`protocolVersion`、`type`、`messageId`、`connectionGeneration`、绑定身份、`scope`、关联 ID 和 `payload`。接收方从已认证连接确定身份，不以消息自报字段授予访问权。

订阅按主题及作用域创建，返回 `subscriptionId`、`streamEpoch`、`sequence` 和初始快照。随后发送有序更新，明确完整替换或基于某个修订的增量；同一修订最多应用一次。快照与后续订阅在同一数据源边界衔接，避免订阅期间漏事件。

Core 以 Pi `Conversation.watch()`、`watchTaskGraph()`、entries 和已提交 Documents 构造投影。模型生成中的内容只按 Pi 实际可观察能力提供；持久提交和临时显示片段分别标识，终态以已提交记录及真实业务回执为准。历史通过分页读取，实时帧只发送有界活动窗口和摘要。

重连携带已有 epoch 和位置，仍在有界保留窗口内时续传，否则返回 `resync_required` 并重新取得快照。慢消费者或缓冲溢出结束相应订阅并要求重同步，其他项目继续工作。浏览器卸载或切换只释放订阅，不取消执行。

云端可以保存有限期的展示缓存和回执摘要，标明来源修订与 `stale`。daemon 离线时，缓存不冒充实时状态；历史未缓存部分返回不可用。恢复订阅后以本机快照重新对齐，云端缓存不参与 Pi 恢复。

## 可靠投递与幂等

查询和订阅是可重建操作；命令和业务写入具有稳定意图身份。网络采用至少一次投递，效果依赖幂等、版本检查及持久回执。

`createConversation`、`submit`、`compact`、取消及其他状态变更都要求幂等请求身份，绑定操作名、作用域、调用主体和规范化输入摘要。重试创建或压缩返回原对象关联，避免 ACK 丢失后额外创建会话或重复消耗模型预算。

- 用户意图使用 `requestId`，绑定作用域和输入摘要。重复请求返回原关联，不同内容复用 ID 返回 `idempotency_conflict`。
- Gateway 先持久保存请求再确认云端接纳；Frogie 把输入提交到 Pi 并保存关联后返回执行接纳回执。云端接纳、Pi 接纳、模型完成、业务交付分别展示。
- `acceptedByGateway`、`acceptedByRuntime` 属于投递状态；Pi 的 `queued`、`placed`、`done`、`unanswered` 原样保留。`waiting_for_remote` 等业务等待原因附着于操作，不替换 Pi 状态。
- 本地工具先提交稳定操作意图，再发送业务请求。Gateway 在业务事务内检查操作 ID、输入摘要、授权和资源版本，持久保存效果及回执；ACK 在这些数据落地后发送。
- 已完成请求保留去重回执或墓碑到其过期与重试窗口结束；过期原请求返回明确终态，不作为新工作执行。

断线前已提交的安全业务操作可以保留在 outbox，重连后核对原授权、期限、取消状态和资源版本再继续。不确定是否已应用时先查询同一操作回执；非幂等第三方效果缺少查询能力时标为 `outcome_unknown`，交由业务恢复或人工确认。

Pi 工具的重放声明与网络重试分开：有稳定操作 ID、可查询回执和幂等提交的业务适配器才登记为 `replay: safe`，恢复进入时先对账原操作。其余工具保留 Pi 默认中断语义，恢复后由明确的新意图处理。

取消是持久意图：未交付请求先标取消再停止投递；已进入 Pi 的请求通过原身份执行取消，回执标明是否已接纳或已终态。在取消与业务提交竞争时，已成功的业务效果保持事实状态，后续补偿由业务方明确实现。

取消排队输入调用 Pi `abortSubmission`，返回 `aborted`、`already_placed`、`settled` 或 `not_found`。`already_placed` 表示输入已进入运行，界面另行提供“停止会话工作”，明确展示影响的已接纳输入、子任务和排队输入，取得对应会话控制权限后调用 `Conversation.abort()`；后台工作按 Pi 选项显式选择。一个已合并 Run 的单份输入不能被描述成已独立撤回。

默认离线提交立即返回不可用。业务方可显式启用有界排队，必须提供截止点和取消入口；界面显示等待连接，送达前重新授权。浏览器重试复用原意图，不通过超时自动创建新任务。

同一项目环境与 Harness 同时只有一个有效执行连接归属。Gateway 分配连接 generation 和租约，敏感写入校验最新 generation，旧连接不能提交新效果。重连接管的是原设备与原数据身份；切换到另一台没有原 SQLite 的机器属于明确的数据恢复操作。

## 上下文与业务工具

业务项目注册工具名、输入输出 schema、权限、资源范围、超时和幂等策略。Frogie 的已安装适配器把其映射为 Pi Tool，远端只提供经过登记和本机批准的结构化能力。

`context.read` 返回带资源版本的内容，本机将本次实际输入保存到会话或关联产物，保证重启可以解释既有工作。获取最新资料是新的有权读取动作；重放既有任务沿用原快照，业务写回通过预期版本检查防止覆盖后来编辑。

工具请求关联 `RuntimeScope`、Conversation、Run Task、Tool Task、已进入该执行阶段的 Submission／请求集合和可选父业务操作。这些关联由宿主从 Pi 提交边界持久记录，工具本身不假设只有一个输入来源。需要单一业务目标的操作另带稳定的业务意图 ID，并校验它属于当前执行域及请求集合；阶段间插话不会把已有操作改挂到新请求。

同步工具返回终态回执；异步工具返回操作 ID，继续提供可恢复的状态查询及终态订阅。父业务请求只有在其必需子操作取得终态证据后才报告交付完成。授权与关联在恢复时从持久记录取得，不依赖进程内最近一次输入。

远端不可用时，普通业务读取和未接纳写入返回结构化错误，本地聊天与调试继续。Agent 可以形成并保存本地草稿；重新写回使用明确业务操作和最新版本条件。云端操作的事实与本地模型回答分别保存。

## 文件、限额与错误

WebSocket 传递有界 JSON、状态和文件引用。大文件通过项目授权的 HTTPS 上传／下载传输，许可限定对象、方法、大小、摘要与期限；密钥和原始文件路径不进入消息。Agent 输出音频等产物后，以业务回执确认项目已保存。

首版共享默认限制为 JSON 帧 256 KiB、单订阅最多 128 个待确认帧且总量不超过 2 MiB、查询默认 50 条且最多 200 条、普通查询 30 秒超时。双方可以协商更小限制；大输出转成产物引用。Agent 执行不受 HTTP 等待期限替代，使用单独的持久执行预算。

错误包含 `code`、可读原因、`retryable`、关联 ID 和可安全导出的诊断。公共分类包括 `unauthenticated`、`forbidden`、`unsupported_version`、`remote_unavailable`、`runtime_unavailable`、`capability_unavailable`、`stale_resource`、`idempotency_conflict`、`resync_required`、`expired` 与 `outcome_unknown`。认证、资源冲突和结果不明需要对应处理，普通网络重试保持原身份。

## 包入口与交付

| 目标入口 | 内容与依赖边界 |
| --- | --- |
| `@frogie/sdk` | DTO、schema、无 UI 依赖的查询与订阅客户端 |
| `@frogie/sdk/server` | Gateway 路由、认证接入点、投递存储契约和业务工具登记 |
| `@frogie/sdk/cloudflare` | Worker／Durable Object 适配，平台依赖限定在该入口 |
| `@frogie/sdk/testing` | 虚构凭据、协议材料和 Gateway／客户端符合性测试 |

首期提供无头客户端，业务项目通过自己的 Model／ViewModel 组合界面。Dashboard 和业务 UI 共享状态含义，不共享必须使用的页面布局。平台适配只围绕已验证的 Cloudflare 接入实现，其他平台按同一契约扩展。

发布前以真实 `npm pack` 产物运行 Node、浏览器构建和 Worker 消费测试，检查 exports、声明文件、source map、传递依赖及文件清单。仅 SDK 列入发布白名单；私有定义、Core、Pi、内部 fixture、密钥及本机路径不进入产物。发布后重新安装确切版本并验证完整性，集成方使用精确版本与锁文件。

`protocolVersion` 与 npm 版本、定义格式、Pi 版本分别管理。双方只接受明确支持的协议和能力集；不匹配时诊断并升级。首版通过一个最小示例 Gateway 和 SDK 符合性测试锁定契约，再由 his.fm 和另一类业务验证抽象边界。

## 验证依据

协议验证按 [Tests](06-tests.md) 组织，业务接入见 [项目集成](09-project-integration.md)，阶段顺序见 [MVP 实施](08-mvp-implementation.md)。

- [Cloudflare WebSocket 与 Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Pi Durable 1.1.0 Harness 类型](https://unpkg.com/@earendil-works/pi-durable@1.1.0/dist/harness/types.d.ts)
