# task_084 e2e 演示收口

## 描述

按 DEMO-PLAN.md §11：fake 模式全流程演示脚本（派活→框选→指令特效→干活动画→卡住→集火→完成插旗→区域点亮→里程碑→回放 60s）+ 新增演示断言 ≥10；既有 38 断言不回归；typecheck+build 绿；DEMO-PLAN.md 更新实施状态表。

## Requirements

e2e 遵循 e2e-tests 既有 fake/real 双模式约定。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 全流程脚本通过
- [ ] 断言 ≥38+10
- [ ] typecheck+build 绿
- [ ] 文档状态表填完

## deliverables

e2e-tests/demo-flow.e2e.mjs + DEMO-PLAN 状态表

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
