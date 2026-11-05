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
import { MISSION_TITLE_PENDING } from '../../core/types';
import type { CommandPanelDeps } from '../panels/command-panel';
import {
  COMMAND_PANEL_TAG,
  mountCommandPanel,
  type StratCommandPanelElement,
} from '../panels/command-panel';
import { createMainScreen } from '../screens/main-screen';
import { NEW_TASK_OPEN_EVENT } from '../components/new-task-dialog/new-task-dialog';

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u-trinity', name: 'Trinity', status: 'busy', missionId: 'm-1', power: 5 },
];

/** 一个有角色档案、有单位、且角色绑了 agent 的世界（提示词直发需要承接人）。 */
const AGENT_UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3, characterId: 'c-neo' },
];

function withAgent(partial: Partial<WorldState> = {}): WorldState {
  return makeState({
    units: AGENT_UNITS,
    characters: [
      {
        id: 'c-neo',
        name: 'Neo',
        persona: '重构好手',
        level: 1,
        experience: 0,
        agentKind: 'claude-code',
      },
    ],
    ...partial,
  });
}

/** 一条任务单（夹具）。 */
function mission(id: string, title: string, phase: MissionView['phase']): MissionView {
  return { id, title, phase, unitIds: ['u-neo'], createdAt: 1 };
}

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

/**
 * 在 composer 里敲一句（@since v3.11，task_155 后的新路径）。
 *
 * 任务条上的**行内标题 chip 已删**（154 建的，155 收编）：发起流程里不再有标题编辑环节，
 *   标题由 Agent 首轮回报生成。composer 里敲的字实时派生出标题草稿（首行、≤30 字），
 *   「新建任务 / 发起任务」按钮与 ⌘K 面板读的是这一份（draft-store 是唯一那份）。
 */
function setDraft(panel: StratCommandPanelElement, title: string): void {
  setQuery(panel, title);
}

function setQuery(panel: StratCommandPanelElement, query: string): void {
  const input = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="query"]');
  if (!input) throw new Error('搜索输入框未渲染');
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 在命令面板的编辑区里敲一个键（走 composer 自己的键位契约）。 */
function pressInComposer(
  panel: StratCommandPanelElement,
  init: { key: string; shiftKey?: boolean; metaKey?: boolean; isComposing?: boolean }
): KeyboardEvent {
  const el = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="query"]');
  if (!el) throw new Error('命令编辑区未渲染');
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

  test('未选中时点全局「新建任务」→ 不直发命令，改为请求打开新建任务对话框（task_112）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const opened: string[] = [];
    const onOpen = (event: Event): void => {
      opened.push((event as CustomEvent<{ title?: string }>).detail?.title ?? '');
    };
    document.addEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    try {
      setDraft(panel, '待指派的任务');
      clickCommand(panel, 'mission.create', 'global');

      // 面板只发「开对话框」的 DOM 事件 —— 任务由用户在对话框里选一种发起方式。
      expect(harness.commands).toEqual([]);
      expect(opened).toEqual(['待指派的任务']);
    } finally {
      document.removeEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    }
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
  test('命令模式（/ 开头）下按子序列匹配收敛命令清单', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '/sett');
    const ids = panel.visibleCommandIds;
    expect(ids).toContain('settings.open');
    expect(ids).not.toContain('chat.open');
  });

  test('提示词模式（非 / 开头）不再筛命令 —— 清单保持完整（@since v3.11，task_155）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, 'sett');
    expect(panel.visibleCommandIds).toEqual(expect.arrayContaining(['settings.open', 'chat.open']));
  });

  test('命令模式下搜不到 → 引导语说清没匹配（不再是空白面板）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '/zzzz不存在');
    expect(panel.visibleCommandIds).toHaveLength(0);
    const hint = panel.shadowRoot?.querySelector('[data-role="composer-hint"]');
    expect(hint?.textContent).toContain('没有匹配的命令');
  });

  test('清空搜索词后命令全部回来', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '/sett');
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

describe('提示词 composer（@since v3.9，task_144）', () => {
  test('输入面是多行编辑区（textarea），不是单行 input', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const el = panel.shadowRoot?.querySelector('[data-role="query"]');
    expect(el?.tagName).toBe('TEXTAREA');
    // 字号至少 md（14px）—— 提示词是产品本体，输入面不能比回执还小。
    const style = panel.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(style).toContain('textarea.composer');
    expect(style).toContain('--srf-font-size-md');
  });

  test('编辑区里回车 = 执行命令（help 列出五命令）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '/help');
    pressInComposer(panel, { key: 'Enter' });

    const output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toContain('mission <标题>');
    expect(output).toContain('replay');
  });

  test('Shift+Enter 不执行（换行）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '/help');
    pressInComposer(panel, { key: 'Enter', shiftKey: true });

    const output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toBe('');
  });

  test('IME 合成中的回车不执行命令', async () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '/你好世界');
    const el = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="query"]');
    el?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    pressInComposer(panel, { key: 'Enter', isComposing: true });

    let output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toBe('');

    el?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    pressInComposer(panel, { key: 'Enter' });

    // 合成完成后再回车 → 走命令行（未匹配 → 有回执，而不是静默）。
    output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toContain('没有匹配的命令');
  });

  test('非 / 开头回车 → 直接发起任务，没有标题确认步骤（@since v3.11，task_155）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(withAgent());

    const opened: string[] = [];
    const onOpen = (event: Event): void => {
      opened.push((event as CustomEvent<{ title?: string }>).detail?.title ?? '');
    };
    document.addEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    try {
      setQuery(panel, '把总线重构一遍');
      pressInComposer(panel, { key: 'Enter' });

      // ① 直接派任务：一条 task.assign（带上立任务单的 createMission）。
      expect(harness.commands).toHaveLength(1);
      expect(harness.commands[0]).toMatchObject({
        type: 'task.assign',
        characterId: 'c-neo',
        prompt: '把总线重构一遍',
      });
      // ② 没有标题确认环节：不弹新建任务对话框，也不再要用户填标题。
      expect(opened).toEqual([]);
      expect(panel.shadowRoot?.querySelector('[data-role="task-title"]')).toBeNull();
      expect(panel.shadowRoot?.querySelector('[data-role="task-submit"]')).toBeNull();
    } finally {
      document.removeEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    }
  });

  test('多行提示词 → 仍是一句话提示词，回车直接发起（不判为命令、不弹标题）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(withAgent());

    setQuery(panel, '第一行：把总线重构一遍\n第二行：记得补测试');
    pressInComposer(panel, { key: 'Enter' });

    expect(harness.commands).toHaveLength(1);
    expect(harness.commands[0]).toMatchObject({ type: 'task.assign' });
  });

  test('没有可承接的角色 → 如实说不派发（不发注定失败的命令）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(makeState());
    setQuery(panel, '把总线重构一遍');
    pressInComposer(panel, { key: 'Enter' });

    expect(harness.commands).toEqual([]);
    const output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toContain('没有可承接的角色');
  });

  test('底部只有一个输入框：标题框与行内 chip 都没了（单框发消息，task_155）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    expect(panel.shadowRoot?.querySelectorAll('input')).toHaveLength(0);
    expect(panel.shadowRoot?.querySelector('[data-role="draft"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('[data-role="task-title"]')).toBeNull();
    expect(panel.shadowRoot?.querySelectorAll('textarea')).toHaveLength(1);
  });

  test('任务条 = 只读的在办任务回显：占位标题 → Agent 回写后的标题（@since v3.11，task_155）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const bar = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="task-bar"]');
    const title = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="task-bar-title"]');
    const phase = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="task-bar-phase"]');
    expect(bar).not.toBeNull();

    // ① 没有在办任务 → 整条收起。
    harness.emit(makeState());
    expect(bar?.hidden).toBe(true);

    // ② 发起后：标题是占位「生成中…」。
    harness.emit(makeState({ missions: [mission('m-1', MISSION_TITLE_PENDING, 'running')] }));
    expect(bar?.hidden).toBe(false);
    expect(title?.textContent).toBe(MISSION_TITLE_PENDING);
    expect(phase?.textContent).toBe('进行中');

    // ③ Agent 首轮回报回写标题 → 任务条跟着变。
    harness.emit(makeState({ missions: [mission('m-1', '重构总线', 'running')] }));
    expect(title?.textContent).toBe('重构总线');
  });

  test('卸载后 composer 的监听被摘（反复挂卸不累积）', () => {
    const { panel, harness } = mountPanel();
    const el = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="query"]');
    if (!el) throw new Error('命令编辑区未渲染');

    harness.unmount();
    // 卸载后再按键：不应有任何反应（composer 已 destroy，事件链也断了）。
    const before = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '').toBe(before);
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
      // 皮肤真相（@since task_115）：主屏要读当前皮肤，装配用的假 adapter 也要给一份。
      themeId: 'default' as const,
      subscribeTheme: () => () => undefined,
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