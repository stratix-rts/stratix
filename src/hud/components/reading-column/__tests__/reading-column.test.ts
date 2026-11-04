/**
 * 单测：**阅读列**（@since v3.9，task_149）—— 消息分野 / 连续分组 / 时间线 /
 *   窗口化 / 滚动记忆 / 「上翻不打扰 + 回到最新」。
 * @jest-environment jsdom
 *
 * why 分两层测：
 *   ① **纯逻辑层**（reading-logic.ts）—— 不起 DOM，直接断言结构判断；
 *   ② **组件层**（reading-column.ts）—— 真 DOM（jsdom），断言「用户看得见的」行为。
 */

import { ReadingColumn } from '../reading-column';
import {
  buildPrefix,
  buildReadingTimeline,
  computeReadingWindow,
  createScrollMemory,
  formatClockTime,
  SCROLL_MEMORY_LIMIT,
  type ReadingMessage,
} from '../reading-logic';

// —— 造消息 ——
function msg(partial: Partial<ReadingMessage> & { id: string }): ReadingMessage {
  return {
    role: 'agent',
    author: '审阅 agent',
    text: '正文',
    at: 1_700_000_000_000,
    ...partial,
  };
}

describe('阅读列 · 时间线（纯逻辑）', () => {
  test('跨分钟插分隔条，同分钟不插', () => {
    const base = new Date(2026, 0, 1, 14, 32, 0).getTime();
    const rows = buildReadingTimeline([
      msg({ id: 'a', at: base }),
      msg({ id: 'b', at: base + 30_000 }), // 同一分钟
      msg({ id: 'c', at: base + 90_000 }), // 跨分钟
    ]);
    const separators = rows.filter((r) => r.kind === 'separator');
    expect(separators).toHaveLength(1);
    expect(separators[0]?.kind === 'separator' && separators[0].label).toBe('14:33');
  });

  test('连续同 agent 同署名 → 合组（第二条不开组）', () => {
    const rows = buildReadingTimeline([
      msg({ id: 'a' }),
      msg({ id: 'b' }),
      msg({ id: 'c', role: 'user', author: '你' }),
      msg({ id: 'd' }),
    ]);
    const messages = rows.filter((r) => r.kind === 'message');
    expect(messages.map((r) => (r.kind === 'message' ? r.opensGroup : null))).toEqual([
      true, false, true, true,
    ]);
  });

  test('系统事件永不合并（每条都独立成行）', () => {
    const rows = buildReadingTimeline([
      msg({ id: 'a', role: 'system', author: 'CI' }),
      msg({ id: 'b', role: 'system', author: 'CI' }),
    ]);
    const messages = rows.filter((r) => r.kind === 'message');
    expect(messages.every((r) => r.kind === 'message' && r.opensGroup)).toBe(true);
  });

  test('formatClockTime 输出「HH:MM」', () => {
    const at = new Date(2026, 0, 1, 9, 5, 0).getTime();
    expect(formatClockTime(at)).toBe('09:05');
  });
});

describe('阅读列 · 窗口化（纯逻辑）', () => {
  test('只切出可视区 + 缓冲，其余用占位高度顶掉', () => {
    const heights = new Array(250).fill(64);
    const prefix = buildPrefix(heights, 64);
    const win = computeReadingWindow(prefix, 3200, 400);
    expect(win.start).toBeLessThanOrEqual(50);
    expect(win.end).toBeGreaterThanOrEqual(50);
    expect(win.end - win.start).toBeLessThan(40); // 窗口有上限
    expect(win.topPad).toBe(win.start * 64);
    // 占位高度 + 已渲染行高 = 总高（不重不漏）。
    expect(win.topPad + win.bottomPad + (win.end - win.start + 1) * 64).toBe(250 * 64);
  });
});

describe('阅读列 · 滚动记忆（纯逻辑）', () => {
  test('最多记 5 个上下文（LRU —— 最早的先被挤掉）', () => {
    const memory = createScrollMemory({ storage: null });
    for (let i = 0; i < 7; i += 1) memory.remember(`k${i}`, i / 10);
    expect(memory.size()).toBe(SCROLL_MEMORY_LIMIT);
    expect(memory.recall('k0')).toBeNull();
    expect(memory.recall('k1')).toBeNull();
    expect(memory.recall('k6')).toBeCloseTo(0.6, 5);
  });

  test('记得住 ratio（比例位置 —— 面板高度变了也不会指错地方）', () => {
    const memory = createScrollMemory({ storage: null });
    memory.remember('s-1', 0.42);
    expect(memory.recall('s-1')).toBeCloseTo(0.42, 5);
  });

  test('持久化：写进 storage，读回来还在（刷新页面保持）', () => {
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    } as unknown as Storage;
    const memory = createScrollMemory({ storage: fake, storageKey: 'k' });
    memory.remember('s-9', 0.25);
    const restored = createScrollMemory({ storage: fake, storageKey: 'k' });
    expect(restored.recall('s-9')).toBeCloseTo(0.25, 5);
  });
});

// —— 组件层（真 DOM）——
describe('阅读列 · 组件行为', () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    host.remove();
  });

  /** jsdom 没有布局 —— 把滚动相关尺寸手工钉上去（组件读的就是这几个值）。 */
  function fakeMetrics(list: HTMLElement, opts: { scrollTop: number; clientHeight: number; scrollHeight: number }): void {
    Object.defineProperty(list, 'clientHeight', { value: opts.clientHeight, configurable: true });
    Object.defineProperty(list, 'scrollHeight', { value: opts.scrollHeight, configurable: true });
    let top = opts.scrollTop;
    Object.defineProperty(list, 'scrollTop', {
      get: () => top,
      set: (v: number) => { top = v; },
      configurable: true,
    });
  }

  function listOf(container: HTMLElement): HTMLElement {
    return container.querySelector<HTMLElement>('[data-role="rc-list"]')!;
  }

  test('三种身份各占一种视觉位（data-rc-role）', () => {
    const column = new ReadingColumn(host, { contextKey: 'c1', memoryScope: 'test-a' });
    column.setMessages([
      msg({ id: 'u', role: 'user', author: '你' }),
      msg({ id: 'g', role: 'agent' }),
      msg({ id: 's', role: 'system', author: 'CI' }),
    ]);
    const roles = Array.from(host.querySelectorAll('[data-role="rc-message"]')).map(
      (el) => el.getAttribute('data-rc-role'),
    );
    expect(roles).toEqual(['user', 'agent', 'system']);
    column.destroy();
  });

  test('上翻时新消息不打扰（位置不动 + 浮标出现 + 计数 +1）', () => {
    const column = new ReadingColumn(host, { contextKey: 'c2', memoryScope: 'test-b' });
    column.setMessages([msg({ id: 'a' }), msg({ id: 'b' })]);
    const list = listOf(host);
    fakeMetrics(list, { scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
    list.dispatchEvent(new Event('scroll'));

    expect(column.atBottom).toBe(false);
    expect(column.jumpVisible).toBe(true);

    column.setMessages([msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c' })]);
    expect(list.scrollTop).toBe(0); // 位置没被顶走
    expect(column.pendingCount).toBe(1);
    expect(column.atBottom).toBe(false);
    column.destroy();
  });

  test('点「回到最新」→ 贴底 + 计数清零', () => {
    const column = new ReadingColumn(host, { contextKey: 'c3', memoryScope: 'test-c' });
    column.setMessages([msg({ id: 'a' })]);
    const list = listOf(host);
    fakeMetrics(list, { scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
    list.dispatchEvent(new Event('scroll'));
    column.setMessages([msg({ id: 'a' }), msg({ id: 'b' })]);
    expect(column.pendingCount).toBe(1);

    host.querySelector<HTMLButtonElement>('[data-role="rc-jump"]')!.click();

    expect(list.scrollTop).toBe(900);
    expect(column.pendingCount).toBe(0);
    expect(column.atBottom).toBe(true);
    column.destroy();
  });

  test('贴着底部时新消息自动跟随', () => {
    const column = new ReadingColumn(host, { contextKey: 'c4', memoryScope: 'test-d' });
    column.setMessages([msg({ id: 'a' })]);
    const list = listOf(host);
    fakeMetrics(list, { scrollTop: 600, clientHeight: 300, scrollHeight: 900 });
    list.dispatchEvent(new Event('scroll'));
    expect(column.atBottom).toBe(true);

    column.setMessages([msg({ id: 'a' }), msg({ id: 'b' })]);
    expect(list.scrollTop).toBe(900);
    expect(column.pendingCount).toBe(0);
    column.destroy();
  });

  test('滚动记忆：重建组件后回到原位置（面板收起再打开 / 抽屉开合）', () => {
    const first = new ReadingColumn(host, { contextKey: 'c5', memoryScope: 'test-e' });
    first.setMessages([msg({ id: 'a' }), msg({ id: 'b' })]);
    const list1 = listOf(host);
    fakeMetrics(list1, { scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
    list1.dispatchEvent(new Event('scroll'));
    list1.scrollTop = 450; // 用户滚到一半
    list1.dispatchEvent(new Event('scroll'));
    first.destroy();

    // 组件重建（面板重画）—— 位置按记忆回来。
    const second = new ReadingColumn(host, { contextKey: 'c5', memoryScope: 'test-e' });
    second.setMessages([msg({ id: 'a' }), msg({ id: 'b' })]);
    const list2 = listOf(host);
    fakeMetrics(list2, { scrollTop: 0, clientHeight: 300, scrollHeight: 900 });
    second.restorePosition();
    expect(list2.scrollTop).toBe(450);
    second.destroy();
  });

  test('200+ 消息：DOM 节点数有上限（窗口化 —— 不是 200 个节点全铺开）', () => {
    const column = new ReadingColumn(host, { contextKey: 'c6', memoryScope: 'test-f' });
    const many: ReadingMessage[] = Array.from({ length: 250 }, (_, i) =>
      msg({ id: `m-${i}`, at: 1_700_000_000_000 + i * 1000 }),
    );
    column.setMessages(many);
    const rendered = host.querySelectorAll('[data-role="rc-message"]').length;
    expect(rendered).toBeLessThanOrEqual(30);
    expect(rendered).toBeGreaterThan(0);
    column.destroy();
  });

  test('销毁后不再响应（监听器释放）', () => {
    const column = new ReadingColumn(host, { contextKey: 'c7', memoryScope: 'test-g' });
    column.setMessages([msg({ id: 'a' })]);
    column.destroy();
    expect(host.querySelector('[data-role="rc"]')).toBeNull();
  });
});
