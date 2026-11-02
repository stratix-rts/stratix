# task_076 气泡说话系统

## 描述

按 DEMO-PLAN.md §3：speech-templates.ts 离线模板句库（开工/完成/报错/被派活/支援/性格彩蛋池 20%）；气泡视觉圆角黑底85%白字13px+尾巴、最大宽160px两行截断；出入场 Back.Out 250ms / 上浮淡出 300ms；存活 4s 自动收；同屏≤3排队；同单位 5s 冷却。由 core 总线事件驱动。

## Requirements

world 只消费总线事件不生产；无网络依赖；气泡为 Phaser 侧对象（字号口径承接 task_110 未尽事项：战场文字不随 HUD demo 字号）。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 四类事件触发正确气泡
- [ ] 频率限制生效（≤3/5s冷却/4s自动收）
- [ ] 出入场动效符合 visual-spec 时长

## deliverables

src/world/speech-templates.ts、气泡渲染层、总线事件接线

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
