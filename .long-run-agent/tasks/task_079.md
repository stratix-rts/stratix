# task_079 摄像机与小地图

## 描述

按 DEMO-PLAN.md §5 后半：拖拽平移+滚轮缩放 0.6-1.6x+边界回弹；双击单位跟随（再双击解除）；ESC 回全景；小地图右下 200x120（岛屿轮廓+单位状态光点+视野白框+点击跳转+MAP 角标）；氛围彩蛋（30-60s 随机漂云；真实时间 19-24 点网格微暖）。

## Requirements

小地图走契约（hud widget 或 world 内嵌层）；彩蛋不产生总线事件。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 缩放边界回弹正确
- [ ] 跟随/解除/回全景可用
- [ ] 小地图点击跳转准确

## deliverables

src/world/camera/ 扩展、minimap 组件、云/时段装饰

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
