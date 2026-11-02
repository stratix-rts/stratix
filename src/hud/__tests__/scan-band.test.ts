/**
 * 单测：**屏幕空间扫描光带**（hud/components/screen-fx/scan-band.ts，@since v3.3，task_086）。
 * 覆盖验收标准中的「缩放平移时扫描带固定屏幕空间不变形」：
 *   - 组件是 fixed 定位的整屏覆盖层（屏幕坐标，不在战场画布里）；
 *   - 位置由 CSS transform 驱动（只动 transform，不动 left/top —— 合成器线程跑、且不参与布局）；
 *   - 周期 / 宽度 / 透明度取自唯一事实源 SCREEN_FX_METRICS（12s / 120px / 4% 背景感）；
 *   - pointer-events:none（不挡战场的拖拽平移 / 框选）。
 *
 * @jest-environment jsdom
 */

import { SCREEN_FX_METRICS } from '../../core/theme/visual-spec';

import { mountScanBand, SCAN_BAND_TAG } from '../components/screen-fx/scan-band';

interface Harness {
  readonly host: HTMLElement;
  readonly element: HTMLElement;
  /** 影子根里的 <style> 文本（断言 CSS 口径）。 */
  readonly css: string;
  unmount(): void;
}

function mountHarness(): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { element, unmount } = mountScanBand(host);
  const css = element.shadowRoot?.querySelector('style')?.textContent ?? '';
  return {
    host,
    element,
    css,
    unmount: () => {
      unmount();
      host.remove();
    },
  };
}

describe('屏幕空间扫描光带', () => {
  test('挂在覆盖层容器里，标签是 <strat-scan-band>', () => {
    const h = mountHarness();
    expect(h.element.tagName.toLowerCase()).toBe(SCAN_BAND_TAG);
    expect(h.host.contains(h.element)).toBe(true);
    h.unmount();
  });

  test('固定屏幕坐标：position: fixed + inset: 0（不随镜头缩放平移）', () => {
    const h = mountHarness();
    expect(h.css).toContain('position: fixed');
    expect(h.css).toContain('inset: 0');
    h.unmount();
  });

  test('只动 transform（合成器动画，不参与布局、不随世界坐标缩放）', () => {
    const h = mountHarness();
    expect(h.css).toContain('@keyframes srf-scan-sweep');
    expect(h.css).toContain('transform: translateX');
    h.unmount();
  });

  test('周期 / 宽度 / 透明度取自唯一事实源，且弱化为背景感', () => {
    const h = mountHarness();
    // 周期 12s、宽度 120px 与 DEMO-PLAN §5 一致。
    expect(SCREEN_FX_METRICS.scanBandPeriodMs).toBe(12_000);
    expect(SCREEN_FX_METRICS.scanBandWidthPx).toBe(120);
    // 迁到屏幕空间后按验收意见再弱一半（world 侧原值是 0.08）。
    expect(SCREEN_FX_METRICS.scanBandAlpha).toBe(0.04);
    expect(h.element.style.getPropertyValue('--scan-band-period')).toBe('12000ms');
    expect(h.element.style.getPropertyValue('--scan-band-width')).toBe('120px');
    expect(h.element.style.getPropertyValue('--scan-band-alpha')).toBe('0.04');
    h.unmount();
  });

  test('光带软边无硬边（两端淡出的渐变），且不拦事件', () => {
    const h = mountHarness();
    expect(h.css).toContain('linear-gradient');
    expect(h.css).toContain('pointer-events: none');
    h.unmount();
  });

  test('卸载即移除元素（不留残影）', () => {
    const h = mountHarness();
    h.unmount();
    expect(h.host.childElementCount).toBe(0);
  });
});
