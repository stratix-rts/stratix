# task_094 chat: 互聊接入会话域——轮次/中断落事件（修超时即丢）

## 描述

v3.2a S4：用户价值最直接的单。互聊现状内存态，超时即丢。方案 docs/SESSION-PLAN.md 第 5 节。依赖 S3（task_093）。

## Requirements

1. agent-chat-service（src/app/services/agent-chat-service.ts，先读文件头契约注释）接入 SessionManager：
   - 互聊开场 → createSession(kind=peer_chat, participants=双方)
   - 每轮 assistant 消息/用户插话 → appendEvent（type=message，payload 含角色与文本摘要）
   - 超时/取消/异常中断 → appendEvent(type=interrupt, payload=原因) + manager.interruptSession——**「（互聊中断：…）」从此是显式 interrupted 状态+落库事件，不再静默丢失**
   - 正常收场 → closeSession
2. SessionManager 经注入端口进 agent-chat-service（组合根接线在 S3 模式上补，不直接 import worldStore 单例——对齐该文件现有依赖注入风格）。
3. 既有行为零回归：`__tests__/agent-chat-service.test.ts` 全部用例（含 436 行超时用例）不许破——超时用例需增断言：session 状态=interrupted + 事件含 interrupt 标记。
4. 历史：互聊历史读取走 S2 的 session_events（面板 S5 用）；本单不动 HUD。

## Acceptance

- [x] 全流程单测：开场/轮次/中断/收场 → session record+events 双侧断言
- [x] 超时用例（436 行族）增强后绿：interrupted 状态+事件标记
- [x] 既有其余用例零回归
- [x] npx tsc --noEmit 0 错 + npx jest 全绿

## deliverables

- agent-chat-service 会话接入 + 组合根补线 + 单测增强

## 验证记录（2026-11-02）

### ① 全流程单测（新增 describe「会话域(peer_chat):开场/轮次/中断/收场」）

命令：`npx jest src/app/__tests__/agent-chat-service.test.ts --silent`

```
  会话域(peer_chat):开场/轮次/中断/收场
    ✓ 正常走完:开场建会话 + 议题与每轮发言落 message 事件 + 收尾 closed
    ✓ 回合超时:会话显式 interrupted + 落 interrupt 事件(修「超时即丢」)
    ✓ 用户停止(回合在飞):会话 interrupted,原因如实记 aborted
    ✓ 用户停止(回合之间):没有在飞回合可断,但会话照样是 interrupted
    ✓ 插话:用户的话也落一条 message 事件
    ✓ 守门拦截:不建会话(没开场就没有会话)
    ✓ 未注入会话写入面:互聊照常(会话是旁路,不是讨论的前提)

Test Suites: 1 passed, 1 total
Tests:       32 passed, 32 total
```

断言口径（session record + events 双侧）：
- record：`kind='peer_chat'` / `participants=[ch-a, ch-b]` / 正常走完 `status='closed'` + `closedAt` 有值 /
  中断 `status='interrupted'` + `closedAt=null`；
- events：`created → message(议题) → message(A1) → message(B1) → closed`（seq 会话内单调 1..5）；
  超时用例 `created → message → message → interrupt`（reason 含 `timeout` + 原始超时文案）。

### ② 超时用例族增强（436 行族 → 增断言，不改原断言）

`回合超时 → 「(互聊中断:...)」标注 + 双份落库 + 整场收束` 追加：

```ts
const record = harness.sessionRecords()[0];
expect(record?.status).toBe('interrupted');
expect(record?.closedAt).toBeNull(); // 中断不是收尾(终态)，历史还能查
const interrupts = harness.sessionEvents().filter((e) => e.type === 'interrupt');
expect(interrupts).toHaveLength(1);
expect(interrupts[0]?.payload.reason).toContain('timeout');
```

### ③ 零回归 + 类型检查

命令：`npx tsc --noEmit && npx jest src/app --silent`

```
Test Suites: 46 passed, 46 total
Tests:       612 passed, 612 total
Snapshots:   0 total
Time:        4.194 s
```

全量：`npx jest --silent` → `Test Suites: 200 passed, 200 total / Tests: 6 skipped, 4047 passed, 4053 total`。

### ④ 关键设计决策

1. **中断只调 `interruptSession`，不再单独 `appendEvent('interrupt')`**：manager 的 `interruptSession`
   已**原子地**做「记一条 interrupt 事件 + 迁移到 interrupted」（core/session/manager.ts 的 commit：
   先判合法性 → 再记事件 → 最后迁移）。再补一次 appendEvent = 同一条中断标记记两遍；顺序反了
   （先 append 后 interrupt）还会撞「已中断的会话不能再中断」的非法迁移，凭空多一条警告。
   效果等价于任务书「appendEvent(type=interrupt) + interruptSession」，但事件流里只有一条标记。
2. **会话写入面是旁路**：`deps.sessions` 缺省 / 建会话失败 / 记账抛错 → 互聊照常（只少一段历史）。
   与 chat-service（S3 的 character_chat LITE）同一纪律。
3. **议题与插话都记成 author='用户'**（`PEER_SESSION_USER_AUTHOR`）：author 语义是「谁在说」——
   议题与插话都是用户说的，发起者只是替用户把议题递给了对方。
4. **远程模式不接会话写入面**（`sessions: remote ? undefined : sessionManager`）：与 S3 的
   character_chat / task_run 同一口径 —— 远程模式下本地 worldStore 是投影缓存，本地再记一份
   会话 = 第二份真相（投影会被整帧覆盖）。
5. **回合之间叫停也算打断**（不是正常收场）：`stopRequested` 且无在飞回合可断时，会话同样是
   `interrupted`（reason='用户停止互聊'），否则用户叫停的场次会被记成「讨论完成」。

### ⑤ 未尽事项（留给 S5 / S7 / 2b）

- **本地直连模式下会话不落 SQLite**：组合根的 `sessionManager`（S3 建的）没有注入 persist 口
  （会话两张表的写口在 service 进程的 storage.ts 里），故本地模式下会话事件只进
  `WorldState.sessions`（随广播可见，S5 面板能看）但不入库。补齐需要 IPC 落库通道，属 S3/S7 的活。
- **远程模式下互聊不记会话**：互聊编排跑在渲染侧，本地写投影会被覆盖；正确做法是把会话写面
  转发到 service（需要新命令），属 2b/S7。
- **中断会话不占 FIFO 淘汰池**：core/session 的淘汰只丢 closed 会话，被中断的互聊会话长期累积会
  逼近 MAX_SESSIONS（200）→ 建会话被拒。口径待定（收尾还是允许淘汰），属会话域（S1）的事。
- 恢复续聊（interrupted → active + 上下文回灌）按方案放 2b，本单只落 interrupted 状态与事件。

