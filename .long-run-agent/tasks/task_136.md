# task_136

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_136.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

空状态设计：战场待部署仪式感+面板空态统一-模块

## requirements

- **战场英雄空态**：0 单位时战场有"待部署"画面（扫描网格上的待命光标 / 像素风雷达圈），配一句人话文案
  （如「战场待命中 · 第一位 agent 上场后这里会活起来」）+ 行动引导（按钮 → 新建角色 / 打开命令行）。
  覆盖层挂 world 侧或 HUD 覆盖在 canvas 上均可，**选侵入小的**；行动引导**复用既有事件，不造新路由**。
- **面板空态统一**：会话 / 日志 / 任务 / 角色各面板的空数据态用同一套空态组件模式（图标位 + 一句话 + 可选动作），
  替换"各写各的"；开发者口径文案（如「gateway 真实数据流」）一并人话化。
- **空态走皮肤 token**：现代 / 像素两套皮肤都正确呈现。
- 交付物：截图落 `reports/shots/`，文件名带 `-r5` 前缀 + `-empty` 后缀（与 135 同前缀，文件名区分）；
  `npx tsc --noEmit` 与相关 jest 全绿。

## acceptance

- 0 单位时战场有空态画面（两皮肤各一张截图证据），文案是人话，且行动引导**点击真通**（到新建角色或命令行）。
- 至少 4 个面板空态统一（截图对照可见同一套版式）。
- 建一个角色后战场空态消失、删掉后回来 —— **真实联动，非 mock**。
- `npx tsc --noEmit` 绿；相关 jest 绿。
- 不动布局骨架 / 不动 135（图标·组件细节）与 137（排版 token）在途文件 / 不动 gateway / 不引依赖 / 不 mock 数据。

## 交付物

- `src/hud/components/battlefield-empty/battlefield-empty.ts`（新）—— **战场「待部署」空态覆盖层**
  `<strat-battlefield-empty>`：CSS 画的像素雷达（同心圈 + 扫描扇 + 待命光标脉冲）+ 大标题「战场待命中」+
  一句话「第一位 agent 上场后，这里会活起来」+ 操作提示（左键框选 / 右键移动 / 滚轮缩放 / 双击跟随）+
  两个行动引导按钮（「新建角色」「打开命令行」）。
  - **放在 HUD 侧覆盖 canvas**（选侵入小的）：world→HUD 没有既有总线通道（world 只发 WorldEvent），
    按钮走 HUD 侧既有能力；皮肤 token 也只存在于 HUD。
  - 显隐跟 core 广播走：`units.length > 0` → `hidden`（首帧默认 hidden = 失败时不出错位）。
  - 容器 `pointer-events:none`、按钮 `pointer-events:auto` → 覆盖层在场时画布仍可框选/拖动。
  - 全部颜色/尺寸走 `--srf-*` token → 现代皮 / 像素皮两套都对；`prefers-reduced-motion` 下停动画。
- `src/hud/components/empty-state/empty-state.ts`（新）—— **统一面板空态组件**
  `<strat-empty-state>`：图标位（CSS 画的雷达环，不依赖字形 → 像素皮不缺字）+ 一句话（light-DOM 插槽，
  调用方给文案，组件只管版式）+ 可选动作按钮（点了派 `strat-empty-action`）。
  影子 DOM 在**构造期**建（元素先 createElement 后入 DOM 时属性/断言才不落空）。
- `src/app/main/onboarding-host.ts` —— `OnboardingHost` 加 `reopen()`：清掉「首启一次性」settled 态后按最近状态重判，
  让「新建角色」这条**随时可发起**的动作走既有向导（不走通时由调用方兜底，绝不硬挂一个点不动的向导）。
- `src/app/main/main-entry.ts` —— 组合根接线：挂 `mountBattlefieldEmpty(hudRoot, …)`（订阅总线状态）、
  「新建角色」→ `onboarding.reopen()`（起不来 → 既有路由 `ui.navigate('character')`）、
  「打开命令行」→ 命令面板输入框聚焦；卸载时 `unmountBattlefieldEmpty()`（退订 + 卸层）。
  另加 dev-only 调试句柄 `window.__srfApp`（只暴露命令口与状态快照，供自动化用**真命令**验联动）。
- `src/world/scenes/BattlefieldScene.ts` —— 删掉世界层的开发者口径空态提示（`空战场 · 0 单位接入（单位来自 gateway 真实数据流）`），
  避免与世界层/ HUD 层两套空态并存；世界层其余表现零改动。
- 面板空态统一（**只换呈现层，文案原样保留**）：`src/hud/panels/agent-panel.ts`、`src/hud/panels/session-panel.ts`、
  `src/hud/panels/log-drawer.ts`、`src/hud/components/chat-drawer/chat-drawer.ts`、
  `src/hud/screens/character-screen.ts`、`src/hud/screens/status-screen.ts`
  —— 各面板的「没有数据」态改用 `<strat-empty-state>`（会话 / 日志 / 角色 / 对话 / 状态屏 / 成长曲线、任务、热力、履历、角色档案）。
- 测试：`src/hud/__tests__/empty-state.test.ts`（新，5 例 —— 含**真 core 联动**）、
  `tests/e2e/empty-state.spec.ts`（新，4 例）、`tests/e2e/playwright.empty.config.ts`（新 —— 不挂 globalSetup，
  不杀在跑的 7523/7524）。
- 截图：`reports/shots/battlefield-empty-r5-empty-modern.png`、`reports/shots/battlefield-empty-r5-empty-pixel.png`（`-r5` 前缀 + `-empty` 后缀）。

## 验证证据（完成前必填）

- [x] **实现证明**: 战场空态 = HUD 侧覆盖层（`<strat-battlefield-empty>`，绝对定位铺在画布上、`pointer-events` 只开按钮），
  文案与配色全走 `--srf-*` token；显隐由 core 广播的 `units` 决定（`units.length > 0` → hidden）。
  面板空态 = 同一个 `<strat-empty-state>` 组件（图标位 + 插槽文案 + 可选动作），六处面板共用；
  开发者口径（gateway / 真实数据流）全部移除（world 层提示删除 + HUD 文案人话化）。
  行动引导复用既有能力：新建角色 → 既有首启向导（`onboarding.reopen()`，起不来退既有 `ui.navigate('character')`），
  打开命令行 → 既有命令面板输入框聚焦；**不造新路由**。
- [x] **测试验证**: `npx tsc --noEmit` 绿；`npx jest --maxWorkers=2` → 278 suites 绿（唯一失败套件
  `src/world/appearance/__tests__/brand-presets.test.ts` 是仓库既知失败：缺 `dist/frontend/spritesheets/item-metadata.json`
  构建产物，与本任务无关）；`npx playwright test --config=tests/e2e/playwright.empty.config.ts` → 4 passed
  （空态出现 + 两皮肤截图 / 行动引导点击真通 / 建角色→空态消失→删角色→空态回来（真命令）/ ≥4 处统一空态）。
- [x] **影响范围**: 只动空态呈现层与组合根接线。面板文案逐字保留（既有 jest 断言不破）；
  布局骨架零改动（覆盖层绝对定位，不占流）；world 侧仅删除开发者口径提示；
  不动 135（图标 / 组件像素细节）与 137（排版 token）的在途文件（`session-panel.ts` / `status-screen.ts` /
  `main-entry.ts` 的排版与皮肤记忆改动**未进本次提交**，以 hunk 级部分提交隔离）；不动 gateway/、不引 npm 依赖、不造假数据。

### 测试步骤
1. `npx tsc --noEmit`
2. `npx jest --maxWorkers=2 --silent`
3. `npx playwright test --config=tests/e2e/playwright.empty.config.ts`（需 7523 vite 在跑；该配置不碰 7524 网关）
4. 肉眼看 `reports/shots/battlefield-empty-r5-empty-modern.png` / `reports/shots/battlefield-empty-r5-empty-pixel.png`

### 验证结果

- `npx tsc --noEmit` → 无输出（0 错）。
- `npx jest --maxWorkers=2 --silent` → `Test Suites: 1 failed, 278 passed, 279 total` /
  `Tests: 6 skipped, 5101 passed, 5107 total`（唯一失败 = brand-presets 缺 dist 构建产物，仓库既知问题）。
  其中 `src/hud/__tests__/empty-state.test.ts` → 5 passed（含真 core 联动：建角色 → `units.length === 1` → 空态 hidden；
  删角色 → `units.length === 0` → 空态回来）。
- `npx playwright test --config=tests/e2e/playwright.empty.config.ts` → `4 passed`。
- 截图：现代皮 / 像素皮各一张，战场中央为雷达 + 「战场待命中」+ 一句话 + 操作提示 + 两个按钮；
  面板空态为「虚线框 + 图标位 + 一句话」同一套版式。
