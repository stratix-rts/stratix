/**
 * 单测：提示词 composer（hud/panels/prompt-composer.ts）。
 * 覆盖输入面的**键位契约**：Enter 提交 / Shift+Enter 换行 / ⌘Enter 必交 /
 *   IME 合成中 Enter 不提交（中文用户命门）/ ↑↓ 历史导航 / 中部光标不抢键 / Esc 清空。
 * @jest-environment jsdom
 *
 * 为什么值得单测：这些全是「键位语义」，不是「像素」——
 *   面板层看不出来（它只收到一个 onSubmit 回调），
 *   但用户天天按（尤其中文用户按 Enter 选词）—— 错了就是「按一次回车把半句话提交出去」。
 */

import {
  PromptComposer,
  caretAtLineEdges,
  loadComposerHistory,
  saveComposerHistory,
} from '../panels/prompt-composer';

interface Harness {
  readonly el: HTMLTextAreaElement;
  readonly composer: PromptComposer;
  readonly submitted: string[];
  destroy(): void;
}

let seq = 0;

function mountComposer(): Harness {
  const el = document.createElement('textarea');
  el.rows = 1;
  document.body.appendChild(el);
  const submitted: string[] = [];
  seq += 1;
  const composer = new PromptComposer(el, {
    onSubmit: (raw) => { submitted.push(raw); },
    storageKey: `stratix.test.composer.${seq}`,
  });
  return {
    el,
    composer,
    submitted,
    destroy: () => {
      composer.destroy();
      el.remove();
    },
  };
}

/** 发一个真键盘事件（jsdom 里 KeyboardEvent 的 isComposing / keyCode 都可指定）。 */
function press(
  el: HTMLTextAreaElement,
  init: { key: string; shiftKey?: boolean; metaKey?: boolean; isComposing?: boolean; keyCode?: number }
): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    ...init,
  });
  el.dispatchEvent(ev);
  return ev;
}

/** 等一拍（compositionend 解除合成态是延后一拍的，见 prompt-composer 的注释）。 */
const tick = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

let mounted: Harness[] = [];

afterEach(() => {
  mounted.forEach((h) => h.destroy());
  mounted = [];
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('键位：提交', () => {
  test('Enter 提交原文', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'help';
    press(h.el, { key: 'Enter' });
    expect(h.submitted).toEqual(['help']);
  });

  test('Shift+Enter 不提交（换行交给浏览器）', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'help';
    const ev = press(h.el, { key: 'Enter', shiftKey: true });
    expect(h.submitted).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
  });

  test('⌘Enter 永远提交', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'help';
    press(h.el, { key: 'Enter', metaKey: true });
    expect(h.submitted).toEqual(['help']);
  });

  test('提交的是原文（不 trim —— 提示词首尾的空格有意义）', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = '  多行\n提示词  ';
    press(h.el, { key: 'Enter' });
    expect(h.submitted).toEqual(['  多行\n提示词  ']);
  });
});

describe('IME：中文用户命门', () => {
  test('合成过程中按 Enter（选词）不触发提交', async () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = '你好世界';
    h.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));

    // 合成中的 Enter：浏览器报 isComposing=true（keyCode 229 是 IME 占键的旧口径）。
    press(h.el, { key: 'Enter', isComposing: true });
    expect(h.submitted).toEqual([]);

    // 合成结束 → 再按 Enter 才提交。
    h.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await tick();
    press(h.el, { key: 'Enter' });
    expect(h.submitted).toEqual(['你好世界']);
  });

  test('合成态标记存在时，即便 isComposing 没报也不提交', async () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'ni hao';
    h.el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    press(h.el, { key: 'Enter' });
    expect(h.submitted).toEqual([]);
    h.el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await tick();
  });
});

describe('历史导航（↑↓）', () => {
  test('光标在首行时 ↑ 翻出上一条提交过的命令', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'theme';
    press(h.el, { key: 'Enter' });
    h.el.value = 'settings';
    press(h.el, { key: 'Enter' });
    h.el.value = '';
    h.el.setSelectionRange(0, 0);

    press(h.el, { key: 'ArrowUp' });
    expect(h.el.value).toBe('settings');
    press(h.el, { key: 'ArrowUp' });
    expect(h.el.value).toBe('theme');
    press(h.el, { key: 'ArrowDown' });
    expect(h.el.value).toBe('settings');
  });

  test('翻到最新一条之后按 ↓ → 回到翻历史前的草稿', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'help';
    press(h.el, { key: 'Enter' });
    h.el.value = '写了一半的草稿';
    h.el.setSelectionRange(0, 0);

    press(h.el, { key: 'ArrowUp' });
    expect(h.el.value).toBe('help');
    press(h.el, { key: 'ArrowDown' });
    expect(h.el.value).toBe('写了一半的草稿');
  });

  test('光标在中间行时 ↑↓ 不抢键（让光标正常移动）', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'help';
    press(h.el, { key: 'Enter' });

    h.el.value = '第一行\n第二行\n第三行';
    const mid = h.el.value.indexOf('第二') + 1;
    h.el.setSelectionRange(mid, mid);

    const ev = press(h.el, { key: 'ArrowUp' });
    expect(ev.defaultPrevented).toBe(false);
    expect(h.el.value).toBe('第一行\n第二行\n第三行');
  });

  test('历史落在 localStorage（会话内持久，换个实例也读得到）', () => {
    const key = 'stratix.test.history.persist';
    const h = mountComposer();
    mounted.push(h);
    h.el.value = 'replay';
    press(h.el, { key: 'Enter' });
    saveComposerHistory(['replay'], key);
    expect(loadComposerHistory(key)).toEqual(['replay']);
  });
});

describe('Esc：先清草稿，再失焦', () => {
  test('有内容时 Esc 清空草稿（不清两次才失焦）', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = '没写完的话';
    h.el.focus();
    press(h.el, { key: 'Escape' });
    expect(h.el.value).toBe('');
    expect(document.activeElement).toBe(h.el);
  });

  test('没有内容时 Esc 失焦', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.focus();
    press(h.el, { key: 'Escape' });
    expect(document.activeElement).not.toBe(h.el);
  });
});

describe('长高', () => {
  test('多行内容标记为展开态（紧凑形态据此把编辑区浮起）', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = '一\n二\n三';
    h.el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.el.dataset.expanded).toBe('true');
    expect(Number(h.el.dataset.rows)).toBeGreaterThan(1);
  });

  test('单行内容保持收起态', () => {
    const h = mountComposer();
    mounted.push(h);
    h.el.value = '一行';
    h.el.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.el.dataset.expanded).toBe('false');
  });
});

describe('行边界判定', () => {
  test('首行 / 末行 / 中间行', () => {
    expect(caretAtLineEdges('abc', 0)).toEqual({ first: true, last: true });
    expect(caretAtLineEdges('a\nb', 0)).toEqual({ first: true, last: false });
    expect(caretAtLineEdges('a\nb', 2)).toEqual({ first: false, last: true });
    expect(caretAtLineEdges('a\nb\nc', 2)).toEqual({ first: false, last: false });
  });
});
