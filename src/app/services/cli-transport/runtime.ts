/**
 * 文件职责：**传输运行时** —— 把「adapter（纯解析）」与「子进程（IO）」缝在一起，
 *   产出 `AsyncIterable<TransportEvent>`。进程生命周期（拉起 / 读行 / 取消 / 杀树 / 收尾）
 *   在这一层**统一实现一次**，各家 adapter 不重复实现。
 * 输入：一个 CliAdapter + 一个注入的 ProcessFactory + prompt / SpawnOptions。
 * 输出：事件流（见 transport.ts 的 TransportEvent 词汇表）。
 * 禁止事项：
 *   1. 在本文件里认识任何一家 CLI 的字段 —— 翻译一律交给 adapter.parseLine；
 *   2. 在本文件里 import child_process —— 子进程只经注入的 ProcessFactory；
 *   3. 吞掉错误 —— 失败必须以 error 事件出流（否则调用方会一直等一个永不来的 done）。
 *
 * 取消语义（AGENT-MATRIX「集成要点」第 5 条）：
 *   AbortSignal → 立刻 killTree（**整个进程树**）→ 流以 error{code:'aborted'} 收尾。
 *   超时走同一条路径，只是错误码是 timeout —— 两条路径的清理动作完全一样，不分叉。
 *
 * @since v3.8（task_023）
 */

import {
  stderrTail,
  type CliAdapter,
  type CliTransport,
  type ProcessFactory,
  type SpawnOptions,
  type TransportEvent,
} from './transport';

/** runtime 依赖。 */
export interface CliTransportDeps {
  /** 子进程工厂（真实实现 node-process.ts；单测注入假工厂）。 */
  readonly factory: ProcessFactory;
  /** 日志回调；缺省不打日志（单测里静默，真机调试时接 console）。 */
  readonly logger?: (line: string) => void;
}

/**
 * 造一个 CliTransport。
 * why adapter 与 runtime 分开：adapter 是纯函数（拼参数 + 解析一行），
 *   可以对着样例 JSONL 单测；runtime 只管进程生命周期，测一次就够。
 */
export function createCliTransport(adapter: CliAdapter, deps: CliTransportDeps): CliTransport {
  const logger = deps.logger ?? ((): void => { /* 默认静默 */ });

  async function* run(prompt: string, options: SpawnOptions): AsyncGenerator<TransportEvent> {
    // —— 准备（可失败：prepare 里做端口探测等）——
    let effective = options;
    if (adapter.prepare) {
      try {
        effective = await adapter.prepare(options);
      } catch (error) {
        yield {
          type: 'error',
          message: `准备阶段失败：${describe(error)}`,
          code: 'spawn_failed',
        };
        return;
      }
    }

    // —— 拉起子进程 ——
    let handle: ReturnType<ProcessFactory>;
    try {
      handle = deps.factory(adapter.binary, adapter.buildArgs(prompt, effective), {
        cwd: effective.cwd,
        env: effective.env,
      });
    } catch (error) {
      yield { type: 'error', message: `拉起 ${adapter.binary} 失败：${describe(error)}`, code: 'spawn_failed' };
      return;
    }

    // —— 状态 ——
    /**
     * 终止原因：取消与超时**共用同一条终止路径**（都是 killTree + 结束流），
     * 只有对外的错误码不同。故用个字段记原因，而不是两个布尔量（两个布尔量容易漏判：
     * 超时后进程非 0 退出，若先判「非 0 退出」就会把超时误报成 CLI 失败）。
     */
    let terminateReason: 'aborted' | 'timeout' | null = null;
    let lastText: string | null = null;
    let sessionId: string | null = effective.sessionId ?? null;
    /** 已经报过错就不要再补 done —— 「失败」与「正常结束」是两种语义，不能同时出现。 */
    let failed = false;

    /**
     * 记下会话 id；**重复的同一个 id 不再上送**。
     * why 去重：CLI 往往在**每一条**事件里都带着 session id（opencode 每条都带），
     *   照单全收会往聊天记录里灌几十条一模一样的「会话建立」消息。
     *   会话 id 变了才算新会话（这时才上送）。
     */
    const applySession = (id: string): boolean => {
      if (id === sessionId) return false;
      sessionId = id;
      return true;
    };

    const terminate = (reason: 'aborted' | 'timeout'): void => {
      terminateReason = reason;
      try {
        handle.killTree('SIGTERM');
      } catch (error) {
        logger(`[cli-transport] killTree 失败：${describe(error)}`);
      }
    };

    const onAbort = (): void => terminate('aborted');

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (effective.timeoutMs !== undefined && effective.timeoutMs > 0) {
      timer = setTimeout(() => terminate('timeout'), effective.timeoutMs);
    }

    if (effective.signal) {
      if (effective.signal.aborted) {
        terminate('aborted');
      } else {
        effective.signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    // stderr 单独收着：CLI 把日志写 stderr 是常态，只有在**失败**时才是有用信息。
    const stderrChunks: string[] = [];
    let stderrSize = 0;
    const stderrPump = (async (): Promise<void> => {
      for await (const line of handle.stderr) {
        if (stderrSize >= 64 * 1024) continue; // stderr 也要有界（perf：数据不许无限增长）
        stderrChunks.push(line);
        stderrSize += line.length + 1;
      }
    })();

    try {
      if (adapter.outputMode === 'jsonl') {
        for await (const line of handle.stdout) {
          if (line.trim().length === 0) continue;
          const events = safeParse(adapter, line, logger);
          for (const event of events) {
            if (event.type === 'message') lastText = event.text;
            if (event.type === 'session') {
              if (!applySession(event.sessionId)) continue; // 重复的会话 id 不重复上送
            }
            if (event.type === 'error') failed = true;
            yield event;
          }
        }
      } else {
        // 非 jsonl 模式：整段收下 stdout（纯文本回答 / 一个 pretty-print 的 JSON 文档）。
        // why 整段收：逐行上送会把一段回答拆成几十条聊天记录；
        //   而 pretty-print 的 JSON 逐行解必然失败（每行都不是完整 JSON）。
        const chunks: string[] = [];
        for await (const line of handle.stdout) {
          chunks.push(line);
        }
        const whole = chunks.join('\n').trim();
        if (whole.length > 0) {
          const events = safeParse(adapter, whole, logger);
          if (events.length > 0) {
            for (const event of events) {
              if (event.type === 'message') lastText = event.text;
              if (event.type === 'session') {
                if (!applySession(event.sessionId)) continue; // 重复的会话 id 不重复上送
              }
              if (event.type === 'error') failed = true;
              yield event;
            }
          } else if (adapter.outputMode === 'text') {
            // 解析不出来 = 这就是一段普通文本（kimi 的常态）—— 整段当一条消息。
            lastText = whole;
            yield { type: 'message', text: whole };
          } else {
            // json 模式却解析不出来：输出坏了，必须报错而不是假装没事。
            failed = true;
            yield { type: 'error', message: '无法解析 CLI 的 JSON 输出', code: 'cli_error' };
          }
        }
      }

      const exitCode = await handle.exit;

      if (terminateReason) {
        yield {
          type: 'error',
          message: terminateReason === 'timeout' ? '调用超时，已终止进程' : '调用被取消，已终止进程',
          code: terminateReason,
        };
        return;
      }

      if (exitCode !== 0) {
        const tail = stderrTail(stderrChunks.join('\n'));
        yield {
          type: 'error',
          message: tail.length > 0 ? tail : `${adapter.binary} 退出码 ${exitCode}`,
          code: 'nonzero_exit',
        };
        return;
      }

      if (failed) return; // 已经报过错（CLI 自报）—— 不再补 done
      yield { type: 'done', exitCode, text: lastText, sessionId };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (effective.signal) effective.signal.removeEventListener('abort', onAbort);
      await stderrPump.catch(() => { /* stderr 读失败不影响主流程 */ });
    }
  }

  return {
    kind: adapter.kind,
    binary: adapter.binary,
    buildArgs: (prompt, options) => adapter.buildArgs(prompt, options),
    spawn: (prompt, options) => run(prompt, options ?? {}),
  };
}

/**
 * 调 adapter 解析一行，**不让解析异常冒泡**。
 * why：单行脏数据（半行 JSON / 厂商塞的裸文本）不该让整轮对话失败 ——
 *   跳过这一行继续读；真出错（CLI 自报错误）由 adapter 解析成 error 事件上报。
 */
function safeParse(
  adapter: CliAdapter,
  line: string,
  logger: (line: string) => void
): readonly TransportEvent[] {
  try {
    return adapter.parseLine(line);
  } catch (error) {
    logger(`[cli-transport] ${adapter.kind} 解析失败：${describe(error)}`);
    return [];
  }
}

/** 把任意异常转成一句话。 */
function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
