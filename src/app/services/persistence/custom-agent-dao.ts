/**
 * 文件职责：自定义 agent 注册表的 SQLite DAO（task_056）—— custom_agents 表的
 *   建表 / 插入 / 删除 / 全量读。**只做数据搬运**：参数绑定、行映射（与 game-save-dao 同一口径）。
 *   注册表存什么：id（名字派生 slug，拼进 kind 字符串对外广播）、name（显示名）、
 *   probeCmd（探测命令，exit 0 = 在装）、runCmdTemplate（执行模板，{prompt} 占位）、
 *   outputParser（'plain' | 'json'，CHECK 约束钉死词表）。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ 注册记录。
 * 输出：行 ↔ 记录（PersistedCustomAgentRecord）的双向映射。
 * 禁止事项：
 *   1. import fs / path / electron —— 连接由调用方给（生产 = stratix-database 单例，测试 = 内存库）；
 *   2. 判命令合法性 —— 白名单校验在 core/custom-agent.ts（三侧共用的那一道门），DAO 只存过审的串；
 *   3. 删角色 / 删检测行 —— 删除注册的联动语义（角色保留、只断检测）在主进程 IPC 层裁决；
 *   4. 拼 SQL 字符串 —— 一律参数绑定（?）。
 *
 * 安全边界：入库的 probeCmd / runCmdTemplate 已过 core 白名单校验（本模块不重复校验，
 * 但依赖 IPC 层在入口处再校验一次 —— IPC 是可信度最低的入口，纵深防御）。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的 migrateCustomAgents（schema v11）同构 ——
 * 改一处必须同步另一处（与 game-save / agent-health 的先例同一铁律）。
 *
 * @since v3.32，task_056。
 */

import type { CustomAgentOutputParser } from '../../../core/custom-agent';

/** custom_agents 表名（与 StratixDatabase 里的 DDL 同名 —— 改一处必须同步另一处）。 */
export const CUSTOM_AGENTS_TABLE = 'custom_agents';

/** custom_agents 表的一行（持久化形状；合法性校验在 core/custom-agent.ts）。 */
export interface PersistedCustomAgentRecord {
  /** 注册 id（名字派生 slug；拼进 kind = `custom:<id>`）。 */
  readonly id: string;
  /** 显示名（用户命名）。 */
  readonly name: string;
  /** 探测命令（exit 0 = 在装）。 */
  readonly probeCmd: string;
  /** 执行模板（恰好一个 {prompt} 占位符）。 */
  readonly runCmdTemplate: string;
  /** 输出解析器：plain（整段 stdout）| json（提结构化字段，取不到降级 plain）。 */
  readonly outputParser: CustomAgentOutputParser;
  readonly createdAt: number;
}

/**
 * better-sqlite3 兼容的最小连接面（与 game-save-dao 的 SqliteDatabaseLike 同构 ——
 * 两个 DAO 都跑在同一个 sql.js 适配器上，类型各自声明避免跨文件耦合，形状必须保持一致）。
 */
export interface CustomAgentDbLike {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
}

/**
 * 建表（IF NOT EXISTS：幂等，旧库新库都能直接调）。
 * 与 StratixDatabase 的 migrateCustomAgents DDL 同构；那边管 schema_version 迁移（v11），
 * 这里是 DAO 自立兜底（裸库 / 测试库直接用 DAO 也能就位）。
 * CHECK 钉死 output_parser 词表：脏值进不了审计面（与 agent_health_events 的 event CHECK 同一手法）。
 */
export function ensureCustomAgentsTable(db: CustomAgentDbLike): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${CUSTOM_AGENTS_TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      probe_cmd TEXT NOT NULL,
      run_cmd_template TEXT NOT NULL,
      output_parser TEXT NOT NULL CHECK (output_parser IN ('plain', 'json')),
      created_at INTEGER NOT NULL
    )
  `);
}

/** 行 → 记录（脏值兜底：CHECK 已钉词表，这里只做类型收口）。 */
function rowToRecord(row: Record<string, unknown>): PersistedCustomAgentRecord {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    probeCmd: String(row.probe_cmd ?? ''),
    runCmdTemplate: String(row.run_cmd_template ?? ''),
    outputParser: row.output_parser === 'json' ? 'json' : 'plain',
    createdAt: Number(row.created_at ?? 0),
  };
}

/** 插入一条注册（id 冲突即失败 —— 重复注册该被 IPC 层的查重拦住，撞主键是编程错误）。 */
export function insertCustomAgent(db: CustomAgentDbLike, record: PersistedCustomAgentRecord): void {
  db.prepare(
    `INSERT INTO ${CUSTOM_AGENTS_TABLE} (id, name, probe_cmd, run_cmd_template, output_parser, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(record.id, record.name, record.probeCmd, record.runCmdTemplate, record.outputParser, record.createdAt);
}

/** 按 id 删一条注册（不存在不报错 —— 幂等删除，与 UI 的"重复点删除"和解）。 */
export function deleteCustomAgent(db: CustomAgentDbLike, id: string): void {
  db.prepare(`DELETE FROM ${CUSTOM_AGENTS_TABLE} WHERE id = ?`).run(id);
}

/** 全量读注册（按创建时间升序 —— 扫描列表 / 设置列表的展示序稳定，不跳变）。 */
export function loadCustomAgents(db: CustomAgentDbLike): PersistedCustomAgentRecord[] {
  const rows = db
    .prepare(`SELECT id, name, probe_cmd, run_cmd_template, output_parser, created_at
              FROM ${CUSTOM_AGENTS_TABLE} ORDER BY created_at ASC, id ASC`)
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToRecord);
}

/** 按 id 查一条注册；不存在返回 null。 */
export function findCustomAgent(db: CustomAgentDbLike, id: string): PersistedCustomAgentRecord | null {
  const row = db
    .prepare(`SELECT id, name, probe_cmd, run_cmd_template, output_parser, created_at
              FROM ${CUSTOM_AGENTS_TABLE} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  return row ? rowToRecord(row) : null;
}
