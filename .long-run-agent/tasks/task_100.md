# task_100 core/session resume+fork 基础——状态机扩展与上下文快照构建器

## 描述

v3.2b-B1（docs/SESSION-PLAN.md §8）：把「互聊超时即丢」的痛点补上**恢复**与**分叉**两块 core 地基。

现状（v3.2a 2a 落地）：`src/core/session/` 有 types / machine（状态机）/ manager（写入面），
状态机里 `interrupted → active`（resume 动作）这条边**已存在**，但只翻状态位：
既不读事件流，也就没有"上文"可回灌；会话也没有分叉能力。

本单交付（**纯 core 层**，src/core/session，无 service / hud / mcp 改动）：

1. 状态机扩展：resume 的 **kind 准入**（第一期只做 peer_chat，方案 §8 关键决策）。
2. `SessionManager.resume(sessionId)`：校验 kind=peer_chat + status=interrupted，
   读 session_events 全量 → 构建回灌消息列表（上下文快照）→ status→active → 追加 'resumed' 事件。
3. `SessionManager.fork(sessionId, atSeq?)`：新建会话（id 新起、participants 继承、
   title = 原 title + 分叉标记），复制原会话事件到 atSeq（缺省全量）以新 sessionId + seq 重排落库，
   追加 'forked' 事件记录来源（payload 含 sourceSessionId / atSeq）。
4. 上下文快照构建器独立模块 `context-replay.ts`：session_events → 回灌消息列表
   （消息 / 轮次 / 中断标记映射），供后续互聊引擎（B2）消费。
5. 完整单测：迁移合法性、resume 回灌快照内容、fork 事件复制正确性与 seq 重排、atSeq 边界（0/中间/末尾）。

## Requirements

1. 纯 core 改动：只动 `src/core/session/**` 与 `src/core/__tests__/`；**不改** service / hud / mcp。
2. core 零 IO：resume / fork 要读事件流 → 走**纯回调读口**（`SessionEventReadPort`），
   core 不 import DAO / SQLite；读口缺席时**拒绝**（不编造上下文）。
3. 状态裁决留在 machine.ts（纯函数）；manager 只做"找对象 → 跑动作 → 写库 + 上报"。
4. 每个新文件头部写契约注释（职责 / 输入输出 / 禁止事项）。
5. 不引入新依赖；最小改动；不重构任务范围外的代码。
6. 失败一律返回 null + Notice，**不抛异常**（命令总线是同步的）。

## Acceptance

- [x] `npx jest src/core` 全过（29 套件 / 723 例），新增单测覆盖上述 5 点（25 例）
- [x] `npm test -- --maxWorkers=2` 全过（206 套件 / 4160 例，6 例 skip）
- [x] `npx tsc --noEmit` 无错
- [x] `npx eslint <改动文件> --cache` 无错
- [x] 不改 service / hud / mcp 任何文件
- [x] 新文件（context-replay.ts / 单测）头部有契约注释

## deliverables

- `src/core/session/context-replay.ts`（上下文快照构建器 + 分叉复制器，纯函数）
- `src/core/session/manager.ts`（`resume()` / `fork()` + 事件读口 + 翻页读全量）
- `src/core/session/machine.ts`（`canResumeSession()` / `forkSessionTitle()` / 'forked' 载荷归一）
- `src/core/session/types.ts`（'forked' 事件类型 + `SessionEventReadPort` 窄读口）
- `src/core/session/index.ts`（出口新增 context-replay）
- `src/core/__tests__/session-resume-fork.test.ts`（25 例单测）

---

## 实现说明（落地后回填）

### 关键决策

- **事件从哪来**：resume / fork 都要读事件流，而事件本体在 session_events 表（不在 WorldState ——
  广播体积必须有界）。core 零 IO，故新增**纯回调读口** `SessionEventReadPort`（与既有
  `SessionPersistPort` 同一纪律）。读口缺席 → resume / fork 被拒（`no-event-source`）——
  宁可明说"没有历史可回灌"，也不拿空上下文去骗模型。
- **读全量**：读口契约是"一段"（limit + beforeSeq 游标）→ manager 翻页读（游标向前走），
  带**无进展护栏**（读口忽略游标时会死循环 —— 挂死比少读更糟）。
- **fork 复制什么**：**对话事实**继承（message / round / interrupt），
  **会话生命周期事实**不继承（源会话的 created / closed / resumed）——
  分叉出来的是一条新会话，历史抽屉按 created 的 title 渲染，继承源的 created 会让分叉会话
  显示成源会话的标题。新会话事件流 = 自己的 created(seq=1) + 复制来的事件(seq 重排) + forked(最后)。
- **回灌快照**：只映射内容型事件；角色**相对续跑方**定（`resume(id, { selfParticipantId })`，
  缺省按参与者顺序）；回灌条数有上限（200），只保留最近若干条，丢了多少显式记 `droppedCount`。

### 实跑输出（验证）

```
$ npx jest src/core --silent --maxWorkers=2
Test Suites: 29 passed, 29 total
Tests:       723 passed, 723 total

$ npm test -- --maxWorkers=2
Test Suites: 206 passed, 206 total
Tests:       6 skipped, 4160 passed, 4166 total

$ npx tsc --noEmit
（无输出 = 无错）

$ npx eslint src/core/session/*.ts --cache
（无输出 = 无错；test 文件被 eslint ignore 规则排除）
```

### 未尽事项（B2 / B3 范围）

1. 组合根要把 `read` 读口注入 manager（B2）—— 在此之前生产进程里 resume / fork 返回 `no-event-source`（有意为之）。
2. HUD / MCP 的 `session.resume` / `session.fork` 命令与工具（B2 / B3）。
3. B7 长会话压缩落地后，"读全量"要改走"摘要 + 近期原文"路由。
