# task_099 v3.5 交互减法·遮挡规则 R1/R2/R4

## 描述
v3.5 交互减法·遮挡规则 R1/R2/R4——全屏弹窗（设置屏等）打开时四角常驻件统一降对比+禁点（复用 096 L1 降对比通道+pointer-events），关闭全恢复；chat-drawer 等侧滑抽屉只压暗对侧不锁四角；所有全屏弹窗 ESC+遮罩点击双关闭途径

## Requirements
方案 docs/interaction-reduction-v3.5.md §二；分支 demo/v3.3 commit 前缀 v3.5；tsc 零错测试全绿；不破坏 096/094 已有 L3 机制

## Acceptance
- [ ] 弹窗开→四角降对比禁点+弹窗关→全恢复断言
- [ ] ESC/遮罩双关闭断言
- [ ] 抽屉不锁四角断言

## deliverables
见 acceptance
