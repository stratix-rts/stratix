/**
 * 文件职责：agent 健康事件的**渲染侧持久化端口**（task_054，@since v3.30）—— 与
 *   task-record.ts 同构的两件事：
 *   ① 声明 IPC 面（AgentHealthApi，挂在 preload 的 gameSave 扩展段上：game:saveHealthEvent）
 *      + window 探测器；
 *   ② 落库回调工厂（makeAgentHealthPersister）：health-monitor 的 persistEvent 注入件，
 *      fire-and-forget（落库失败只警告，绝不打断监测回路）。
 * 输入：window.electronAPI.gameSave 的扩展面（saveHealthEvent）。
 * 输出：health-monitor / 组合根可直接注入的回调。
 * 禁止事项：
 *   1. import electron / 主进程模块 —— 本文件进渲染 bundle，IPC 只经 preload 暴露的面；
 *   2. 在这里定写入时机 —— 时机归 health-monitor（离线/恢复翻转、unhealthy 审计各一条）；
 *   3. 认识 core 类型 —— 记录形状与 DAO 的 AgentHealthEventInsert 同构（结构类型，不跨层 import）。
 */

import type { AgentHealthEventInsert, PersistedAgentHealthEventKind } from './agent-health-dao';

/** preload 的 gameSave 扩展面（@since v3.30 追加一条：game:saveHealthEvent）。 */
export interface AgentHealthApi {
  /** 插入一条健康事件（health-monitor 回调触发，落 agent_health_events 表；失败返回 ok=false，不抛）。 */
  saveHealthEvent(insert: AgentHealthEventInsert): Promise<{ readonly ok: boolean; readonly error?: string }>;
}

/** 从 window.electronAPI 取健康事件通道；非 Electron 环境（纯 vite dev / node 测试）返回 null。 */
export function agentHealthApi(): AgentHealthApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError（与 taskRecordApi 同一手法）。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { gameSave?: AgentHealthApi } }).electronAPI;
  return api?.gameSave ?? null;
}

/**
 * health-monitor 的 persistEvent 注入件：同步签名、内部 fire-and-forget。
 * 落库失败（IPC 不通 / 主进程拒绝）只 logger 一句 —— 监测可用性优先于审计完整性
 * （与 makeTaskRecordPersister 同一口径）。
 */
export function makeAgentHealthPersister(
  api: AgentHealthApi,
  logger: (line: string) => void = (line) => console.warn(line)
): (insert: AgentHealthEventInsert) => void {
  return (insert) => {
    void api
      .saveHealthEvent(insert)
      .then((result) => {
        if (!result.ok) logger(`[AgentHealth] 健康事件落库被拒（${insert.kind}/${insert.event}）：${result.error ?? 'unknown'}`);
      })
      .catch((error: unknown) => {
        logger(
          `[AgentHealth] 健康事件落库失败（${insert.kind}/${insert.event}）：${error instanceof Error ? error.message : String(error)}`
        );
      });
  };
}

/** 词表导出给 preload 类型声明用（那边按它收窄 event 入参，形状对齐 DAO 的 CHECK 约束）。 */
export type { PersistedAgentHealthEventKind };
