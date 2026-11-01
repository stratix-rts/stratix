/**
 * 单测：快捷键目录与解析（hud/components/shortcuts/shortcut-catalog.ts，task_058）——
 * 键位映射表（v2 ShortcutManager 口径移植）、Esc 与帮助浮层的优先级、修饰键组合的边界、
 * 显示格式化。纯函数直打（node 环境），DOM 豁免规则的真元素用例在 manager 测试（jsdom）。
 */

import {
  formatShortcutDisplay,
  isActivatableTarget,
  isEditableTarget,
  resolveShortcutAction,
  SHORTCUT_CATALOG,
  type KeyboardEventLike,
} from '../components/shortcuts/shortcut-catalog';

/** 造一次键击（默认全无修饰）。 */
function key(key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  };
}

describe('键位映射表（v2 口径移植）', () => {
  test('Ctrl/⌘ + A → 全选（Ctrl 与 ⌘ 等价）', () => {
    expect(resolveShortcutAction(key('a', { ctrlKey: true }), false)).toEqual({ type: 'selectAll' });
    expect(resolveShortcutAction(key('A', { metaKey: true }), false)).toEqual({ type: 'selectAll' });
  });

  test('Ctrl/⌘ + 1..9 → 编组存入（槽位号原样透传）', () => {
    expect(resolveShortcutAction(key('1', { ctrlKey: true }), false)).toEqual({
      type: 'groupAssign',
      slot: 1,
    });
    expect(resolveShortcutAction(key('9', { metaKey: true }), false)).toEqual({
      type: 'groupAssign',
      slot: 9,
    });
  });

  test('裸 1..9 → 召回编组', () => {
    expect(resolveShortcutAction(key('1'), false)).toEqual({ type: 'groupRecall', slot: 1 });
    expect(resolveShortcutAction(key('5'), false)).toEqual({ type: 'groupRecall', slot: 5 });
  });

  test('Space → 居中选中（含旧浏览器 Spacebar 键名）', () => {
    expect(resolveShortcutAction(key(' '), false)).toEqual({ type: 'centerSelection' });
    expect(resolveShortcutAction(key('Spacebar'), false)).toEqual({ type: 'centerSelection' });
  });

  test('? → 开关帮助浮层', () => {
    expect(resolveShortcutAction(key('?', { shiftKey: true }), false)).toEqual({
      type: 'toggleHelp',
    });
    // 不带 Shift 的裸 '?' 也认（不同键盘布局的产物键）
    expect(resolveShortcutAction(key('?'), false)).toEqual({ type: 'toggleHelp' });
  });

  test('Esc：浮层关闭优先于取消选择', () => {
    expect(resolveShortcutAction(key('Escape'), true)).toEqual({ type: 'closeHelp' });
    expect(resolveShortcutAction(key('Escape'), false)).toEqual({ type: 'deselect' });
    expect(resolveShortcutAction(key('Esc'), false)).toEqual({ type: 'deselect' });
  });
});

describe('不命中的键（宁可少拦，不抢输入法的键）', () => {
  test('0 不是槽位（1..9 词表外）', () => {
    expect(resolveShortcutAction(key('0'), false)).toBeNull();
    expect(resolveShortcutAction(key('0', { ctrlKey: true }), false)).toBeNull();
  });

  test('Shift/Alt 叠加在 Ctrl 组合上不触发（Ctrl+Shift+A 是别家的键）', () => {
    expect(resolveShortcutAction(key('a', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
    expect(resolveShortcutAction(key('a', { ctrlKey: true, altKey: true }), false)).toBeNull();
  });

  test('Shift + 数字不触发（1! 2@ 那排符号键是输入）', () => {
    expect(resolveShortcutAction(key('1', { shiftKey: true }), false)).toBeNull();
  });

  test('Alt + 数字（Alt+Tab 族）不触发', () => {
    expect(resolveShortcutAction(key('1', { altKey: true }), false)).toBeNull();
  });

  test('普通字母 / 方向键 / Enter 不命中', () => {
    for (const k of ['b', 'z', 'ArrowLeft', 'Enter', 'Tab']) {
      expect(resolveShortcutAction(key(k), false)).toBeNull();
    }
  });

  test('Ctrl/⌘/Alt + Esc 不命中（系统组合不劫持）', () => {
    expect(resolveShortcutAction(key('Escape', { ctrlKey: true }), false)).toBeNull();
    expect(resolveShortcutAction(key('Escape', { altKey: true }), false)).toBeNull();
  });

  test('Ctrl + ? 不命中（? 只认无 Ctrl/⌘/Alt 的形态）', () => {
    expect(resolveShortcutAction(key('?', { ctrlKey: true, shiftKey: true }), false)).toBeNull();
  });
});

describe('可编辑元素豁免（node 环境的兜底分支）', () => {
  test('null / 非 DOM 目标不算可编辑（node 无 HTMLElement 也不抛）', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget({} as EventTarget)).toBe(false);
    expect(isActivatableTarget(null)).toBe(false);
  });
});

describe('目录与格式化（帮助浮层的数据源）', () => {
  test('目录覆盖六族键位 + 三条鼠标交互，且分组标签齐全', () => {
    const ids = SHORTCUT_CATALOG.map((doc) => doc.id);
    for (const id of [
      'select-all',
      'deselect',
      'create-group',
      'select-group',
      'center-view',
      'help',
      'box-select',
      'add-to-selection',
      'move-command',
    ]) {
      expect(ids).toContain(id);
    }
    // 每条都有键位显示串与说明（浮层渲染不判空）
    expect(SHORTCUT_CATALOG.every((doc) => doc.keys.length > 0 && doc.description.length > 0)).toBe(
      true
    );
  });

  test('formatShortcutDisplay：修饰键记号化（v2 formatKeyDisplay 口径）', () => {
    expect(formatShortcutDisplay('Ctrl + A')).toBe('⌃ + A');
    expect(formatShortcutDisplay('Ctrl/⌘ + 1…9')).toBe('⌃/⌘ + 1…9');
    expect(formatShortcutDisplay('Shift + 点击')).toBe('⇧ + 点击');
  });
});
