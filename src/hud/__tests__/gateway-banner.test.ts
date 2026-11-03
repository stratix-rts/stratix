/**
 * 单元测试：网关连通性全局横幅（task_114；@since v3.7 task_127 升级为三级）——
 *   顶栏下方的断连/降级提示 +「重试」按钮。
 * 覆盖：在线 → 横幅隐藏；离线 → 横幅亮出（文案人话，task_114 原文案不变）；
 *   **降级 → 横幅亮出且说清「数据可用，实时通道断开」（不谎报「未连接」）**；
 *   「重试」→ 转交 refresh；卸载 → 退订（不留悬挂订阅）。
 * @jest-environment jsdom
 */

import {
  GATEWAY_BANNER_DEGRADED_DETAIL,
  GATEWAY_BANNER_DEGRADED_TITLE,
  GATEWAY_BANNER_DETAIL,
  GATEWAY_BANNER_RETRY_LABEL,
  GATEWAY_BANNER_TITLE,
  mountGatewayBanner,
} from '../components/gateway-banner/gateway-banner';
import type {
  GatewayConnectionState,
  GatewayLinkPort,
} from '../bridge/gateway-link-port';

/** 造一个可手动翻转的端口替身。 */
function fakePort(initial: GatewayConnectionState): {
  port: GatewayLinkPort;
  set: (next: GatewayConnectionState) => void;
  refresh: jest.Mock<Promise<GatewayConnectionState>, []>;
  subscriberCount: () => number;
} {
  let handler: ((state: GatewayConnectionState) => void) | null = null;
  let state = initial;
  const refresh = jest.fn(async () => state);
  const port: GatewayLinkPort = {
    get state() {
      return state;
    },
    subscribe(next) {
      handler = next;
      next(state);
      return () => {
        if (handler === next) handler = null;
      };
    },
    refresh,
  };
  return {
    port,
    refresh,
    set: (next: GatewayConnectionState) => {
      state = next;
      handler?.(next);
    },
    subscriberCount: () => (handler ? 1 : 0),
  };
}

describe('网关连通性横幅（task_114 / task_127 三级）', () => {
  test('在线 → 横幅隐藏（不占首屏）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort('online');
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const banner = mounted.element.shadowRoot?.querySelector('[data-role="gateway-banner"]') as HTMLElement;
    expect(banner.hidden).toBe(true);
    expect(mounted.element.visible).toBe(false);
    host.remove();
  });

  test('断连 → 横幅亮出，文案是人话（说清「连不上」+「怎么办」）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort('offline');
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const banner = mounted.element.shadowRoot?.querySelector('[data-role="gateway-banner"]') as HTMLElement;
    const title = mounted.element.shadowRoot?.querySelector('[data-role="title"]') as HTMLElement;
    const detail = mounted.element.shadowRoot?.querySelector('[data-role="detail"]') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(mounted.element.visible).toBe(true);
    expect(title.textContent).toBe(GATEWAY_BANNER_TITLE);
    expect(detail.textContent).toBe(GATEWAY_BANNER_DETAIL);
    host.remove();
  });

  test('降级（HTTP 可用、实时通道断）→ 横幅亮出，文案说清「数据可用」而非「未连接」', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort('degraded');
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const banner = mounted.element.shadowRoot?.querySelector('[data-role="gateway-banner"]') as HTMLElement;
    const title = mounted.element.shadowRoot?.querySelector('[data-role="title"]') as HTMLElement;
    const detail = mounted.element.shadowRoot?.querySelector('[data-role="detail"]') as HTMLElement;
    expect(banner.hidden).toBe(false);
    expect(mounted.element.visible).toBe(true);
    expect(mounted.element.state).toBe('degraded');
    expect(title.textContent).toBe(GATEWAY_BANNER_DEGRADED_TITLE);
    expect(detail.textContent).toBe(GATEWAY_BANNER_DEGRADED_DETAIL);
    // 关键：降级态不得出现「未连接」—— 那与「数据照样可用」自相矛盾（task_127 的病根）。
    expect(title.textContent).not.toContain('未连接');
    expect(detail.textContent).toContain('数据可用');
    host.remove();
  });

  test('恢复在线 → 横幅自动消失', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort('offline');
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const banner = mounted.element.shadowRoot?.querySelector('[data-role="gateway-banner"]') as HTMLElement;
    expect(banner.hidden).toBe(false);
    fake.set('online');
    expect(banner.hidden).toBe(true);
    expect(mounted.element.visible).toBe(false);
    host.remove();
  });

  test('「重试」按钮 → 转交 refresh（判定在 app 层，HUD 只转交）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort('offline');
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const retry = mounted.element.shadowRoot?.querySelector('[data-role="retry"]') as HTMLButtonElement;
    expect(retry.textContent).toBe(GATEWAY_BANNER_RETRY_LABEL);
    retry.click();
    expect(fake.refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    host.remove();
  });

  test('卸载 → 退订（不留悬挂订阅）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort('offline');
    const mounted = mountGatewayBanner(host, { link: fake.port });
    expect(fake.subscriberCount()).toBe(1);
    mounted.unmount();
    expect(fake.subscriberCount()).toBe(0);
    host.remove();
  });
});
