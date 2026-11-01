/**
 * 集成测试：角色对话 IPC 桥（app/services/chat-transport-bridge.ts，task_035）。
 * preload 的回调推送 → AsyncIterable 的转换面：事件顺序、end 收尾、invoke 被拒降级、abort 路由。
 * （主进程侧的 chat:run handler 需要 electron 运行时，不进 jest —— 那层由真机冒烟覆盖。）
 */

import type { TransportEvent } from '../services/cli-transport/transport';
import {
  cliChatIpcApi,
  createIpcChatTransportFactory,
  type CliChatEventEnvelope,
  type CliChatIpcApi,
  type CliChatRunRequest,
} from '../services/chat-transport-bridge';

/** 回调推送型 fake：测试里手动推信封，模拟主进程 webContents.send。 */
interface FakeChannel {
  readonly api: CliChatIpcApi;
  /** invoke('chat:run') 收到的请求（含校验后的形状）。 */
  readonly requests: CliChatRunRequest[];
  readonly aborted: string[];
  push(envelope: CliChatEventEnvelope): void;
  resolveInvoke(ok: boolean, error?: string): void;
}

function makeFakeChannel(): FakeChannel {
  const requests: CliChatRunRequest[] = [];
  const aborted: string[] = [];
  let listeners: Array<(envelope: CliChatEventEnvelope) => void> = [];
  let invokeResult: { ok: boolean; error?: string } = { ok: true };

  const api: CliChatIpcApi = {
    async run(request, onEvent): Promise<{ ok: boolean; error?: string }> {
      requests.push(request);
      listeners.push(onEvent);
      return invokeResult;
    },
    async abort(runId): Promise<{ ok: boolean }> {
      aborted.push(runId);
      return { ok: true };
    },
  };

  return {
    api,
    requests,
    aborted,
    push(envelope): void {
      listeners.forEach((listener) => listener(envelope));
    },
    resolveInvoke(ok, error): void {
      invokeResult = { ok, error };
      if (!ok) {
        listeners = [];
      }
    },
  };
}

describe('IPC 桥：回调推送 → AsyncIterable', () => {
  test('事件按到达顺序 yield；end 信封结束迭代（不再多吐）', async () => {
    const channel = makeFakeChannel();
    const transport = createIpcChatTransportFactory(channel.api)('claude-code');

    const collected: TransportEvent[] = [];
    const consuming = (async (): Promise<void> => {
      for await (const event of transport.spawn('回复 pong', { sessionId: null, timeoutMs: 60_000 })) {
        collected.push(event);
      }
    })();

    await Promise.resolve(); // 让 ipcRound 跑到 await（invoke 已 resolve，onEvent 已挂上）
    const runId = channel.requests[0]?.runId;
    expect(runId).toBeTruthy();

    channel.push({ runId, event: { type: 'session', sessionId: 'sess-1' } });
    channel.push({ runId, event: { type: 'message', text: 'pong' } });
    channel.push({ runId, event: { type: 'done', exitCode: 0, text: 'pong', sessionId: null } });
    channel.push({ runId, end: true });
    await consuming;

    expect(collected.map((event) => event.type)).toEqual(['session', 'message', 'done']);
    expect(channel.requests[0]).toMatchObject({ kind: 'claude-code', prompt: '回复 pong', sessionId: null });
  });

  test('invoke 被拒 → 产一条 spawn_failed 错误事件后结束（渲染层拿得到说法）', async () => {
    const channel = makeFakeChannel();
    channel.resolveInvoke(false, 'bad prompt');
    const transport = createIpcChatTransportFactory(channel.api)('kimi');

    const collected: TransportEvent[] = [];
    for await (const event of transport.spawn('hi', {})) {
      collected.push(event);
    }
    expect(collected).toEqual([
      { type: 'error', message: '对话 IPC 通道失败：bad prompt', code: 'spawn_failed' },
    ]);
  });

  test('signal abort → 按本轮 runId 调 api.abort（中断路由不串台）', async () => {
    const channel = makeFakeChannel();
    const transport = createIpcChatTransportFactory(channel.api)('codex');
    const controller = new AbortController();

    const collected: TransportEvent[] = [];
    const consuming = (async (): Promise<void> => {
      for await (const event of transport.spawn('列一下文件', { signal: controller.signal })) {
        collected.push(event);
      }
    })();

    await Promise.resolve();
    const runId = channel.requests[0]?.runId ?? '';
    controller.abort();
    expect(channel.aborted).toEqual([runId]);

    // 主进程随后推 aborted 事件 + end（runtime 杀进程树的回声）。
    channel.push({ runId, event: { type: 'error', message: 'killed', code: 'aborted' } });
    channel.push({ runId, end: true });
    await consuming;
    expect(collected.map((event) => event.type)).toEqual(['error']);
  });

  test('runId 全局唯一（两次 spawn 不撞车）；不同 runId 的信封被过滤', async () => {
    const channel = makeFakeChannel();
    const factory = createIpcChatTransportFactory(channel.api);

    const first = (async (): Promise<TransportEvent[]> => {
      const out: TransportEvent[] = [];
      for await (const event of factory('kimi').spawn('一')) out.push(event);
      return out;
    })();
    await Promise.resolve();
    const runId1 = channel.requests[0]?.runId ?? '';

    const second = (async (): Promise<TransportEvent[]> => {
      const out: TransportEvent[] = [];
      for await (const event of factory('kimi').spawn('二')) out.push(event);
      return out;
    })();
    await Promise.resolve();
    const runId2 = channel.requests[1]?.runId ?? '';
    expect(runId1).not.toBe(runId2);

    // 推一个别的 runId 的信封（并发轮次互串）—— 两边都不该收到。
    channel.push({ runId: 'someone-else', event: { type: 'message', text: '串台' } });
    channel.push({ runId: runId1, event: { type: 'message', text: '一答' } });
    channel.push({ runId: runId1, end: true });
    channel.push({ runId: runId2, event: { type: 'message', text: '二答' } });
    channel.push({ runId: runId2, end: true });

    expect((await first).map((event) => (event as { text: string }).text)).toEqual(['一答']);
    expect((await second).map((event) => (event as { text: string }).text)).toEqual(['二答']);
  });
});

describe('cliChatIpcApi：环境探测', () => {
  test('window.electronAPI.cliChat 存在才返回面；否则 null（纯 vite dev / node 无桥）', () => {
    const holder = globalThis as unknown as {
      window?: { electronAPI?: { cliChat?: unknown } };
      electronAPI?: { cliChat?: unknown };
    };
    const originalWindow = holder.window;
    const originalGlobalApi = holder.electronAPI;
    try {
      delete holder.window;
      delete holder.electronAPI;
      expect(cliChatIpcApi()).toBeNull();

      holder.electronAPI = {}; // node 直挂 globalThis 也认（同构环境）
      expect(cliChatIpcApi()).toBeNull();

      holder.window = { electronAPI: { cliChat: { run: () => Promise.resolve({ ok: true }), abort: () => Promise.resolve({ ok: true }) } } };
      expect(cliChatIpcApi()).not.toBeNull();
    } finally {
      if (originalWindow === undefined) delete holder.window;
      else holder.window = originalWindow;
      if (originalGlobalApi === undefined) delete holder.electronAPI;
      else holder.electronAPI = originalGlobalApi;
    }
  });
});
