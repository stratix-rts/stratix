/**
 * 集成测试：回放时间戳角标（hud/components/replay/replay-clock.ts，
 *   v3.3 task_082；@since v3.4 task_093 顶部 inset 迁到 56px + 挂 L3 层级）。
 *
 * 覆盖验收三条：
 *   1. 非回放态角标隐藏（不占左上角，也不误导观众）；
 *   2. 回放期间信息完整：时间 + 日期 + 「⏩ 回放中」；
 *   3. 落点避让顶栏：顶部 inset 56px（> 顶栏 40px）→ 与顶栏包围盒不相交。
 *
 * @jest-environment jsdom
 */

import { mountReplayClock, REPLAY_CLOCK_TAG } from '../components/replay/replay-clock';
import { formatReplayClock, formatReplayDate } from '../components/replay/replay-catalog';
import { REPLAY_CLOCK_TOP_INSET_PX, REPLAY_METRICS } from '../../core/theme/visual-spec';

function mount(): { element: ReturnType<typeof mountReplayClock>['element']; host: HTMLElement } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const { element } = mountReplayClock(host);
  return { element, host };
}

describe('回放时间戳角标：显隐', () => {
  test('非回放态：整个角标隐藏（不是「显示成 00:00:00」）', () => {
    const { element, host } = mount();
    const badge = element.shadowRoot?.querySelector('[data-role="badge"]') as HTMLElement;
    // 初态（没喂时刻）→ 不显示。
    expect(element.visible).toBe(false);
    expect(element.currentAt).toBeNull();
    expect(badge.dataset.on).toBe('0');
    // 隐藏靠 display:none（不是 opacity —— 隐藏的东西不该吃指针事件也不该被读到）。
    const css = element.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/\.badge\s*\{[^}]*display:\s*none/);
    expect(css).toMatch(/\.badge\[data-on="1"\]\s*\{\s*display:\s*flex/);
    host.remove();
  });

  test('回放结束（setTime(null)）→ 角标收回去', () => {
    const { element, host } = mount();
    const badge = element.shadowRoot?.querySelector('[data-role="badge"]') as HTMLElement;
    element.setTime(new Date(2026, 0, 2, 3, 4, 5).getTime());
    expect(badge.dataset.on).toBe('1');
    element.setTime(null);
    expect(element.visible).toBe(false);
    expect(badge.dataset.on).toBe('0');
    host.remove();
  });
});

describe('回放时间戳角标：信息完整', () => {
  test('回放期间：时间 + 日期 + 「⏩ 回放中」都在', () => {
    const { element, host } = mount();
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime();
    element.setTime(at);

    const shadow = element.shadowRoot;
    const time = shadow?.querySelector('[data-role="time"]')?.textContent ?? '';
    const date = shadow?.querySelector('[data-role="date"]')?.textContent ?? '';
    const tag = shadow?.querySelector('.tag')?.textContent ?? '';

    expect(time).toBe(formatReplayClock(at));
    expect(date).toBe(formatReplayDate(at));
    expect(date.length).toBeGreaterThan(0);
    expect(tag).toContain('⏩');
    expect(tag).toContain('回放中');
    host.remove();
  });
});

describe('回放时间戳角标：落点避让顶栏（@since v3.4，task_093）', () => {
  test('顶部 inset 是 56px（顶栏 40 + 间距 16），不再是压住顶栏的 24px', () => {
    const { element, host } = mount();
    expect(element.style.getPropertyValue('--replay-clock-inset-top')).toBe(
      `${REPLAY_CLOCK_TOP_INSET_PX}px`
    );
    expect(REPLAY_CLOCK_TOP_INSET_PX).toBe(56);
    const css = element.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toContain('top: var(--replay-clock-inset-top');
    // 旧的合并变量不再使用（左右拆开了：上 56 / 左 24）。
    expect(css).not.toContain('--replay-clock-inset,');
    host.remove();
  });

  test('左边距仍是 24px（规格只改垂直 inset，不动水平位置）', () => {
    const { element, host } = mount();
    expect(element.style.getPropertyValue('--replay-clock-inset-left')).toBe(
      `${REPLAY_METRICS.clockInsetPx}px`
    );
    host.remove();
  });

  test('角标挂 L3 层级（沉浸层元素：L3 期间满对比，L1 降对比时它最清楚）', () => {
    const { element, host } = mount();
    expect(element.getAttribute('data-srf-layer')).toBe('L3');
    expect(element.tagName.toLowerCase()).toBe(REPLAY_CLOCK_TAG.toLowerCase());
    host.remove();
  });
});
