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
 * @since v3.3（task_179 / M1-05）。
 */

import { existsSync } from 'fs';

import { toCharacterUnit } from '../../../core/character';
import type { EntitySnapshot } from '../../../core/store';
import {
  DEFAULT_INSTANCE_ID,
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
}

/**
 * 造 SQLite 侧的实例数据源。
 *
 * ★ **M1 零 DDL 的口径**：库里没有 instance_id 列 —— 所有行都是**全局行**，
 *   按设计（§2.4 的 `COALESCE(instance_id, 'wsp_sandbox')` 命中口径）**全部归属默认沙盒**。
 *   别的副本此刻**没有行**（它们的行要等 M2 加列后才可能出现）⇒ 读到空集合是**事实**，不是缺陷。
 *   M2 加列后，这里只需把 WHERE 条件补上 `instance_id = ?` —— 归属判定与翻译都不用重写。
 */
export function createSqliteInstanceDataSource(
  db: SqliteDatabaseLike,
  options: SqliteInstanceDataSourceOptions = {}
): InstanceDataSource {
  const taskWindow = options.taskWindow ?? TASK_HISTORY_LOAD_LIMIT;

  const read = async (instanceId: ProjectInstanceId): Promise<EntitySnapshot> => {
    if (instanceId !== DEFAULT_INSTANCE_ID) {
      // 零 DDL 期的诚实答案：这个副本在库里没有行（它的行要等 instance_id 列存在）。
      return { missions: [], tasks: [], sessions: [], characters: [], units: [] };
    }

    // 建表兜底（幂等）：老库 / 测试库上直接调也能读，不要求调用方先建表。
    ensureGameSaveTables(db);
    ensureCharacterTasksTable(db);

    const characters: CharacterView[] = [];
    for (const record of loadCharacters(db)) {
      if (characters.length >= MAX_CHARACTERS) break;
      const view = recordToCharacterView(record);
      // 脏行（id / name 为空）跳过 —— 与 buildRestoreInjection 同一口径（不编造档案）。
      if (view) characters.push(view);
    }
    const units: UnitView[] = characters.map(toCharacterUnit);

    const sessions: SessionRecord[] = listSessionRecords(db, { limit: MAX_SESSIONS }).map(
      toSessionRecord
    );

    // 任务按角色读（character_tasks 表以 character_id 分片）—— 逐角色取最近窗口，
    // 再按总量截到 MAX_TASKS（随 WorldState 全量广播，体积必须有界）。
    const tasks: CharacterTask[] = [];
    for (const character of characters) {
      for (const record of loadRecentTasks(db, character.id, taskWindow)) {
        if (tasks.length >= MAX_TASKS) break;
        tasks.push(toCharacterTask(record));
      }
      if (tasks.length >= MAX_TASKS) break;
    }

    const missions: readonly MissionView[] = options.missions?.(instanceId) ?? [];

    // 盖上实例归属：行本身没有 instance 列（零 DDL），但**内存态**里每个实体都该说清自己属于谁
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
