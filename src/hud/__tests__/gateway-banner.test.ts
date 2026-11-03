/**
 * 单元测试：网关连通性全局横幅（task_114）—— 顶栏下方的断连提示 +「重试」按钮。
 * 覆盖：在线 → 横幅隐藏；断连 → 横幅亮出（文案人话）；「重试」→ 转交 refresh；
 *   卸载 → 退订（不留悬挂订阅）。
 * @jest-environment jsdom
 */

import {
  GATEWAY_BANNER_DETAIL,
  GATEWAY_BANNER_RETRY_LABEL,
  GATEWAY_BANNER_TITLE,
  mountGatewayBanner,
  type GatewayLinkPort,
} from '../components/gateway-banner/gateway-banner';

/** 造一个可手动翻转的端口替身。 */
function fakePort(initialOnline: boolean): {
  port: GatewayLinkPort;
  set: (online: boolean) => void;
  refresh: jest.Mock<Promise<boolean>, []>;
  subscriberCount: () => number;
} {
  let handler: ((online: boolean) => void) | null = null;
  let online = initialOnline;
  const refresh = jest.fn(async () => true);
  const port: GatewayLinkPort = {
    get online() {
      return online;
    },
    subscribe(next) {
      handler = next;
      next(online);
      return () => {
        if (handler === next) handler = null;
      };
    },
    refresh,
  };
  return {
    port,
    refresh,
    set: (next: boolean) => {
      online = next;
      handler?.(next);
    },
    subscriberCount: () => (handler ? 1 : 0),
  };
}

describe('网关连通性横幅（task_114）', () => {
  test('在线 → 横幅隐藏（不占首屏）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort(true);
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const banner = mounted.element.shadowRoot?.querySelector('[data-role="gateway-banner"]') as HTMLElement;
    expect(banner.hidden).toBe(true);
    expect(mounted.element.visible).toBe(false);
    host.remove();
  });

  test('断连 → 横幅亮出，文案是人话（说清「连不上」+「怎么办」）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort(false);
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

  test('恢复在线 → 横幅自动消失', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort(false);
    const mounted = mountGatewayBanner(host, { link: fake.port });
    const banner = mounted.element.shadowRoot?.querySelector('[data-role="gateway-banner"]') as HTMLElement;
    expect(banner.hidden).toBe(false);
    fake.set(true);
    expect(banner.hidden).toBe(true);
    expect(mounted.element.visible).toBe(false);
    host.remove();
  });

  test('「重试」按钮 → 转交 refresh（判定在 app 层，HUD 只转交）', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const fake = fakePort(false);
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
    const fake = fakePort(false);
    const mounted = mountGatewayBanner(host, { link: fake.port });
    expect(fake.subscriberCount()).toBe(1);
    mounted.unmount();
    expect(fake.subscriberCount()).toBe(0);
    host.remove();
  });
});
