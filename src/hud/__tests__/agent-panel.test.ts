/**
 * 集成测试：Agent 侧栏 Web Component（hud/panels/agent-panel.ts）。
 * 覆盖：空/单选/编组三形态渲染、与 selection 的实时联动、三条交互 → HudCommand 经 adapter 派发、
 *   高频广播下的渲染判重、卸载后订阅释放、装配进 main-screen。
 * @jest-environment jsdom
 *
 * 面板是真组件（真 Shadow DOM、真事件链），替身只有 adapter 两个方法
 * —— 也就是 HUD 与总线之间的全部边界。断言打在"派发出了什么命令 / 画出了什么读数"上，不断言像素。
 */

import type { CharacterTask, HudCommand, UnitView, WorldState } from '../../core/types';
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

function mountPanel(
  depsExtra: Partial<AgentPanelDeps> = {}
): { panel: StratAgentPanelElement; host: HTMLElement; harness: Harness } {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: AgentPanelDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
    ...depsExtra,
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

/** 表单按钮（task-submit/cancel）没有 data-unit，单独一个点击口。 */
function clickFormAction(panel: StratAgentPanelElement, action: string): void {
  const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
    `button[data-action="${action}"]`
  );
  if (!btn) throw new Error(`表单按钮未渲染: ${action}`);
  btn.click();
}

/**
 * 模拟用户打字（@since v3.9，task_151）：赋值**并派发 input 事件**。
 *
 * why 必须派事件：「派发」按钮的可用态由 input/change 事件驱动重算
 *   （agent-panel.ts 的 syncSubmitState —— 空指令/缺站位时禁用 + 写明缺什么）。
 *   裸 `input.value = '…'` 不触发事件 → 按钮停在禁用态 → `.click()` 被吞 →
 *   命令端口收不到命令。口径与 chat-drawer 测试的 typeDraft 一致。
 */
function typeIssue(panel: StratAgentPanelElement, value: string): void {
  const input = panel.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-role="task-input"]');
  if (!input) throw new Error('议题输入框未渲染');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
    // body 里没有可点动作；表单按钮在外壳里但整块 hidden（点不到，也不产生命令）。
    expect(panel.shadowRoot?.querySelector('[data-role="body"] [data-action]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('[data-role="task-form"]')?.hasAttribute('hidden')).toBe(true);
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
      // 皮肤真相（@since task_115）：主屏要读当前皮肤，装配用的假 adapter 也要给一份。
      themeId: 'default' as const,
      subscribeTheme: () => () => undefined,
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
// ============================================================================
// 派任务表单 + 队列可见性（@since v3.17，task_038）
// ============================================================================

describe('派任务表单：提交 → 命令端口，取消 → 清理', () => {
  const taskOf = (id: string, status: 'queued' | 'running', prompt: string): CharacterTask => ({
    id,
    characterId: 'c-neo',
    prompt,
    status,
    createdAt: Number(id.slice(1)),
    startedAt: null,
    endedAt: null,
    output: '',
  });

  /** 选中带角色的单位（u-neo → c-neo）并可选注入任务队列。 */
  const selectedWithTasks = (tasks?: CharacterTask[]): WorldState =>
    makeState({
      tasks,
      selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
    });

  const formOf = (panel: StratAgentPanelElement): HTMLElement | null =>
    panel.shadowRoot?.querySelector('[data-role="task-form"]') ?? null;

  const inputOf = (panel: StratAgentPanelElement): HTMLTextAreaElement | null =>
    panel.shadowRoot?.querySelector('[data-role="task-input"]') ?? null;

  test('有角色的单位渲染「派任务」按钮；没角色的单位不渲染（也没有队列行）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    expect(panel.shadowRoot?.querySelector('button[data-action="task-open"]')).not.toBeNull();

    harness.emit(selected('u-trinity')); // 无 characterId
    expect(panel.shadowRoot?.querySelector('button[data-action="task-open"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('[data-role="task-queue"]')).toBeNull();
  });

  test('打开 → textarea 可见且聚焦；提交 → task.assign 经命令端口发出，表单关闭清空', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickAction(panel, 'task-open', 'u-neo');

    const form = formOf(panel);
    const input = inputOf(panel);
    expect(form?.hidden).toBe(false);
    expect(input).not.toBeNull();
    // shadow DOM 焦点重定向：文档层 activeElement 是宿主，真正持焦的是 shadowRoot 里的 textarea
    // （jsdom 与浏览器同一口径），断言两者其一命中即可。
    expect(document.activeElement === input || panel.shadowRoot?.activeElement === input).toBe(true);

    input!.value = '  写一份周报并同步到知识库  ';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    clickFormAction(panel, 'task-submit');

    expect(harness.commands).toEqual([
      { type: 'task.assign', characterId: 'c-neo', prompt: '写一份周报并同步到知识库' },
    ]);
    expect(formOf(panel)?.hidden).toBe(true);
    expect(inputOf(panel)?.value).toBe('');
  });

  test('取消 → 不发命令，表单关闭且草稿清空', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickAction(panel, 'task-open', 'u-neo');
    inputOf(panel)!.value = '写到一半的草稿';
    clickFormAction(panel, 'task-cancel');

    expect(harness.commands).toEqual([]);
    expect(formOf(panel)?.hidden).toBe(true);
    expect(inputOf(panel)?.value).toBe('');
  });

  test('空指令提交 → 不发命令，表单保持开着（用户接着写）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickAction(panel, 'task-open', 'u-neo');
    inputOf(panel)!.value = '   ';
    inputOf(panel)!.dispatchEvent(new Event('input', { bubbles: true }));
    clickFormAction(panel, 'task-submit');

    expect(harness.commands).toEqual([]);
    expect(formOf(panel)?.hidden).toBe(false);
  });

  test('Ctrl+Enter 在 textarea 里直接派发', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickAction(panel, 'task-open', 'u-neo');
    const input = inputOf(panel)!;
    input.value = '快捷键派发';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
    );

    expect(harness.commands).toEqual([
      { type: 'task.assign', characterId: 'c-neo', prompt: '快捷键派发' },
    ]);
    expect(formOf(panel)?.hidden).toBe(true);
  });

  test('切换单位/清空选择 → 表单自动收起（表单不跨单位存活）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickAction(panel, 'task-open', 'u-neo');
    inputOf(panel)!.value = '半截草稿';

    harness.emit(selected('u-neo', 'u-trinity')); // 切到编组 → 目标单位不再是单选详情
    expect(formOf(panel)?.hidden).toBe(true);
    expect(inputOf(panel)?.value).toBe('');
    expect(harness.commands).toEqual([]);
  });

  test('表单开着时无关广播不冲掉草稿（表单在外壳，不随 body 重建）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([taskOf('t1', 'running', '正在跑')]));
    clickAction(panel, 'task-open', 'u-neo');
    inputOf(panel)!.value = '打了一半';

    // 一次真实的状态广播（未选中单位有变化 → 签名不变；即便签名变了，表单也不重建）
    harness.emit(selectedWithTasks([taskOf('t1', 'running', '正在跑')]));
    expect(inputOf(panel)?.value).toBe('打了一半');
    expect(formOf(panel)?.hidden).toBe(false);

    // 队列读数变了 → body 重画，但 textarea 是外壳节点，草稿仍在
    harness.emit(selectedWithTasks([taskOf('t1', 'running', '正在跑'), taskOf('t2', 'queued', '新排的')]));
    expect(inputOf(panel)?.value).toBe('打了一半');
    expect(text(panel, 'task-queue')).toContain('+1');
  });
});

// ============================================================================
// 队列完整列表：取消按钮与重派按钮（@since v3.23，task_047）
// ============================================================================

describe('队列完整列表：徽标 + 取消/重派按钮的条件渲染与命令派发', () => {
  const taskOf = (
    id: string,
    status: CharacterTask['status'],
    prompt: string
  ): CharacterTask => ({
    id,
    characterId: 'c-neo',
    prompt,
    status,
    createdAt: Number(id.slice(1)),
    startedAt: null,
    endedAt: null,
    output: '',
  });

  const selectedWithTasks = (tasks: readonly CharacterTask[]): WorldState =>
    makeState({
      tasks: [...tasks],
      selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
    });

  const clickTaskAction = (panel: StratAgentPanelElement, action: string, taskId: string): void => {
    const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
      `button[data-action="${action}"][data-task="${taskId}"]`
    );
    if (!btn) throw new Error(`队列按钮未渲染: ${action}/${taskId}`);
    btn.click();
  };

  test('每条任务带状态徽标；取消按钮仅 queued，重派按钮仅 failed（running 点不到即提示）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(
      selectedWithTasks([
        taskOf('t1', 'queued', '排队的任务'),
        taskOf('t2', 'running', '正在跑的'),
        taskOf('t3', 'failed', '失败的任务'),
        taskOf('t4', 'completed', '完成的'),
        taskOf('t5', 'cancelled', '取消的'),
      ])
    );

    const items = panel.shadowRoot?.querySelectorAll('.task-item') ?? [];
    expect(Array.from(items).map((el) => el.getAttribute('data-task'))).toEqual([
      't1', 't2', 't5', 't4', 't3', // 在办 FIFO 序在前，终态按时间倒序在后（新的在前）
    ]);
    expect(items[0].querySelector('.task-badge')?.textContent).toContain('排队中');
    expect(items[1].querySelector('.task-badge')?.textContent).toContain('执行中');
    // items[2] = t5 cancelled / items[3] = t4 completed / items[4] = t3 failed
    expect(items[2].querySelector('.task-badge')?.textContent).toContain('已取消');
    expect(items[4].querySelector('.task-badge')?.textContent).toContain('已失败');

    // 取消按钮只在 queued 条目上；重派按钮只在 failed 条目上
    expect(panel.shadowRoot?.querySelector('button[data-action="task-queue-cancel"][data-task="t1"]')).not.toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-queue-cancel"][data-task="t2"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-queue-cancel"][data-task="t3"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-reassign"][data-task="t3"]')).not.toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-reassign"][data-task="t1"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-reassign"][data-task="t4"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-reassign"][data-task="t5"]')).toBeNull();
  });

  test('点「取消」→ task.cancel 经命令端口发出（载荷是任务 id）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([taskOf('t1', 'queued', '排队的任务')]));
    clickTaskAction(panel, 'task-queue-cancel', 't1');

    expect(harness.commands).toEqual([{ type: 'task.cancel', taskId: 't1' }]);
  });

  test('点「重派」→ task.assign 同 prompt 新任务（复用派发表单的命令构造，prompt 是全文）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    const longPrompt = '重写这份很长的侦察报告并同步到知识库'.repeat(3);
    harness.emit(selectedWithTasks([taskOf('t1', 'failed', longPrompt)]));
    clickTaskAction(panel, 'task-reassign', 't1');

    expect(harness.commands).toEqual([
      { type: 'task.assign', characterId: 'c-neo', prompt: longPrompt },
    ]);
  });

  test('无任务的角色不渲染列表区（读数「空闲」，没有空列表壳）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([]));
    expect(text(panel, 'task-queue')).toBe('空闲');
    expect(panel.shadowRoot?.querySelector('[data-role="task-list"]')).toBeNull();
  });

  test('取消落地后（相位广播）列表重画：取消按钮消失，徽标变「已取消」（签名覆盖条目变化）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([taskOf('t1', 'queued', '排队的任务')]));
    const before = panel.shadowRoot?.querySelector('.task-item');
    expect(before?.getAttribute('data-status')).toBe('queued');

    harness.emit(
      selectedWithTasks([
        { ...taskOf('t1', 'cancelled', '排队的任务'), endedAt: 9, output: '任务在排队时被取消' },
      ])
    );
    const after = panel.shadowRoot?.querySelector('.task-item');
    expect(after).not.toBe(before);
    expect(after?.getAttribute('data-status')).toBe('cancelled');
    expect(after?.querySelector('.task-badge')?.textContent).toContain('已取消');
    expect(panel.shadowRoot?.querySelector('button[data-action="task-queue-cancel"]')).toBeNull();
  });
});

describe('队列可见性：当前任务摘要 + 排队数', () => {
  const taskOf = (id: string, status: 'queued' | 'running', prompt: string): CharacterTask => ({
    id,
    characterId: 'c-neo',
    prompt,
    status,
    createdAt: Number(id.slice(1)),
    startedAt: null,
    endedAt: null,
    output: '',
  });

  test('running 优先显示；排队数以 +N 呈现；无任务显示空闲', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(
      makeState({
        tasks: [taskOf('t1', 'queued', '先排的'), taskOf('t2', 'running', '正在跑的任务'), taskOf('t3', 'queued', '后又排的')],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    expect(text(panel, 'task-queue')).toContain('正在跑的任务');
    expect(text(panel, 'queue-badge')).toBe('+2');

    harness.emit(makeState({ selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 } }));
    expect(text(panel, 'task-queue')).toBe('空闲');
  });

  test('长指令 40 字截断（卡片读数不撑爆）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(
      makeState({
        tasks: [taskOf('t1', 'running', '长'.repeat(60))],
        selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
      })
    );
    const summary = text(panel, 'task-queue') ?? '';
    expect(summary.length).toBe(41); // 40 字 + 省略号
    expect(summary.endsWith('…')).toBe(true);
  });
});


// ============================================================================
// 审批卡（task_049）：awaiting_approval 任务 → 计划全文 + 批准 / 驳回
// ============================================================================

describe('审批卡：条件渲染与命令派发（task_049）', () => {
  const taskOf = (
    id: string,
    status: CharacterTask['status'],
    patch: Partial<CharacterTask> = {}
  ): CharacterTask => ({
    id,
    characterId: 'c-neo',
    prompt: '重构登录模块',
    status,
    createdAt: Number(id.slice(1)),
    startedAt: null,
    endedAt: null,
    output: '',
    ...patch,
  });

  const selectedWithTasks = (tasks: readonly CharacterTask[]): WorldState =>
    makeState({
      tasks: [...tasks],
      selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
    });

  const clickTaskAction = (panel: StratAgentPanelElement, action: string, taskId: string): void => {
    const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
      `button[data-action="${action}"][data-task="${taskId}"]`
    );
    if (!btn) throw new Error(`审批按钮未渲染: ${action}/${taskId}`);
    btn.click();
  };

  test('awaiting 任务 → 审批卡渲染计划全文与指令摘要；批准 / 驳回按钮在卡上', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(
      selectedWithTasks([taskOf('t1', 'awaiting_approval', { plan: '一、摸底\n二、动手' })])
    );

    const card = panel.shadowRoot?.querySelector('[data-role="approval-card"][data-task="t1"]');
    expect(card).not.toBeNull();
    expect(card?.querySelector('.approval-plan')?.textContent).toContain('一、摸底\n二、动手');
    expect(card?.querySelector('.approval-head')?.textContent).toContain('计划待审批');
    expect(card?.querySelector('.approval-summary')?.textContent).toContain('重构登录模块');
    // 计划是 pre-wrap 展示（不折叠不截断 —— 逐条核对才是审批）
    expect(card?.querySelector('.approval-plan')?.getAttribute('class')).toContain('approval-plan');
    expect(panel.shadowRoot?.querySelector('button[data-action="task-approve"][data-task="t1"]')).not.toBeNull();
    expect(panel.shadowRoot?.querySelector('button[data-action="task-reject"][data-task="t1"]')).not.toBeNull();
  });

  test('点批准 → dispatch(task.approve)；点驳回 → dispatch(task.reject)', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([taskOf('t2', 'awaiting_approval', { plan: 'p' })]));
    clickTaskAction(panel, 'task-approve', 't2');
    expect(harness.commands.at(-1)).toEqual({ type: 'task.approve', taskId: 't2' });

    clickTaskAction(panel, 'task-reject', 't2');
    expect(harness.commands.at(-1)).toEqual({ type: 'task.reject', taskId: 't2' });
  });

  test('相位翻转卡即消失：批准回 running / 驳回成 failed 都不再有审批卡', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([taskOf('t3', 'awaiting_approval', { plan: 'p' })]));
    expect(panel.shadowRoot?.querySelector('[data-role="approval-card"]')).not.toBeNull();

    harness.emit(selectedWithTasks([taskOf('t3', 'running', { plan: 'p' })]));
    expect(panel.shadowRoot?.querySelector('[data-role="approval-card"]')).toBeNull();

    // 驳回路径同理：failed 后队列里还有这条（带已失败徽标），但审批卡没了
    harness.emit(selectedWithTasks([taskOf('t4', 'awaiting_approval', { plan: 'p' })]));
    harness.emit(selectedWithTasks([taskOf('t4', 'failed', { output: '计划被驳回', plan: 'p' })]));
    expect(panel.shadowRoot?.querySelector('[data-role="approval-card"]')).toBeNull();
    expect(panel.shadowRoot?.querySelector('.task-item[data-task="t4"] .task-badge')?.textContent).toContain('已失败');
  });

  test('无 awaiting 任务（或未选单位）→ 不渲染审批卡；计划里的 HTML 转义后展示', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selectedWithTasks([taskOf('t5', 'running')]));
    expect(panel.shadowRoot?.querySelector('[data-role="approval-card"]')).toBeNull();

    // 计划里带标签字符 → 转义进文本节点，不进 DOM（escapeHtml 口径与队列摘要同款）
    harness.emit(selectedWithTasks([taskOf('t6', 'awaiting_approval', { plan: '<script>evil()</script>' })]));
    const plan = panel.shadowRoot?.querySelector('[data-role="approval-card"] .approval-plan');
    expect(plan?.textContent).toContain('<script>evil()</script>');
    expect(panel.shadowRoot?.querySelector('[data-role="approval-card"] script')).toBeNull();
  });
});

// ============================================================================
// 「交给谁」选择器（@since v3.26，task_050）
// ============================================================================

describe('派发智能推荐：「交给谁」选择器（task_050）', () => {
  /** 两角色档案：c-neo=kimi（表单角色，忙）；c-trin=openclaw（空闲+专属预设 → 推荐）。 */
  const boundState = (tasks: CharacterTask[]): WorldState =>
    makeState({
      characters: [
        { id: 'c-neo', name: 'Neo', persona: '', level: 3, experience: 120, agentKind: 'kimi' },
        { id: 'c-trin', name: 'Trinity', persona: '', level: 1, experience: 0, agentKind: 'openclaw' },
      ],
      tasks,
      selection: { unitIds: ['u-neo'], previewUnitIds: [], revision: 1 },
    });

  const runningOn = (characterId: string): CharacterTask => ({
    id: `t-${characterId}`,
    characterId,
    prompt: '在办的活',
    status: 'running',
    createdAt: 1,
    startedAt: null,
    endedAt: null,
    output: '',
  });

  /** 进 shadow DOM 点候选人卡（data-character 口径，与单位按钮的 data-unit 不同）。 */
  const clickAssignee = (panel: StratAgentPanelElement, action: string, character?: string): void => {
    const selector = character
      ? `button[data-action="${action}"][data-character="${character}"]`
      : `button[data-action="${action}"]`;
    const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(selector);
    if (!btn) throw new Error(`候选人卡未渲染: ${action}/${character ?? ''}`);
    btn.click();
  };

  const assigneeCards = (panel: StratAgentPanelElement): NodeListOf<HTMLElement> | undefined =>
    panel.shadowRoot?.querySelectorAll('[data-role="assignee-list"] .assignee');

  const hintText = (panel: StratAgentPanelElement): string | null | undefined =>
    panel.shadowRoot?.querySelector('[data-role="queue-hint"]')?.textContent;

  const hintHidden = (panel: StratAgentPanelElement): boolean | undefined =>
    panel.shadowRoot?.querySelector<HTMLElement>('[data-role="queue-hint"]')?.hidden;

  test('表单打开：自动卡缺省选中；候选人按推荐排序（推荐角标在第一位）+ kind 徽标 + 忙闲读数', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    // neo 在办 2 条（忙），trin 空闲 → trin 是推荐人（idle 加分压过）
    harness.emit(boundState([runningOn('c-neo'), { ...runningOn('c-neo'), id: 't-neo-2', status: 'queued' }]));
    clickAction(panel, 'task-open', 'u-neo');

    const cards = assigneeCards(panel)!;
    // 自动卡（第一位）缺省选中；其后是按推荐排序的候选卡
    expect(cards[0]?.querySelector('.assignee-name')?.textContent).toContain('自动（推荐）');
    expect(cards[0]?.classList.contains('selected')).toBe(true);
    // trin（推荐）在 neo 前：推荐角标 + kind 徽标 + 空闲读数
    const reco = cards[1]!;
    expect(reco.querySelector('.assignee-reco')?.textContent).toBe('推荐');
    expect(reco.querySelector('.assignee-kind')?.textContent).toBe('OpenClaw');
    expect(reco.querySelector('.assignee-busy')?.textContent).toBe('空闲');
    // neo（表单角色）排后：忙闲读数 = 队列长度
    const busy = cards[2]!;
    expect(busy.getAttribute('data-character')).toBe('c-neo');
    expect(busy.querySelector('.assignee-busy')?.textContent).toBe('排队 2');
  });

  test('自动提交：推荐人 ≠ 表单角色 → 命令带 targetCharacterId 直达推荐人队列', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(boundState([runningOn('c-neo')]));
    clickAction(panel, 'task-open', 'u-neo');
    inputOfPanel(panel)!.value = '侦察北门';
    inputOfPanel(panel)!.dispatchEvent(new Event('input', { bubbles: true }));

    clickFormAction(panel, 'task-submit');
    expect(harness.commands).toEqual([
      { type: 'task.assign', characterId: 'c-neo', prompt: '侦察北门', targetCharacterId: 'c-trin' },
    ]);
  });

  test('手动指定：点候选人卡切换选中；提交直达所选角色；「自动」卡可切回', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(boundState([])); // 两人都空闲：推荐 = trin（专属加分），自动解析仍走 trin
    clickAction(panel, 'task-open', 'u-neo');

    // 手动选 neo：自动卡失选，neo 卡选中
    clickAssignee(panel, 'task-target', 'c-neo');
    const cards = assigneeCards(panel)!;
    expect(cards[0]?.classList.contains('selected')).toBe(false);
    expect(cards[2]?.classList.contains('selected')).toBe(true);

    inputOfPanel(panel)!.value = '手动派给 Neo';
    inputOfPanel(panel)!.dispatchEvent(new Event('input', { bubbles: true }));
    clickFormAction(panel, 'task-submit');
    // 指定 = 表单角色 → 载荷最小化（不带 targetCharacterId，缺省即本人）
    expect(harness.commands).toEqual([{ type: 'task.assign', characterId: 'c-neo', prompt: '手动派给 Neo' }]);

    // 再开一次：手动选择不跨表单存活（自动回缺省）
    clickAction(panel, 'task-open', 'u-neo');
    expect(assigneeCards(panel)![0]?.classList.contains('selected')).toBe(true);
  });

  test('全忙提示：全员在办 → 队列长度 + 历史均值预计；无历史 → 未知；空闲目标不显示', async () => {
    // neo 排队 2 条、trin 在办 1 条（全忙）；stats：trin 均值 10 分钟，neo 无行
    const statsDeferred = { calls: 0 };
    const { panel, harness } = mountPanel({
      taskStats: async () => {
        statsDeferred.calls += 1;
        return [
          { characterId: 'c-trin', completed: 9, failed: 1, avgDurationMs: 10 * 60_000 },
        ];
      },
    });
    mounted.push(harness.unmount);

    harness.emit(
      boundState([runningOn('c-neo'), { ...runningOn('c-neo'), id: 't-neo-2', status: 'queued' }, runningOn('c-trin')])
    );
    clickAction(panel, 'task-open', 'u-neo');

    // 打开即刷新一次统计（task_050 ⑤：打开时刷新，不做实时订阅）
    await Promise.resolve();
    expect(statsDeferred.calls).toBe(1);

    // 自动目标 = 推荐第一位（同分全忙 → 在办少的 trin 在前）：提示它的排队预计
    expect(hintHidden(panel)).toBe(false);
    expect(hintText(panel)).toContain('Trinity 队列 1 条 · 预计 ~10 分钟');

    // 手动选 neo（无历史）→ 预计「未知」，队列读数跟上
    clickAssignee(panel, 'task-target', 'c-neo');
    expect(hintText(panel)).toContain('Neo 队列 2 条 · 预计未知');

    // 手动切回自动卡 → 提示回到推荐人
    clickAssignee(panel, 'task-target-auto');
    expect(hintText(panel)).toContain('Trinity 队列 1 条 · 预计 ~10 分钟');
  });

  test('统计到达后卡片更新（成功率读数）且不打草稿；无 provider 不炸（中性降级）', async () => {
    // 手写 deferred（不用 let 赋值收 resolve：闭包赋值在控制流分析里不可见，调用点会被窄化成 never）
    const deferred: {
      resolve: ((rows: readonly { characterId: string; completed: number; failed: number; avgDurationMs: number | null }[]) => void) | null;
    } = { resolve: null };
    const pending = new Promise<readonly { characterId: string; completed: number; failed: number; avgDurationMs: number | null }[] | null>(
      (resolve) => {
        deferred.resolve = resolve;
      }
    );
    const { panel, harness } = mountPanel({
      taskStats: () => pending,
    });
    mounted.push(harness.unmount);

    harness.emit(boundState([]));
    clickAction(panel, 'task-open', 'u-neo');
    inputOfPanel(panel)!.value = '打了一半';

    // 统计未到达：无成功率段（中性降级不编数）
    expect(assigneeCards(panel)![1]?.querySelector('.assignee-reason')?.textContent).not.toContain('成功率');

    // 统计到达：推荐卡补上成功率段；textarea 草稿不受影响（统计不在忙闲签名里，强制重画）
    deferred.resolve?.([{ characterId: 'c-trin', completed: 86, failed: 14, avgDurationMs: null }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(assigneeCards(panel)![1]?.querySelector('.assignee-reason')?.textContent).toContain('成功率 86%');
    expect(inputOfPanel(panel)?.value).toBe('打了一半');
  });

  test('忙闲实时：表单开着，别的角色任务变化 → 卡片读数跟上（不依赖选中单位的签名）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(boundState([]));
    clickAction(panel, 'task-open', 'u-neo');
    // trin 空闲读数（按 data-character 定位 —— 排序会随忙闲洗牌，下标不是稳定锚点）
    const busyOf = (characterId: string): string | null | undefined =>
      panel.shadowRoot
        ?.querySelector(`.assignee[data-character="${characterId}"] .assignee-busy`)?.textContent;
    expect(busyOf('c-trin')).toBe('空闲');

    // trin 接了活（选中单位 neo 的读数没变 —— 面板签名不变，但承接人签名变了）：
    // 卡片实时跟上，且推荐排序换位（neo 空闲升到 trin 前）
    harness.emit(boundState([runningOn('c-trin')]));
    expect(busyOf('c-trin')).toBe('排队 1');
    expect(busyOf('c-neo')).toBe('空闲');
  });

  test('无已绑定角色：空态提示 + 提交退 038 行为（派给表单角色）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    // c-neo 未绑定 agentKind（基础 fixture）→ 无候选
    harness.emit(selected('u-neo'));
    clickAction(panel, 'task-open', 'u-neo');
    expect(panel.shadowRoot?.querySelector('[data-role="assignee-list"]')?.textContent).toContain('暂无已绑定');

    inputOfPanel(panel)!.value = '老路径';
    inputOfPanel(panel)!.dispatchEvent(new Event('input', { bubbles: true }));
    clickFormAction(panel, 'task-submit');
    expect(harness.commands).toEqual([{ type: 'task.assign', characterId: 'c-neo', prompt: '老路径' }]);
  });
});

/** 测试内小工具：textarea（与本文件上方 describe 的 inputOf 同款，命名避开冲突）。 */
function inputOfPanel(panel: StratAgentPanelElement): HTMLTextAreaElement | null {
  return panel.shadowRoot?.querySelector('[data-role="task-input"]') ?? null;
}

// ============================================================================
// 上下文注入开关（@since v3.29，task_053）：角色卡开关位 → HudCommand
// ============================================================================

describe('上下文注入开关（task_053）', () => {
  /** 按 data-character 点开关钮（开关钮不带 data-unit）。 */
  const clickContextToggle = (panel: StratAgentPanelElement, characterId: string): void => {
    const btn = panel.shadowRoot?.querySelector<HTMLButtonElement>(
      `button[data-action="context-toggle"][data-character="${characterId}"]`
    );
    if (!btn) throw new Error('上下文开关钮未渲染');
    btn.click();
  };

  const contextToggleOf = (panel: StratAgentPanelElement): HTMLButtonElement | null =>
    panel.shadowRoot?.querySelector<HTMLButtonElement>('button[data-action="context-toggle"]') ?? null;

  test('关联角色的单位渲染开关钮（读数随广播：开 → 关）；无角色单位不渲染', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    expect(contextToggleOf(panel)).not.toBeNull();
    expect(contextToggleOf(panel)?.textContent).toContain('上下文：开');

    // 广播关掉的真相 → 签名含 contextEnabled → 按钮读数跟着走（本地不存第二份）
    const offState = selected('u-neo');
    offState.characters = [{ ...(offState.characters[0] as NonNullable<WorldState['characters'][number]>), contextEnabled: false }];
    harness.emit(offState);
    expect(contextToggleOf(panel)?.textContent).toContain('上下文：关');

    harness.emit(selected('u-trinity')); // 无 characterId → 无开关位
    expect(contextToggleOf(panel)).toBeNull();
  });

  test('点击 → character.contextEnabled.update 取反派发（enabled = 目标值）', () => {
    const { panel, harness } = mountPanel();
    mounted.push(harness.unmount);

    harness.emit(selected('u-neo'));
    clickContextToggle(panel, 'c-neo');
    expect(harness.commands).toEqual([
      { type: 'character.contextEnabled.update', characterId: 'c-neo', enabled: false },
    ]);

    // 广播回来已是关 → 再点 → 派发开
    const offState = selected('u-neo');
    offState.characters = [{ ...(offState.characters[0] as NonNullable<WorldState['characters'][number]>), contextEnabled: false }];
    harness.emit(offState);
    clickContextToggle(panel, 'c-neo');
    expect(harness.commands[1]).toEqual({
      type: 'character.contextEnabled.update',
      characterId: 'c-neo',
      enabled: true,
    });
  });
});
