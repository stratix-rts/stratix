/**
 * 文件职责：角色对话历史的 SQLite DAO（task_036）—— character_chat_messages 一张表的
 *   建表 / 插入 / 按角色读最近 N 条。**只做数据搬运**：序列化、参数绑定、行映射。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ 持久化记录。
 * 输出：行 ↔ 记录（PersistedChatMessage）的映射；插入是自增 id，读按 (character_id, id) 索引走。
 * 禁止事项：
 *   1. import fs / path / electron —— 本文件不知道连接从哪来（生产 = stratix-database 单例，
 *      测试 = 内存/临时文件库），才能同时跑在主进程与单测里；
 *   2. 认识 hud / core 类型 —— 行映射的输入输出是**纯持久化形状**，
 *      「库行 → 抽屉消息输入」的翻译归 chat-history.ts（渲染侧）；
 *   3. 在这里定业务规则（何时写入、50 条窗口多大）—— 时机归 chat-service，窗口常量归 chat-history.ts；
 *   4. 拼 SQL 字符串 —— 一律参数绑定（?），表名常量不出现在插值里。
 *
 * why 表不叫 messages：messages 表自 v1 起就是项目/频道聊天（project_id/channel_id 形状），
 *   角色对话历史是另一条数据通道 —— 单独建表，命名对齐既有 agent_chat_messages 的先例。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 createTables/migrate 保持同构
 * （那边管 schema_version 迁移，这边管 IF NOT EXISTS 兜底：DAO 单独在旧库/测试库上也能就位）。
 *
 * @since v3.15，task_036。
 */

import type { SqliteDatabaseLike } from './game-save-dao';

/** character_chat_messages 表名（与 StratixDatabase 里的 DDL 同名 —— 改一处必须同步另一处）。 */
export const CHARACTER_CHAT_MESSAGES_TABLE = 'character_chat_messages';

/**
 * 消息角色词表（与表 CHECK 约束一致）：
 * user = 本端说的；assistant = 角色 agent 回的（含流式收束后的整段 / 占位与中断标注）；
 * system = transport 失败事件；error = 旧版错误行（保留回读兼容）。
 */
export type PersistedChatMessageRole = 'user' | 'assistant' | 'system' | 'error';

/** character_chat_messages 的一行。id 是自增主键（同一角色内天然按 id 升序 = 写入顺序）。 */
export interface PersistedChatMessage {
  readonly id: number;
  readonly characterId: string;
  readonly role: PersistedChatMessageRole;
  readonly content: string;
  /** 写入该条时会话 id 的落库回执（首发前 / 无会话的 CLI 为 null；恢复口径见 chat-service 文件头）。 */
  readonly sessionRef: string | null;
  readonly createdAt: number;
}

/** 插入载荷（id 由库生成；createdAt 由写入方给 —— 保证 user 与 assistant 的先后即调用先后）。 */
export interface ChatMessageInsert {
  readonly characterId: string;
  readonly role: PersistedChatMessageRole;
  readonly content: string;
  readonly sessionRef?: string | null;
  readonly createdAt: number;
}

/** 词表导出给 IPC 校验层用（主进程拒绝表外 role，别让脏词进 CHECK 约束炸 IPC）。 */
export const PERSISTED_CHAT_ROLES: readonly PersistedChatMessageRole[] = ['user', 'assistant', 'system', 'error'];

/**
 * 建表 + 索引（IF NOT EXISTS：幂等，旧库新库都能直接调）。
 * 与 StratixDatabase 的 DDL 同构；那边负责旧 CHECK 表迁移，这里是 DAO 自立兜底。
 */
export function ensureCharacterChatMessagesTable(db: SqliteDatabaseLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CHARACTER_CHAT_MESSAGES_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'error')),
      content TEXT NOT NULL,
      session_ref TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_character_chat_messages_character
      ON ${CHARACTER_CHAT_MESSAGES_TABLE}(character_id, id);
  `);
}

/**
 * 插入一条消息（id 自增；不返回 —— 调用方不需要回读，顺序由 (character_id, id) 索引保证）。
 */
export function insertChatMessage(db: SqliteDatabaseLike, message: ChatMessageInsert): void {
  db.prepare(`
    INSERT INTO ${CHARACTER_CHAT_MESSAGES_TABLE} (character_id, role, content, session_ref, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(message.characterId, message.role, message.content, message.sessionRef ?? null, message.createdAt);
}

/**
 * 读某角色最近 limit 条（按 id 自增序 = 写入序），返回**时间正序**（最旧在前）——
 * 回填历史就是按这个顺序逐条 addMessage。limit 缺省 50（抽屉窗口口径，常量在 chat-history.ts）。
 */
export function loadChatMessages(
  db: SqliteDatabaseLike,
  characterId: string,
  limit = 50
): PersistedChatMessage[] {
  const rows = db
    .prepare(
      `SELECT id, character_id, role, content, session_ref, created_at
       FROM ${CHARACTER_CHAT_MESSAGES_TABLE}
       WHERE character_id = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(characterId, limit) as Array<Record<string, unknown>>;
  // DESC 取最近 N 条后反转为正序：窗口是「尾部 50」，展示是「从旧到新」。
  return rows
    .map((row) => ({
      id: Number(row.id),
      characterId: String(row.character_id),
      role: (PERSISTED_CHAT_ROLES as readonly string[]).includes(String(row.role))
        ? (String(row.role) as PersistedChatMessageRole)
        : 'assistant', // CHECK 约束兜底：词表外的 role 理论上进不来，防御性归一不抛
      content: String(row.content ?? ''),
      sessionRef: row.session_ref === null || row.session_ref === undefined ? null : String(row.session_ref),
      createdAt: Number(row.created_at ?? 0),
    }))
    .reverse();
}
