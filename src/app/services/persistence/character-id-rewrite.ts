/**
 * 文件职责：**N4b 一次性 character id 重写**的执行器 + 校验器（@since v3.3，task_201 / M2-04）。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.3.2
 *   - 「N4b 的可判定规则」（R1-39）：
 *     ① **默认沙盒实例的行 id 一律不改**（保持历史 id）；**其它** instance 的行 id = `<roleId>_<instanceId>`
 *        ⇒ **两种 id 格式并存是既定事实** ⇒ 身份判定只能靠 `role_id` 列，**不得解析 id 字符串**；
 *     ② 引用方：`unit_positions.character_id` / `character_tasks.character_id` 是**普通列**（同事务 UPDATE）；
 *        `sessions.participants` 是 **JSON blob** ⇒ 逐行读 → JSON.parse → 改写数组 → 回写，
 *        **任一行失败即整批回滚**（全批一个事务）；
 *     ③ 映射落**库内** `character_id_map`（N4c），与数据**同库、同事务**（N4b 唯一的回滚凭据）。
 *   - 「N4b 的迁移验收清单」（R1-41）**四条校验**。
 *
 * 输入：一个 better-sqlite3 兼容连接（sql.js 适配器满足）+ 一份**计划**（`planCharacterIdRewrite` 产出）。
 * 输出：整批重写结果（**一个事务**）+ 四条校验报告 + 前滚回滚（靠 `character_id_map` 反向 UPDATE）。
 *
 * 禁止事项：
 *   1. **解析 id 字符串判断角色身份** —— 见文件头 ①（两种 id 格式并存 ⇒ 只能读 `role_id` 列）；
 *   2. 在事务外改数据 —— 整批重写 + 同事务写映射 + **同事务校验**，一个事务（校验不过 ⇒ 整批回滚）；
 *   3. 拼 SQL 字符串插值 —— 值一律参数绑定（?），表名只走常量；
 *   4. 认识 core 的实体类型 —— 行 ↔ 记录映射是**纯持久化形状**（同其它 DAO 的纪律）。
 *
 * why 校验放在事务**内**：R1-41 第 ④⑤ 步要求「校验不通过 ⇒ 整批回滚」——
 *   校验读到的是**未提交的重写后状态**，失败即抛 ⇒ 事务回滚 ⇒ 库回到 N4b 前状态（可重试）。
 *
 * why 扩展了两个引用面（设计清单只点名 unit_positions / character_tasks）：
 *   `exp_events.character_id` 与 `character_chat_messages.character_id` **也是**指向角色行的普通列
 *   ⇒ 不一起改就会留下悬空引用（经验事件 / 对话历史按旧 id 查不到角色）。
 *   两条一并重写，但它们在**校验**里只作「附加完整性」告警（存量悬空引用不是本次重写造成的，
 *   不该因此把整批迁移判死）；设计钦定的四条仍是硬校验。
 */

import { CHARACTER_UNIT_ID_PREFIX } from '../../../core/character';
import { DEFAULT_INSTANCE_ID, type ProjectInstanceId } from '../../../core/types';

import {
  ensureCharacterIdMapTable,
  listCharacterIdMappings,
  recordCharacterIdMapping,
} from './character-id-map-dao';

/** characters 表名（与 StratixDatabase / game-save-dao 的 DDL 同名）。 */
export const CHARACTERS_TABLE = 'characters';
/** unit_positions 表名。 */
export const UNIT_POSITIONS_TABLE = 'unit_positions';
/** character_tasks 表名。 */
export const CHARACTER_TASKS_TABLE = 'character_tasks';
/** exp_events 表名。 */
export const EXP_EVENTS_TABLE = 'exp_events';
/** character_chat_messages 表名。 */
export const CHARACTER_CHAT_MESSAGES_TABLE = 'character_chat_messages';
/** sessions 表名。 */
export const SESSIONS_TABLE = 'sessions';

/**
 * 指向角色行的**普通列**引用面（id 重写时必须同事务一起改）。
 *
 * why 是清单而不是逐处 SQL：漏改一处 = 悬空引用 ⇒ 改漏是隐形的（数据还在，只是查不到）。
 * 一份清单 + 一个循环 ⇒ 漏不掉。
 */
export const CHARACTER_ID_REFERENCE_TABLES: readonly string[] = [
  UNIT_POSITIONS_TABLE,
  CHARACTER_TASKS_TABLE,
  EXP_EVENTS_TABLE,
  CHARACTER_CHAT_MESSAGES_TABLE,
];

/**
 * better-sqlite3 兼容的最小连接面（sql.js 适配器与 better-sqlite3 都满足）。
 *
 * 本地声明（不 import game-save-dao）：那边 import 本文件会成环（instance-scope.ts 已用同样办法解环）。
 *
 * `setAutoSaveEnabled` / `save` 是**可选**能力（sql.js 适配器有，别的驱动没有）：
 *   - `setAutoSaveEnabled(false)`：长事务期间禁止把**中间态**刷到磁盘（否则崩在事务中间 = 半写库）；
 *   - `save()`：提交后**显式**落盘一次。
 */
export interface RewriteDatabase {
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  };
  exec(sql: string): void;
  /** 可选：开关「自动保存」（防事务中间态落盘）。 */
  setAutoSaveEnabled?(enabled: boolean): void;
  /** 可选：显式落盘（提交后调用一次）。 */
  save?(): void;
  /** 可选：**原子**落盘（export → 临时文件 → rename；崩了不留半截库文件）。 */
  saveAtomically?(): void;
}

/** 重写的**一步**（演练 / 测试的崩溃注入点）。 */
export type RewriteStep =
  | 'characters'
  | 'unit-positions'
  | 'character-tasks'
  | 'exp-events'
  | 'chat-messages'
  | 'participants'
  | 'id-map'
  | 'validate';

/** 计划里的一行：一个角色行的 id 重写（旧 id → 新 id）。 */
export interface RewritePlanRow {
  readonly oldId: string;
  readonly newId: string;
  readonly roleId: string;
  readonly instanceId: ProjectInstanceId;
}

/** 重写计划（planCharacterIdRewrite 的产物 = 「打算改什么」的完整快照）。 */
export interface RewritePlan {
  /** 待重写的行（默认沙盒行不在其中）。 */
  readonly rows: readonly RewritePlanRow[];
  /** **阻断性**前置问题（任一条非空 ⇒ 整批不许动：宁可不改，也不要改出坏数据）。 */
  readonly blockers: readonly string[];
  /**
   * 默认沙盒里的**角色行 id**（**一律不改**；校验时逐个确认原样还在）。
   *
   * @since v3.3（task_225 / QA-05）原名 `sandboxIds` → `sandboxCharacterIds`：
   *   这里的每个值是「默认沙盒里那些**角色行**的 id」，与「沙盒**实例** id」
   *   （= `DEFAULT_INSTANCE_ID = 'wsp_sandbox'`，单值）撞形 ⇒ 改名消歧。
   */
  readonly sandboxCharacterIds: readonly string[];
  /** 已经是派生 id 的行（重跑时命中 ⇒ 幂等，不再改）。 */
  readonly alreadyDerivedIds: readonly string[];
  /** 重写前的 characters 行数（校验①的基线）。 */
  readonly characterCount: number;
}

/** 校验的一条结果。 */
export interface ValidationCheck {
  /** 稳定的检查 id（脚本 / 报告按它定位）。 */
  readonly id: string;
  /** 中文标题（人读）。 */
  readonly title: string;
  /** 状态：pass / fail / warn（告警）/ skip（缺基线，无法判定）。 */
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  /** 细节（人读：一句话说清差在哪）。 */
  readonly detail: string;
  /** 样本（失败 / 告警时给出前若干个 offending 值）。 */
  readonly samples?: readonly string[];
}

/** 四条校验的汇总报告。 */
export interface RewriteValidationReport {
  /** 是否有 **fail** 级问题（fail ⇒ 整批回滚）。 */
  readonly ok: boolean;
  readonly checks: readonly ValidationCheck[];
}

/** 整批重写的结果。 */
export interface CharacterIdRewriteOutcome {
  readonly plan: RewritePlan;
  readonly report: RewriteValidationReport;
  /** 实际重写行数。 */
  readonly applied: number;
}

/** 执行选项。 */
export interface CharacterIdRewriteOptions {
  /** 只处理这些副本（缺省 = 全部非默认沙盒副本）。 */
  readonly instanceIds?: readonly ProjectInstanceId[];
  /** 严格模式：告警项也判失败（默认只对设计钦定的四条做硬校验）。 */
  readonly strict?: boolean;
  /** 映射写入时刻（缺省 = 现在；测试可注入固定值）。 */
  readonly now?: number;
  /** 步骤回调（演练 / 测试的崩溃注入点：在该步抛错 ⇒ 事务回滚）。 */
  readonly onStep?: (step: RewriteStep) => void;
  /** 提交前的守门（并发写检测：文件在跑的过程中被改过 ⇒ 抛错回滚）。 */
  readonly assertUnchanged?: () => void;
}

/** 前置阻断（计划阶段发现的问题：缺 role_id / 派生 id 冲突）。 */
export class CharacterIdRewriteBlockedError extends Error {
  public readonly blockers: readonly string[];

  constructor(blockers: readonly string[]) {
    super(`N4b 重写被阻断（${blockers.length} 条前置问题）：\n- ${blockers.join('\n- ')}`);
    this.name = 'CharacterIdRewriteBlockedError';
    this.blockers = blockers;
  }
}

/** 校验不过（事务内抛出 ⇒ 整批回滚）。 */
export class CharacterIdRewriteValidationError extends Error {
  public readonly report: RewriteValidationReport;

  constructor(report: RewriteValidationReport) {
    const failed = report.checks.filter((check) => check.status === 'fail');
    super(
      `N4b 重写校验不过（${failed.length} 条）⇒ 整批回滚：\n- ${failed
        .map((check) => `${check.id}：${check.detail}`)
        .join('\n- ')}`
    );
    this.name = 'CharacterIdRewriteValidationError';
    this.report = report;
  }
}

/** participants 行解析失败（JSON blob 坏行 ⇒ 整批回滚）。 */
export class CharacterIdRewriteParticipantsError extends Error {
  public readonly sessionId: string;

  constructor(sessionId: string, cause: unknown) {
    super(
      `会话 ${sessionId} 的 participants 不是可解析的 JSON 数组 ⇒ 整批回滚：${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = 'CharacterIdRewriteParticipantsError';
    this.sessionId = sessionId;
  }
}

/**
 * 派生角色行 id：`<roleId>_<instanceId>`（design §1.3.2 N4b 的可判定规则 ①）。
 *
 * why 不用分隔符更多的格式：id 会进 unit_id（`unit_<角色id>`）、会话 participants、
 *   文件名等场合 ⇒ 短且无歧义最省事；instanceId 本身不允许含下划线之外的分隔冲突
 *   （`ProjectInstanceId` 是普通字符串，这里只做最小假设：不改 id 内容，只拼）。
 */
export function deriveCharacterId(roleId: string, instanceId: ProjectInstanceId): string {
  return `${roleId}_${instanceId}`;
}

/**
 * 产出重写计划（**只读**，不改任何数据）。
 *
 * 口径（design §1.3.2 N4b 可判定规则 ①）：
 *   - **默认沙盒**（`COALESCE(instance_id,'wsp_sandbox') = 'wsp_sandbox'`）⇒ 行 id **一律不改**；
 *   - **其它 instance** ⇒ 行 id = `<roleId>_<instanceId>`；派生不出来（`role_id` 为空）⇒ **阻断**；
 *   - 派生 id 与既有行 id 撞车 ⇒ **阻断**（宁可不改，也不要改出两条同 id 的角色行）。
 *
 * why 身份只看 `role_id` 列：N4b 之后两种 id 格式并存（沙盒行 = 历史 id，其它 = 派生 id）
 *   ⇒ **解析 id 字符串判身份是错的**（历史 id 里也可能有下划线）。
 */
export function planCharacterIdRewrite(
  db: RewriteDatabase,
  options: CharacterIdRewriteOptions = {}
): RewritePlan {
  const rows = db
    .prepare(`SELECT id, instance_id, role_id FROM ${CHARACTERS_TABLE}`)
    .all() as Array<Record<string, unknown>>;

  const blockers: string[] = [];
  const planRows: RewritePlanRow[] = [];
  const sandboxCharacterIds: string[] = [];
  const alreadyDerivedIds: string[] = [];
  const existingIds = new Set<string>();
  for (const row of rows) existingIds.add(String(row.id));

  const newIdsSeen = new Map<string, string>();

  for (const row of rows) {
    const id = String(row.id);
    const rawInstance = row.instance_id === null || row.instance_id === undefined
      ? DEFAULT_INSTANCE_ID
      : String(row.instance_id);
    const instanceId = rawInstance as ProjectInstanceId;

    // ① 默认沙盒行：id 一律不改（保持历史 id）。
    if (instanceId === DEFAULT_INSTANCE_ID) {
      sandboxCharacterIds.push(id);
      continue;
    }
    if (options.instanceIds && !options.instanceIds.includes(instanceId)) {
      continue;
    }
    const roleId = row.role_id === null || row.role_id === undefined ? '' : String(row.role_id);
    if (roleId === '') {
      blockers.push(
        `角色行 ${id}（副本 ${instanceId}）缺 role_id ⇒ 派生不出新 id（先回填 role_id 再跑 N4b）`
      );
      continue;
    }
    const newId = deriveCharacterId(roleId, instanceId);
    if (newId === id) {
      alreadyDerivedIds.push(id);
      continue;
    }
    if (existingIds.has(newId)) {
      blockers.push(`派生 id 与既有角色行冲突：${newId}（来自角色行 ${id}，副本 ${instanceId}）`);
      continue;
    }
    const previous = newIdsSeen.get(newId);
    if (previous !== undefined) {
      blockers.push(`派生 id 内部冲突：${newId}（角色行 ${previous} 与 ${id}）`);
      continue;
    }
    newIdsSeen.set(newId, id);
    planRows.push({ oldId: id, newId, roleId, instanceId });
  }

  return {
    rows: planRows,
    blockers,
    sandboxCharacterIds,
    alreadyDerivedIds,
    characterCount: rows.length,
  };
}

/**
 * 整批重写（**一个事务**）：改数据 + 同事务写映射 + **同事务校验**。
 *
 * 事务内做校验的理由：R1-41 第 ④⑤ 步 —— 校验不过 ⇒ **整批回滚**（不留下半改的库）。
 * 校验读的是未提交的重写后状态 ⇒ 失败即抛 ⇒ `ROLLBACK` ⇒ 库回到 N4b 前状态（可重试）。
 *
 * @throws CharacterIdRewriteBlockedError 计划有阻断项（没动任何数据）。
 * @throws CharacterIdRewriteValidationError 校验不过（已回滚）。
 * @throws CharacterIdRewriteParticipantsError participants 坏行（已回滚）。
 */
export function executeCharacterIdRewrite(
  db: RewriteDatabase,
  plan: RewritePlan,
  options: CharacterIdRewriteOptions = {}
): CharacterIdRewriteOutcome {
  if (plan.blockers.length > 0) {
    throw new CharacterIdRewriteBlockedError(plan.blockers);
  }

  const mapping = new Map<string, string>();
  for (const row of plan.rows) mapping.set(row.oldId, row.newId);

  // 长事务期间关掉自动保存：否则驱动可能在事务中途把**中间态**刷到磁盘（崩在中间 = 半写库）。
  db.setAutoSaveEnabled?.(false);
  db.exec('BEGIN');
  try {
    options.onStep?.('characters');
    updateCharactersIds(db, plan.rows);

    for (const table of CHARACTER_ID_REFERENCE_TABLES) {
      options.onStep?.(tableStepOf(table));
      updateReferencingColumn(db, table, mapping);
    }

    options.onStep?.('participants');
    rewriteSessionParticipants(db, mapping);

    options.onStep?.('id-map');
    ensureCharacterIdMapTable(db);
    const createdAt = options.now ?? Date.now();
    for (const row of plan.rows) {
      recordCharacterIdMapping(db, {
        oldId: row.oldId,
        newId: row.newId,
        instanceId: row.instanceId,
        createdAt,
      });
    }

    options.onStep?.('validate');
    const report = validateCharacterIdRewrite(db, { plan, strict: options.strict });
    if (!report.ok) {
      throw new CharacterIdRewriteValidationError(report);
    }
    options.assertUnchanged?.();
    db.exec('COMMIT');
    persistCommittedState(db);
    return { plan, report, applied: plan.rows.length };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // 回滚本身失败（连接已断）⇒ 保留原始错误；磁盘上仍是 N4b 前状态（自动保存已关）。
    }
    throw error;
  } finally {
    db.setAutoSaveEnabled?.(true);
  }
}

/**
 * 四条校验（design §1.3.2「N4b 的迁移验收清单」第 ④ 步）+ 附加完整性。
 *
 * ① `characters` 行数**不变**；
 * ② `unit_positions.character_id` **100%** 落在新 `characters.id` 集合内；
 * ③ `unit_positions` 的 `unit_id` 集合 **==** `characters.id × PREFIX`；
 * ④ `character_tasks.character_id` 与 `sessions.participants` **全部可解析**（participants 逐条
 *    `JSON.parse` 且每项都能在 `characters` 中找到）。
 *
 * 附加（不参与硬失败）：默认沙盒行 id 未被改动、映射表完整、exp/chat 引用面的悬空计数。
 */
export function validateCharacterIdRewrite(
  db: RewriteDatabase,
  context: { readonly plan?: RewritePlan; readonly strict?: boolean } = {}
): RewriteValidationReport {
  const checks: ValidationCheck[] = [];
  const strict = context.strict === true;

  const characterIds = new Set(
    (
      db.prepare(`SELECT id FROM ${CHARACTERS_TABLE}`).all() as Array<Record<string, unknown>>
    ).map((row) => String(row.id))
  );
  const characterCount = characterIds.size;

  // ① 行数不变。
  if (context.plan) {
    const ok = characterCount === context.plan.characterCount;
    checks.push({
      id: 'characters-count',
      title: 'characters 行数不变',
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `重写前后都是 ${characterCount} 行`
        : `重写前 ${context.plan.characterCount} 行，重写后 ${characterCount} 行`,
    });
  } else {
    checks.push({
      id: 'characters-count',
      title: 'characters 行数不变',
      status: 'skip',
      detail: '没有重写计划（独立校验模式）⇒ 无基线可比；请用迁移报告里的行数核对',
    });
  }

  // ② unit_positions.character_id 100% 落在新 characters.id 集合内。
  const unitPositionRefs = (
    db.prepare(`SELECT character_id FROM ${UNIT_POSITIONS_TABLE}`).all() as Array<
      Record<string, unknown>
    >
  ).map((row) => String(row.character_id));
  const danglingPositions = unitPositionRefs.filter((id) => !characterIds.has(id));
  checks.push({
    id: 'unit-positions-refs',
    title: 'unit_positions.character_id 100% 落在新 characters.id 集合内',
    status: danglingPositions.length === 0 ? 'pass' : 'fail',
    detail:
      danglingPositions.length === 0
        ? `${unitPositionRefs.length} 条站位引用全部命中`
        : `${danglingPositions.length}/${unitPositionRefs.length} 条站位引用悬空`,
    samples: danglingPositions.slice(0, 10),
  });

  // ③ unit_positions 派生的 unit_id 集合 == characters.id × PREFIX。
  const expectedUnitIds = new Set([...characterIds].map((id) => `${CHARACTER_UNIT_ID_PREFIX}${id}`));
  const actualUnitIds = new Set(
    unitPositionRefs.map((id) => `${CHARACTER_UNIT_ID_PREFIX}${id}`)
  );
  const extraUnitIds = [...actualUnitIds].filter((id) => !expectedUnitIds.has(id));
  const missingUnitIds = [...expectedUnitIds].filter((id) => !actualUnitIds.has(id));
  checks.push({
    id: 'unit-id-sets',
    title: 'unit_positions 的 unit_id 集合 == characters.id × PREFIX',
    status: extraUnitIds.length > 0 ? 'fail' : missingUnitIds.length > 0 ? (strict ? 'fail' : 'warn') : 'pass',
    detail:
      extraUnitIds.length > 0
        ? `${extraUnitIds.length} 个站位没有对应角色行（悬空）`
        : missingUnitIds.length > 0
          ? `${missingUnitIds.length} 个角色还没有站位（尚未上场，默认只告警；--strict 下判失败）`
          : '两侧集合完全相等',
    samples: [...extraUnitIds, ...missingUnitIds].slice(0, 10),
  });

  // ④ character_tasks.character_id 与 sessions.participants 全部可解析。
  const taskRefs = (
    db.prepare(`SELECT DISTINCT character_id FROM ${CHARACTER_TASKS_TABLE}`).all() as Array<
      Record<string, unknown>
    >
  ).map((row) => String(row.character_id));
  const danglingTasks = taskRefs.filter((id) => !characterIds.has(id));
  checks.push({
    id: 'task-refs',
    title: 'character_tasks.character_id 全部能在 characters 中找到',
    status: danglingTasks.length === 0 ? 'pass' : 'fail',
    detail:
      danglingTasks.length === 0
        ? `${taskRefs.length} 个被引用的角色 id 全部命中`
        : `${danglingTasks.length} 个被引用的角色 id 悬空`,
    samples: danglingTasks.slice(0, 10),
  });

  const participantCheck = checkParticipants(db, characterIds, strict);
  checks.push(participantCheck);

  // 附加：默认沙盒行 id 未被改动（设计硬规则：默认沙盒行 id 一律不改）。
  if (context.plan && context.plan.sandboxCharacterIds.length > 0) {
    const changed = context.plan.sandboxCharacterIds.filter((id) => !characterIds.has(id));
    checks.push({
      id: 'sandbox-ids-unchanged',
      title: '默认沙盒行 id 一律不改',
      status: changed.length === 0 ? 'pass' : 'fail',
      detail:
        changed.length === 0
          ? `${context.plan.sandboxCharacterIds.length} 个沙盒行 id 原样保留`
          : `${changed.length} 个沙盒行 id 不见了`,
      samples: changed.slice(0, 10),
    });
  }

  // 附加：映射表完整（每条映射的 new_id 都要能落到角色行上）。
  const mappings = listCharacterIdMappings(db);
  const missingNewIds = mappings.filter((mapping) => !characterIds.has(mapping.newId));
  checks.push({
    id: 'id-map-rows',
    title: 'character_id_map 的 new_id 全部能在 characters 中找到',
    status: missingNewIds.length === 0 ? 'pass' : 'fail',
    detail:
      missingNewIds.length === 0
        ? `${mappings.length} 条映射全部命中`
        : `${missingNewIds.length} 条映射指向不存在的角色行`,
    samples: missingNewIds.map((mapping) => mapping.newId).slice(0, 10),
  });

  // 附加：exp / 对话历史的引用面（存量悬空引用不是本次重写造成的 ⇒ 只告警）。
  for (const table of [EXP_EVENTS_TABLE, CHARACTER_CHAT_MESSAGES_TABLE]) {
    const refs = (
      db.prepare(`SELECT DISTINCT character_id FROM ${table}`).all() as Array<Record<string, unknown>>
    ).map((row) => String(row.character_id));
    const dangling = refs.filter((id) => !characterIds.has(id));
    checks.push({
      id: `${table}-refs`,
      title: `${table}.character_id 引用面（附加完整性）`,
      status: dangling.length === 0 ? 'pass' : 'warn',
      detail:
        dangling.length === 0
          ? `${refs.length} 个被引用的角色 id 全部命中`
          : `${dangling.length} 个被引用的角色 id 悬空（存量问题，不判死整批）`,
      samples: dangling.slice(0, 10),
    });
  }

  const ok = !checks.some((check) => check.status === 'fail');
  return { ok, checks };
}

/**
 * 前滚回滚（design §1.3.2 回滚矩阵「M2 N4b 重写」行）：
 *   靠 `character_id_map` **反向 UPDATE**（new → old）把 id 改回去。
 *
 * 语义边界（写死在这里，避免误用）：
 *   - 这是**前滚回滚**（数据已提交、事后发现问题）用的；
 *   - 事务已回滚的场景**不需要**它（库本来就在 N4b 前状态，直接重跑即可）；
 *   - 消费掉的映射行会被**删除**（凭据用掉即失效；表留空 = 「已回滚干净」）。
 */
export function rollbackCharacterIdRewrite(
  db: RewriteDatabase,
  options: CharacterIdRewriteOptions = {}
): { readonly reverted: number } {
  const mappings = listCharacterIdMappings(db);
  if (mappings.length === 0) return { reverted: 0 };

  const mapping = new Map<string, string>();
  for (const record of mappings) mapping.set(record.newId, record.oldId);

  db.setAutoSaveEnabled?.(false);
  db.exec('BEGIN');
  try {
    for (const record of mappings) {
      db.prepare(`UPDATE ${CHARACTERS_TABLE} SET id = ? WHERE id = ?`).run(
        record.oldId,
        record.newId
      );
    }
    for (const table of CHARACTER_ID_REFERENCE_TABLES) {
      for (const record of mappings) {
        db.prepare(`UPDATE ${table} SET character_id = ? WHERE character_id = ?`).run(
          record.oldId,
          record.newId
        );
      }
    }
    rewriteSessionParticipants(db, mapping);
    for (const record of mappings) {
      db.prepare(
        `DELETE FROM character_id_map WHERE old_id = ? AND instance_id = ?`
      ).run(record.oldId, record.instanceId);
    }
    options.assertUnchanged?.();
    db.exec('COMMIT');
    persistCommittedState(db);
    return { reverted: mappings.length };
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

/**
 * 提交后落盘一次（原子优先）。
 *
 * why 优先 `saveAtomically()`：迁移的落盘必须是「全好或全没」——
 *   直写目标文件时进程崩在一半 ⇒ 磁盘上留下截断的库文件（整库报废）。
 */
function persistCommittedState(db: RewriteDatabase): void {
  if (typeof db.saveAtomically === 'function') {
    db.saveAtomically();
    return;
  }
  db.save?.();
}

/** 改写 characters.id（逐行 UPDATE：id 是主键，逐行改最直白，也便于中途崩溃定位）。 */function updateCharactersIds(db: RewriteDatabase, rows: readonly RewritePlanRow[]): void {
  const stmt = db.prepare(`UPDATE ${CHARACTERS_TABLE} SET id = ? WHERE id = ?`);
  for (const row of rows) stmt.run(row.newId, row.oldId);
}

/** 改写某个引用表的 character_id 普通列（普通列 ⇒ 同事务 UPDATE 即可，design N4b 规则 ②）。 */
function updateReferencingColumn(
  db: RewriteDatabase,
  table: string,
  mapping: ReadonlyMap<string, string>
): void {
  const stmt = db.prepare(`UPDATE ${table} SET character_id = ? WHERE character_id = ?`);
  for (const [oldId, newId] of mapping) stmt.run(newId, oldId);
}

/**
 * 改写 `sessions.participants`（JSON blob）：逐行读 → JSON.parse → 改写数组 → 回写。
 *
 * **任一行失败即整批回滚**（抛错 ⇒ 外层事务 ROLLBACK）—— design N4b 规则 ② 的硬要求。
 * 只改**角色 id**（映射表里的）；非角色参与者（agent id / link id / clientId）原样保留
 *   （participants 是混合命名空间：视 kind 而定是 characterId / agentId / clientId，
 *    见 core/session/types.ts 的 CreateSessionInput 注释）。
 */
function rewriteSessionParticipants(
  db: RewriteDatabase,
  mapping: ReadonlyMap<string, string>
): { readonly scanned: number; readonly rewritten: number } {
  const rows = db
    .prepare(`SELECT id, participants FROM ${SESSIONS_TABLE}`)
    .all() as Array<Record<string, unknown>>;
  const update = db.prepare(`UPDATE ${SESSIONS_TABLE} SET participants = ? WHERE id = ?`);
  let rewritten = 0;
  for (const row of rows) {
    const sessionId = String(row.id);
    const raw = row.participants === null || row.participants === undefined
      ? '[]'
      : String(row.participants);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new CharacterIdRewriteParticipantsError(sessionId, error);
    }
    if (!Array.isArray(parsed)) {
      throw new CharacterIdRewriteParticipantsError(sessionId, new Error('participants 不是数组'));
    }
    let changed = false;
    const next = parsed.map((entry) => {
      if (typeof entry !== 'string') {
        throw new CharacterIdRewriteParticipantsError(sessionId, new Error('participants 里有非字符串项'));
      }
      const replacement = mapping.get(entry);
      if (replacement === undefined) return entry;
      changed = true;
      return replacement;
    });
    if (!changed) continue;
    update.run(JSON.stringify(next), sessionId);
    rewritten += 1;
  }
  return { scanned: rows.length, rewritten };
}

/**
 * participants 校验：逐条 `JSON.parse` + 每项能在 `characters` 中找到。
 *
 * 分两类参与者（design 的 participants 是混合命名空间）：
 *   - **角色参与者**（能在 characters 中找到）⇒ 改写后必须仍能找到；
 *   - **非角色参与者**（agent id / link id / clientId）⇒ 保留不动（默认只统计；--strict 下判失败）。
 * 残留**陈旧角色 id**（旧 id 还在 participants 里）⇒ 硬失败（说明漏改了一行）。
 */
function checkParticipants(
  db: RewriteDatabase,
  characterIds: ReadonlySet<string>,
  strict: boolean
): ValidationCheck {
  const rows = db
    .prepare(`SELECT id, participants FROM ${SESSIONS_TABLE}`)
    .all() as Array<Record<string, unknown>>;
  const mappedOldIds = new Set(listCharacterIdMappings(db).map((record) => record.oldId));

  const unparsable: string[] = [];
  const staleCharacterIds: string[] = [];
  const nonCharacterParticipants: string[] = [];

  for (const row of rows) {
    const sessionId = String(row.id);
    const raw = row.participants === null || row.participants === undefined
      ? '[]'
      : String(row.participants);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      unparsable.push(sessionId);
      continue;
    }
    if (!Array.isArray(parsed)) {
      unparsable.push(sessionId);
      continue;
    }
    for (const entry of parsed) {
      if (typeof entry !== 'string') {
        unparsable.push(sessionId);
        continue;
      }
      if (characterIds.has(entry)) continue;
      if (mappedOldIds.has(entry)) {
        staleCharacterIds.push(`${sessionId}:${entry}`);
        continue;
      }
      nonCharacterParticipants.push(entry);
    }
  }

  if (unparsable.length > 0) {
    return {
      id: 'participants-parse',
      title: 'sessions.participants 逐条可 JSON.parse 且是字符串数组',
      status: 'fail',
      detail: `${unparsable.length} 行 participants 解析失败`,
      samples: unparsable.slice(0, 10),
    };
  }
  if (staleCharacterIds.length > 0) {
    return {
      id: 'participants-parse',
      title: 'sessions.participants 逐条可 JSON.parse 且是字符串数组',
      status: 'fail',
      detail: `${staleCharacterIds.length} 项参与者仍指向旧角色 id（漏改）`,
      samples: staleCharacterIds.slice(0, 10),
    };
  }
  if (strict && nonCharacterParticipants.length > 0) {
    return {
      id: 'participants-parse',
      title: 'sessions.participants 逐条可 JSON.parse 且是字符串数组',
      status: 'fail',
      detail: `${nonCharacterParticipants.length} 项参与者不是角色 id（--strict 下判失败）`,
      samples: nonCharacterParticipants.slice(0, 10),
    };
  }
  return {
    id: 'participants-parse',
    title: 'sessions.participants 逐条可 JSON.parse 且是字符串数组',
    status: nonCharacterParticipants.length > 0 ? 'warn' : 'pass',
    detail:
      nonCharacterParticipants.length > 0
        ? `全部可解析；其中 ${nonCharacterParticipants.length} 项是非角色参与者（agent / link / client id），保留不动`
        : `全部可解析，且每项都能在 characters 中找到`,
    samples: nonCharacterParticipants.slice(0, 10),
  };
}

/** 引用表 → 步骤名（崩溃注入点用）。 */
function tableStepOf(table: string): RewriteStep {
  switch (table) {
    case UNIT_POSITIONS_TABLE:
      return 'unit-positions';
    case CHARACTER_TASKS_TABLE:
      return 'character-tasks';
    case EXP_EVENTS_TABLE:
      return 'exp-events';
    default:
      return 'chat-messages';
  }
}
