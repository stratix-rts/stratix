/**
 * 文件职责：MCP **传输层错误信封**的单测 —— 任何失败都必须长成 JSON-RPC 帧，绝不漏裸 500。
 * 输入：真起一个 express 实例（随机端口）+ 畸形 / 越界 / 缺参 / 崩溃的请求。
 * 输出：jest 断言（帧的形状 + 错误码）。
 * 禁止事项：
 *   1. 不打桩传输 —— 这里要验的就是"帧进得来、错误出得去"，故走真的 express + fetch；
 *   2. 不新增测试依赖（supertest 等）—— node 自带的 fetch 足够；
 *   3. 不在这里断言工具的业务语义 —— 那是各工具自己的用例；本文件只管**信封**。
 */

import express, { type Express } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { buildToolRegistry } from '../registry';
import { createMcpServer } from '../server';
import { createMcpHttpRouter } from '../transport/http';
import type { McpHost, ToolSpec } from '../types';

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

/** 一个"故意崩溃"的工具：抛的不是 McpToolError（= 未捕获异常）。 */
const crashingTool: ToolSpec = {
  name: 'stratix_test_crash',
  domain: 'test',
  verb: 'crash',
  order: 1,
  description: '测试用：故意抛一个未捕获异常。',
  inputSchema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  errors: ['internal_error'],
  readOnly: true,
  handler: () => {
    throw new TypeError('模拟工具内部崩溃');
  },
};

interface JsonRpcFrame {
  jsonrpc: string;
  id: string | number | null;
  result?: {
    isError?: boolean;
    structuredContent?: {
      ok: boolean;
      error?: { code: string; message: string; retryable: boolean; hint: string };
    };
  };
  error?: { code: number; message: string; data?: Record<string, unknown> };
}

/** app 级错误处理器（与 src/stratix-gateway/index.ts 同款：裸 500）。 */
function bareErrorHandler(
  err: unknown,
  _req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ code: 500, message: 'Internal server error', data: null });
}

/**
 * 起一个 express 实例，按**生产装配的位次**挂 MCP 路由（/mcp 在全局 body 解析器**之前**）。
 * 位次是硬约束：全局解析器若先解析，畸形 JSON 的错误会跳过 /mcp 路由 → 漏裸 500。
 */
async function startApp(build: (app: Express) => void): Promise<{ url: string; server: Server }> {
  const app = express();
  build(app);
  const server = await new Promise<Server>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/mcp`, server };
}

describe('MCP 错误信封（传输层）', () => {
  let server: Server;
  let url: string;
  let crashServer: Server;
  let crashUrl: string;

  beforeAll(async () => {
    const started = await startApp((app) => {
      app.use('/mcp', createMcpHttpRouter(createMcpServer({ host })));
      app.use(express.json({ limit: '5mb' }));
      app.use(bareErrorHandler);
    });
    server = started.server;
    url = started.url;

    const crashStarted = await startApp((app) => {
      app.use(
        '/mcp',
        createMcpHttpRouter(
          createMcpServer({ host, registry: buildToolRegistry([crashingTool]) })
        )
      );
      app.use(express.json({ limit: '5mb' }));
      app.use(bareErrorHandler);
    });
    crashServer = crashStarted.server;
    crashUrl = crashStarted.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => crashServer.close(() => resolve()));
  });

  it('畸形 JSON（截断请求体）→ JSON-RPC -32700 帧（id=null），不是裸 500', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":',
    });

    const body = (await response.json()) as JsonRpcFrame;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBeNull();
    expect(body.error?.code).toBe(-32700);
    // 关键断言：不得出现宿主框架的裸错误体。
    expect(body).not.toHaveProperty('code', 500);
    expect(body).not.toHaveProperty('requestId');
  });

  it('合法 JSON 但不是 JSON-RPC 帧 → -32600', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"hello":"world"}',
    });

    const body = (await response.json()) as JsonRpcFrame;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error?.code).toBe(-32600);
    expect(body).not.toHaveProperty('code', 500);
  });

  it('合法请求缺必填参数（task_assign 缺 prompt）→ 稳定回 invalid_arguments 业务信封', async () => {
    const frame = {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'stratix_task_assign', arguments: { character: 'x' } },
    };

    // 连打三次：失败路径必须稳定（agent 要据此决定重试与否）。
    for (const _attempt of [1, 2, 3]) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(frame),
      });
      const body = (await response.json()) as JsonRpcFrame;
      expect(body.result?.isError).toBe(true);
      expect(body.result?.structuredContent?.error?.code).toBe('invalid_arguments');
      expect(body.result?.structuredContent?.error?.retryable).toBe(false);
      expect(body).not.toHaveProperty('error');
      expect(body).not.toHaveProperty('code', 500);
    }
  });

  it('工具抛未捕获异常 → JSON-RPC -32603（不冒充业务失败信封）', async () => {
    const response = await fetch(crashUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'stratix_test_crash', arguments: {} },
      }),
    });

    const body = (await response.json()) as JsonRpcFrame;
    expect(body.error?.code).toBe(-32603);
    expect(body.result).toBeUndefined();
    expect(body).not.toHaveProperty('code', 500);
  });

  it('GET /mcp → 405 + JSON-RPC 帧（不是裸 500）', async () => {
    const response = await fetch(url);
    expect(response.status).toBe(405);
    const body = (await response.json()) as JsonRpcFrame;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.error?.code).toBe(-32600);
  });
});

describe('MCP 错误信封（挂载位次是硬约束）', () => {
  it('/mcp 挂在全局 body 解析器**之后** → 畸形 JSON 漏成裸 500（故生产装配必须挂前面）', async () => {
    const { url, server } = await startApp((app) => {
      // 故意装错：全局解析器在前。
      app.use(express.json({ limit: '5mb' }));
      app.use('/mcp', createMcpHttpRouter(createMcpServer({ host })));
      app.use(bareErrorHandler);
    });

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":',
      });
      const body = (await response.json()) as { code?: number };
      // 这条用例锁住的是**约束**：装错位次就会漏裸 500 —— 生产装配（src/stratix-gateway/index.ts）
      // 必须把 /mcp 挂在全局 express.json() 之前，否则畸形 JSON 绕过 MCP 路由。
      expect(body.code).toBe(500);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('MCP 错误信封（stdio 侧同款）', () => {
  it('畸形 JSON 帧 → -32700（stdio 与 HTTP 共用同一份 server，行为必须一致）', async () => {
    const mcpServer = createMcpServer({ host });
    const raw = await mcpServer.handleLine('{"jsonrpc":"2.0","id":1,"method":');
    expect(raw).not.toBeNull();
    const body = JSON.parse(raw as string) as JsonRpcFrame;
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBeNull();
    expect(body.error?.code).toBe(-32700);
  });
});

/**
 * 错误文案必须与**真实触发条件**一一对应（task_132 / N3）。
 * why 单开一块：分型（哪个错误码）由 task_118 锁住；本块锁的是**文案说的原因** ——
 * 文案说错，agent 的排障方向就被带偏（复测报告里的原话）。
 */
describe('MCP 错误文案与事实对齐（task_132 / N3）', () => {
  let server: Server;
  let url: string;

  beforeAll(async () => {
    const started = await startApp((app) => {
      app.use('/mcp', createMcpHttpRouter(createMcpServer({ host })));
      app.use(express.json({ limit: '5mb' }));
      app.use(bareErrorHandler);
    });
    server = started.server;
    url = started.url;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** POST 一帧，返回错误帧（失败路径专用）。 */
  async function postError(
    body: string | Uint8Array,
    headers: Record<string, string>
  ): Promise<JsonRpcFrame> {
    const response = await fetch(url, { method: 'POST', headers, body: body as BodyInit });
    const parsed = (await response.json()) as JsonRpcFrame;
    expect(response.status).toBe(200);
    expect(parsed.error).toBeDefined();
    return parsed;
  }

  const validFrame = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });

  it('Content-Type 不是 application/json → 说的是 Content-Type，不是「帧不合法」', async () => {
    const frame = await postError(validFrame, { 'content-type': 'text/plain' });

    expect(frame.error?.code).toBe(-32600);
    // 真实原因：帧本身是合法的 JSON-RPC，被拒是因为 Content-Type。
    expect(frame.error?.message).toContain('Content-Type');
    expect(frame.error?.message).toContain('application/json');
    expect(frame.error?.message).not.toContain('帧不是合法');
    expect(frame.error?.data?.received_content_type).toBe('text/plain');
    expect(frame.error?.data?.expected_content_type).toBe('application/json');
    expect(typeof frame.error?.data?.hint).toBe('string');
  });

  it('缺 Content-Type 头 → 说的是缺 Content-Type', async () => {
    const frame = await postError(new TextEncoder().encode(validFrame), {});

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('Content-Type');
    expect(frame.error?.data?.received_content_type).toBeNull();
  });

  it('请求体为空 → 说的是「空」，received 是 empty（不是 object）', async () => {
    const frame = await postError('', { 'content-type': 'application/json' });

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('空');
    expect(frame.error?.data?.received).toBe('empty');
  });

  it('请求体是 JSON 数组 → 说的是「数组」，received 是 array（不是 object）', async () => {
    const frame = await postError(`[${validFrame}]`, { 'content-type': 'application/json' });

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('数组');
    expect(frame.error?.data?.received).toBe('array');
  });

  it('合法 JSON 但不是 JSON-RPC 帧 → 说清是哪个字段不对', async () => {
    const frame = await postError('{"hello":"world"}', { 'content-type': 'application/json' });

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('jsonrpc');
    expect(frame.error?.data?.received).toBe('object');
    expect(typeof frame.error?.data?.reason).toBe('string');
  });

  it('畸形 JSON → -32700，说的是「不是合法 JSON」', async () => {
    const frame = await postError('{"jsonrpc":"2.0","id":1,"method":', {
      'content-type': 'application/json',
    });

    expect(frame.error?.code).toBe(-32700);
    expect(frame.error?.message).toContain('JSON');
    expect(typeof frame.error?.data?.hint).toBe('string');
  });

  it('请求体超上限 → -32600，说的是「超过 1mb 上限」', async () => {
    const huge = `{"jsonrpc":"2.0","id":1,"method":"ping","params":{"x":"${'a'.repeat(1024 * 1024 + 64)}"}}`;
    const frame = await postError(huge, { 'content-type': 'application/json' });

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('1mb');
  });

  it('裸标量 body（123）→ -32700，但说的是「顶层形状不对」而不是「不是合法 JSON」', async () => {
    const frame = await postError('123', { 'content-type': 'application/json' });

    expect(frame.error?.code).toBe(-32700);
    // `123` **是**合法 JSON —— 说成"不是合法 JSON"就是把事实说反了。
    expect(frame.error?.message).toContain('顶层');
    expect(frame.error?.message).not.toContain('不是合法 JSON');
  });

  it('缺 method 字段 → -32600，说清缺的是 method', async () => {
    const frame = await postError('{"jsonrpc":"2.0","id":1}', { 'content-type': 'application/json' });

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('method');
  });

  it('Accept 头点名了别的类型 → -32600，说的是 Accept（不是"帧不合法"）', async () => {
    const frame = await postError(validFrame, {
      'content-type': 'application/json',
      accept: 'text/plain',
    });

    expect(frame.error?.code).toBe(-32600);
    expect(frame.error?.message).toContain('Accept');
    expect(frame.error?.data?.received_accept).toBe('text/plain');
  });

  it('Accept 头含 application/json（或缺省）→ 正常放行', async () => {
    for (const accept of ['application/json', 'application/json, text/event-stream', '*/*']) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept },
        body: validFrame,
      });
      const frame = (await response.json()) as JsonRpcFrame;
      expect(frame.error).toBeUndefined();
      expect(frame.result).toBeDefined();
    }

    // 缺 Accept（简单客户端常省）也放行。
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: validFrame,
    });
    const frame = (await response.json()) as JsonRpcFrame;
    expect(frame.error).toBeUndefined();
  });

  it('未知方法 → -32601，并说清有哪些方法可用', async () => {
    const frame = await postError(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/frobnicate' }),
      { 'content-type': 'application/json' }
    );

    expect(frame.error?.code).toBe(-32601);
    expect(frame.error?.message).toContain('未知方法');
    expect(String(frame.error?.data?.hint)).toContain('tools/list');
  });

  it('未知工具 → -32602，并指向 tools/list', async () => {
    const frame = await postError(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'stratix_not_exist', arguments: {} },
      }),
      { 'content-type': 'application/json' }
    );

    expect(frame.error?.code).toBe(-32602);
    expect(frame.error?.message).toContain('未知工具');
    expect(String(frame.error?.data?.hint)).toContain('tools/list');
  });

  it('缺工具名 → -32602，并指向 tools/list', async () => {
    const frame = await postError(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }),
      { 'content-type': 'application/json' }
    );

    expect(frame.error?.code).toBe(-32602);
    expect(frame.error?.message).toContain('缺少工具名');
    expect(String(frame.error?.data?.hint)).toContain('tools/list');
  });

  it('参数缺失（工具层）→ invalid_arguments 信封，说清缺哪个参数', async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'stratix_task_assign', arguments: { character: 'x' } },
      }),
    });
    const frame = (await response.json()) as JsonRpcFrame;

    expect(frame.result?.isError).toBe(true);
    expect(frame.result?.structuredContent?.error?.code).toBe('invalid_arguments');
    expect(frame.result?.structuredContent?.error?.message).toContain('prompt');
    expect(frame.result?.structuredContent?.error?.hint).toContain('prompt');
  });

  it('stdio 侧畸形 JSON 的文案同样说清是「不是合法 JSON」', async () => {
    const mcpServer = createMcpServer({ host });
    const raw = await mcpServer.handleLine('{"jsonrpc":');
    const frame = JSON.parse(raw as string) as JsonRpcFrame;

    expect(frame.error?.code).toBe(-32700);
    expect(frame.error?.message).toContain('JSON');
  });
});
