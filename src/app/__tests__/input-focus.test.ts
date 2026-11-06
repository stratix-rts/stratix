/**
 * 集成测试：**「此刻有没有输入焦点」的 DOM 侧读口**（@since v3.3，task_217 / IX-04）。
 *
 * 覆盖三种焦点落点：
 *   ① 普通文档里的 textarea ⇒ 有输入焦点（画布要让路）；
 *   ② **影子树**里的 textarea（聊天框就是这种自定义元素）⇒ 也要认出来
 *      （只看 document.activeElement 会误判成「没在输入」—— 它只给到宿主）；
 *   ③ 按钮 / 链接 ⇒ 不算输入焦点（那些键有原生语义，判据是可编辑元素）。
 *
 * @jest-environment jsdom
 */

import { hasInputFocus } from '../main/input-focus';

describe('输入焦点探针（task_217 / IX-04）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('文档里的 textarea 持焦 ⇒ 有输入焦点', () => {
    const input = document.createElement('textarea');
    document.body.appendChild(input);
    input.focus();

    expect(hasInputFocus()).toBe(true);
  });

  test('影子树里的 textarea 持焦 ⇒ 也有输入焦点（聊天框的形态）', () => {
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const input = document.createElement('textarea');
    shadow.appendChild(input);
    document.body.appendChild(host);
    input.focus();

    // 影子树里的焦点：document.activeElement 只给到宿主 —— 探针必须下钻才认得出。
    expect(document.activeElement).toBe(host);
    expect(hasInputFocus()).toBe(true);
  });

  test('按钮持焦 ⇒ 不算输入焦点（键有原生语义，不该被画布抢）', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    expect(hasInputFocus()).toBe(false);
  });

  test('没有焦点 ⇒ 不算输入焦点', () => {
    expect(hasInputFocus()).toBe(false);
  });

  test('contenteditable 持焦 ⇒ 算输入焦点', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    document.body.appendChild(editable);
    editable.focus();

    expect(hasInputFocus()).toBe(true);
  });
});
