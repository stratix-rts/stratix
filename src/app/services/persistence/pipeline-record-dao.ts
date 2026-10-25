/**
 * 文件职责：多 agent 流水线的 SQLite DAO（task_051）—— pipelines 一张表的建表 / upsert /
 *   读最近 N 条。**只做数据搬运**：序列化、参数绑定、行映射（与 task-record-dao 同构的边界）。
 * 输入：一个 better-sqlite3 兼容的数据库连接 + PersistedPipelineRecord。
 * 输出：行 ↔ 记录映射。
 * 禁止事项：
 *   1. import fs / path / electron —— 连接从哪来是调用方的事（生产 = stratix-database
 *      单例，测试 = 内存库）；
 *   2. 认识 hud / core 类型 —— steps 是**透传的 JSON 字符串**（app 层 pipeline-service
 *      的 serializeSteps 产出），DAO 不解析不校验语义（只验尺寸，见 IPC 校验层）；
 *   3. 在这里定业务规则（何时写、相位怎么推进）—— 归 pipeline-service；
 *   4. 拼 SQL 字符串 —— 一律参数绑定，表名常量不出现在插值里。
 *
 * why 独立表而不塞 character_tasks：流水线是**线级编排态**（站序 / 整线相位 / 前序全文），
 *   character_tasks 是**任务级执行态**（六态相位 / 输出全文）—— 两级真相各自成表，靠
 *   character_tasks.pipeline_id 列最小归属键关联（不冗余存站相位，见那边文件头）。
 *
 * 表结构与 src/stratix-database/StratixDatabase.ts 的迁移 DDL 同构（那边管 schema_version
 *   v8 迁移记录，这边管 IF NOT EXISTS —— DAO 单独在旧库/测试库上也能就位）。
 *
 * 存活语义：running 状态只在**进程内存里有 driver** 时是活的 —— 应用重启后内存编排态
 *   归零，库里的 running 行是停机遗骸（与 049 的挂单同取舍：不复活、不回滚，审计可见）。
 *
 * @since v3.27（task_051）。
 */

import type { SqliteDatabaseLike } from './game-save-dao';

/** pipelines 表名（与 StratixDatabase 里的迁移 DDL 同名 —— 改一处必须同步另一处）。 */
export const PIPELINES_TABLE = 'pipelines';

/** 整线状态词表（与表 CHECK 约束一致，即 app 层 pipeline-service 的 PipelineRunStatus）。 */
export type PersistedPipelineStatus = 'running' | 'completed' | 'failed';

/** 词表导出给 IPC 校验层用（主进程拒绝表外 status，别让脏词进 CHECK 约束炸 IPC）。 */
export const PERSISTED_PIPELINE_STATUSES: readonly PersistedPipelineStatus[] = [
  'running',
  'completed',
  'failed',
];

/** pipelines 表的一行。id 是 app 侧的流水线 id（TEXT 主键 —— pipeline-service 造 id，库不自增）。 */
export interface PersistedPipelineRecord {
  readonly id: string;
  readonly name: string;
  /** 原始议题（{{task}} 的源文本，存档审计用）。 */
  readonly issue: string;
  readonly status: PersistedPipelineStatus;
  /**
   * 站态 JSON 字符串（[{characterId, taskId, phase, prompt}] —— pipeline-service 的
   * serializeSteps 产出）。DAO 只透传不解析；读最近时的语义解读归调用方。
   */
  readonly steps: string;
  readonly createdAt: number;
  /** 终态时间；running = null。 */
  readonly finishedAt: number | null;
}

/** 建表 DDL —— 与 StratixDatabase 的 v8 迁移 DDL 同构，两处同步改。 */
const PIPELINES_DDL = `
  CREATE TABLE IF NOT EXISTS ${PIPELINES_TABLE} (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    issue TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
    steps TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    finished_at INTEGER
  )`;

/**
 * 建表（幂等，旧库新库都能直接调）：老库（v7 及以前没有这张表）CREATE IF NOT EXISTS
 * 就位；新库由 StratixDatabase 的 v8 迁移先建过，这里零成本直过。
 */
export function ensurePipelinesTable(db: SqliteDatabaseLike): void {
  db.exec(`
    ${PIPELINES_DDL};
    CREATE INDEX IF NOT EXISTS idx_pipelines_created
      ON ${PIPELINES_TABLE}(created_at);
  `);
}

/**
 * upsert 一条流水线（按 id 冲突时全字段覆盖 —— pipeline-service 每次相位迁移落一次：
 * 发起时 running、每站入列/收尾、整线终态；终态是最后一次写）。
 */
export function upsertPipeline(db: SqliteDatabaseLike, record: PersistedPipelineRecord): void {
  db.prepare(`
    INSERT INTO ${PIPELINES_TABLE}
      (id, name, issue, status, steps, created_at, finished_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      issue = excluded.issue,
      status = excluded.status,
      steps = excluded.steps,
      created_at = excluded.created_at,
      finished_at = excluded.finished_at
  `).run(
    record.id,
    record.name,
    record.issue,
    record.status,
    record.steps,
    record.createdAt,
    record.finishedAt
  );
}

/**
 * 读最近 limit 条流水线（按 created_at 倒序；面板历史 / 审计窗口，与 loadRecentTasks
 * 同口径缺省 20）。steps 原样透传（JSON 字符串），词表外 status 防御性归一 failed
 * （CHECK 约束兜底，理论进不来）。
 */
export function loadRecentPipelines(
  db: SqliteDatabaseLike,
  limit = 20
): PersistedPipelineRecord[] {
  const rows = db
    .prepare(
      `SELECT id, name, issue, status, steps, created_at, finished_at
       FROM ${PIPELINES_TABLE}
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    issue: String(row.issue ?? ''),
    status: (PERSISTED_PIPELINE_STATUSES as readonly string[]).includes(String(row.status))
      ? (String(row.status) as PersistedPipelineStatus)
      : 'failed',
    steps: String(row.steps ?? ''),
    createdAt: Number(row.created_at ?? 0),
    finishedAt: row.finished_at === null || row.finished_at === undefined ? null : Number(row.finished_at),
  }));
}
