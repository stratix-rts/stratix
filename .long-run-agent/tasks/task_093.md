# task_093 service: 组合根挂 SessionManager+persister 注入

## 描述

v3.2a S3：把会话域接进 service。方案 docs/SESSION-PLAN.md。依赖 S2（task_092）。

## Requirements

1. `createStratixService()`（src/stratix-gateway/service/）增补：SessionManager 实例（S1）+ persister 注入（S2），装配顺序对齐既有 manager 模式（manager 先建、runtime 后起）。
2. runtime 的 `session.interrupt` 命令分发：emitCommand → manager.interruptSession（回读核对落点，语义对齐 mission/task 命令）。
3. 五 kind 的 session 记录创建接线（LITE 模式，方案第 2 节表格）：
   - character_chat：chat-service 发起/收尾时 create/更新 lastEventAt（事件本体不双写，chat_messages 表保持原状）
   - task_run / mission_run：task-service settle 与 mission 终态时 create/close（LITE 两事件）
   - shell_link：agent-link 会话 open/close 时 create/close
   - peer_chat 由 S4 接，本单不碰 agent-chat-service
4. smoke：`scripts/smoke-service.ts` 增段落——session create→append→interrupt→close 后 WorldState.sessions 与 SQLite 双侧可见。
5. world-sync 无需改动（sessions 在 WorldState 自动随快照）——在任务 md 记录验证结论（快照 JSON 含 sessions 键）。

## Acceptance

- [x] smoke 双侧可见（内存态+SQLite）输出贴 md
- [x] session.interrupt 命令经 bus 往返落点核对单测绿
- [x] world-sync 快照含 sessions 验证记录贴 md
- [x] npx tsc --noEmit 0 错 + npx jest 全绿

## 验证记录（2026-11-02）

### ① smoke 双侧可见（内存态 + SQLite）

命令：`npx tsx scripts/smoke-service.ts`

```
[smoke-service] boot ok（missions=0）
[smoke-service] mission.create 落地 ok（id=mission_1793588239833_1）
[smoke-service] 执行环 ok（task=task_1793588239834_1 → completed）
[smoke-service] 会话双侧可见 ok（session=session_character_chat_1793588239880_4；内存 2 条 / 库 2 条；事件 4 条）
[smoke-service] world-sync 快照含 sessions ok（2 条）
[smoke-service] stop ok（命令不再落地）
[smoke-service] OK
```

对照说明：
- 「内存 2 条」= ① 执行环收尾自动记的 `task_run`（LITE 建+收尾）+ ② 手工建的 `character_chat`；
  「库 2 条」= `sessions` 表同样两行（同一批会话的 SQLite 侧）。
- 「事件 4 条」= 手工那条会话的 `session_events` 四行：`created,round,interrupt,closed`（seq 1..4）。
- 中断那一跳是**经总线往返**的：`emitCommand({ type: 'session.interrupt', sessionId })`
  → core runtime 裁决 → 会话状态机（active → interrupted）。

### ② session.interrupt 经 bus 往返落点核对（单测）

文件：`src/core/__tests__/session-runtime.test.ts`（打真总线 + 真 store，不 mock 总线）

```
PASS src/core/__tests__/session-runtime.test.ts
  session.interrupt：HUD 命令 → runtime 裁决 → 会话状态
    ✓ 命令经总线落到会话状态机（active → interrupted），并记一条 interrupt 事件
    ✓ 命令落点与业务侧记账写的是同一份状态（同一 manager 实例 / 同一 store）
    ✓ 会话不存在：命令被拒但不抛（不打断整轮广播），也不凭空造出会话
    ✓ 已收尾的会话再中断：状态不变（终态拒收，历史不改写）
```

语义对齐说明：落点与 `mission.*` / `task.*` 命令同一口径 —— runtime 直接调 manager，
状态合法性裁决在 core/session 的状态机里（已收尾 / 已中断的会话被拒并回 Notice，不抛异常打断整轮广播）。

### ③ world-sync 快照含 sessions（无需改协议）

`toWireState` 只摊平 `selectionGroups`，其余字段整体透传 → `sessions` 随快照走。
smoke 段（`createSnapshotMessage(1, state)`）与单测
（`src/stratix-gateway/service/__tests__/session-wiring.test.ts`）均已核对：

```
[smoke-service] world-sync 快照含 sessions ok（2 条）
```

单测断言：`Array.isArray(snapshot.state.sessions) === true`，且快照里的会话 id 与内存态一致。
**world-sync 代码零改动**（含 `HUD_COMMAND_TYPE_FLAGS` 里既有的 `'session.interrupt': true`）。

### ④ tsc + jest 全绿

命令：`npx tsx scripts/smoke-service.ts && npx tsc --noEmit && npx jest --silent`

```
Test Suites: 200 passed, 200 total
Tests:       6 skipped, 4040 passed, 4046 total
Snapshots:   0 total
Time:        21.883 s, estimated 22 s
```

`npx tsc --noEmit` 无输出（0 错）。

### 新增 / 改动单测一览

- `src/core/__tests__/session-runtime.test.ts`（新）：session.interrupt 总线往返落点（4 例）
- `src/stratix-gateway/service/__tests__/session-wiring.test.ts`（新）：持久化口缺省范式三态
  （存储件在→接管 / 显式覆盖缺省 / 两者皆缺→不落库）+ task_run / mission_run LITE 双侧可见 + 快照含 sessions（5 例）
- `src/core/agent-link/__tests__/session-link.test.ts`（新）：shell_link LITE（建链成功建会话 /
  断开收尾 / 建链失败不建会话 / dispose 收尾）（4 例）
- `src/app/__tests__/chat-session.test.ts`（新）：character_chat LITE（首建 / 复用 / 空 round 事件
  不含消息本体 / 失败路径也记）（4 例）

## 未尽事项（本单范围外）

- `peer_chat` 全量事件落库属 S4（agent-chat-service 本单未碰）。
- HUD 展示 / MCP 工具属 S5 / S6。
- `agent-link` 的 manager 目前**没有生产实例**（只在单测与 `scripts/smoke-agent-link.ts` 里被创建），
  故 shell_link 的会话接线在生产链路上尚未真正生效 —— 待 agent-link 接线单落地时，把同一个
  SessionManager 实例注入进去即可（接线面已就绪，本单已用单测覆盖）。
- 渲染侧组合根（`src/app/main/main-entry.ts`）在**远程模式**下刻意不接会话写入面
  （真相唯一：本地不能再造一份会话投影）。

## deliverables

- service 组合根增补 + runtime 分发 + 三处 LITE 接线 + smoke 段落

