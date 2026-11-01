/**
 * 测试辅助：假的 ProcessFactory —— 让传输层单测**不真调外部二进制**。
 * 做法与 agent-detector 的假 execFn 同源（注入桩），但这里更进一步：
 *   运行时能**逐行推** stdout / stderr，并且能观察 killTree 被调用了几次、用的什么信号。
 * 禁止事项：
 *   1. 在这里塞业务逻辑 —— 这是纯桩；
 *   2. 用它替代真机验证 —— 真机往返另有专门的测试（claude 真跑）。
 */

import type { CliProcessHandle, ProcessFactory } from '../../services/cli-transport/transport';

/** 可推可结束的异步行流。 */
export interface PushableStream {
  readonly stream: AsyncIterable<string>;
  push(line: string): void;
  end(): void;
  readonly ended: boolean;
}

function createPushableStream(): PushableStream {
  const queue: string[] = [];
  let ended = false;
  let waiter: (() => void) | null = null;

  const wake = (): void => {
    const resolve = waiter;
    waiter = null;
    resolve?.();
  };

  const stream: AsyncIterable<string> = {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      for (;;) {
        if (queue.length > 0) {
          yield queue.shift() as string;
          continue;
        }
        if (ended) return;
        await new Promise<void>((resolve) => {
          waiter = resolve;
        });
      }
    },
  };

  return {
    stream,
    push(line: string): void {
      queue.push(line);
      wake();
    },
    end(): void {
      ended = true;
      wake();
    },
    get ended(): boolean {
      return ended;
    },
  };
}

export interface FakeProcessCall {
  readonly command: string;
  readonly args: readonly string[];
}

export interface FakeProcessFactoryOptions {
  /** 自动喂的 stdout 行。 */
  readonly stdout?: readonly string[];
  /** 自动喂的 stderr 行。 */
  readonly stderr?: readonly string[];
  /** 自动退出码（缺省 0）。 */
  readonly exitCode?: number;
  /**
   * 是否喂完就自动收尾。
   * 缺省 true；传 false 时由测试自己控制（取消场景：进程一直不结束）。
   */
  readonly autoClose?: boolean;
}

export interface FakeProcessFactory {
  readonly factory: ProcessFactory;
  /** 每次拉起进程的记录（命令 + 参数）。 */
  readonly calls: FakeProcessCall[];
  /** killTree 被调用的记录（信号）。 */
  readonly kills: Array<NodeJS.Signals | undefined>;
  /** 推一行 stdout。 */
  pushStdout(line: string): void;
  /** 推一行 stderr。 */
  pushStderr(line: string): void;
  /** 结束进程（给退出码）。 */
  close(exitCode?: number): void;
}

/** 造一个假 ProcessFactory。 */
export function createFakeProcessFactory(
  options: FakeProcessFactoryOptions = {}
): FakeProcessFactory {
  const calls: FakeProcessCall[] = [];
  const kills: Array<NodeJS.Signals | undefined> = [];
  const stdout = createPushableStream();
  const stderr = createPushableStream();
  let resolveExit: (code: number) => void = () => { /* 占位 */ };
  let settled = false;
  const exit = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });

  const settle = (code: number): void => {
    if (settled) return;
    settled = true;
    resolveExit(code);
  };

  const factory: ProcessFactory = (command, args) => {
    calls.push({ command, args: [...args] });

    const handle: CliProcessHandle = {
      stdout: stdout.stream,
      stderr: stderr.stream,
      exit,
      killTree: (signal?: NodeJS.Signals): void => {
        kills.push(signal);
        // 真实实现里 killTree 会让进程退出 → stdout 结束、退出码落地。
        stdout.end();
        stderr.end();
        settle(143);
      },
    };

    if (options.autoClose !== false) {
      for (const line of options.stdout ?? []) stdout.push(line);
      for (const line of options.stderr ?? []) stderr.push(line);
      stdout.end();
      stderr.end();
      settle(options.exitCode ?? 0);
    }

    return handle;
  };

  return {
    factory,
    calls,
    kills,
    pushStdout: (line: string): void => stdout.push(line),
    pushStderr: (line: string): void => stderr.push(line),
    close: (exitCode = 0): void => {
      stdout.end();
      stderr.end();
      settle(exitCode);
    },
  };
}

/** 收集一个事件流的所有事件（便于断言序列）。 */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}
