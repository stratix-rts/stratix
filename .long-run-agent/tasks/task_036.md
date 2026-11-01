# task_036: 会话历史落库

## 描述
聊天消息 SQLite 持久化；抽屉打开/切角色时加载历史。

## 需求
1. messages 表：id/characterId/role/content/timestamp/sessionRef（resume 用，claude session id 等）
2. chat-service 写入时机：user 消息即时写、assistant 流 finalize 时整段写
3. 抽屉打开/切上下文 → 按角色加载历史（分页或最近 N=50 条，滚动加载可后置）
4. sessionRef 恢复：重启用 sessionRef 续会话（claude --resume；其他 adapter 按各自语义，无 resume 则新会话并在文件头注明）
5. 单测：写入/按角色查询/分页

## 依赖
- 033（存储层模式）、035（chat-service 结构）

## 验收标准
- [ ] tsc 零错误；npx jest --silent 全绿
- [ ] 刷新后历史恢复 + 会话续接（claude 真机验证一条）

## 验证方式
npm run typecheck && npx jest --silent

## 验证结果（执行时补记，2026-10-24）

**表结构落地（≠ 字面 "messages" 表）**：既有 `messages` 表自 v1 起被项目/频道聊天占用（project_id/channel_id 形状，schema 不兼容），角色对话历史单独建表 `character_chat_messages`（命名对齐既有 `agent_chat_messages` 先例），schema_version 2 → 3 迁移 + createTables 同构 DDL：
- `id INTEGER PRIMARY KEY AUTOINCREMENT` / `character_id TEXT NOT NULL` / `role TEXT CHECK (role IN ('user','assistant','error'))` / `content TEXT NOT NULL` / `session_ref TEXT`（可空，落库回执） / `created_at INTEGER NOT NULL`
- 索引 `idx_character_chat_messages_character(character_id, id)`

**改动文件**：
- `src/stratix-database/StratixDatabase.ts` —— schema v3：建表 + 迁移（migrateCharacterChatMessages）
- `src/app/services/persistence/chat-history-dao.ts`（新）—— DAO：ensure/insert/loadChatMessages（最近 N 条窗口，DESC 取尾 + 反转正序）
- `src/app/services/persistence/chat-history.ts`（新）—— 渲染侧端口：ChatHistoryApi 探测 / 库行→抽屉输入翻译（role=error → error 标记）/ makeChatMessagePersister（text→content 转写 + fire-and-forget）
- `src/app/services/chat-service.ts` —— persistMessage 依赖：user 即时写（sessionRef 可空）/ assistant finalize 整段写 / error 走 role=error / 中断与空回复占位随气泡落 assistant / 守门拦截文案不落库（瞬时引导）/ retry 不重复写 user（send/retry 拆共用 dispatch）
- `src/hud/components/chat-drawer/chat-drawer.ts` —— loadHistory 回调：open/setCharacter 触发，最近 50 条回填进 chat-catalog 会话数组；规则：内存非空不回填、流式缓冲态不回填、每角色至多一次、竞态丢弃；按需向后分页后置（文件头已注明）
- `src/electron/preload.ts` + `src/electron/main.ts` —— gameSave 面扩展两条 IPC（game:saveChatMessage / game:loadChatMessages），主进程从严校验（role 词表/content 长度/窗口 [1,200]）
- `src/app/main/main-entry.ts` —— 组合根接线：persistMessage + loadHistory 注入
- 测试：`chat-history-dao.test.ts`（新，7 用例）/ `chat-history.test.ts`（新，7 用例）/ `chat-service.test.ts`（+落库组 7 用例）/ `character-chat-drawer.test.ts`（+历史回填组 8 用例）

**sessionRef 恢复口径**：沿用 035 已固化口径——重启后首发重建会话（persona 内嵌首发），external_session_id / session_ref 只是落库回执不透传；本任务把历史消息与重建会话在 UI 层拼接连续展示（回填历史与本轮消息同一段会话数组）。

**验证输出**：
- `npm run typecheck` ✅ 零错误（typecheck:tests 亦零错误）
- `npx jest --silent` ✅ Test Suites: 117 passed, 117 total；Tests: 6 skipped, 2650 passed, 2656 total（2622 基线 + 28 新增，无回归）

**未尽事项**：
- 滚动到顶向前翻页的 UI 触发器后置（DAO 的 LIMIT 窗口语义已就位，文件头已注明）
- claude 真机"刷新后历史恢复 + 会话续接"一条待人工验证（代码路径已由单测覆盖：落库往返/回填/续接拼接）
- 聊天消息无删除/清理路径（角色删除时历史保留——审计语义；真出现脏数据再议）
