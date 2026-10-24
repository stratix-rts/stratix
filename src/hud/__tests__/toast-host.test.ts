/**
 * 集成测试：轻提示 toast 宿主（hud/components/toast/toast-host.ts，task_039）。
 * jsdom + jest fake timers 驱动：上屏（文案 / 语气 / XSS 安全）、3s 自动消失、多条堆叠、
 * 挂卸不泄漏计时器。皮肤 token 只能落到 CSS 文本里，jsdom 不渲染样式 —— 这里只断言语义面
 * （data-tone 属性与结构），视觉回归不归单测管。
 * @jest-environment jsdom
 */

import {
  defineToastHost,
  mountToastHost,
  TOAST_HOST_TAG,
  TOAST_TTL_MS,
  type StratToastHostElement,
} from '../components/toast/toast-host';

function host(): StratToastHostElement {
  defineToastHost();
  return document.createElement(TOAST_HOST_TAG) as StratToastHostElement;
}

describe('toast 宿主：上屏与自动消失（task_039）', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    // 真计时器恢复前把假时钟推干净：清光 pending 计时器再卸载，避免泄漏到后续用例
    jest.runAllTimers();
    jest.useRealTimers();
  });

  test('show → 在屏一条（textContent 直写 + role=status + data-tone）；TTL 后自动移除', () => {
    const el = host();
    document.body.appendChild(el);

    el.show('阿尔法 完成任务', 'success');
    expect(el.toastCount).toBe(1);
    expect(el.visibleTexts).toEqual(['阿尔法 完成任务']);

    const node = el.shadowRoot?.querySelector('.toast');
    expect(node?.getAttribute('data-tone')).toBe('success');
    expect(node?.getAttribute('role')).toBe('status');
    expect(node?.textContent).toBe('阿尔法 完成任务');

    jest.advanceTimersByTime(TOAST_TTL_MS);
    expect(el.toastCount).toBe(0);
    expect(el.shadowRoot?.querySelectorAll('.toast')).toHaveLength(0);
  });

  test('tone 缺省 info；文案走 textContent 直写（含 HTML 也不解析）', () => {
    const el = host();
    document.body.appendChild(el);

    el.show('<img src=x onerror=alert(1)>甲 完成任务');
    const node = el.shadowRoot?.querySelector('.toast');
    expect(node?.getAttribute('data-tone')).toBe('info');
    expect(node?.innerHTML).not.toContain('<img'); // 不走 innerHTML：正文是纯文本
    expect(el.visibleTexts).toEqual(['<img src=x onerror=alert(1)>甲 完成任务']);
  });

  test('多条堆叠（新的排后面）；各自独立过期', () => {
    const el = host();
    document.body.appendChild(el);

    el.show('甲 完成任务', 'success');
    jest.advanceTimersByTime(1000);
    el.show('乙 任务失败', 'danger');

    expect(el.visibleTexts).toEqual(['甲 完成任务', '乙 任务失败']);

    jest.advanceTimersByTime(TOAST_TTL_MS - 1000); // 甲满 3s，乙才 2s
    expect(el.visibleTexts).toEqual(['乙 任务失败']);

    jest.advanceTimersByTime(1000);
    expect(el.visibleTexts).toEqual([]);
  });

  test('卸载（元素离场）清光计时器；重复挂卸安全（幂等 connectedCallback）', () => {
    const el = host();
    document.body.appendChild(el);
    el.show('马上就卸', 'danger');
    expect(el.toastCount).toBe(1);

    el.remove();
    jest.advanceTimersByTime(TOAST_TTL_MS * 2); // 计时器已清：不摸已卸载 DOM、不抛
    expect(el.toastCount).toBe(0);

    document.body.appendChild(el); // 重挂：重建栈，状态干净
    el.show('重挂后再说', 'info');
    expect(el.toastCount).toBe(1);
    expect(el.visibleTexts).toEqual(['重挂后再说']);
  });

  test('mountToastHost：建元素挂进容器并返回引用；unmount 移除', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const { element, unmount } = mountToastHost(container);
    expect(container.querySelector(TOAST_HOST_TAG)).toBe(element);

    element.show('贝塔 完成任务', 'success');
    expect(element.toastCount).toBe(1);

    unmount();
    expect(container.querySelector(TOAST_HOST_TAG)).toBeNull();
  });
});
