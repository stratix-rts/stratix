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
import { NEW_TASK_OPEN_EVENT } from '../components/new-task-dialog/new-task-dialog';

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

/**
 * 写任务标题（@since v3.10，task_154 后的新路径）。
 * 常驻的「任务标题」输入框已删（底栏双框合一）：标题现在住在**任务条的行内 chip** 上，
 *   而任务条只在 composer 里是「大段提示词」时浮现 —— 所以先写一段提示词，再改 chip。
 */
function setDraft(panel: StratCommandPanelElement, title: string): void {
  setQuery(panel, `${title}\n（测试用第二行：让输入被判为提示词）`);
  const chip = panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="task-title"]');
  if (!chip) throw new Error('任务条未浮现（长文本输入后应出现）');
  chip.value = title;
  chip.dispatchEvent(new Event('input', { bubbles: true }));
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

    setQuery(panel, 'help');
    pressInComposer(panel, { key: 'Enter' });

    const output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toContain('mission <标题>');
    expect(output).toContain('replay');
  });

  test('Shift+Enter 不执行（换行）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, 'help');
    pressInComposer(panel, { key: 'Enter', shiftKey: true });

    const output = panel.shadowRoot?.querySelector('[data-role="output"]')?.textContent ?? '';
    expect(output).toBe('');
  });

  test('IME 合成中的回车不执行命令', async () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '你好世界');
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

  test('多行提示词 → 任务条浮现（标题取首行、行内可改），点「发起」才走任务通路', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const opened: string[] = [];
    const onOpen = (event: Event): void => {
      opened.push((event as CustomEvent<{ title?: string }>).detail?.title ?? '');
    };
    document.addEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    try {
      const prompt = `第一行：把总线重构一遍\n第二行：记得补测试\n第三行：跑一遍 jest`;
      setQuery(panel, prompt);

      // ① 任务条浮现，标题自动取首行（≤30 字）。
      const bar = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="task-bar"]');
      expect(bar?.hidden).toBe(false);
      const chip = panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="task-title"]');
      expect(chip?.value).toBe('第一行：把总线重构一遍');
      // 回车 = 确认提示词就绪（不直接弹窗：标题要先给他改）。
      pressInComposer(panel, { key: 'Enter' });
      expect(opened).toEqual([]);

      // ② 行内改标题 → ③ 点「发起」→ 走既有任务通路（新建任务对话框）。
      chip!.value = '重构总线';
      chip!.dispatchEvent(new Event('input', { bubbles: true }));
      const submit = panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="task-submit"]');
      expect(submit?.disabled).toBe(false);
      submit!.click();

      expect(opened).toEqual(['重构总线']);
    } finally {
      document.removeEventListener(NEW_TASK_OPEN_EVENT, onOpen);
    }
  });

  test('标题为空 → 「发起」禁用并给出原因（必填校验，task_154）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    setQuery(panel, '一段足够长的提示词，长度超过八十个字符才会被判定为提示词模式，所以这里多写一点内容凑够长度。');
    const chip = panel.shadowRoot?.querySelector<HTMLInputElement>('[data-role="task-title"]');
    expect(chip).not.toBeNull();
    chip!.value = '';
    chip!.dispatchEvent(new Event('input', { bubbles: true }));

    const submit = panel.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="task-submit"]');
    expect(submit?.disabled).toBe(true);
    expect(submit?.title).toBe('先给任务起个标题');
    const reason = panel.shadowRoot?.querySelector<HTMLElement>('[data-role="task-reason"]');
    expect(reason?.hidden).toBe(false);
    expect(reason?.textContent).toBe('先给任务起个标题');
  });

  test('底部只有一个输入框：常驻的「任务标题」框已删（双框合一，task_154）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const inputs = panel.shadowRoot?.querySelectorAll('input');
    // 唯一的一个 input 是任务条上的行内 chip（未浮现时它也在 DOM 里，但任务条是隐藏的）。
    const roles = Array.from(inputs ?? []).map((el) => (el as HTMLElement).dataset.role);
    expect(roles).toEqual(['task-title']);
    expect(panel.shadowRoot?.querySelector('[data-role="draft"]')).toBeNull();
    expect(panel.shadowRoot?.querySelectorAll('textarea')).toHaveLength(1);
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