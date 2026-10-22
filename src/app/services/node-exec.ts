/**
 * 文件职责：检测器用的**真实**命令执行器 —— 把 ExecFn 契约落到本机进程上（child_process）。
 *   检测逻辑（agent-detector.ts）不认识 child_process：它只认注入的 execFn，
 *   这样单测能注入假 execFn 覆盖「已装 / 未装 / 超时」三态，不必真调外部二进制。
 *   本文件是生产环境的那个「真 execFn」，只被 Node 侧（Electron 主进程 / 脚本）引用。
 * 输入：命令 + 参数 + 超时（来自检测器）。
 * 输出：ExecOutcome（退出码 + stdout + stderr + 超时标记）。
 * 禁止事项：
 *   1. 在这里做业务判断（装没装 / 版本是什么）—— 那是 agent-detector.ts 的职责；
 *   2. 抛异常表示「命令没找到」—— 命令找不到是**正常结果**（退出码非 0），不是异常；
 *      抛异常会把"没装"误判成"探测失败"；
 *   3. 无限超时 —— 超时必须 kill 子进程（否则一个卡住的 CLI 会一直挂着，白占一个进程）。
 *
 * why 默认走 execFile（不经过 shell）：命令与参数都是固定名单里的字面量，
 *   走 shell 只会多一层转义与注入面；execFile 由 libuv 直接 execvp，PATH 查找照常生效。
 *   win32 例外：npm 装出来的 CLI 常是 .cmd 包装器，不经 shell 的 spawn 会被 Node 拒绝
 *   （CVE-2024-27980 的加固），故 win32 退回 shell 路径（参数逐个加引号）。
 *
 * @since v3.8（task_022）
 */

import { exec as execCallback, execFile as execFileCallback } from 'child_process';

import type { ExecFn, ExecOutcome } from './agent-detector';

export interface NodeExecOptions {
  /** 单次输出上限（bytes）；默认 1MB（版本输出很小，但 CLI 报错时可能刷一堆日志）。 */
  readonly maxBuffer?: number;
  /** 工作目录；缺省继承当前进程。 */
  readonly cwd?: string;
  /** 平台覆盖（测试用；缺省取当前进程平台）。 */
  readonly platform?: NodeJS.Platform;
}

/** cmd.exe 的参数转义：整体加双引号，内部双引号翻倍。 */
function quoteForCmd(arg: string): string {
  return `"${arg.replace(/"/g, '""')}"`;
}

/** 子进程错误的结构化字段（exec / execFile 的错误类型不同，字段一致）。 */
type ExecErrorLike = (Error & {
  code?: number | string | null;
  killed?: boolean;
  signal?: string | null;
}) | null;

/**
 * 造一个基于 child_process 的 ExecFn。
 * why 用 exec/execFile（而非 spawn）：探测只需要「跑一条命令 → 拿输出 → 看退出码」，
 * 这层封装已经带好 timeout + kill 语义。
 */
export function createNodeExec(options: NodeExecOptions = {}): ExecFn {
  const maxBuffer = options.maxBuffer ?? 1024 * 1024;
  const platform = options.platform ?? process.platform;
  const useShell = platform === 'win32';

  return (command, args, { timeoutMs }) =>
    new Promise<ExecOutcome>((resolve) => {
      const execOptions = {
        timeout: timeoutMs,
        maxBuffer,
        cwd: options.cwd,
        // 不弹窗：CLI 报错时不该在 GUI 里开一个终端窗口（Windows 上尤其明显）。
        windowsHide: true,
      };
      const settle = (error: ExecErrorLike, stdout: string, stderr: string): void => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        // 超时：exec/execFile 内部 kill 掉子进程后回调，error.killed 为 true。
        // 必须单独标出来 —— 超时的退出码（143 / -1）与"命令不存在"的 127 长得不一样，
        // 但两者都不是 0；上层要区分「超时」和「没装」。
        const killed = error.killed === true;
        const signal = error.signal ?? null;
        const code = typeof error.code === 'number' ? error.code : killed || signal ? -1 : 127;
        resolve({ code, stdout, stderr, timedOut: killed });
      };

      if (useShell) {
        const line = [command, ...args].map(quoteForCmd).join(' ');
        execCallback(line, execOptions, (error, stdout, stderr) => settle(error, stdout, stderr));
        return;
      }
      execFileCallback(
        command,
        [...args],
        execOptions,
        (error, stdout, stderr) => settle(error, stdout, stderr)
      );
    });
}
