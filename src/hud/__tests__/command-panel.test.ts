/**
 * 集成测试：命令面板 Web Component（hud/panels/command-panel.ts）。
 * 覆盖：挂载渲染、WorldState 驱动可用性、点命令 → HudCommand 经 adapter 派发、
 *   禁用命令不派发、搜索过滤、卸载后订阅释放。
 * @jest-environment jsdom
 *
 * 面板是真组件（真 Shadow DOM、真事件链、真命令构造），替身只有 adapter 两个方法
 * —— 也就是 HUD 与总线之间的全部边界。断言打在"派发出了什么命令"上，不断言像素。
 */

import type { HudCommand, MissionView, UnitView, WorldState } from '../../core/types';
import type { CommandPanelDeps } from '../panels/command-panel';
import {
  COMMAND_PANEL_TAG,
  mountCommandPanel,
  type StratCommandPanelElement,
} from '../panels/command-panel';
import { createMainScreen } from '../screens/main-screen';

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u-trinity', name: 'Trinity', status: 'busy', missionId: 'm-1', power: 5 },
];

function makeState(partial: Partial<WorldState> = {}): WorldState {
  return {
    units: UNITS,
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
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
  readonly deps: CommandPanelDeps;
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  /** 当前挂着的订阅数（验证卸载后没有泄漏）。 */
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(): { panel: StratCommandPanelElement; host: HTMLElement; harness: Harness } {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: CommandPanelDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountCommandPanel(deps, host);
  const panel = host.querySelector(COMMAND_PANEL_TAG) as StratCommandPanelElement;
  if (!panel?.shadowRoot) throw new Error('命令面板未 upgrade（shadowRoot 为空）');

  return {
    panel,
    host,
    harness: {
      commands,
      deps,
      emit: (state) => { subs.forEach((handler) => handler(state)); },
      subscriberCount: () => subs.size,
      unmount: () => { unmountPanel(); host.remove(); },
    },
  };
}

/** 进 shadow DOM 点真实按钮：走组件自己的事件链，不直接调方法。 */
function clickCommand(panel: StratCommandPanelElement, id: string, scope: string): void {
  const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
    `button[data-command="${id}"][data-scope="${scope}"]`
  );
  if (!btn) throw new Error(`命令按钮未渲染: ${scope}/${id}`);
  btn.click();
}

function setDraft(panel: StratCommandPanelElement, title: string): void {
  const input = panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="draft"]');
  if (!input) throw new Error('任务标题输入框未渲染');
  input.value = title;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setQuery(panel: StratCommandPanelElement, query: string): void {
  const input = panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="query"]');
  if (!input) throw new Error('搜索输入框未渲染');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

const isEnabled = (panel: StratCommandPanelElement, id: string, scope: string): boolean =>
  panel.shadowRoot?.querySelector(`[data-command="${id}"][data-scope="${scope}"]`)
    ?.getAttribute('data-enabled') === 'true';

let mounted: Array<() => void> = [];

afterEach(() => {
  mounted.forEach((dispose) => dispose());
  mounted = [];
  document.body.innerHTML = '';
});

describe('渲染', () => {
  test('挂载后渲染出全局命令入口（没选中单位时也有命令可用）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    expect(panel.visibleCommandIds).toEqual(expect.arrayContaining(['settings.open', 'chat.open']));
    // 未选中时不渲染选中组，命令入口绝不空
    expect(panel.shadowRoot?.querySelector('[data-scope="selection"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('[data-role="selection"]')?.textContent).toBe('未选中单位');
  });

  test('收到带选择集的 state 后，选中组出现且命令可用性随状态翻转', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    expect(isEnabled(panel, 'mission.create', 'global')).toBe(false); // 没标题

    harness.emit(selected('u-neo'));
    setDraft(panel, '重构总线');

    expect(panel.shadowRoot?.querySelector('[data-scope="selection"]')).not.toBeNull();
    expect(isEnabled(panel, 'mission.create', 'selection')).toBe(true);
    expect(isEnabled(panel, 'mission.confirm', 'selection')).toBe(false); // 还没有待确认任务
    expect(isEnabled(panel, 'selection.clear', 'selection')).toBe(true);
  });

  test('state 里的通知显示在面板顶部', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit({
      ...makeState(),
      notices: [
        { id: 'n-1', level: 'warn', text: '代理掉线', createdAt: 0, expiresAt: 9_999_999_999_999 },
      ],
    });

    const notice = panel.shadowRoot?.querySelector('[data-role="notices"] .notice');
    expect(notice?.textContent).toBe('代理掉线');
    expect(notice?.getAttribute('data-level')).toBe('warn');
  });
});

describe('命令派发：一切经注入的 adapter，不碰 core 内部', () => {
  test('选中后发起任务 → mission.create 带真实选择集', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo', 'u-trinity'));
    setDraft(panel, '重构总线');
    clickCommand(panel, 'mission.create', 'selection');

    expect(harness.commands).toEqual([
      { type: 'mission.create', title: '重构总线', unitIds: ['u-neo', 'u-trinity'] },
    ]);
  });

  test('未选中时点全局「新建任务」→ unitIds 为空的待指派草稿', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setDraft(panel, '待指派的任务');
    clickCommand(panel, 'mission.create', 'global');

    expect(harness.commands).toEqual([
      { type: 'mission.create', title: '待指派的任务', unitIds: [] },
    ]);
  });

  test('有 pending 任务时点确认 → mission.confirm 带真实 missionId', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const mission: MissionView = {
      id: 'm-42',
      title: '联调 hello loop',
      phase: 'pending',
      unitIds: ['u-neo'],
      createdAt: 1,
    };
    harness.emit({ ...selected('u-neo'), missions: [mission] });

    expect(isEnabled(panel, 'mission.confirm', 'selection')).toBe(true);
    clickCommand(panel, 'mission.confirm', 'selection');

    expect(harness.commands).toEqual([
      { type: 'mission.confirm', missionId: 'm-42', decision: 'accept' },
    ]);
  });

  test('导航 / 皮肤 / 取消选择命令各自落到对应契约变体', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickCommand(panel, 'chat.open', 'global');
    clickCommand(panel, 'settings.open', 'global');
    clickCommand(panel, 'theme.pixel', 'global');
    clickCommand(panel, 'selection.clear', 'selection');

    expect(harness.commands).toEqual([
      { type: 'ui.navigate', screen: 'chat' },
      { type: 'ui.navigate', screen: 'settings' },
      { type: 'theme.set', themeId: 'pixel' },
      { type: 'unit.select', unitIds: [], mode: 'set' },
    ]);
  });

  test('禁用的命令点下去什么都不发（不发半截命令给 core）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    // 故意不填标题：发起任务处于禁用态
    expect(isEnabled(panel, 'mission.create', 'selection')).toBe(false);

    clickCommand(panel, 'mission.create', 'selection');
    clickCommand(panel, 'mission.confirm', 'selection');
    clickCommand(panel, 'mission.cancel', 'selection');

    expect(harness.commands).toEqual([]);
  });

  test('同一次点击只派发一条命令（theme.set 不会双发）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    clickCommand(panel, 'theme.default', 'global');
    expect(harness.commands).toEqual([{ type: 'theme.set', themeId: 'default' }]);
  });
});

describe('搜索', () => {
  test('输入查询词后命令列表按子序列匹配收敛', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, 'sett');
    const ids = panel.visibleCommandIds;
    expect(ids).toContain('settings.open');
    expect(ids).not.toContain('chat.open');
  });

  test('搜不到时显示空态而不是空白面板', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, 'zzzz不存在');
    expect(panel.visibleCommandIds).toHaveLength(0);
    expect(panel.shadowRoot?.querySelector('[data-role="empty"]')?.textContent).toBe('没有匹配的命令');
  });

  test('清空搜索词后命令全部回来', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, 'sett');
    setQuery(panel, '');
    expect(panel.visibleCommandIds).toEqual(expect.arrayContaining(['settings.open', 'chat.open']));
  });
});

describe('渲染判重与资源清理', () => {
  test('重复收到同一份 state 不会重建 DOM（高频广播下的 perf 护栏）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const state = selected('u-neo');
    harness.emit(state);
    const first = panel.shadowRoot?.querySelector('[data-command="settings.open"]');

    harness.emit({ ...state });
    const second = panel.shadowRoot?.querySelector('[data-command="settings.open"]');

    expect(second).toBe(first); // 同一个节点 = 没重建
  });

  test('卸载后订阅被释放，不再响应后续广播（不泄漏监听器）', () => {
    const { panel, harness } = mountPanel();

    expect(harness.subscriberCount()).toBe(1);
    harness.unmount();
    expect(harness.subscriberCount()).toBe(0);

    // 卸载后再来广播：面板不再更新
    const before = panel.visibleCommandIds;
    harness.emit(selected('u-neo'));
    expect(panel.visibleCommandIds).toEqual(before);
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
  test('主屏把命令面板挂进 body，且共用同一条派发通道', () => {
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

    const panel = host.querySelector(COMMAND_PANEL_TAG) as StratCommandPanelElement;
    if (!panel?.shadowRoot) throw new Error('主屏未挂上命令面板');

    // 走真实的订阅链广播：选中两个单位 → 面板出现选中组
    subs.forEach((handler) =>
      handler({
        ...makeState(),
        selection: { unitIds: ['u-neo', 'u-trinity'], previewUnitIds: [], revision: 1 },
      })
    );
    setDraft(panel, '联调验收');

    const createBtn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
      'button[data-command="mission.create"][data-scope="selection"]'
    );
    if (!createBtn) throw new Error('主屏里的命令面板没渲染出「发起任务」');
    createBtn.click();

    expect(commands).toEqual([
      { type: 'mission.create', title: '联调验收', unitIds: ['u-neo', 'u-trinity'] },
    ]);

    unmount();
    host.remove();
    // 主屏卸载后面板随之退订，订阅归零
    expect(subs.size).toBe(0);
  });
});