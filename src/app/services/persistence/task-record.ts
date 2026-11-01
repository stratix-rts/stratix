/**
 * 文件职责：角色任务的**渲染侧持久化端口**（task_037）—— 三件事（与 chat-history.ts 同构）：
 *   ① 声明 IPC 面（TaskRecordApi，挂在 preload 的 gameSave 扩展段上：game:saveTask / game:loadTasks）
 *      + window 探测器；
 *   ② 落库回调工厂（makeTaskRecordPersister）：task-service 的 persistTask 注入件，
 *      fire-and-forget（落库失败只警告，绝不打断任务执行回路）。
 * 输入：window.electronAPI.gameSave 的扩展面（saveTask / loadTasks）。
 * 输出：task-service / 组合根可直接注入的回调。
 * 禁止事项：
 *   1. import electron / 主进程模块 —— 本文件进渲染 bundle，IPC 只经 preload 暴露的面；
 *   2. 在这里定写入时机 —— 时机归 task-service（随相位快照落，completed 带全文）；
 *   3. 认识 core 类型 —— 记录形状与 DAO 的 PersistedTaskRecord 同构，翻译由调用方完成。
 *
 * @since v3.16，task_037；v3.26（task_050）追加：game:taskStats 聚合查询面
 *   （loadTaskStats / reduceTaskStatRows / makeTaskStatsProvider —— 派发推荐的数据源）。
 */

import type { PersistedTaskRecord, PersistedTaskStatRow, PersistedTaskStatus } from './task-record-dao';

/** 任务历史加载窗口缺省值（038 的队列可见性量级；与 DAO 的 loadRecentTasks 缺省一致）。 */
export const TASK_HISTORY_LOAD_LIMIT = 20;

/** IPC 读取结果。ok=false 时 tasks 缺省。 */
export interface TaskHistoryLoadResult {
  readonly ok: boolean;
  readonly tasks?: PersistedTaskRecord[];
  readonly error?: string;
}

/**
 * preload 的 gameSave 扩展面（@since task_037 追加两条：game:saveTask / game:loadTasks；
 * @since v3.26 task_050 追加一条：game:taskStats —— 全量按角色×状态聚合，派发推荐用）。
 */
export interface TaskRecordApi {
  /** upsert 一条任务（task-service 回调触发，落 character_tasks 表；失败返回 ok=false，不抛）。 */
  saveTask(record: PersistedTaskRecord): Promise<{ readonly ok: boolean; readonly error?: string }>;
  /** 读某角色最近 limit 条任务（缺省 TASK_HISTORY_LOAD_LIMIT）。 */
  loadTasks(characterId: string, limit?: number): Promise<TaskHistoryLoadResult>;
  /** 全量按角色×状态聚合统计（DAO 的 aggregateTaskStatusCounts 透传）。 */
  loadTaskStats(): Promise<TaskStatsLoadResult>;
}

/** IPC 读取结果。ok=false 时 rows 缺省。 */
export interface TaskStatsLoadResult {
  readonly ok: boolean;
  readonly rows?: PersistedTaskStatRow[];
  readonly error?: string;
}

/** 从 window.electronAPI 取任务通道；非 Electron 环境（纯 vite dev / node 测试）返回 null。 */
export function taskRecordApi(): TaskRecordApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError（与 chatHistoryApi 同一手法）。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { gameSave?: TaskRecordApi } }).electronAPI;
  return api?.gameSave ?? null;
}

/**
 * task-service 的 persistTask 注入件：同步签名、内部 fire-and-forget。
 * 落库失败（IPC 不通 / 主进程拒绝）只 logger 一句 —— 任务执行的可用性优先于历史完整性
 * （与 makeChatMessagePersister 同一口径）。
 */
export function makeTaskRecordPersister(
  api: TaskRecordApi,
  logger: (line: string) => void = (line) => console.warn(line)
): (record: PersistedTaskRecord) => void {
  return (record) => {
    void api
      .saveTask(record)
      .then((result) => {
        if (!result.ok) logger(`[TaskRecord] 任务落库被拒（${record.id}）：${result.error ?? 'unknown'}`);
      })
      .catch((error: unknown) => {
        logger(
          `[TaskRecord] 任务落库失败（${record.id}）：${error instanceof Error ? error.message : String(error)}`
        );
      });
  };
}

/**
 * 词表导出给 preload 类型声明用（那边按它收窄 status 入参，形状对齐 DAO 的 CHECK 约束）。
 */
export type { PersistedTaskStatus };

// ============================================================================
// 按角色聚合的推荐统计（@since v3.26，task_050）
// ============================================================================

/**
 * 一个角色的推荐统计快照（SQL 行的归约结果；hud 侧的 CharacterTaskStatInput 同构 ——
 * 结构一致即可注入，不跨层 import：hud 不知道 DAO 行形状，本文件不知道推荐算法）。
 * completed/failed 只数终态（cancelled / 在办不计入成功率）；avgDurationMs 是
 * completed+failed 两组行均值的**计数加权平均**（不是两组均值的算术平均 —— 每行权重相等，
 * 先合样本再除，与单次 GROUP BY 的语义一致）。
 */
export interface TaskStatSummary {
  readonly characterId: string;
  readonly completed: number;
  readonly failed: number;
  readonly avgDurationMs: number | null;
}

/**
 * SQL 行 → 每角色归约（纯函数）：同角色的多状态行合成一行统计。
 * 平均耗时的加权口径见 TaskStatSummary —— SQL 已给出每组的 AVG 与 COUNT，
 * 这里 count 加权还原「全部终态行的均值」，不丢样本权重。
 */
export function reduceTaskStatRows(rows: readonly PersistedTaskStatRow[]): readonly TaskStatSummary[] {
  const byCharacter = new Map<
    string,
    { characterId: string; completed: number; failed: number; durationSum: number; durationSamples: number }
  >();
  for (const row of rows) {
    const entry =
      byCharacter.get(row.characterId) ?? {
        characterId: row.characterId,
        completed: 0,
        failed: 0,
        durationSum: 0,
        durationSamples: 0,
      };
    if (row.status === 'completed') entry.completed = row.count;
    if (row.status === 'failed') entry.failed = row.count;
    // 耗时样本只在终态两组里取（组均值 × 组条数还原样本和；avgDurationMs 为 null 的组跳过）。
    if (row.avgDurationMs !== null && (row.status === 'completed' || row.status === 'failed')) {
      entry.durationSum += row.avgDurationMs * row.count;
      entry.durationSamples += row.count;
    }
    byCharacter.set(row.characterId, entry);
  }
  return [...byCharacter.values()].map(({ characterId, completed, failed, durationSum, durationSamples }) => ({
    characterId,
    completed,
    failed,
    avgDurationMs: durationSamples > 0 ? durationSum / durationSamples : null,
  }));
}

/**
 * 统计提供口工厂（task_050 ⑤：app 层「缓存」）：每次调用都现取（IPC → 主进程 SQL GROUP BY），
 * 缓存语义在消费方（hud 表单持有上一次快照，打开时刷新一次、期间不实时订阅 —— 打开期间的
 * 新任务最多让下一次打开的读数更新，不影响本次推荐）。取不到（非 Electron / IPC 失败）返回
 * null：hud 按「无历史」中性降级，不拆表单可用性。
 */
export function makeTaskStatsProvider(
  api: TaskRecordApi | null,
  logger: (line: string) => void = (line) => console.warn(line)
): () => Promise<readonly TaskStatSummary[] | null> {
  return async () => {
    if (!api) return null;
    try {
      const result = await api.loadTaskStats();
      if (!result.ok || !result.rows) {
        logger(`[TaskRecord] 统计聚合被拒：${result.error ?? 'unknown'}`);
        return null;
      }
      return reduceTaskStatRows(result.rows);
    } catch (error: unknown) {
      logger(
        `[TaskRecord] 统计聚合失败：${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  };
}
