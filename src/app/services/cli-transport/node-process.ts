/**
 * 文件职责：传输层的**真实**子进程工厂 —— 把 ProcessFactory 契约落到本机进程上（child_process）。
 *   传输逻辑（runtime.ts）不认识 child_process：它只认注入的 ProcessFactory，
 *   这样单测能注入假工厂喂样例 JSONL，不必真调外部二进制。
 *   本文件是生产环境的那个「真工厂」，只被 Node 侧（Electron 主进程 / 脚本）引用。
 * 输入：命令 + 参数（+ 可选 cwd / env）。
 * 输出：CliProcessHandle（stdout/stderr 逐行 + 退出码 + killTree）。
 * 禁止事项：
 *   1. 在这里做业务判断（这行是什么意思）—— 那是 adapters/ 的职责；
 *   2. 只 kill 直接子进程 —— 必须杀**整棵树**（见下）；
 *   3. 引入新依赖 —— 杀树用 Node 内置能力实现（POSIX 进程组 / Windows taskkill）。
 *
 * 杀树怎么做的（为什么不引第三方 tree-kill 包）：
 *   POSIX：spawn 时 `detached: true` 让子进程**自成一个进程组组长**，
 *          之后 `process.kill(-pid, signal)` 一发就把**组里所有进程**（含孙进程）一起收掉。
 *          句柄上的 kill() 只杀组长是不够的 —— CLI 自己拉的 bash / 工具进程会变孤儿继续跑。
 *   Windows：进程组那套不管用，改用系统自带的 `taskkill /pid <pid> /T /F`（/T = 连子进程）。
 *   两者都失败时兜底：至少 child.kill() 杀直接子进程（总比不杀强）。
 *
 * @since v3.8（task_023）
 */

import { execFile, spawn, type ChildProcessByStdio } from 'child_process';
import type { Readable } from 'stream';

import type { CliProcessHandle, ProcessFactory } from './transport';

export interface NodeProcessFactoryOptions {
  /** 工作目录；缺省继承当前进程。 */
  readonly cwd?: string;
  /** 追加的环境变量（不覆盖既有环境）。 */
  readonly env?: Readonly<Record<string, string>>;
  /** 平台覆盖（测试用；缺省取当前进程平台）。 */
  readonly platform?: NodeJS.Platform;
}

/**
 * 把一个可读流切成「逐行」异步迭代。
 * why 自己切而不用 readline 的一个坑：readline 在流结束时**不保证吐出最后一行**
 *   （没有换行符结尾的最后一行会被丢掉）—— CLI 的最后一行 JSON 往往就是结果事件，丢了就白跑。
 *   故自己维护半行缓冲。
 */
function lineIterator(stream: NodeJS.ReadableStream): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<string> {
      let buffer = '';
      for await (const chunk of stream) {
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
        let index = buffer.indexOf('\n');
        while (index !== -1) {
          const line = buffer.slice(0, index).replace(/\r$/, '');
          buffer = buffer.slice(index + 1);
          yield line;
          index = buffer.indexOf('\n');
        }
      }
      // 收尾：把没换行结尾的最后一行交出去（readline 会丢它）。
      if (buffer.length > 0) yield buffer.replace(/\r$/, '');
    },
  };
}

/** 造一个基于 child_process 的 ProcessFactory。 */
export function createNodeProcessFactory(options: NodeProcessFactoryOptions = {}): ProcessFactory {
  const platform = options.platform ?? process.platform;
  const env = options.env ? { ...process.env, ...options.env } : process.env;

  return (command, args, spawnOptions) => {
    const child = spawn(command, [...args], {
      cwd: spawnOptions.cwd ?? options.cwd,
      env: spawnOptions.env ? { ...env, ...spawnOptions.env } : env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      // POSIX：让子进程自成一个进程组组长 —— killTree 才能一发收掉整棵树。
      detached: platform !== 'win32',
    }) as ChildProcessByStdio<null, Readable, Readable>;

    // 拉不起来（binary 不存在）时 spawn 会异步报 'error'。
    // 把错误文案塞进 stderr 流：runtime 在非 0 退出时用 stderr 尾巴当错误信息，
    // 这样调用方能看到「spawn claude ENOENT」而不是一个干巴巴的退出码。
    const spawnErrorLines: string[] = [];
    child.once('error', (error: Error) => {
      spawnErrorLines.push(`spawn ${command} 失败：${error.message}`);
    });

    const exit = new Promise<number>((resolve) => {
      child.once('close', (code) => resolve(typeof code === 'number' ? code : 1));
      // error（ENOENT 等）也会走到 close，但 code 为 null —— 上面的兜底给 1。
    });

    const stderrStream = lineIterator(child.stderr);

    const handle: CliProcessHandle = {
      stdout: lineIterator(child.stdout),
      stderr: {
        async *[Symbol.asyncIterator](): AsyncIterator<string> {
          for (const line of spawnErrorLines) yield line;
          yield* stderrStream;
        },
      },
      exit,
      killTree: (signal: NodeJS.Signals = 'SIGTERM') => killTree(child, signal, platform),
    };

    return handle;
  };
}

/**
 * 终止整个进程树。
 * @param child 直接子进程
 * @param signal 信号（POSIX 用；Windows taskkill 走 /F 强杀）
 * @param platform 平台覆盖（测试用）
 */
export function killTree(
  child: { pid?: number; kill(signal?: NodeJS.Signals | number): boolean },
  signal: NodeJS.Signals = 'SIGTERM',
  platform: NodeJS.Platform = process.platform
): void {
  const pid = child.pid;
  if (typeof pid !== 'number' || pid <= 0) {
    // 没有 pid（进程还没起来就结束了）：没什么可杀的。
    return;
  }

  if (platform === 'win32') {
    // Windows 没有 POSIX 进程组那套；用系统自带的 taskkill /T（连子进程一起）。
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], () => {
      // taskkill 失败也不抛：兜底杀直接子进程。
      try {
        child.kill(signal);
      } catch {
        // 进程可能已经没了 —— 忽略。
      }
    });
    return;
  }

  // POSIX：杀**进程组**（负 pid）= 子进程 + 它拉出来的所有孙进程。
  try {
    process.kill(-pid, signal);
  } catch {
    // 进程组可能已经退出（ESRCH）—— 退回到只杀直接子进程。
    try {
      child.kill(signal);
    } catch {
      // 已经死了 —— 忽略。
    }
  }
}
