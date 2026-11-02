# task_081 导演模式

## 描述

按 DEMO-PLAN.md §7：hud 顶栏 🎬 开关；开启后镜头自动订阅总线事件——开工/完成→600ms 缓动到点 zoom 1.2x 停 3s 回全景；报错最高优先+红色 vignette 呼吸 2 次；同级取最新；静默>8s 缓慢巡视漂移；手动操作优先并单次退出导演。

## Requirements

依赖 task_079 相机能力与 task_080 事件流。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 三优先级镜头切换正确
- [ ] vignette 脉冲
- [ ] 静默巡视
- [ ] 关闭后手动正常

## deliverables

导演控制器（world 侧）+ hud 开关接线

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
