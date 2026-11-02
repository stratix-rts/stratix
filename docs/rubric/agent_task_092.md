# agent_task_092 —— 会话存储（S2）工作文档

> 任务：v3.2a S2（task_092）—— sessions + session_events 两表 + DAO + persister 端口 + REST 读 API。
> 方案：docs/SESSION-PLAN.md §3；域模型：S1（task_091，commit 9a750c4）。
> 日期：2026-11-02。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/app/services/persistence/session-dao.ts` | sessions 表：建表 / upsert 摘要 / 按 kind+status 过滤分页 / 按 id 单读 |
| `src/app/services/persistence/session-event-dao.ts` | session_events 表：建表 / append（append-only）/ beforeSeq 游标切片读 |
| `src/app/services/persistence/session-persister.ts` | 持久化端口：`createSessionPersister(dao)`（**缺省 = 不落库**）+ DAO 工厂 + core↔行翻译 |
| `src/stratix-gateway/api/routes/session-storage.ts` | REST 读 API（**只读**）：`GET /api/storage/sessions`、`GET /api/storage/sessions/:id/events` |
| `src/stratix-database/StratixDatabase.ts` | schema v13 迁移（两张新表，只加不删，幂等） |
| `src/stratix-gateway/service/storage.ts` | service 侧读口增 `readSessions` / `readSessionEvents` + 建表兜底 |
| `src/stratix-gateway/index.ts` | 挂载会话读路由（同前缀 `/api/storage`，不同路径） |
| `scripts/smoke-session-storage.ts` | node 冒烟：真库写入 → 落盘 → 读 API 闭环（`--serve <port>` 常驻供 curl） |

单测（真 SQLite，不 mock）：

- `src/app/__tests__/persistence/session-dao.test.ts` —— upsert / append / 分页 / beforeSeq 切片 / 隔离 / 幂等 / 落盘。
- `src/app/__tests__/persistence/session-persister.test.ts` —— **缺省注入 = 不落库** + 真落库 + 失败只警告不抛。
- `src/app/__tests__/persistence/session-schema-v13.test.ts` —— 迁移幂等（新库 / v12 老库 / 重开）。
- `src/stratix-gateway/api/routes/__tests__/session-storage.test.ts` —— 路由形状 / 参数收紧 / 400 / 503 / 500。

## 2. 关键设计决策

1. **两表分工**：sessions = 可变快照（upsert，状态一直在动）；session_events = append-only 事件流
   （复合主键 `(session_id, seq)`，seq 会话内单调 → 范围扫描天然命中索引）。写语义不同，不能挤一张表。
2. **participants 存 JSON 串**：参与者是内联小集合（上限 8，core/session/types.ts），建关联表只会多一张表
   + join 成本，映射本就是恒等变换。
3. **事件 payload 存 JSON 串**：载荷按 type 变化（core 的 `SessionEventPayloadMap` 六种形状），建列会把表结构
   钉死在事件类型上；type 列负责类型判断，payload 只做附加信息。
4. **REST 只读**：读口挂在 service 侧存储件（SQLite 唯一 owner，铁律 6）；路由只有 GET，无写端点。
5. **路由单独成文件**（`session-storage.ts`）：既有 `storage.ts` 的读口类型面已定型，往里加方法会逼所有
   假读口（单测里手搓的实现）跟着改 —— 端口类型即契约，加法只加在新端口上。
6. **分页语义与既有聊天窗口同口径**：窗口 = 尾部 N 条，方向 = 从旧到新；`beforeSeq` / `offset` 是**位置**
   不是窗口，坏值一律 400（不悄悄夹成别的语义继续跑）；`kind` / `status` 词表外一律 400。
7. **schema 升到 v13**：与 v11（custom_agents）/ v12（exp_events）同模式 —— 新表 + 迁移方法 + 版本号 +1。
   受影响的既有测试断言（目标 schema 版本 12 → 13）已同步更新（7 个文件、13 处）。

## 3. 与 S1 的接口现状（**给 S3 的单条记录**）

**S1（task_091）的 `core/session/manager.ts` 没有持久化注入点** —— S1 规格明写「组合根不接线（S3 的事）」，
本单规格里「S1 manager 的持久化端口接口」在 S1 交付物中**不存在**。

按「不改 S1 的 core/session 域逻辑」的约束，本单**没有动 core**，改为在 app 层定义端口并按 core 的信封形状
对齐（`SessionRecord` / `SessionEvent`）：

- `src/app/services/persistence/session-persister.ts` 的 `SessionPersister` 端口
  （`persistSession(record)` / `persistEvent(event)`）—— S3 直接注入即可；
- `createSessionPersister(null)` = **不落库**（端口未附着时的缺省口径，模式同 exp_events 注入件）。

S3 接线有两条路（都不需要 S2 再改）：

1. 在 `core/session/manager.ts` 的选项里加一个可选 persister（core 侧改动，由 S3 决定是否动 core）；
2. **推荐**：在组合根用包装器包住 `SessionManager`，在 create / append / close 后调本端口
   —— core 零改动（core 是纯逻辑层，不该认存储）。

## 4. 验证

- `npx tsc --noEmit` → 0 错；`npx tsc -p tsconfig.test.json --noEmit` → 0 错。
- `npx jest` 全量：196 套件 / 4023 通过 / 6 跳过 / 0 失败。
- eslint（改动文件，--cache）：0 error（gateway/index.ts 的 5 条 warning 是既有的）。
- 冒烟 + curl：见下节。

## 5. curl 实测（先写后读闭环）

`npx tsx scripts/smoke-session-storage.ts --serve 7599`（真 SQLite + 真 persister + 真读路由）：

```
=== ① GET /api/storage/sessions（全部） ===
{"success":true,"data":{"sessions":[
  {"id":"session_task_run_smoke_1","kind":"task_run","title":"任务执行：巡北门","participants":["agent-alpha"],
   "status":"closed","refId":"task-smoke-001","createdAt":1700000001000,"lastEventAt":1700000009000,
   "closedAt":1700000009000,"eventCount":2},
  {"id":"session_peer_chat_smoke_1","kind":"peer_chat","title":"互聊：侦察北门",
   "participants":["agent-alpha","agent-beta"],"status":"active","refId":null,
   "createdAt":1700000000000,"lastEventAt":1700000000000,"closedAt":null,"eventCount":1}],
 "kind":null,"status":null,"limit":50,"offset":0}}

=== ② GET /api/storage/sessions?kind=peer_chat&status=active ===
{"success":true,"data":{"sessions":[{"id":"session_peer_chat_smoke_1",...}],"kind":"peer_chat","status":"active","limit":10,"offset":0}}

=== ③ GET /api/storage/sessions/session_peer_chat_smoke_1/events?limit=2 ===
{"success":true,"data":{"sessionId":"session_peer_chat_smoke_1","events":[
  {"sessionId":"session_peer_chat_smoke_1","seq":2,"type":"message","payload":{"author":"alpha","text":"在吗"},"createdAt":1700000000000},
  {"sessionId":"session_peer_chat_smoke_1","seq":3,"type":"message","payload":{"author":"beta","text":"在"},"createdAt":1700000000000}],
 "limit":2,"beforeSeq":null}}

=== ④ GET /api/storage/sessions/session_peer_chat_smoke_1/events?beforeSeq=2 ===
{"success":true,"data":{"sessionId":"session_peer_chat_smoke_1","events":[
  {"sessionId":"session_peer_chat_smoke_1","seq":1,"type":"created","payload":{"title":"互聊：侦察北门",...},"createdAt":1700000000000}],
 "limit":50,"beforeSeq":2}}

=== ⑤ 坏输入：词表外 kind → 400 ===   HTTP 400
=== ⑥ 坏游标 beforeSeq=0 → 400 ===   {"success":false,"error":"bad beforeSeq"}  HTTP 400
```

## 6. 未尽事项（留给 S3-S7）

- **S3**：把 `createSessionPersister(createSessionPersistenceDao(db))` 挂进组合根（写面接线，本单只给端口）。
- **S4/S5/S6**：互聊接会话域 / HUD 面板 / MCP 工具 —— 均不属本单。
- 本单**未**做：会话读口接 MCP（只读 REST 已就位，MCP 工具在 S6）、未做事件压缩 / fork（2b 明确不做）。
