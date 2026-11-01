/**
 * 集成测试：快捷键管理器（hud/components/shortcuts/shortcut-manager.ts，task_058）。
 * jsdom：window keydown → 命令派发（全选 / 取消 / 编组存召回 / 居中）、输入框聚焦豁免、
 * 按钮焦点上的 Space 让路、帮助浮层开关联动（含遮罩关闭请求回流）、卸载清理。
 * 质心纯函数（computeCenterPoint）一并直打。
 * 卸载纪律：每个用例的挂载都收进 cleanups，afterEach 退干净 —— 多个用例同屏时
 * window keydown 监听不叠罗汉（叠了同一键会派发多次，断言直接漏出来）。
 * @jest-environment jsdom
 */

import type { Point, WorldState } from '../../core/types';
import {
  computeCenterPoint,
  createShortcutManager,
  mountShortcuts,
  type ShortcutDispatchCommand,
  type ShortcutPorts,
} from '../components/shortcuts/shortcut-manager';
import { mountShortcutHelp } from '../components/shortcuts/shortcut-help';

/** 造一份最小 WorldState（只有被读的字段有值）。 */
function state(partial: Partial<WorldState>): WorldState {
  return {
    missions: [],
    notices: [],
    characters: [],
    units: [
      { id: 'u1', name: '甲', status: 'idle', missionId: null, power: 1 },
      { id: 'u2', name: '乙', status: 'idle', missionId: null, power: 2 },
    ],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    ...partial,
  } as WorldState;
}

function keydown(init: KeyboardEventInit, target?: EventTarget | null): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { cancelable: true, ...init });
  if (target) Object.defineProperty(event, 'target', { value: target });
  return event;
}

const sent: ShortcutDispatchCommand[] = [];
let latest: WorldState;
const positions = new Map<string, Point>();

const ports: ShortcutPorts = {
  dispatch: (command) => sent.push(command),
  getState: () => latest,
  getUnitPosition: (unitId) => positions.get(unitId) ?? null,
};

let cleanups: (() => void)[] = [];

/** 挂一套系统并登记卸载（每个用例独立挂，afterEach 统一退）。 */
function mount(): ReturnType<typeof mountShortcuts> {
  const mounted = mountShortcuts(document.body, ports);
  cleanups.push(mounted.unmount);
  return mounted;
}

beforeEach(() => {
  sent.length = 0;
  latest = state({});
  positions.clear();
  positions.set('u1', { x: 100, y: 200 });
  positions.set('u2', { x: 300, y: 400 });
  document.body.innerHTML = '';
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
});

describe('键 → 命令分发（window keydown 真事件）', () => {
  test('Ctrl+A → unit.select 全体 id（set）', () => {
    mount();
    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }));
    expect(sent).toEqual([{ type: 'unit.select', unitIds: ['u1', 'u2'], mode: 'set' }]);
  });

  test('Esc → unit.select 空（set）', () => {
    mount();
    window.dispatchEvent(keydown({ key: 'Escape' }));
    expect(sent).toEqual([{ type: 'unit.select', unitIds: [], mode: 'set' }]);
  });

  test('Ctrl+2 → 编组存入；裸 2 → 编组召回', () => {
    mount();
    window.dispatchEvent(keydown({ key: '2', ctrlKey: true }));
    window.dispatchEvent(keydown({ key: '2' }));
    expect(sent).toEqual([
      { type: 'unit.group.assign', group: 2 },
      { type: 'unit.group.recall', group: 2 },
    ]);
  });

  test('Space → camera.center 到选中质心（有位置时）', () => {
    mount();
    latest = state({ selection: { unitIds: ['u1', 'u2'], previewUnitIds: [], revision: 1 } });
    window.dispatchEvent(keydown({ key: ' ' }));
    expect(sent).toEqual([{ type: 'camera.center', x: 200, y: 300 }]);
  });

  test('Space 无选中 → camera.center 世界中心', () => {
    mount();
    window.dispatchEvent(keydown({ key: ' ' }));
    // WORLD_BOUNDS 3200×2400 → 中心 (1600, 1200)
    expect(sent).toEqual([{ type: 'camera.center', x: 1600, y: 1200 }]);
  });

  test('未命中键不派发、不 preventDefault', () => {
    mount();
    const event = keydown({ key: 'z' });
    window.dispatchEvent(event);
    expect(sent).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test('命中键 preventDefault（Ctrl+A 不选 DOM 文本、Space 不滚页）', () => {
    mount();
    const event = keydown({ key: 'a', ctrlKey: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe('豁免规则（焦点在输入控件里不触发）', () => {
  test('input 聚焦：Ctrl+A / 数字 / Space 全部让路', () => {
    mount();
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }, input));
    window.dispatchEvent(keydown({ key: '3' }, input));
    window.dispatchEvent(keydown({ key: ' ' }, input));

    expect(sent).toEqual([]);
  });

  test('textarea / contenteditable 同口径', () => {
    mount();
    const textarea = document.createElement('textarea');
    const rich = document.createElement('div');
    rich.setAttribute('contenteditable', 'true');
    document.body.append(textarea, rich);

    window.dispatchEvent(keydown({ key: '1', ctrlKey: true }, textarea));
    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }, rich));

    expect(sent).toEqual([]);
  });

  test('select 下拉同口径（表单控件一族）', () => {
    mount();
    const select = document.createElement('select');
    document.body.appendChild(select);

    window.dispatchEvent(keydown({ key: '1', ctrlKey: true }, select));

    expect(sent).toEqual([]);
  });

  test('按钮焦点上按 Space：让给原生激活，不抢相机', () => {
    mount();
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();

    const event = keydown({ key: ' ' }, button);
    window.dispatchEvent(event);

    expect(sent).toEqual([]);
    expect(event.defaultPrevented).toBe(false);
  });

  test('按钮焦点上按其它快捷键照常生效（只有 Space 让路）', () => {
    mount();
    const button = document.createElement('button');
    document.body.appendChild(button);

    window.dispatchEvent(keydown({ key: '1' }, button));

    expect(sent).toEqual([{ type: 'unit.group.recall', group: 1 }]);
  });
});

describe('帮助浮层开关', () => {
  test('? 开、再 ? 关；元素 opened 与管理器 helpOpen 同步', () => {
    const { manager, element } = mount();

    expect(manager.helpOpen).toBe(false);
    window.dispatchEvent(keydown({ key: '?', shiftKey: true }));
    expect(manager.helpOpen).toBe(true);
    expect(element.opened).toBe(true);

    window.dispatchEvent(keydown({ key: '?', shiftKey: true }));
    expect(manager.helpOpen).toBe(false);
    expect(element.opened).toBe(false);
  });

  test('浮层打开时 Esc 关浮层而不是取消选择；关闭后 Esc 恢复取消选择', () => {
    const { manager } = mount();

    window.dispatchEvent(keydown({ key: '?', shiftKey: true }));
    window.dispatchEvent(keydown({ key: 'Escape' }));
    expect(manager.helpOpen).toBe(false);
    expect(sent).toEqual([]); // Esc 只关了浮层，没发取消选择

    window.dispatchEvent(keydown({ key: 'Escape' }));
    expect(sent).toEqual([{ type: 'unit.select', unitIds: [], mode: 'set' }]);
  });

  test('遮罩关闭请求（×钮/点遮罩）回流管理器：浮层关闭', () => {
    const { manager } = mount();
    window.dispatchEvent(keydown({ key: '?', shiftKey: true }));
    expect(manager.helpOpen).toBe(true);

    // 浮层内部发出关闭请求（composed 冒泡到 window，manager 收口）
    window.dispatchEvent(new CustomEvent('shortcut-help-close-request'));

    expect(manager.helpOpen).toBe(false);
  });

  test('浮层开着时打字面 1 仍会召回编组（浮层不吞业务键，只重定向 Esc）', () => {
    const { manager } = mount();
    window.dispatchEvent(keydown({ key: '?', shiftKey: true }));
    window.dispatchEvent(keydown({ key: '1' }));

    expect(manager.helpOpen).toBe(true); // 数字不是浮层的键
    expect(sent).toEqual([{ type: 'unit.group.recall', group: 1 }]);
  });

  test('卸载：退监听（键不再命中）+ 浮层关闭', () => {
    const mounted = mountShortcuts(document.body, ports);
    window.dispatchEvent(keydown({ key: '?', shiftKey: true }));
    expect(mounted.manager.helpOpen).toBe(true);

    mounted.unmount();
    expect(mounted.manager.helpOpen).toBe(false);

    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }));
    expect(sent).toEqual([]);
  });
});

describe('computeCenterPoint（质心纯函数）', () => {
  const table: Record<string, Point> = {
    a: { x: 0, y: 0 },
    b: { x: 100, y: 200 },
    c: { x: 300, y: 400 },
  };
  const pos = (id: string): Point | null => table[id] ?? null;

  test('算术平均（质心）：a+b → (50,100)', () => {
    expect(computeCenterPoint(['a', 'b'], pos)).toEqual({ x: 50, y: 100 });
  });

  test('部分未知坐标：只拿已知的算（未知不拖偏）', () => {
    expect(computeCenterPoint(['a', 'ghost', 'b'], pos)).toEqual({ x: 50, y: 100 });
  });

  test('空选择 / 全未知 → 世界中心（WORLD_BOUNDS 契约常量）', () => {
    expect(computeCenterPoint([], pos)).toEqual({ x: 1600, y: 1200 });
    expect(computeCenterPoint(['ghost'], pos)).toEqual({ x: 1600, y: 1200 });
  });

  test('单个成员：其自身坐标', () => {
    expect(computeCenterPoint(['c'], pos)).toEqual({ x: 300, y: 400 });
  });
});

describe('attach 幂等（不叠监听）', () => {
  test('attach 两次再卸载一次，键击只派发一次', () => {
    const { element: help } = mountShortcutHelp(document.body);
    cleanups.push(() => help.remove());
    const manager = createShortcutManager(ports, help);
    cleanups.push(manager.attach());
    manager.attach(); // 第二次返回同一卸载闭包

    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }));
    expect(sent).toHaveLength(1);

    window.dispatchEvent(keydown({ key: 'a', ctrlKey: true }));
    expect(sent).toHaveLength(2);
  });
});
