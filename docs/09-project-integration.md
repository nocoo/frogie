# 09 - 项目集成

## 边界

Frogie 保存 Squad 的角色与提示词源文件，并提供已编译的 `@frogie/core`。集成项目提供宿主进程、模型凭据、业务工具、输入输出、界面与本地数据目录。Pi Durable、Pi AI、Chord 的版本和执行适配由 Core 统一维护。

`./host` 是供本地业务宿主使用的入口，复用 `./runtime` 的定义校验、绑定与角色装配。宿主通过普通对象、数字会话 ID、TypeBox 工具定义和 `AbortSignal` 操作；Pi 的 Harness、Conversation、Submission、Task 与 Document 继续负责底层执行和持久化。

## 宿主接入

1. 加载指定版本的 `DefinitionBundle`，取得本地存储的独占锁。
2. 用 `configuredModels` 注册模型连接，为每个角色指定 provider、modelId 和 thinkingLevel。
3. 用 `defineHostTool` 实现定义声明的业务工具。角色的 extensions 与 tools 共同决定实际可用工具。
4. 用 `openAgentHost` 打开本地 SQLite，传入稳定的 runtimeId、scope、业务状态文档和可选的执行目录。
5. 在暂停状态读取 `pendingSubmissions()` 和业务状态，用 `stageAbort(conversationIds)` 持久标记已取消、终态或过期任务；装载对应的业务命令上下文后调用 `resume()`。新输入通过 `run(conversationId, { requestId, content, instructions, timeoutMs })` 提交。
6. 退出时先停止接收输入，关闭 Host，最后关闭业务传输存储并释放独占锁。

`transact` 把业务状态修改、创建会话和配置角色放进同一持久事务。每个会话按指定角色装配；同一个角色可以创建多个实例。多个会话可以并行执行，一个会话内的不同活动请求会被拒绝。

相同 requestId 和相同输入重连到原提交，变更输入须使用新的 requestId。运行超时会请求取消并等待 Pi 结束该提交；工具实现应响应取消信号，并自行管理外部进程及幂等副作用。完成状态由 Pi 的实际结果决定。

## 运行与权限

宿主负责认证调用者、决定何时创建会话以及调度哪个角色。`./host` 是可信进程内 API；网站对外的认证和审批继续经过业务控制器。工具的 `replay: safe` 声明要求实现方使用稳定操作 ID、回执和业务版本检查处理重放。

指定 `execution` 后，Core 为需要 CodingTools 的角色创建独立工作目录并负责清理执行环境。当前 Node 执行环境使用本机用户权限，目录隔离与工具白名单属于逻辑边界。需要 OS 级沙箱的宿主应使用具备隔离能力的运行适配。

Core 保存会话、任务、绑定、压缩历史和业务状态文档到使用方指定的 SQLite。使用方另行保存传输队列、网站回执与产物。定义版本和运行绑定在恢复时校验，凭据始终留在宿主。

上下文压缩沿用 Pi 的历史选择、摘要落点和持久化；摘要使用同一模型的 low thinking，任务保留各角色选择。摘要后仍超出模型窗口时，在发出任务请求前返回明确的上下文错误，原历史保留。`inspectDatabase` 只读输出工具调用数量和失败数量，诊断结果省略原始文本与凭据。

## his.fm 接入

`squads/hisfm/` 保存主控、writer、reviewer、speech 四个角色，以及完整的十六项提示词、全局编辑方针和播讲风格。原始正文及拼装顺序由内容摘要测试锁定。

`@frogie/core/hisfm` 提供定义加载和角色提示词组合；`@frogie/core/hisfm/prompts` 是构建时从 MD 生成的纯数据入口，供网站服务端初始化默认值。该入口独立于 Node 文件系统与 Pi 运行时代码。`./hisfm/narration` 单独输出公开的默认播讲风格，供共享语音配置使用。

his.fm 的既有频道、分类提示词和播讲设置作为使用方持久化的业务配置继续生效。新输入读取当前配置，已投递的任务使用冻结快照。定义的原始版本由 Frogie 管理，已有的用户编辑保留在 his.fm 的版本化配置中。

his.fm 负责 Jev 调度策略、网站连接、选题与逐字稿状态机、人工确认、语音脚本和音频上传。它调用 Host 执行会话，以业务状态文档记录 assignment 与复用条件；Core 负责其底层事务与恢复。

切换后的执行状态使用 `frogie.sqlite`，原 `pi.sqlite` 作为历史数据保留。业务传输记录继续使用原存储；首次启动新 Host 前检查旧命令和待发送事件，只有旧任务已经收尾才进入新执行状态。新任务由 Frogie 承载，当前调试入口读取新执行状态和业务传输记录。

## 包交付与验证

在 Frogie 根目录运行 `pnpm build:core`，再在 `packages/core` 内执行 `npm pack`，生成含 JavaScript、类型声明和 Squad 文件的独立包。源码开发通过 `frogie-source` condition 解析；安装到其他项目后使用编译产物，运行不依赖相邻仓库。

当前 his.fm 将该版本的 tarball 纳入 `vendor/`，在 workspace manifest 中使用精确的 `file:` 引用，由 lockfile 校验内容。更新按构建、打包、安装、验收、原子提交的顺序进行。Pi 依赖只在 Frogie 内声明，his.fm 的业务源码和测试仅调用 Frogie 入口。

Core 测试覆盖宿主协议、工具权限、幂等、并行、取消、SQLite 恢复、压缩和定义完整性。集成方用 `./testing` 的模型替身验证业务流程，真实模型与音频验收通过原产品入口进行，保存命令、作品、回执与可播放产物的证据。人工确认和公开发布使用各自的业务权限。
