/**
 * 回归测试：**矩阵 §2 的键盘面**（@since v3.3，task_217 / IX-04）。
 *
 * 矩阵（docs/DESIGN-canvas-interactions.md §2.2「键盘面」）逐行落成断言：
 *   ① **已定义的键全部挂上**：Esc（画布唯一的一格）/ Ctrl/⌘+A / Ctrl/⌘+1..9 / 1..9 /
 *      Space / ? / ⌘K；
 *   ② **未定义的键保持无操作**：解析不出动作 ⇒ 不拦截、不吞字符；
 *   ③ 帮助浮层的键位表与实际行为一致（design §4 IX-04 验收④）。
 *
 * why 单开一个文件：这张表是**契约的入口券**（design §5.5「新增任何画布交互前，
 *   必须同时产出一行矩阵」）—— 键位表变了，这张表就该先红。
 *
 * @jest-environment jsdom
 */

import {
  COMMAND_PALETTE_TAG,
  mountCommandPalette,
  type StratCommandPaletteElement,
} from '../components/command-palette/command-palette';
import {
  resolveShortcutAction,
  SHORTCUT_CATALOG,
  type KeyboardEventLike,
} from '../components/shortcuts/shortcut-catalog';

/** 造一次键击（默认全无修饰）。 */
function key(key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

/** 矩阵 §2 键盘面：键 → 该键解析出的动作（helpOpen = false 的常态）。 */
const MATRIX_ROWS: readonly { readonly label: string; readonly press: KeyboardEventLike; readonly action: string }[] = [
  { label: 'Esc（取消选择）', press: key('Escape'), action: 'deselect' },
  { label: 'Ctrl/⌘ + A（全选）', press: key('a', { ctrlKey: true }), action: 'selectAll' },
  { label: 'Ctrl/⌘ + 1（编组存入）', press: key('1', { ctrlKey: true }), action: 'groupAssign' },
  { label: 'Ctrl/⌘ + 9（编组存入）', press: key('9', { metaKey: true }), action: 'groupAssign' },
  { label: '裸 1（召回编组）', press: key('1'), action: 'groupRecall' },
  { label: '裸 9（召回编组）', press: key('9'), action: 'groupRecall' },
  { label: 'Space（居中选中）', press: key(' '), action: 'centerSelection' },
  { label: '?（帮助浮层）', press: key('?'), action: 'toggleHelp' },
];

/** 矩阵里**没有**的键 ⇒ 一律无操作（不拦、不吞）。 */
const UNDEFINED_KEYS: readonly string[] = [
  'a', 'b', 'z', 'F1', 'F5', 'Tab', 'Enter', 'ArrowDown', 'ArrowUp', 'Backspace', '0', 'Escape+Shift',
];

describe('矩阵 §2 键盘面：已定义的键全部挂上', () => {
  test.each(MATRIX_ROWS.map((row) => [row.label, row] as const))(
    '%s ⇒ 解析出动作',
    (_label, row) => {
      const action = resolveShortcutAction(row.press, false);
      expect(action).not.toBeNull();
      expect(action?.type).toBe(row.action);
    }
  );

  test('Esc 的两档：帮助浮层开着 ⇒ 先关浮层；否则 ⇒ 取消选择', () => {
    expect(resolveShortcutAction(key('Escape'), true)).toEqual({ type: 'closeHelp' });
    expect(resolveShortcutAction(key('Escape'), false)).toEqual({ type: 'deselect' });
  });

  test('⌘K ⇒ 命令面板（组件自己监听 window 的 keydown）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmountPalette = mountCommandPalette(
      { dispatch: () => undefined, subscribe: () => () => undefined },
      host
    );
    const element = host.querySelector(COMMAND_PALETTE_TAG) as StratCommandPaletteElement;
    try {
      expect(element.isOpen).toBe(false);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
      expect(element.isOpen).toBe(true);
    } finally {
      unmountPalette();
      host.remove();
    }
  });
});

describe('矩阵 §2 键盘面：未定义的键保持无操作', () => {
  test.each(UNDEFINED_KEYS.map((k) => [k] as const))('%s ⇒ 解析不出动作', (pressed) => {
    expect(resolveShortcutAction(key(pressed), false)).toBeNull();
    expect(resolveShortcutAction(key(pressed), true)).toBeNull();
  });

  test('带 Ctrl/⌘/Alt 的 Esc 不劫持（留给系统与浏览器）', () => {
    expect(resolveShortcutAction(key('Escape', { ctrlKey: true }), false)).toBeNull();
    expect(resolveShortcutAction(key('Escape', { altKey: true }), false)).toBeNull();
  });
});

describe('帮助浮层的键位表与实际行为一致（design §4 IX-04 验收④）', () => {
  /** 目录条目 → 真实键击与期望动作（帮助浮层不许列一个按了没反应的键）。 */
  const CATALOG_BINDINGS: readonly {
    readonly id: string;
    readonly press: KeyboardEventLike;
    readonly action: string;
  }[] = [
    { id: 'deselect', press: key('Escape'), action: 'deselect' },
    { id: 'select-all', press: key('a', { ctrlKey: true }), action: 'selectAll' },
    { id: 'create-group', press: key('1', { ctrlKey: true }), action: 'groupAssign' },
    { id: 'select-group', press: key('1'), action: 'groupRecall' },
    { id: 'center-view', press: key(' '), action: 'centerSelection' },
    { id: 'help', press: key('?'), action: 'toggleHelp' },
  ];

  test.each(CATALOG_BINDINGS.map((row) => [row.id, row] as const))(
    '目录条目 %s 在目录里，且它写的键真能触发对应动作',
    (id, row) => {
      expect(SHORTCUT_CATALOG.map((doc) => doc.id)).toContain(id);
      expect(resolveShortcutAction(row.press, false)?.type).toBe(row.action);
    }
  );

  test('目录里的键盘类条目都有一行绑定（没有「写了却按不动」的条目）', () => {
    const bound = new Set(CATALOG_BINDINGS.map((row) => row.id));
    for (const doc of SHORTCUT_CATALOG) {
      // 鼠标类条目是纯文档项（框选 / 加选 / 右击移动），不进键击解析。
      if (doc.category === 'mouse') continue;
      expect(bound.has(doc.id)).toBe(true);
    }
  });
});
