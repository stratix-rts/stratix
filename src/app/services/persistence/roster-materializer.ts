/**
 * 文件职责：**步 N6 —— 新实例的 roster 物化**（@since v3.3，task_202 / M2-05）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2 步 **N6**
 *   （「引导：新实例创建时，其 roster 的角色**物化**进该实例的 `characters` 行
 *     —— 契约 → 运行层的**单向** reconcile，task_159 D3」）+ §1.3.3（定义归 project / 运行态归 instance）。
 *
 * ============ 这件事是什么 ============
 *   `.stratix/roster/<role-id>.json` 是**契约**（事实源，随 git 传播）；
 *   `characters` 表的行是**运行层**（投影，副本独立养成）。
 *   ⇒ 新副本的第一批角色**不是**用户手建的，而是从契约**投影**出来的：
 *   契约里声明了三个角色 ⇒ 这个副本里就有三个角色档案（行级副本独立养成，契约共享）。
 *
 * ============ 单向（D3，task_159）============
 *   **只从契约到运行层**，永不反向：
 *   - 写方向唯一的两个：① 建行（缺 → 建）；② 刷新**契约拥有**的三项（name / persona / agentKind）。
 *   - **运行层拥有的字段（level / exp / contextEnabled / 外观 / 站位 / 外部会话）永不被契约覆盖**
 *     —— 契约里的 `state.*` 只是**建行时的初值**（DESIGN-workspace §4.3「运行态字段的默认值」）。
 *   - **运行层改动绝不回写契约**：本模块只读契约文件，**从不写** `.stratix/` 下的任何文件。
 *
 * ============ 字段归属表（谁说了算）============
 *   | 字段 | 真相源 | reconcile 行为 |
 *   |---|---|---|
 *   | `name` / `persona` / `kind` | **契约** | 每次 reconcile 按契约刷新 |
 *   | `level` / `exp` / `context_enabled` | **运行层** | 只在**建行**时取契约初值；之后不动 |
 *   | `appearance` / `skin_id` / `external_session_id` | **运行层** | 物化不碰（建行时留空） |
 *
 * ============ 幂等 ============
 *   同一个 roster 重复物化 ⇒ **零重复行**：
 *   - 主路径：按 `(role_id, instance_id)` 查已有行 ⇒ 有就只刷契约字段，没有才建行；
 *   - 兜底：数据库上的**复合唯一索引** `(role_id, instance_id)`（步 N4a 建的）⇒ 并发/竞态下
 *     重复插入被数据库直接拒收（`INSERT OR IGNORE`）⇒ 行数不会涨。
 *
 * ============ 沙盒不误伤（验收③）============
 *   **默认沙盒（`DEFAULT_INSTANCE_ID`）一律不物化**：
 *   - 沙盒是历史数据的catch-all（旧行 `instance_id IS NULL`），把契约投影进去会与存量行撞车
 *     （同一个角色在库里两行、且分属两个世界）；
 *   - 步 N4b 的规则也写明「默认沙盒的行 id 一律不改（保持历史 id）」⇒ 沙盒**不参与**派生 id 那套；
 *   - 把沙盒存量归入某个项目是**步 N7** 的显式迁移动作（带预览），不是物化。
 *   ⇒ 本模块对沙盒**直接返回 skipped**，一个字节都不写。
 *
 * ============ 容量护栏（性能硬约束）============
 *   单副本的角色数不超过 `MAX_CHARACTERS_PER_INSTANCE`（core 契约上限，**每副本**口径）⇒ 物化**不撑爆**广播体积。
 *
 * 输入：better-sqlite3 兼容连接 + roster 角色定义清单（读盘半在 `project-context-loader.ts`）。
 * 输出：物化结果（建了哪些 / 刷了哪些 / 跳过的哪些）。
 * 禁止事项：
 *   1. **写契约**（`.stratix/` 下的任何文件）—— 单向铁律；
 *   2. 覆盖运行层拥有的字段（level / exp / contextEnabled / 外观 / 站位）；
 *   3. 物化默认沙盒；
 *   4. 抛错 —— 契约缺失 / 库异常一律降级成「本轮没物化」，不绑架进入副本的回路。
 *
 * @since v3.3（task_202 / M2-05）。
 */

import { MAX_CHARACTERS_PER_INSTANCE, MAX_CHARACTERS_TOTAL } from '../../../core/capacity';
import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';
import {
  readRosterRoleDefinitions,
  type RosterRoleDefinition,
} from '../project-context-loader';

import { countCharacters } from './capacity-limits';
import { deriveCharacterId } from './character-id-rewrite';
import { CHARACTERS_TABLE, ensureGameSaveTables, type SqliteDatabaseLike } from './game-save-dao';

// ============================================================================
// 小工具
// ============================================================================

/** 日志口（缺省静默）。 */
type Logger = (line: string) => void;

const silentLogger: Logger = (): void => {
  /* 缺省静默 */
};

/** 物化被跳过的原因。 */
export type RosterMaterializeSkipReason =
  /** 目标是默认沙盒 ⇒ 不物化（历史数据的 catch-all，见文件头「沙盒不误伤」）。 */
  | 'sandbox'
  /** 没有 roster 契约（目录不存在 / 角色文件全坏）⇒ 无可物化。 */
  | 'no-roster';

// ============================================================================
// 对外：物化结果
// ============================================================================

/** 物化结果（**可观测**：调用方能如实知道这一步做了什么、没做什么）。 */
export interface RosterMaterializeResult {
  /** 物化的目标副本。 */
  readonly instanceId: ProjectInstanceId;
  /** 新建的角色行 id（= `<roleId>_<instanceId>`）。 */
  readonly created: readonly string[];
  /** 已存在、且契约拥有字段被刷新的行 id。 */
  readonly refreshed: readonly string[];
  /** 已存在、且与契约完全一致（未动）的行 id。 */
  readonly unchanged: readonly string[];
  /** 本轮是否整体跳过（没写任何行）。 */
  readonly skipped: boolean;
  /** 跳过原因（`skipped` 为 true 时有值）。 */
  readonly reason?: RosterMaterializeSkipReason;
}

/** 空结果（跳过时用）。 */
function skippedResult(instanceId: ProjectInstanceId, reason: RosterMaterializeSkipReason): RosterMaterializeResult {
  return { instanceId, created: [], refreshed: [], unchanged: [], skipped: true, reason };
}

// ============================================================================
// 对外：物化（DB 半）
// ============================================================================

/** 物化选项（DB 半）。 */
export interface RosterMaterializeOptions {
  /** 目标副本 id（= 新副本；**不是**默认沙盒）。 */
  readonly instanceId: ProjectInstanceId;
  /** roster 角色定义清单（读盘半的产物）。 */
  readonly roles: readonly RosterRoleDefinition[];
  /** 建行时间戳（epoch ms；缺省 = 现在）。 */
  readonly now?: number;
  /** 日志口（缺省静默）。 */
  readonly logger?: Logger;
}

/** 已存在的物化行（= 本副本里 `role_id` 已回填的那些行）。 */
interface ExistingRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string | null;
  readonly persona: string;
}

/**
 * 读本副本里**已物化**的行（`role_id` 非空且 `instance_id` 命中）。
 *
 * why 用 `instance_id = ?` 而不是 COALESCE 口径：COALESCE 会把 `instance_id IS NULL` 的旧行
 *   （= 沙盒的存量）也算进来 ⇒ 物化会把沙盒的行当成本副本的行去改 ⇒ **误伤**。
 *   物化行永远带显式 `instance_id` ⇒ 等值比较就是精确口径。
 */
function loadMaterializedRows(
  db: SqliteDatabaseLike,
  instanceId: ProjectInstanceId
): Map<string, ExistingRow> {
  const rows = db
    .prepare(
      `SELECT id, role_id, name, kind, persona FROM ${CHARACTERS_TABLE}
       WHERE instance_id = ? AND role_id IS NOT NULL`
    )
    .all(instanceId) as Array<Record<string, unknown>>;
  const byRoleId = new Map<string, ExistingRow>();
  for (const row of rows) {
    const roleId = row.role_id === null || row.role_id === undefined ? '' : String(row.role_id);
    if (roleId === '') continue;
    byRoleId.set(roleId, {
      id: String(row.id),
      name: String(row.name ?? ''),
      kind: row.kind === null || row.kind === undefined ? null : String(row.kind),
      persona: String(row.persona ?? ''),
    });
  }
  return byRoleId;
}

/** 本副本已有的角色行数（容量护栏用）。 */
function countInstanceCharacters(db: SqliteDatabaseLike, instanceId: ProjectInstanceId): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${CHARACTERS_TABLE} WHERE instance_id = ?`)
    .get(instanceId) as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/**
 * 建一行物化行。
 *
 * `INSERT OR IGNORE`：撞上复合唯一索引 `(role_id, instance_id)` 就**忽略**（不建重复行）
 *   ⇒ 幂等的最后一道兜底在数据库层，不靠应用层的判断。
 *
 * why 运行态字段建行时留空/取初值：`appearance` / `skin_id` / `external_session_id` 是**运行层**的
 *   （外观由用户挑、外部会话由首次对话产生）⇒ 物化不编造它们。
 */
function insertMaterializedRow(
  db: SqliteDatabaseLike,
  row: {
    id: string;
    roleId: string;
    instanceId: ProjectInstanceId;
    name: string;
    persona: string;
    agentKind: string | null;
    level: number;
    experience: number;
    contextEnabled: boolean;
    now: number;
  }
): void {
  db.prepare(
    `INSERT OR IGNORE INTO ${CHARACTERS_TABLE}
       (id, name, kind, persona, level, exp, appearance, body_type, skin_id,
        external_session_id, context_enabled, created_at, updated_at, instance_id, role_id)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?)`
  ).run(
    row.id,
    row.name,
    row.agentKind,
    row.persona,
    row.level,
    row.experience,
    row.contextEnabled ? 1 : 0,
    row.now,
    row.now,
    row.instanceId,
    row.roleId
  );
}

/**
 * 刷新**契约拥有**的三项（name / persona / kind）。
 *
 * ⚠️ 只碰这三列：`level` / `exp` / `context_enabled` 是**运行层**的 ⇒ 契约不得覆盖
 *   （用户在副本里升的级不能被一次物化打回 1 级）。
 */
function refreshContractFields(
  db: SqliteDatabaseLike,
  characterId: string,
  role: RosterRoleDefinition,
  now: number
): void {
  db.prepare(
    `UPDATE ${CHARACTERS_TABLE} SET name = ?, kind = ?, persona = ?, updated_at = ? WHERE id = ?`
  ).run(role.name, role.agentKind ?? null, role.persona, now, characterId);
}

/**
 * 物化：把 roster 角色清单投影成该副本的 `characters` 行（**单向 reconcile**）。
 *
 * 行为：
 *   - **缺 → 建**：本副本没有这个 `role_id` 的行 ⇒ 按契约建一行（id = `<roleId>_<instanceId>`）；
 *   - **有 → 只刷契约字段**：name / persona / agentKind 按契约刷新；运行态字段一律不动；
 *   - **完全一致 → 不动**。
 *
 * 不抛错（契约问题与库异常都降级成「本轮没物化」）。
 */
export function materializeRosterCharacters(
  db: SqliteDatabaseLike,
  options: RosterMaterializeOptions
): RosterMaterializeResult {
  const { instanceId, roles } = options;
  const logger = options.logger ?? silentLogger;

  // 沙盒不物化（文件头「沙盒不误伤」）：一个字节都不写。
  if (instanceId === DEFAULT_INSTANCE_ID) {
    return skippedResult(instanceId, 'sandbox');
  }
  if (roles.length === 0) {
    return skippedResult(instanceId, 'no-roster');
  }

  try {
    // 建表 / 加列 / 建索引兜底（幂等）：老库上直接调也能物化。
    ensureGameSaveTables(db);

    const now = options.now ?? Date.now();
    const existing = loadMaterializedRows(db, instanceId);
    // 容量护栏：本副本的角色数不超过 MAX_CHARACTERS_PER_INSTANCE（core 契约上限，**每副本**口径）。
    let budget = Math.max(0, MAX_CHARACTERS_PER_INSTANCE - countInstanceCharacters(db, instanceId));
    // 全局护栏（@since v3.3，task_205 / M2-08）：`characters` 表**跨副本**累积 ——
    //   副本一多，每副本 64 条会叠成无界的行数（落库表整体驻留内存）。
    //   ⇒ 全库再钉一条 MAX_CHARACTERS_TOTAL；满了就**拒新**（不物化），已有行一概不动。
    let globalBudget = Math.max(0, MAX_CHARACTERS_TOTAL - countCharacters(db));

    const created: string[] = [];
    const refreshed: string[] = [];
    const unchanged: string[] = [];

    for (const role of roles) {
      const row = existing.get(role.id);
      if (row) {
        const sameName = row.name === role.name;
        const samePersona = row.persona === role.persona;
        const sameKind = (row.kind ?? null) === (role.agentKind ?? null);
        if (sameName && samePersona && sameKind) {
          unchanged.push(row.id);
        } else {
          refreshContractFields(db, row.id, role, now);
          refreshed.push(row.id);
        }
        continue;
      }
      if (budget <= 0) {
        logger(
          `[RosterMaterializer] 副本 ${instanceId} 的角色数已达上限（${MAX_CHARACTERS_PER_INSTANCE}）⇒ 余下的 roster 角色本轮不物化`
        );
        break;
      }
      if (globalBudget <= 0) {
        logger(
          `[RosterMaterializer] 角色表全局行数已达上限（${MAX_CHARACTERS_TOTAL}）⇒ 副本 ${instanceId} 的 roster 角色本轮不物化`
        );
        break;
      }
      const characterId = deriveCharacterId(role.id, instanceId);
      insertMaterializedRow(db, {
        id: characterId,
        roleId: role.id,
        instanceId,
        name: role.name,
        persona: role.persona,
        agentKind: role.agentKind ?? null,
        level: role.level,
        experience: role.experience,
        contextEnabled: role.contextEnabled,
        now,
      });
      created.push(characterId);
      budget -= 1;
      globalBudget -= 1;
    }

    return { instanceId, created, refreshed, unchanged, skipped: false };
  } catch (error) {
    logger(
      `[RosterMaterializer] 物化失败（降级成「本轮没物化」）：${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return skippedResult(instanceId, 'no-roster');
  }
}

// ============================================================================
// 对外：物化（读盘 + DB 合起来的一步）
// ============================================================================

/** 物化选项（读盘 + DB 合起来的一步）。 */
export interface MaterializeInstanceRosterOptions {
  /** 目标副本 id。 */
  readonly instanceId: ProjectInstanceId;
  /** 副本的项目根（`.stratix` 所在目录）。 */
  readonly projectRoot: string;
  /** 建行时间戳（epoch ms；缺省 = 现在）。 */
  readonly now?: number;
  /** 日志口（缺省静默）。 */
  readonly logger?: Logger;
}

/**
 * **一步物化**：读副本根下的 `.stratix/roster` ⇒ 投影成该副本的 `characters` 行。
 *
 * 这是「进入副本链」上的物化点（实例创建 / 首次进入都走它）：
 *   契约 → 运行层，**单向**；重复调用零重复行（幂等）。
 *
 * 契约缺失 / 副本根给不出 ⇒ 什么都不做（不抛）。
 */
export function materializeInstanceRoster(
  db: SqliteDatabaseLike,
  options: MaterializeInstanceRosterOptions
): RosterMaterializeResult {
  const { instanceId, projectRoot } = options;
  const logger = options.logger ?? silentLogger;
  if (instanceId === DEFAULT_INSTANCE_ID) {
    return skippedResult(instanceId, 'sandbox');
  }
  if (!projectRoot) {
    return skippedResult(instanceId, 'no-roster');
  }
  const roles = readRosterRoleDefinitions(projectRoot, { logger });
  return materializeRosterCharacters(db, { instanceId, roles, ...(options.now !== undefined ? { now: options.now } : {}), logger });
}
