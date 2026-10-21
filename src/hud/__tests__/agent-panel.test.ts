/**
 * 集成测试：Agent 侧栏 Web Component（hud/panels/agent-panel.ts）。
 * 覆盖：空/单选/编组三形态渲染、与 selection 的实时联动、三条交互 → HudCommand 经 adapter 派发、
 *   高频广播下的渲染判重、卸载后订阅释放、装配进 main-screen。
 * @jest-environment jsdom
 *
 * 面板是真组件（真 Shadow DOM、真事件链），替身只有 adapter 两个方法
 * —— 也就是 HUD 与总线之间的全部边界。断言打在"派发出了什么命令 / 画出了什么读数"上，不断言像素。
 */

import type { HudCommand, UnitView, WorldState } from '../../core/types';
import {
  AGENT_PANEL_TAG,
  mountAgentPanel,
  type AgentPanelDeps,
  type StratAgentPanelElement,
} from '../panels/agent-panel';
import { createMainScreen } from '../screens/main-screen';

const UNITS: UnitView[] = [
  {
    id: 'u-neo',
    name: 'Neo',
    status: 'busy',
    missionId: 'm-1',
    power: 72,
    characterId: 'c-neo',
    capabilities: {
      overall: 72,
      level: '优秀',
      dimensions: { offense: 80, defense: 60, mobility: 55, magic: 90, survivability: 65, utility: 40 },
    },
  },
  { id: 'u-trinity', name: 'Trinity', status: 'idle', missionId: null, power: 41 },
  { id: 'u-morpheus', name: 'Morpheus', status: 'offline', missionId: null, power: 12 },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [{ id: 'm-1', title: '联调 hello loop', phase: 'running', unitIds: ['u-neo'], createdAt: 1 }],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [{ id: 'c-neo', name: 'Neo 档案', persona: '严谨的实现者', level: 3, experience: 120 }],
    notices: [],
    links: [],
    messages: [],
    ...partial,
  };
}

const selected = (...ids: string[]): WorldState =>
  makeState({ selection: { unitIds: ids, previewUnitIds: [], revision: ids.length } });

interface Harness {
  readonly commands: HudCommand[];
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  /** 当前挂着的订阅数（验证卸载后没有泄漏）。 */
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(): { panel: StratAgentPanelElement; host: HTMLElement; harness: Harness } {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: AgentPanelDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountAgentPanel(deps, host);
  const panel = host.querySelector(AGENT_PANEL_TAG) as StratAgentPanelElement;
  if (!panel?.shadowRoot) throw new Error('Agent 侧栏未 upgrade（shadowRoot 为空）');

  return {
    panel,
    host,
    harness: {
      commands,
      emit: (state) => { subs.forEach((handler) => handler(state)); },
      subscriberCount: () => subs.size,
      unmount: () => { unmountPanel(); host.remove(); },
    },
  };
}

/** 进 shadow DOM 点真实按钮：走组件自己的事件链，不直接调方法。 */
function clickAction(panel: StratAgentPanelElement, action: string, unitId: string): void {
  const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
    `button[data-action="${action}"][data-unit="${unitId}"]`
  );
  if (!btn) throw new Error(`侧栏按钮未渲染: ${action}/${unitId}`);
  btn.click();
}

const text = (panel: StratAgentPanelElement, role: string): string | null | undefined =>
  panel.shadowRoot?.querySelector(`[data-role="${role}"]`)?.textContent;

let mounted: Array<() => void> = [];

afterEach(() => {
  mounted.forEach((dispose) => dispose());
  mounted = [];
  document.body.innerHTML = '';
});

describe('渲染：三种形态随选择集切换', () => {
  test('刚挂载（还没收到 state）显示等待态，不报错', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    expect(panel.mode).toBe('empty');
    expect(text(panel, 'summary')).toBe('等待世界状态…');
  });

  test('未选中 → 空态引导；单选 → 详情（名称/状态/战力/任务/成长/能力）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(makeState());
    expect(panel.mode).toBe('empty');
    expect(text(panel, 'empty')).toContain('在战场上点选单位');

    harness.emit(selected('u-neo'));
    expect(panel.mode).toBe('single');
    expect(text(panel, 'summary')).toBe('Neo');
    expect(text(panel, 'unit-name')).toBe('Neo');
    expect(panel.shadowRoot?.querySelector('[data-role="status"]')?.getAttribute('data-status')).toBe('busy');
    expect(text(panel, 'status')).toBe('忙碌');
    expect(text(panel, 'power')).toBe('72');
    expect(text(panel, 'mission')).toBe('联调 hello loop · 进行中');
    expect(text(panel, 'growth')).toBe('Neo 档案 · Lv.3 · EXP 120');
    expect(text(panel, 'cap-level')).toBe('优秀 72');

    // 能力六维按契约词表全画出来
    const bars = panel.shadowRoot?.querySelectorAll('[data-cap]');
    expect(Array.from(bars ?? []).map((b) => b.getAttribute('data-cap'))).toEqual([
      'offense', 'defense', 'mobility', 'magic', 'survivability', 'utility',
    ]);
  });

  test('多选 → 编组列表：每行带状态徽标、战力、在办任务', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo', 'u-trinity'));

    expect(panel.mode).toBe('group');
    expect(text(panel, 'summary')).toBe('已选中 2 个单位');
    expect(panel.visibleUnitIds).toEqual(['u-neo', 'u-trinity']);

    const row = panel.shadowRoot?.querySelector('.row[data-unit="u-neo"]');
    expect(row?.textContent).toContain('Neo');
    expect(row?.textContent).toContain('忙碌');
    expect(row?.textContent).toContain('战力 72');
    expect(row?.textContent).toContain('联调 hello loop');
  });

  test('单选 → 多选 → 单选 实时联动（core 一广播就跟着换形态）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    expect(panel.mode).toBe('single');

    harness.emit(selected('u-neo', 'u-trinity'));
    expect(panel.mode).toBe('group');
    expect(panel.visibleUnitIds).toEqual(['u-neo', 'u-trinity']);

    harness.emit(selected('u-neo'));
    expect(panel.mode).toBe('single');

    harness.emit(makeState());
    expect(panel.mode).toBe('empty');
  });

  test('能力数据缺失时显示「未评估」，不拿战力冒充六维', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-trinity')); // 无 capabilities、无 characterId
    expect(text(panel, 'capabilities')).toBe('未评估');
    expect(text(panel, 'growth')).toBe('未关联角色');
    expect(text(panel, 'mission')).toBe('无在办任务');
  });
});

describe('交互：一切经注入的 adapter 变成 HudCommand', () => {
  test('编组里点某行「查看详情」→ unit.select(set)', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo', 'u-trinity'));
    clickAction(panel, 'inspect', 'u-trinity');

    expect(harness.commands).toEqual([
      { type: 'unit.select', unitIds: ['u-trinity'], mode: 'set' },
    ]);
  });

  test('「聚焦」→ unit.focus（单选与编组两种形态都能点）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickAction(panel, 'focus', 'u-neo');

    harness.emit(selected('u-neo', 'u-trinity'));
    clickAction(panel, 'focus', 'u-trinity');

    expect(harness.commands).toEqual([
      { type: 'unit.focus', unitId: 'u-neo' },
      { type: 'unit.focus', unitId: 'u-trinity' },
    ]);
  });

  test('「移出编组」→ unit.select(toggle)，只带被点的那个 id', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo', 'u-trinity', 'u-morpheus'));
    clickAction(panel, 'remove', 'u-morpheus');

    expect(harness.commands).toEqual([
      { type: 'unit.select', unitIds: ['u-morpheus'], mode: 'toggle' },
    ]);
  });

  test('空态下点不到任何命令（没有按钮可点，也就没有命令）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(makeState());
    expect(panel.shadowRoot?.querySelector('[data-action]')).toBeNull();
    expect(harness.commands).toEqual([]);
  });
});

describe('渲染判重与资源清理', () => {
  test('重复收到同一份 state 不会重建 DOM（高频广播下的 perf 护栏）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const state = selected('u-neo');
    harness.emit(state);
    const first = panel.shadowRoot?.querySelector('[data-role="unit-name"]');

    harness.emit({ ...state });
    const second = panel.shadowRoot?.querySelector('[data-role="unit-name"]');

    expect(second).toBe(first); // 同一个节点 = 没重建
  });

  test('选中单位的读数变了才重画（签名判重是真的在起作用）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    const first = panel.shadowRoot?.querySelector('[data-role="unit-name"]');
    // 没被选中的单位变了（选择集不变）→ 签名不变 → 不重画
    harness.emit(
      makeState({
        units: [...UNITS, { id: 'u-ghost', name: 'Ghost', status: 'error', missionId: null, power: 1 }],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    expect(panel.shadowRoot?.querySelector('[data-role="unit-name"]')).toBe(first);
    // 被选中的单位变了 → 必须重画
    harness.emit(
      makeState({
        units: UNITS.map((u) => (u.id === 'u-neo' ? { ...u, name: 'Neo II' } : u)),
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 2 },
      })
    );
    expect(panel.shadowRoot?.querySelector('[data-role="unit-name"]')).not.toBe(first);
    expect(text(panel, 'unit-name')).toBe('Neo II');
  });

  test('卸载后订阅被释放，不再响应后续广播（不泄漏监听器）', () => {
    const { panel, harness } = mountPanel();

    expect(harness.subscriberCount()).toBe(1);
    harness.unmount();
    expect(harness.subscriberCount()).toBe(0);

    const before = panel.mode;
    harness.emit(selected('u-neo'));
    expect(panel.mode).toBe(before);
  });

  test('反复挂载卸载不会把订阅堆起来', () => {
    for (let i = 0; i < 5; i++) {
      const { harness } = mountPanel();
      expect(harness.subscriberCount()).toBe(1);
      harness.unmount();
      expect(harness.subscriberCount()).toBe(0);
    }
  });
});

describe('装配进 main-screen（dev 页走的就是这条路径）', () => {
  test('主屏把命令面板与 Agent 侧栏并排挂上，共用同一条派发通道', () => {
    const commands: HudCommand[] = [];
    const subs = new Set<(state: WorldState) => void>();
    const adapter = {
      dispatch: (command: HudCommand) => { commands.push(command); },
      subscribe: (handler: (state: WorldState) => void) => {
        subs.add(handler);
        return () => { subs.delete(handler); };
      },
      mount: () => () => { /* 本用例不关心 core 订阅 */ },
      latest: null,
    };

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmount = createMainScreen(adapter).mount(host);

    const panel = host.querySelector(AGENT_PANEL_TAG) as StratAgentPanelElement;
    if (!panel?.shadowRoot) throw new Error('主屏未挂上 Agent 侧栏');

    // 走真实的订阅链广播：选中两个单位 → 侧栏切到编组形态
    subs.forEach((handler) => handler(selected('u-neo', 'u-trinity')));
    expect(panel.mode).toBe('group');
    expect(panel.visibleUnitIds).toEqual(['u-neo', 'u-trinity']);

    clickAction(panel, 'focus', 'u-neo');
    expect(commands).toEqual([{ type: 'unit.focus', unitId: 'u-neo' }]);

    unmount();
    host.remove();
    // 主屏卸载后面板随之退订，订阅归零
    expect(subs.size).toBe(0);
  });
});