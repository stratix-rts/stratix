/**
 * 文件职责：MCP 的 stdio 传输 —— 按行读 JSON-RPC 帧，按行写响应。
 * 输入：stdin 的文本流（每行一帧 JSON）+ 一个 McpServer 实例。
 * 输出：stdout 上的响应帧（每行一帧 JSON）；日志一律走 stderr。
 * 禁止事项：
 *   1. 往 stdout 写任何非协议内容 —— stdout 是协议面，混进一行日志就会把 client 的帧解析搞崩；
 *   2. 自己解析 JSON-RPC —— 协议语义全在 server.ts，传输层只做"读一行 → 交给 server → 写一行"；
 *   3. 攒批处理时无限缓存 —— 一行一帧，处理完即丢（上下文预算是硬约束）；
 *   4. 吞掉 stdin 的错误 —— 读流出错要写 stderr 并结束进程。
 */

import readline from 'readline';

import type { McpServer } from '../server';

export interface StdioServerOptions {
  /** 输入流（缺省 = process.stdin）。 */
  readonly input?: NodeJS.ReadableStream;
  /** 输出流（缺省 = process.stdout）。 */
  readonly output?: NodeJS.WritableStream;
  /** 日志流（缺省 = process.stderr）。 */
  readonly error?: NodeJS.WritableStream;
}

export interface StdioServerHandle {
  /** 关闭读循环（幂等）。 */
  close(): void;
}

/**
 * 起一个 stdio MCP server。
 * 一进程一 client：stdin 关闭即视为会话结束（调用 close 收尾）。
 */
export function startStdioMcpServer(
  server: McpServer,
  options: StdioServerOptions = {}
): StdioServerHandle {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const error = options.error ?? process.stderr;

  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let closed = false;

  const writeLine = (line: string): void => {
    output.write(`${line}\n`);
  };

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    void server
      .handleLine(trimmed)
      .then((response) => {
        if (response !== null) writeLine(response);
      })
      .catch((err: unknown) => {
        // 协议层已经兜住了绝大多数异常；到这里说明是传输/框架级问题 —— 记日志，不污染 stdout。
        error.write(`[mcp:stdio] 处理失败：${err instanceof Error ? err.message : String(err)}\n`);
      });
  });

  rl.on('close', () => {
    if (closed) return;
    closed = true;
    error.write('[mcp:stdio] 输入流已关闭，会话结束\n');
  });

  return {
    close: () => {
      if (closed) return;
      closed = true;
      rl.close();
    },
  };
}
