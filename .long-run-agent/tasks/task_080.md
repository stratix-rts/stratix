# task_080 事件跑马灯+里程碑大字

## 描述

按 DEMO-PLAN.md §6：hud 左下最近 5 条滚动（图标+短句+相对时间「刚刚/N分钟前」，分级配色绿红蓝金，滑入 250ms/下移/淡出）；每完成 10 个任务触发中央金色大字 1.5s+小幅 camera shake；demo-mode 下强制开启；文案中文无 AI 腔（无三段式无装饰破折号）。

## Requirements

hud widget；文案模板进 theme。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 五条滚动动效正确
- [ ] 里程碑每 10 触发含 shake
- [ ] tsc+hud 测试绿

## deliverables

src/hud/widgets/ 跑马灯组件、里程碑 overlay

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
