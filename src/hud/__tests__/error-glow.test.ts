/**
 * 单测：**报错红光晕**（hud/components/screen-fx/error-glow.ts + screen-fx-catalog.ts，
 * @since v3.3，task_086）。
 * 覆盖验收标准中的「红光晕无硬边框柔和」「仅导演模式 + 报错呼吸 2 次」「固定屏幕空间」：
 *   - 触发判定：只有 task.failed 且导演模式开启才呼吸（纯函数，直打）；
 *   - 呼吸：一次 pulse 挂上动画 class（连打两次会重播），强度取自唯一事实源；
 *   - 观感：径向 alpha 渐变（无 border / 无实心边缘带）、固定屏幕坐标、不拦事件。
 *
 * @jest-environment jsdom
 */

import { SCREEN_FX_METRICS } from '../../core/theme/visual-spec';
import type { CharacterTask, WorldEvent } from '../../core/types';

import {
  ERROR_GLOW_TAG,
  mountErrorGlow,
  type StratErrorGlowElement,
} from '../components/screen-fx/error-glow';
import { errorGlowTrigger } from '../components/screen-fx/screen-fx-catalog';

const TASK: CharacterTask = {
  id: 't-1',
  characterId: 'c-1',
  prompt: '干活',
  status: 'failed',
  createdAt: 1,
  startedAt: 2,
  endedAt: 3,
  output: '炸了',
};

interface Harness {
  readonly host: HTMLElement;
  readonly element: StratErrorGlowElement;
  /** 影子根里的 <style> 文本（断言 CSS 口径）。 */
  readonly css: string;
  /** 光晕节点（动画 class 挂它身上）。 */
  readonly glow: HTMLElement | null;
  unmount(): void;
}

function mountHarness(): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { element, unmount } = mountErrorGlow(host);
  const css = element.shadowRoot?.querySelector('style')?.textContent ?? '';
  return {
    host,
    element,
    css,
    glow: element.shadowRoot?.querySelector('[data-role="glow"]') ?? null,
    unmount: () => {
      unmount();
      host.remove();
    },
  };
}

describe('报错红光晕：触发判定（纯逻辑）', () => {
  test('task.failed + 导演模式开启 → 该呼吸', () => {
    const event: WorldEvent = { type: 'task.failed', task: TASK };
    expect(errorGlowTrigger(event, true)).toBe(true);
  });

  test('导演模式未开启 → 不呼吸（红光是导演模式的能力提示）', () => {
    const event: WorldEvent = { type: 'task.failed', task: TASK };
    expect(errorGlowTrigger(event, false)).toBe(false);
  });

  test('其它事件（完成 / 派活）→ 不呼吸', () => {
    const done: WorldEvent = { type: 'task.completed', task: { ...TASK, status: 'completed' } };
    const queued: WorldEvent = { type: 'task.queued', task: { ...TASK, status: 'queued' } };
    expect(errorGlowTrigger(done, true)).toBe(false);
    expect(errorGlowTrigger(queued, true)).toBe(false);
  });
});

describe('报错红光晕：组件行为', () => {
  test('挂在覆盖层容器里，标签是 <strat-error-glow>', () => {
    const h = mountHarness();
    expect(h.element.tagName.toLowerCase()).toBe(ERROR_GLOW_TAG);
    expect(h.host.contains(h.element)).toBe(true);
    h.unmount();
  });

  test('固定屏幕坐标 + 不拦事件（pointer-events:none）', () => {
    const h = mountHarness();
    expect(h.css).toContain('position: fixed');
    expect(h.css).toContain('inset: 0');
    expect(h.css).toContain('pointer-events: none');
    h.unmount();
  });

  test('径向 alpha 渐变、无硬边框（无 border / 无实心边缘带）', () => {
    const h = mountHarness();
    expect(h.css).toContain('radial-gradient');
    expect(h.css).not.toMatch(/border\s*:/);
    h.unmount();
  });

  test('呼吸 2 次：强度 / 时长 / 轮数取自唯一事实源', () => {
    const h = mountHarness();
    expect(SCREEN_FX_METRICS.errorGlowPulses).toBe(2);
    expect(h.element.style.getPropertyValue('--glow-pulses')).toBe('2');
    expect(h.element.style.getPropertyValue('--glow-pulse-ms')).toBe('650ms');
    // 强度约为原硬边框渐晕（0.55）的一半。
    expect(SCREEN_FX_METRICS.errorGlowAlpha).toBeLessThan(0.55 / 2 + 0.01);
    expect(h.element.style.getPropertyValue('--glow-peak')).toBe(
      String(SCREEN_FX_METRICS.errorGlowAlpha)
    );
    h.unmount();
  });

  test('pulse() 挂上动画（连打两次会重播），计数累加', () => {
    const h = mountHarness();
    const glow = h.glow;
    expect(glow).not.toBeNull();

    h.element.pulse();
    expect(glow?.classList.contains('pulsing')).toBe(true);
    expect(h.element.showing).toBe(true);
    expect(h.element.pulseCount).toBe(1);

    // 第二次报错：动画必须从头重播（class 先摘后挂）。
    h.element.pulse();
    expect(glow?.classList.contains('pulsing')).toBe(true);
    expect(h.element.pulseCount).toBe(2);
    h.unmount();
  });

  test('动画结束 → 收尾（状态复位，下一轮从头开始）', () => {
    const h = mountHarness();
    h.element.pulse();
    expect(h.element.showing).toBe(true);
    h.glow?.dispatchEvent(new Event('animationend'));
    expect(h.element.showing).toBe(false);
    expect(h.glow?.classList.contains('pulsing')).toBe(false);
    h.unmount();
  });

  test('卸载即移除元素（不留残影）', () => {
    const h = mountHarness();
    h.unmount();
    expect(h.host.childElementCount).toBe(0);
  });
});
