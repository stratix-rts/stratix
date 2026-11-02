# task_082 当日回放

## 描述

按 DEMO-PLAN.md §9：底部时间轴 scrubber（缩略热力条=单位密度）拖动重现全天 task_run 事件（单位出现/干活/插旗/跑马灯重演，气泡频率减半）；「▶ 60 秒看完今天」自动倍速+自动导演镜头+左上时间戳角标快进跳字；无数据日空态提示。

## Requirements

数据源=task-session-recorder 落盘真实事件（禁 mock）。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] scrubber 拖动事件重现
- [ ] 60s 模式全流程走完
- [ ] 无数据空态
- [ ] 既有 e2e 38 断言不回归

## deliverables

回放引擎（事件时间轴重放）+ scrubber UI

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
