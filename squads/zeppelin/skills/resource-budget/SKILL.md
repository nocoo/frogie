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

## 适用情形
工程或补给需要核对候选方案的资源额度。

## 输入与输出
输入仅包含非空 budgets 数组。每项预算仅包含 id、available、reserve、allocations；每项分配仅包含 id、amount。allocations 允许为空。预算 ID 在请求内唯一，分配 ID 在所属预算内唯一，均使用 `^[a-z][a-z0-9-]*$`。

available、reserve 和 amount 为有限非负数；需求求和与 remaining 必须有限，remaining 可以为负。一个预算内使用同一单位，由输入资料标明。

输出仅包含 budgets，按输入顺序返回每项的 id、demand、remaining、withinBudget，保留原始计算精度。

## 操作步骤
读取授权的资源材料，组织预算与分配。通过 run_script 请求 resource-budget/calculate，入口为 scripts/calculate.mjs。宿主将 JSON 输入写入标准输入，取得标准输出的单份 JSON 结果；成功要求退出码为零和输出有效。

计算需求总和 demand，再计算 remaining = available - reserve - demand，按 remaining >= 0 得到 withinBudget。无效输入以非零退出码和有界标准错误诊断返回。

结合资料判断分配是否合理及需求优先级，预算结果本身不代替资源决策。将结果与依据交给宿主保存为产物。
