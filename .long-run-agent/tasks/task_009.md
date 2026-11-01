# task_009

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_009.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: agent-panel侧栏-模块

## requirements

在 `src/hud/panels/` 建 agent-panel Web Component，把旧 `AgentPanel`（英雄列表/状态分组）与
`AgentPowerPanel`（能力评估）合并为**唯一 Agent 侧栏**。

1. **两种形态**：单选显示详情（名称 / 状态 / 任务 / 能力六维 / 成长数值），编组显示列表（每行带状态徽标、战力、在办任务）。
2. **选择联动**：与 `WorldState.selection` 实时联动，面板本地**不持有**"当前选中 id"这份副本（判断权与真相都在 core）。
3. **一切走总线**：查看详情 / 聚焦 / 移出编组三条交互以 `HudCommand` 经 `bus-adapter` 派发，不直接调 core。
4. **状态驱动**：全部读数来自 `WorldState`（units / selection / characters / missions），没数据就显示"未评估/未关联"，不 mock。
5. **契约增补**：`src/core/types.ts` 缺变体时可最小增补（加 `@since` 注释，**不破坏既有变体**）；除 types.ts 外不动 core 任何文件。
6. **参考只读**：`src/components/AgentPanel.vue` / `AgentPowerPanel.vue` 只提取语义，UI 全部重写为 Web Components，禁止复制 Vue 代码。
7. **硬约束**：不引入新依赖；不碰 `src/world`、`src/core/agent-link`；不动 command-panel 既有实现；视觉只用 `--srf-*` token；每个新文件头部写契约注释。

## acceptance

- [x] 侧栏渲染与选择联动：空 / 单选 / 编组三种形态随选择集实时切换，jsdom 集成测试走真实组件断言
- [x] 所有交互走 `HudCommand` 总线：查看详情 → `unit.select(set)`、聚焦 → `unit.focus`、移出编组 → `unit.select(toggle)`
- [x] `npm run typecheck` / `npm run build` 全绿
- [x] 组件逻辑有单测：`agent-catalog.test.ts`（派生 + 构造）19 例 + `agent-panel.test.ts`（jsdom 渲染/联动/派发/退订）14 例

## 交付物

- `src/hud/panels/agent-catalog.ts`（新增，纯逻辑）：WorldState → AgentPanelModel 派生（空/单选/编组三形态）+ 三条动作 → HudCommand 构造 + 渲染签名
- `src/hud/panels/agent-panel.ts`（新增，Web Component）：`<strat-agent-panel>`，Shadow DOM，视觉全走 `--srf-*` token
- `src/hud/screens/main-screen.ts`（改）：body 里并排挂载 agent 侧栏，与命令面板共用同一个 adapter
- `src/core/types.ts`（改）：`@since v3.2` 增补 `CAPABILITY_DIMENSIONS` / `UnitCapabilitiesView`、`UnitView.characterId` / `capabilities`、`HudCommand` 加 `unit.focus`
- `src/hud/__tests__/agent-catalog.test.ts`（新增，node 环境）：派生与命令构造 19 例
- `src/hud/__tests__/agent-panel.test.ts`（新增，jsdom）：渲染/联动/派发/判重/退订/主屏装配 14 例

## 验证证据（完成前必填）

- [x] **实现证明**: 侧栏分两层——`agent-catalog.ts` 是零 DOM 的纯函数层（形态判定 / 读数派生 / 命令构造 / 渲染签名，可在 node 环境单测），`agent-panel.ts` 只负责把模型画成 Shadow DOM、把点击经注入的 adapter 派发。形态只由 `selection.unitIds.length` 决定（面板一个"当前选中 id"都不存），能力数据只读 `UnitView.capabilities`（core 算、hud 渲染，**刻意不在 hud 复刻旧 `CombatPowerCalculator` 的阈值与分档**，否则两处必漂移）。旧面板未迁移项（新建/删除/刷新/搜索、榜单重排、雷达图）在文件头写明理由：契约无对应 HudCommand、v3 无"主动拉取"、编组顺序是 core 的选择顺序。旧 `AgentPowerPanel` 本就是 mock 数据驱动，v3 侧栏按 WorldState 渲染，无数据时显式显示"未评估"。
- [x] **测试验证**: `npm run typecheck` exit 0；`npm run build` exit 0；`npm test` exit 0（132 suites / 3153 passed / 7 skipped）；新增两个测试文件共 33 例，覆盖三形态渲染、选择实时联动（单选↔编组↔空）、能力缺失兜底、悬空 id、编组渲染上限、三条交互各自派发出的 HudCommand、jsdom 里真点 shadow DOM 按钮、高频广播下的签名判重（未被选中单位变化不重画）、卸载后订阅归零、main-screen 装配。
- [x] **影响范围**: 仅 HUD 层 + core 契约增补（types.ts 全部为可选字段/新变体，既有构造点与 core 既有 243 例测试均未破）。`unit.focus` 走 `runtime.ts` 既有 `default → onUnhandled` 分支，core 未实现转发也不会崩。未触碰 `src/world`、`src/core/agent-link`、command-panel 既有实现；未引入新依赖。

### 测试步骤
1. `npm run typecheck`
2. `npm run build`
3. `npm test`

### 验证结果

```
npx tsc --noEmit          → (no output, exit 0)
npm run build             → tsc && tsc-alias && vite build, ✓ built in 2m 21s, exit 0
npx jest src/core src/hud --maxWorkers=1
                          → Test Suites: 15 passed, 15 total / Tests: 243 passed, 243 total
npm test                  → Test Suites: 132 passed, 132 total
                            Tests:       7 skipped, 3153 passed, 3160 total
npx eslint --cache src/hud/panels/agent-panel.ts src/hud/panels/agent-catalog.ts \
    src/hud/screens/main-screen.ts src/core/types.ts
                          → ✖ 0 errors, 2 warnings（仅测试文件命中 eslint ignore 规则）
```

## 未尽事项（留给后续任务）

- `unit.focus` 的 core 侧转发（core → world 相机）尚未实现，当前走 `onUnhandled` 上报；由 phase 2 落地。
- `UnitView.capabilities` / `characterId` 目前无人写入（v3 world 层还没产出真实单位），侧栏在数据到位前显示"未评估/未关联角色"。