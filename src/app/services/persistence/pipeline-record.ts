/**
 * 文件职责：流水线的**渲染侧持久化端口**（task_051）—— 与 task-record.ts 同构的三件事：
 *   ① 声明 IPC 面（PipelineRecordApi，挂在 preload 的 gameSave 扩展段上：game:savePipeline）
 *      + window 探测器；
 *   ② 落库回调工厂（makePipelinePersister）：pipeline-service 的 persistPipeline 注入件，
 *      fire-and-forget（落库失败只警告，绝不打断编排回路）；
 *   ③ 站任务标记工厂（makePipelineStampPersister）：pipeline-service 的 stampTask 注入件 ——
 *      把 pipeline_id 拼进 PersistedTaskRecord 后走既有 game:saveTask 通道（不另开 IPC 面，
 *      DAO 的 CASE 守卫保证相位快照不抹掉标记，见 task-record-dao 文件头）。
 * 输入：window.electronAPI.gameSave 的扩展面。
 * 输出：组合根可直接注入的回调。
 * 禁止事项：
 *   1. import electron / 主进程模块 —— 本文件进渲染 bundle，IPC 只经 preload 暴露的面；
 *   2. 在这里定写入时机 —— 时机归 pipeline-service（每次相位迁移落一次）；
 *   3. 认识 core 类型 —— 记录形状与 DAO 的 PersistedPipelineRecord / PersistedTaskRecord
 *      同构（TaskPersistRecord 与 PersistedTaskRecord 亦同构，翻译由类型系统结构性承担）。
 *
 * @since v3.27（task_051）。
 */

import type { TaskPersistRecord } from '../task-service';

import type { PersistedPipelineRecord } from './pipeline-record-dao';
import type { PersistedTaskRecord } from './task-record-dao';

/**
 * preload 的 gameSave 扩展面（@since task_051 追加一条：game:savePipeline —— 与
 * game:saveTask 同一分发器的流水线通道）。
 */
export interface PipelineRecordApi {
  /** upsert 一条流水线（pipeline-service 回调触发，落 pipelines 表；失败返回 ok=false，不抛）。 */
  savePipeline(record: PersistedPipelineRecord): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

/** 从 window.electronAPI 取流水线通道；非 Electron 环境（纯 vite dev / node 测试）返回 null。 */
export function pipelineRecordApi(): PipelineRecordApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError（与 taskRecordApi 同一手法）。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { gameSave?: PipelineRecordApi } }).electronAPI;
  return api?.gameSave ?? null;
}

/**
 * pipeline-service 的 persistPipeline 注入件：同步签名、内部 fire-and-forget。
 * 落库失败只 logger 一句 —— 编排的可用性优先于历史完整性（与 makeTaskRecordPersister
 * 同一口径：绝不因为库不可达把跑了一半的流水线掐断）。
 */
export function makePipelinePersister(
  api: PipelineRecordApi,
  logger: (line: string) => void = (line) => console.warn(line)
): (record: PersistedPipelineRecord) => void {
  return (record) => {
    void api
      .savePipeline(record)
      .then((result) => {
        if (!result.ok) logger(`[PipelineRecord] 流水线落库被拒（${record.id}）：${result.error ?? 'unknown'}`);
      })
      .catch((error: unknown) => {
        logger(
          `[PipelineRecord] 流水线落库失败（${record.id}）：${error instanceof Error ? error.message : String(error)}`
        );
      });
  };
}

/**
 * pipeline-service 的 stampTask 注入件：站任务 pipeline_id 落列。复用既有 game:saveTask
 * 通道（相位快照同一张表同一行，只多带 pipelineId —— DAO 的 CASE 守卫收口写入口径）。
 * fire-and-forget 同上；TaskPersistRecord 与 PersistedTaskRecord 结构同构，展开拼列。
 */
export function makePipelineStampPersister(
  taskApi: { saveTask(record: PersistedTaskRecord): Promise<{ readonly ok: boolean; readonly error?: string }> },
  logger: (line: string) => void = (line) => console.warn(line)
): (record: TaskPersistRecord, pipelineId: string) => void {
  return (record, pipelineId) => {
    void taskApi
      .saveTask({ ...record, pipelineId })
      .then((result) => {
        if (!result.ok) logger(`[PipelineRecord] 站任务标记 pipeline_id 被拒（${record.id}）：${result.error ?? 'unknown'}`);
      })
      .catch((error: unknown) => {
        logger(
          `[PipelineRecord] 站任务标记 pipeline_id 失败（${record.id}）：${error instanceof Error ? error.message : String(error)}`
        );
      });
  };
}
