# task_014

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_014.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: 状态屏-模块

## requirements

全局态势总览屏，**纯展示、只读**，一切数值现算自 `WorldState`：

1. **派生层（src/hud/screens/status-catalog.ts，纯逻辑、零 DOM）**：`WorldState → StatusModel`。
   四张核心指标卡（单位总数 / 活跃任务 / 进行中会话 / 未读通知）、系统状态三项
   （gateway 连接态读 `WorldState.links` 的 `AgentLinkPhase`、总线活跃度、运行时长）、
   最近事件列表（复用 `WorldState.notices`，与 log-drawer 同源但紧凑形态）。
2. **屏幕（src/hud/screens/status-screen.ts）**：`<strat-status-screen>` Web Component，Shadow DOM，
   视觉全部 `--srf-*` token；导航出口（去设置 / 打开聊天）派发 `ui.navigate`。
3. **口径写在文件头**（每个数凭什么这么数，将来者不必重猜）：
   - 活跃任务 = 未收尾（`phase ∉ {done, cancelled}`，草稿/待确认都还是活儿），在办/待确认细分进 hint；
   - 进行中会话 = `phase ∈ {connecting, connected, reconnecting}`，`idle/closing/closed` 不计入；
   - 未读通知 = core 仍持有的存活 notices —— **契约里没有"已读"字段**，如实按"core 手上还有几条"念，
     不假装是一个已读未读系统；
   - 总线活跃度 = 本屏订阅链在 60s 滑动窗口内**真实观测**到的投递次数（环形样本封顶 64）；
   - 运行时长 = 自本屏首次收到 state 起算的观测时长 —— 契约没有进程启动时间戳，观测时长是唯一诚实取值。
4. **唯一命令出口是 `ui.navigate`**：态势屏不发 `mission.*` / `unit.*` —— 看态势不该能改态势。
5. **挂载（src/hud/screens/main-screen.ts，最小增补）**：契约 `ScreenId` 里**没有 `status`**，
   本任务不改 `core/types.ts`（总线契约，且有并行任务正在改），因此态势屏以"主屏 .body 里的一个区块"
   挂载（替换掉原先的骨架占位文案），跳转出去仍走 `ui.navigate`。
6. **硬约束**：不引入新依赖；不动既有 panels / 既有 screen 结构；不碰 `src/world`、`src/core` 运行时；
   不 mock 数据；每个新文件头部写契约注释。

## acceptance

- [x] **指标卡数据与 WorldState 派生一致**：构造态（4 单位 idle/busy/error/offline、5 任务覆盖全部相位、
      3 会话 connected/connecting/closed、2 通知 warn/error）单测断言 —— 既断言纯函数
      `resolveMetrics` 的 value/hint，也断言 Shadow DOM 渲染输出（`data-value` 属性 + 标签 + hint 文案），
      四张卡逐一对齐
- [x] **连接状态读取正确**：`resolveConnection` 七相位分组 + 优先级（error > 连接中 > 已连接 > 未连接），
      并落到 DOM（`data-sys="connection"` 的 value/tone/detail）
- [x] **typecheck/build 全绿**：`npm run typecheck` / `npm run typecheck:tests` / `npm run build` 全部 exit 0
- [x] **渲染逻辑单测**：`src/hud/__tests__/status-screen.test.ts` 34 例
      （纯派生 20 + 渲染/派发/判重/转义/退订 12 + tick 2 + main-screen 装配 1）

## 交付物

- `src/hud/screens/status-catalog.ts`（新增，纯逻辑）：`resolveStatusModel` / `resolveMetrics` /
  `resolveConnection` / `summarizeBus` / `pushBusSample` / `resolveUptime` / `formatDuration` /
  `resolveStatusEvents` / `statusSignature` / `STATUS_METRIC_IDS` / `MAX_STATUS_EVENTS` / `MAX_BUS_SAMPLES`
- `src/hud/screens/status-screen.ts`（新增，Web Component）：`<strat-status-screen>`，Shadow DOM，
  视觉全走 `--srf-*` token
- `src/hud/__tests__/status-screen.test.ts`（新增，jsdom）：34 例
- `src/hud/screens/main-screen.ts`（改，+13/-2 行）：新增 `.status-slot` 容器与 `mountStatusScreen(adapter, host)`，
  unmount 时随之卸载。**未改** main-screen 其余结构与任何既有 panel
- `src/core/*`、`src/world/*` **零改动**：未增补 `ScreenId`、未改任何契约字段

## 验证证据（完成前必填）

- [x] **实现证明**: catalog / screen 两分（与 command-catalog+command-panel、log-catalog+log-drawer
  同一口径）：catalog 只做派生与判重，screen 只把模型画成 DOM。两条纪律写进文件头：
  (a) 不本地改数 —— 指标 / 连接态 / 事件行全部现算自最近一次 `WorldState`，改了也只等 core 回广播；
  (b) 不编造状态 —— 契约里没有的量（进程启动时间、已读未读）一律显示 `--` / 「等待世界状态」/「暂无」。
  渲染判重 `statusSignature` 只由「单位 id+状态 / 任务 id+相位 / 会话 id+相位 / 通知 id+级别+时刻+来源+正文」
  构成，选择集、角色档案、消息流、偏好变化一律不重绘；总线活跃度与运行时长按秒自走（独立 1s tick，
  只改两个文本节点），不并进签名 —— 否则每次投递都要强制重绘整屏。
  perf：事件行截断到 `MAX_STATUS_EVENTS=10`（core 侧 notices 另有 `MAX_NOTICES=50` 封顶），
  广播样本环形封顶 `MAX_BUS_SAMPLES=64`，订阅与 tick 都在 `disconnectedCallback` 里释放。
- [x] **测试验证**: `npm run typecheck` exit 0；`npm run typecheck:tests` exit 0；
  `npm run build`（backend tsc+tsc-alias + vite build）✓ built in 2m 7s；
  `npx jest --maxWorkers=1`（全量）exit 0 —— 140 suites / 3355 passed / 7 skipped / 36.9s；
  新增 34 例。装配用例走 main-screen 的真实订阅链（广播 → DOM 断言 → 主屏卸载 → 订阅数归零）。
- [x] **影响范围**: 新增 3 个文件 + main-screen 最小增补（+13/-2）。未引入新依赖；未动任何既有 panel /
  log-catalog / log-drawer / 既有 screen 结构；未碰 `src/world`、`src/core` 运行时与契约。
  main-screen 的改动只替换了原先那句骨架占位文案（`主屏骨架就绪。后续任务将在此插入 chat-drawer。`，
  该文案无任何测试断言），既有 254 例 hud/app 测试全绿可证无回归。

### 测试步骤

1. `npm run typecheck`
2. `npm run typecheck:tests`
3. `npm run build`
4. `npx jest --maxWorkers=1`
5. `npx jest src/hud/__tests__/status-screen.test.ts --maxWorkers=1`
6. `npx eslint --cache src/hud/screens/status-catalog.ts src/hud/screens/status-screen.ts src/hud/screens/main-screen.ts`

### 验证结果

```
npm run typecheck                                        → (no output) exit 0
npm run typecheck:tests                                  → (no output) exit 0
npm run build                                            → ✓ built in 2m 7s
                                                           (build:backend tsc+tsc-alias + vite build)
npx jest --maxWorkers=1（全量）                           → exit 0
                                                           Test Suites: 140 passed, 140 total
                                                           Tests:       7 skipped, 3355 passed, 3362 total
                                                           Time:        36.889 s
npx jest src/hud/__tests__/status-screen.test.ts --maxWorkers=1
                                                        → Test Suites: 1 passed, 1 total
                                                           Tests:       34 passed, 34 total
npx jest src/hud src/app --maxWorkers=1                  → Test Suites: 13 passed, 13 total
                                                           Tests:       254 passed, 254 total
npx eslint --cache <本任务 3 个源文件>                     → exit 0（0 errors / 0 warnings）
```

关键断言（原文摘录）：

```
✓ 构造态下四张卡的数值与构成          → 单位 4「忙碌 1 · 异常 1 · 离线 1」/ 任务 3「在办 1 · 待确认 1 · 已完成 1」
                                        / 会话 2「已连接 1 · 连接中 1」/ 通知 2「警告 1 · 错误 1」
✓ 四张指标卡的渲染输出与构造态 WorldState 一致  → DOM data-value 与模型 value 逐张对齐
✓ error 压过 connected：一条异常就报连接异常（不被别的会话盖住）
✓ 同状态重复广播不重绘卡片（签名判重），但总线活跃度照常更新
✓ 通知正文含标签时被转义（外部输入不进 innerHTML）
✓ 导航点击 → ui.navigate(chat) / ui.navigate(settings)，且不发任何其他命令
✓ 卸载后定时器清零（不留后台 tick） / 主屏卸载 → 状态屏随之退订
```

## 未尽事项（留给后续任务）

- **无独立屏位**：契约 `ScreenId`（`'main' | 'settings' | 'character' | 'chat'`）里没有 `'status'`，
  本任务按最小改动原则没有改 `core/types.ts`，态势屏因此以主屏内区块形态呈现（不可「切走」）。
  若产品要求独立屏位，需要单独任务在契约里加 `ScreenId` 的 `'status'` 并在 core 侧接线路由。
- **`已读/未读` 未做**：契约 `Notice` 上没有已读标记，"未读通知"当前口径是"core 仍持有的存活通知数"
  （文件头与卡片名均已写明）。真要做已读，需要 core 提供一个已读位并广播，属于契约新增。
- **总线活跃度是 HUD 侧观测值**，不是 core 内部计数（含 adapter mount 后的快照回放，已在文件头写明）；
  跨屏共享同一口径需要 core 侧补字段。
- **运行时长随屏**：本屏卸载即停止计时，重新挂载从零开始（观测口径，非进程 uptime）。