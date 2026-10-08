# 04 - Dashboard

## 产品目标

`apps/dashboard/` 是本机启动的设计台、观察台和调试运行端。用户可以完成“创建 Squad → 整理角色与技能 → 拖拽设计 Workflow → 校验并绑定 → 真实对话与派发 → 查看产物 → 重启恢复 → 运行评估”的完整过程。

界面展示通用 Squad、Role、Workflow 和 Pi 运行对象，业务内容来自加载的定义。公共接入遵循 [Core](03-core.md)，目录和开发方式遵循 [仓库结构与开发约定](02-repository-and-workflow.md)。

## 应用组成与 MVVM

首期采用 React 19、Vite 和 TypeScript 构建界面，Node ESM 承载 CLI、同源服务与本地调试宿主。界面与服务通过 Core 协议通信。

| 位置 | 职责 |
| --- | --- |
| `src/models/` | 定义、环境与绑定、会话、产物和评估数据；固定上下文的协议客户端与文件服务 |
| `src/viewmodels/` | 全局 Squad／Harness 选择、环境切换、文件与图草稿、校验、投递重试和观察连接 |
| `src/views/` | Basalt 组件组合、React Flow 画布、布局、焦点、滚动和键盘交互 |
| `src/server/` | 本地认证、受控文件编辑、HTTP 与状态推送、运行端管理 |
| `src/runtime/` | 引用 Core 的 Harness 宿主、SQLite、产物、脚本沙箱和预检 |
| `src/cli.ts` | 解析启动参数、选择工作区与数据目录、启动和关闭服务 |

ViewModel 接收服务依赖，以普通 TypeScript 状态转换和 React 绑定组织。角色校验、权限、生效配置与 Pi 状态解析复用 Core。浏览器只持有显示数据和编辑草稿，文件写入、工具执行及授权在服务端完成。

## 启动与访问

规划的用户入口为 `frogie dashboard --workspace <path> --mode local|e2e|prod`。模式参数可省略，CLI 选择工作区，输出 `127.0.0.1` 本地 URL；端口冲突时返回明确错误或使用用户指定端口。服务只绑定 loopback 地址。

首次打开通过一次性启动凭据建立会话，凭据放在 URL fragment，浏览器交换后清除；服务端颁发短期 HttpOnly、SameSite 会话 Cookie。模型凭据只由宿主配置读取，界面显示已配置的连接名称与可用状态。

服务验证 Host、Origin 和请求身份，写操作具有 CSRF 防护，跨源访问按明确本地来源限制。文件操作限定 CLI 授权的工作区；运行连接限定已登记的本地运行端。请求日志和错误输出保留诊断信息并过滤凭据。

首期本地启动者拥有工作区的管理与调试权限。页面动作仍使用 Core 的权限标识，便于集成项目沿用自己的身份与授权系统。

关闭浏览器只解除观察。CLI 管理自己启动的调试子进程，关闭服务时有界地关闭这些 Harness 和脚本工作负载；Local／Prod 保留已提交状态供下次恢复，临时 E2E 按其归属释放。独立运行端的进程与存储由其集成项目管理。

### 模型连接

连接配置默认读取本机私有文件 `~/.config/frogie/connections.json`，也可由 CLI 的 `--connections <path>` 指定。模型连接包含以下字段：

| 字段 | 含义 |
| --- | --- |
| `id`、`name` | 稳定连接 ID 与界面名称 |
| `provider`、可选 `baseUrl` | Pi provider 标识与该适配器支持的服务地址 |
| `modelIds` | 此连接获准使用的模型 ID |
| `credentialRef` | 所需凭据的环境变量引用 `{ env: "VARIABLE_NAME" }`；公开的无认证服务可省略 |
| `modes` | 连接获准使用的模式，由绑定时的环境授权进一步收窄 |

每份 Harness 绑定按 provider 选择连接 ID，使用独立的 Pi `Models` 实例装载对应适配器。同一 provider 在该 Harness 内解析到一个连接，不同环境可选择不同连接。模型目录、上下文能力和思考等级沿用 Pi AI 的模型元数据；绑定时检查模型许可、适配器、所需凭据与能力，启动时展示连接可用性诊断。

绑定只保存连接 ID 与模型选择，MD 保持可移植；浏览器只接收名称、获准模型和可用状态。凭据值由宿主解析并按白名单传入自己的运行进程，日志、定义快照与产物使用脱敏数据。E2E 从本次隔离目录读取虚构连接配置，配置缺失即报告错误。

### 独立本地运行端接入

集成项目可以自行运行 Harness，并在同一私有配置中登记运行端连接：稳定 `id`、loopback `endpoint`、预期 `runtimeId`、模式、获准的 `RuntimeScope` 与操作集合，以及认证令牌的 `credentialRef`。运行端持久保存自己的 `runtimeId`，将令牌映射为可信身份和授权范围。

Dashboard 服务用 `Authorization: Bearer <token>` 连接固定 endpoint，核对 `describe` 返回的身份、协议、作用域、定义摘要和能力。外部接口使用 `POST /operations/<operation>`，请求体为 `{ scope, input }`，普通结果为 `{ scope, value }`，错误为 `{ error: RuntimeError }`；`observeConversation` 在同一入口返回包含 Core 观察帧的 SSE 流。网络连接保持在登记的 loopback origin，重定向作为连接错误处理。集成方可以在自己的业务接口之外提供这一小组适配入口。

浏览器继续访问 Dashboard 的同源服务，由其代理已获准操作；运行端令牌留在服务端。外部绑定进入相同的 Squad／Harness 切换器，模式、实例和作用域检查保持一致；相同作用域对应不同运行端身份时登记失败。独立运行端保存自己的 SQLite、历史与产物，Dashboard 通过协议观察、Chat 和取消工作，进程启动与存储维护由集成项目负责。自动 E2E 只登记本次测试创建的运行端。

## Basalt 基线与视觉

### 发布包

首期锁定已核实的 npm 稳定版 `@nocoo/basalt@2.2.0`，采用 `@nocoo/basalt/styles/standalone`。版本依据为 npm 镜像的 `latest`、独立 CDN 元数据及相同版本发布产物。

本地 `../basalt` 用于理解设计体系，组件能力以 `2.2.0` 产物内的 `ai/registry.json`、类型声明与 `ai/INTEGRATION.md` 为准。布局、表单、列表和聊天展示使用该版本公开组件。

Workflow 专业画布采用已核实的稳定版 `@xyflow/react@12.12.0`，其 React peer 范围支持 React 19。React Flow 提供节点拖动、连线、坐标变换与缩放；Basalt 提供节点内容、属性编辑、菜单和动作控件。

### 应用骨架

组合顺序采用 Basalt 的 `AppShell`、`Sidebar`、`AppMain`、`AppSkipLink`、`AppHeader` 和一个 `ContentIsland`。内容页以 `PageHeader` 开始，分区使用 `SectionRule`，成组内容使用 `LayerCard`。

侧栏顶部显示现有 Frogie 标志、名称与构建版本，紧接全局 Squad／Harness 切换器和 Local／E2E／Prod 选择，下方导航围绕当前 Squad 展开。Header 显示真实上级路径、当前页面、环境标识、连接状态、GitHub 入口和末位主题切换。页面操作位于内容标题行。

使用 `ThemeProvider`、`AccentProvider`、`LinkProvider`、`TooltipProvider` 和单个全局 `Toaster`。默认强调色采用 Basalt 的 `green`，保留 Frogie 现有图稿，使用合适尺寸的衍生资产。

字体、控件尺寸、圆角、间距和表面遵循发布版 Design Tokens。内容通过亮度层级区分，状态同时提供文字与图标。界面以紧凑的横向信息组织为主，浅色与深色主题均可使用。

### 控件选择

| 场景 | 发布版组件与入口 |
| --- | --- |
| 应用框架 | `components/app-shell`、`components/app-header`、`components/sidebar` |
| 全局上下文 | `components/combobox` 的可搜索选择，`components/segment-control` 的环境模式选择，配合 `Popover` 与 `Badge` |
| 标题与内容层次 | `components/page-header`、`components/section-rule`、`LayerCard` |
| 表单与动作 | `Field`、`Input`、`Button`、`Checkbox`，`components/input-area`、`components/select`、`components/multi-select` |
| 目录导航与主从布局 | `components/editable-nav-item` 的 `EditableNavItem`、`FolderNavItem`，`components/responsive-master-detail` |
| 列表、摘要与状态 | `components/data-table`、`DescriptionList`、`Badge`、`components/banner` |
| 工作流画布 | `@xyflow/react` 的 `ReactFlow`、`ReactFlowProvider`、`Handle`，配合 Basalt 节点内容与属性面板 |
| 步骤摘要 | `components/flow` 的 `Flow`、`FlowNode`，用于只读概览 |
| 会话导航与消息 | `components/chat-inbox`、`components/chat-header`、`components/chat-bubble` |
| 代码、确认与反馈 | `components/code` 的 `CodeBlock`，`Dialog`、`AlertDialog`、`Sheet`、`Tooltip`、`Toaster` |

层级导航由应用数据驱动 `FolderNavItem` 和 `EditableNavItem`；展开、选择和角色归属由 ViewModel 管理。工作流画布呈现 MD 中的设计，实际进展来自独立的运行观察。

React Flow 使用 `@xyflow/react/dist/base.css` 提供必要布局，画布背景、节点表面、端口、连线与焦点样式映射 Basalt Tokens，主题跟随应用。编辑面板和工具条继续组合 Basalt 控件，复用画布库的交互与无障碍能力。

聊天输入使用受控 `InputArea`、`Button` 和模式选择控件组合，让 ViewModel 持有每个会话的草稿、失败重试和输入法状态。`2.2.0` 的 `ChatComposer` 使用内部草稿及同步 `onSend`，本应用采用基础控件组合管理跨会话草稿。

Markdown 展示使用成熟的 `react-markdown` 与 GFM 解析，复用 Basalt 链接、代码和表格组件。HTML 按文本处理，链接校验协议与目标，图片通过用户明确操作读取，产物引用走授权接口。

## 页面与导航

进入 Squad 后，主导航包括概览、角色与技能、Workflows、调试和评估。跨项目总览与本地设置由侧栏的全局入口访问；画布与 Chat 保持当前 Squad 的完整上下文。

### 全局 Squad／Harness 上下文

侧栏上方的切换器像工作区选择器一样显示当前 Squad 名称、所属项目、环境与 Harness 简称。展开后可搜索 Squad，查看该模式内已绑定的环境、定义摘要与连接状态，并进入对应 Harness。未绑定的 Squad 也可以进入定义管理，运行入口提供创建绑定动作。

全局上下文由模式、环境、Squad 和可选 Harness 组成。更换任一项后，定义导航、Workflow、会话、产物、评估与客户端缓存统一切换；路由记录稳定身份，刷新时由服务端重新校验选择。侧栏收起时仍显示当前 Squad 的可访问名称，窄屏在同一导航 Sheet 中完成切换。

用户进入某个 Squad 后持续看到其角色、工作流与运行内容，通过顶部切换器返回其他 Squad。工具条与属性面板可以收起，让画布或对话占据主要空间。环境标识在收起侧栏、全屏画布与发送输入时仍然可见。

切换前处理当前未保存的文件和画布草稿，提供保存后切换、放弃草稿或留在当前上下文。已经接纳的 Local／Prod 工作继续在原 Harness 运行，切换只改变观察目标；停止工作使用独立的取消动作。临时 E2E 的退出按下文生命周期执行。

Chat 草稿和待确认的发送意图按 `RuntimeScope` 与 Conversation 分开保留，返回原会话后继续处理。请求重试携带原作用域与 `requestId`，目标始终是原 Harness。

### Local、E2E 与 Prod

三种模式使用相同的应用、认证、Core 接入、Pi SQLite 与沙箱实现，分别绑定本机数据和模型配置。下表目录用于 Dashboard 自己托管的调试 Harness；独立运行端按登记模式展示，数据由其宿主管理。

| 模式 | 定义与存储 | 生命周期 |
| --- | --- | --- |
| Local | 工作区的 `squads/` 与 `data/local/` 下的独立 Harness 数据库 | 日常设计与调试，重启保留编辑和运行状态 |
| E2E | `data/e2e/<run-id>/` 下的隔离定义工作区与数据库 | 每次进入创建新范围，默认空白，按归属释放 |
| Prod | 工作区的定义源、明确选定的不可变快照与 `data/prod/` 下的独立数据库 | 本机正式使用，单独授权模型与工具，重启保留状态 |

Local 与 Prod 的定义编辑都作用于获准工作区的 MD；各 Harness 始终读取自己绑定的快照。正式使用新定义时明确选择版本并创建新环境。界面同时显示正在编辑的来源和已加载摘要，切换模式只选择目标数据，版本采用通过绑定操作完成。

环境列表展示 Harness 身份；托管项显示 SQLite 保存位置，独立运行端显示连接地址与存储归属。用户可以直接选择已存在的绑定，也可以创建新的环境。浏览器提交服务端枚举的身份，由服务端解析目标与授权。Prod 首次启动运行需确认其数据库、定义、模型连接和权限范围。

模式选择顺序为：自动 E2E 启动器锁定值、显式 CLI 参数、当前工作区保存的有效交互选择、Local。只有服务端接受的交互选择写入本地偏好；自动测试使用自己的参数和目录。

手动进入 E2E 时允许切换到 Local 或 Prod，退出前提示并结束该临时环境的活跃工作，关闭存储并清理自己拥有的状态；用户可先显式导出定义或证据。自动 E2E 的 `locked` 与 `automated` 由受信启动器设置，服务端将模式和资源根固定到本次测试。测试仍可在该范围内新建和切换 Squad／Harness。

### 切换与请求隔离

React 挂载前通过本地服务取得包含 `mode`、`instanceId`、`locked`、`automated` 与 CSRF 信息的上下文描述；选定对象时附上 `environmentId`、`squadId` 与 `harnessId`。`instanceId` 是本次界面选择的临时身份，Core 的 `RuntimeScope` 是存储的持久身份，运行操作要求完整作用域。

所有文件、运行、产物与观察请求使用固定的 `/__local/instances/<instanceId>/...` 路径。服务端把实例绑定到确定的工作区及托管存储或运行端连接，在接纳请求时完成归属检查；Core 操作继续携带 `RuntimeScope`。

客户端完成草稿处理后，切换请求携带当前实例和目标身份，服务端验证会话、Host、Origin、CSRF 及测试锁定范围。目标身份、目录归属与权限检查通过后，服务端颁发新实例，旧实例的新请求返回 `409`；检查失败则保持原上下文可用。离线或启动预检失败的 Harness 仍可选中查看诊断。

客户端接受新实例后释放旧订阅和请求控制器，重新挂载对应 ViewModel、缓存与页面，再从目标 Harness 读取快照。异步结果和推送同时核对实例与作用域，迟到结果只属于原上下文。已接纳的操作继续使用接纳时的存储引用，刷新和切换都保持这个归属。

### 项目总览

总览列出已登记项目及其 Squad、角色数、Workflow 数、定义校验结果、绑定快照和运行端连接情况。用户可以从任一条目进入定义或对应环境。

用户可以在获准工作区内新建 Squad，填写项目 ID、Squad ID 和主控角色，生成最小合法目录；也可以登记工作区内的现有 Squad。项目列表从定义与本地绑定读取。

首次启动展示工作区位置、已有 Squad 和模型连接情况，提供“打开定义”“检查运行环境”“开始调试”入口。无数据、定义错误和运行端离线分别给出下一步操作。

### 定义工作台

桌面使用目录与编辑详情的主从布局。目录按角色树、Skills 和 Workflows 分区；详情显示标题、稳定 ID、源路径、引用关系和编辑入口。

| 对象 | 可完成的操作 |
| --- | --- |
| Squad | 修改公共说明和默认模型配置，查看主控角色与能力需求 |
| Role | 新增、编辑、复制、调整父目录、删除；配置职责、模型、思考等级、Skills 和 Tools |
| Skill | 新增、编辑和删除技能，管理资源和已声明脚本，查看引用它的角色 |
| Workflow | 在画布或 MD 中新建、编辑和删除工作流，配置步骤、交接、入口、能力范围及输入输出 |

表单与源码编辑共享同一份草稿。表单修改映射到 frontmatter 和对应正文；源码解析成功后刷新表单。校验结果能够定位到文件和字段，编辑脚本时明确显示其路径、入口和授权要求。

保存操作携带读取时的文件摘要，服务端比较后校验候选定义。单文件先写入同目录临时文件，核对路径与摘要后原子替换；语法、引用、冲突或落盘失败时保留草稿和原文件，成功后才更新已保存摘要。若文件已由外部编辑器修改，提供差异、重新加载或重新应用操作。离开未保存页面时给出确认。

稳定 ID 与目录名保持一致，显示名可以独立修改。角色移动通过工作区内目录重命名改变层级，原 ID 和引用保持稳定；删除前列出引用并要求先处理依赖。新建 Squad 或 Skill 的多个文件在同一文件系统的候选目录完成校验后，通过目录重命名提交到工作区；已有文件按各自保存结果显示并保留未完成草稿。

保存后展示文件差异与新的内容摘要；在 Git 工作区内同时展示 Git 差异，提交仍由用户或开发工作流完成。E2E 编辑展示隔离文件的差异，运行环境继续使用自己的已绑定快照。

### Workflow 画布

画布采用节点搭建与属性检查的交互：紧凑的标题工具行下方，角色面板、中央画布与按需展开的属性面板共享可用高度。画布可以收起辅助面板以专注设计，保留全局上下文。页面内的“画布／源码”切换使用同一份文件草稿。

| 操作 | 行为 |
| --- | --- |
| 添加步骤 | 从当前 Squad 的角色面板拖入画布，生成稳定节点 ID；也可用“添加步骤”选择角色 |
| 组织流程 | 拖动节点、从端口连线、修改交接说明、设置入口、复制或删除步骤；提供撤销与重做 |
| 编辑步骤 | 单击节点打开属性面板，编辑标题、输入输出与步骤 Markdown，选择已有 Role |
| 编辑角色 | 从节点打开其 `ROLE.md`，修改 Prompt、模型、思考等级、Skills、Tools 与 Scripts，并显示引用该角色的步骤 |
| 创建角色 | 从角色面板进入标准创建流程，选择父角色并保存定义，再将新角色拖入画布 |
| 定位与校验 | 平移、缩放、适配全图，点击诊断定位节点、连线或文件字段 |

节点代表角色承担的一个步骤。节点上显示角色名称与配置摘要，实际会话的 Agent 配置在运行详情中查看。角色编辑作用于被引用的文件，同角色的其他步骤立即反映草稿或已保存定义；步骤说明保存在 Workflow 自身。

ViewModel 持有受控图数据与草稿历史，使用库提供的节点、边变更函数及 `screenToFlowPosition()` 处理交互。Core 校验图和角色引用，服务端保存完整候选定义。删除节点时同步移除关联连线与正文段落，删除入口时要求选择有效的新入口。

一次图编辑保存将节点、连线、入口、坐标与正文共同写入 Workflow MD。刷新或从 Git 重新加载后恢复相同设计；解析失败时保留源码草稿并定位错误，画布展示上次有效解析结果。画布视口和选中状态按工作区保存为本地偏好。

节点交接可以分支、汇合和表达复核回路，说明通过 Core 装配给模型。角色层级仍由目录编辑管理；运行观察使用真实 Pi Conversation 与 Task 关系。设计图中的步骤完成情况只有在取得可关联的执行证据后才呈现，具体工作结果以会话、工具与产物为准。

### 绑定与启动

用户在当前全局上下文中选择不可变定义快照，创建环境绑定或打开已有 Harness，查看以下预检结果：

- 各角色最终模型与思考等级，模型服务可用的能力。
- 定义要求、宿主授权和工具入口共同形成的实际能力。
- Registry、脚本解释器与沙箱镜像的可用情况。
- 独立运行目录、SQLite 所有权、输入产物、请求预算与期限。

预检通过后启用“启动”。错误显示到具体角色、工具或配置项。模型、授权和预算的微调形成当前环境配置，并与定义摘要一起保存。

定义存在未提交改动时仍可调试，界面标识其内容摘要。每次验证新的定义快照在当前模式下建立独立环境，旧环境可继续观察与恢复。全局切换器列出这些绑定；同一环境内继续保持 Squad 与 Harness 的一一对应。

### 调试工作台

桌面布局由会话列表、对话区和可展开的运行详情组成。首屏直接提供可对话的主控根会话、创建对话和发送入口。

创建对话时选择角色，以及自由发挥或 Workflow；选择 Workflow 时采用其入口角色。已有会话沿用创建时的角色与工作方式。

会话列表显示角色、会话标题、当前 Pi 状态与子会话关系。用户可以展开一次派发进入子会话，查看其实际模型、思考等级、工具和输出，再回到父会话。

对话区提供普通输入、插话、排队列表、撤回和停止操作。每条发送意图保留 `requestId`；请求失败时保留原文本和 ID，重试复用它们。新的用户意图分配新 ID。

运行期间切换页面或会话保持工作继续。消息流只在用户位于底部时自动滚动，查看历史时提供“有新输出”提示。发送处理中区分服务端接纳和模型运行；长输出按已提交快照更新。

运行详情包含生效配置、Submissions、活跃 Tasks、工具调用与回执、产物和基础用量。任务采用列表及所有权缩进呈现，诊断中的 Pi ID 可复制。完成的工作继续从历史记录查看。

停止按钮对当前会话调用 Core 的取消操作，等待实际空闲状态再显示完成。运行端离线时保留最后快照并标明连接中断；重新连接先替换快照，再继续订阅。

### 产物与评估

产物面板按名称、来源角色、媒体类型和摘要展示输入输出。Markdown 可预览，结构化结果可查看，下载按 `ArtifactRef` 授权。脚本退出码、输入摘要和计算结果可直接定位。

评估页读取 `evals/` 的用例目录，展示目标、准备条件、预算和验收项。用户明确确认真实模型调用后启动评估，可观察同一个调试工作台中的会话和工具。

评估报告按断言显示证据链接，分别呈现通过、业务失败和环境错误。点击失败项进入相关会话、工具或产物。历史报告保存在本地运行目录，关联定义、实现版本和模型配置。

## 通用交互要求

列表和详情均具有加载、空数据、失败重试、已有数据刷新和完整数据状态。动作反馈在发生位置显示，Toast 补充整体反馈。所有可见操作对应真实服务能力。

键盘可以完成导航、编辑、提交、对话切换和弹窗操作。画布节点可聚焦，拖放有“添加步骤”“连接到步骤”和坐标编辑的等价入口；节点、端口与连线提供可访问名称和状态。输入法组合期间 Enter 保持输入语义，Shift+Enter 换行；发送快捷键在界面明确说明。图标动作提供名称，弹窗关闭后恢复焦点。

窄屏侧栏使用左侧 `Sheet`，主从内容使用 `ResponsiveMasterDetail`，选中详情时只保留一份可聚焦内容。画布的角色面板与属性面板转为 Sheet，触屏可平移缩放并通过等价动作完成编辑。调试详情转为 Sheet 或页内标签；表格在自身区域横向滚动。页面在 390px 与 1440px 视口、两种主题及 reduced-motion 下验收。

## 本地调试运行端

### 进程与数据

Dashboard 服务监督独立 Harness 子进程，每份 Harness 数据库由一个进程持有。UI 服务、评估控制器和 Harness 生命周期分开，便于切换观察目标、处理中断和重新打开原数据库。

Dashboard 托管的运行数据统一放在所选工作区的 `data/`，由根 `.gitignore` 忽略。全部模式的数据库都存放在本机，CLI 和测试启动器在打开存储前创建并验证目录：

```text
data/
  local/
    environments/<environment-id>/
      environment.json
      harnesses/<harness-id>/
        binding.json
        definition/
        session.sqlite
        artifacts/
        receipts/
        evals/<evaluation-id>/
          report.json
          evidence/
  prod/
    environments/<environment-id>/
      ...
  e2e/<run-id>/
    owner.json
    workspace/squads/
    environments/<environment-id>/
      ...
    reports/
```

Prod 和 E2E 的 `environments/` 使用与 Local 相同的内部结构。`environment.json` 保存模式、环境身份与目录归属，`binding.json` 保存 `RuntimeScope`、定义摘要、运行版本、无凭据配置和模型连接 ID，并与 Pi 的绑定 Document 核对。`definition/` 是 Harness 已加载的不可变快照，E2E 的 `workspace/squads/` 则是独立可编辑源。

SQLite、WAL 和 SHM 文件归同一 Harness，打开前取得独占权。创建、seed、重置与清理核对规范化路径、归属标记、模式和活跃所有者，目录组件必须为归属范围内的真实目录。模型凭据留在本机私有配置，按环境显式提供；E2E 子进程仅获得虚构连接配置和本次认证材料。

Local／Prod 正常重启重新打开原数据库。用户选择另一绑定就是切换到另一份本地数据库，旧绑定保留自己的状态。显式清理先关闭选定 Harness，确认路径和身份后释放对应数据；自动测试的清理只处理 `owner.json` 标记的本次进程、文件和容器。

产物写入采用 `RuntimeScope` 与 Tool Task 组成的稳定操作键、内容摘要和原子落盘，成功后返回不可变引用。脚本回执还核对定义、入口和输入摘要；重启后相同操作可读取已保存回执，内容冲突返回诊断。用户通过页面查看数据与证据的保存位置。

### 可追踪的 seed

seed 的生成逻辑、配置与输入纳入 Git，生成结果进入 `data/`：

```text
seeds/
  seed.ts
  profiles.ts
  model-scenarios.ts
```

`seed.ts` 提供统一初始化入口，`profiles.ts` 定义 `empty` 与 `sample` 两种选择并引用 `squads/` 的定义和 `evals/` 的输入，`model-scenarios.ts` 提供确定性模型边界数据。目录中的源码可导出构建测试所需的输入，定义和业务简报各自保留一份来源。

| 配置 | 初始化结果 | 用途 |
| --- | --- | --- |
| `empty` | 只有目录归属、应用初始化与本次认证条件，Squad、Harness 绑定和运行历史均为空 | 从零搭建的 E2E 与空状态验证 |
| `sample` | 在新建范围内登记或复制样例定义，通过公共入口创建绑定，运行从正常会话入口开始 | 手动体验、聚焦交互测试和界面截图 |

E2E 默认使用 `empty`。从零搭建测试可以读取已追踪的文本和脚本作为填写内容，创建与保存通过真实 UI 完成。`sample` 显式选择：Local 登记已有的样例源并建立新绑定，E2E 将样例复制到本次定义工作区。Prod 通过用户选择的定义与真实配置建立绑定。

初始化使用正式的解析、文件与 Pi 接入代码，模型替身仅安装在 `Models` 边界。种子输入的版本与摘要记录在归属元数据中。seed 完成后，宿主重启沿用原范围的文件、会话和编辑；新的 E2E run 重新初始化，再次 seed 已使用的目标返回清晰诊断。seed 重置入口面向用户确认的 Local 样例运行数据与当前临时 E2E，保留 Git 管理的定义源；Prod 通过新建绑定采用选定定义。

### 脚本沙箱

首期脚本执行采用本机 Docker：macOS 使用 Docker Desktop 的 Linux 虚拟机，Linux 使用 Docker Engine。使用固定 digest 的预构建 Node 镜像，运行前检查本地镜像和 Docker 可用性。

`run_script` 由受信宿主工具启动短生命周期容器。它按声明的 Skill、Script ID 和入口构造 argv，将结构化输入通过 stdin 送入；脚本通过 stdout 返回 JSON，stderr 用于诊断。

每次调用的隔离要求如下：

- 非 root 用户、只读镜像与 Skill 挂载、空白的 `/work` tmpfs。
- 网络关闭、能力全部移除、启用 no-new-privileges；宿主目录、凭据和 Docker socket 留在容器边界外。
- 脚本环境由白名单构建，临时 HOME 与 TMPDIR 位于 `/work`；工作目录使用 16 MiB tmpfs，系统共享内存等其余可写临时区一并设限。
- 默认上限为 1 CPU、256 MiB 内存、64 个进程、30 秒运行时间和 1 MiB 输出；超限终止当前调用并返回明确诊断。
- stdout 在宿主按上限收集和校验，成功后保存结果及回执；容器内临时文件随调用释放。

参考宿主的工具与执行环境遵循 Core：默认只安装供角色显式选择的 `frogie` 四个通用工具，Harness `env` 留空，计算交给独立脚本沙箱。业务扩展可以提供其他工具；文件与命令能力同时接入受控 ExecutionEnv、授权和相同隔离要求。

Docker 缺失或隔离配置不满足时，脚本能力预检返回阻塞原因，定义管理仍可使用。超时、取消和重启清理依据环境与工具任务标签，只处理该宿主拥有的容器。

### 调试与恢复

“停止当前工作”调用 Pi 取消；“关闭运行端”保留 Pi 已提交的未完成工作；“恢复环境”重新预检原绑定并打开相同存储。界面使用这三个动作明确表达执行意图。

重启时先显示 `inspect()` 的结果和恢复条件，再按用户授权启动调度。运行端断开、缺少 Extension、沙箱不可用和预算耗尽各自给出对应处理入口。

## MVP 验收

用户从本地 URL 进入空工作区后，能够创建完整 Squad 的角色、Skills 与脚本，在画布上拖入步骤、连线、打开角色编辑并保存为 MD；刷新后恢复相同设计。随后检查引用与权限，绑定并启动真实 Harness，与主控对话、观察子会话、查看脚本计算与 Markdown 产物。

侧栏全局切换能进入对应 Squad／Harness，Local、E2E、Prod 使用各自本机数据库，旧请求与事件保持原作用域。确定性 E2E 锁定从零创建到保存、运行和重连的路径；真实模型评估采用界面生成的同一份定义，在独立环境验证协作、恢复与报告。验收材料按 [Tests](06-tests.md) 与 [Evals](07-evals.md) 组织。

## 组件依据

- [Basalt npm 镜像元数据](https://mirrors.tencent.com/npm/@nocoo%2fbasalt) 与 [CDN 版本目录](https://data.jsdelivr.com/v1/package/npm/@nocoo/basalt)
- [Basalt 2.2.0 包清单](https://unpkg.com/@nocoo/basalt@2.2.0/package.json)
- [Basalt 2.2.0 集成指南](https://unpkg.com/@nocoo/basalt@2.2.0/ai/INTEGRATION.md)
- [Basalt 2.2.0 组件注册表](https://unpkg.com/@nocoo/basalt@2.2.0/ai/registry.json)
- [Basalt 2.2.0 ChatComposer 类型](https://unpkg.com/@nocoo/basalt@2.2.0/dist/components/chat-composer.d.ts)
- [React Flow 12.12.0 包清单](https://unpkg.com/@xyflow/react@12.12.0/package.json)
- [React Flow 拖放](https://reactflow.dev/examples/interaction/drag-and-drop)与[保存恢复](https://reactflow.dev/examples/interaction/save-and-restore)
