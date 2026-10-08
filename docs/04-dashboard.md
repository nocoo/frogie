# 04 - Dashboard

## 产品目标

`apps/dashboard/` 是本机启动的设计台、观察台和调试运行端。用户可以完成“浏览定义 → 编辑角色与技能 → 校验并绑定 → 真实对话与派发 → 查看产物 → 重启恢复 → 运行评估”的完整过程。

界面展示通用 Squad、Role、Workflow 和 Pi 运行对象，业务内容来自加载的定义。公共接入遵循 [Core](03-core.md)，目录和开发方式遵循 [仓库结构与开发约定](02-repository-and-workflow.md)。

## 应用组成与 MVVM

首期采用 React 19、Vite 和 TypeScript 构建界面，Node ESM 承载 CLI、同源服务与本地调试宿主。界面与服务通过 Core 协议通信。

| 位置 | 职责 |
| --- | --- |
| `src/models/` | 定义、绑定、会话、产物和评估数据；公共协议客户端与文件服务 |
| `src/viewmodels/` | 编辑草稿、选择项、校验结果、异步动作、投递重试、观察连接和页面状态 |
| `src/views/` | Basalt 组件组合、布局、焦点、滚动和键盘交互 |
| `src/server/` | 本地认证、受控文件编辑、HTTP 与状态推送、运行端管理 |
| `src/runtime/` | 引用 Core 的 Harness 宿主、SQLite、产物、脚本沙箱和预检 |
| `src/cli.ts` | 解析启动参数、选择工作区与数据目录、启动和关闭服务 |

ViewModel 接收服务依赖，以普通 TypeScript 状态转换和 React 绑定组织。角色校验、权限、生效配置与 Pi 状态解析复用 Core。浏览器只持有显示数据和编辑草稿，文件写入、工具执行及授权在服务端完成。

## 启动与访问

规划的用户入口为 `frogie dashboard --workspace <path>`。CLI 选择工作区，输出 `127.0.0.1` 本地 URL；端口冲突时返回明确错误或使用用户指定端口。服务只绑定 loopback 地址。

首次打开通过一次性启动凭据建立会话，凭据放在 URL fragment，浏览器交换后清除；服务端颁发短期 HttpOnly、SameSite 会话 Cookie。模型凭据只由宿主配置读取，界面显示已配置的连接名称与可用状态。

服务验证 Host、Origin 和请求身份，写操作具有 CSRF 防护，跨源访问按明确本地来源限制。文件操作限定 CLI 授权的工作区；运行连接限定已登记的本地运行端。请求日志和错误输出保留诊断信息并过滤凭据。

首期本地启动者拥有工作区的管理与调试权限。页面动作仍使用 Core 的权限标识，便于集成项目沿用自己的身份与授权系统。

关闭浏览器只解除观察。CLI 管理调试子进程的生命周期，关闭服务时有界地关闭 Harness 和脚本工作负载，保留已提交状态供下次恢复。

## Basalt 基线与视觉

### 发布包

首期锁定已核实的 npm 稳定版 `@nocoo/basalt@2.2.0`，采用 `@nocoo/basalt/styles/standalone`。版本依据为 npm 镜像的 `latest`、独立 CDN 元数据及相同版本发布产物。

本地 `../basalt` 用于理解设计体系，组件能力以 `2.2.0` 产物内的 `ai/registry.json`、类型声明与 `ai/INTEGRATION.md` 为准。该版本的布局、编辑、列表和聊天展示组件足以完成首期界面。

### 应用骨架

组合顺序采用 Basalt 的 `AppShell`、`Sidebar`、`AppMain`、`AppSkipLink`、`AppHeader` 和一个 `ContentIsland`。内容页以 `PageHeader` 开始，分区使用 `SectionRule`，成组内容使用 `LayerCard`。

侧栏显示现有 Frogie 标志、名称、构建版本、项目切换和主导航。Header 显示真实上级路径、当前页面、连接状态、GitHub 入口和末位主题切换。页面操作位于内容标题行。

使用 `ThemeProvider`、`AccentProvider`、`LinkProvider`、`TooltipProvider` 和单个全局 `Toaster`。默认强调色采用 Basalt 的 `green`，保留 Frogie 现有图稿，使用合适尺寸的衍生资产。

字体、控件尺寸、圆角、间距和表面遵循发布版 Design Tokens。内容通过亮度层级区分，状态同时提供文字与图标。界面以紧凑的横向信息组织为主，浅色与深色主题均可使用。

### 控件选择

| 场景 | 发布版组件与入口 |
| --- | --- |
| 应用框架 | `components/app-shell`、`components/app-header`、`components/sidebar` |
| 标题与内容层次 | `components/page-header`、`components/section-rule`、`LayerCard` |
| 表单与动作 | `Field`、`Input`、`Button`、`Checkbox`，`components/input-area`、`components/select`、`components/multi-select` |
| 目录导航与主从布局 | `components/editable-nav-item` 的 `EditableNavItem`、`FolderNavItem`，`components/responsive-master-detail` |
| 列表、摘要与状态 | `components/data-table`、`DescriptionList`、`Badge`、`components/banner` |
| 工作流步骤 | `components/flow` 的 `Flow`、`FlowNode`，配合 Markdown 正文 |
| 会话导航与消息 | `components/chat-inbox`、`components/chat-header`、`components/chat-bubble` |
| 代码、确认与反馈 | `components/code` 的 `CodeBlock`，`Dialog`、`AlertDialog`、`Sheet`、`Tooltip`、`Toaster` |

层级导航由应用数据驱动 `FolderNavItem` 和 `EditableNavItem`；展开、选择和角色归属由 ViewModel 管理。Workflow 用步骤与说明展示编排，实际进展来自运行状态。

聊天输入使用受控 `InputArea`、`Button` 和模式选择控件组合，让 ViewModel 持有每个会话的草稿、失败重试和输入法状态。`2.2.0` 的 `ChatComposer` 使用内部草稿及同步 `onSend`，本应用采用基础控件组合管理跨会话草稿。

Markdown 展示使用成熟的 `react-markdown` 与 GFM 解析，复用 Basalt 链接、代码和表格组件。HTML 按文本处理，链接校验协议与目标，图片通过用户明确操作读取，产物引用走授权接口。

## 页面与导航

主导航包括项目、定义、调试、评估和本地设置。项目与环境选择保留在路由或可恢复的页面状态中，刷新后可以回到选中的对象。

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
| Workflow | 新增、编辑和删除工作流，配置适用角色、能力范围、输入输出和步骤 Markdown，查看步骤预览 |

表单与源码编辑共享同一份草稿。表单修改映射到 frontmatter 和对应正文；源码解析成功后刷新表单。校验结果能够定位到文件和字段，编辑脚本时明确显示其路径、入口和授权要求。

保存操作携带读取时的文件摘要，服务端比较后校验候选定义并原子写入。若文件已由外部编辑器修改，保留草稿并提供差异、重新加载或重新应用操作。离开未保存页面时给出确认。

稳定 ID 与目录名保持一致，显示名可以独立修改。角色移动通过工作区内目录重命名改变层级，原 ID 和引用保持稳定；删除前列出引用并要求先处理依赖。多文件创建在完整候选目录校验后提交到工作区。

保存后展示 Git 工作区差异与新的内容摘要；Git 提交仍由用户或开发工作流完成。运行环境继续使用自己的已绑定快照。

### 绑定与启动

用户选择 Squad、不可变定义快照和本地环境，查看以下预检结果：

- 各角色最终模型与思考等级，模型服务可用的能力。
- 定义要求、宿主授权和工具入口共同形成的实际能力。
- Registry、脚本解释器与沙箱镜像的可用情况。
- 独立运行目录、SQLite 所有权、输入产物、请求预算与期限。

预检通过后启用“启动”。错误显示到具体角色、工具或配置项。模型、授权和预算的微调形成当前环境配置，并与定义摘要一起保存。

定义存在未提交改动时仍可调试，界面标识其内容摘要。每次验证新的定义快照建立独立环境，旧环境可继续观察与恢复。

### 调试工作台

桌面布局由会话列表、对话区和可展开的运行详情组成。首屏直接提供主控会话、创建对话和发送入口。

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

键盘可以完成导航、编辑、提交、对话切换和弹窗操作。输入法组合期间 Enter 保持输入语义，Shift+Enter 换行；发送快捷键在界面明确说明。图标动作提供名称，弹窗关闭后恢复焦点。

窄屏侧栏使用左侧 `Sheet`，主从内容使用 `ResponsiveMasterDetail`，选中详情时只保留一份可聚焦内容。调试详情转为 Sheet 或页内标签；表格在自身区域横向滚动。页面在 390px 与 1440px 视口、两种主题及 reduced-motion 下验收。

## 本地调试运行端

### 进程与数据

Dashboard 服务监督独立 Harness 子进程，每个环境一个存储所有者。UI 服务、评估控制器和 Harness 生命周期分开，便于观察进程中断和重新打开原数据库。

运行数据默认放在 `~/.local/share/frogie/`，可由 CLI 指定独立目录：

```text
runtime-root/
  environments/<environment-id>/
    binding.json
    definition/
    session.sqlite
    artifacts/
    receipts/
  evals/<evaluation-id>/
    report.json
    evidence/
```

`binding.json` 保存定义摘要、运行版本、无凭据配置和模型连接名称，并与 Pi 的绑定 Document 核对。`definition/` 保存不可变定义文件；SQLite 及其 WAL 文件归当前环境所有。产物与回执分别用于用户输出和可重放工具的幂等处理。

产物写入采用环境与 Tool Task 组成的稳定操作键、内容摘要和原子落盘，成功后返回不可变引用。脚本回执还核对定义、入口和输入摘要；重启后相同操作可读取已保存回执，内容冲突返回诊断。用户通过页面查看保存位置，清理操作核对环境身份并仅作用于选定的非活跃环境。

### 脚本沙箱

首期脚本执行采用本机 Docker：macOS 使用 Docker Desktop 的 Linux 虚拟机，Linux 使用 Docker Engine。使用固定 digest 的预构建 Node 镜像，运行前检查本地镜像和 Docker 可用性。

`run_script` 由受信宿主工具启动短生命周期容器。它按声明的 Skill、Script ID 和入口构造 argv，将结构化输入通过 stdin 送入；脚本通过 stdout 返回 JSON，stderr 用于诊断。

每次调用的隔离要求如下：

- 非 root 用户、只读镜像与 Skill 挂载、空白的 `/work` tmpfs。
- 网络关闭、能力全部移除、启用 no-new-privileges；宿主目录、凭据和 Docker socket 留在容器边界外。
- 脚本环境由白名单构建，临时 HOME 与 TMPDIR 位于 `/work`；工作目录使用 16 MiB tmpfs，系统共享内存等其余可写临时区一并设限。
- 默认上限为 1 CPU、256 MiB 内存、64 个进程、30 秒运行时间和 1 MiB 输出；超限终止当前调用并返回明确诊断。
- stdout 在宿主按上限收集和校验，成功后保存结果及回执；容器内临时文件随调用释放。

首期通用工具组合使用 `run_script`、产物工具与受控派发，脚本执行器承担计算工作。宿主扩展若提供更广泛的编码能力，按 Core 的执行环境接口和相同隔离要求接入。

Docker 缺失或隔离配置不满足时，脚本能力预检返回阻塞原因，定义管理仍可使用。超时、取消和重启清理依据环境与工具任务标签，只处理该宿主拥有的容器。

### 调试与恢复

“停止当前工作”调用 Pi 取消；“关闭运行端”保留 Pi 已提交的未完成工作；“恢复环境”重新预检原绑定并打开相同存储。界面使用这三个动作明确表达执行意图。

重启时先显示 `inspect()` 的结果和恢复条件，再按用户授权启动调度。运行端断开、缺少 Extension、沙箱不可用和预算耗尽各自给出对应处理入口。

## MVP 验收

用户从本地 URL 进入后，能够编辑一套完整 Squad，检查引用与权限，启动真实 Harness，与主控对话并观察子会话，查看脚本计算和 Markdown 产物，重新连接及恢复未完成工作，最后取得关联同一运行证据的评估报告。

确定性界面测试验证交互与状态；真实模型评估验证执行链路。两者复用本地调试端和公共协议，验收材料按 [Tests](06-tests.md) 与 [Evals](07-evals.md) 组织。

## 组件依据

- [Basalt npm 镜像元数据](https://mirrors.tencent.com/npm/@nocoo%2fbasalt) 与 [CDN 版本目录](https://data.jsdelivr.com/v1/package/npm/@nocoo/basalt)
- [Basalt 2.2.0 包清单](https://unpkg.com/@nocoo/basalt@2.2.0/package.json)
- [Basalt 2.2.0 集成指南](https://unpkg.com/@nocoo/basalt@2.2.0/ai/INTEGRATION.md)
- [Basalt 2.2.0 组件注册表](https://unpkg.com/@nocoo/basalt@2.2.0/ai/registry.json)
- [Basalt 2.2.0 ChatComposer 类型](https://unpkg.com/@nocoo/basalt@2.2.0/dist/components/chat-composer.d.ts)
