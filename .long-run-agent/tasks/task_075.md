# task_075 单位动画八态

## 描述

按 DEMO-PLAN.md §2：待机三件套（悬浮bob ±4px/2s 随机相位、眨眼 3-6s/120ms、天线 ±5°）；工作态（前倾8°+微颤±1px+头顶琥珀环形进度弧 0→360°+每1.5s squash-stretch）；卡住态（灰度50%+❗每2s弹跳+身体抖动）；完成态（squash→跳20px→落地星尘粒子 8-12 小三角）；摸鱼态（z→Z→Z 上升淡出循环）；选中旋转虚线环（青 64px 2s/圈）；hover 放大1.1x+光标 pointer+底盘微光；点击白圈涟漪 200ms+squash。dev 调试页加逐态触发按钮。

## Requirements

在 unit-object.ts/appearance 体系上加 AnimationController per unit；相位随机错开禁止整齐划一；色值时长一律取 visual-spec.ts。遵守总线铁律（hud/world 互不引用，只走 core/types.ts 契约）；新文件头部写契约注释；纯代码绘制零资产；npm 用 --legacy-peer-deps（node_modules 已就绪）；不动主仓 /Users/kingj/code/Stratix。

## Acceptance

- [ ] 八态肉眼可辨（dev 页逐态按钮触发）
- [ ] 相位随机不整齐
- [ ] tsc 零错；world 测试全绿（brand-presets 既有 dist 缺失失败可忽略）

## deliverables

src/world/objects/ 动画控制器 + dev 逐态调试页

## 设计参考

docs/DEMO-PLAN.md（v3.3 冻结版）对应章节。worktree /Users/kingj/code/Stratix-demo，分支 demo/v3.3。
