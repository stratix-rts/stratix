# task_110 视觉基建：visual-spec 唯一事实源 + demo-mode 开关骨架

## 描述

按 DEMO-PLAN.md §1 §8：world/visual-spec.ts 集中 palette 七色/尺寸/时长/easing；world theme.ts 与 hud 双 token 皮肤同步扩展；demo-mode 顶栏开关 + localStorage 记忆 + 工程面板隐藏机制（data-engineering 标记）+ 字号 ×1.3。（本任务已完成，commit 5c92087）

## Requirements

常量集中单文件；hud/world 只从此处读色；开关可记忆。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [x] visual-spec.ts 存在且双端单源读色
- [x] demo 开关可切换可记忆，工程面板隐藏字号增大
- [x] tsc 零错、测试全绿不回归

## deliverables

src/world/visual-spec.ts、hud 皮肤 token 扩展、demo-mode 开关骨架

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
