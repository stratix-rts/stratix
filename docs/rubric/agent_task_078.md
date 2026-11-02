# task_078 工作文档 —— 地图地面与任务建筑（DEMO-PLAN §5）

## 交付范围

按 `docs/DEMO-PLAN.md` §5 前半实现「地面 + 建筑 + 区域点亮」三件事，全部纯代码绘制（零位图）。

| 规格 | 兑现位置 |
|---|---|
| 深色格网 64px（调色板 grid 色） | `objects/ground-layout.ts` 的 `gridSegments`（纯几何）→ `objects/ground-layer.ts` 一次画完（静态层不逐帧重绘） |
| 横向扫描光带 12s 周期 / 120px 宽 / 8% 白 | `ground-layout.ts` 的 `scanBandX`（elapsed 的纯函数）+ `ground-layer.ts` 的 counter tween 驱动 |
| 四角坐标刻度 | `ground-layout.ts` 的 `cornerTickSegments` / `cornerLabels` → `ground-layer.ts` 画 L 形角标 + 坐标数字 |
| 边缘渐晕 | `ground-layer.ts` 的 `drawVignette`（四条自边缘向内的黑色渐变带） |
| 建筑三态：地基灰框 → 施工脚手架 + 吊臂摆动 → 完成实心小塔 + 窗户逐个点亮 200ms | `objects/task-building.ts` 的 `buildingStateFor`（core 相位 → 三态的纯映射）+ `objects/building-layer.ts` 的三套画法 |
| 区域全部完成 → 底色 5%→12% 渐变 1s + 区域名浮字 | `task-building.ts` 的 `MapBoard.sync` 报「刚点亮」跳变 → `building-layer.ts` 做一次性过渡 + 一次性浮字 |

## 关键设计取舍

1. **「区域/建筑」落到 v3 契约**：DEMO-PLAN 原文是「项目 = 岛屿，域 = 区域，任务 = 建筑」，但 v2 的「域」
   已随 Zone 退役（REFACTOR_PLAN_V3 §4），v3 契约里没有「域」。替代映射：**区域 = MissionView**（编组任务）、
   **建筑 = CharacterTask**（角色任务），归属关系用 core 的 `CharacterTask.missionId`。没挂 mission 的普通
   派发落进一块固定的「未归属任务」空地，不假装属于某个区域。
2. **相位真相只在 core**：`world` 不判业务状态。`task-building.ts` 只做「core 的 status → 三态」的翻译，
   区域点亮有两个口径（mission 收工 / 区域内全部完工），由 core 的状态派生，渲染层只画结果。
3. **扫描光带用「elapsed 的纯函数」而不是 tween 插值**：tween 的 repeat 会在周期末把值瞬间拉回起点
   （视觉上一次跳变）。这里把位置定义成时间的连续函数，并把行程两端各多出一个带宽 —— 相位回绕发生在
   光带完全出界之后，**循环点不跳变**，而且这件事能被单测直接断言。
4. **区域占格「中心向外 + 不漂移」**：7×5 = 35 个地块格（行列皆奇 → 正中一格中心正好落在战场中心），
   第一个区域落在战场正中（默认镜头正对着那儿）；已占过格的区域沿用旧格，新增任务不挪位置。
5. **纯逻辑与 Phaser 分层**：`ground-layout.ts` / `task-building.ts` 零 Phaser 依赖（node 单测直接引），
   `ground-layer.ts` / `building-layer.ts` 只负责画。
6. **一次性资源**：逐窗点亮用「一次性延时链」（画完即焚），吊臂摆动用 tween（离开施工态即停），
   场景 shutdown 时地面层与建筑层的显示对象 / tween / 定时器一并回收（perf：资源必须可清理）。

## 唯一事实源

色值全部走 `src/core/theme/visual-spec.ts` → `src/world/visual-spec.ts` → `src/world/theme.ts` 的
`WORLD_PALETTE`，渲染层零色值字面量（core/theme 的色值纪律单测会把散落的字面量揪出来）。
本单同时修了一处越界：战场底板底衬原为网格色，与格网线同色 → 格网线完全看不见；
按调色板语义（背景基底 = 地面 / 网格线 = 低亮度网格）改回背景基底色，格网才读得出来。

## 验证

- `npx tsc --noEmit` → 零错。
- `npx jest src/world --maxWorkers=1` → 16 suites passed / 1 failed（`brand-presets.test.ts` 读 `dist/` 构建
  产物的既有失败，与本单无关），260 tests passed。
- `npx jest src/core src/hud --maxWorkers=1` → 全绿（1605 tests passed；其中色值纪律单测曾被并行的
  task_075 dev 页里的一个字面量色值打红，已顺手改回调色板取值）。
- 新增单测 `src/world/__tests__/ground-layout.test.ts`（格距 / 光带常量 / 单调性 / 循环点无跳变 /
  四角刻度 8 段 + 4 个坐标标签）与 `src/world/__tests__/task-building.test.ts`（三态映射 / 失败标记 /
  区域归属 / 位次不重叠 / 区域不漂移 / 中心格 / 一次性跳变事件 / 点亮口径）。
- 浏览器肉眼验收：临时 dev 页起真实 `BattlefieldScene`，灌入「地基 / 施工 / 完工 / 停工 + 一个整区完工」
  的任务快照（走真实总线 → 桥接层 → 场景），确认格网、扫描光带、四角刻度、边缘渐晕、三态建筑、
  区域点亮与区域名浮字全部按预期出现（验收后临时页已删除，不入库）。
