/**
 * 文件职责：**副本（instance）维度**的存储语义（@since v3.3，task_198 / M2-01）——
 *   六张表的 `instance_id` 列口径 + **查询期**的 COALESCE 命中口径。
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 **步 N1**（六表各加 instance_id 列，nullable）
 *   + **步 N2**（旧行 `instance_id IS NULL` 语义 = 默认沙盒实例；
 *   查询按 `COALESCE(instance_id, 'wsp_sandbox')` 命中；**落库不改写**）。
 * 输入：一个 better-sqlite3 兼容的连接（只要 exec + table_info 查询）+ 副本 id。
 * 输出：幂等的加列动作 + 查询谓词片段。
 * 禁止事项：
 *   1. 改写存量行的 instance_id —— 「NULL = 默认沙盒」是**查询期**语义，不是数据迁移
 *      （步 N2 的硬约束：落库不改写，旧行原样）；
 *   2. 认识 core 的实体类型 —— 这里只认「副本 id 字符串」与 SQL；
 *   3. 把外部输入拼进 SQL —— 谓词里的值一律参数绑定（?）。
 *
 * ★ 为什么单独成文件（而不是六张表各写一遍）：
 *   「旧行命中沙盒」这条口径一旦有第二份实现就必然漂移 ——
 *   有人写 `instance_id IS NULL`、有人写 `= 'wsp_sandbox'`、有人忘了 COALESCE
 *   ⇒ 同一批旧行在不同的表里落进不同的副本，老数据就会「部分消失」。
 *   ⇒ 谓词（instanceScopeCondition / instanceScopeWhere）、加列（ensureInstanceIdColumn）、
 *   表清单（INSTANCE_SCOPED_TABLES）三件事各只有**一份**出处。
 *
 * ============ 写侧载荷（@since v3.3，task_210 / M2-11）============
 *   读侧按副本过滤之后，**写侧也必须带归属**（否则副本里的行会被 COALESCE 归回沙盒）——
 *   这条口径的出处是本文件的 `writeSideInstanceId`：默认沙盒 ⇒ 不带归属（行保持 NULL，
 *   沙盒路径零变化）；其它副本 ⇒ 显式带上该副本 id。
 *
 * @since v3.3（task_198 / M2-01）。
 */

import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';

/** instance_id 列名（六表统一；改一处必须同步六张表的建表 DDL 与两处迁移链）。 */
export const INSTANCE_ID_COLUMN = 'instance_id';

/**
 * 六张带副本维度的表（design §1.3.2 步 N1 的表清单）。
 *
 * ⚠️ 与 src/stratix-database/StratixDatabase.ts 的同名常量**内容必须一致**：
 *   两层各持一份是既有 DDL 纪律的延续（stratix-database 是驱动层，不反向依赖 app 层），
 *   代价是改表清单要改两处 —— 与「DDL 两处同构」的老规矩同性质。
 */
export const INSTANCE_SCOPED_TABLES = [
  'characters',
  'character_tasks',
  'sessions',
  'session_events',
  'exp_events',
  'unit_positions',
] as const;

/** 带副本维度的表名（联合类型）。 */
export type InstanceScopedTable = (typeof INSTANCE_SCOPED_TABLES)[number];

/**
 * 读口选项（@since v3.3，task_198）：按副本过滤。
 *
 * 缺省 = **不过滤**（读全表）—— 既有调用方零改动，且「全场总览」这类口径本就不该按副本切。
 */
export interface InstanceReadOptions {
  /**
   * 副本 id（`ProjectInstanceId`）。
   *
   * 给了 ⇒ 查询按 `COALESCE(instance_id, 'wsp_sandbox') = ?` 命中：
   *   - **默认沙盒**（`DEFAULT_INSTANCE_ID`）命中旧行（`instance_id IS NULL`）
   *     与显式标了沙盒 id 的行 ⇒ **老 dsh 会话 / 老存档照常读得到，不炸**；
   *   - **其它副本**只命中自己标了该 id 的行 ⇒ 旧行对它们**不可见**（存储层的副本隔离）。
   * 不给 ⇒ 不过滤（调用方自己负责归属口径）。
   */
  readonly instanceId?: ProjectInstanceId;
}

/**
 * 最小连接面：只要 exec + table_info 查询（与 `SqliteDatabaseLike` 结构兼容，
 * 但不 import 它 —— 那会让本文件与 game-save-dao 形成环）。
 */
export interface InstanceScopeDatabase {
  prepare(sql: string): { all(...params: unknown[]): unknown[] };
  exec(sql: string): void;
}

/** 谓词片段 + 它的参数（值一律绑定，不拼串）。 */
export interface InstanceScopeCondition {
  /** SQL 片段；instanceId 缺省时是空串（调用方据此跳过拼接）。 */
  readonly sql: string;
  /** 片段的参数（顺序与 sql 里的 ? 一一对应）。 */
  readonly params: readonly unknown[];
}

/**
 * 查询谓词片段（步 N2 的唯一出处）。
 *
 * why 是 `COALESCE(instance_id, ?) = ?` 而不是 `instance_id = ?`：
 *   旧行的 instance_id 是 NULL，`instance_id = 'wsp_sandbox'` **命不中**它们
 *   ⇒ 存量数据会在切副本后集体消失（这正是 design §2.4 R1-04 要防的事故）。
 *   COALESCE 把 NULL 归一成默认沙盒 ⇒ 旧行落在沙盒名下（可读、可见、归属正确）。
 *
 * why 默认值走参数绑定而不是拼进 SQL：默认沙盒 id 是常量，但绑定免去引号转义的心智负担。
 *
 * @param instanceId 副本 id；`undefined` / `null` = **不过滤**（返回空片段）。
 */
export function instanceScopeCondition(
  instanceId: ProjectInstanceId | undefined | null
): InstanceScopeCondition {
  if (instanceId === undefined || instanceId === null) return { sql: '', params: [] };
  return {
    sql: `COALESCE(${INSTANCE_ID_COLUMN}, ?) = ?`,
    params: [DEFAULT_INSTANCE_ID, instanceId],
  };
}

/**
 * 查询谓词片段（带 WHERE / AND 前缀的成品）。
 *
 * @param prefix 前缀：查询已有 WHERE 子句时传 `'AND '`，否则传 `'WHERE '`。
 */
export function instanceScopeWhere(
  instanceId: ProjectInstanceId | undefined | null,
  prefix: 'WHERE ' | 'AND ' = 'WHERE '
): InstanceScopeCondition {
  const condition = instanceScopeCondition(instanceId);
  if (condition.sql === '') return condition;
  return { sql: `${prefix}${condition.sql}`, params: condition.params };
}

/**
 * 加列兜底（步 N1）：老库（表已存在但没有 instance_id 列）→ `ALTER TABLE ADD COLUMN`。
 *
 * 幂等：已有列直接返回（迁移可重复执行）。
 *
 * why 可空且**不带 DEFAULT**：`ALTER TABLE ... ADD COLUMN col TEXT`（无 DEFAULT）时，
 *   SQLite 把存量行的该列置 NULL —— 这正是步 N2 要的「旧行 = NULL = 默认沙盒」，
 *   而且**一个字节的存量数据都没改**（步 N2 的硬约束：零数据改写）。
 *
 * why 不在迁移里把旧行刷成 'wsp_sandbox'：那是一次真实的数据改写（旧行不再原样），
 *   与步 N2「落库不改写」互斥；查询期归一（COALESCE）就够了。
 *
 * @param table 表名（内部常量；PRAGMA 不支持参数绑定）。
 */
export function ensureInstanceIdColumn(db: InstanceScopeDatabase, table: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>;
  if (columns.length === 0) return; // 表还不存在：交给建表路径（建表 DDL 自带该列）
  if (columns.some((column) => column.name === INSTANCE_ID_COLUMN)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${INSTANCE_ID_COLUMN} TEXT`);
}

/**
 * **写侧**的归属载荷（@since v3.3，task_210 / M2-11）：副本 scope ⇒ 该写进 `instance_id` 列的值。
 *
 * 口径（与步 N2 的读侧口径同源）：
 *   - **默认沙盒**（`DEFAULT_INSTANCE_ID`）⇒ **不带归属**（`undefined` ⇒ 落 NULL）
 *     ⇒ 该行按步 N2 的 COALESCE 口径归默认沙盒 —— 与写侧补齐前**逐字节一致**
 *     （沙盒路径零变化：老行仍 NULL，新行仍 NULL）。
 *   - **其它副本** ⇒ **显式带上**该副本 id
 *     ⇒ why 必须显式：COALESCE 把 NULL 归成沙盒 ⇒ 不带归属的行会被算进**沙盒**名下
 *     ⇒ 副本里角色的站位在本副本读不回来（这正是 M2-10 验收记下的那笔写侧欠账）。
 *
 * why 沙盒要**特判**而不是统一写 'wsp_sandbox'：统一写会把「未归属」的老行改写成
 *   「显式归属沙盒」（一次真实的数据改写），与步 N2「落库不改写」相悖；
 *   而 COALESCE 口径下两者**读起来完全等价** ⇒ 没有任何收益，只有风险。
 *
 * @param scope 当前活跃副本的 scope（已按 COALESCE 口径归一：缺省 ⇒ 默认沙盒）。
 * @returns 该带的归属值；`undefined` = 不带归属（落 NULL）。
 */
export function writeSideInstanceId(scope: ProjectInstanceId): ProjectInstanceId | undefined {
  return scope === DEFAULT_INSTANCE_ID ? undefined : scope;
}
