/**
 * 单测：**与 stratix-gateway 的接口契约测试**。
 *
 * 为什么要单独一组：core/agent-link 的价值全在"能不能跟现网网关对上"。
 * 单测里用内存对端跑通 ≠ 真能连上网关 —— 中间隔着三件事：URL 拼装、REST 信封、WS 帧形状。
 * 本文件把这三件事对着现网实现（只读参考）逐条钉死：
 *   - REST：src/stratix-gateway/api/routes/openclaw.ts（/connect /ws-connect /disconnect /test）
 *           + src/stratix-core/utils/StratixRequestHelper.ts 的 { code, message, data, requestId } 信封
 *   - WS  ：src/stratix-openclaw-adapter/GatewayOpenClawAdapter.ts（地址与帧形状）
 * 一旦现网改协议，这里必须先红，而不是等到联调时才发现消息发不出去。
 */

import { buildWsUrl, GATEWAY_API_BASE } from '../protocol';
import { createHttpControlPlane, createWebSocketChannelFactory, createGatewayTransport } from '../gateway-transport';
import { createStore } from '../../store';
import { createAgentLinkManager } from '../manager';
import type { AgentLinkChannel } from '../transport';

// ============================================================================
// 假 HTTP：只按"网关会怎样回"作答，并记录请求供断言
// ============================================================================

interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

interface FetchStubOptions {
  /** 按路径给回包；未命中抛错（说明 agent-link 打错了路由）。 */
  readonly responses: Record<string, { status?: number; body: unknown }>;
}

function createFetchStub(options: FetchStubOptions): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.split('?')[0].replace(/^https?:\/\/[^/]+/, '');
    requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    const key = `${method} ${path}`;
    const hit = options.responses[key];
    if (!hit) throw new Error(`unexpected request: ${key}`);
    return {
      ok: (hit.status ?? 200) < 400,
      status: hit.status ?? 200,
      text: async (): Promise<string> => (typeof hit.body === 'string' ? hit.body : JSON.stringify(hit.body)),
    } as Response;
  }) as unknown as typeof fetch;

  return { fetchImpl, requests };
}

/** 网关信封：与 StratixRequestHelper.success/error 同构。 */
function envelope(code: number, message: string, data: unknown = null): unknown {
  return { code, message, data, requestId: `req_${Math.random().toString(36).slice(2, 8)}` };
}

describe('REST 控制面对齐网关路由', () => {
  const OK_RESPONSES = {
    'POST /api/stratix/openclaw/connect': {
      body: envelope(200, 'OpenClaw connection configured', {
        endpoint: 'http://127.0.0.1:18080',
        connected: true,
        proxyKey: 'http___127_0_0_1_18080',
      }),
    },
    'POST /api/stratix/openclaw/ws-connect': {
      body: envelope(200, 'Connected successfully', {
        endpoint: 'http://127.0.0.1:18080',
        connected: true,
        deviceId: 'device_1a2b3c',
      }),
    },
    'POST /api/stratix/openclaw/disconnect': { body: envelope(200, 'OpenClaw connection removed', { endpoint: 'x' }) },
  };

  test('connect() 依次打 /connect 与 /ws-connect，请求体字段与路由一致', async () => {
    const { fetchImpl, requests } = createFetchStub({ responses: OK_RESPONSES });
    const controlPlane = createHttpControlPlane({ baseUrl: 'http://127.0.0.1:3010', fetchImpl });

    const result = await controlPlane.connect({
      endpoint: 'http://127.0.0.1:18080',
      accountId: 'stratix',
      apiKey: 'sk-test',
    });

    expect(result).toEqual({ connected: true, proxyKey: 'http___127_0_0_1_18080', deviceId: 'device_1a2b3c' });
    expect(requests[0]).toMatchObject({
      url: 'http://127.0.0.1:3010/api/stratix/openclaw/connect',
      method: 'POST',
      body: { endpoint: 'http://127.0.0.1:18080', apiKey: 'sk-test' },
    });
    expect(requests[1]).toMatchObject({
      url: 'http://127.0.0.1:3010/api/stratix/openclaw/ws-connect',
      method: 'POST',
      body: { endpoint: 'http://127.0.0.1:18080', accountId: 'stratix', apiKey: 'sk-test' },
    });
  });

  test('accountId 缺省用 stratix（与 POST /ws-connect 的默认值一致）', async () => {
    const { fetchImpl, requests } = createFetchStub({ responses: OK_RESPONSES });
    const controlPlane = createHttpControlPlane({ fetchImpl });

    await controlPlane.connect({ endpoint: 'http://127.0.0.1:18080' });

    expect(requests[1].body).toMatchObject({ accountId: 'stratix' });
  });

  test('/connect 被拒（代理池满）时抛错，不假装连上', async () => {
    const { fetchImpl } = createFetchStub({
      responses: {
        'POST /api/stratix/openclaw/connect': { body: envelope(429, 'Maximum number of active proxies reached') },
      },
    });
    const controlPlane = createHttpControlPlane({ fetchImpl });

    await expect(controlPlane.connect({ endpoint: 'http://127.0.0.1:18080' })).rejects.toThrow(
      /Maximum number of active proxies reached/
    );
  });

  test('/ws-connect 握手失败时抛错（agent 不可达不该被吞掉）', async () => {
    const { fetchImpl } = createFetchStub({
      responses: {
        'POST /api/stratix/openclaw/connect': {
          body: envelope(200, 'configured', { endpoint: 'e', connected: true, proxyKey: 'k' }),
        },
        // 现网握手失败走 res.json(error(502,...))：HTTP 200 但信封 code=502
        'POST /api/stratix/openclaw/ws-connect': { body: envelope(502, 'Connection failed: ECONNREFUSED') },
      },
    });
    const controlPlane = createHttpControlPlane({ fetchImpl });

    await expect(controlPlane.connect({ endpoint: 'http://127.0.0.1:18080' })).rejects.toThrow(/ECONNREFUSED/);
  });

  test('/ws-connect 返回 404（旧网关没有该路由）时兼容放行，deviceId 留空', async () => {
    const { fetchImpl } = createFetchStub({
      responses: {
        'POST /api/stratix/openclaw/connect': {
          body: envelope(200, 'configured', { endpoint: 'e', connected: true, proxyKey: 'k' }),
        },
        'POST /api/stratix/openclaw/ws-connect': { status: 404, body: envelope(404, 'not found') },
      },
    });
    const controlPlane = createHttpControlPlane({ fetchImpl });

    await expect(controlPlane.connect({ endpoint: 'http://127.0.0.1:18080' })).resolves.toEqual({
      connected: true,
      proxyKey: 'k',
      deviceId: null,
    });
  });

  test('网关返回非 JSON（反代 502 HTML）时按传输错误处理', async () => {
    const { fetchImpl } = createFetchStub({
      responses: {
        'POST /api/stratix/openclaw/connect': { status: 502, body: '<html>bad gateway</html>' },
      },
    });
    const controlPlane = createHttpControlPlane({ fetchImpl });

    await expect(controlPlane.connect({ endpoint: 'http://127.0.0.1:18080' })).rejects.toThrow(
      /gateway \/connect failed: HTTP 502/
    );
  });

  test('disconnect() 打 /disconnect 且吞掉失败（尽力而为）', async () => {
    const { fetchImpl, requests } = createFetchStub({
      responses: {
        'POST /api/stratix/openclaw/disconnect': { body: envelope(200, 'removed', { endpoint: 'e' }) },
      },
    });
    const controlPlane = createHttpControlPlane({ fetchImpl });

    await controlPlane.disconnect('http://127.0.0.1:18080');
    expect(requests[0]).toMatchObject({
      url: expect.stringContaining(`${GATEWAY_API_BASE}/disconnect`),
      body: { endpoint: 'http://127.0.0.1:18080' },
    });

    const unreachable = createHttpControlPlane({
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof fetch,
    });
    await expect(unreachable.disconnect('http://127.0.0.1:18080')).resolves.toBeUndefined();
  });

  test('test() 打 /test 并把 apiKey 放 query（现网 GET 路由的读法）', async () => {
    const { fetchImpl, requests } = createFetchStub({
      responses: { 'GET /api/stratix/openclaw/test': { body: envelope(200, 'OpenClaw reachable') } },
    });
    const controlPlane = createHttpControlPlane({ baseUrl: 'http://127.0.0.1:3010', fetchImpl });

    await expect(controlPlane.test('http://127.0.0.1:18080', 'sk-test')).resolves.toEqual({
      ok: true,
      detail: 'OpenClaw reachable',
    });
    expect(requests[0].url).toBe(
      'http://127.0.0.1:3010/api/stratix/openclaw/test?endpoint=http%3A%2F%2F127.0.0.1%3A18080&apiKey=sk-test'
    );
  });
});

// ============================================================================
// WS 数据通道：地址、鉴权头、超时、关闭
// ============================================================================

interface LoopbackOptions {
  /** 不触发 onopen（模拟连不上）。 */
  readonly neverOpen?: boolean;
  /** onopen 前先触发 onerror（模拟握手失败）。 */
  readonly failBeforeOpen?: boolean;
}

interface LoopbackHandle {
  readonly urls: string[];
  readonly optionSets: unknown[];
  readonly received: string[];
  /** 让已打开的通道收到一帧。 */
  push(raw: string): void;
  /** 让对端主动断开（触发 onclose）。 */
  remoteClose(code?: number, reason?: string): void;
}

function createLoopbackWebSocket(options: LoopbackOptions = {}): { ctor: unknown; handle: LoopbackHandle } {
  const urls: string[] = [];
  const optionSets: unknown[] = [];
  const received: string[] = [];
  const openSockets: FakeSocket[] = [];

  class FakeSocket {
    onopen: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: { code?: number; reason?: string }) => void) | null = null;
    readyState = 0;

    constructor(url: string, protocolsOrOptions?: unknown) {
      urls.push(url);
      optionSets.push(protocolsOrOptions);
      queueMicrotask(() => {
        if (options.failBeforeOpen) {
          this.onerror?.({});
          return;
        }
        if (options.neverOpen) return; // 永远不 open：考验建链超时
        this.readyState = 1;
        this.onopen?.({});
      });
    }

    send(data: string): void {
      received.push(data);
    }

    close(code?: number, reason?: string): void {
      this.readyState = 3;
      queueMicrotask(() => this.onclose?.({ code: code ?? 1000, reason: reason ?? '' }));
    }
  }

  const handle: LoopbackHandle = {
    urls,
    optionSets,
    received,
    push: (raw: string): void => {
      openSockets.forEach((socket) => socket.onmessage?.({ data: raw }));
    },
    remoteClose: (code = 1011, reason = 'proxy lost'): void => {
      openSockets.forEach((socket) => socket.onclose?.({ code, reason }));
    },
  };

  // 登记已构造的实例，供 push / remoteClose 使用
  const OriginalCtor = FakeSocket;
  class Tracked extends OriginalCtor {
    constructor(url: string, protocolsOrOptions?: unknown) {
      super(url, protocolsOrOptions);
      openSockets.push(this as unknown as FakeSocket);
    }
  }

  return { ctor: Tracked, handle };
}

describe('WS 通道对齐网关代理地址', () => {
  test('连的是网关代理地址（/proxy/{proxyKey}/ws?clientId=…），不是 agent 直连地址', async () => {
    const { ctor, handle } = createLoopbackWebSocket();
    const openChannel = createWebSocketChannelFactory({
      baseUrl: 'http://127.0.0.1:3010',
      WebSocketImpl: ctor as never,
      isNode: true,
    });

    const channel = await openChannel({ endpoint: 'http://127.0.0.1:18080', accountId: 'stratix', timeoutMs: 200 });

    expect(handle.urls).toEqual([buildWsUrl('http://127.0.0.1:3010', 'http://127.0.0.1:18080', 'stratix')]);
    expect(handle.urls[0]).toContain(`${GATEWAY_API_BASE}/proxy/http___127_0_0_1_18080/ws`);
    expect(channel).toBeDefined();
  });

  test('Node 侧透传鉴权头（浏览器无法设 WS 头，故浏览器走 query 鉴权）', async () => {
    const { ctor, handle } = createLoopbackWebSocket();
    const openChannel = createWebSocketChannelFactory({
      baseUrl: 'http://127.0.0.1:3010',
      WebSocketImpl: ctor as never,
      isNode: true,
    });

    await openChannel({
      endpoint: 'http://127.0.0.1:18080',
      accountId: 'stratix',
      apiKey: 'sk-test',
      agentId: 'openclaw:writer',
      timeoutMs: 200,
    });

    expect(handle.optionSets[0]).toEqual({
      headers: { Authorization: 'Bearer sk-test', 'x-openclaw-agent-id': 'openclaw:writer' },
    });
  });

  test('浏览器模式不带自定义头（DOM WebSocket 只认 protocols，传对象会直接抛）', async () => {
    const { ctor, handle } = createLoopbackWebSocket();
    const openChannel = createWebSocketChannelFactory({
      baseUrl: '',
      WebSocketImpl: ctor as never,
      isNode: false,
    });

    await openChannel({ endpoint: 'http://127.0.0.1:18080', accountId: 'stratix', timeoutMs: 200 });

    expect(handle.optionSets[0]).toBeUndefined();
  });

  test('握手失败（onerror 先于 onopen）→ 建链被拒，错误带上网关地址', async () => {
    const { ctor } = createLoopbackWebSocket({ failBeforeOpen: true });
    const openChannel = createWebSocketChannelFactory({
      baseUrl: 'http://127.0.0.1:3010',
      WebSocketImpl: ctor as never,
      isNode: true,
    });

    await expect(openChannel({ endpoint: 'http://127.0.0.1:18080', timeoutMs: 200 })).rejects.toThrow(
      /websocket error while connecting to ws:\/\/127\.0\.0\.1:3010/
    );
  });

  test('一直没 open 的通道按建链超时收敛（不留悬挂 Promise）', async () => {
    const { ctor } = createLoopbackWebSocket({ neverOpen: true });
    const openChannel = createWebSocketChannelFactory({
      baseUrl: '',
      WebSocketImpl: ctor as never,
      isNode: true,
    });

    await expect(openChannel({ endpoint: 'http://127.0.0.1:18080', timeoutMs: 30 })).rejects.toThrow(
      /websocket open timeout after 30ms/
    );
  });

  test('关闭通道后订阅者立即收到 onClose，且退订函数不再重复通知', async () => {
    const { ctor } = createLoopbackWebSocket();
    const openChannel = createWebSocketChannelFactory({ baseUrl: '', WebSocketImpl: ctor as never, isNode: true });
    const channel: AgentLinkChannel = await openChannel({ endpoint: 'http://127.0.0.1:18080', timeoutMs: 200 });

    const closes: { code: number; reason: string }[] = [];
    const off = channel.onClose((info) => closes.push(info));
    channel.close(1000, 'bye');
    off();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(closes).toEqual([{ code: 1000, reason: 'bye' }]);
  });
});

// ============================================================================
// 端到端：REST 控制面 + WS 通道 + 会话状态机跑通一次完整握手与往返
// ============================================================================

describe('控制面 + 通道 + 会话端到端（对网关协议）', () => {
  test('开局 → 对话往返 → 断开 → 恢复，帧与请求全部符合网关协议', async () => {
    const { fetchImpl, requests } = createFetchStub({
      responses: {
        'POST /api/stratix/openclaw/connect': {
          body: envelope(200, 'configured', { endpoint: 'e', connected: true, proxyKey: 'k' }),
        },
        'POST /api/stratix/openclaw/ws-connect': {
          body: envelope(200, 'Connected successfully', { endpoint: 'e', connected: true, deviceId: 'device_1a2b3c' }),
        },
        'POST /api/stratix/openclaw/disconnect': { body: envelope(200, 'removed', { endpoint: 'e' }) },
      },
    });
    const { ctor, handle } = createLoopbackWebSocket();
    const transport = createGatewayTransport({
      baseUrl: 'http://127.0.0.1:3010',
      fetchImpl,
      WebSocketImpl: ctor as never,
      isNode: true,
    });
    const store = createStore();
    const manager = createAgentLinkManager({ transport, store, timing: { requestTimeoutMs: 100 } });

    // 1) 开局
    const view = await manager.open({ kind: 'openclaw', endpoint: 'http://127.0.0.1:18080', displayName: 'Writer' });
    expect(view.phase).toBe('connected');
    expect(view.agentId).toBe('device_1a2b3c');
    expect(handle.urls).toHaveLength(1);

    // 2) 对话：出站帧形状 + 入站应答解包
    const reply = manager.sendMessage(view.id, 'ping');
    const sentFrame = JSON.parse(handle.received[0]) as Record<string, unknown>;
    expect(sentFrame).toMatchObject({
      type: 'text',
      message: 'ping',
      payload: { sessionId: 'device_1a2b3c', agentId: 'device_1a2b3c' },
    });
    expect(typeof sentFrame.requestId).toBe('string');
    handle.push(
      JSON.stringify({ type: 'response', requestId: sentFrame.requestId as string, message: 'pong' })
    );
    await expect(reply).resolves.toBe('pong');
    expect(store.getState().messages.map((m) => m.text)).toEqual(['ping', 'pong']);

    // 3) 远端主动推送的消息与状态
    handle.push(JSON.stringify({ type: 'event', event: 'agent.message', payload: { text: '任务完成', author: 'writer' } }));
    handle.push(JSON.stringify({ type: 'event', event: 'agent.status', payload: { status: 'busy' } }));
    expect(store.getState().messages.map((m) => m.text)).toEqual(['ping', 'pong', '任务完成']);
    expect(store.getState().units).toEqual([]); // 没有对应单位就不造单位

    // 4) 关闭 → 销户请求真的打到了 /disconnect
    await manager.close(view.id);
    expect(requests.filter((r) => r.url.includes('/disconnect'))).toHaveLength(1);

    // 5) 恢复 → 新建通道，会话键（deviceId）沿用
    await manager.resume(view.id);
    expect(handle.urls).toHaveLength(2);
    expect(manager.get(view.id)?.phase).toBe('connected');
    expect(manager.get(view.id)?.sessionId).toBe('device_1a2b3c');

    await manager.dispose();
  });
});