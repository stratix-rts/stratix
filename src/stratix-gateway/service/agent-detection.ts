/**
 * 文件职责：**service 进程内的本地 CLI agent 探测接线**（前后端分离 A4 / task_080）——
 *   探测本机装了哪些 CLI（claude / codex / kimi …），结果并入 WorldState.detectedAgents。
 * 输入：世界态持有者（CoreStore）+ 可选的执行器注入（单测用假 execFn）。
 * 输出：一个可停的探测句柄（逐条出结果 → 写 store）；已探到的结果快照。
 * 禁止事项：
 *   1. 自己写探测逻辑 —— 名单与判定口径只有一份，在 app/services/agent-detector.ts
 *      （渲染侧主进程与 service 侧共用同一份探测）；
 *   2. 在探测里 spawn 子进程 —— 命令执行一律经注入的 execFn（真实实现 = node-exec）；
 *   3. 阻塞启动 —— 探测逐条最坏 11×10s，**不得**挡住 boot：它在后台跑，
 *      结果边到边写 store（谁读状态谁看到最新快照）；
 *   4. 探测失败时假装「没装」以外的任何结论 —— 超时就是超时（status='timeout'），如实报。
 *
 * why 归 A4（接线单）：任务执行环的出队守门读 WorldState.detectedAgents（真相源 = store），
 *   渲染侧由主进程探测经 IPC 并入；service 进程里没有那条 IPC 链 ——
 *   不接探测，守门会判「该 CLI 未安装」并把任务直接 failed（如实失败，但不干活）。
 *   A2（task_078）把这条接线明确留给了 A4。
 *
 * @since v3.43（task_080 / service-split A4）。
 */

import { detectAllAgents, type ExecFn } from '../../app/services/agent-detector';
import { createNodeExec } from '../../app/services/node-exec';
import type { CoreStore } from '../../core/store';
import type { DetectedAgent } from '../../core/types';

/** 探测句柄（可停、可等）。 */
export interface ServiceAgentDetection {
  /** 已探到的结果（逐条累加，顺序 = 名单顺序）。 */
  readonly results: readonly DetectedAgent[];
  /** 等这一轮探测跑完（测试用；生产不 await —— 探测不该挡住 boot）。 */
  wait(): Promise<void>;
  /** 停止后续探测（已在跑的那条由它自己的超时兜底）。幂等。 */
  stop(): void;
}

/** 探测接线的参数。 */
export interface ServiceAgentDetectionOptions {
  /** 命令执行器（单测注入假 execFn；缺省 = node-exec 的真实实现）。 */
  readonly execFn?: ExecFn;
  /** 单项超时（ms）。缺省 = 检测器自身的缺省（10s）。 */
  readonly timeoutMs?: number;
  /** 日志口。缺省 = console.log（与检测器缺省同一口径）。 */
  readonly logger?: (line: string) => void;
}

/**
 * 起一轮后台探测，结果逐条并入 store。
 *
 * why 逐条写整份快照（而不是增量）：store 的 detectedAgents 语义是**整份替换**
 *   （core/store.ts 的 setDetectedAgents 注释）—— 读方不必自己拼两份真相。
 *   故这里维护一份累加表，每探到一条就把当前全量写回 store。
 */
export function startAgentDetection(
  store: CoreStore,
  options: ServiceAgentDetectionOptions = {}
): ServiceAgentDetection {
  const logger = options.logger ?? ((line: string): void => console.log(line));
  const execFn = options.execFn ?? createNodeExec();
  const controller = new AbortController();
  const results: DetectedAgent[] = [];

  const running = detectAllAgents({
    execFn,
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    signal: controller.signal,
    logger,
    onResult: (result) => {
      results.push(result);
      store.setDetectedAgents([...results]);
    },
  });

  return {
    get results(): readonly DetectedAgent[] {
      return results;
    },
    wait: async () => {
      await running;
    },
    stop: () => {
      controller.abort();
    },
  };
}
