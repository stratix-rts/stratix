/**
 * 单元测试：网关连通性监测（task_114；@since v3.7 task_127 升级为三级）—— 横幅与态势屏的唯一判定方。
 * 覆盖：HTTP 通 + WS 通 → 在线；HTTP 通 + WS 断 → **降级**（半连接态）；
 *   HTTP 断 → 离线；网络异常 → 离线；订阅者收到翻转 / 退订后不再收通知；
 *   stop() 停掉周期探测；探测的 WS 连上即关（不消费数据）。
 * @jest-environment node
 */

import {
  createGatewayLinkMonitor,
  DEFAULT_GATEWAY_PROBE_INTERVAL_MS,
  GATEWAY_HEALTH_PATH,
  type GatewayWebSocketCtor,
  type GatewayWebSocketLike,
} from '../services/gateway-link';

/** 造一个可切换的 fetch 替身（ok 字段切换 = 网关起落）。 */
function fakeFetch(state: { ok: boolean; throwError?: boolean }): typeof fetch {
  return (async () => {
    if (state.throwError) throw new Error('ECONNREFUSED');
    return { ok: state.ok } as Response;
  }) as unknown as typeof fetch;
}

/**
 * 造一个 WS 替身：`open` 为真 = 通道连得上；`open` 为假 = 握手失败（立即报 error）。
 * 记录 connect/close 次数，断言「探测连上即关」。
 */
function fakeWebSocket(state: { open: boolean }): {
  ctor: GatewayWebSocketCtor;
  connects: () => number;
  closes: () => number;
} {
  let connects = 0;
  let closes = 0;
  const ctor = class implements GatewayWebSocketLike {
    onopen: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    constructor() {
      connects += 1;
      // 微任务里回报结果（模拟真实握手是异步的）。
      queueMicrotask(() => {
        if (state.open) this.onopen?.({});
        else this.onerror?.({});
      });
    }
    close(): void {
      closes += 1;
    }
  };
  return { ctor: ctor as unknown as GatewayWebSocketCtor, connects: () => connects, closes: () => closes };
}

describe('网关连通性监测（task_114 / task_127 三级）', () => {
  test('初始按在线处理（不在首帧闪横幅）', () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: false }),
      webSocketImpl: fakeWebSocket({ open: false }).ctor,
    });
    expect(monitor.state).toBe('online');
  });

  test('HTTP 通 + WS 通 → 在线', async () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: true }),
      webSocketImpl: fakeWebSocket({ open: true }).ctor,
    });
    expect(await monitor.refresh()).toBe('online');
    expect(monitor.state).toBe('online');
  });

  test('HTTP 通 + WS 断 → 降级（半连接：数据可用，实时通道断开）', async () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: true }),
      webSocketImpl: fakeWebSocket({ open: false }).ctor,
    });
    expect(await monitor.refresh()).toBe('degraded');
    expect(monitor.state).toBe('degraded');
  });

  test('HTTP 断 → 离线（WS 结论无意义，不因 WS 通而美化）', async () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: false }),
      webSocketImpl: fakeWebSocket({ open: true }).ctor,
    });
    expect(await monitor.refresh()).toBe('offline');
  });

  test('网络异常（网关进程被杀）也算离线', async () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: false, throwError: true }),
      webSocketImpl: fakeWebSocket({ open: false }).ctor,
    });
    expect(await monitor.refresh()).toBe('offline');
  });

  test('状态翻转才通知订阅者（离线 → 降级 → 在线）', async () => {
    const http = { ok: true };
    const ws = { open: false };
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch(http),
      webSocketImpl: fakeWebSocket(ws).ctor,
    });
    const seen: string[] = [];
    monitor.subscribe((state) => seen.push(state));
    expect(seen).toEqual(['online']);

    ws.open = false;
    expect(await monitor.refresh()).toBe('degraded');
    expect(await monitor.refresh()).toBe('degraded'); // 不变 → 不再通知
    expect(seen).toEqual(['online', 'degraded']);

    ws.open = true;
    expect(await monitor.refresh()).toBe('online');
    expect(seen).toEqual(['online', 'degraded', 'online']);
  });

  test('探的是网关自带的健康端点', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }) as Response);
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      webSocketImpl: fakeWebSocket({ open: true }).ctor,
    });
    await monitor.refresh();
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://127.0.0.1:7524${GATEWAY_HEALTH_PATH}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('WS 探测连上即关（只验通道通不通，不消费数据）', async () => {
    const ws = fakeWebSocket({ open: true });
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: true }),
      webSocketImpl: ws.ctor,
    });
    await monitor.refresh();
    expect(ws.connects()).toBe(1);
    expect(ws.closes()).toBe(1);
  });

  test('退订后不再收通知', async () => {
    const http = { ok: false };
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch(http),
      webSocketImpl: fakeWebSocket({ open: false }).ctor,
    });
    const seen: string[] = [];
    const unsubscribe = monitor.subscribe((state) => seen.push(state));
    unsubscribe();
    await monitor.refresh();
    expect(seen).toEqual(['online']);
  });

  test('stop() 停掉周期探测（不再发请求）', () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(async () => ({ ok: true }) as Response);
      const monitor = createGatewayLinkMonitor({
        baseUrl: 'http://127.0.0.1:7524',
        intervalMs: DEFAULT_GATEWAY_PROBE_INTERVAL_MS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        webSocketImpl: fakeWebSocket({ open: true }).ctor,
      });
      monitor.start();
      expect(fetchImpl).toHaveBeenCalledTimes(1); // start 立刻探一轮
      monitor.stop();
      jest.advanceTimersByTime(DEFAULT_GATEWAY_PROBE_INTERVAL_MS * 3);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
