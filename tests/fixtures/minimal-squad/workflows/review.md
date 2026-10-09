---
id: review
title: Review
entry: inspect
nodes:
  - id: inspect
    title: Inspect
    role: reviewer
    position: { x: 80, y: 120 }
  - id: report
    title: Report
    role: command
    position: { x: 400, y: 120 }
edges:
  - source: inspect
    target: report
    label: Return evidence
---
## 目标
Review the supplied material.

## 输入
The material to review.

## 步骤
### inspect
Review the material and collect evidence.

### report
Summarize the findings.

## 输出
A conclusion supported by evidence.

## 验收要点
The evidence is traceable to the supplied material.
