# task_095 HUD v3.4 收口

## 描述

功能对照表 40 项逐项验证脚本化（e2e 断言每项可达）+ 四角碰撞复验（零重叠断言）+ hud-redesign-proposal.html 增补实施状态列 + DEMO-PLAN.md 补 v3.4 节。

## Requirements

e2e 遵循既有 fake/real 约定；38+44 基线断言不回归；tsc 零错；build 绿。

## Acceptance

- [x] 40 项功能断言全绿
- [x] 碰撞断言通过
- [x] 基线断言不回归
- [x] tsc+build 绿
- [x] 两文档更新

## deliverables

e2e 断言 + 碰撞复验脚本 + 文档状态（依赖 089-094 全部）

## 验证记录（2026-11-03）

### (a) 40 项逐项断言 —— 按「哪层能确定地断言」分三处

40 项不是一套测试能盖住的（有的画在 Phaser 画布上、有的在组合根），按可断言的位置分三处，
三处加起来正好 40 项、互不重叠：

| 位置 | 项数 | 文件 | 口径 |
|------|------|------|------|
| HUD 侧（jsdom） | 32 | `src/hud/__tests__/v34-feature-matrix.test.ts` | A1–A13 / B1–B3 / C1–C2 / D1–D6 / E1–E5 / F2 / F3 |
| 世界侧（node，纯模块） | 7 | `src/world/__tests__/v34-feature-matrix.test.ts` | F1 / G1 / G3 / G4 / G5 / G6 / G7 |
| 组合根（源码装配契约） | 1 | `src/app/__tests__/v34-main-entry-buttons.test.ts` | G8 |

why 世界侧断言在纯模块而不是浏览器：jsdom 没有 canvas 渲染，像素级「画没画出来」量不出来；
但每项功能的**决策**都在纯模块里（谁先冒泡、镜头给谁、气泡几拍一次、八态怎么推导）——
断言决策比断言像素更早暴露回归，画布那一层由 fake 模式的演示剧本兜底。

G4（回放气泡减半）没有纯 seam，用「常量 + 读源码钉住闸门 + 显式验半频语义」三段代替：
`REPLAY_METRICS.bubbleEveryN === 2` + `BattlefieldScene.ts` 里的 `this.replayBubbleTick % REPLAY_METRICS.bubbleEveryN !== 0` + [2,4,6] 的放行拍序。

G8 的口径澄清：proposal §1.1 写的「主入口按钮组（↗ 回放 / ⟳ 重置）」里，那两个字形
**在产品代码与全部 git 历史里零命中**——是 proposal 行文里的示意图，从未落地。
断言按产品里真实存在的两个一键入口写：「▶ 60 秒看完今天」（控制岛内）与设置屏「重置编组」
（主屏 ⋯ → 去设置 → 可点）。字形对本身的缺位记在「未尽事项」。

### (b) 四角碰撞复验 —— 复用 090 的脚本，加一条「成对零重叠矩阵」

`scripts/check-hud-island-layout.mjs`（090 建、093 扩）本任务再扩一条 ⑨：
顶栏 / 事件轨 / 小地图 / 控制岛 / 时间戳角标**五个盒子两两之间包围盒交集面积恒为 0**。
why 做成矩阵而不是逐条写死：以后新增一个边角件，它与已有件的碰撞**自动**进网，
不用记得补一条断言（漏一条 = 漏一个碰撞位）。

### (c)(d) 两文档更新

- `docs/hud-redesign-proposal.html` §4 表增「实施状态」列（逐项标 commit 号）+ 列口径说明；
- `docs/DEMO-PLAN.md` 增 §13（v3.4 交付清单 + commit 对照 + 验收资产 + 未尽事项）。

commit 号口径：任务书里 090 记作 `32a3289`，但那是**没有落进本分支**的一次提交（内含 090+092）——
本分支上的实际提交是 `140949e`（只含 090）。文档一律以 `git log` 实测为准。

### 验证输出

`npx tsc --noEmit` → 0 错（无输出）

`npx jest src/hud/__tests__/v34-feature-matrix.test.ts src/world/__tests__/v34-feature-matrix.test.ts src/app/__tests__/v34-main-entry-buttons.test.ts --maxWorkers=2`
→ `Test Suites: 3 passed, 3 total / Tests: 44 passed, 44 total`（44 个用例覆盖 40 个功能项）

`npx jest --maxWorkers=2`（全量）→ `Test Suites: 261 passed, 261 total / Tests: 6 skipped, 4851 passed, 4857 total`

`node e2e-tests/demo-flow.e2e.mjs`（fake 模式）→ `断言：45/45 通过`（44 条演示断言 + 1 条进程回收纪律）

`node e2e-tests/session-capabilities.e2e.mjs`（fake 模式）→ `断言：38/38 通过`（会话域基线不回归）

`npm run build` → `✓ built in 3.83s`（backend tsc+tsc-alias 绿，frontend 180 modules transformed）

`node scripts/check-hud-island-layout.mjs` → `✓ 碰撞断言全过：……五个盒子成对零重叠`（1280×720 / 1920×1080 / 1024×768 三档，10 对全 ∅）

`node scripts/check-hud-feature-matrix-status.mjs`（本任务新增）
→ `✓ 状态列一致性全过：40 行各有实施状态、commit 号真实存在、40 项都有断言用例、部分落地项均已登记未尽事项`

### 未尽事项（不在本链顺手修）

| 项 | 状态 | 说明 |
|----|------|------|
| C2 顶栏「已跳转」一次性确认 | 未落地 | 小地图点击跳转本身原样可用；全仓 `src/` 无「已跳转」字样 |
| D2 「此刻事件卡」浮层 + 事件轨同步高亮 | 未落地 | scrubber 拖动与 seek 原样可用；全仓无该组件 |
| G8「↗ 回放 / ⟳ 重置」字形对 | 从未存在 | 全仓与全部 git 历史零命中，是 proposal 行文里的示意图 |
