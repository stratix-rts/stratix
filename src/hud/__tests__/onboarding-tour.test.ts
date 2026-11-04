/**
 * 单测：轻引导三步（@since v3.8，task_139）。
 *
 * 覆盖口径：
 *   ① 首开出现 → 三步依次走完（1/3 → 2/3 → 3/3）→ 走完收起 + 写一次性标记；
 *   ② 跳过路径 → 收起 + 写标记 + 派 done 事件；
 *   ③ 二次打开不再现（标记已写 → start() 不显示）；
 *   ④ 目标元素在 → 挖洞（有尺寸）；不在 → 退成居中气泡（流程不中断）。
 *
 * @jest-environment jsdom
 */

import {
  defineOnboardingTour,
  mountOnboardingTour,
  ONBOARDING_TOUR_DONE_EVENT,
  ONBOARDING_TOUR_DONE_KEY,
  ONBOARDING_TOUR_TAG,
  type OnboardingTourStep,
} from '../components/onboarding-tour/onboarding-tour';

interface Step {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly target: () => Element | null;
}

/** 三步假词表：目标是一个可造可见盒子的假元素。 */
function fakeSteps(target: (() => Element | null) | null): OnboardingTourStep[] {
  return ['一', '二', '三'].map((title, index) => ({
    id: `s${index}`,
    title,
    text: `第 ${index + 1} 步`,
    target: () => target?.() ?? null,
  }));
}

/** 造一个"可见"的假元素（jsdom 的 getBoundingClientRect 全是 0 —— 得手动喂）。 */
function visibleBox(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60, x: 10, y: 20 }) as DOMRect;
  return el;
}

/** 挂一个引导（宿主 + 三步词表）。 */
function mount(steps: OnboardingTourStep[]) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const element = mountOnboardingTour(host, { steps });
  return { host, element };
}

/** 读气泡里的文案 / 计数 / 按钮文字。 */
function readBubble(element: HTMLElement): { title: string; count: string; next: string } {
  const root = element.shadowRoot;
  return {
    title: root?.querySelector('[data-role="title"]')?.textContent ?? '',
    count: root?.querySelector('[data-role="count"]')?.textContent ?? '',
    next: root?.querySelector('[data-role="next"]')?.textContent ?? '',
  };
}

/** 点气泡里的按钮（next / skip）。 */
function clickBubble(element: HTMLElement, role: 'next' | 'skip'): void {
  element.shadowRoot?.querySelector<HTMLElement>(`[data-role="${role}"]`)?.click();
}

describe('轻引导三步（task_139）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  test('首开出现：三步依次走完 → 收起 + 写一次性标记', () => {
    const { element } = mount(fakeSteps(() => visibleBox()));
    element.start();

    expect(element.hidden).toBe(false);
    expect(readBubble(element)).toEqual({ title: '一', count: '1/3', next: '下一步' });

    clickBubble(element, 'next');
    expect(readBubble(element)).toEqual({ title: '二', count: '2/3', next: '下一步' });

    clickBubble(element, 'next');
    expect(readBubble(element)).toEqual({ title: '三', count: '3/3', next: '完成' });

    clickBubble(element, 'next');
    expect(element.hidden).toBe(true);
    expect(window.localStorage.getItem(ONBOARDING_TOUR_DONE_KEY)).toBe('1');
  });

  test('跳过路径：收起 + 写标记 + 派 done 事件', () => {
    const { element } = mount(fakeSteps(() => visibleBox()));
    const done = jest.fn();
    element.addEventListener(ONBOARDING_TOUR_DONE_EVENT, done);
    element.start();

    clickBubble(element, 'skip');

    expect(element.hidden).toBe(true);
    expect(window.localStorage.getItem(ONBOARDING_TOUR_DONE_KEY)).toBe('1');
    expect(done).toHaveBeenCalledTimes(1);
    expect((done.mock.calls[0][0] as CustomEvent).detail).toEqual({ skipped: true });
  });

  test('二次打开不再现（标记已写 → start() 不显示）', () => {
    window.localStorage.setItem(ONBOARDING_TOUR_DONE_KEY, '1');
    const { element } = mount(fakeSteps(() => visibleBox()));
    element.start();
    expect(element.hidden).toBe(true);
  });

  test('目标在 → 挖洞；目标不在 → 居中气泡（流程不中断）', () => {
    const { element } = mount(fakeSteps(() => visibleBox()));
    element.start();
    const ring = element.shadowRoot?.querySelector<HTMLElement>('[data-role="ring"]');
    const veil = element.shadowRoot?.querySelector<HTMLElement>('[data-role="veil-t"]');
    expect(ring?.style.display).toBe('block');
    expect(ring?.style.width).toBe('108px');
    expect(veil?.style.display).toBe('block');

    // 目标消失 → 洞收掉，气泡居中，步数不变（还能继续走）。
    const steps = fakeSteps(() => null);
    const second = mount(steps);
    second.element.start();
    const ring2 = second.element.shadowRoot?.querySelector<HTMLElement>('[data-role="ring"]');
    const veil2 = second.element.shadowRoot?.querySelector<HTMLElement>('[data-role="veil-t"]');
    const bubble2 = second.element.shadowRoot?.querySelector<HTMLElement>('[data-role="bubble"]');
    expect(ring2?.style.display).toBe('none');
    expect(veil2?.style.display).toBe('none');
    expect(bubble2?.style.transform).toBe('translate(-50%, -50%)');
    clickBubble(second.element, 'next');
    expect(readBubble(second.element).count).toBe('2/3');
  });

  test('组件注册幂等（重复 define 不报错）', () => {
    expect(() => {
      defineOnboardingTour();
      defineOnboardingTour();
    }).not.toThrow();
    expect(customElements.get(ONBOARDING_TOUR_TAG)).toBeTruthy();
  });
});
