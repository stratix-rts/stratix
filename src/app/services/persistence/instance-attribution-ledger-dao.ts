/**
 * 文件职责：**步 N7 一次性归属迁移**的台账表 `instance_attribution_map` 的 SQLite DAO
 *   （@since v3.3，task_203 / M2-06）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 **N7**
 *   （「一次性迁移动作：把默认沙盒的 N 条任务 / M 个角色 / K 个会话归入某项目 —— 带预览，
 *     且**必须先完成目标 instance 的 N6 物化**」+「显式、可撤销（靠 `character_id_map` 反查回滚）」）。
 *
 * ============ 这张表是什么 ============
 *   N7 把一批行的 `instance_id` 从**源副本**改成**目标副本** ⇒ 撤销要能回答一个问题：
 *   **「这行原来属于谁、原来那一列的值长什么样？」**
 *   ⇒ 台账逐行记：行种类 + 行标识 + **迁移前的原始 `instance_id` 原值** + 源/目标副本 + 时刻。
 *
 * why 原值要**逐行**记（不能只记源副本 id）：
 *   旧行的 `instance_id` 可能是 **NULL**（步 N2：「NULL 语义 = 默认沙盒」），
 *   也可能是显式的 `'wsp_sandbox'` —— 两者**语义同源但字节不同**。
 *   撤销要「回到迁移前」⇒ 必须还原到**原值**（NULL 还原成 NULL），否则撤销后库不是迁移前的样子。
 *
 * why 不用 `character_id_map` 一张表装下：
 *   `character_id_map` 的主键是 `(old_id, instance_id)`，语义是「**id 重写**映射」（N4b 的回滚凭据）——
 *   装不下「任务 / 会话 / 外部凭据 / 跟随行」这些**异构行**（主键会互相撞）。
 *   ⇒ N7 自带一张**按行种类分区**的台账（本表），而**角色**那一类**同时**写进 `character_id_map`
 *   （设计钦定的 N7 回滚凭据；口径见 instance-attribution-migration.ts 的文件头）。
 *
 * why 落库而不是 `.stratix/state/`：同 `character_id_map` 的理由（R1-39）——
 *   台账是**回滚凭据**，必须与数据**同库备份、同事务写入、同寿命**；机器坏了映射没了就再也回不去。
 *
 * 禁止事项：
 *   1. 不在这里改业务数据 —— 本文件只管「表 + 读写」，数据改动在
 *      instance-attribution-migration.ts 的**一个事务**里发生；
 *   2. 不认识 core 的实体类型 —— 入参出参是**纯持久化形状**；
 *   3. 不拼 SQL 字符串 —— 值一律参数绑定（?），表名只走常量。
 *
 * why 不 import game-save-dao 的 `SqliteDatabaseLike`：那边 import 本文件会成环
 *   （instance-scope.ts / character-id-map-dao.ts 已用同样办法解环：本地声明结构类型）。
 */

import { type ProjectInstanceId } from '../../../core/types';

/** 台账表名（改一处必须同步另一处的 DDL）。 */
export const ATTRIBUTION_LEDGER_TABLE = 'instance_attribution_map';

/**
 * 台账里的**行种类**（决定撤销时走哪条反向 UPDATE）。
 *
 * - `character` / `task` / `session`：N7 点名的三类对象（角色 / 任务 / 会话）。
 * - `external_ref`：外部会话凭据（`session_external_refs`，联合键维度）。
 * - `unit_position` / `exp_event` / `session_event`：**跟随行** ——
 *   它们的父对象（角色 / 角色 / 会话）迁走了，它们不跟着走就变成「孤儿数据」
 *   （目标副本里会话没有历史、角色没有站位与成长记录）。
 */
export type AttributionRowKind =
  | 'character'
  | 'task'
  | 'session'
  | 'external_ref'
  | 'unit_position'
  | 'exp_event'
  | 'session_event';

/** 台账的一行。 */
export interface AttributionLedgerRecord {
  /** 行种类（决定撤销路径）。 */
  readonly rowKind: AttributionRowKind;
  /**
   * 行标识（主键的后半截）：
   * - `character` / `task` / `session` / `exp_event`：行 id；
   * - `external_ref`：外部会话 id；
   * - `unit_position`：角色行 id（`unit_positions` 的主键是 `character_id`）；
   * - `session_event`：`<session_id>#<seq>`（该表主键是 `(session_id, seq)`）。
   */
  readonly rowId: string;
  /** 迁移前的**原始** `instance_id` 原值（`null` = 迁移前那一列就是 NULL）。 */
  readonly originalInstanceId: string | null;
  /** 语义上的源副本（默认沙盒 = `wsp_sandbox`）。 */
  readonly sourceInstanceId: string;
  /** 迁入的目标副本。 */
  readonly targetInstanceId: ProjectInstanceId;
  /** 记账时刻（epoch ms）。 */
  readonly createdAt: number;
}

/**
 * better-sqlite3 兼容的最小连接面（sql.js 适配器与 better-sqlite3 都满足）。
 *
 * 本地声明（不 import game-save-dao）：那边 import 本文件会成环。
 */
export interface AttributionLedgerDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
}

/**
 * 建表 + 索引（IF NOT EXISTS：幂等，旧库新库都能直接调）。
 *
 * 索引打在 `target_instance_id` 上：撤销是**热路径**（按目标副本捞台账 ⇒ 反向 UPDATE）。
 */
export function ensureAttributionLedgerTable(db: AttributionLedgerDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${ATTRIBUTION_LEDGER_TABLE} (
      row_kind TEXT NOT NULL,
      row_id TEXT NOT NULL,
      original_instance_id TEXT,
      source_instance_id TEXT NOT NULL,
      target_instance_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (row_kind, row_id)
    );
    CREATE INDEX IF NOT EXISTS idx_instance_attribution_map_target
      ON ${ATTRIBUTION_LEDGER_TABLE}(target_instance_id);
  `);
}

/**
 * 写一条台账（幂等 upsert：同一 (row_kind, row_id) 重复写 ⇒ 覆盖，不新增行）。
 *
 * 幂等而非追加流水：台账是**凭据**不是流水 —— 同一行被迁两次（重跑）只该有一条最新的凭据，
 *   否则撤销会对着过期凭据反向 UPDATE。
 */
export function recordAttributionRow(
  db: AttributionLedgerDatabase,
  record: AttributionLedgerRecord
): void {
  db.prepare(
    `INSERT INTO ${ATTRIBUTION_LEDGER_TABLE}
       (row_kind, row_id, original_instance_id, source_instance_id, target_instance_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(row_kind, row_id) DO UPDATE SET
       original_instance_id = excluded.original_instance_id,
       source_instance_id = excluded.source_instance_id,
       target_instance_id = excluded.target_instance_id,
       created_at = excluded.created_at`
  ).run(
    record.rowKind,
    record.rowId,
    record.originalInstanceId,
    record.sourceInstanceId,
    record.targetInstanceId,
    record.createdAt
  );
}

/**
 * 列台账（按目标副本过滤；不给 `targetInstanceId` ⇒ 列全部）。
 *
 * 排序按 `created_at, row_kind, row_id`：撤销是**按台账逐条反向 UPDATE**，
 *   稳定的顺序 ⇒ 撤销结果可复现（也方便人读日志核对）。
 */
export function listAttributionRows(
  db: AttributionLedgerDatabase,
  targetInstanceId?: ProjectInstanceId
): AttributionLedgerRecord[] {
  const rows = (
    targetInstanceId === undefined
      ? db
          .prepare(
            `SELECT row_kind, row_id, original_instance_id, source_instance_id, target_instance_id, created_at
               FROM ${ATTRIBUTION_LEDGER_TABLE}
              ORDER BY created_at, row_kind, row_id`
          )
          .all()
      : db
          .prepare(
            `SELECT row_kind, row_id, original_instance_id, source_instance_id, target_instance_id, created_at
               FROM ${ATTRIBUTION_LEDGER_TABLE}
              WHERE target_instance_id = ?
              ORDER BY created_at, row_kind, row_id`
          )
          .all(targetInstanceId)
  ) as Array<Record<string, unknown>>;
  return rows.map(toRecord);
}

/** 删掉一批台账行（撤销成功后调用：凭据用掉即失效）。 */
export function deleteAttributionRows(
  db: AttributionLedgerDatabase,
  records: readonly AttributionLedgerRecord[]
): void {
  const stmt = db.prepare(
    `DELETE FROM ${ATTRIBUTION_LEDGER_TABLE} WHERE row_kind = ? AND row_id = ?`
  );
  for (const record of records) stmt.run(record.rowKind, record.rowId);
}

/**
 * 行 → 记录（纯形状映射；数值列显式转 Number，避免 sqlite 驱动返回字符串）。
 *
 * ⚠️ `original_instance_id` 保留 **null**（不要 `?? ''`）：null 与 `'wsp_sandbox'` 字节不同，
 *   撤销要还原的就是这个区别（见文件头「原值要逐行记」）。
 */
function toRecord(row: Record<string, unknown>): AttributionLedgerRecord {
  return {
    rowKind: String(row.row_kind) as AttributionRowKind,
    rowId: String(row.row_id),
    originalInstanceId:
      row.original_instance_id === null || row.original_instance_id === undefined
        ? null
        : String(row.original_instance_id),
    sourceInstanceId: String(row.source_instance_id),
    targetInstanceId: String(row.target_instance_id) as ProjectInstanceId,
    createdAt: Number(row.created_at),
  };
}
