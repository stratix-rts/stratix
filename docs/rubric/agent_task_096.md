# agent_task_096 —— MCP 会话读面（S6）工作文档

> 任务：v3.2a S6（task_096）—— MCP `session_list` + `session_get` 两只只读工具 + MCP-SPEC.md 增补。
> 方案：docs/SESSION-PLAN.md §4（MCP 段）。
> 前置：S1 域模型（task_091，9a750c4）、S2 存储 + 读 API（task_092，015f2d2）、S3 组合根接线（task_093，2db46b0）、
> S4 互聊接入会话域（task_094，e81b328）、S5 会话面板（task_095，de97686）。
> 日期：2026-11-02。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/stratix-gateway/mcp/tools/session.ts` | 两只只读工具：`stratix_session_list`（kind/status 过滤 + limit/offset 分页 + returned/total/truncated + poll 引导）、`stratix_session_get`（会话摘要 + 事件流一段 + before_seq 游标 + has_more） |
| `src/core/session/types.ts` | 会话域**读取口契约**：`SessionReadPort` / `SessionListQuery` / `SessionPage` / `SessionEventQuery` / `SessionEventView`（纯回调契约，core 零 IO —— 与写面 `SessionPersistPort` 同一纪律） |
| `src/app/services/persistence/session-reader.ts` | 读取口的**生产实现**：`createSessionReader(db)` —— 两张表的行 → core 会话形状；`toSessionRecord` / `toSessionEventView` 映射 |
| `src/app/services/persistence/session-dao.ts` | 追加 `countSessionRecords(db, filter)`（列表要报 total —— 只取一页分不清"总共就这么多"与"还有下一页"） |
| `src/stratix-gateway/mcp/context.ts` | 默认读口 `readSessionsFromDatabase()`（**同进程**直读 service 侧 SQLite，铁律 6 合法）+ 懒连接代理（库是懒初始化的）+ 组合根默认接线 |
| `src/stratix-gateway/mcp/types.ts` | `McpHost.readSessions` 端口 + 新错误码 `session_not_found` |
| `src/stratix-gateway/mcp/envelope.ts` | `session_not_found` 的错误码元数据（SPEC 附录 A 的代码侧镜像） |
| `src/stratix-gateway/mcp/server.ts` / `index.ts` | 注册两件工具（排序位 10 / 11）+ 出口导出 |
| `src/stratix-gateway/mcp/__tests__/session.test.ts` | 工具单测 14 例（真实 sql.js 适配器 + 真实 DAO + 真实读口 —— 数据是真写进去的行） |
| `src/stratix-gateway/mcp/__tests__/registry.test.ts` / `transport.test.ts` | tools/list 清单回归（九件 → 十一件；既有九件次序逐字未变） |
| `docs/MCP-SPEC.md` | §2.10 / §2.11 两工具条目（description / inputSchema / 返回 payload / 错误码 / poll 链 / **行号**）+ 目录 + §2.0 映射表 + §3.4 只读面清单 + §4.2 域表 + 附录 A 错误码 + §5.5 v1.4 演进行 + §6.0 口径说明 |
| `.long-run-agent/tasks/task_096.md` | 验收勾选 + 实现记录 + 验证输出（原样贴入） |
| `docs/rubric/agent_task_096.md` | 本工作文档 |

## 2. 关键设计决策

1. **读口是 core 契约、不是 gateway 直连 DAO**：core/session/types.ts 增 `SessionReadPort`（纯回调，
   与写面 `SessionPersistPort` 成对）→ app 层 `session-reader.ts` 实现 → gateway 经 `McpHost.readSessions`
   消费。三层各守其位：core 零 IO（不 import DAO / SQLite）、app 只认持久化行、gateway 只认 core 契约。
2. **读面以库为准，不读 WorldState**：WorldState.sessions 只带**在办会话的摘要**（上限 MAX_SESSIONS=200，
   且裁掉已关闭的最旧会话），而**事件本体根本不入广播**（性能铁律：广播体积必须有界）。外部 agent 要看的是
   「发生过什么」→ 读库。与 service 侧只读 API（GET /api/storage/sessions）是同一份数据、同一句 SQL。
3. **同进程直读合法**（铁律 6 / A3 拓扑）：MCP 与 service 同进程（gateway 进程**就是** service 进程）→
   读自己进程开的库，不是「第二个进程开同一个库」。参照 `mcp/context.ts` 既有 `readTaskOutputFromDatabase`
   模式。stdio 独立入口没有 service → 如实报 internal_error（SPEC §2.10 已写明），不静默回空列表。
4. **失败不吞**：库未初始化 / 查询失败 → 抛错（server 层转 internal_error）。吞掉并回空列表等于谎称"没有会话"。
   端口缺席（读口没接）同样报 internal_error，**不回空列表冒充"没有会话"**（空列表说的是"这里没有会话"，
   端口缺席说的是"本进程读不到会话"，两句话意思完全不同）。
5. **`truncated` 的口径是"本页之后还有"**（`total > offset + returned`）：只看"本页条数 < 总数"会把翻到
   最后一页也说成"还有更多"，骗模型一直翻页。
6. **事件读面 payload 是 unknown**（`SessionEventView`）：写面是判别联合（形状被 core 校验过），读面是
   "库里存什么就回什么" —— 一条脏行不该炸掉整页读取。故读面与写面分开两个类型。
7. **`offset` 是位置不是游标**：负值直接 invalid_arguments，不静默夹到 0（静默夹断会让模型以为翻到了第一页）。
8. **参数名走 snake_case**（`session_id` / `before_seq`）：与仓库既有工具与 SPEC 的命名惯例一致。
9. **写面缺席是有意的**：中断 / 恢复 / 收尾会话属 2b（`session_interrupt` / `session_resume`），
   本批只做只读面（SPEC §4.2 已登记扩展位）。任务书明确不做。
10. **新增错误码只加一个**：`session_not_found`（读面"id 不存在"）。其余复用附录 A 既有码
    （invalid_arguments / internal_error）。
11. **零新依赖、零新表、零新状态通道**：只读既有两张表；MCP 契约层只新增一个端口与一个错误码。
12. **不动 S5 领地**：`src/hud/` 与 `src/app/services/session-history/` 本单一行未改（git diff 为空）。

## 3. 验证

- `npx tsc --noEmit` → 0 错（无输出）
- `npx jest src/stratix-gateway/mcp --silent` → `Test Suites: 8 passed, 8 total / Tests: 83 passed, 83 total`
- 本任务新增套件：`npx jest src/stratix-gateway/mcp/__tests__/session.test.ts --silent` → 14 passed
- `npx jest --silent`（全量）→ `Test Suites: 203 passed, 203 total / Tests: 6 skipped, 4111 passed, 4117 total`
- Lint（改动文件）：`npx eslint --cache <改动文件>` → 0 error（测试目录被 eslint 配置忽略）
- **生产路径冒烟**（临时脚本，跑完即删）：全局库单例 + `createCoreMcpHost` 默认读口 + MCP server 的
  `tools/call` 帧 → 列表 / 单条 / not_found 三帧均如实返回（真库真数据，非打桩）

## 4. 未尽事项

- **stdio 独立入口读不到会话**（那是没有 service 的另一个进程，库未初始化 → internal_error）：
  会话面需在 HTTP 入口（gateway 的 `/mcp`，与 service 同进程）使用。SPEC §2.10 已写明。
- **`session_interrupt` / `session_resume` 写面工具**：属 2b，本单按任务书明确不做（SPEC §4.2 登记扩展位）。
- **事件本体的形状校验在读面不做**（payload 原样透传）：脏行不会炸页，但脏行内容也原样回给模型 ——
  若将来要"读面也归一"，需在 session-reader 里加一层形状归一（另立项）。
- **列表的 `total` 是一次 COUNT 查询**（与取页两句 SQL，过滤条件共用）：会话量级（上限 200）下开销可忽略；
  若将来会话表长到百万级，需改成"估算 + 精确"口径（另立项）。
- **任务书写的是"10 工具（8+2）"，实际落地是 11 件（9+2）**：本单开工时工具面已是九件（既有五组工具），
  按"既有次序逐字不变 + 新增两件排在末尾"的原则实现为十一件；SPEC §6.1.4 的口径说明已同步更新。
- **S7 回归剧本**（互聊超时 → 面板可见 → 历史可查）尚未做；本单的会话读面已可供该剧本调用。
