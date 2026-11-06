/**
 * 单测：**「当前是否有输入焦点」的 world 侧读口**（@since v3.3，task_217 / IX-04）。
 *
 * 覆盖：探针在位 / 缺位 / 抛错 三种情形下，读口的返回值都必须是**确定的布尔**
 *   （world 零 DOM —— 读口只问 registry，不碰 document）。
 *
 * @jest-environment node
 */

import { INPUT_FOCUS_KEY, readInputFocus } from '../input-focus';

describe('输入焦点读口（task_217 / IX-04）', () => {
  test('探针说有焦点 ⇒ true（画布要让路）', () => {
    const store = { get: (key: string) => (key === INPUT_FOCUS_KEY ? () => true : undefined) };
    expect(readInputFocus(store)).toBe(true);
  });

  test('探针说没焦点 ⇒ false（画布照常响应）', () => {
    const store = { get: (key: string) => (key === INPUT_FOCUS_KEY ? () => false : undefined) };
    expect(readInputFocus(store)).toBe(false);
  });

  test('registry 里没有探针 ⇒ false（没装配 = 没有输入焦点，不猜）', () => {
    expect(readInputFocus({ get: () => undefined })).toBe(false);
    // 值不是函数（装配错了）⇒ 同样按「没有输入焦点」处理，不抛。
    expect(readInputFocus({ get: () => 'yes' })).toBe(false);
  });

  test('没有 registry（场景还没装配）⇒ false', () => {
    expect(readInputFocus(null)).toBe(false);
    expect(readInputFocus(undefined)).toBe(false);
  });

  test('探针抛错 ⇒ false（宁可画布照常响应，也不要整条键盘链哑掉）', () => {
    const store = {
      get: (key: string) =>
        key === INPUT_FOCUS_KEY
          ? () => {
              throw new Error('DOM 已卸载');
            }
          : undefined,
    };
    expect(readInputFocus(store)).toBe(false);
  });
});
