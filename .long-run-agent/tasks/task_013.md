# task_013

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_013.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: settings设置屏-模块

## requirements

把旧 `RTSSettings.vue`（渲染偏好）与 `ProviderSettingsModal.vue`（连接配置）里**属于本地偏好**的那部分
收敛为 v3 的 `hud/screens/settings-screen.ts`（`<strat-settings-screen>`，大面板形态、可独立挂载），
设置项按三组摆开：**外观 / 偏好 / 危险区**。

- 皮肤切换（default / pixel）：发既有 HudCommand `theme.set`，token 切换由
  `hud/bridge/bus-adapter` 入口处调 `theme-controller.apply` 完成（组件零硬编码，只引 `--srf-*`）。
- 语言显示：契约（core/types.ts）目前没有 locale 字段，故**只读**展示当前内置语言，
  不给假的下拉；TODO(v3.i18n) 已标注语言域落地后的改法。
- 偏好开关（音效 / 通知）：唯一真相是 core 的 `WorldState.settings`；HUD 只发
  HudCommand `settings.set`、等 core 广播回填，**不本地乐观更新**。
  契约增补（`SettingsView` / `BooleanPreferenceKey` / `DEFAULT_SETTINGS` / `settings` 字段）一律带
  `@since v3.5`，且字段走**可选增补**，不打破既有 WorldState 构造点的编译。落库写在
  core/store 的 `setPreference`（纯函数 `applyPreference`），与 `setState` 同一约定：值没实质变化不广播。
- 危险区（重置编组 / 清理缓存）：破坏性动作一律两步确认（先点、再确认）才发命令；
  `selection.reset` / `cache.clear` 在契约里定义、core 侧按未落地处理并注明 TODO 接线。
- 性能：core 每次状态变更都全量广播，本屏用 `settingsSignature` 判重，
  单位 / 任务 / 日志变动一律不触发本屏重渲染；卸载必须退订。
- 装配：导出 `mountSettingsScreen(deps, host)` 统一口径（与 mountMissionConfirm 一致）。

## acceptance

- [x] 设置屏可挂载展示（mount → Shadow DOM 渲染出三组设置项，单测断言 DOM 结构）
- [x] 皮肤切换实测生效（单测用真 theme-controller + 真 token 文件，断言两张样式表启用状态翻转、
      生效表内容为像素皮肤 token）
- [x] 偏好开关读写走 HudCommand / WorldState（点开关 → `settings.set` → core store 落库 → 广播 → 本屏重渲染）
- [x] typecheck（tsc --noEmit、tsc -p tsconfig.test.json）0 错误
- [x] build（backend + frontend）通过
- [x] 逻辑单测（设置屏 16 条 + core 偏好落库 6 条；全仓 139 套 / 3321 条全绿）

## 交付物

- `src/hud/screens/settings-screen.ts` —— `<strat-settings-screen>` Web Component：
  三组渲染、皮肤切换、偏好开关、危险区两步确认、`mountSettingsScreen` 装配工厂、
  纯派生函数（`resolvePreferences` / `settingsSignature`）与展示词表。
- `src/hud/__tests__/settings-screen.test.ts` —— 设置屏单测（渲染 / token 切换 / 偏好闭环 / 判重 / 退订）。
- `src/core/__tests__/settings.test.ts` —— core 偏好落库单测（默认值、写入广播、无变化不广播）。
- `src/core/types.ts` —— 契约增补（@since v3.5）：`BooleanPreferenceKey` / `SettingsView` /
  `DEFAULT_SETTINGS` / `WorldState.settings`（可选）/ HudCommand `settings.set`、`selection.reset`、`cache.clear`。
- `src/core/store.ts` —— 偏好落库面：`applyPreference`（纯函数）+ `CoreStore.setPreference`。

## 验证证据（完成前必填）

- [x] **实现证明**: 设置屏以 `SettingsScreenDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>` 注入，
  偏好只认 `WorldState.settings`（缺省回落契约 `DEFAULT_SETTINGS`），开关点击只发 `settings.set`、
  由 core 广播回填；皮肤点击发 `theme.set`，真 token 切换由 adapter 入口的 theme-controller 完成；
  危险区先置 `_pending` 确认态、二次确认才 `dispatch({ type: id })`。
  渲染判重 `settingsSignature = \`${soundEnabled}|${notificationsEnabled}\``，与偏好无关的广播不碰 DOM。
  core 侧写入面是纯函数 `applyPreference` + `setPreference`（值未变返回同一引用 → 不广播）。
- [x] **测试验证**: 见下方命令输出（typecheck 0 错、typecheck:tests 0 错、build 通过、
  设置屏单测 16/16、core 偏好单测 6/6、全仓 jest 139 套 3321 条全绿）。
- [x] **影响范围**: 新增 2 源文件 + 2 测试文件；`src/core/types.ts` / `src/core/store.ts` 为契约与落库面的
  最小增补（settings 为可选字段，既有 WorldState 构造点零改动）。未触碰 `src/world`、未改
  `src/core/runtime.ts`（接线按分工留 TODO）、未改动任何既有 panels/screens 实现、未引入新依赖。

### 测试步骤

1. `npm run typecheck` / `npm run typecheck:tests`
2. `npx jest src/hud/__tests__/settings-screen.test.ts --maxWorkers=1`
3. `npx jest src/core/__tests__/settings.test.ts src/core/__tests__/store.test.ts --maxWorkers=1`
4. `npm test`
5. `npm run build`

### 验证结果

```
$ npm run typecheck
> tsc --noEmit
(无输出，退出码 0)

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
(无输出，退出码 0)

$ npx jest src/hud/__tests__/settings-screen.test.ts --maxWorkers=1
PASS src/hud/__tests__/settings-screen.test.ts
  纯派生函数
    ✓ settings 缺省时回落到契约默认值（两侧共用同一个 DEFAULT_SETTINGS）
    ✓ settings 存在时以 core 广播为准
    ✓ 渲染签名只跟偏好走：单位/任务变动不触发本屏重绘
    ✓ 偏好词表与危险动作词表不是空的（防止渲染层漏渲染整组）
  设置屏：挂载与渲染
    ✓ 挂载后展示三组设置项（外观 / 偏好 / 危险区）
    ✓ 语言只读展示（当前契约无 locale 字段，不给假的下拉）
    ✓ 偏好开关按 core 广播的值渲染（开/关）
    ✓ 返回主屏 → ui.navigate(main)（点 strat-button 的真按钮，走完整事件链）
  皮肤切换：实测 token 换掉（真 theme-controller + 真 token 文件）
    ✓ 点像素 → 发 theme.set，且两张 token 表的启用状态真的翻转
    ✓ 重复点当前皮肤是 no-op：不再发命令（避免来回切的无谓广播）
  偏好开关：HudCommand → core store → WorldState → 本屏
    ✓ 点音效开关 → settings.set(false) → 落库 → 广播 → 本屏换成「关」
    ✓ 再点一次回到开（值取自 core 当前值，不是本地自增）
    ✓ 无实质变化时不广播（设置屏不因别的状态变动重绘：DOM 节点身份不变）
  危险区：两步确认
    ✓ 第一下只进入确认态，不发命令
    ✓ 确认后才发命令；取消则什么都不发
  生命周期
    ✓ 卸载后本屏退订（反复挂卸不累积监听器）

Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total

$ npx jest src/core/__tests__/settings.test.ts src/core/__tests__/store.test.ts --maxWorkers=1
Test Suites: 2 passed, 2 total
Tests:       18 passed, 18 total      # 本任务新增 6 条 + store 既有 12 条

$ npm test
Test Suites: 139 passed, 139 total
Tests:       7 skipped, 3321 passed, 3328 total
Time:        22.326 s

$ npm run build          # = build:backend && build:frontend
dist/frontend/assets/ai-langchain-D6QZZYD_.js  966.11 kB │ ...
✓ built in 2m 5s
(backend 退出码 0；仅有 vite 的 chunk>500kB 体积提示，非本次改动引入)

$ npx eslint --cache --max-warnings 200 src/hud/screens/settings-screen.ts src/core/types.ts src/core/store.ts
(0 errors；两个 __tests__ 文件命中仓库既有的 ignore 规则，与同目录其它测试一致)
```

### 未尽事项（下一任务接手）

- `core/runtime.ts` 接线（本任务按分工未动）：`settings.set` → `store.setPreference`；
  `selection.reset` → `core/unit/selection`；`cache.clear` → 持久化层。
  未接线前这三条命令走 `onUnhandled`（未落地）通道。
- 设置屏尚未挂进 `main-screen.ts`（本任务禁止改动既有 screens 实现）：需在接线任务里把
  `ui.navigate({screen:'settings'})` 真正路由到本屏，并把设置屏挂到主屏导航上。