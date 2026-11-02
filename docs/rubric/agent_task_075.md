# task_075 工作文档 —— 单位动画八态（DEMO-PLAN §2）

## 交付范围

按 `docs/DEMO-PLAN.md` §2「单位动画八态」实现，并加一个独立 dev 验收页逐态可触发。

| 态 | 规格 | 兑现位置 |
|---|---|---|
| 待机 | bob ±4px/2s + 眨眼 3-6s（闭眼 120ms）+ 天线 ±5° | `appearance/unit-animation.ts` 纯逻辑 → `objects/unit-layer.ts` 渲染 |
| 工作 | 前倾 8° + 微颤 ±1px + 头顶琥珀进度弧 0→360° + 每 1.5s squash-stretch 0.9→1.05→1.0 | 同上 |
| 卡住 | 灰度 50% + 头顶红 ❗ 每 2s 弹跳 + 身体同步抖 | 同上 |
| 完成 | squash → 原地跳 20px → 落地星尘 8-12 个小三角四散淡出 | 完成演出 = 与基态正交的一次性瞬态 |
| 摸鱼 | 头顶 z→Z→Z 依次上升淡出循环 | 同上 |
| 选中 | 脚下青色旋转虚线环（直径 64px，2s/圈） | task_045 的实线椭圆退位为框选预览 |
| hover | 放大 1.1x + pointer 光标 + 底盘喷口微光 | `BattlefieldScene.onPointerMove` → `UnitLayer.setHovered` |
| 点击 | 白圈涟漪 200ms 扩散 + squash 一下 | `BattlefieldScene.onPointerUp` → `UnitLayer.pulseClick` |

## 关键设计取舍

1. **五基态 + 三叠加**：前五态 body 姿态互斥；后三态可与任一基态共存（生产里「正在工作的单位被选中」是常态）。
   dev 强制态时叠加层一并裁决（强制「待机」= 干净的待机）。
2. **相位由 id 哈希派生**（FNV-1a + 末置雪崩），不用 `Math.random()`：可重现、单测可断言、不同 id 散开。
3. **属性面不相交**：新增 `rig` 动画骨架层 —— 移动 tween 写 `container.x/y`，呼吸写 `sprite.scaleY`，
   动画写 `rig` 的旋转/位移/缩放，三者互不覆盖。
4. **完成演出与基态正交**：生产里「任务完成」时单位可能仍在工作，完成演出是叠加而非改基态。
5. **dev 页另起一页**：`world-dev.html` 的契约是「战场上看到的必须来自真实 store，不塞假单位」，
   八态验收需要确定性样例单位 → 另起 `src/world/dev/animation-dev.html`，两个契约各守各的。

## 唯一事实源

尺寸 / 时长全部取自 `src/core/theme/visual-spec.ts` 的 `UNIT_ANIMATION_METRICS`，
world 侧门面 `src/world/visual-spec.ts` → `src/world/theme.ts` 转发；渲染层零色值字面量。

## 验证

- `npx tsc --noEmit` → 零错（并在只含本单改动的临时 worktree 上复验，排除并行任务在途文件干扰）。
- `npx jest src/world --maxWorkers=1` → 16 suites passed / 1 failed（`brand-presets.test.ts` 读 `dist/` 的既有失败，与本单无关），260 tests passed。
- 新增单测 `src/world/appearance/__tests__/unit-animation.test.ts`（33 例）覆盖八态规格量与相位错开不变量。
- 浏览器肉眼验收：`/src/world/dev/animation-dev.html`（10 个按钮：八态逐态 + 同屏八态 + 回到自动）。
