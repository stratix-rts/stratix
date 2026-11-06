/**
 * 文件职责：**步 N7 —— 一次性归属迁移**（@since v3.3，task_203 / M2-06）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 **N7**
 *   （「一次性迁移动作：「把默认沙盒的 N 条任务 / M 个角色 / K 个会话归入某项目」——
 *     **带预览**，且**必须先完成目标 instance 的 N6 物化**（否则迁过去的是无 `role_id` 的孤儿行）」
 *     +「显式、可撤销（靠 `character_id_map` 反查回滚）」）
 *   + §1.3.2 步 **N2**（`instance_id IS NULL` 语义 = 默认沙盒；查询按 `COALESCE` 命中，**落库不改写**）
 *   + §1.3.3（角色定义归 project / 运行态归 instance ⇒ 迁的是**运行态**，不是契约）。
 *
 * ============ 三件事 ============
 *   ① **预览**（`previewInstanceAttribution`）：只读地列出「将要迁什么」——
 *      **角色 / 任务 / 会话**三类对象的计数 + 明细（外加外部凭据与跟随行）；
 *      **一个字节都不落库**（dry-run）。
 *   ② **执行**（`executeInstanceAttribution`）：**一个事务**把源副本各行的 `instance_id`
 *      改成目标副本（COALESCE 语义：NULL → 目标 id），**同事务**写台账 + `character_id_map`。
 *   ③ **撤销**（`rollbackInstanceAttribution`）：**反向 UPDATE** 把行放回源副本，
 *      **精确**回到迁移前（连 `instance_id` 原来是不是 NULL 都还原）。
 *
 * ============ 迁的是什么 ============
 *   迁的是**运行态的归属**（这一行属于哪个副本），**不是**改内容：
 *   - 角色行 `characters.id` **一律不改**（N4b 的硬规则：默认沙盒行 id 不改）⇒
 *     引用面（`character_tasks.character_id` / `unit_positions.character_id` / `sessions.participants`）
 *     **不需要改写**（id 没变）；
 *   - 契约（`.stratix/roster/*.json`）**不碰**（单向铁律：运行层改动绝不回写契约）。
 *
 * ============ 三类对象 + 外部凭据 + 跟随行 ============
 *   | 类别 | 表 | 说明 |
 *   |---|---|---|
 *   | 角色 | `characters` | 设计点名的三类之一 |
 *   | 任务 | `character_tasks` | 设计点名的三类之一 |
 *   | 会话 | `sessions` | 设计点名的三类之一 |
 *   | 外部凭据 | `session_external_refs` | 联合键 `(external_session_id, instance_id)` ⇒ **实例维度同步迁** |
 *   | 跟随行 | `unit_positions` / `exp_events` / `session_events` | 父对象迁走却不跟 ⇒ 目标副本里「会话没有历史、角色没有站位与成长记录」 |
 *
 * ============ 前置条件（硬闸门）============
 *   **目标 instance 必须先完成 N6 物化**（design N7 的明文前置）：
 *   判据 = 目标副本存在**至少一行 `role_id` 非空**的角色行（N6 物化行的签名 ——
 *   物化行才有 role_id，存量老行没有）。
 *   未物化 ⇒ **拒绝执行**（否则迁过去的是无 `role_id` 的孤儿行）。
 *
 * ============ 阻断项（宁可不改，也不要改出坏数据）============
 *   ① 目标副本 = 源副本；
 *   ② 目标副本未物化；
 *   ③ `role_id` 与目标副本既有行撞车（复合唯一索引 `(role_id, instance_id)` 会拒绝）；
 *   ④ 源副本内部 `role_id` 重复（迁过去后自己撞自己）；
 *   ⑤ 外部凭据与目标副本既有行撞车（联合主键会拒绝）。
 *
 * ============ 两张台账（各司其职）============
 *   - `character_id_map`（**设计钦定**的 N7 回滚凭据）：记**角色**那一类 ——
 *     N7 不改 id ⇒ `old_id = new_id`；这一行记的是「这个角色是 N7 迁进来的」这个事实。
 *   - `instance_attribution_map`（N7 的**精确台账**）：记**全部**行（角色 / 任务 / 会话 /
 *     外部凭据 / 跟随行），带**迁移前的原始 `instance_id` 原值** ⇒ 撤销是逐行精确反向 UPDATE。
 *     （`character_id_map` 的主键 `(old_id, instance_id)` 装不下异构行 ⇒ 装不下就另立台账。）
 *
 * ============ dsh 双面向 ============
 *   - **用**：dsh 侧把「把一份存档挂到某个 workspace」显式化成**挂载动作**；
 *     挂载前先跑一遍**同构的挂载前校验**（= 本文件的预览：同一套判定 + 同一份清单）。
 *   - **暴露**：宿主可见的控制面动作（将来 `ctx.remote.stratix` 的 admin 动作）。
 *   - 本单只交付**服务层能力 + CLI 入口 + 测试**；**UI 触发可后置**。
 *
 * 禁止事项：
 *   1. 在事务外改数据 —— 整批改 + 同事务写台账，**一个事务**；
 *   2. 改角色行 id —— N7 只改归属；
 *   3. 写契约（`.stratix/` 下的任何文件）；
 *   4. 拼 SQL 字符串插值 —— 值一律参数绑定（?），表名只走常量。
 *
 * @since v3.3（task_203 / M2-06）。
 */

import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';

import { ensureCharacterIdMapTable, recordCharacterIdMapping } from './character-id-map-dao';
import { EXP_EVENTS_TABLE } from './exp-event-dao';
import { CHARACTERS_TABLE, UNIT_POSITIONS_TABLE } from './game-save-dao';
import {
  ensureAttributionLedgerTable,
  listAttributionRows,
  recordAttributionRow,
  deleteAttributionRows,
  type AttributionLedgerRecord,
  type AttributionRowKind,
} from './instance-attribution-ledger-dao';
import { instanceScopeCondition, type InstanceScopeCondition } from './instance-scope';
import { SESSIONS_TABLE } from './session-dao';
import { SESSION_EVENTS_TABLE } from './session-event-dao';
import { SESSION_EXTERNAL_REFS_TABLE } from './session-external-ref-dao';
import { CHARACTER_TASKS_TABLE } from './task-record-dao';

// ============================================================================
// 类型
// ============================================================================

/**
 * better-sqlite3 兼容的最小连接面（sql.js 适配器与 better-sqlite3 都满足）。
 *
 * 本地声明（不 import game-save-dao）：那边 import 本文件会成环。
 *
 * `setAutoSaveEnabled` / `save` / `saveAtomically` 是**可选**能力：
 *   - `setAutoSaveEnabled(false)`：长事务期间禁止把**中间态**刷到磁盘（崩在事务中间 = 半写库）；
 *   - `save()` / `saveAtomically()`：提交后**显式**落盘一次（原子优先）。
 */
export interface AttributionDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  setAutoSaveEnabled?(enabled: boolean): void;
  save?(): void;
  saveAtomically?(): void;
}

/** 日志口（缺省静默）。 */
type Logger = (line: string) => void;

const silentLogger: Logger = (): void => {
  /* 缺省静默 */
};

/** 迁移选项（预览 / 执行 / 撤销共用）。 */
export interface AttributionMigrationOptions {
  /** 目标副本 id（迁入哪儿）。 */
  readonly targetInstanceId: ProjectInstanceId;
  /** 源副本 id（缺省 = 默认沙盒 `wsp_sandbox`；N7 的主场景就是「沙盒 → 某项目」）。 */
  readonly sourceInstanceId?: ProjectInstanceId;
  /** 时刻（epoch ms；缺省 = 现在；测试可注入固定值）。 */
  readonly now?: number;
  /** 明细清单最多列多少条（缺省 500；**计数永远是全量**）。 */
  readonly detailLimit?: number;
  /** 日志口（缺省静默）。 */
  readonly logger?: Logger;
  /** 步骤回调（**崩溃注入点**：在该步抛错 ⇒ 事务回滚 ⇒ 库回到迁移前）。 */
  readonly onStep?: (step: AttributionStep) => void;
}

/**
 * 迁移的**一步**（演练 / 测试的崩溃注入点）。
 *
 * why 要有它：「单事务」这个承诺必须有**可执行的证据** —— 崩在中途 ⇒ 库必须回到迁移前。
 */
export type AttributionStep =
  | 'characters'
  | 'tasks'
  | 'sessions'
  | 'external-refs'
  | 'unit-positions'
  | 'exp-events'
  | 'session-events';

/** 预览里的一条角色。 */
export interface AttributionCharacterPreview {
  readonly id: string;
  readonly name: string;
  /** `role_id`（null = 存量老行，没回填过 ⇒ 迁过去仍是无 role_id 的行）。 */
  readonly roleId: string | null;
  readonly level: number;
  readonly experience: number;
  /** 迁移前的原始 `instance_id` 原值（null = 那一列本来就是 NULL）。 */
  readonly originalInstanceId: string | null;
}

/** 预览里的一条任务。 */
export interface AttributionTaskPreview {
  readonly id: string;
  readonly characterId: string;
  readonly status: string;
  readonly originalInstanceId: string | null;
}

/** 预览里的一条会话。 */
export interface AttributionSessionPreview {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly status: string;
  /** 参与者（JSON 数组；解析失败为 null）。 */
  readonly participants: readonly string[] | null;
  readonly originalInstanceId: string | null;
}

/** 预览里的一条外部会话凭据。 */
export interface AttributionExternalRefPreview {
  readonly externalSessionId: string;
  readonly characterId: string | null;
  readonly sessionId: string | null;
}

/** 预览里的跟随行（父对象迁走 ⇒ 它们跟着走）。 */
export interface AttributionFollowerPreview {
  /** `unit_positions`（主键 = `character_id`）。 */
  readonly unitPositions: readonly { readonly characterId: string; readonly originalInstanceId: string | null }[];
  /** `exp_events`（主键 = 自增 id）。 */
  readonly expEvents: readonly {
    readonly id: string;
    readonly characterId: string;
    readonly originalInstanceId: string | null;
  }[];
  /** `session_events`（主键 = `(session_id, seq)`）。 */
  readonly sessionEvents: readonly {
    readonly sessionId: string;
    readonly seq: number;
    readonly originalInstanceId: string | null;
  }[];
}

/** 预览的计数（全量，与明细是否截断无关）。 */
export interface AttributionPreviewCounts {
  readonly characters: number;
  readonly tasks: number;
  readonly sessions: number;
  readonly externalRefs: number;
  readonly unitPositions: number;
  readonly expEvents: number;
  readonly sessionEvents: number;
  /** 全部行数合计。 */
  readonly total: number;
}

/** 预览结果（dry-run 的全部产出；**不落库**）。 */
export interface AttributionPreview {
  readonly sourceInstanceId: ProjectInstanceId;
  readonly targetInstanceId: ProjectInstanceId;
  /** 目标副本是否已完成 N6 物化（有 `role_id` 非空的角色行）。 */
  readonly targetMaterialized: boolean;
  /** 目标副本的角色行数（含物化行）。 */
  readonly targetCharacterCount: number;
  /** 三类对象 + 外部凭据的明细清单（可能按 `detailLimit` 截断）。 */
  readonly characters: readonly AttributionCharacterPreview[];
  readonly tasks: readonly AttributionTaskPreview[];
  readonly sessions: readonly AttributionSessionPreview[];
  readonly externalRefs: readonly AttributionExternalRefPreview[];
  /** 跟随行清单。 */
  readonly followers: AttributionFollowerPreview;
  /** 计数（全量）。 */
  readonly counts: AttributionPreviewCounts;
  /** 阻断项（任一条非空 ⇒ 拒绝执行；一个字节都不改）。 */
  readonly blockers: readonly string[];
  /** 告警（不阻断，但要让人看见）。 */
  readonly warnings: readonly string[];
  /** 明细是否因 `detailLimit` 被截断（计数仍是全量）。 */
  readonly truncated: boolean;
}

/** 执行结果。 */
export interface AttributionExecuteResult {
  readonly preview: AttributionPreview;
  /** 实际迁移的行数（按类别）。 */
  readonly applied: AttributionPreviewCounts;
  /** 是否已提交（false = 事务回滚，什么都没改）。 */
  readonly committed: boolean;
}

/** 撤销结果。 */
export interface AttributionRollbackResult {
  readonly targetInstanceId: ProjectInstanceId;
  /** 还原的行数（按类别）。 */
  readonly reverted: AttributionPreviewCounts;
  /** 还原的行数合计。 */
  readonly total: number;
}

/** 前置阻断（没动任何数据）。 */
export class AttributionBlockedError extends Error {
  public readonly blockers: readonly string[];

  constructor(blockers: readonly string[]) {
    super(`N7 归属迁移被阻断（${blockers.length} 条前置问题）：\n- ${blockers.join('\n- ')}`);
    this.name = 'AttributionBlockedError';
    this.blockers = blockers;
  }
}

// ============================================================================
// 内部：源侧快照（一次读全，事务内外共用同一份口径）
// ============================================================================

interface SourceSnapshot {
  readonly characters: readonly AttributionCharacterPreview[];
  readonly tasks: readonly AttributionTaskPreview[];
  readonly sessions: readonly AttributionSessionPreview[];
  readonly externalRefs: readonly AttributionExternalRefPreview[];
  readonly unitPositions: readonly { readonly characterId: string; readonly originalInstanceId: string | null }[];
  readonly expEvents: readonly {
    readonly id: string;
    readonly characterId: string;
    readonly originalInstanceId: string | null;
  }[];
  readonly sessionEvents: readonly {
    readonly sessionId: string;
    readonly seq: number;
    readonly originalInstanceId: string | null;
  }[];
}

/**
 * 源副本的**作用域谓词**。
 *
 * why 用 `COALESCE(instance_id, 'wsp_sandbox') = ?`（步 N2 的唯一口径，出处是 instance-scope.ts）：
 *   旧行的 `instance_id` 是 **NULL**，等值比较命不中它们 ⇒ 存量数据会被漏迁。
 */
function sourceScope(sourceInstanceId: ProjectInstanceId): InstanceScopeCondition {
  return instanceScopeCondition(sourceInstanceId);
}

/** 原始 `instance_id` 值（null = 那一列本来就是 NULL；与「语义上的源副本」是两回事）。 */
function rawInstanceId(row: Record<string, unknown>): string | null {
  const value = row.instance_id;
  return value === null || value === undefined ? null : String(value);
}

/** 读源副本的角色行。 */
function readSourceCharacters(
  db: AttributionDatabase,
  sourceInstanceId: ProjectInstanceId
): AttributionCharacterPreview[] {
  const scope = sourceScope(sourceInstanceId);
  const rows = db
    .prepare(
      `SELECT id, name, role_id, level, exp, instance_id FROM ${CHARACTERS_TABLE} WHERE ${scope.sql} ORDER BY id`
    )
    .all(...scope.params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name ?? ''),
    roleId: row.role_id === null || row.role_id === undefined ? null : String(row.role_id),
    level: Number(row.level ?? 0),
    experience: Number(row.exp ?? 0),
    originalInstanceId: rawInstanceId(row),
  }));
}

/** 读源副本的任务行。 */
function readSourceTasks(
  db: AttributionDatabase,
  sourceInstanceId: ProjectInstanceId
): AttributionTaskPreview[] {
  const scope = sourceScope(sourceInstanceId);
  const rows = db
    .prepare(
      `SELECT id, character_id, status, instance_id FROM ${CHARACTER_TASKS_TABLE} WHERE ${scope.sql} ORDER BY id`
    )
    .all(...scope.params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    characterId: String(row.character_id ?? ''),
    status: String(row.status ?? ''),
    originalInstanceId: rawInstanceId(row),
  }));
}

/** 读源副本的会话行（含 participants；解析失败记 null，不抛）。 */
function readSourceSessions(
  db: AttributionDatabase,
  sourceInstanceId: ProjectInstanceId
): AttributionSessionPreview[] {
  const scope = sourceScope(sourceInstanceId);
  const rows = db
    .prepare(
      `SELECT id, kind, title, status, participants, instance_id FROM ${SESSIONS_TABLE} WHERE ${scope.sql} ORDER BY id`
    )
    .all(...scope.params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind ?? ''),
    title: String(row.title ?? ''),
    status: String(row.status ?? ''),
    participants: parseParticipants(row.participants),
    originalInstanceId: rawInstanceId(row),
  }));
}

/**
 * 读源副本的外部会话凭据。
 *
 * why 这里的谓词是**等值**而不是 COALESCE：`session_external_refs.instance_id` 是 **NOT NULL**
 *   （那张表没有「NULL = 默认沙盒」的旧行语义 —— 见 session-external-ref-dao.ts 的文件头）。
 */
function readSourceExternalRefs(
  db: AttributionDatabase,
  sourceInstanceId: ProjectInstanceId
): AttributionExternalRefPreview[] {
  const rows = db
    .prepare(
      `SELECT external_session_id, character_id, session_id FROM ${SESSION_EXTERNAL_REFS_TABLE}
        WHERE instance_id = ? ORDER BY external_session_id`
    )
    .all(sourceInstanceId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    externalSessionId: String(row.external_session_id),
    characterId: row.character_id === null || row.character_id === undefined ? null : String(row.character_id),
    sessionId: row.session_id === null || row.session_id === undefined ? null : String(row.session_id),
  }));
}

/** 读源副本的跟随行（只取**父对象在迁移集合里**的那些）。 */
function readSourceFollowers(
  db: AttributionDatabase,
  sourceInstanceId: ProjectInstanceId,
  characterIds: ReadonlySet<string>,
  sessionIds: ReadonlySet<string>
): Pick<
  SourceSnapshot,
  'unitPositions' | 'expEvents' | 'sessionEvents'
> {
  const scope = sourceScope(sourceInstanceId);

  const positions = (
    db
      .prepare(
        `SELECT character_id, instance_id FROM ${UNIT_POSITIONS_TABLE} WHERE ${scope.sql} ORDER BY character_id`
      )
      .all(...scope.params) as Array<Record<string, unknown>>
  )
    .filter((row) => characterIds.has(String(row.character_id)))
    .map((row) => ({
      characterId: String(row.character_id),
      originalInstanceId: rawInstanceId(row),
    }));

  const expEvents = (
    db
      .prepare(
        `SELECT id, character_id, instance_id FROM ${EXP_EVENTS_TABLE} WHERE ${scope.sql} ORDER BY id`
      )
      .all(...scope.params) as Array<Record<string, unknown>>
  )
    .filter((row) => characterIds.has(String(row.character_id)))
    .map((row) => ({
      id: String(row.id),
      characterId: String(row.character_id),
      originalInstanceId: rawInstanceId(row),
    }));

  const sessionEvents = (
    db
      .prepare(
        `SELECT session_id, seq, instance_id FROM ${SESSION_EVENTS_TABLE} WHERE ${scope.sql} ORDER BY session_id, seq`
      )
      .all(...scope.params) as Array<Record<string, unknown>>
  )
    .filter((row) => sessionIds.has(String(row.session_id)))
    .map((row) => ({
      sessionId: String(row.session_id),
      seq: Number(row.seq),
      originalInstanceId: rawInstanceId(row),
    }));

  return { unitPositions: positions, expEvents, sessionEvents };
}

/** 解析 `sessions.participants`（JSON 数组；坏行返回 null，不抛 —— N7 不改写它）。 */
function parseParticipants(raw: unknown): readonly string[] | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((item) => String(item));
  } catch {
    return null;
  }
}

// ============================================================================
// 内部：阻断项 / 告警
// ============================================================================

/** 目标副本是否已完成 N6 物化（判据：有 `role_id` 非空的角色行）。 */
function isTargetMaterialized(
  db: AttributionDatabase,
  targetInstanceId: ProjectInstanceId
): { materialized: boolean; characterCount: number } {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN role_id IS NOT NULL THEN 1 ELSE 0 END) AS materialized
         FROM ${CHARACTERS_TABLE} WHERE instance_id = ?`
    )
    .get(targetInstanceId) as { total?: number; materialized?: number } | undefined;
  return {
    materialized: Number(row?.materialized ?? 0) > 0,
    characterCount: Number(row?.total ?? 0),
  };
}

/** 目标副本里已占用的 `role_id` 集合（复合唯一索引 `(role_id, instance_id)` 的另一半）。 */
function readTargetRoleIds(
  db: AttributionDatabase,
  targetInstanceId: ProjectInstanceId
): Set<string> {
  const rows = db
    .prepare(`SELECT role_id FROM ${CHARACTERS_TABLE} WHERE instance_id = ? AND role_id IS NOT NULL`)
    .all(targetInstanceId) as Array<Record<string, unknown>>;
  return new Set(rows.map((row) => String(row.role_id)));
}

/** 目标副本里已占用的外部会话 id 集合（联合主键 `(external_session_id, instance_id)`）。 */
function readTargetExternalSessionIds(
  db: AttributionDatabase,
  targetInstanceId: ProjectInstanceId
): Set<string> {
  const rows = db
    .prepare(`SELECT external_session_id FROM ${SESSION_EXTERNAL_REFS_TABLE} WHERE instance_id = ?`)
    .all(targetInstanceId) as Array<Record<string, unknown>>;
  return new Set(rows.map((row) => String(row.external_session_id)));
}

/** 库里存在但**不在**迁移集合里的角色 id（判「引用会不会悬空」用）。 */
function readKnownCharacterIds(db: AttributionDatabase): Set<string> {
  const rows = db.prepare(`SELECT id FROM ${CHARACTERS_TABLE}`).all() as Array<
    Record<string, unknown>
  >;
  return new Set(rows.map((row) => String(row.id)));
}

/** 阻断项（任一条非空 ⇒ 拒绝执行）。 */
function collectBlockers(
  db: AttributionDatabase,
  options: AttributionMigrationOptions,
  snapshot: SourceSnapshot,
  targetMaterialized: boolean
): string[] {
  const target = options.targetInstanceId;
  const source = options.sourceInstanceId ?? DEFAULT_INSTANCE_ID;
  const blockers: string[] = [];

  if (target === source) {
    blockers.push(`目标副本与源副本相同（${target}）⇒ 迁移没有意义`);
  }
  if (!targetMaterialized) {
    blockers.push(
      `目标副本 ${target} 尚未完成 N6 物化（没有 role_id 非空的角色行）⇒ 拒绝执行（design §1.3.2 N7 的明文前置）`
    );
  }

  // role_id 撞车（复合唯一索引 `(role_id, instance_id)` 会拒绝）。
  const targetRoleIds = readTargetRoleIds(db, target);
  const seenRoleIds = new Map<string, string>();
  for (const character of snapshot.characters) {
    if (character.roleId === null) continue;
    const duplicateInSource = seenRoleIds.get(character.roleId);
    if (duplicateInSource !== undefined) {
      blockers.push(
        `源副本内部 role_id 重复：角色行 ${character.id} 与 ${duplicateInSource} 的 role_id=${character.roleId} 相同（迁过去后违反复合唯一索引 (role_id, instance_id)）`
      );
      continue;
    }
    if (targetRoleIds.has(character.roleId)) {
      blockers.push(
        `role_id 冲突：角色行 ${character.id} 的 role_id=${character.roleId} 在目标副本 ${target} 已有行（复合唯一索引 (role_id, instance_id) 会拒绝）`
      );
      continue;
    }
    seenRoleIds.set(character.roleId, character.id);
  }

  // 外部凭据撞车（联合主键会拒绝）。
  const targetExternalIds = readTargetExternalSessionIds(db, target);
  for (const ref of snapshot.externalRefs) {
    if (targetExternalIds.has(ref.externalSessionId)) {
      blockers.push(
        `外部会话凭据冲突：${ref.externalSessionId} 在目标副本 ${target} 已有凭据（联合主键 (external_session_id, instance_id) 会拒绝）`
      );
    }
  }

  return blockers;
}

/** 告警（不阻断，但要让人看见）。 */
function collectWarnings(
  db: AttributionDatabase,
  snapshot: SourceSnapshot
): string[] {
  const warnings: string[] = [];
  const characterIds = new Set(snapshot.characters.map((character) => character.id));
  const knownCharacterIds = readKnownCharacterIds(db);

  const roleLess = snapshot.characters.filter((character) => character.roleId === null);
  if (roleLess.length > 0) {
    warnings.push(
      `${roleLess.length} 个角色行没有 role_id（存量老行）⇒ 迁过去仍是无 role_id 的行`
    );
  }

  const danglingTasks = snapshot.tasks.filter((task) => !characterIds.has(task.characterId));
  if (danglingTasks.length > 0) {
    warnings.push(
      `${danglingTasks.length} 条任务引用的角色不在迁移集合里（迁过去后这些任务在目标副本里指向不到角色行）`
    );
  }

  let danglingParticipants = 0;
  let brokenParticipants = 0;
  for (const session of snapshot.sessions) {
    if (session.participants === null) {
      brokenParticipants += 1;
      continue;
    }
    for (const participant of session.participants) {
      // 只对「确实是角色行 id」的参与者告警（agent id / link id / clientId 不在角色表里 ⇒ 不算）。
      if (!knownCharacterIds.has(participant)) continue;
      if (!characterIds.has(participant)) danglingParticipants += 1;
    }
  }
  if (danglingParticipants > 0) {
    warnings.push(
      `${danglingParticipants} 个会话参与者是**不迁移**的角色行（迁过去后这些参与者指向不到目标副本里的角色）`
    );
  }
  if (brokenParticipants > 0) {
    warnings.push(
      `${brokenParticipants} 条会话的 participants 不是可解析的 JSON 数组（未校验其引用；N7 不改写 participants）`
    );
  }

  return warnings;
}

// ============================================================================
// 对外：预览（dry-run）
// ============================================================================

/**
 * **预览**：只读地列出「将要迁什么」—— **一个字节都不落库**。
 *
 * 输出三件事：
 *   ① **三类对象**（角色 / 任务 / 会话）的计数 + 明细；
 *   ② **阻断项**（非空 ⇒ 执行会被拒）与**告警**；
 *   ③ 外部凭据与跟随行的清单。
 */
export function previewInstanceAttribution(
  db: AttributionDatabase,
  options: AttributionMigrationOptions
): AttributionPreview {
  const sourceInstanceId = options.sourceInstanceId ?? DEFAULT_INSTANCE_ID;
  const targetInstanceId = options.targetInstanceId;
  const detailLimit = options.detailLimit ?? 500;

  const snapshot = collectSnapshot(db, sourceInstanceId);
  const target = isTargetMaterialized(db, targetInstanceId);
  const blockers = collectBlockers(db, options, snapshot, target.materialized);
  const warnings = collectWarnings(db, snapshot);

  const counts: AttributionPreviewCounts = {
    characters: snapshot.characters.length,
    tasks: snapshot.tasks.length,
    sessions: snapshot.sessions.length,
    externalRefs: snapshot.externalRefs.length,
    unitPositions: snapshot.followers.unitPositions.length,
    expEvents: snapshot.followers.expEvents.length,
    sessionEvents: snapshot.followers.sessionEvents.length,
    total:
      snapshot.characters.length +
      snapshot.tasks.length +
      snapshot.sessions.length +
      snapshot.externalRefs.length +
      snapshot.followers.unitPositions.length +
      snapshot.followers.expEvents.length +
      snapshot.followers.sessionEvents.length,
  };

  const truncated =
    counts.characters > detailLimit ||
    counts.tasks > detailLimit ||
    counts.sessions > detailLimit ||
    counts.externalRefs > detailLimit;

  return {
    sourceInstanceId,
    targetInstanceId,
    targetMaterialized: target.materialized,
    targetCharacterCount: target.characterCount,
    characters: snapshot.characters.slice(0, detailLimit),
    tasks: snapshot.tasks.slice(0, detailLimit),
    sessions: snapshot.sessions.slice(0, detailLimit),
    externalRefs: snapshot.externalRefs.slice(0, detailLimit),
    followers: snapshot.followers,
    counts,
    blockers,
    warnings,
    truncated,
  };
}

/** 读源副本的全量快照（预览与执行共用同一份口径 ⇒ 预览说的就是执行要做的）。 */
function collectSnapshot(
  db: AttributionDatabase,
  sourceInstanceId: ProjectInstanceId
): SourceSnapshot & { readonly followers: AttributionFollowerPreview } {
  const characters = readSourceCharacters(db, sourceInstanceId);
  const tasks = readSourceTasks(db, sourceInstanceId);
  const sessions = readSourceSessions(db, sourceInstanceId);
  const externalRefs = readSourceExternalRefs(db, sourceInstanceId);

  const characterIds = new Set(characters.map((character) => character.id));
  const sessionIds = new Set(sessions.map((session) => session.id));
  const followers = readSourceFollowers(db, sourceInstanceId, characterIds, sessionIds);

  return {
    characters,
    tasks,
    sessions,
    externalRefs,
    unitPositions: followers.unitPositions,
    expEvents: followers.expEvents,
    sessionEvents: followers.sessionEvents,
    followers,
  };
}

// ============================================================================
// 对外：执行（单事务）
// ============================================================================

/**
 * **执行**：把源副本的行迁进目标副本（**一个事务**）。
 *
 * 事务里发生的事（顺序固定）：
 *   ① 重算快照 + 重查阻断项（**事务内**再查一次 ⇒ 别的进程刚写进来的状态也算数）；
 *   ② 逐行 UPDATE `instance_id`（角色 / 任务 / 会话 / 外部凭据 / 跟随行）；
 *   ③ 同事务写台账 `instance_attribution_map`（含**迁移前的原值**）；
 *   ④ 同事务写 `character_id_map`（角色那一类 —— 设计钦定的 N7 回滚凭据）；
 *   ⑤ COMMIT（提交后显式落盘一次）。
 *
 * 任一步失败 ⇒ ROLLBACK ⇒ 库回到迁移前（可重跑）。
 *
 * @throws AttributionBlockedError 有阻断项（**没动任何数据**）。
 */
export function executeInstanceAttribution(
  db: AttributionDatabase,
  options: AttributionMigrationOptions
): AttributionExecuteResult {
  const sourceInstanceId = options.sourceInstanceId ?? DEFAULT_INSTANCE_ID;
  const targetInstanceId = options.targetInstanceId;
  const logger = options.logger ?? silentLogger;
  const createdAt = options.now ?? Date.now();

  // 表就位（幂等）：老库上直接调也能迁。
  ensureAttributionLedgerTable(db);
  ensureCharacterIdMapTable(db);

  db.setAutoSaveEnabled?.(false);
  db.exec('BEGIN');
  try {
    // ① 事务内重算。
    const snapshot = collectSnapshot(db, sourceInstanceId);
    const target = isTargetMaterialized(db, targetInstanceId);
    const blockers = collectBlockers(db, options, snapshot, target.materialized);
    if (blockers.length > 0) {
      throw new AttributionBlockedError(blockers);
    }

    const applied = {
      characters: 0,
      tasks: 0,
      sessions: 0,
      externalRefs: 0,
      unitPositions: 0,
      expEvents: 0,
      sessionEvents: 0,
      total: 0,
    };

    // ② 逐行 UPDATE + ③ 记台账（同一事务）。
    options.onStep?.('characters');
    for (const character of snapshot.characters) {
      db.prepare(`UPDATE ${CHARACTERS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        targetInstanceId,
        character.id
      );
      recordAttributionRow(db, {
        rowKind: 'character',
        rowId: character.id,
        originalInstanceId: character.originalInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      // ④ 角色那一类同时写 character_id_map（设计钦定的 N7 回滚凭据；N7 不改 id ⇒ old_id = new_id）。
      recordCharacterIdMapping(db, {
        oldId: character.id,
        newId: character.id,
        instanceId: targetInstanceId,
        createdAt,
      });
      applied.characters += 1;
    }

    options.onStep?.('tasks');
    for (const task of snapshot.tasks) {
      db.prepare(`UPDATE ${CHARACTER_TASKS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        targetInstanceId,
        task.id
      );
      recordAttributionRow(db, {
        rowKind: 'task',
        rowId: task.id,
        originalInstanceId: task.originalInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      applied.tasks += 1;
    }

    options.onStep?.('sessions');
    for (const session of snapshot.sessions) {
      db.prepare(`UPDATE ${SESSIONS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        targetInstanceId,
        session.id
      );
      recordAttributionRow(db, {
        rowKind: 'session',
        rowId: session.id,
        originalInstanceId: session.originalInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      applied.sessions += 1;
    }

    options.onStep?.('external-refs');
    for (const ref of snapshot.externalRefs) {
      // 联合主键 (external_session_id, instance_id) ⇒ WHERE 带**旧**实例维度。
      db.prepare(
        `UPDATE ${SESSION_EXTERNAL_REFS_TABLE} SET instance_id = ?
          WHERE external_session_id = ? AND instance_id = ?`
      ).run(targetInstanceId, ref.externalSessionId, sourceInstanceId);
      recordAttributionRow(db, {
        rowKind: 'external_ref',
        rowId: ref.externalSessionId,
        originalInstanceId: sourceInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      applied.externalRefs += 1;
    }

    options.onStep?.('unit-positions');
    for (const position of snapshot.unitPositions) {
      db.prepare(`UPDATE ${UNIT_POSITIONS_TABLE} SET instance_id = ? WHERE character_id = ?`).run(
        targetInstanceId,
        position.characterId
      );
      recordAttributionRow(db, {
        rowKind: 'unit_position',
        rowId: position.characterId,
        originalInstanceId: position.originalInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      applied.unitPositions += 1;
    }

    options.onStep?.('exp-events');
    for (const event of snapshot.expEvents) {
      db.prepare(`UPDATE ${EXP_EVENTS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        targetInstanceId,
        event.id
      );
      recordAttributionRow(db, {
        rowKind: 'exp_event',
        rowId: event.id,
        originalInstanceId: event.originalInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      applied.expEvents += 1;
    }

    options.onStep?.('session-events');
    for (const event of snapshot.sessionEvents) {
      db.prepare(
        `UPDATE ${SESSION_EVENTS_TABLE} SET instance_id = ? WHERE session_id = ? AND seq = ?`
      ).run(targetInstanceId, event.sessionId, event.seq);
      recordAttributionRow(db, {
        rowKind: 'session_event',
        rowId: encodeSessionEventRowId(event.sessionId, event.seq),
        originalInstanceId: event.originalInstanceId,
        sourceInstanceId,
        targetInstanceId,
        createdAt,
      });
      applied.sessionEvents += 1;
    }

    applied.total =
      applied.characters +
      applied.tasks +
      applied.sessions +
      applied.externalRefs +
      applied.unitPositions +
      applied.expEvents +
      applied.sessionEvents;

    logger(
      `[N7] 迁移完成：角色 ${applied.characters} / 任务 ${applied.tasks} / 会话 ${applied.sessions} / 外部凭据 ${applied.externalRefs} / 跟随行 ${applied.unitPositions + applied.expEvents + applied.sessionEvents}`
    );

    db.exec('COMMIT');
    persistCommittedState(db);

    return {
      preview: buildPreviewFromSnapshot(db, options, snapshot, target),
      applied,
      committed: true,
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚本身失败（连接已断）⇒ 保留原始错误；磁盘上仍是迁移前状态（自动保存已关）。
    }
    throw error;
  } finally {
    db.setAutoSaveEnabled?.(true);
  }
}

/** 由快照拼出预览（执行后回填用；不重查库，避免多一次全表扫）。 */
function buildPreviewFromSnapshot(
  db: AttributionDatabase,
  options: AttributionMigrationOptions,
  snapshot: SourceSnapshot & { readonly followers: AttributionFollowerPreview },
  target: { materialized: boolean; characterCount: number }
): AttributionPreview {
  const detailLimit = options.detailLimit ?? 500;
  const counts: AttributionPreviewCounts = {
    characters: snapshot.characters.length,
    tasks: snapshot.tasks.length,
    sessions: snapshot.sessions.length,
    externalRefs: snapshot.externalRefs.length,
    unitPositions: snapshot.unitPositions.length,
    expEvents: snapshot.expEvents.length,
    sessionEvents: snapshot.sessionEvents.length,
    total:
      snapshot.characters.length +
      snapshot.tasks.length +
      snapshot.sessions.length +
      snapshot.externalRefs.length +
      snapshot.unitPositions.length +
      snapshot.expEvents.length +
      snapshot.sessionEvents.length,
  };
  return {
    sourceInstanceId: options.sourceInstanceId ?? DEFAULT_INSTANCE_ID,
    targetInstanceId: options.targetInstanceId,
    targetMaterialized: target.materialized,
    targetCharacterCount: target.characterCount,
    characters: snapshot.characters.slice(0, detailLimit),
    tasks: snapshot.tasks.slice(0, detailLimit),
    sessions: snapshot.sessions.slice(0, detailLimit),
    externalRefs: snapshot.externalRefs.slice(0, detailLimit),
    followers: snapshot.followers,
    counts,
    blockers: [],
    warnings: collectWarnings(db, snapshot),
    truncated:
      counts.characters > detailLimit ||
      counts.tasks > detailLimit ||
      counts.sessions > detailLimit ||
      counts.externalRefs > detailLimit,
  };
}

// ============================================================================
// 对外：撤销（反向 UPDATE）
// ============================================================================

/**
 * **撤销预览**（只读）：列出「将会撤销什么」—— **一个字节都不落库**。
 *
 * why 需要它：撤销是**反向 UPDATE**（改数据）⇒ 出手前必须能先看一眼要动哪些行
 *   （与迁移同款纪律：先列清单，再确认）。
 */
export function previewInstanceAttributionRollback(
  db: AttributionDatabase,
  options: AttributionMigrationOptions
): {
  readonly rows: readonly AttributionLedgerRecord[];
  readonly counts: AttributionPreviewCounts;
  readonly total: number;
} {
  const targetInstanceId = options.targetInstanceId;
  const sourceInstanceId = options.sourceInstanceId;

  // 表就位（幂等）：从没迁过的库上预览 ⇒ 台账表还不存在 ⇒ 先建（空表）再列。
  ensureAttributionLedgerTable(db);

  const rows = listAttributionRows(db, targetInstanceId).filter(
    (row) => sourceInstanceId === undefined || row.sourceInstanceId === sourceInstanceId
  );

  const counts = {
    characters: 0,
    tasks: 0,
    sessions: 0,
    externalRefs: 0,
    unitPositions: 0,
    expEvents: 0,
    sessionEvents: 0,
    total: rows.length,
  };
  for (const row of rows) counts[countKeyOf(row.rowKind)] += 1;

  return { rows, counts, total: rows.length };
}

/**
 * **撤销**：把 N7 迁走的行放回源副本（**一个事务**）。
 *
 * 依据台账 `instance_attribution_map`（逐行记着**迁移前的原值**）⇒ 反向 UPDATE 精确还原：
 *   - 迁移前是 NULL 的 ⇒ 还原成 NULL；
 *   - 迁移前是显式 `'wsp_sandbox'` 的 ⇒ 还原成 `'wsp_sandbox'`。
 *
 * 撤销成功后**清掉台账**（凭据用掉即失效）**并清掉本次写入的 `character_id_map` 行**。
 */
export function rollbackInstanceAttribution(
  db: AttributionDatabase,
  options: AttributionMigrationOptions
): AttributionRollbackResult {
  const targetInstanceId = options.targetInstanceId;
  const sourceInstanceId = options.sourceInstanceId;
  const logger = options.logger ?? silentLogger;

  // 表就位（幂等）：从没迁过的库上撤销 ⇒ 台账表还不存在 ⇒ 先建（空表）再列。
  ensureAttributionLedgerTable(db);

  const rows = listAttributionRows(db, targetInstanceId).filter(
    (row) => sourceInstanceId === undefined || row.sourceInstanceId === sourceInstanceId
  );

  const reverted = {
    characters: 0,
    tasks: 0,
    sessions: 0,
    externalRefs: 0,
    unitPositions: 0,
    expEvents: 0,
    sessionEvents: 0,
    total: 0,
  };

  if (rows.length === 0) {
    logger('[N7] 没有可撤销的台账行（没迁过，或已撤销过）');
    return { targetInstanceId, reverted, total: 0 };
  }

  db.setAutoSaveEnabled?.(false);
  db.exec('BEGIN');
  try {
    for (const row of rows) {
      restoreRow(db, row);
      reverted[countKeyOf(row.rowKind)] += 1;
    }
    reverted.total = rows.length;

    // 清台账（凭据用掉即失效）。
    deleteAttributionRows(db, rows);
    // 清本次写入的 character_id_map 行（只清角色那一类）。
    for (const row of rows) {
      if (row.rowKind !== 'character') continue;
      db.prepare(
        `DELETE FROM character_id_map WHERE old_id = ? AND instance_id = ?`
      ).run(row.rowId, targetInstanceId);
    }

    logger(`[N7] 已撤销 ${rows.length} 行（回到迁移前）`);
    db.exec('COMMIT');
    persistCommittedState(db);
    return { targetInstanceId, reverted, total: rows.length };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 同 execute：回滚失败时保留原始错误。
    }
    throw error;
  } finally {
    db.setAutoSaveEnabled?.(true);
  }
}

/** 台账行 → 计数键（用于撤销结果的分类计数）。 */
function countKeyOf(rowKind: AttributionRowKind): keyof AttributionPreviewCounts {
  switch (rowKind) {
    case 'character':
      return 'characters';
    case 'task':
      return 'tasks';
    case 'session':
      return 'sessions';
    case 'external_ref':
      return 'externalRefs';
    case 'unit_position':
      return 'unitPositions';
    case 'exp_event':
      return 'expEvents';
    case 'session_event':
      return 'sessionEvents';
    default:
      return 'total';
  }
}

/** 反向 UPDATE 一行（把 `instance_id` 还原成迁移前的原值）。 */
function restoreRow(db: AttributionDatabase, row: { rowKind: AttributionRowKind; rowId: string; originalInstanceId: string | null; targetInstanceId: ProjectInstanceId }): void {
  const original = row.originalInstanceId;
  switch (row.rowKind) {
    case 'character':
      db.prepare(`UPDATE ${CHARACTERS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        original,
        row.rowId
      );
      return;
    case 'task':
      db.prepare(`UPDATE ${CHARACTER_TASKS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        original,
        row.rowId
      );
      return;
    case 'session':
      db.prepare(`UPDATE ${SESSIONS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        original,
        row.rowId
      );
      return;
    case 'external_ref':
      db.prepare(
        `UPDATE ${SESSION_EXTERNAL_REFS_TABLE} SET instance_id = ?
          WHERE external_session_id = ? AND instance_id = ?`
      ).run(original, row.rowId, row.targetInstanceId);
      return;
    case 'unit_position':
      db.prepare(`UPDATE ${UNIT_POSITIONS_TABLE} SET instance_id = ? WHERE character_id = ?`).run(
        original,
        row.rowId
      );
      return;
    case 'exp_event':
      db.prepare(`UPDATE ${EXP_EVENTS_TABLE} SET instance_id = ? WHERE id = ?`).run(
        original,
        row.rowId
      );
      return;
    case 'session_event': {
      const { sessionId, seq } = decodeSessionEventRowId(row.rowId);
      db.prepare(
        `UPDATE ${SESSION_EVENTS_TABLE} SET instance_id = ? WHERE session_id = ? AND seq = ?`
      ).run(original, sessionId, seq);
      return;
    }
    default:
      return;
  }
}

/**
 * `session_events` 的行标识编码：`<session_id>#<seq>`。
 *
 * why 用 `#`：会话 id 由 core 生成（`session_<kind>_<时间戳>_<计数>`，见 core/session/manager.ts），
 *   不含 `#` ⇒ 编码可逆（用**最后一个** `#` 切分，seq 侧不会被切错）。
 */
function encodeSessionEventRowId(sessionId: string, seq: number): string {
  return `${sessionId}#${seq}`;
}

/** 行标识解码（`session_events`）。 */
function decodeSessionEventRowId(rowId: string): { sessionId: string; seq: number } {
  const index = rowId.lastIndexOf('#');
  if (index < 0) return { sessionId: rowId, seq: 0 };
  return { sessionId: rowId.slice(0, index), seq: Number(rowId.slice(index + 1)) };
}

/**
 * 提交后落盘一次（原子优先）。
 *
 * why 优先 `saveAtomically()`：迁移的落盘必须是「全好或全没」——
 *   直写目标文件时进程崩在一半 ⇒ 磁盘上留下截断的库文件（整库报废）。
 */
function persistCommittedState(db: AttributionDatabase): void {
  if (typeof db.saveAtomically === 'function') {
    db.saveAtomically();
    return;
  }
  db.save?.();
}
