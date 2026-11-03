# agent_task_094 —— HUD v3.4 · Z6 沉浸层：L3 接管逻辑接线 工作文档

> 任务：task_094 —— 三类演出（里程碑大字 / ▶60 秒重演 / 导演取景框）激活时进入 L3
> （联动 task_096 地基：L1 降到 18% 对比、L2 事件轨收起），演出结束自动恢复；
> 导演模式持续期间中屏保留取景框角标。
> 方案依据：docs/hud-redesign-proposal.html §2.5（分区规格表 Z6 行）+ §2.3（信息三层级）。
> 分支：demo/v3.3（commit 前缀 v3.4）。日期：2026-11-03。
> 前置：task_096（层级地基，commit c2ee5c4）/ 080 里程碑 / 082 回放 / 081+092 导演取景框。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/types.ts` | **契约增补**：`type LayerTrigger = 'milestone' \| 'replay' \| 'director'` + `WorldState.layerBase?`（手动档）+ `WorldState.layerHolds?`（演出占用）+ `HudCommand` 的 `hud.layer.hold`；`infoLayer` 的语义收紧为**有效档** |
| `src/core/info-layer.ts` | **层级纯语义增补**：`LAYER_TRIGGERS`（占用词表，有界）/ `isLayerTrigger` / `resolveInfoLayer`（有效档 = 手动档 + 占用裁决） |
| `src/core/store.ts` | 写入口径：`applyLayerHold`（占用增删，值没变即同一引用）+ `effectiveInfoLayerValue`（有效档 → 落库值，L1 回落 undefined）+ `setLayerHold`；`setInfoLayer` 改写**手动档**；`setDirectorEnabled` 同步占用 |
| `src/core/runtime.ts` | `hud.layer.hold` 命令接线 → 写占用 → 重算有效档 → 广播；非法占用源忽略 |
| `src/hud/components/marquee/milestone.ts` | 大字在屏时**占用**沉浸层（发 `hud.layer.hold`），收起 / 元素离场时**释放**；宿主标 `data-srf-layer="L3"`（通用属性口径） |
| `src/hud/components/replay/replay-controller.ts` | 新增注入口 `setImmersive`：播放中占用、播完 / 停掉 / 释放时归还 |
| `src/app/main/main-entry.ts` | 组合根接线：回放控制器的 `setImmersive` → `adapter.dispatch({type:'hud.layer.hold', trigger:'replay', active})` |
| `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | `hud.layer.hold` 入册命令白名单（远程模式渲染进程不起 core runtime） |
| `src/core/__tests__/layer-hold.test.ts` | core 侧单测 10 例（占用纯函数 / 命令→状态→广播 / 叠加裁决 / 手动档被记住 / 导演两条入口） |
| `src/hud/__tests__/immersive-layer.test.ts` | **端到端集成测试**（jsdom）8 例：演出期间 L1 降到 18% + L2 收起、结束恢复、中断不卡死、叠加、导演常驻 |
| `src/world/__tests__/info-layer.test.ts` | world 侧增补 2 例（导演期间取景框挂进 L3 状态 / 手动介入后退出） |
| `src/hud/__tests__/milestone.test.ts` | 既有单测随命令流变化更新（多一条 `hud.layer.hold`），并补占用/释放断言 |

## 2. 关键设计决策

1. **占用（hold）语义，不是「切档」语义**：三类演出可以**同时**在演（里程碑大字撞上 60 秒重演）。
   若沿用 `hud.layer.set` 的绝对切档，先结束的那个会把另一个的沉浸态一起撤掉。故新增
   `hud.layer.hold { trigger, active }`：core 侧按**占用列表**裁决「有效档 = 有占用即 L3，
   否则回手动档」。`hud.layer.set` 的语义随之收紧为「改**手动档**」（演出结束后要回得去）。
2. **真相仍在 core，HUD 不存第二份**：占用经 HudCommand → core/store → state 广播 → HUD 侧
   层级控制器改 CSS 变量；world 侧订阅同一份广播（导演取景框据此让位）。铁律零破例。
3. **手动档与有效档分两个字段**（`layerBase` / `infoLayer`）：「演出结束后回到哪一档」必须有地方记着，
   否则一出演出就回不去 L1/L2。有效档是**算出来的**（手动档 + 占用），不是存出来的。
4. **导演占用与导演开关落在同一处**（`store.setDirectorEnabled`）：开关有两条入口（HUD 的
   `camera.director` 命令 + world 手动介入回写），都汇到这一个方法 —— 占用与开关永远同步，
   不会出现「框在但层级没进 L3」。
5. **演出中断不卡死**：里程碑在 `disconnectedCallback` 里释放占用（主屏重绘会重写 `#hud-root`，
   大字被摘掉时占用必须归还）；回放控制器在 `stop()` / 播完 / `dispose()` 三条路径上都释放；
   core 侧「值没变即不广播」，重复占用同源不会刷状态。
6. **命令发不出去也不能把演出带崩**：里程碑的占用/释放包在 try/catch 里（层级退回常驻档即可），
   且 core 的 `notify` 是「先落库再广播」—— 监听者抛异常不会留下「占着不放」的脏状态。
7. **常量不进组件**：本任务**没有新增数字** —— 演出时长沿用 `MARQUEE_METRICS.milestoneDurationMs`，
   对比口径沿用 `HUD_LAYER_METRICS`（0.18），回放间隔沿用 `REPLAY_METRICS`。唯一事实源未被稀释。
8. **零新依赖、零范围外改动**：只碰 core 契约 / store / runtime、两个 HUD 组件（各加一处接线）、
   一个组合根、一个协议白名单、三个测试文件。顶栏 / 控制岛 / 事件轨**一行未动**。
9. **world 侧零改动**：`src/world` 只增了一个测试文件 —— 取景框本体（092 交付）由
   `camera.director` 事件驱动，本任务只把它「挂进 L3 状态」（导演开着 = 有占用 = 层级 L3）。

## 3. 验证

- `npx tsc --noEmit` → **0 错**（无输出）
- `npx jest src/hud --silent --maxWorkers=2` → `Test Suites: 52 passed, 52 total / Tests: 1022 passed, 1022 total`
- `npx jest src/core src/world src/app --silent --maxWorkers=2` → `Test Suites: 125 passed, 125 total / Tests: 2017 passed, 2017 total`
- `npx jest --silent --maxWorkers=2`（全量）→ `Test Suites: 258 passed, 258 total / Tests: 6 skipped, 4805 passed, 4811 total`
- `npx eslint --cache <改动文件>` → 改动文件**零错**（`main-entry.ts` / `runtime.ts` / `milestone.ts`
  的 `import/order` 报错是**既有问题**：已用 `git show HEAD:<file>` 复现确认为基线错误，非本任务引入）
- 验收断言（`src/hud/__tests__/immersive-layer.test.ts`，真实链路：组件 → HudCommand → core/bus →
  runtime → store → state 广播 → HUD 层级控制器 → 根元素 CSS 变量）：
  - 里程碑大字在屏 → `--srf-layer-l1-opacity = 0.18`、`--srf-layer-l2-visibility = hidden`；收起 → 恢复 1 / visible
  - ▶60 秒重演播放中 → 同上；播完 → 恢复
  - 导演模式开着 → 同上（L1 让位、L2 收起，中屏只剩取景框）；关掉 → 恢复
  - 大字被中途摘掉 / 回放被 dispose → 层级回 L1，**不卡死在 L3**
  - 里程碑撞上重演 → 先结束的那个放手，另一个还在演 → 仍是 L3；都结束 → 回手动档

## 4. 未尽事项

- **未做真实浏览器手测**：本次验证是「真实链路 + 真实 DOM 变量断言」，未起 vite dev server 肉眼复核
  （里程碑 / 重演 / 导演三条路径在浏览器里的观感）。需要时可按 §3 的断言口径补一次 Chromium 实测。
- **回放播放中控制岛（L1）降到 18% 对比**：按规格「激活时 L1 → 18% 对比」执行，副作用是
  「▶60 秒」按钮在重演期间几乎不可见（只能等它播完或用其它入口停）。若要保留停播入口，
  需给控制岛开一个「L3 期间保底可见」的例外（改 `HUD_LAYER_REGIONS` 一张表即可）。
- **`strat-milestone` 挂 `#hud-root` 的既有缺陷未修**：主屏重绘会重写 `#hud-root` 的 innerHTML，
  大字 / 跑马灯会被一起抹掉（task_084 已为回放角标修过一次，里程碑与跑马灯未修）。
  本任务在 `disconnectedCallback` 里释放占用，抹掉时层级会正确回落 —— 但**演出本身**会被打断。
  修它要把里程碑挪到 `#hud-side`（属 task_084 同款改动，不在本任务范围）。
- **未新增常量**：本任务没有新的数字要进 `visual-spec`（时长与对比口径全部沿用既有唯一事实源）。
