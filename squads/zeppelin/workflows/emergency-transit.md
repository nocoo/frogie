---
id: emergency-transit
title: 紧急转移
entry: receive-brief
nodes:
  - id: receive-brief
    title: 接收简报
    role: command
    position: { x: 80, y: 240 }
  - id: coordinate-route
    title: 协调行动
    role: operations
    position: { x: 360, y: 80 }
  - id: assess-route
    title: 判断航程
    role: navigation
    position: { x: 640, y: 0 }
  - id: assess-threat
    title: 判断威胁
    role: tactical
    position: { x: 640, y: 160 }
  - id: merge-route
    title: 汇总路线
    role: operations
    position: { x: 920, y: 80 }
  - id: check-power
    title: 核对工程
    role: engineering
    position: { x: 640, y: 320 }
  - id: check-supplies
    title: 核对补给
    role: logistics
    position: { x: 640, y: 480 }
  - id: publish-plan
    title: 交付方案
    role: command
    position: { x: 1200, y: 240 }
edges:
  - source: receive-brief
    target: coordinate-route
    label: 交付目标与路线资料
  - source: receive-brief
    target: check-power
    label: 交付舰况与负载要求
  - source: receive-brief
    target: check-supplies
    label: 交付库存与保留量要求
  - source: coordinate-route
    target: assess-route
    label: 派发航程与时机判断
  - source: coordinate-route
    target: assess-threat
    label: 派发威胁与护航判断
  - source: assess-route
    target: merge-route
    label: 返回航行意见与依据
  - source: assess-threat
    target: merge-route
    label: 返回战术意见与约束
  - source: merge-route
    target: publish-plan
    label: 返回综合路线建议
  - source: check-power
    target: publish-plan
    label: 返回工程可行性与预算
  - source: check-supplies
    target: publish-plan
    label: 返回补给安排与保留量
tools: [read_artifact, write_artifact, delegate, run_script]
scripts: [resource-budget/calculate]
---

## 目标
根据紧急简报协调路线、护航、工程与补给，形成可执行的舰队转移方案。

## 输入
当次舰况、资源、人员与目标的简报产物引用，以及必要保留量和交付要求。

## 步骤

### receive-brief
主控读取紧急简报，明确目标、必要保留量和交付要求，分别派发行动协调、工程和补给任务，附上各自需要的输入产物引用。

### coordinate-route
行动协调读取目标与路线资料，安排行动分析，将航程与时机判断交给航行，将威胁与护航判断交给战术。

### assess-route
航行依据路线资料提出航程、时机与风险判断，将结论、依据和约束返回行动协调。

### assess-threat
战术依据威胁资料提出护航部署与撤离条件，将结论、依据和约束返回行动协调。

### merge-route
行动协调通过派发回执取得两个专业结果，核对冲突，综合行动顺序与备选路线，将路线和护航建议返回主控。

### check-power
工程核对推进、供电、维修窗口和关键负载，使用 resource-budget/calculate 计算候选预算，将工程可行性、依据与约束返回主控。

### check-supplies
补给核对库存、分配、必要保留量与补给安排，使用 resource-budget/calculate 计算候选预算，将补给意见、依据与约束返回主控。

### publish-plan
原主控会话通过派发回执取得路线、工程和补给结果，汇总冲突，选择可执行方案并保存 plan.md。返回上级的连线表示结果交接，不改变角色树的派发权限。

## 输出
中文 plan.md，包含转移方案、路线与护航安排、工程和资源约束、依据及待协调项，保留输入与子结果的产物引用。

## 验收要点
方案可追溯到输入简报与子角色结果；路线、工程、补给之间的冲突得到核对，必要保留量明确，预算计算有依据。主控通过回执取得子结果，角色树继续决定实际派发权限。
