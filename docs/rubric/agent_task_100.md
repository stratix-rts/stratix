# agent_task_100 — v3.2b-B1：core/session resume+fork 基础

> 任务：task_100（v3.2b-B1）—— 纯 core 层（src/core/session），不改 service / hud / mcp。
> 方案依据：docs/SESSION-PLAN.md §2（域模型 / 状态机 / manager）与 §8（v3.2b 关键决策）。

## 1. 交付物

| 文件 | 性质 | 职责 |
|---|---|---|
| `src/core/session/context-replay.ts` | 新增 | **上下文快照构建器**（事件流 → 回灌消息列表）+ **分叉复制器**（事件流 → 写面事件） |
| `src/core/session/manager.ts` | 改 | `resume()`（回灌上下文）/ `fork()`（分叉）+ 事件读口 `SessionEventReadPort` |
| `src/core/session/machine.ts` | 改 | `canResumeSession()`（kind 准入）+ `forkSessionTitle()`（分叉标题）+ 'forked' 载荷归一 |
| `src/core/session/types.ts` | 改 | 'forked' 事件类型 + `SessionEventReadPort` 窄读口（`SessionReadPort` 继承它） |
| `src/core/session/index.ts` | 改 | 出口新增 context-replay |
| `src/core/__tests__/session-resume-fork.test.ts` | 新增 | 25 例：迁移合法性 / resume 快照 / fork 复制与 seq 重排 / atSeq 边界 / 构建器口径 |

## 2. 关键设计决策（及其理由）

### 2.1 状态机：interrupted → active 本就合法（2a 已有），本单补齐的是**kind 准入**

`LEGAL_ACTIONS.interrupted = ['resume','close']` 在 v3.2a S1 就存在，故"状态机扩展"不是新增边，
而是补一条**纯函数裁决** `canResumeSession(kind, status)`：resume 第一期**只认 peer_chat**
（方案 §8：互聊的 session_events 即消息流，回灌即重放；character_chat 历史在 chat_messages 表，不搬）。

kind 准入与状态准入**分两个纯函数**：`canApplySessionAction` 管"这一步可不可执行"，
`canResumeSession` 管"能不能续跑"——合成一个判据，两处判定会各写各的。

### 2.2 事件从哪来：新增**事件读口**（而不是在 core 里攒一份内存事件表）

resume 要回灌上下文、fork 要复制时间线，两者都要**读事件流**；而事件本体在 session_events 表里
（不在 WorldState —— 广播体积必须有界的性能铁律）。core 零 IO，故只认**纯回调契约**
`SessionEventReadPort`（与既有 `SessionPersistPort` 同一纪律）。

- 为什么不是 core 自己攒内存事件表：① 内存无界（性能铁律）；② 进程重启后内存表是空的，
  而库里是全量 —— resume 会拿到**空上下文**去骗模型（两份真相的经典形态）。
- 读口缺席时 resume / fork **直接被拒**（`no-event-source`）—— 宁可明说"没有历史可回灌"。

读全量的方式：读口契约是"一段"（limit + beforeSeq 游标），故 manager 翻页读（游标向前走），
并带**无进展护栏**（读口忽略游标时会死循环 —— 挂死比少读更糟）。

### 2.3 fork 复制什么：**对话事实**继承，**会话生命周期事实**不继承

新会话的事件流 = 自己的 `created`(seq=1) + 复制来的对话事件(seq 重排) + `forked`(最后一条)。

源的 `created` **不复制**：分叉出来的是一条**新会话**，历史抽屉按 `created` 事件的 title 渲染 ——
继承源的 created 会让分叉会话显示成**源会话的标题**；同时会出现"同一会话两条 created"。
源的 `closed` / `resumed` 同理不继承（它们描述的是源会话的生命周期，分叉会话有自己的）。
消息 / 轮次 / 中断标记（= 对话事实）才继承。

复制时**按 type 收窄载荷**（读面 payload 是 unknown，写面是判别联合）：收窄不通过的行**跳过**，
不编造形状；词表外的事件类型也跳过（新增内容型事件时需同步补 `context-replay.ts` 的 switch）。

### 2.4 回灌快照：只映射内容型事件，角色**相对续跑方**定

- 映射：`message` → 正文；`round` → `（一轮对话收束：…）`；`interrupt` → `（互聊中断：原因）`
  （与历史抽屉同一措辞口径）。`created` / `resumed` / `closed` / `forked` 是会话生命周期事件，不回灌。
- 角色：peer_chat 是两个角色互聊，"谁的话算 assistant"必须**相对续跑方**定 ——
  故 `resume(id, { selfParticipantId })`；缺省按参与者顺序（第一个算 user）。
- 上限：回灌条数有上限（`MAX_SESSION_REPLAY_MESSAGES = 200`），**只保留最近若干条**
  （续跑关心"刚才聊到哪"），丢了多少条显式记在 `droppedCount`（截断不装作"这就是全部"）。

## 3. 验证

- `npx jest src/core` → 29 套件 / 723 例全过
- `npm test -- --maxWorkers=2` → 206 套件 / 4160 例全过（6 例 skip）
- `npx tsc --noEmit` → 无错
- `npx eslint <改动文件> --cache` → 无错（import/order 已修）

## 4. 未尽事项（属 B2 / B3，不在本单范围）

1. **组合根接线**：manager 的 `read` 读口要在 B2（resume 全栈）注入（service 侧 `createSessionReader`）。
   在此之前 `resume` / `fork` 在生产进程里会返回 `no-event-source`（**这是有意的**：不编造上下文）。
2. **HUD / MCP 面**：`session.resume` / `session.fork` 命令与工具（B2 / B3）。
3. 事件读口目前只用于 resume / fork；长会话压缩（B7）落地后，"读全量"要改走"摘要 + 近期原文"路由。
