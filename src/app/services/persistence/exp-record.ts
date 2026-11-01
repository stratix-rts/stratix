/**
 * 文件职责：角色经验事件的**渲染侧持久化端口**（task_061）—— 与 task-record.ts 同构，三件事：
 *   ① 声明 IPC 面（ExpEventApi，挂在 preload 的 gameSave 扩展段上：game:saveExpEvent /
 *      game:loadExpEvents / game:growthOverview）+ window 探测器；
 *   ② 落库回调工厂（makeExpEventPersister）：progression-service 的 persistExpEvent 注入件，
 *      fire-and-forget（落库失败只警告，绝不打断养成回路 —— 养成状态在 WorldState / characters
 *      表另有真相，曲线少一个点不是错误）；
 *   ③ 成长看板数据口工厂（makeGrowthStatsPort）：把「全场活跃度聚合 + 任务状态统计 + 近窗
 *      经验事件 + 近期任务」收拢成一个三方法端口，组合根注入 hud 角色屏的「成长」tab。
 * 输入：window.electronAPI.gameSave 的扩展面（saveExpEvent / loadExpEvents / growthOverview）。
 * 输出：progression-service / hud 角色屏可直接注入的端口。
 * 禁止事项：
 *   1. import electron / 主进程模块 —— 本文件进渲染 bundle，IPC 只经 preload 暴露的面；
 *   2. 在这里定写入时机 —— 时机归 progression-service（exp.gained 落来源行 / 升级落里程碑行）；
 *   3. 认识 hud 类型 —— 汇报形状与 hud 侧的 GrowthOverviewRow / GrowthExpEvent 同构，
 *      结构一致即可注入（不跨层 import：hud 不知道 DAO 行形状，本文件不知道看板算法）。
 *
 * @since v3.36，task_061。
 */

import type { PersistedActivityRow, PersistedExpEvent } from './exp-event-dao';
import type { TaskRecordApi } from './task-record';

/** 成长曲线的读取窗口缺省值（近 30 天，与 hud 折线图的横轴一致）。 */
export const EXP_CURVE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** preload 的 gameSave 扩展面（task_061 追加三条）。 */
export interface ExpEventApi {
  /** 插入一条经验事件（progression-service 回调触发，落 exp_events 表；失败返回 ok=false，不抛）。 */
  saveExpEvent(insert: {
    readonly characterId: string;
    readonly delta: number;
    readonly reason: 'task_completed' | 'task_failed' | 'chat_round' | 'level_up';
    readonly level: number | null;
    readonly createdAt: number;
  }): Promise<{ readonly ok: boolean; readonly error?: string }>;
  /** 读某角色自 sinceMs 起的经验事件（created_at 升序）。 */
  loadExpEvents(
    characterId: string,
    sinceMs: number
  ): Promise<{ readonly ok: boolean; events?: PersistedExpEvent[]; readonly error?: string }>;
  /** 全场活跃度聚合（DAO 的 aggregateCharacterActivity 透传）。 */
  growthOverview(): Promise<{ readonly ok: boolean; rows?: PersistedActivityRow[]; readonly error?: string }>;
}

/** 从 window.electronAPI 取经验事件通道；非 Electron 环境（纯 vite dev / node 测试）返回 null。 */
export function expEventApi(): ExpEventApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError（与 taskRecordApi 同一手法）。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { gameSave?: ExpEventApi } }).electronAPI;
  return api?.gameSave ?? null;
}

/**
 * progression-service 的 persistExpEvent 注入件：同步签名、内部 fire-and-forget。
 * 落库失败（IPC 不通 / 主进程拒绝）只 logger 一句 —— 养成回路的可用性优先于曲线完整性
 * （与 makeTaskRecordPersister 同一口径）。
 */
export function makeExpEventPersister(
  api: ExpEventApi,
  logger: (line: string) => void = (line) => console.warn(line)
): (insert: Parameters<ExpEventApi['saveExpEvent']>[0]) => void {
  return (insert) => {
    void api
      .saveExpEvent(insert)
      .then((result) => {
        if (!result.ok) {
          logger(`[ExpRecord] 经验事件落库被拒（${insert.characterId}/${insert.reason}）：${result.error ?? 'unknown'}`);
        }
      })
      .catch((error: unknown) => {
        logger(
          `[ExpRecord] 经验事件落库失败（${insert.characterId}/${insert.reason}）：${error instanceof Error ? error.message : String(error)}`
        );
      });
  };
}

/**
 * 一个角色的六态任务计数（全场总览 / 成长 tab 的任务分布条数据；hud 侧同名形状不 import）。
 */
export interface GrowthTaskCounts {
  readonly queued: number;
  readonly running: number;
  readonly awaiting: number;
  readonly completed: number;
  readonly failed: number;
  readonly cancelled: number;
}

/** 全场总览的一行（活跃度聚合行 + 六态任务计数合成；hud 侧 GrowthOverviewRow 同构）。 */
export interface GrowthOverviewStatRow extends PersistedActivityRow {
  readonly taskCounts: GrowthTaskCounts;
}

/** 履历时间线用的近期任务项（hud 侧 GrowthTaskInput 同构）。 */
export interface GrowthTaskEntry {
  readonly prompt: string;
  readonly status: 'completed' | 'failed' | 'cancelled';
  readonly endedAt: number | null;
}

/**
 * 成长看板数据口（三方法；hud 角色屏「成长」tab 的依赖）。
 * 取不到（非 Electron / IPC 失败）各方法返回 null：hud 按「无数据 → 引导语」降级，
 * 不拆看板可用性（与 makeTaskStatsProvider 的中性降级同口径）。
 */
export interface GrowthStatsPort {
  /** 全场活跃度 + 六态任务计数（排行卡 + 任务分布条）。 */
  overview(): Promise<readonly GrowthOverviewStatRow[] | null>;
  /** 某角色近 30 天经验事件（曲线 + 里程碑 + 热力）。 */
  expEvents(characterId: string): Promise<readonly PersistedExpEvent[] | null>;
  /** 某角色近期终态任务（履历时间线）。 */
  recentTasks(characterId: string): Promise<readonly GrowthTaskEntry[] | null>;
}

/** SQL 状态词表（character_tasks 六态）→ GrowthTaskCounts 键的映射（cancelled/awaiting 缩写口径）。 */
function taskCountKey(status: string): keyof GrowthTaskCounts | null {
  if (status === 'queued' || status === 'running') return status;
  if (status === 'awaiting_approval') return 'awaiting';
  if (status === 'completed' || status === 'failed' || status === 'cancelled') return status;
  return null;
}

/** 可变计数器形状（readonly 契约在 GrowthTaskCounts，归并过程用可变本地视图）。 */
type MutableTaskCounts = { -readonly [K in keyof GrowthTaskCounts]: number };

const ZERO_TASK_COUNTS = (): MutableTaskCounts => ({
  queued: 0,
  running: 0,
  awaiting: 0,
  completed: 0,
  failed: 0,
  cancelled: 0,
});

/**
 * 端口工厂：组合根把它注入 hud 角色屏（main-entry）。overview = 活跃度聚合 + taskStats 两路
 * IPC 合流（任务六态计数从既有 game:taskStats 取 —— 不新开面，与派发推荐共用同一真相源）。
 * 任一路失败整个 overview 返回 null：缺一半的排行卡比引导语更误导（口径见 makeTaskStatsProvider）。
 */
export function makeGrowthStatsPort(
  expApi: ExpEventApi | null,
  taskApi: TaskRecordApi | null,
  logger: (line: string) => void = (line) => console.warn(line)
): GrowthStatsPort {
  return {
    async overview() {
      if (!expApi || !taskApi) return null;
      try {
        const [activity, stats] = await Promise.all([expApi.growthOverview(), taskApi.loadTaskStats()]);
        if (!activity.ok || !activity.rows) {
          logger(`[Growth] 活跃度聚合被拒：${activity.error ?? 'unknown'}`);
          return null;
        }
        if (!stats.ok || !stats.rows) {
          logger(`[Growth] 任务统计被拒：${stats.error ?? 'unknown'}`);
          return null;
        }
        // 六态计数按角色归并（SQL 行是 character × status 一行一态）。
        const counts = new Map<string, MutableTaskCounts>();
        for (const row of stats.rows) {
          const key = taskCountKey(row.status);
          if (!key) continue;
          const entry = counts.get(row.characterId) ?? ZERO_TASK_COUNTS();
          entry[key] = row.count;
          counts.set(row.characterId, entry);
        }
        return activity.rows.map((row) => ({ ...row, taskCounts: counts.get(row.characterId) ?? ZERO_TASK_COUNTS() }));
      } catch (error: unknown) {
        logger(`[Growth] 活跃度聚合失败：${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    async expEvents(characterId) {
      if (!expApi) return null;
      try {
        const result = await expApi.loadExpEvents(characterId, Date.now() - EXP_CURVE_WINDOW_MS);
        if (!result.ok || !result.events) {
          logger(`[Growth] 经验事件读取被拒（${characterId}）：${result.error ?? 'unknown'}`);
          return null;
        }
        return result.events;
      } catch (error: unknown) {
        logger(`[Growth] 经验事件读取失败（${characterId}）：${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
    async recentTasks(characterId) {
      if (!taskApi) return null;
      try {
        const result = await taskApi.loadTasks(characterId, 20);
        if (!result.ok || !result.tasks) {
          logger(`[Growth] 近期任务读取被拒（${characterId}）：${result.error ?? 'unknown'}`);
          return null;
        }
        // 只留带收尾时刻的终态任务（时间线按 endedAt 排序；非终态防御性剔除后类型收窄）。
        return result.tasks.flatMap((task): GrowthTaskEntry[] => {
          if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') return [];
          if (task.endedAt === null) return [];
          return [{ prompt: task.prompt, status: task.status, endedAt: task.endedAt }];
        });
      } catch (error: unknown) {
        logger(`[Growth] 近期任务读取失败（${characterId}）：${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    },
  };
}
