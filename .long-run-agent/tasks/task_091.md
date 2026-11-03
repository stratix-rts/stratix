# task_091 HUD v3.4 · Z2 事件轨升级（本体）

## 描述

左下 fixed 宽 ≤260px；默认显示 2 条 + 『展开 N 条』；条目 hover 展开详情行（完整文案+相对时间）；点击条目经 core 总线发 focus.unit 事件；保留分级配色与出入场动效。

## Requirements

依据 docs/hud-redesign-proposal.html §2.5 Z2 规格；现有跑马灯为底（src/hud/）；tsc 零错；测试全绿；最小改动。

## Acceptance

- [ ] 折叠/展开正确
- [ ] hover 详情出现无跳动
- [ ] 点击发 focus.unit 总线事件（world 侧由 task_092 消费）
- [ ] 与控制岛零重叠

## deliverables

事件轨折叠/hover 详情/点击事件（依赖 task_096）
