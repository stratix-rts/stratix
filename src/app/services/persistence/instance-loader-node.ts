/**
 * 文件职责：切副本的 **node 侧 IO 适配**（task_179 / M1-05）—— 给 `InstanceLoaderPort`
 *   实现（instance-loader.ts）提供两件有 IO 的零件：
 *   ① 路径可达性判定（`nodePathExists`）；
 *   ② 实例数据源（`createSqliteInstanceDataSource`）—— 从**真实的 SQLite 行**读出
 *      characters / units / sessions / tasks，配上**内存态**的 missions，整份交给 store。
 * 输入：一个 better-sqlite3 兼容的数据库连接（SqliteDatabaseLike）+ mission 来源口。
 * 输出：InstanceDataSource 实现 / 路径判定函数。
 * 禁止事项：
 *   1. 在这里做业务判断（副本能不能进、任务能不能派）—— 那是 core 裁决 + 端口实现的职责；
 *   2. 改表结构 / 加列 —— **M1 零 DDL**（design §7.1 M1-16 验收③）：
 *      库里没有 instance_id 列，行按「全局行」进出（默认沙盒 = 现有全部数据）；
 *   3. 造数据 —— 读不到就是读不到（空集合），不编造角色 / 任务 / 会话；
 *   4. 直接写 store —— 本模块只**读**，写由端口实现经 store.replaceEntities 落（一次写入一次广播）。
 *
 * why 行 → 视图的翻译住在这里而不是 DAO：DAO 只搬数据（行 ↔ 持久化记录），
 *   「持久化记录 ↔ core 视图」是**core 契约的形状**，归 app 层的翻译件（与 character-record.ts 同源纪律）。
 *
 * ============ 副本维度：读口按 instance 过滤（@since v3.3，task_198 / M2-01）============
 *   进副本 A 只读到 A 的行（`COALESCE(instance_id, 'wsp_sandbox')` 命中口径 —— 步 N2）；
 *   旧行（`instance_id IS NULL`）语义上归默认沙盒 ⇒ 存量数据在切副本后**照常读得到**。
 *
 * ============ 步 N6：roster 物化（@since v3.3，task_202 / M2-05）============
 *   **物化点就在这个读口**：进入副本时，先把该副本根下 `.stratix/roster` 声明的角色
 *   **投影**成该副本的 `characters` 行（契约 → 运行层，**单向**；步 N6），再读。
 *   why 在读之前：物化出来的行**正是本副本要读的行** ⇒ 物化与读同一处
 *   ⇒ 不会出现「行建了、这次进副本却看不到」的错位。
 *   why 落在 node 侧：读盘（fs）+ 落库（sqlite）两半的 IO 都在这一层（分层铁律）。
 *   幂等：重复进入 ⇒ 零重复行（复合唯一索引 `(role_id, instance_id)` 兜底）。
 *   默认沙盒**不物化**（历史数据的 catch-all；把沙盒存量归入项目是步 N7 的显式迁移动作）。
 *
 * @since v3.3（task_179 / M1-05）。
 */

import { existsSync } from 'fs';

import { toCharacterUnit } from '../../../core/character';
import type { EntitySnapshot } from '../../../core/store';
import {
  MAX_CHARACTERS,
  MAX_SESSIONS,
  MAX_TASKS,
  type CharacterTask,
  type CharacterView,
  type MissionView,
  type ProjectInstanceId,
  type SessionRecord,
  type UnitView,
} from '../../../core/types';

import { recordToCharacterView } from './character-record';
import { ensureGameSaveTables, loadCharacters, type SqliteDatabaseLike } from './game-save-dao';
import type { InstanceDataSource, InstanceMissionsProvider } from './instance-loader';
import { materializeInstanceRoster } from './roster-materializer';
import { listSessionRecords, type PersistedSessionRecord } from './session-dao';
import { TASK_HISTORY_LOAD_LIMIT } from './task-record';
import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  type PersistedTaskRecord,
} from './task-record-dao';

/**
 * 路径可达性判定（node 侧）。
 *
 * why 吞掉异常返回 false：判定本身**不能抛** —— 路径不可达是一个**事实**（status = missing），
 *   不是错误（用户把目录挪了而已，HUD 要的是「路径已移动」的修复入口，不是异常栈）。
 */
export function nodePathExists(path: string): boolean {
  if (!path) return false;
  try {
    return existsSync(path);
  } catch {
    return false;
  }
}

// ============================================================================
// 行 → 视图（纯映射）
// ============================================================================

/** 持久化任务行 → core 任务视图（只带 core 契约上的字段；artifacts / pipelineId 是存储件的事）。 */
function toCharacterTask(record: PersistedTaskRecord): CharacterTask {
  return {
    id: record.id,
    characterId: record.characterId,
    prompt: record.prompt,
    status: record.status,
    output: record.output,
    createdAt: record.createdAt,
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    ...(record.plan ? { plan: record.plan } : {}),
    ...(record.missionId ? { missionId: record.missionId } : {}),
  };
}

/** 持久化会话行 → core 会话摘要视图（refId 空 = 无关联，不带这个键）。 */
function toSessionRecord(record: PersistedSessionRecord): SessionRecord {
  return {
    id: record.id,
    kind: record.kind,
    title: record.title,
    participants: [...record.participants],
    status: record.status,
    ...(record.refId ? { refId: record.refId } : {}),
    createdAt: record.createdAt,
    lastEventAt: record.lastEventAt,
    closedAt: record.closedAt,
    eventCount: record.eventCount,
  };
}

// ============================================================================
// 实例数据源（SQLite 行 → 整份快照）
// ============================================================================

export interface SqliteInstanceDataSourceOptions {
  /**
   * mission 来源（**纯内存态** —— mission 是纯内存状态机，不落库，design §1.2.1 的注释）。
   * 缺省 = 该副本没有编组任务（空集合）—— 读口不编造。
   */
  readonly missions?: InstanceMissionsProvider;
  /** 每个角色最多读回多少条任务（缺省 = TASK_HISTORY_LOAD_LIMIT = 20，与历史面板同窗口）。 */
  readonly taskWindow?: number;
  /**
   * 副本项目根解析口（**步 N6 物化要用**：roster 在副本根的 `.stratix/roster`）。
   *
   * 缺省 = 不物化（没有根 ⇒ 不知道该读哪份 roster ⇒ 什么都不做，不猜）。
   */
  readonly resolveInstanceRoot?: (instanceId: ProjectInstanceId) => string | undefined;
  /** 日志口（缺省静默）。 */
  readonly logger?: (line: string) => void;
}

/**
 * 造 SQLite 侧的实例数据源。
 *
 * ★ **副本归属口径**（@since v3.3，task_198 / M2-01）：库里已有 `instance_id` 列 ⇒
 *   读口**按副本过滤**（`COALESCE(instance_id, 'wsp_sandbox')` 命中）⇒ 进副本 A 只读到 A 的行，
 *   旧行（`instance_id IS NULL`）语义上归默认沙盒 ⇒ 存量数据在切副本后照常读得到。
 *
 * ★ **步 N6 物化**（@since v3.3，task_202 / M2-05）：读之前先把该副本的 roster 角色物化成行
 *   （契约 → 运行层，单向；详见文件头与 roster-materializer.ts）。
 */
export function createSqliteInstanceDataSource(
  db: SqliteDatabaseLike,
  options: SqliteInstanceDataSourceOptions = {}
): InstanceDataSource {
  const taskWindow = options.taskWindow ?? TASK_HISTORY_LOAD_LIMIT;

  const read = async (instanceId: ProjectInstanceId): Promise<EntitySnapshot> => {
    // 建表兜底（幂等）：老库 / 测试库上直接调也能读，不要求调用方先建表。
    ensureGameSaveTables(db);
    ensureCharacterTasksTable(db);

    // 步 N6：契约 → 运行层的物化（roster → 本副本的 characters 行）。
    //   why 在读之前：物化出来的行正是本副本要读的行 ⇒ 不会「建了却看不到」。
    //   why 对沙盒不做：沙盒是历史数据的 catch-all（物化会与存量行撞车）——
    //     把沙盒存量归入某个项目是步 N7 的显式迁移动作，不在这里悄悄做。
    const projectRoot = options.resolveInstanceRoot?.(instanceId);
    if (projectRoot) {
      materializeInstanceRoster(db, {
        instanceId,
        projectRoot,
        ...(options.logger ? { logger: options.logger } : {}),
      });
    }

    const characters: CharacterView[] = [];
    for (const record of loadCharacters(db, { instanceId })) {
      if (characters.length >= MAX_CHARACTERS) break;
      const view = recordToCharacterView(record);
      // 脏行（id / name 为空）跳过 —— 与 buildRestoreInjection 同一口径（不编造档案）。
      if (view) characters.push(view);
    }
    const units: UnitView[] = characters.map(toCharacterUnit);

    const sessions: SessionRecord[] = listSessionRecords(db, {
      limit: MAX_SESSIONS,
      instanceId,
    }).map(toSessionRecord);

    // 任务按角色读（character_tasks 表以 character_id 分片）—— 逐角色取最近窗口，
    // 再按总量截到 MAX_TASKS（随 WorldState 全量广播，体积必须有界）。
    const tasks: CharacterTask[] = [];
    for (const character of characters) {
      for (const record of loadRecentTasks(db, character.id, taskWindow, { instanceId })) {
        if (tasks.length >= MAX_TASKS) break;
        tasks.push(toCharacterTask(record));
      }
      if (tasks.length >= MAX_TASKS) break;
    }

    const missions: readonly MissionView[] = options.missions?.(instanceId) ?? [];

    // 盖上实例归属：**内存态**里每个实体都该说清自己属于谁
    //   （下游按 instanceId 过滤 —— M1-10 的桥接层过滤靠的就是这个字段）。
    return {
      missions: missions.map((mission) => ({ ...mission, instanceId })),
      tasks: tasks.map((task) => ({ ...task, instanceId })),
      sessions: sessions.map((session) => ({ ...session, instanceId })),
      characters: characters.map((character) => ({ ...character, instanceId })),
      units: units.map((unit) => ({ ...unit, instanceId })),
    };
  };

  return { read };
}
