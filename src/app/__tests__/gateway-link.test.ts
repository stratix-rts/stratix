/**
 * 单元测试：网关连通性监测（task_114）—— 横幅的唯一判定方。
 * 覆盖：探活失败 → 断连 / 恢复 → 在线（订阅者收到翻转）/ 网络异常 → 断连 /
 *   退订后不再收通知 / stop() 停掉周期探测。
 * @jest-environment node
 */

import {
  createGatewayLinkMonitor,
  DEFAULT_GATEWAY_PROBE_INTERVAL_MS,
  GATEWAY_HEALTH_PATH,
} from '../services/gateway-link';

/** 造一个可切换的 fetch 替身（ok 字段切换 = 网关起落）。 */
function fakeFetch(state: { ok: boolean; throwError?: boolean }): typeof fetch {
  return (async () => {
    if (state.throwError) throw new Error('ECONNREFUSED');
    return { ok: state.ok } as Response;
  }) as unknown as typeof fetch;
}

describe('网关连通性监测（task_114）', () => {
  test('初始按在线处理（不在首帧闪横幅）', () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: false }),
    });
    expect(monitor.online).toBe(true);
  });

  test('探活失败 → 断连；恢复 → 在线（订阅者收到翻转）', async () => {
    const state = { ok: false };
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch(state),
    });
    const seen: boolean[] = [];
    monitor.subscribe((online) => seen.push(online));
    expect(seen).toEqual([true]);

    expect(await monitor.refresh()).toBe(false);
    expect(monitor.online).toBe(false);
    expect(seen).toEqual([true, false]);

    state.ok = true;
    expect(await monitor.refresh()).toBe(true);
    expect(monitor.online).toBe(true);
    expect(seen).toEqual([true, false, true]);
  });

  test('网络异常（网关进程被杀）也算断连', async () => {
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch({ ok: false, throwError: true }),
    });
    expect(await monitor.refresh()).toBe(false);
    expect(monitor.online).toBe(false);
  });

  test('探的是网关自带的健康端点', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true }) as Response);
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await monitor.refresh();
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://127.0.0.1:7524${GATEWAY_HEALTH_PATH}`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  test('退订后不再收通知', async () => {
    const state = { ok: false };
    const monitor = createGatewayLinkMonitor({
      baseUrl: 'http://127.0.0.1:7524',
      fetchImpl: fakeFetch(state),
    });
    const seen: boolean[] = [];
    const unsubscribe = monitor.subscribe((online) => seen.push(online));
    unsubscribe();
    await monitor.refresh();
    expect(seen).toEqual([true]);
  });

  test('stop() 停掉周期探测（不再发请求）', async () => {
    jest.useFakeTimers();
    try {
      const fetchImpl = jest.fn(async () => ({ ok: true }) as Response);
      const monitor = createGatewayLinkMonitor({
        baseUrl: 'http://127.0.0.1:7524',
        intervalMs: DEFAULT_GATEWAY_PROBE_INTERVAL_MS,
        fetchImpl: fetchImpl as unknown as typeof fetch,
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
