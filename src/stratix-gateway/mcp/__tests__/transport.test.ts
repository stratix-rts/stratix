/**
 * 文件职责：MCP 传输层的单测 —— HTTP 端点（POST /mcp）与 stdio 端点共享同一份 server。
 * 输入：真起一个 express 实例（随机端口）+ 一份 JSON-RPC 帧。
 * 输出：jest 断言。
 * 禁止事项：
 *   1. 不打桩传输 —— 这里要验的就是"帧进得来、帧出得去"；
 *   2. 不新增测试依赖（supertest 等）—— 用 node 自带的 http + fetch 足够。
 */

import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
import { Readable } from 'stream';

import { createMcpServer } from '../server';
import { startStdioMcpServer } from '../transport/stdio';
import { createMcpHttpRouter } from '../transport/http';
import type { McpHost } from '../types';

const host: McpHost = {
  getWorldState: () => ({
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    tasks: [],
  }),
  dispatchCommand: () => {
    throw new Error('测试里不该投递命令');
  },
};

describe('MCP 传输层', () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use('/mcp', createMcpHttpRouter(createMcpServer({ host })));
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}/mcp`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('POST /mcp 回 initialize 应答', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      jsonrpc: string;
      id: number;
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('stratix');
  });

  it('POST /mcp 的 tools/list 返回注册表里的工具（确定性顺序）', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });

    const body = (await response.json()) as { result: { tools: Array<{ name: string }> } };
    // 十一件工具，按清单位次（顺序写在工具自己的 order 字段里，与注册顺序无关）。
    expect(body.result.tools.map((tool) => tool.name)).toEqual([
      'stratix_world_snapshot',
      'stratix_task_assign',
      'stratix_task_status',
      'stratix_task_cancel',
      'stratix_mission_create',
      'stratix_mission_status',
      'stratix_mission_checkpoint',
      'stratix_chat_send',
      'stratix_registry',
      'stratix_session_list',
      'stratix_session_get',
    ]);
  });

  it('未知工具走 JSON-RPC error（参数级失败不进 isError 信封）', async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'stratix_not_exist', arguments: {} },
      }),
    });

    const body = (await response.json()) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(-32602);
  });

  it('GET /mcp 回 405（第一期不提供 SSE 推送端点）', async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(405);
  });

  it('stdio 与 HTTP 共用同一份 server：同一帧，两种传输给出同一结果', async () => {
    const lines: string[] = [];
    const output = {
      write: (chunk: string): boolean => {
        lines.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream;

    const stdioServer = createMcpServer({ host });
    const handle = startStdioMcpServer(stdioServer, {
      input: Readable.from([
        `${JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' })}\n`,
      ]) as unknown as NodeJS.ReadableStream,
      output,
      error: { write: (): boolean => true } as unknown as NodeJS.WritableStream,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));
    handle.close();

    const stdioBody = JSON.parse(lines.join('').trim()) as {
      result: { tools: Array<{ name: string }> };
    };
    const httpResponse = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }),
    });
    const httpBody = (await httpResponse.json()) as { result: { tools: Array<{ name: string }> } };

    expect(stdioBody.result.tools.map((tool) => tool.name)).toEqual(
      httpBody.result.tools.map((tool) => tool.name)
    );
  });
});
