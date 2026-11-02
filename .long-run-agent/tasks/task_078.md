# task_078 地图地面与建筑三态

## 描述

按 DEMO-PLAN.md §5 前半：深色格网 64px（#1a2140）+横向扫描光带（12s 周期 120px 宽 8% 白）+四角坐标刻度+边缘渐晕；任务建筑三态（地基灰框→施工脚手架+吊臂 ±15° 摆→完成实心小塔+窗户 200ms 间隔逐个点亮）；区域全部完成→底色 5%→12% 渐变 1s+区域名浮字。

## Requirements

建筑态由 core 任务状态驱动；区域点亮一次性过渡。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 三态随任务状态流转正确
- [ ] 区域点亮触发且有浮字
- [ ] 扫描线循环无跳变

## deliverables

src/world/scenes/BattlefieldScene 地面层、建筑对象、区域点亮逻辑

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
