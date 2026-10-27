/**
 * 集成测试：快捷键帮助浮层（hud/components/shortcuts/shortcut-help.ts，task_058）。
 * jsdom：open/close/toggle 与 open 属性 / aria 语义、目录渲染（分组标题 + 行数 = 目录条数）、
 * 遮罩 / × 钮的关闭请求事件（composed 冒泡到 window，由 manager 收口）。
 * @jest-environment jsdom
 */

import {
  mountShortcutHelp,
  SHORTCUT_HELP_CLOSE_REQUEST,
  SHORTCUT_HELP_TAG,
  type StratShortcutHelpElement,
} from '../components/shortcuts/shortcut-help';
import { SHORTCUT_CATALOG, SHORTCUT_CATEGORY_LABELS } from '../components/shortcuts/shortcut-catalog';

function host(): StratShortcutHelpElement {
  const { element } = mountShortcutHelp(document.body);
  return element;
}

describe('开关与语义属性', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('默认关闭：无 open 属性、aria-hidden=true、role=dialog', () => {
    const el = host();
    expect(el.opened).toBe(false);
    expect(el.hasAttribute('open')).toBe(false);
    expect(el.getAttribute('aria-hidden')).toBe('true');
    expect(el.getAttribute('role')).toBe('dialog');
  });

  test('open / close / toggle：opened 与 open 属性同步', () => {
    const el = host();
    el.open();
    expect(el.opened).toBe(true);
    expect(el.hasAttribute('open')).toBe(true);
    expect(el.getAttribute('aria-hidden')).toBe('false');

    el.close();
    expect(el.opened).toBe(false);
    expect(el.hasAttribute('open')).toBe(false);

    expect(el.toggle()).toBe(true);
    expect(el.opened).toBe(true);
    expect(el.toggle()).toBe(false);
  });

  test('幂等：重复 open / close 不翻转', () => {
    const el = host();
    el.open();
    el.open();
    expect(el.opened).toBe(true);
    el.close();
    el.close();
    expect(el.opened).toBe(false);
  });
});

describe('目录渲染（数据源是 shortcut-catalog 的集中常量）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('行数 = 目录条数；每个分组都有标题', () => {
    const el = host();
    el.open();

    const rows = Array.from(el.shadowRoot?.querySelectorAll('.row') ?? []);
    expect(rows).toHaveLength(SHORTCUT_CATALOG.length);

    const headings = Array.from(el.shadowRoot?.querySelectorAll('h3') ?? []).map(
      (h) => h.textContent
    );
    for (const label of Object.values(SHORTCUT_CATEGORY_LABELS)) {
      expect(headings).toContain(label);
    }
  });

  test('每行都渲染了键位（.keys）与说明（.desc），textContent 直写', () => {
    const el = host();
    el.open();

    const rows = Array.from(el.shadowRoot?.querySelectorAll('.row') ?? []);
    for (const row of rows) {
      const keys = row.querySelector('.keys');
      const desc = row.querySelector('.desc');
      expect(keys?.textContent?.length ?? 0).toBeGreaterThan(0);
      expect(desc?.textContent?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe('关闭请求（× 钮 / 点遮罩）：composed 事件冒泡到 window', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('× 钮点击 → window 收到 SHORTCUT_HELP_CLOSE_REQUEST', () => {
    const el = host();
    const received: string[] = [];
    const listener = (event: Event): void => {
      if (event.type === SHORTCUT_HELP_CLOSE_REQUEST) received.push(event.type);
    };
    window.addEventListener(SHORTCUT_HELP_CLOSE_REQUEST, listener);
    try {
      const close = el.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="close"]');
      close?.click();
    } finally {
      window.removeEventListener(SHORTCUT_HELP_CLOSE_REQUEST, listener);
    }
    expect(received).toEqual([SHORTCUT_HELP_CLOSE_REQUEST]);
  });

  test('点遮罩 → 请求；点面板内部 → 不发', () => {
    const el = host();
    const received: string[] = [];
    const listener = (event: Event): void => {
      if (event.type === SHORTCUT_HELP_CLOSE_REQUEST) received.push(event.type);
    };
    window.addEventListener(SHORTCUT_HELP_CLOSE_REQUEST, listener);
    try {
      el.shadowRoot?.querySelector('[data-role="panel"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true })
      );
      expect(received).toEqual([]);

      el.shadowRoot?.querySelector('[data-role="backdrop"]')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, composed: true })
      );
      expect(received).toEqual([SHORTCUT_HELP_CLOSE_REQUEST]);
    } finally {
      window.removeEventListener(SHORTCUT_HELP_CLOSE_REQUEST, listener);
    }
  });
});

describe('关闭时的焦点释放（aria-hidden 无障碍告警修复，task_068）', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('× 钮获焦 → close() → 焦点释放回 body，且 aria-hidden=true', () => {
    const el = host();
    el.open();

    const closeBtn = el.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="close"]');
    expect(closeBtn).toBeTruthy();
    closeBtn?.focus();

    // 焦点在 Shadow DOM 内：document.activeElement 返回宿主元素，真正的焦点持有者在 shadowRoot。
    expect(el.shadowRoot?.activeElement).toBe(closeBtn);
    expect(document.activeElement).toBe(el);

    el.close();

    // 关闭时必须先释放浮层内部焦点，再设 aria-hidden —— 否则浏览器报
    // 「Blocked aria-hidden on an element because its descendant retained focus」。
    expect(el.shadowRoot?.activeElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });

  test('toggle() 关闭同样释放焦点（syncOpened(false) 是唯一汇合点）', () => {
    const el = host();
    el.open();

    const closeBtn = el.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="close"]');
    closeBtn?.focus();
    expect(el.shadowRoot?.activeElement).toBe(closeBtn);

    expect(el.toggle()).toBe(false);
    expect(el.shadowRoot?.activeElement).toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('挂载工厂', () => {
  test('mountShortcutHelp：元素挂进宿主、tag 正确、unmount 移除', () => {
    document.body.innerHTML = '';
    const container = document.createElement('div');
    document.body.appendChild(container);

    const { element, unmount } = mountShortcutHelp(container);
    expect(element.tagName.toLowerCase()).toBe(SHORTCUT_HELP_TAG);
    expect(container.contains(element)).toBe(true);

    unmount();
    expect(container.contains(element)).toBe(false);
  });
});
