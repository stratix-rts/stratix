# task_012

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_012.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: chat-drawer聊天抽屉-模块

## requirements

与外部 agent 的对话界面。契约侧 `WorldState.links / messages` 与 `HudCommand chat.send` 在 task_007
（core/agent-link）就已冻结并由 manager 投影写入，HUD 侧至今无人消费 —— 本任务把这条链路接上：

1. **派生层（src/hud/panels/chat-catalog.ts，纯逻辑、零 DOM）**：`WorldState → ChatDrawerModel`。
   会话列表（`WorldState.links`）、当前会话的消息流（`WorldState.messages` 按 linkId 过滤）、
   连接状态（`AgentLinkPhase → 中文标签 + 色调`）全部现算，面板一行都不本地维护。
2. **面板（src/hud/panels/chat-drawer.ts）**：`<strat-chat-drawer>` Web Component，
   会话切换按钮组 + 消息气泡流（左右按 `direction` 分）+ 输入框（Enter 发送 / Shift+Enter 换行，
   语义提取自旧 AgentChatModal）+ 连接状态徽标；视觉全部 `--srf-*` token。
3. **发送链路**：输入框 → `HudCommand chat.send(text, linkId)` → 注入的 adapter → core → agent-link →
   `WorldState.messages` → 广播回面板。**面板零本地消息**：气泡何时出现、发没发出去只有 core 一个答案，
   不做本地乐观回显（本地先插一条会让"到底送出没"不可排查，core 拒投时那条还会变成假消息）。
4. **会话切换是展示态**：换会话只改"看哪段对话"，不发命令（会话是 core 的既有事实，无需 HUD 下指令）；
   选中的会话消失时回落到第一个，不停在幽灵会话上。
5. **chat.send 一律显式带 linkId**：多会话同时连接且未带 linkId 时 core 会判 `ambiguous-target` 拒投，
   抽屉既然知道自己看的是哪个会话，就没有理由让 core 去猜。
6. **硬约束**：不引入新依赖；不动 agent-link 运行时本体；不动其它 panels / log-drawer；不碰 `src/world`；
   不 mock 数据；不碰正在被 log-drawer 任务并发改动的 `main-screen.ts`；每个新文件头部写契约注释。

## acceptance

- [x] 发送→回显→增量渲染闭环单测：真 `emitCommand` + 真 `createCoreRuntime` + 真 `createHudBusAdapter` +
      真 `core/agent-link` Manager（远端用 gateway-double 按真实协议收发），一条 `chat.send`
      驱动出「本端 outbound 气泡 → agent 应答 inbound 气泡」两段增量渲染
- [x] 会话切换可用：多会话各发各的、切会话消息流跟着换且不串台、切换不发任何命令
- [x] 连接状态显示：未连接 / 连接中 / 在线 / 重连中 / 关闭中 / 已断开 / 连接异常 七相位各有中文标签与色调，
      非 connected 时发送按钮禁用并给出人话禁用理由
- [x] `npm run typecheck` / `npm run typecheck:tests` / `npm run build` / `npm test` 全绿
- [x] 逻辑单测：`src/hud/__tests__/chat-drawer.test.ts` 33 例（纯派生 + 面板渲染/派发/判重/退订 + 闭环 5 例）

## 交付物

- `src/hud/panels/chat-catalog.ts`（新增，纯逻辑）：`resolveChatDrawer` / `resolveActiveLinkId` /
  `chatDrawerSignature` / `buildChatSendCommand` / `PHASE_LABELS` / `formatMessageTime` / `MAX_VISIBLE_MESSAGES`
- `src/hud/panels/chat-drawer.ts`（新增，Web Component）：`<strat-chat-drawer>`，Shadow DOM，视觉全走 `--srf-*` token
- `src/hud/__tests__/chat-drawer.test.ts`（新增，jsdom）：33 例
- `src/core/*` **未改动**：`WorldState.links / messages`、`HudCommand chat.send`、`MAX_AGENT_MESSAGES*`
  在 task_007 已就位，本任务只消费，无需增补契约

## 验证证据（完成前必填）

- [x] **实现证明**: catalog / panel 两分（与 command-catalog+command-panel、agent-catalog+agent-panel 同一口径）：
  catalog 里 `resolveChatDrawer` 只做「按 linkId 过滤消息 + 把 `AgentLinkPhase` 翻成标签/色调 +
  算出 canSend 与禁用理由」，panel 只把模型画成 DOM。两条纪律写进文件头：
  (a) 不本地改数据 —— 消息与连接状态的唯一真相是 core 写进 `WorldState` 的投影；
  (b) 不派发半截命令 —— 空消息 / 无目标会话由 `buildChatSendCommand` 返 null，面板据此什么都不发。
  渲染判重 `chatDrawerSignature` 只由「会话 id/相位/名 + **当前会话**的消息 + 当前查看的会话 id」构成，
  别的 agent 来消息不影响本面板重渲染（perf）；消息超过 `MAX_VISIBLE_MESSAGES=60` 只报条数、DOM 体积有顶。
  `send()` 同时受 `canSend` 与按钮禁用同口径约束 —— Enter 是绕过按钮的旁路，只禁按钮会让回车打出一条
  必被 core 拒绝的 `chat.send`（换回来一条 error Notice，纯噪音）。`disconnectedCallback` 退订，反复挂卸不累积订阅。
- [x] **测试验证**: `npm run typecheck` exit 0；`npm run typecheck:tests` exit 0；`npm run build`（backend + vite）
  ✓ built；`npm test`（npx jest --maxWorkers=2）exit 0（137 suites / 3299 passed / 7 skipped）。
  新增 33 例。闭环 5 例不打桩总线：`emitCommand` / `createCoreRuntime` / `HudBusAdapter` /
  `core/agent-link` 的 Manager 全是真件，只有远端 agent 与 themeController 是替身
  （前者按真实协议帧收发并自动应答 `ack:<text>`，后者只管落皮肤，与任务流无关）。
- [x] **影响范围**: 纯新增 3 个文件，**未改任何既有文件**（`src/core`、`src/world`、其它 panels、
  `main-screen.ts`、log-drawer 相关文件一律未动）。core 侧零改动、零渲染依赖。
  未引入新依赖。视觉 100% 走 `--srf-*` token（唯一内联样式是消息流的 `max-height`/`scrollTop`，属布局数据不是设计）。

### 测试步骤
1. `npm run typecheck`
2. `npm run build`
3. `npm test`
4. `npx jest src/hud/__tests__/chat-drawer.test.ts --maxWorkers=1`

### 验证结果

```
npm run typecheck                       → (no output) exit 0
npm run typecheck:tests                 → (no output) exit 0
npm run build                           → ✓ built in 2m 5s（build:backend tsc+tsc-alias + vite build）
npm test (npx jest --maxWorkers=2)      → exit 0
                                          Test Suites: 137 passed, 137 total
                                          Tests:       7 skipped, 3299 passed, 3306 total
npx jest src/hud src/core --maxWorkers=2 → Test Suites: 20 passed, 20 total
                                          Tests:       389 passed, 389 total
npx jest src/hud/__tests__/chat-drawer.test.ts --maxWorkers=1
                                        → Test Suites: 1 passed, 1 total / Tests: 33 passed, 33 total
npx eslint --cache src/hud/panels/chat-drawer.ts src/hud/panels/chat-catalog.ts
                                        → ✖ 0 errors / 0 warnings
```

闭环关键断言（真件链路，未打桩）：

```
✓ 建链 → 输入 → 发送 → 本端回显 → agent 应答进消息流（真总线 + 真 runtime + 真 agent-link）
✓ 两个会话：消息各归各家，切换看各自那段（不串台）
✓ 远端主动下发的消息（REMOTE_EVENT.message）也进消息流
✓ 断开（closed）后发送按钮禁用，状态显示"已断开"
✓ 面板不做本地乐观回显：发出后气泡要等 core 广播才出现
```

## 未尽事项（留给后续任务）

- **面板尚未挂载到主屏**：`chat-drawer` 目前只在测试里被 `mountChatDrawer` 装配。
  `src/hud/screens/main-screen.ts` 正被 log-drawer 任务改动（同一文件、并发），本任务不碰以免冲突；
  挂载只需在该屏加一个 `data-role="chat-drawer"` 容器 + 一行 `mountChatDrawer(adapter, host)`，
  与 log-drawer 现有写法同口径，留给接线任务。
- **HUD 侧无建会话入口**：`link.open / link.resume / link.reconnect / link.close` 四条命令在
  `src/hud/` 下**无人派发**（已 grep 确认），抽屉在没有外部会话时只能显示空态
  「还没有外部 agent 会话」。本任务范围只到"消费既有会话"，会话建立/重连 UI 需单独任务补。
- **历史回放与未读标记未做**：`MAX_AGENT_MESSAGES_PER_LINK` 之外的历史不加载（core 只留最近 100 条/会话），
  抽屉侧再截到 60 条并提示「更早的 N 条未显示」；未读计数需要跨会话的已读位，属于契约外的新增状态，未造。