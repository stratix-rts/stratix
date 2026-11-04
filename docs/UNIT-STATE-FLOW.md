# UNIT-STATE-FLOW — 单位状态流（gateway → app → 动画）全链路

> **状态**：v1（task_142 诊断产出）　**性质**：诊断结论 + 实测数据 + 词表评估
> **一句话结论**：**world-sync 五型词表够用，协议零改动**；跨进程状态流**只存在于远程模式**
> （`STRATIX_REMOTE=1` 的 world-sync WS）；实测「MCP 派任务 → app 内单位切到工作态」= **122ms**（远小于 3s，无需调参）。
> **配套**：[WORLD-SYNC.md](WORLD-SYNC.md)（协议契约）｜[SERVICE-SPLIT-PLAN.md](SERVICE-SPLIT-PLAN.md)（铁律 1/2/4/7）
> ｜[MCP-SPEC.md](MCP-SPEC.md)（MCP 工具面）｜`.long-run-agent/tasks/task_141.md`（B2 八态动画）

---

## 0. 结论摘要（TL;DR）

| 问题 | 结论 | 依据 |
|------|------|------|
| ① MCP 派单后，任务状态**怎么进的 app**？ | **经 world-sync WebSocket 的 `snapshot`**（不是文件、不是轮询、不是 REST）。gateway 进程持有 core 真相 → 状态变更 → 端点节流广播全量快照 → app 侧 `remote-store` 覆盖本地投影 → `state` 通道 → `syncTasks` → 单位相位板 | §2 全链路图；§3 实测 |
| ② 五型词表够不够表达「单位状态流」？ | **够用，不动协议**。单位态所需的全部信号（任务相位 + 单位忙闲 + 角色归属）本来就在 `WorldState` 里 → `snapshot.state` 全量带出，无需新消息型、无需新字段 | §4 覆盖矩阵 |
| ③ 实测延迟多少？ | MCP 派单 → app 投影看到 `running` = **122ms**；WS 快照到达 = 110ms；MCP 回执 = 17ms；整段跑完（真跑 CLI）= 2.1s | §3.2 |
| ④ 延迟 > 3s 要不要调参？ | **不用调**。链路里唯一的时间参数是广播节流窗 100ms（`WORLD_SYNC_SNAPSHOT_THROTTLE_MS`），实测占用 110ms；其余各跳都是毫秒级 | §3.3 |
| ⑤ `world-snapshot.json` 两进程共享吗？ | **不共享**。它是 **gateway 单向**的持久化/重启恢复件（写：gateway 防抖 500ms；读：只有 gateway 启动时 restore）。**app 进程从不读它**，也不是实时通道 | §5 |
| ⑥ 有缺口吗？ | 有 3 条**语义缺口**（排队中 / 审批中 / 失败原因不透传到单位），**全部不在 world-sync 协议层**，在「core 任务相位 → 单位八态」的映射层。**记录，不实现**（留决策） | §6 |

---

## 1. 两种拓扑：数据流只在远程模式存在

同一台机器上跑着两个进程，**它们各有一份 core 世界态**：

| 进程 | 端口 | 持有什么 | 谁改它 |
|------|------|----------|--------|
| **gateway = service**（`src/stratix-gateway/index.ts`） | 7524 | core runtime + core store（真相）+ SQLite（唯一写者）+ MCP `/mcp` + world-sync `/ws/world-sync` | MCP 工具、world-sync 命令面 |
| **app（Electron 壳 / 浏览器页）** | 7523（vite） | 视图 + （本地直连模式下）**自己的** core runtime | 本地直连模式：本地 core；远程模式：**只读快照 + 发命令** |

- **远程模式**（`STRATIX_REMOTE=1`，正式拓扑）：app **不启动本地 core runtime**
  （`src/app/main/main-entry.ts:1306`：`const stopRuntime = remote ? () => undefined : runtime.start()`），
  真相唯一在 gateway —— **数据流成立**。
- **本地直连模式**（不设 `STRATIX_REMOTE`，dev 回退形态，铁律 7）：app 起自己的 core runtime
  （`main-entry.ts:1282` `createCoreRuntime`）→ **两个大脑、两份世界态** → gateway 的 MCP 派单
  **进不了 app**（实测见 §3.4）。

> ⚠️ 这就是 task_142 的「现状疑点」的答案：**不是数据流诡异，是拓扑分叉**。
> B2（task_141）之所以能验通，是因为它开的是**远程模式**的页（7530），而当时默认跑着的
> 7523 是本地直连模式 —— 两者行为不同，容易被误读成「有时灵有时不灵」。

---

## 2. 全链路状态流（每一跳的机制 + 落点）

```
┌─ gateway 进程（7524，service）────────────────────────────┐        ┌─ app 进程（浏览器页 / Electron 壳）──────────┐
│                                                          │        │                                                  │
│ ①  MCP 客户端                                             │        │                                                  │
│     POST /mcp  {tools/call, stratix_task_assign}         │        │                                                  │
│     └─ src/stratix-gateway/index.ts:216（路由挂载）        │        │                                                  │
│        └─ mcp/transport/http.ts（JSON-RPC 帧）             │        │                                                  │
│           └─ mcp/server.ts → mcp/tools/task.ts:158        │        │                                                  │
│              host.dispatchCommand({type:'task.assign'})   │        │                                                  │
│                 └─ mcp/context.ts:131/139 → core/bus.ts:42│        │                                                  │
│                    emitCommand('task.assign')             │        │                                                  │
│                       ↓（同进程，**进程内总线**）           │        │                                                  │
│ ②  core runtime 消费命令（gateway 进程内）                │        │                                                  │
│     core/runtime.ts:529 case 'task.assign'                │        │                                                  │
│        └─ core/task/manager.ts assignTask → 建 queued 任务 │        │                                                  │
│           └─ task-service 接手（真跑 CLI）→ running        │        │                                                  │
│              └─ core/store.ts:241 setState → 广播          │        │                                                  │
│                 （WorldState.tasks / units.status 换新引用）│        │                                                  │
│                                                          │        │                                                  │
│ ③  world-sync 端点订阅 store（**事件驱动，无轮询**）       │        │                                                  │
│     endpoint.ts:269 store.subscribe                        │        │                                                  │
│        └─ endpoint.ts:423 handleStateChange                │        │                                                  │
│           └─ endpoint.ts:429 scheduleBroadcast             │        │                                                  │
│              ⚡ 节流窗 100ms（WORLD_SYNC_SNAPSHOT_THROTTLE_MS）│      │                                                  │
│                 └─ endpoint.ts:439 broadcastSnapshot        │        │                                                  │
│                    └─ session.send(snapshot{seq,state})    │        │                                                  │
│                           ╎                               │        │                                                  │
└───────────────────────────┼───────────────────────────────┘        └─────────────────┼────────────────────────────────┘
                            ╎  ④ WebSocket 帧 ws://127.0.0.1:7524/ws/world-sync
                            ╎     （单向广播，全量覆盖，不做增量合并 —— 协议 §1.2）
                            ╎        │                                                      │
                            ╎        └─ app/services/remote-store/remote-store.ts:200        │
                            ╎             applySnapshot → 本地投影整体覆盖（state = fromWireState）
                            ╎                └─ main-entry.ts:382 remote.subscribe:
                            ╎                     worldStore.setState(() => state) + emitState(state)
                            ╎                        ↓（core/bus.ts:44 emitState → 'state' 通道）
                            ╎                     └─ world/bridge/bus-adapter.ts:230
                            ╎                          port.syncTasks(state.missions, state.tasks)
                            ╎                             ↓
                            ╎                          ⑤ BattlefieldScene.syncTasks（BattlefieldScene.ts:365）
                            ╎                             └─ task-animation.ts:94 taskPhaseView
                            ╎                                （由 WorldState.tasks 派生每单位相位 none/running/completed/failed）
                            ╎                                  └─ TaskPhaseBoard（task-animation.ts:137）→ 迁移结果
                            ╎                                     └─ unit-layer.ts:551 setTaskPhase
                            ╎                                        └─ 每 tick 喂进 UnitAnimationController
                            ╎                                           （unit-animation.ts:418 resolveBase）
                            ╎                                              ↓
                            ╎                                          ⑥ ⑧态动画：working / completed(庆祝) / stuck / idle(静息)
                            ╎
                            ╚══► 另一条（本地直连模式才有）事件路：
                                 core/task 发 task.started/completed/failed → core/bus 'world' 通道
                                 → bus-adapter.ts:243 syncTaskEvent → 场景（**远程模式下这条通道是空的**）
```

### 每一跳的机制一览

| # | 跳 | 机制 | 落点（文件:行） | 量级 |
|---|----|------|------------------|------|
| ① | MCP 客户端 → gateway | **HTTP POST**（JSON-RPC 2.0 over `/mcp`） | `stratix-gateway/index.ts:216` → `mcp/transport/http.ts` → `mcp/tools/task.ts:158` | 17ms（含真派单落库） |
| ② | 命令 → gateway 的 core | **进程内总线**（`core/bus.ts:42` `emitCommand`）→ runtime 状态机 | `core/runtime.ts:529` → `core/task/manager.ts:98` → `core/store.ts:241` | 同帧（同步） |
| ③ | 状态变更 → 广播 | **事件驱动 + 100ms 节流窗**（无轮询） | `world-sync/endpoint.ts:269/423/429/439` | ≤100ms（窗内合并） |
| ④ | gateway → app | **WebSocket 单向广播**（`/ws/world-sync`，全量覆盖） | `remote-store.ts:200` → `main-entry.ts:382` | 9ms（本地 LAN） |
| ⑤ | 投影 → 场景 | **进程内 `state` 通道** | `core/bus.ts:44` → `bus-adapter.ts:230` → `BattlefieldScene.ts:365` | <1ms |
| ⑥ | 相位 → 动画 | **纯派生 + 每 tick 应用** | `task-animation.ts:94/137` → `unit-layer.ts:551/1400` → `unit-animation.ts:418` | ≤1 帧（≈16ms） |

---

## 3. 实测（时间戳证据）

### 3.1 测量方法

- 脚本：`scripts/measure-unit-state-latency.cjs`（仓库内，可复跑；只用既有 devDependency：playwright + ws）。
- 三个观测点：
  - **A（协议层）**：一个独立 WS 客户端连 `ws://127.0.0.1:7524/ws/world-sync`，记录首次收到「含该任务且 status=running」的 `snapshot` 的时刻；
  - **B（应用层）**：浏览器页内 `window.__srfApp.snapshot()`（dev-only 调试句柄，task_136）轮询该任务的 `status`；
  - **C（视觉层）**：B 命中 `running` 的瞬间截屏（`reports/shots/task142-latency-working.png`），证明动画确实切到工作态。
- `t0` = 发出 MCP `stratix_task_assign` 的时刻（**不是** MCP 回执时刻 —— 回执在 `t0+17ms`）。
- 任务是真派单：gateway 进程内**真跑 CLI**（agent_kind=claude-code），不做假数据。

复跑命令：

```bash
# 远程模式页（真相在 gateway）
STRATIX_REMOTE=1 STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:7524/ws/world-sync npx vite --port 7530
# 测量
node scripts/measure-unit-state-latency.cjs
```

### 3.2 数据（两轮独立复测）

**第 1 轮**（task `task_1793766162856_38`）：

```
{"name":"mcp.assign.call","at":1793766162849,"sinceAssign":0}
{"name":"mcp.assign.response","at":1793766162863,"sinceAssign":14,"resp":{"ok":true,"data":{"status":"running",…}}}
{"name":"ws.snapshot.taskStatus","at":1793766162958,"sinceAssign":109,"taskId":"task_1793766162856_38","status":"running","seq":62}
{"name":"app.taskRunning","at":1793766162967,"sinceAssign":118,"taskId":"task_1793766162856_38","unitStatus":[{"id":"unit_character_1793750123353_1","status":"busy"}]}
{"name":"app.screenshotWorking","at":1793766163073,"sinceAssign":224}
{"name":"ws.snapshot.taskStatus","at":1793766166239,"sinceAssign":3390,"status":"completed","seq":63}
```

**第 2 轮**（仓库内脚本复跑，task `task_1793766228981_44`）：

```
{"name":"mcp.assign.response","at":1793766228991,"sinceAssign":17,"status":"running"}
{"name":"ws.snapshot.taskStatus","at":1793766229084,"sinceAssign":110,"status":"running","seq":68}
{"name":"app.taskRunning","at":1793766229096,"sinceAssign":122,"unitStatus":[{"id":"unit_character_1793750123353_1","status":"busy"}]}
{"name":"app.screenshotWorking","at":1793766229188,"sinceAssign":214}
{"name":"app.taskCompleted","at":1793766231106,"sinceAssign":2132}
```

**汇总**：

| 指标 | 第 1 轮 | 第 2 轮 | 说明 |
|------|---------|---------|------|
| MCP 派单回执 | 14ms | 17ms | 入队即返回，不等执行 |
| **A：WS 快照带 running** | **109ms** | **110ms** | 其中 100ms 是广播节流窗 —— **几乎全在窗口里** |
| **B：app 投影看到 running** | **118ms** | **122ms** | 快照到达 → 本地覆盖 + 广播 `state`，再花 9~12ms |
| C：截图落盘 | 224ms | 214ms | 含截屏本身的耗时 |
| 单位 `status` | `busy` | `busy` | 与 `running` 同帧到达 → 基态切 `working` |
| 整单跑完（真跑 CLI） | 3.4s | 2.1s | 任务执行时长（**不是**链路延迟） |

> **结论：「MCP 派任务 → 单位动画切换」= 122ms（上限 ~224ms 含截图）**，
> 远小于任务书给的 3s 阈值 → **无需任何参数调整**（见 §3.3）。

### 3.3 参数级评估（结论：不调）

链路里唯一的时间参数是广播节流窗：

- `WORLD_SYNC_SNAPSHOT_THROTTLE_MS = 100`（`world-sync/endpoint.ts:194`）
- 实测占用 = 110ms（100ms 窗 + ~10ms 传输/处理）→ **节流窗就是链路延迟的主体**。
- 但 110ms 远小于 3s 阈值 → **调它没有收益**（调到 0 会让每次状态变更都推一份全量快照，
  带宽与渲染成本按变更次数线性上升 —— 违反 [PERFORMANCE_GUIDELINES.md](PERFORMANCE_GUIDELINES.md)）。
- 其它参数：`WORLD_SYNC_ACK_TIMEOUT_MS = 5000`（只影响命令回执超时判定，与状态流无关）、
  `DEFAULT_GATEWAY_PROBE_INTERVAL_MS = 2000`（只影响横幅探活，与状态流无关）。

→ **本任务不改任何参数、零代码改动**（唯一新增物：一个测量脚本 + 本文档）。

### 3.4 对照实验：本地直连模式（vite 7523）—— 数据流**不存在**

同一脚本把 `APP_URL` 指到本地直连模式的页：

```bash
APP_URL=http://127.0.0.1:7523/ node scripts/measure-unit-state-latency.cjs
```

实测（task `task_1793766179018_41`）：

```
LOCAL(7523) before: {"units":[],"tasks":0,"characters":0}
mcp assign: {"ok":true,"data":{"task_id":"task_1793766179018_41","status":"running"}} at +16ms
+271ms  {"taskStatus":null,"unitCount":0,"taskCount":0}
...（轮询 5s，20 次）
+5086ms {"taskStatus":null,"unitCount":0,"taskCount":0}
gateway sees: {"task_id":"task_1793766179018_41","status":"completed","output":"142 本地模式对照"}
```

即：**gateway 的任务正常跑完，app 页面 5 秒内一次都没看到**（连单位都是 0 个 —— 本地大脑里没有名册）。
这是 §1「两个大脑」的直接证据，也是**本任务最重要的发现**：
**跨进程状态流只在远程模式成立**；本地直连模式下的 MCP 派单与 app 战场是两条互不相干的世界。

---

## 4. 词表评估：五型够用（结论：**协议不动**）

### 4.1 评估口径

「单位状态流」需要表达的东西，拆成三项：

| 需要表达的 | 数据在哪 | snapshot 里带不带 | 够不够 |
|-----------|----------|------------------|--------|
| 单位**业务忙闲**（idle/busy/offline/error） | `WorldState.units[].status` | ✅ 带 | 够 |
| 任务**相位**（queued/running/awaiting_approval/completed/failed/cancelled） | `WorldState.tasks[].status` | ✅ 带 | 够 |
| 任务 ↔ 单位的**归属** | `WorldState.tasks[].characterId` ≡ `units[].characterId` | ✅ 带 | 够 |

结论：单位状态流的**全部信号本来就在 `snapshot.state` 里**，
`snapshot` 是**全量广播**（协议 §2.2）→ 一条消息面足够承载，不需要新增消息型、不需要新增字段、
不需要新增事件通道。**协议零改动。**

### 4.2 覆盖矩阵（任务相位 → 单位基态）

| core 任务相位（`core/types.ts:349` TaskStatus） | 世界态里带吗 | 远程模式 app 看到的 | 单位基态（`unit-animation.ts:418`） | 备注 |
|---|---|---|---|---|
| `queued` | ✅ | ✅ | 无专属态（沿用 075：摸鱼/待机） | ⚠️ 语义缺口 G1 |
| `running` | ✅ | ✅ | **working**（前倾 + 微颤 + 头顶进度弧） | 实测 122ms 生效 |
| `awaiting_approval` | ✅ | ✅ | 仍按 `busy` → **working** | ⚠️ 语义缺口 G2 |
| `completed` | ✅ | ✅ | **completed**（收工站直 → 庆祝 ~1.2s → 回静息） | 靠快照跳变识别（事件路在远程模式为空） |
| `failed` | ✅ | ✅ | **stuck**（❗ + 灰度 + 抖动） | 真信号：core 如实 `failTask` |
| `cancelled` | ✅ | ✅ | 回静息（无专属演出） | 合理 |

### 4.3 为什么「不动」是对的

1. **B2 已经跑通**：`task_141` 的验收全部基于**真实数据流**（真 MCP 派单 + 真跑 CLI），
   八态动画（working / completed / stuck / idle）在远程模式下**全部有真信号**；
2. **词表是封闭五型**（`hello / snapshot / command.forward / command.ack / error`），
   任何“加一个 task.event 消息型”的提案都属于**新增消息型 = 破坏性变更**
   （协议 §7.4：新增消息型必须升协议版本）—— 而现有五型已能表达全部所需语义，**没有理由付这个代价**；
3. **若真要加**，正确的位置不是 world-sync，而是 **core 的任务相位 → 单位态映射层**（§6）——
   那属于 world 层（`src/world/appearance/`），不碰协议。

---

## 5. `world-snapshot.json` 的真实角色（回答任务书的第三个疑点）

| 问题 | 答案 |
|------|------|
| 谁写？ | **只有 gateway 进程**（`service/boot.ts` 装配 `world-persister`，防抖 500ms 落盘 `dataDir/world-snapshot.json`） |
| 谁读？ | **只有 gateway 进程启动时**（`service/boot.ts:111` `restoreWorldFromSnapshot`）—— 即「gateway 重启后恢复 missions + 角色名册」 |
| app 进程读吗？ | **不读**。全仓检索：app 侧（`src/app/**`）无任何 `world-snapshot.json` 读取点 |
| 是实时通道吗？ | **不是**。它是**单向的持久化/重启恢复件**，不是给 app 实时读的状态面 |
| 两进程怎么对账？ | **不靠这个文件对账**。运行时对账靠 world-sync WS 的 `snapshot`（全量覆盖）+ `seq`（诊断用）；跨进程**重启**对账靠这个文件（且只在 gateway 侧） |

→ 结论：**world-sync（实时）+ world-snapshot.json（重启恢复）** 是两件事，不要混谈。

---

## 6. 缺口清单（**记录，不实现** —— 留决策）

以下三条**都不是 world-sync 协议缺口**（协议已能表达），而是「core 任务相位 → 单位八态」的**语义覆盖缺口**。
按任务书要求**只记录、不实现**。

| # | 缺口 | 现状 | 最小扩展方案（**未实施**） | 影响面 |
|---|------|------|----------------------|--------|
| G1 | **排队中（`queued`）没有专属单位态** | 任务已入队、但角色还没开始 → 单位显示静息/摸鱼，看着像没事 | 在 `UnitTaskPhase` 增第 5 相（如 `queued`）→ 映射到一个已有基态（如沿用 working 的弱化版，或新增 `waiting` 基态）；**纯 world 层改动，不动协议** | `src/world/appearance/unit-animation.ts` + `task-animation.ts` + 单测 |
| G2 | **审批中（`awaiting_approval`）没有专属单位态** | plan-first 任务挂起等人批 → 单位仍显示 working（busy），无法区分“在跑”与“等人批” | 同 G1 的做法：增第 6 相；`awaiting_approval` 在世界里**已带**（`core/types.ts:352`）→ 无需改协议、无需改 core | 同上 |
| G3 | **失败原因不透传到单位** | 单位只显示 ❗ + 灰度，**不带原因**；原因在 `WorldState.tasks[].summary`（≤2000 字摘要）与 HUD 任务面板里 | 若要让单位冒“原因气泡”，需要把摘要的一小段送进 world 层渲染 —— 数据已在 snapshot 里，**不动协议**；但涉及新表现元素（世界层） | `src/world/objects/task-fx*` + 世界层 |

补充一条**结构性限制**（非缺口，但须知悉）：

- **远程模式下没有事件路**：app 不跑本地 core runtime → `task.started / completed / failed`
  这些 `world` 通道事件**不会到达 app**（实测：远程模式页面只走 `state` 通道）。
  后果：庆祝演出（completed）靠**快照跳变**识别（`TaskPhaseBoard` 的迁移结果，见 `task-animation.ts:137`），
  而不是靠事件驱动。跳变识别在两次快照之间发生多次相位变化时会丢中间态（例如 running→completed→failed 在一个
  100ms 窗内连跳，只会看到最后一态）—— 这是 world-sync「无增量、全量覆盖」设计的固有代价（协议 §7.2 预留 `delta`）。
  **不为此改协议**：`delta` 是预留字段位，若将来真需要，应走协议版本升级流程。

---

## 7. 结论与后续（决策项）

1. **协议零改动** —— 五型词表够用（§4）。
2. **参数零改动** —— 实测 122ms，节流窗 100ms 是延迟主体但远小于阈值（§3.3）。
3. **代码零改动** —— 本任务唯一新增：本文档 + `scripts/measure-unit-state-latency.cjs`（测量脚本）。
4. **待决策（不在本任务范围）**：
   - **D1｜正式形态收敛到远程模式**：本地直连模式下 MCP 派单与 app 战场是两个世界（§3.4）——
     demo/演示链路应统一走 `STRATIX_REMOTE=1`（真相唯一，铁律 1），本地直连只作为 dev 回退。
   - **D2｜G1/G2/G3 三条语义缺口**是否补（world 层改动，不碰协议）—— 见 §6。
   - **D3｜本地直连模式要不要给个显式警告**（如 HUD 横幅提示「当前为本地直连，gateway 的派单不会出现在战场」）
     —— 属 UX 决策，本任务只记录。

---

## 8. 复现清单

```bash
# 0) gateway 跑在 7524（勿重启）；远程模式页跑在 7530
STRATIX_REMOTE=1 STRATIX_WORLD_SYNC_URL=ws://127.0.0.1:7524/ws/world-sync npx vite --port 7530

# 1) 远程模式：全链路延迟（协议层 / 应用层 / 视觉层）
node scripts/measure-unit-state-latency.cjs

# 2) 对照实验：本地直连模式（数据流不存在）
APP_URL=http://127.0.0.1:7523/ node scripts/measure-unit-state-latency.cjs

# 3) 词表核对（协议层不改动的证明）
sed -n '1,80p' src/stratix-gateway/api/websocket/world-sync/protocol.ts   # 五型 + 封闭词表
grep -n "TaskStatus" -A 12 src/core/types.ts                           # core 任务相位词表
```

**证据产物**：`/tmp/unit-state-latency-timeline.json`（脚本落盘的时间线）｜
`reports/shots/task142-latency-working.png`（running 瞬间截图）。
