/**
 * 文件职责：**service 进程的存储归一**（前后端分离 A3 / task_079）——
 *   SQLite 在 service 侧的**唯一 owner**：打开 / 初始化 + 三个落库点（任务全文 / chat /
 *   exp_events）的写入 + 读 API 用的读取口。
 * 输入：一个可选的 dataDir（缺省 = 沿用进程内已初始化的库单例，不重复开库）+ 日志口。
 * 输出：ServiceStorage —— { persistTask, persistChatMessage, persistExpEvent,
 *        readTaskOutput, loadChatMessages, loadEarlierChatMessages,
 *        readSessions, readSessionEvents }。
 * 禁止事项：
 *   1. 在这里做业务判断（相位裁决 / 等级曲线 / 消息词表合法性）—— 那些真相在 core 与既有
 *      DAO；本模块只负责「把已经裁决好的东西写进库 / 从库里取出来」；
 *   2. 让写失败打断业务回路 —— 落库失败只记一行警告（与渲染侧 persister 同一口径：
 *      任务执行 / 对话回路的可用性优先于历史完整性）；
 *   3. 在 Electron / 渲染进程里 import 本模块 —— 本模块住在 service 侧（铁律 6：
 *      SQLite 只由 service 进程打开写，其余进程经 API 读）；
 *   4. 改表结构 / 加列 —— 三张表（character_tasks / character_chat_messages / exp_events）
 *      结构不变（零数据迁移）；会话两张表（sessions / session_events）是**新表**（task_092），
 *      结构归既有 DAO，本模块只调 DAO；
 *   5. 在这里缓存历史行做分页 —— 分页口径归 DAO（窗口查询）；缓存会与库漂移。
 *
 * why 单独成模块（而不是让各服务各自 import DAO）：
 *   三个落库点原本散在渲染进程（task-service 收尾 / chat persister / progression 注入件），
 *   经 IPC 落到 Electron main 的 DAO —— 于是「谁开库」变成多进程开同一个文件（隐患）。
 *   本模块把「开库 + 写 + 读」收成一件：service 进程持有它，其余进程经 API 读
 *   （拓扑见 docs/SERVICE-SPLIT-PLAN.md §2 与铁律 6）。
 *
 * ============ 写口语义（与渲染侧 persister 逐条同构）============
 *   ① 同步签名、内部即写（DAO 是同步的）：失败只警告不抛 —— 调用方（task-service /
 *      chat-service / progression-service）的回路不因落库失败而中断；
 *   ② **落库时机不变**：任务全文随相位快照落（completed 带全文）、chat user 即时 /
 *      assistant 收束 / system 失败事件、exp 逐条事件 —— 同表同列同时机，零数据迁移；
 *   ③ **校验口径不变**：原先那道「IPC 是可信度最低的入口，坏形状一律拒」的守卫随直写
 *      路径一起迁到本模块（拒绝 = 不写 + 记一行警告），不让脏行进 CHECK 约束炸库。
 *
 * ============ 关于「谁持有 SQLite 连接」============
 *   连接归 stratix-database 的**进程内单例**（谁 initialize 谁持有）。本模块不自己 new
 *   连接，只把单例的句柄包成写口 / 读口；进程退出时连接随进程释放（无需在此 close）。
 *
 * @since v3.42（task_079 / service-split A3）。
 */

import type { ChatPersistInput } from '../../app/services/persistence/chat-history';
import {
  ensureCharacterChatMessagesTable,
  insertChatMessage,
  loadChatMessages,
  loadEarlierChatMessages,
  PERSISTED_CHAT_ROLES,
  type PersistedChatMessage,
} from '../../app/services/persistence/chat-history-dao';
import {
  ensureExpEventsTable,
  insertExpEvent,
  PERSISTED_EXP_EVENT_REASONS,
} from '../../app/services/persistence/exp-event-dao';
import type { SqliteDatabaseLike } from '../../app/services/persistence/game-save-dao';
import {
  ensureSessionsTable,
  listSessionRecords,
  type PersistedSessionRecord,
  type SessionListFilter,
} from '../../app/services/persistence/session-dao';
import {
  ensureSessionEventsTable,
  listSessionEvents,
  type PersistedSessionEvent,
  type SessionEventPageOptions,
} from '../../app/services/persistence/session-event-dao';
import {
  ensureCharacterTasksTable,
  upsertTask,
  PERSISTED_TASK_STATUSES,
  type PersistedTaskRecord,
} from '../../app/services/persistence/task-record-dao';
import { MAX_EXTERNAL_SESSION_ID_LEN } from '../../core/types';
import { getDatabase, initializeDatabase } from '../../stratix-database';

import type { StratixExpEventInsert } from './stratix-service';

// ============================================================================
// 端口
// ============================================================================

/** 字符 id 长度上限（与 Electron main 的 IPC 校验同口径 —— 守卫随直写路径迁移）。 */
const MAX_CHARACTER_ID_LEN = 200;
/** 任务 id 长度上限（同上）。 */
const MAX_TASK_ID_LEN = 64;
/** 正文 / 全文输出体积上限（同上）。 */
const MAX_CONTENT_LEN = 200_000;
/** 成果物 JSON 体积上限（同上）。 */
const MAX_ARTIFACTS_LEN = 100_000;

/**
 * service 侧的存储端口（读写两半）。
 *
 * why 写口是同步签名：DAO 是同步的，service 进程内不需要再绕一圈 IPC；
 *   调用方（task-service / chat-service / progression-service）拿到的注入件形状与
 *   渲染侧 persister **逐条同构** —— 换注入件即接管，业务代码零改动。
 */
export interface ServiceStorage {
  /** 落一条任务快照（character_tasks 表；completed 带全文输出）。 */
  readonly persistTask: (record: PersistedTaskRecord) => void;
  /** 落一条对话消息（character_chat_messages 表；role 词表与表 CHECK 一致）。 */
  readonly persistChatMessage: (message: ChatPersistInput) => void;
  /** 落一条经验事件（exp_events 表；append-only）。 */
  readonly persistExpEvent: (insert: StratixExpEventInsert) => void;
  /** 读任务输出全文；库里没有（或 output 为空）返回 null —— 绝不编造。 */
  readonly readTaskOutput: (taskId: string) => string | null;
  /** 读某角色最近 limit 条对话（时间正序；从旧到新）。 */
  readonly loadChatMessages: (characterId: string, limit?: number) => PersistedChatMessage[];
  /** 读 beforeId 之前最近 limit 条（向前翻页；时间正序）。 */
  readonly loadEarlierChatMessages: (
    characterId: string,
    beforeId: number,
    limit?: number
  ) => PersistedChatMessage[];
  /** 读会话摘要列表（kind / status 过滤 + 分页；创建时间倒序）。 */
  readonly readSessions: (filter: SessionListFilter) => PersistedSessionRecord[];
  /** 读某会话的事件流（seq 正序；beforeSeq 游标切片）。 */
  readonly readSessionEvents: (
    sessionId: string,
    options: SessionEventPageOptions
  ) => PersistedSessionEvent[];
}

/** 存储件的创建参数。 */
export interface ServiceStorageOptions {
  /**
   * 数据目录（库文件所在处）。缺省 = 沿用进程内已初始化的库单例；
   * 给出 = 用它初始化（单例已存在时该次调用不生效 —— 单例只开一次，不重复开库）。
   */
  readonly dataDir?: string;
  /** 日志口（落库被拒 / 失败各记一行）。缺省 = console.warn。 */
  readonly logger?: (line: string) => void;
}

// ============================================================================
// 守卫（从 Electron main 的 IPC 校验层迁来 —— 同一口径，坏形状一律拒）
// ============================================================================

/** 一行坏形状的说明（null = 形状没问题）。 */
type GuardResult = string | null;

function guardCharacterId(value: unknown): GuardResult {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_CHARACTER_ID_LEN) {
    return 'bad characterId';
  }
  return null;
}

function guardTimestamp(value: unknown): GuardResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'bad timestamp';
  return null;
}

function guardOptionalTimestamp(value: unknown): GuardResult {
  if (value == null) return null;
  return guardTimestamp(value);
}

/** 任务快照守卫：与 Electron main 的 game:saveTask 校验同构（含成果物 JSON 可解析）。 */
function guardTaskRecord(record: PersistedTaskRecord): GuardResult {
  if (typeof record?.id !== 'string' || record.id.length === 0 || record.id.length > MAX_TASK_ID_LEN) {
    return 'bad id';
  }
  const characterId = guardCharacterId(record.characterId);
  if (characterId) return characterId;
  if (typeof record.prompt !== 'string' || record.prompt.length === 0 || record.prompt.length > MAX_CONTENT_LEN) {
    return 'bad prompt';
  }
  if (
    typeof record.status !== 'string' ||
    !(PERSISTED_TASK_STATUSES as readonly string[]).includes(record.status)
  ) {
    return `bad status: ${String(record?.status)}`;
  }
  if (typeof record.output !== 'string' || record.output.length > MAX_CONTENT_LEN) return 'bad output';
  const createdAt = guardTimestamp(record.createdAt);
  if (createdAt) return createdAt;
  const startedAt = guardOptionalTimestamp(record.startedAt);
  if (startedAt) return startedAt;
  const endedAt = guardOptionalTimestamp(record.endedAt);
  if (endedAt) return endedAt;
  if (record.artifacts != null) {
    if (typeof record.artifacts !== 'string' || record.artifacts.length > MAX_ARTIFACTS_LEN) {
      return 'bad artifacts';
    }
    try {
      JSON.parse(record.artifacts);
    } catch {
      return 'bad artifacts (not JSON)';
    }
  }
  if (record.plan != null && (typeof record.plan !== 'string' || record.plan.length > MAX_CONTENT_LEN)) {
    return 'bad plan';
  }
  if (record.pipelineId != null && (typeof record.pipelineId !== 'string' || record.pipelineId.length > MAX_CHARACTER_ID_LEN)) {
    return 'bad pipelineId';
  }
  if (record.missionId != null && (typeof record.missionId !== 'string' || record.missionId.length > MAX_CHARACTER_ID_LEN)) {
    return 'bad missionId';
  }
  return null;
}

/** 对话消息守卫：与 Electron main 的 game:saveChatMessage 校验同构。 */
function guardChatMessage(message: ChatPersistInput): GuardResult {
  const characterId = guardCharacterId(message.characterId);
  if (characterId) return characterId;
  if (typeof message.role !== 'string' || !(PERSISTED_CHAT_ROLES as readonly string[]).includes(message.role)) {
    return `bad role: ${String(message?.role)}`;
  }
  if (typeof message.text !== 'string' || message.text.length === 0 || message.text.length > MAX_CONTENT_LEN) {
    return 'bad content';
  }
  if (
    message.sessionRef != null &&
    (typeof message.sessionRef !== 'string' || message.sessionRef.length > MAX_EXTERNAL_SESSION_ID_LEN)
  ) {
    return 'bad sessionRef';
  }
  return null;
}

/** 经验事件守卫：与 Electron main 的 game:saveExpEvent 校验同构（level 语义收敛在一处）。 */
function guardExpEvent(insert: StratixExpEventInsert): GuardResult {
  const characterId = guardCharacterId(insert.characterId);
  if (characterId) return characterId;
  if (typeof insert.delta !== 'number' || !Number.isInteger(insert.delta) || insert.delta < 0) return 'bad delta';
  if (
    typeof insert.reason !== 'string' ||
    !(PERSISTED_EXP_EVENT_REASONS as readonly string[]).includes(insert.reason)
  ) {
    return `bad reason: ${String(insert?.reason)}`;
  }
  const isLevelUp = insert.reason === 'level_up';
  if (isLevelUp && (typeof insert.level !== 'number' || !Number.isInteger(insert.level) || insert.level < 1)) {
    return 'bad level';
  }
  if (!isLevelUp && insert.level != null) return 'level only allowed on level_up rows';
  return guardTimestamp(insert.createdAt);
}

// ============================================================================
// 读口（与 DAO 同源）
// ============================================================================

/**
 * 从库里读任务输出全文（纯读；表不存在 / 查询失败由调用方兜底）。
 *
 * why 单独成函数：MCP 侧（同进程直读，见 mcp/context.ts）与读 API 两条路共用同一句 SQL，
 *   不各写一份（改一处必须同步另一处的漂移是真实事故源）。
 */
export function readTaskOutputFromDb(db: SqliteDatabaseLike, taskId: string): string | null {
  const row = db
    .prepare('SELECT output FROM character_tasks WHERE id = ?')
    .get(taskId) as { output?: string } | undefined;
  const output = row?.output;
  return typeof output === 'string' && output.length > 0 ? output : null;
}

// ============================================================================
// 工厂
// ============================================================================

/**
 * 造一个 service 侧的存储件（开库 + 三个落库点 + 读口）。
 *
 * 开库语义：`initializeDatabase` 是**进程内单例**（谁先 initialize 谁持有连接）——
 *   给出 dataDir 时用它初始化（单例已存在则不生效，不重复开同一个文件）；
 *   缺省时沿用进程内已初始化的单例（未初始化则按库默认目录初始化）。
 *
 * 三张表的建表 / 兜底（ensure*）在创建时各跑一次：DAO 自立兜底（幂等），
 *   老库缺列 / 缺表也能直接用 —— 落库路径不依赖库是新建的还是迁移来的。
 */
export async function createServiceStorage(options: ServiceStorageOptions = {}): Promise<ServiceStorage> {
  const logger = options.logger ?? ((line: string): void => console.warn(line));

  await initializeDatabase(options.dataDir ? { dataDir: options.dataDir } : undefined);
  const db = getDatabase().getDatabase() as unknown as SqliteDatabaseLike;

  // 三张表就位（幂等）：character_tasks / character_chat_messages / exp_events。
  ensureCharacterTasksTable(db);
  ensureCharacterChatMessagesTable(db);
  ensureExpEventsTable(db);
  // 会话两张表就位（幂等，task_092）：sessions（摘要快照）/ session_events（事件流）。
  ensureSessionsTable(db);
  ensureSessionEventsTable(db);

  const persistTask = (record: PersistedTaskRecord): void => {
    try {
      const problem = guardTaskRecord(record);
      if (problem) {
        logger(`[ServiceStorage] 任务落库被拒（${record?.id ?? 'unknown'}）：${problem}`);
        return;
      }
      upsertTask(db, record);
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 任务落库失败（${record?.id ?? 'unknown'}）：${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const persistChatMessage = (message: ChatPersistInput): void => {
    try {
      const problem = guardChatMessage(message);
      if (problem) {
        logger(`[ServiceStorage] 消息落库被拒（${message?.characterId ?? 'unknown'}）：${problem}`);
        return;
      }
      insertChatMessage(db, {
        characterId: message.characterId,
        role: message.role,
        content: message.text,
        sessionRef: message.sessionRef ?? null,
        // 时间戳在本层统一盖章：user 与 assistant 的先后即调用先后（与渲染侧同一口径）。
        createdAt: Date.now(),
      });
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 消息落库失败（${message?.characterId ?? 'unknown'}）：${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const persistExpEvent = (insert: StratixExpEventInsert): void => {
    try {
      const problem = guardExpEvent(insert);
      if (problem) {
        logger(`[ServiceStorage] 经验事件落库被拒（${insert?.characterId ?? 'unknown'}）：${problem}`);
        return;
      }
      // level_up 里程碑行的 delta 恒 0（语义收敛在一处 —— 与 Electron main 的 IPC 校验同口径）。
      insertExpEvent(db, insert.reason === 'level_up' ? { ...insert, delta: 0 } : insert);
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 经验事件落库失败（${insert?.characterId ?? 'unknown'}）：${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const readTaskOutput = (taskId: string): string | null => {
    try {
      return readTaskOutputFromDb(db, taskId);
    } catch (error: unknown) {
      // 读失败按「没有全文」处理（绝不打断调用方 —— 与 MCP 侧同一口径）。
      logger(`[ServiceStorage] 任务全文读取失败（${taskId}）：${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };

  const readChatMessages = (characterId: string, limit?: number): PersistedChatMessage[] => {
    try {
      return loadChatMessages(db, characterId, limit);
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 对话历史读取失败（${characterId}）：${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  };

  const readEarlierChatMessages = (
    characterId: string,
    beforeId: number,
    limit?: number
  ): PersistedChatMessage[] => {
    try {
      return loadEarlierChatMessages(db, characterId, beforeId, limit);
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 对话历史翻页读取失败（${characterId}/${beforeId}）：${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  };

  // 会话读口（task_092）：摘要列表 + 事件流；失败按「空」处理（读失败不打断 client，
  // 与既有读口同一口径 —— 路由层拿不到数据时如实返回空列表，不编造内容）。
  const readSessions = (filter: SessionListFilter): PersistedSessionRecord[] => {
    try {
      return listSessionRecords(db, filter);
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 会话列表读取失败（${filter?.kind ?? 'all'}/${filter?.status ?? 'all'}）：${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return [];
    }
  };

  const readSessionEvents = (
    sessionId: string,
    options: SessionEventPageOptions
  ): PersistedSessionEvent[] => {
    try {
      return listSessionEvents(db, sessionId, options);
    } catch (error: unknown) {
      logger(
        `[ServiceStorage] 会话事件读取失败（${sessionId}）：${error instanceof Error ? error.message : String(error)}`
      );
      return [];
    }
  };

  return {
    persistTask,
    persistChatMessage,
    persistExpEvent,
    readTaskOutput,
    loadChatMessages: readChatMessages,
    loadEarlierChatMessages: readEarlierChatMessages,
    readSessions: readSessions,
    readSessionEvents: readSessionEvents,
  };
}
