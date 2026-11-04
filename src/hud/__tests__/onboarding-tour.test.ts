/**
 * 单测：轻引导三步（@since v3.8，task_139；退场语义 @since v3.9，task_152）。
 *
 * 覆盖口径：
 *   ① 首开出现 → 三步依次走完（1/3 → 2/3 → 3/3）→ 走完收起 + 写一次性标记；
 *   ② 跳过路径 → 收起 + 写标记 + 派 done 事件；
 *   ③ 二次打开不再现（标记已写 → start() 不显示）；
 *   ④ 目标元素在 → 挖洞（有尺寸）；不在 → 退成居中气泡（流程不中断）；
 *   ⑤ task_152：跳过 / 完成 / ESC 三条退场路径都要**当场拆掉浮层本体**（不是只隐藏）；
 *      ESC 在**没有焦点落在引导里**时也要生效（监听挂在 document 上）。
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

/**
 * task_152：退场语义 —— 浮层必须**当场消失**（DOM 里不再有这个浮层），
 * 三条路径（跳过 / 完成 / ESC）一致，且 ESC 不依赖焦点落在引导里。
 */
describe('轻引导退场（task_152）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.body.innerHTML = '';
  });

  test('跳过 → 浮层本体当场拆掉（不只是隐藏）+ 写标记 + 派事件', () => {
    const { host, element } = mount(fakeSteps(() => visibleBox()));
    const done = jest.fn();
    document.addEventListener(ONBOARDING_TOUR_DONE_EVENT, done);
    element.start();
    expect(element.isConnected).toBe(true);

    clickBubble(element, 'skip');

    // 退场 = DOM 里没有它了（不是 hidden 的空壳）。
    expect(element.isConnected).toBe(false);
    expect(host.querySelector(ONBOARDING_TOUR_TAG)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_DONE_KEY)).toBe('1');
    expect(done).toHaveBeenCalledTimes(1);
    document.removeEventListener(ONBOARDING_TOUR_DONE_EVENT, done);
  });

  test('三步走完「完成」→ 同样当场拆掉', () => {
    const { host, element } = mount(fakeSteps(() => visibleBox()));
    element.start();

    clickBubble(element, 'next');
    clickBubble(element, 'next');
    expect(readBubble(element).next).toBe('完成');
    clickBubble(element, 'next');

    expect(element.isConnected).toBe(false);
    expect(host.querySelector(ONBOARDING_TOUR_TAG)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_DONE_KEY)).toBe('1');
  });

  test('ESC → 退场（焦点不在引导里也生效：监听挂在 document 上）', () => {
    const { host, element } = mount(fakeSteps(() => visibleBox()));
    element.start();
    expect(element.isConnected).toBe(true);
    // 焦点留在 body（用户没点过引导里的按钮）—— 这正是 ESC 之前关不掉的原因。
    (document.body as HTMLElement).focus?.();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(element.isConnected).toBe(false);
    expect(host.querySelector(ONBOARDING_TOUR_TAG)).toBeNull();
    expect(window.localStorage.getItem(ONBOARDING_TOUR_DONE_KEY)).toBe('1');
  });

  test('ESC 在已退场后不再重复收场（不重复派事件）', () => {
    const { element } = mount(fakeSteps(() => visibleBox()));
    const done = jest.fn();
    document.addEventListener(ONBOARDING_TOUR_DONE_EVENT, done);
    element.start();
    clickBubble(element, 'skip');
    expect(done).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(done).toHaveBeenCalledTimes(1);
    document.removeEventListener(ONBOARDING_TOUR_DONE_EVENT, done);
  });

  test('重复挂载 → 宿主里只留一个浮层（杜绝「点掉一层还有一层」）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const first = mountOnboardingTour(host, { steps: fakeSteps(() => visibleBox()) });
    const second = mountOnboardingTour(host, { steps: fakeSteps(() => visibleBox()) });

    expect(first.isConnected).toBe(false);
    expect(second.isConnected).toBe(true);
    expect(host.querySelectorAll(ONBOARDING_TOUR_TAG).length).toBe(1);
  });
});
