/**
 * 文件职责：**角色对话的渲染层 IPC 桥**（task_035）—— 把 preload 暴露的 `electronAPI.cliChat`
 *   （回调推送）包成 chat-service 要的 ChatTransportPort（AsyncIterable<TransportEvent>）。
 *   why 需要它：渲染进程没有 child_process（nodeIntegration 关闭），子进程跑在 Electron 主进程，
 *   事件经 IPC 推回来（transport.ts 文件头「运行位置」约定的兑现）。
 * 输入：CliChatIpcApi（preload 的 cliChat 面；单测注入 fake）。
 * 输出：ChatTransportFactory —— 每种 agent 一个 transport，spawn() 产出的就是主进程跑的那轮事件流。
 * 禁止事项：
 *   1. import child_process / node-process / cli-transport 的实现文件 —— 本文件进渲染 bundle，
 *      只 import transport.ts 的纯类型；
 *   2. 在这里解释事件 —— 事件翻译在主进程侧的 adapter，这里只搬运；
 *   3. 引入新依赖。
 *
 * 事件到达顺序保证：preload 的 ipcRenderer.on 与主进程 webContents.send 都是 FIFO，
 *   队列只做「推→拉」的相位转换，不重排。
 *
 * @since v3.14（task_035）
 */

import type { AgentKind } from '../../core/types';
import type {
  SpawnOptions,
  TransportEvent,
} from './cli-transport/transport';
import type { ChatTransportFactory, ChatTransportPort } from './chat-service';

/** 一轮对话的 IPC 请求（渲染层造 runId，主进程按它路由事件与 abort）。 */
export interface CliChatRunRequest {
  readonly runId: string;
  readonly kind: AgentKind;
  readonly prompt: string;
  readonly sessionId?: string | null;
  readonly timeoutMs?: number;
}

/** 主进程 → 渲染层的事件信封：event 与 end 二选一出现（end = 本轮事件流到此为止）。 */
export interface CliChatEventEnvelope {
  readonly runId: string;
  readonly event?: TransportEvent;
  readonly end?: boolean;
}

/** preload 暴露的 cliChat 面（与 src/electron/preload.ts 的 ElectronAPI.cliChat 同构）。 */
export interface CliChatIpcApi {
  run(
    request: CliChatRunRequest,
    onEvent: (envelope: CliChatEventEnvelope) => void
  ): Promise<{ readonly ok: boolean; readonly error?: string }>;
  abort(runId: string): Promise<{ readonly ok: boolean }>;
}

/** 从 window.electronAPI 取 cliChat 面；非 Electron 环境（纯 vite dev / node 测试）没有它，返回 null。 */
export function cliChatIpcApi(): CliChatIpcApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { cliChat?: CliChatIpcApi } }).electronAPI;
  return api?.cliChat ?? null;
}

/**
 * 造 IPC 桥的 transport 工厂。
 * transport 按需缓存由 chat-service 负责（它拿同一个 kind 会拿到同一个实例）；
 * 这里每次调用返回**新**的 spawn 闭包集，但 runId 全局唯一计数，不冲突。
 */
export function createIpcChatTransportFactory(api: CliChatIpcApi): ChatTransportFactory {
  let runCounter = 0;
  return (kind: AgentKind): ChatTransportPort => ({
    spawn: (prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent> =>
      ipcRound(api, kind, prompt, options, () => {
        runCounter += 1;
        return `chatrun-${Date.now().toString(36)}-${runCounter}`;
      }),
  });
}

/**
 * 一轮 IPC 对话：invoke 发起 + 事件队列 + 逐个 yield。
 * 结束条件（三选一，先到先终结迭代器）：
 *   1. 主进程推来 end 信封（正常 done / error / 主进程异常都已转成事件推完再 end）；
 *   2. invoke 被拒（ok=false / 抛异常）→ 产一条 spawn_failed 错误事件后结束；
 *   3. 调用方提前退出 for-await（service 在 done/error 后 return）→ finally 摘 abort 监听，
 *      preload 侧监听等 end 信封到达后自摘（主进程 finally 必发 end，不会泄漏）。
 */
async function* ipcRound(
  api: CliChatIpcApi,
  kind: AgentKind,
  prompt: string,
  options: SpawnOptions | undefined,
  nextRunId: () => string
): AsyncGenerator<TransportEvent> {
  const runId = nextRunId();
  const queue: TransportEvent[] = [];
  let ended = false;
  let failure: string | null = null;
  let wake: (() => void) | null = null;

  const onAbort = (): void => {
    // 取消走主进程的 AbortController（runtime 在主进程侧 killTree）；
    // 失败不打断：主进程随后会推 error{aborted} + end，本迭代器自然收尾。
    void api.abort(runId).catch(() => { /* IPC 已断时超时兜底仍会结束 */ });
  };
  if (options?.signal) {
    if (options.signal.aborted) onAbort();
    else options.signal.addEventListener('abort', onAbort, { once: true });
  }

  const invokePromise = api
    .run(
      { runId, kind, prompt, sessionId: options?.sessionId ?? null, timeoutMs: options?.timeoutMs },
      (envelope) => {
        // 双保险过滤：preload 已按 runId 分发（见 preload.ts），但桥层不依赖对端自觉 ——
        // 并发轮次共享同一条 chat:event 通道，串进来的信封必须丢。
        if (envelope.runId !== runId) return;
        if (envelope.event) queue.push(envelope.event);
        if (envelope.end) ended = true;
        wake?.();
      }
    )
    .then((result) => {
      if (!result?.ok) {
        failure = result?.error ?? 'IPC 调用被拒';
        ended = true; // 被拒 = 不会再有任何事件
      }
      wake?.();
    })
    .catch((error: unknown) => {
      failure = error instanceof Error ? error.message : String(error);
      ended = true;
      wake?.();
    });

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift() as TransportEvent;
        continue;
      }
      if (failure !== null) {
        yield { type: 'error', message: `对话 IPC 通道失败：${failure}`, code: 'spawn_failed' };
        return;
      }
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
      wake = null;
    }
  } finally {
    if (options?.signal) options.signal.removeEventListener('abort', onAbort);
    // invoke 的 rejection 已在 then/catch 里消化，这里只为压 unhandled rejection 计数。
    void invokePromise;
  }
}
