# WORLD-SYNC — Stratix world-sync WebSocket 协议规范

> **状态**：v1 冻结（契约层 task_081 + 传输层 task_082 均已落地；端点见 `api/websocket/world-sync/endpoint.ts`）　**性质**：规范文档（含契约层实现指引）
> **适用范围**：service（gateway 常驻进程）与视图客户端（Electron 壳 / 浏览器）之间的**状态面**与**命令面**
> **实现**：`src/stratix-gateway/api/websocket/world-sync/protocol.ts`（纯类型 + 守卫 + 常量 + 编解码纯函数，零运行时依赖）
> **配套**：[SERVICE-SPLIT-PLAN.md](SERVICE-SPLIT-PLAN.md)（B1 节与铁律 1/4）｜[MCP-SPEC.md](MCP-SPEC.md)（工具面，另一条对外通道）｜[UNIT-STATE-FLOW.md](UNIT-STATE-FLOW.md)（task_142：状态流全链路 + 实测延迟 + 词表评估）
> **维护责任**：协议字段只加不删；破坏性变更须升协议版本（见 [§7](#7-协议演进)）

---

## 目录

- [0. 设计前提](#0-设计前提)：[0.1 消费者与心智模型](#01-消费者与心智模型)｜[0.2 权威依据](#02-权威依据)｜[0.3 范围与非目标](#03-范围与非目标)｜[0.4 术语](#04-术语)
- [1. 方向语义与铁律](#1-方向语义与铁律)
- [2. 消息表](#2-消息表)
- [3. 状态版本 seq 规则](#3-状态版本-seq-规则)
- [4. 场景时序图](#4-场景时序图)
- [5. 何时用 / 何时不用](#5-何时用--何时不用)
- [6. 错误码表](#6-错误码表)
- [7. 协议演进](#7-协议演进)

---

## 0. 设计前提

### 0.1 消费者与心智模型

world-sync 的消费方**不是人**，而是**视图客户端**（Electron 壳、将来的浏览器壳）—— 一个「随时可能被关掉、被重启、可能没有网络」的进程。三条取向随之而来：

1. **service 是唯一真相源，客户端是投影**：客户端不持有真相，只持有一份**投影**。投影随时可能被 service 用一份全量快照整体覆盖。
2. **写只有一条路**：客户端**只能**通过 `command.forward` 写。它不直接改本地状态，不直接调 service 的内部 API（铁律 2：裁决在 core）。
3. **断连是常态，不是异常**：壳可以随时被关掉、被重启。因此「重连之后怎么办」必须在协议里写死，而不是让每个客户端自己发明一套合并逻辑（铁律 1）。

### 0.2 权威依据

| 依据 | 我们从中取的规则 |
|------|------------------|
| [SERVICE-SPLIT-PLAN.md](SERVICE-SPLIT-PLAN.md) §5 铁律 1「真相唯一」 | WorldState 真相源 = service 进程的 core store；**重连 = 全量 snapshot 覆盖，不做增量合并** |
| SERVICE-SPLIT-PLAN.md §5 铁律 2「裁决在 core」 | 客户端的写一律走 `HudCommand`；协议层不裁决载荷合法性 |
| SERVICE-SPLIT-PLAN.md §5 铁律 4「绝不假装成功」 | 状态面未附着 / 命令裁决超时 → 如实报 `internal_error` / `not_attached`，不返回空态假装正常 |
| `src/core/types.ts`（总线契约） | `WorldState` / `HudCommand` 的形状与语义，协议层**同源引用**，不另抄一份 |
| MCP 官方规范（JSON-RPC / 错误表达） | 协议级错误与业务级失败分离；错误必须带机器可读码 + 一句话说明 |

### 0.3 范围与非目标

**范围内**：五种消息的字段与语义、方向、版本号与状态版本号（seq）的规则、错误码、重连与未附着语义、兼容演进规则。

**范围外（本期明确不做）**：❌ 传输层实现（WS 端点、连接管理、心跳 —— 归 task_082）；❌ 增量 patch 协议（**预留 `delta` 字段位，本期恒为 null**，见 [§7](#7-协议演进)）；❌ 鉴权与多租户；❌ 客户端侧 store 实现（CoreStore 的远程实现归 task_083）；❌ 与 v2 的 `StatusSync` 编排事件面复用（那是另一套协议，见 [§5](#5-何时用--何时不用)）。

### 0.4 术语

**状态面** = service → 客户端的单向投影流（`snapshot`）。**命令面** = 客户端 → service 的写通道（`command.forward`）+ 落点回执（`command.ack`）。**附着（attached）** = service 已接上 core store、能读到真状态、能裁决命令；**未附着（not attached）** = 接不上（如 service 尚未装配完成、core store 未就绪）。**状态版本（seq）** = service 侧统一发号的状态版本号。**全量覆盖** = 收到一份 `snapshot` 后，客户端用其内容整体替换本地视图，而不是与之合并。

---

## 1. 方向语义与铁律

### 1.1 方向（写死，不可协商）

```
        客户端（视图壳）                          service（gateway 常驻进程）
   ┌────────────────────────┐                ┌──────────────────────────────┐
   │  读：snapshot（订阅）    │ ◄──────────── │  推：全量 WorldState + seq     │
   │  写：command.forward     │ ────────────► │  收：转交 core 裁决（铁律 2）    │
   │  回执：command.ack       │ ◄──────────── │  回：落点结果 + 核对后 seq      │
   │  协议错误：error         │ ◄──────────── │  报：信封级错误                │
   │  注册：hello             │ ────────────► │  收：协议版本 + clientId       │
   └────────────────────────┘                └──────────────────────────────┘
```

- **service 推 snapshot，客户端订**：状态面是单向的。客户端不能「拉状态」，也不能「请求一份状态」—— 想要状态就等 `snapshot`。
- **客户端只经 `command.forward` 写**：不存在第二条写路径（没有 REST 写入视图、没有本地直改）。
- **`snapshot` 是广播，`command.ack` 是点对点**：ack 只回给发命令的那个连接。

### 1.2 重连语义（写死）

> **客户端重连 = `hello` → service 立即回一份全量 `snapshot` → 客户端整体覆盖本地视图。不做增量合并。**

- 客户端**不得**保留「我本地比 service 新」这类假设；重连后本地视图的权威性归零。
- 客户端**不得**因为 `seq` 比上次大/小就决定「要不要更新」—— seq 只用于诊断与对账，不用于合并决策（本期无 delta）。
- 客户端**不得**把重连前未收到 ack 的命令「补发」到新连接 —— 那条命令可能已经在旧连接上落地了。真相以新 snapshot 为准。

**正例**：

```ts
// 重连后：整体覆盖，不做逐字段合并
const snapshot = await waitForSnapshot();   // service 重连后立刻推的那份
localStore.replaceAll(snapshot.state);       // 覆盖，不是 merge
```

**反例**：

```ts
// ❌ 客户端自作主张做增量合并：漏字段 = 视图与真相长期漂移，且没人能发现
localStore.merge(snapshot.state, { deep: true });
// ❌ 更糟：用 seq 判断「我更新」——本期没有 delta，seq 新≠内容新
if (snapshot.seq > lastSeq) localStore.merge(snapshot.state);
```

### 1.3 未附着语义（写死）

状态面**未附着** = service 进程在，但还没接上 core store（或 core 未装配完成、store 未就绪）。此时：

- `command.forward` 的回执是 `command.ack{ ok: false, seq: null, error: { code: 'not_attached', stale: true } }`；
- 客户端**必须**把本地视图标记为 stale（不可信），并在 UI 上如实显示「未连接」；
- service **不得**改发一份空的 `snapshot` 装作一切正常。

**关键区分**（这是本协议最容易糊弄的地方）：

| 情形 | 表现 | 含义 |
|------|------|------|
| 状态面**已附着**且战场确实为空 | `snapshot{ seq:1, state:{ units:[], missions:[], … } }` | 真相就是空 —— 合法状态 |
| 状态面**未附着** | `command.ack{ ok:false, seq:null, error.code:'not_attached' }` | **没有真相** —— 不是空，是「读不到」 |

**反例**：

```jsonc
// ❌ 未附着时回一份空快照 —— 客户端会以为「战场真的空了」，真相被静默掩盖
{ "type": "snapshot", "seq": 1, "state": { "units": [], "missions": [] } }
```

**正例**：

```jsonc
// ✅ 未附着：如实报不可用，且带上 stale 标记
{ "type": "command.ack", "commandId": "cmd-7", "ok": false, "seq": null,
  "error": { "code": "not_attached", "message": "状态面未附着：service 未接上 core store",
             "stale": true, "hint": "确认 service 已启动后重连" } }
```

---

## 2. 消息表

端点路径：`/ws/world-sync`（常量 `WORLD_SYNC_PATH`）。全部消息是 **UTF-8 JSON 文本**，顶层必有 `type` 字段。

### 2.1 总表

| 消息 | 方向 | 触发时机 | 语义 | 何时用 / 何时不用 |
|------|------|---------|------|------------------|
| `hello` | 客户端 → service | 连接建立后**立即**发一次 | 注册：自报协议版本 + clientId | 用：每次连接（含重连）都必须发。不发 → service 不认这条连接 |
| `snapshot` | service → 客户端（广播） | 收到 `hello` 后立即；此后每次状态变更 | 全量世界状态 + 状态版本号 | 用：客户端唯一的读路径。不用于「只想要一小块」—— 那是 REST/MCP |
| `command.forward` | 客户端 → service | 用户/交互触发写操作 | HudCommand 的信封（含 `commandId` 用于关联回执） | 用：一切写。**不用**：本地纯表现（音效、面板开合）—— 那些不进状态面 |
| `command.ack` | service → 客户端（点对点） | 每条 `command.forward` 必回一条 | 落点回执：ok / 失败原因 + 核对后的 seq | 用：客户端据此判定「这次写入成没成」。不用：代替 snapshot —— ack 不带全量状态 |
| `error` | service → 客户端（点对点） | 信封级协议错误 | 解不开 / 类型不认识 / 版本不兼容 | 用：协议层故障。不用：业务级失败（业务失败走 `command.ack{ok:false}`） |

### 2.2 字段明细

#### `hello`（客户端 → service）

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `type` | `"hello"` | 是 | 消息型 |
| `protocolVersion` | `number`（整数） | 是 | 客户端自报协议版本。必须落在 `[WORLD_SYNC_MIN_PROTOCOL_VERSION, WORLD_SYNC_PROTOCOL_VERSION]`；越界 → service 回 `error{code:'unsupported_version'}` 并断开该连接（**不降级、不假装能通**） |
| `clientId` | `string`（非空） | 是 | 客户端实例 id。Electron 壳重启会换新 id；service 侧用作连接日志与广播归属 |

#### `snapshot`（service → 客户端）

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `type` | `"snapshot"` | 是 | 消息型 |
| `seq` | `number`（≥1 整数） | 是 | 状态版本号，service 侧统一发号（见 [§3](#3-状态版本-seq-规则)） |
| `state` | `WorldStateWire` | 是 | 全量世界状态。**wire 形态 = core 的 `WorldState`，只多一处差异**：`selectionGroups` 由 `ReadonlyMap` 摊平成 `[{slot, unitIds}]` 数组 —— JSON 没有 Map，不摊平则编组静默蒸发（违反「全量覆盖即真相」） |
| `delta` | `null` | 否 | **预留字段位**，本期恒为 `null`（不实现增量）。why 预留：将来引入增量 patch 时「加字段」不是破坏性变更（见 [§7](#7-协议演进)） |

#### `command.forward`（客户端 → service）

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `type` | `"command.forward"` | 是 | 消息型 |
| `commandId` | `string`（非空） | 是 | 命令 id（客户端生成，连接内唯一）。service 回 `command.ack` 用它关联 |
| `command` | `HudCommand` | 是 | 待裁决的 HUD 命令，与 `src/core/types.ts` 同源。**协议层只校验信封（类型名在册），载荷合法性由 core 裁决**（铁律 2） |

#### `command.ack`（service → 客户端）

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `type` | `"command.ack"` | 是 | 消息型 |
| `commandId` | `string`（非空） | 是 | 对应 `command.forward.commandId` |
| `ok` | `boolean` | 是 | `true` = core 已裁决并落点；`false` = 被拒 / 未附着 / 超时 |
| `seq` | `number` \| `null` | 是 | **核对后的状态版本**。状态面未附着时为 `null`（没有真相就没有版本号） |
| `error` | `WorldSyncErrorDetail` | `ok=false` 时必填；`ok=true` 时**不得出现** | 失败详情：`{ code, message, stale?, hint? }`。`stale:true` = 状态面不可用，客户端须把本地视图标记为不可信 |

> 不变式：`ok=false` 必带 `error`，`ok=true` 不得带 `error`。协议层守卫强制之 —— **失败永远带原因**。

#### `error`（service → 客户端）

| 字段 | 类型 | 必填 | 语义 |
|------|------|------|------|
| `type` | `"error"` | 是 | 消息型 |
| `code` | `WorldSyncErrorCode` | 是 | 协议错误码（见 [§6](#6-错误码表)） |
| `message` | `string`（非空） | 是 | 一句话说明（人类可读） |
| `commandId` | `string`（非空） | 否 | 该错误由哪条命令引发时附带 |

---

## 3. 状态版本 seq 规则

1. **统一发号**：seq 由 **service 侧**统一分配，**全 service 单调递增**，不按连接分别计数 —— 两个客户端连着同一份真相，看到的 seq 必须可比。
2. **起点**：首个 snapshot 的 seq = `1`（常量 `WORLD_SYNC_SEQ_START`）。
3. **快照即版本**：每个 `snapshot` 携带一个 seq，该 seq 代表「这份快照内容 = 版本 N 的完整状态」。**快照永远是完整的** —— seq 不代表「自上次以来的增量」。
4. **ack 的 seq**：核对后的状态版本（裁决完成时刻 core store 的版本）。它可能**小于**客户端最近收到的某个 snapshot 的 seq（并发写入），也可能**大于**（裁决期间又发生了变更）。
5. **seq 的用途**：诊断与对账（「我的视图落后几版」「这条命令落在哪一版之后」）。**不用于增量合并**（本期没有增量）。
6. **跨连接不可比**：service 重启后从新实例重新计数。客户端**不得**跨连接比较 seq，也**不得**据此决定「要不要更新」—— 重连 = 全量覆盖（[§1.2](#12-重连语义写死)）。
7. **seq 不等于业务时间**：它是版本号不是时间戳；两个 snapshot 的 seq 差值**不代表**中间发生了多少次变更（状态变更可能被合并广播）。

**反例**：

```ts
// ❌ 把 seq 当时间戳 / 当增量游标用
const next = await fetch(`/api/world?since=${lastSeq}`);   // 本期没有增量接口
if (msg.seq !== lastSeq + 1) { /* 以为漏了消息 */ }
```

**正例**：

```ts
// ✅ seq 只做诊断：落后多少版，一目了然
logger.info(`world-sync 落后 ${latestSeq - localSeq} 版`);
```

---

## 4. 场景时序图

### 4.1 场景一：首次连接

```
Client (Electron 壳)                 Service (gateway 进程)              core
        │                                     │                           │
        │ ───── WS 连接 /ws/world-sync ──────► │                           │
        │                                     │                           │
        │ ─── hello {protocolVersion:1, ─────► │                           │
        │      clientId:"electron-1"}         │  版本在区间内？            │
        │                                     │   └─ 否 → error{unsupported_version} → 断开
        │                                     │   └─ 是 ↓                 │
        │                                     │ ─── 读全量状态 ──────────► │
        │                                     │ ◄─── WorldState ───────── │
        │                                     │  seq = 1                  │
        │ ◄── snapshot {seq:1, state:{…}, ─── │                           │
        │      delta:null}                    │                           │
        │                                     │                           │
        │  本地视图 = 全量覆盖                  │                           │
```

要点：连接后**第一件事**就是 `hello`；service 不发欢迎帧 —— **`snapshot` 就是对 `hello` 的回答**。版本不兼容 → `error` + 断开，不降级。

### 4.2 场景二：命令往返（成功）

```
Client                              Service                            core
   │ ── command.forward ────────────► │                                │
   │    {commandId:"c1",             │  emitCommand(command)           │
   │     command:{type:"mission.     ├───────────────────────────────► │
   │       assign", …}}              │                                │
   │                                 │              状态机裁决落点       │
   │                                 │ ◄───────────────────────────── │
   │                                 │  核对后 seq = 42               │
   │ ◄── command.ack {commandId:"c1", │                                │
   │      ok:true, seq:42} ───────── │                                │
   │                                 │  状态变更 → 广播                │
   │ ◄── snapshot {seq:43, state} ─── │                                │
```

要点：ack 只回给发起方（点对点）；随后的 snapshot 是**广播**（其它客户端也会收到）。客户端以 snapshot 为状态真相，ack 只用于判定「这次写入成没成」。

### 4.3 场景三：命令超时（internal_error）

```
Client                              Service                            core
   │ ── command.forward {c2} ──────► │                                │
   │                                 │ ─── emitCommand ──────────────► │
   │                                 │                                │
   │        …… 超过 WORLD_SYNC_ACK_TIMEOUT_MS（默认 5s）无裁决结果 ……  │
   │                                 │                                │
   │                                 │ ◄── (裁决可能仍在进行，甚至已落地) │
   │                                 │                                │
   │ ◄── command.ack {commandId:"c2",│                                │
   │      ok:false, seq:null,        │                                │
   │      error:{code:"internal_error",│                                │
   │              message:"命令裁决超时"}} ── │                        │
   │                                 │                                │
   │  结果未知 → 不重发、不假装成功；   │  若命令最终落地 → 随后的        │
   │  真相以后续 snapshot 为准         │  snapshot 会体现（迟到即真相）  │
```

要点：超时**不是成功**。客户端不得据此重发同一条命令（可能重复落地）；也不得当成失败去「撤销」（没有撤销语义）。真相以后续 snapshot 为准。

### 4.4 场景四：断连重连

```
Client                              Service
   │ ─── 连接断开 ──────────────► (socket closed)
   │  本地视图标记 stale（不可信）
   │  本地 seq 作废（不与新连接比较）
   │
   │ ───── 重新连接 /ws/world-sync ──► │
   │ ─── hello {protocolVersion:1, ───► │
   │      clientId:"electron-2"}       │  ← 新 clientId（旧壳已死）
   │ ◄── snapshot {seq:1, state:{…}} ──┤   ← 全量覆盖（当前真相）
   │
   │  本地视图 = 全量覆盖；stale 解除
```

要点：重连后 seq 从 service 当前值开始（service 未重启则延续，重启则从 1 重新计数 —— 客户端不比较，不关心）。**不做增量合并**：旧连接上收到的半截状态一律丢弃。

### 4.5 场景五：多客户端广播

```
Client A                Service (广播)                Client B
   │                         │                            │
   │ ◄── snapshot {seq:44} ──┤  状态变更 → 向所有已附着连接广播
   │                         ├──── snapshot {seq:44} ────► │
   │                         │                            │
   │ ── command.forward ────►│                            │
   │                         │  ack 点对点，不广播          │
   │ ◄── command.ack {ok} ───┤                            │
   │                         │                            │
   │                         ├──── snapshot {seq:45} ────► │  ← B 也看到了 A 的写入
```

要点：**snapshot 是广播，ack 是点对点**。多个客户端看到的是同一份真相、同一个 seq 序列（统一发号，见 [§3](#3-状态版本-seq-规则)）。客户端之间**不互相通信**，只与 service 通信。

---

## 5. 何时用 / 何时不用

### 5.1 world-sync 这条通道

**何时用**：需要**持续、低延迟、跟随式**的世界视图 —— 战场单位移动、任务相位流转、角色成长、编组槽位；且客户端是「可关可重启的壳」。

**何时不用**：

| 场景 | 为什么不用 world-sync | 该用什么 |
|------|--------------------|---------|
| 一次性读一份状态（脚本、CI、agent 探查） | 建连接 + 收一份全量快照的成本高于一次请求；且 WS 状态面是广播口径，无鉴权/无缓存 | MCP `stratix_world_snapshot`（见 [MCP-SPEC.md](MCP-SPEC.md) §2.1）或 REST |
| 拉任务全文 / 角色人设等大件 | `snapshot` 是**全量**广播，每次状态变更都带 —— 大件进广播面会撑爆带宽与渲染 | REST 读接口（按需分页/展开） |
| 远程脚本批量写 | 脚本不该常驻一条 WS | MCP 工具面（stdio / HTTP） |
| 客户端与 service 同进程（本地 Electron 直连模式） | 多绕一圈序列化 | 进程内直连 core store（dev 回退模式，SERVICE-SPLIT-PLAN 铁律 7） |
| v2 编排事件面（任务派发、agent 在线状态等事件流） | 那是**另一套**协议（`StatusSync`），事件语义 ≠ 状态快照语义 | 维持现状，另行处置 |

**反例**：

```ts
// ❌ 把 world-sync 当查询接口用：为一个单位的名字建一条长连接
const ws = new WebSocket(url);
ws.on('open', () => ws.send(JSON.stringify({ type: 'snapshot.request', unitId: 'u1' })));
// ❌ 把大件塞进广播面：每次状态变更都让所有客户端下载一遍任务全文
snapshot.state.tasks.push({ ...task, output: fullText });
```

**正例**：

```ts
// ✅ 视图客户端：订阅全量、只写命令
ws.send(encodeMessage({ type: 'hello', protocolVersion: 1, clientId })!);
ws.onmessage = (ev) => {
  const decoded = decodeMessage(ev.data as string);
  if (!decoded.ok) return;                       // 协议错误：如实上报，不猜
  if (decoded.message.type === 'snapshot') localStore.replaceAll(decoded.message.state);
};
// ✅ 写：只经 command.forward，结果看 ack
ws.send(encodeMessage({ type: 'command.forward', commandId: id, command })!);
```

### 5.2 命令写入

**何时用** `command.forward`：一切要改变世界状态的操作（派单、认领、取消、移动、编组、设置）。

**何时不用**：本地纯表现（音效、面板开合、输入框焦点）—— 那些不进状态面，也不该产生 `commandId`。

**反例**：

```ts
// ❌ 客户端乐观更新本地状态：真相在 core，乐观更新会让 UI 与真相分叉且无从察觉
localStore.applyOptimistic(command);
```

**正例**：

```ts
// ✅ 发命令，等 ack / snapshot
ws.send(encodeMessage({ type: 'command.forward', commandId, command })!);
// 状态由随后的 snapshot 落地
```

### 5.3 协议层 vs core 的裁决边界

**何时用**协议层校验：信封结构（`type` 是不是五型之一、`commandId` 非空、`seq` 是正整数、命令类型名在册）。

**何时不用**协议层校验：命令载荷的业务合法性（角色是否存在、任务是否在可取消相位、槽位号是否越界）—— **那是 core 状态机的事**（铁律 2）。协议层再抄一份校验规则 = 第二份真相，且必然随 core 演进而漂移。

**反例**：

```ts
// ❌ 在协议层抄 core 的校验：core 加一个字段/放宽一条规则，这里就过期了
if (command.type === 'mission.cancel' && !state.missions.find(m => m.id === command.missionId)) {
  return { ok: false, error: { code: 'rejected', message: '任务不存在' } };  // 谁裁决？两个真相
}
```

**正例**：

```ts
// ✅ 协议层只挡「形状不对」的；业务拒绝由 core 裁决，service 转成 ack
if (!isCommandForwardMessage(msg)) {
  send({ type: 'error', code: 'malformed_message', message: '命令信封不合法' });
  return;
}
const outcome = core.emitCommand(msg.command);      // ← 唯一的裁决点
send(outcome.ok ? createOkAck(msg.commandId, seq) : createFailedAck(msg.commandId, 'rejected', outcome.message));
```

---

## 6. 错误码表

| 码 | 出现位置 | 含义 | 客户端该怎么做 | 可重试 |
|----|---------|------|---------------|-------|
| `malformed_message` | `error` / `decode` | JSON 解不开，或信封字段缺失/类型不对 | 记日志、断连重连；不要重发同一条坏消息 | 否（消息本身有问题） |
| `unknown_message_type` | `error` / `decode` | `type` 不在五型之内（协议版本错配的典型症状） | 核对协议版本；断连重连 | 否 |
| `unsupported_version` | `error` | `hello.protocolVersion` 不在支持区间 | 升级/降级客户端版本后重连；不要试图绕过 | 否 |
| `not_attached` | `command.ack.error` | 状态面未附着（service 没接上 core store） | 把本地视图标记 stale；UI 如实显示「未连接」；等 service 就绪后重连 | 是（稍后重试） |
| `rejected` | `command.ack.error` | core 状态机裁决拒绝该命令（业务拒绝） | 按 `message`/`hint` 修正后重新发起 | 视情况 |
| `internal_error` | `command.ack.error` / `error` | 内部失败，含**命令裁决超时** | 结果未知 → 不重发；以后续 snapshot 为准 | 是（重连后确认） |

> 所有失败回执都带 `message`（一句话说明）。`not_attached` 与超时类失败额外带 `stale` 或明确的「结果未知」口径 —— **绝不假装成功**（铁律 4）。

---

## 7. 协议演进

### 7.1 只加不删

字段与消息型**只增不删**：新增可选字段是兼容的（老客户端忽略未知字段）；删除字段、改字段语义、改消息型 = 破坏性变更，**必须**升协议版本。

### 7.2 增量预留（本期不实现）

`snapshot.delta` 是本期恒为 `null` 的**预留字段位**。将来若引入增量 patch：

- 语义保持「`state` 仍是全量真相，`delta` 是可选补丁」→ 客户端仍可只读 `state`；
- 客户端**必须**同时支持「有 delta」与「无 delta」两种情况（老客户端看 `delta === null` 即按全量处理）；
- 铁律 1 不变：**重连 = 全量覆盖**，增量只用于同一连接内的连续推送。

### 7.3 版本协商

`hello.protocolVersion` 是客户端自报值。service 侧规则：

1. `WORLD_SYNC_MIN_PROTOCOL_VERSION ≤ v ≤ WORLD_SYNC_PROTOCOL_VERSION` → 接受，按该版本语义处理；
2. 越界 → 回 `error{code:'unsupported_version', message}` 并断开该连接；
3. **不静默降级** —— 用一个客户端不认识的语义去服务它，比断开更糟。

### 7.4 破坏性变更清单（升版本时逐条核对）

| 变更 | 破坏性 | 说明 |
|------|-------|------|
| 新增消息型（如 `snapshot.delta` 独立成消息） | 是 | 老客户端会判 `unknown_message_type` → 必须先升版本 |
| 新增可选字段 | 否 | 老客户端忽略 |
| 改 `seq` 语义（如改成按连接计数） | 是 | 客户端的「落后几版」诊断会失真 |
| 改 `command.ack.ok=false` 时不再带 `error` | 是 | 违反「失败必带原因」不变式 → 客户端会失去失败原因 |
| 编组 wire 形态变更（`selectionGroups` 换形状） | 是 | 客户端解码路径要改 |
