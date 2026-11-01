#!/usr/bin/env node
/**
 * 文件职责：Stratix MCP server 的 **stdio 独立入口**（本机 MCP client 拉起的子进程）。
 * 输入：stdin 上的 JSON-RPC 帧（每行一帧）；命令行参数（--transport stdio）。
 * 输出：stdout 上的 JSON-RPC 响应帧；启动与错误信息一律走 stderr。
 * 禁止事项：
 *   1. 往 stdout 写任何非协议内容 —— stdout 是协议面，混进一行日志就会把 client 的帧解析搞崩；
 *   2. 在这里装配工具 —— 工具面只有一处（server.ts 的 DEFAULT_MCP_TOOLS + registry），
 *      本文件只负责"选传输 + 起服务"；
 *   3. 另起一份世界态 —— 本进程复用 core 的 worldStore 单例（context.ts），不自建真相源。
 */

import { createCoreMcpHost } from '../context';
import { createDefaultMcpServer } from '../server';
import { startStdioMcpServer } from '../transport/stdio';

/** 读 `--transport <值>` 形式的参数（缺省 stdio）。 */
function readTransportArg(argv: readonly string[]): string {
  const index = argv.indexOf('--transport');
  if (index === -1) return 'stdio';
  const value = argv[index + 1];
  return typeof value === 'string' && value.length > 0 ? value : 'stdio';
}

function main(): void {
  const transport = readTransportArg(process.argv.slice(2));
  if (transport !== 'stdio') {
    process.stderr.write(
      `[mcp] 不支持的传输「${transport}」：本入口只提供 stdio（HTTP 端点挂在 gateway 的 /mcp 上）\n`
    );
    process.exit(2);
  }

  const server = createDefaultMcpServer(createCoreMcpHost());
  const handle = startStdioMcpServer(server);
  process.stderr.write('[mcp] Stratix MCP server 已启动（stdio）\n');

  const shutdown = (): void => {
    handle.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
