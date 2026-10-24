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
 * @since v3.16，task_037。
 */

import type { PersistedTaskRecord, PersistedTaskStatus } from './task-record-dao';

/** 任务历史加载窗口缺省值（038 的队列可见性量级；与 DAO 的 loadRecentTasks 缺省一致）。 */
export const TASK_HISTORY_LOAD_LIMIT = 20;

/** IPC 读取结果。ok=false 时 tasks 缺省。 */
export interface TaskHistoryLoadResult {
  readonly ok: boolean;
  readonly tasks?: PersistedTaskRecord[];
  readonly error?: string;
}

/**
 * preload 的 gameSave 扩展面（@since task_037 追加两条：game:saveTask / game:loadTasks）。
 */
export interface TaskRecordApi {
  /** upsert 一条任务（task-service 回调触发，落 character_tasks 表；失败返回 ok=false，不抛）。 */
  saveTask(record: PersistedTaskRecord): Promise<{ readonly ok: boolean; readonly error?: string }>;
  /** 读某角色最近 limit 条任务（缺省 TASK_HISTORY_LOAD_LIMIT）。 */
  loadTasks(characterId: string, limit?: number): Promise<TaskHistoryLoadResult>;
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
