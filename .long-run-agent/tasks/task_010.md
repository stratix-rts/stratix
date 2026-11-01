# task_010

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_010.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: mission-confirm编组指派确认-模块

## requirements

任务域（编组指派 → 确认/拒绝 → 执行 → 回报）在 v3 尚无任何实现：契约里有 `MissionPhase` /
`ConfirmDecision` / `mission.*` 命令，但没人消费、没人写 `WorldState.missions`。本任务落地：

1. **状态机（core/mission/machine.ts，纯函数）**：相位迁移的唯一裁决点。
   `draft →(assign 非空)→ pending →(decide accept)→ confirmed →(start)→ running →(complete)→ done`；
   旁路 `decide reject → cancelled` / `assign(空) → 退回 draft` / 任意非终态 `cancel → cancelled`；
   `done / cancelled` 为终态，任何动作判非法并回机器可读原因，**不抛异常**（命令总线是同步的）。
2. **写入面（core/mission/manager.ts）**：把 `mission.create / assign / confirm / cancel` 四条
   `HudCommand` 翻译成状态机动作，写进同一个 store —— 状态广播的唯一出口仍是 `runtime.ts` 的 store 订阅，
   子模块**不自己订阅总线、不自己 emitState**（否则一次变更广播两遍）。
3. **认领即接单**：`decide accept` 在**同一次写入**里走完 `confirmed → running`（分开两次广播会让面板闪中间态）。
4. **单位占用自洽**：`MissionView.unitIds` 与 `UnitView.missionId` 是同一件事两面，
   指派/改指派/终态都要同步（`syncUnitMissions`），无变化返回原引用让 store 跳过广播。
5. **有界 + 不说谎**：missions 超 `MAX_MISSIONS` 只丢**终态历史**腾位置；全是在办任务时**拒绝新建**并回 Notice，
   绝不静默挤掉谁；每种被拒都给中文原因（用户点了没反应最伤）；未知单位在指派时对账丢弃并提示。
6. **确认面板（src/hud/panels/mission-confirm.ts）**：`<strat-mission-confirm>` Web Component，
   由 `WorldState.missions` 驱动，待确认队列每行含**编组单位摘要**（超 3 个收口成「等 N 个」保证行高稳定），
   点确认/拒绝 → `HudCommand mission.confirm` → 注入的 adapter。面板**一行都不本地改数据**：
   行还在不在、变成什么相位全等 core 回广播。
7. **硬约束**：不引入新依赖；不碰 `src/world`；不动 log-drawer / command-panel / agent-panel；
   core 零渲染依赖（不 import DOM/phaser/vue）；视觉只用 `--srf-*` token；每个新文件头部写契约注释。

## acceptance

- [x] 状态机全路径单测：`src/core/__tests__/mission.test.ts` 44 例，覆盖主路径 draft→pending→confirmed→running→done、
      旁路（拒单/改指派/收回指派/叫停）、非法迁移（decide 只能从 pending、start 只能从 confirmed、
      complete 只能从 running、终态不可再动）、"实质未变不广播"、dropSettledMissions、manager 全部拒绝码
- [x] 闭环打通：`mission.create/assign/confirm/cancel` 命令 → core 状态机 → `WorldState.missions` +
      `units[].missionId` → 广播 → 面板收到并换分组（真总线 + 真 runtime + 真 adapter，未打桩）
- [x] 确认面板单测：`src/hud/__tests__/mission-confirm.test.ts` 17 例（纯派生 + jsdom 渲染/派发/判重/退订 + 闭环两条分支）
- [x] `npm run typecheck` / `npm run build` / `npm test` 全绿

## 交付物

- `src/core/mission/machine.ts`（新增，纯函数）：相位裁决 + `createMission` 工厂 + `dropSettledMissions`
- `src/core/mission/manager.ts`（新增）：四条命令的写入面，状态机动作串 + store 写入 + Notice 上报
- `src/core/mission/index.ts`（新增）：模块出口（hud/world 只认这个口子）
- `src/core/runtime.ts`（改）：`mission.create / assign / confirm / cancel` 四条命令转给 manager
- `src/core/types.ts`（改）：`@since v3.3` 增补 `MAX_MISSIONS`；把 `MissionPhase` 六个相位的业务语义
  （含"拒绝 = cancelled，契约里没有 rejected"）写进契约注释，避免两侧各猜一套
- `src/hud/panels/mission-confirm.ts`（新增，Web Component）：`<strat-mission-confirm>`，Shadow DOM，
  视觉全走 `--srf-*` token
- `src/core/__tests__/mission.test.ts`（新增，node 环境）：状态机全路径 + manager + 闭环，44 例
- `src/hud/__tests__/mission-confirm.test.ts`（新增，jsdom）：面板 17 例

## 验证证据（完成前必填）

- [x] **实现证明**: core/mission 分两层——`machine.ts` 是零依赖纯函数（判相位，唯一裁决点），
  `manager.ts` 只做「找对象 → 跑动作 → 写库 + 上报」，两条铁律写进文件头：不在命令里抛异常（一切失败转 Notice）、
  不自己订阅总线/emitState（广播唯一出口是 runtime 的 store 订阅）。一次用户操作只写一次 store：
  `decide accept` 把 `confirmed → running` 合并进同一次 `setState`（两次广播会让面板闪一个中间态）；
  `assign` 指派同一批人时 machine 返回 `changed=false` + 原引用，store 直接跳过广播（编组顺序无业务含义，
  按顺序比会白广播一次）。面板侧与 command-panel / agent-panel 同一口径：`missionConfirmSignature`
  只由「任务相位 + 名单 + 这些单位的显示名」构成，无关单位改名不触发本面板重绘。
- [x] **测试验证**: `npm run typecheck` exit 0；`npm run build:backend` exit 0、`npm run build`（vite）✓ built；
  `npm run typecheck:tests` exit 0；`npm test` exit 0（136 suites / 3266 passed / 7 skipped）；
  新增 61 例（core 44 + hud 17）。闭环两例不打桩总线：`emitCommand` / `createCoreRuntime` / `HudBusAdapter` 全是真件，
  只有 themeController 是替身（它只管落皮肤，与任务流无关）。
- [x] **影响范围**: 新增 core/mission 子模块 + 一个 HUD 面板 + runtime 四条命令接线。core 侧零渲染依赖（已核 import：
  machine/manager 只 import ../types 与 ../store）。types.ts 增补为常量 + 注释，**未改任何既有字段语义**；
  runtime 只在既有 switch 上加四个 case，mission.* 不再走 `onUnhandled`。未碰 `src/world`、
  log-drawer / command-panel / agent-panel 既有实现；未引入新依赖。

### 测试步骤
1. `npm run typecheck`
2. `npm run build`
3. `npm test`

### 验证结果

```
npx tsc --noEmit                       → (no output) exit 0
npm run build:backend                  → tsc && tsc-alias，exit 0
npm run build                          → ✓ built in 3m 35s（backend + frontend 全程）
npx tsc -p tsconfig.test.json --noEmit → (no output) exit 0
npm test (npx jest --maxWorkers=2)     → exit 0
                                          Test Suites: 136 passed, 136 total
                                          Tests:       7 skipped, 3266 passed, 3273 total
npx jest --maxWorkers=1 src/core/__tests__/mission.test.ts \
    src/hud/__tests__/mission-confirm.test.ts
                                       → Test Suites: 2 passed, 2 total / Tests: 61 passed, 61 total
npx eslint --cache src/core/mission src/core/runtime.ts src/core/types.ts \
    src/hud/panels/mission-confirm.ts → ✖ 0 errors（2 warnings = 两个测试文件命中 eslint ignore 规则）
```

## 未尽事项（留给后续任务）

- **面板尚未挂载到主屏**：`mission-confirm` 目前只在测试里被 `mountMissionConfirm` 装配。
  `src/hud/screens/main-screen.ts` 当时正被 log-drawer 任务改动（同一文件、并发），本任务不碰以免冲突，
  挂载留给后续接线任务。
- **回报链路未接**：`completeMission`（running → done）是纯逻辑入口，契约里**没有** `mission.complete` 命令，
  到不了 HUD。需 world 侧上报完成事件或 agent-link 回报消息驱动后再接线（TODO 已写在 manager 文件头）。
- **Notice 未打来源标记**：`core/mission` 产出的 Notice 还没填 v3.4 的 `source` / `missionId` 字段，
  log-drawer 按任务过滤日志时这几条会落到"全局通知"。
