/**
 * 回归测试：**交互矩阵 §2.2「交互原语 × 命中对象」—— HUD 侧**（@since v3.3，task_220 / IX-07）。
 *
 * 依据：docs/DESIGN-canvas-interactions.md §2 事件矩阵（IX-07：矩阵即测试清单）。
 * 本文件是矩阵的 **HUD 侧**那一半 —— 画布上的手势经 core 裁决后，HUD 该有的反应：
 *   - P1×O1 单击单位 ⇒ **只选中**，抽屉不开（design C-03：取消「单选自动顶开抽屉」）；
 *   - P3×O1 双击单位 ⇒ 打开该 agent 的**单独聊天框**（chatTarget ⇒ 开框并切上下文）；
 *   - P8 ESC ⇒ 关闭最上层浮层 / 取消选择（§3 C-01 的 HUD 半边）；
 *   - 未定义的键 ⇒ 无操作（不拦、不吞）。
 *
 * 同一张矩阵的另外两半：世界侧 → src/world/__tests__/interaction-matrix.test.ts，
 *   core 侧 → src/core/__tests__/interaction-matrix.test.ts。
 *
 * ★ 漂移提醒（矩阵 P8 的 world 半边未落地，见世界侧文件的「行为漂移（记账）」组）：
 *   ESC 在 HUD 侧是「取消选择」，在 world 侧**仍**是「镜头归位」⇒ 一次 ESC 触发两个动作。
 *
 * @jest-environment jsdom
 */

import type { CharacterView, UnitView, WorldState } from '../../core/types';

import {
  CHARACTER_CHAT_DRAWER_TAG,
  mountCharacterChatDrawer,
  type CharacterChatDrawerDeps,
  type StratCharacterChatDrawerElement,
} from '../components/chat-drawer/chat-drawer';
import { resolveShortcutAction, type KeyboardEventLike } from '../components/shortcuts/shortcut-catalog';

// ============================================================================
// 夹具
// ============================================================================

function unit(id: string, characterId: string | null): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 10, characterId };
}

function character(id: string, patch: Partial<CharacterView> = {}): CharacterView {
  return { id, name: `角色-${id}`, persona: '', level: 1, experience: 0, agentKind: 'kimi', ...patch };
}

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

interface Harness {
  readonly panel: StratCharacterChatDrawerElement;
  /** 模拟 core 广播一份新状态（走组件订阅的真实链路）。 */
  emit(state: WorldState): void;
  unmount(): void;
}

function mountDrawer(): Harness {
  const subs = new Set<(state: WorldState) => void>();
  const deps: CharacterChatDrawerDeps = {
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
    onSend: () => undefined,
    onStop: () => undefined,
    onRetry: () => undefined,
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountCharacterChatDrawer(deps, host);
  const panel = host.querySelector(CHARACTER_CHAT_DRAWER_TAG) as StratCharacterChatDrawerElement;
  if (!panel?.shadowRoot) throw new Error('角色聊天抽屉未 upgrade（shadowRoot 为空）');

  return {
    panel,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

/** 造一次键击（默认全无修饰）。 */
function key(key: string, mods: Partial<KeyboardEventLike> = {}): KeyboardEventLike {
  return { key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods };
}

// ============================================================================
// P1 × O1 / O2 · 单击（选中）不该顶开聊天抽屉
// ============================================================================

describe('矩阵 P1 × O1 · 单击单位 ⇒ 只选中，抽屉不开（C-03）', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('P1×O1：单选一个已关联角色的单位 ⇒ 抽屉保持收起', () => {
    h = mountDrawer();

    h.emit(makeState({
      units: [unit('u1', 'c1'), unit('u2', null)],
      characters: [character('c1', { name: '铁牛' })],
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 1 },
    }));

    expect(h.panel.isOpen).toBe(false);
    expect(h.panel.characterId).toBeNull();
  });

  test('P1×O2：点空地（选择集清空）⇒ 抽屉不动', () => {
    h = mountDrawer();
    h.emit(makeState({
      units: [unit('u1', 'c1')],
      characters: [character('c1')],
      selection: { unitIds: ['u1'], previewUnitIds: [], revision: 1 },
    }));

    h.emit(makeState({
      units: [unit('u1', 'c1')],
      characters: [character('c1')],
      selection: { unitIds: [], previewUnitIds: [], revision: 2 },
    }));

    expect(h.panel.isOpen).toBe(false);
  });
});

// ============================================================================
// P3 × O1 · 双击 ⇒ 打开该 agent 的单独聊天框
// ============================================================================

describe('矩阵 P3 × O1 · 双击单位 ⇒ 打开该 agent 的单独聊天框', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('P3×O1：chatTarget 变化 ⇒ 开框并把上下文切到该角色', () => {
    h = mountDrawer();
    h.emit(makeState({ units: [unit('u1', 'c1')] }));

    h.emit(makeState({
      units: [unit('u1', 'c1')],
      characters: [character('c1', { name: '铁牛' })],
      chatTarget: { characterId: 'c1', nonce: 1 },
    }));

    expect(h.panel.isOpen).toBe(true);
    expect(h.panel.characterId).toBe('c1');
  });

  test('P3×O1：同一目标（nonce 不变）的后续广播不重复开框（用户关掉后不被顶开）', () => {
    h = mountDrawer();
    const state = makeState({
      units: [unit('u1', 'c1')],
      chatTarget: { characterId: 'c1', nonce: 1 },
    });
    h.emit(state);
    h.panel.close();

    h.emit(state);

    expect(h.panel.isOpen).toBe(false);
  });

  test('P3×O1：同一角色连点两次（nonce 递增）⇒ 再次开框', () => {
    h = mountDrawer();
    h.emit(makeState({ units: [unit('u1', 'c1')] }));
    h.emit(makeState({ units: [unit('u1', 'c1')], chatTarget: { characterId: 'c1', nonce: 1 } }));
    h.panel.close();

    h.emit(makeState({ units: [unit('u1', 'c1')], chatTarget: { characterId: 'c1', nonce: 2 } }));

    expect(h.panel.isOpen).toBe(true);
  });

  test('P3×O3·O4：没有 chatTarget（点空地 / 点建筑）⇒ 不开框', () => {
    h = mountDrawer();

    h.emit(makeState({
      units: [unit('u1', 'c1')],
      selection: { unitIds: [], previewUnitIds: [], revision: 3 },
    }));

    expect(h.panel.isOpen).toBe(false);
  });
});

// ============================================================================
// P8 · ESC 的 HUD 半边（C-01）
// ============================================================================

describe('矩阵 P8 · ESC ⇒ 关闭最上层浮层 / 取消选择（HUD 半边）', () => {
  test('P8：浮层开着 ⇒ 先关浮层', () => {
    expect(resolveShortcutAction(key('Escape'), true)).toEqual({ type: 'closeHelp' });
  });

  test('P8：浮层没开 ⇒ 取消选择', () => {
    expect(resolveShortcutAction(key('Escape'), false)).toEqual({ type: 'deselect' });
  });

  test('P9：未定义的键 ⇒ 无操作（不拦、不吞）', () => {
    for (const pressed of ['a', 'b', 'F1', 'Tab', 'Enter', 'ArrowUp', '0']) {
      expect(resolveShortcutAction(key(pressed), false)).toBeNull();
    }
  });
});

// ============================================================================
// 矩阵 §2「键盘面」：已定义的键全部挂上 / 其余留白
// ============================================================================

describe('矩阵 §2 键盘面 · HUD 层：已定义的键全部挂上，其余留白', () => {
  const DEFINED_KEYS: readonly { readonly label: string; readonly press: KeyboardEventLike; readonly action: string }[] = [
    { label: 'Esc（取消选择）', press: key('Escape'), action: 'deselect' },
    { label: 'Ctrl/⌘ + A（全选）', press: key('a', { ctrlKey: true }), action: 'selectAll' },
    { label: 'Ctrl/⌘ + 1（编组存入）', press: key('1', { ctrlKey: true }), action: 'groupAssign' },
    { label: 'Ctrl/⌘ + 9（编组存入）', press: key('9', { metaKey: true }), action: 'groupAssign' },
    { label: '裸 1（召回编组）', press: key('1'), action: 'groupRecall' },
    { label: '裸 9（召回编组）', press: key('9'), action: 'groupRecall' },
    { label: 'Space（居中选中）', press: key(' '), action: 'centerSelection' },
    { label: '?（帮助浮层）', press: key('?'), action: 'toggleHelp' },
  ];

  test.each(DEFINED_KEYS.map((row) => [row.label, row] as const))(
    '%s ⇒ 解析出对应动作',
    (_label, row) => {
      expect(resolveShortcutAction(row.press, false)?.type).toBe(row.action);
    }
  );

  test('其余键位留白：解析不出动作 ⇒ 不拦截、不吞字符', () => {
    for (const pressed of ['a', 'b', 'z', 'F1', 'F5', 'Tab', 'Enter', 'ArrowDown', 'Backspace', '0']) {
      expect(resolveShortcutAction(key(pressed), false)).toBeNull();
    }
  });
});

// ============================================================================
// 消解规则 4② · 聊天框聚焦时，ESC 归输入框（画布让路）
// ============================================================================

describe('消解规则 4② · 聊天框里的 ESC 不冒泡到 window（画布收不到这次 ESC）', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('焦点让路：输入框里按 ESC ⇒ 抽屉关，事件不冒泡（world 侧因此不动镜头）', () => {
    h = mountDrawer();
    h.panel.open('c1');
    const box = h.panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="draft"]');
    if (!box) throw new Error('输入框未渲染');

    const seen: string[] = [];
    const onWindowKey = (event: KeyboardEvent) => { seen.push(event.key); };
    window.addEventListener('keydown', onWindowKey);
    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      box.dispatchEvent(event);

      expect(h.panel.isOpen).toBe(false);
      expect(event.defaultPrevented).toBe(true);
      expect(seen).toEqual([]);
    } finally {
      window.removeEventListener('keydown', onWindowKey);
    }
  });
});
