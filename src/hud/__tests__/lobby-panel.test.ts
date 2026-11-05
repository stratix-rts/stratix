/**
 * 集成测试：大厅面板（hud/screens/lobby-panel.ts + lobby-catalog.ts，task_188 / M1-14）。
 * 覆盖 design §7.1「M1-14」行的三条验收：
 *   ① 卡片字段齐（名字 / 路径尾段 / 分支 / 实例级状态 / 最近进入 / 在办任务数）；
 *   ② 默认沙盒卡存在**且**标「默认沙盒」；
 *   ③ 空态（projectInstances 缺失 / 为空）渲染**明确空态**：派单入口禁用、但有**可点的出口**。
 * 外加：点卡片 → project.enter；判重签名（无关广播不重绘）；卸载退订。
 * @jest-environment jsdom
 */

import { DEFAULT_INSTANCE_ID, type CharacterTask, type HudCommand, type ProjectInstanceView, type WorldState } from '../../core/types';

import {
  buildAddInstanceCommand,
  buildEnterInstanceCommand,
  formatLastEntered,
  LOBBY_EMPTY_TITLE,
  LOBBY_SANDBOX_BADGE,
  lobbyPanelSignature,
  resolveLobbyPanel,
} from '../screens/lobby-catalog';
import {
  LOBBY_PANEL_TAG,
  mountLobbyPanel,
  type StratLobbyPanelElement,
} from '../screens/lobby-panel';

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

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

function instance(patch: Partial<ProjectInstanceView> & { instanceId: string }): ProjectInstanceView {
  return {
    projectId: 'spx_demo',
    path: '/Users/kingj/code/Stratix-demo',
    title: '示例副本',
    lastOpenedAt: 0,
    pinned: false,
    archived: false,
    status: 'idle',
    ...patch,
  };
}

function task(patch: Partial<CharacterTask> & { id: string }): CharacterTask {
  return {
    characterId: 'chr_1',
    prompt: '干活',
    status: 'running',
    createdAt: 1_000,
    startedAt: 1_000,
    endedAt: null,
    output: '',
    ...patch,
  };
}

interface Harness {
  readonly panel: StratLobbyPanelElement;
  readonly commands: HudCommand[];
  emit(state: WorldState): void;
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(initial: WorldState | null): Harness {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps = {
    dispatch: (command: HudCommand) => { commands.push(command); },
    subscribe: (handler: (state: WorldState) => void) => {
      subs.add(handler);
      if (initial) handler(initial);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const mounted = mountLobbyPanel(deps, host);
  const panel = host.querySelector(LOBBY_PANEL_TAG) as StratLobbyPanelElement;
  if (!panel?.shadowRoot) throw new Error('大厅面板未 upgrade（shadowRoot 为空）');

  return {
    panel,
    commands,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    subscriberCount: () => subs.size,
    unmount: () => { mounted.unmount(); host.remove(); },
  };
}

function q(panel: StratLobbyPanelElement, selector: string): HTMLElement | null {
  return panel.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
}

function qAll(panel: StratLobbyPanelElement, selector: string): HTMLElement[] {
  return Array.from(panel.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? []);
}

// ---------------------------------------------------------------------------
// 纯函数：视图模型派生
// ---------------------------------------------------------------------------

describe('大厅视图模型（lobby-catalog）', () => {
  test('① 卡片六项字段齐（名字 / 路径尾段 / 分支 / 状态 / 最近进入 / 在办任务数）', () => {
    const state = makeState({
      activeInstanceId: null,
      projectInstances: [
        instance({
          instanceId: 'inst_a',
          title: '示例副本',
          path: '/Users/kingj/code/Stratix-demo',
          lastOpenedAt: Date.now() - 2 * 60_000,
          status: 'idle',
          vcs: { branch: 'demo/v3.3' },
        }),
      ],
      tasks: [
        task({ id: 't1', instanceId: 'inst_a', status: 'running' }),
        task({ id: 't2', instanceId: 'inst_a', status: 'queued' }),
        task({ id: 't3', instanceId: 'inst_a', status: 'completed' }),
      ],
    });
    const card = resolveLobbyPanel(state).cards[0];
    expect(card).toBeDefined();
    expect(card?.name).toBe('示例副本');
    expect(card?.pathTail).toBe('Stratix-demo');
    expect(card?.branch).toBe('demo/v3.3');
    expect(card?.status).toBe('idle');
    expect(card?.statusLabel).toBe('闲置');
    expect(card?.lastEnteredText).toBe('2 分钟前');
    expect(card?.activeTaskCount).toBe(2); // 终态任务不算「在办」
  });

  test('实例级状态：active / idle / missing 三态各自判对', () => {
    const state = makeState({
      activeInstanceId: 'inst_a',
      projectInstances: [
        instance({ instanceId: 'inst_a' }),
        instance({ instanceId: 'inst_b' }),
        instance({ instanceId: 'inst_c', status: 'missing' }),
        instance({ instanceId: 'inst_d', missing: true }),
      ],
    });
    const cards = resolveLobbyPanel(state).cards;
    const statusOf = (id: string) => cards.find((card) => card.instanceId === id)?.status;
    expect(statusOf('inst_a')).toBe('active');
    expect(statusOf('inst_b')).toBe('idle');
    expect(statusOf('inst_c')).toBe('missing');
    expect(statusOf('inst_d')).toBe('missing');
  });

  test('② 默认沙盒卡存在且被认出来（sandbox 标记 / 常量 id 两个来源都认）', () => {
    const state = makeState({
      projectInstances: [
        instance({ instanceId: DEFAULT_INSTANCE_ID, sandbox: true, title: '默认沙盒' }),
        instance({ instanceId: 'inst_b' }),
      ],
    });
    const cards = resolveLobbyPanel(state).cards;
    const sandbox = cards.find((card) => card.instanceId === DEFAULT_INSTANCE_ID);
    expect(sandbox).toBeDefined();
    expect(sandbox?.sandbox).toBe(true);
    // 快照丢了 sandbox 标记时，常量 id 仍然认得出默认沙盒（标牌不能丢）。
    const noFlag = resolveLobbyPanel(makeState({
      projectInstances: [instance({ instanceId: DEFAULT_INSTANCE_ID })],
    })).cards[0];
    expect(noFlag?.sandbox).toBe(true);
  });

  test('③ 空态：projectInstances 缺失 / 为空 ⇒ empty（不是白卡）', () => {
    expect(resolveLobbyPanel(makeState()).empty).toBe(true);
    expect(resolveLobbyPanel(makeState({ projectInstances: [] })).empty).toBe(true);
    expect(resolveLobbyPanel(null).empty).toBe(true);
    // 有一个副本 ⇒ 不空态。
    expect(resolveLobbyPanel(makeState({ projectInstances: [instance({ instanceId: 'i' })] })).empty).toBe(false);
  });

  test('③ 空态下派单入口禁用且没有目标；非空态下派单入口可用（默认沙盒优先）', () => {
    const empty = resolveLobbyPanel(makeState());
    expect(empty.dispatchEnabled).toBe(false);
    expect(empty.dispatchTargetId).toBeNull();

    const filled = resolveLobbyPanel(makeState({
      projectInstances: [
        instance({ instanceId: 'inst_b', title: '别的副本' }),
        instance({ instanceId: DEFAULT_INSTANCE_ID, sandbox: true, title: '默认沙盒' }),
      ],
    }));
    expect(filled.dispatchEnabled).toBe(true);
    expect(filled.dispatchTargetId).toBe(DEFAULT_INSTANCE_ID);
  });

  test('默认沙盒认领「没有实例归属」的历史任务（COALESCE 口径，design §2.4）', () => {
    const state = makeState({
      projectInstances: [
        instance({ instanceId: DEFAULT_INSTANCE_ID, sandbox: true }),
        instance({ instanceId: 'inst_b' }),
      ],
      tasks: [
        task({ id: 'legacy', instanceId: null, status: 'running' }),
        task({ id: 'owned', instanceId: 'inst_b', status: 'running' }),
      ],
    });
    const cards = resolveLobbyPanel(state).cards;
    expect(cards.find((card) => card.instanceId === DEFAULT_INSTANCE_ID)?.activeTaskCount).toBe(1);
    expect(cards.find((card) => card.instanceId === 'inst_b')?.activeTaskCount).toBe(1);
  });

  test('已归档的副本收起（不进卡片网格）', () => {
    const state = makeState({
      projectInstances: [instance({ instanceId: 'inst_a', archived: true })],
    });
    const model = resolveLobbyPanel(state);
    expect(model.cards).toHaveLength(0);
    expect(model.empty).toBe(true);
  });

  test('相对时间说法（从未进入 / 刚刚 / 分钟前 / 小时前 / 天前 / 日期）', () => {
    const now = Date.UTC(2026, 10, 6, 12, 0, 0);
    expect(formatLastEntered(0, now)).toBe('从未进入');
    expect(formatLastEntered(now - 30_000, now)).toBe('刚刚');
    expect(formatLastEntered(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(formatLastEntered(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(formatLastEntered(now - 2 * 86_400_000, now)).toBe('2 天前');
    expect(formatLastEntered(now - 30 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('判重签名：无关广播（任务总数变化）不改变签名；在办数变化会改', () => {
    const base = makeState({
      projectInstances: [instance({ instanceId: 'inst_a' })],
      tasks: [task({ id: 't1', instanceId: 'inst_a', status: 'running' })],
    });
    const same = makeState({
      projectInstances: [instance({ instanceId: 'inst_a' })],
      tasks: [
        task({ id: 't1', instanceId: 'inst_a', status: 'running' }),
        task({ id: 't2', instanceId: 'other', status: 'running' }),
      ],
    });
    const changed = makeState({
      projectInstances: [instance({ instanceId: 'inst_a' })],
      tasks: [
        task({ id: 't1', instanceId: 'inst_a', status: 'running' }),
        task({ id: 't2', instanceId: 'inst_a', status: 'queued' }),
      ],
    });
    expect(lobbyPanelSignature(same)).toBe(lobbyPanelSignature(base));
    expect(lobbyPanelSignature(changed)).not.toBe(lobbyPanelSignature(base));
  });
});

// ---------------------------------------------------------------------------
// 组件：Shadow DOM 渲染
// ---------------------------------------------------------------------------

describe('大厅面板（strat-lobby-panel）', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('① 卡片渲染六项字段 + ② 默认沙盒卡标「默认沙盒」', () => {
    const harness = mountPanel(makeState({
      activeInstanceId: null,
      projectInstances: [
        instance({
          instanceId: DEFAULT_INSTANCE_ID,
          sandbox: true,
          title: '默认沙盒',
          path: '/Users/kingj/code/Stratix-demo',
          lastOpenedAt: Date.now() - 60_000,
          vcs: { branch: 'demo/v3.3' },
        }),
      ],
      tasks: [task({ id: 't1', instanceId: DEFAULT_INSTANCE_ID, status: 'running' })],
    }));

    const cards = qAll(harness.panel, '[data-role="card"]');
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.dataset.instanceId).toBe(DEFAULT_INSTANCE_ID);
    expect(card.dataset.status).toBe('idle');

    // 名字 / 路径尾段 / 分支 / 状态 / 最近进入 / 在办任务数
    expect(card.querySelector('[data-role="card-name"]')?.textContent).toBe('默认沙盒');
    expect(card.textContent).toContain('Stratix-demo');
    expect(card.textContent).toContain('demo/v3.3');
    expect(card.querySelector('[data-role="status"]')?.textContent).toBe('闲置');
    expect(card.textContent).toContain('1 分钟前');
    expect(card.textContent).toContain('在办任务');
    expect(card.textContent).toContain('1');

    // ② 默认沙盒标牌
    expect(card.querySelector('[data-role="sandbox-badge"]')?.textContent).toBe(LOBBY_SANDBOX_BADGE);

    harness.unmount();
  });

  test('③ 空态：明确空态 + 派单入口禁用 + 「添加副本」可点（真命令，不是死按钮）', () => {
    const harness = mountPanel(makeState({ activeInstanceId: null }));

    // 明确空态（不是白卡）
    expect(q(harness.panel, '[data-role="empty"]')?.hasAttribute('hidden')).toBe(false);
    expect(q(harness.panel, '[data-role="empty-title"]')?.textContent).toBe(LOBBY_EMPTY_TITLE);
    expect(qAll(harness.panel, '[data-role="card"]')).toHaveLength(0);

    // 派单入口禁用
    const dispatch = q(harness.panel, '[data-role="dispatch"]') as HTMLButtonElement | null;
    expect(dispatch?.disabled).toBe(true);

    // 有可点的出口：点「添加副本」⇒ 派 project.enter(DEFAULT_INSTANCE_ID)
    const add = q(harness.panel, '[data-role="add"]') as HTMLButtonElement | null;
    expect(add?.disabled).toBeFalsy();
    add?.click();
    expect(harness.commands).toEqual([{ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID }]);

    harness.unmount();
  });

  test('点卡片 ⇒ 派 project.enter（进副本）；路径丢失的副本按钮禁用', () => {
    const harness = mountPanel(makeState({
      activeInstanceId: null,
      projectInstances: [
        instance({ instanceId: 'inst_a', title: '可进的' }),
        instance({ instanceId: 'inst_lost', title: '丢了的', status: 'missing' }),
      ],
    }));

    const enter = qAll(harness.panel, '[data-role="enter"]');
    expect(enter).toHaveLength(2);
    const lost = enter.find((btn) => btn.dataset.instanceId === 'inst_lost') as HTMLButtonElement;
    expect(lost.disabled).toBe(true);

    const ok = enter.find((btn) => btn.dataset.instanceId === 'inst_a') as HTMLButtonElement;
    ok.click();
    expect(harness.commands).toEqual([{ type: 'project.enter', instanceId: 'inst_a' }]);

    harness.unmount();
  });

  test('非空态：派单入口可用（点了进默认沙盒）', () => {
    const harness = mountPanel(makeState({
      activeInstanceId: null,
      projectInstances: [
        instance({ instanceId: 'inst_b', title: '别的副本' }),
        instance({ instanceId: DEFAULT_INSTANCE_ID, sandbox: true, title: '默认沙盒' }),
      ],
    }));

    const dispatch = q(harness.panel, '[data-role="dispatch"]') as HTMLButtonElement;
    expect(dispatch.disabled).toBe(false);
    dispatch.click();
    expect(harness.commands).toEqual([{ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID }]);

    harness.unmount();
  });

  test('渲染判重：无关广播不重绘卡片（在办数变了才重画）', () => {
    const harness = mountPanel(makeState({
      activeInstanceId: null,
      projectInstances: [instance({ instanceId: 'inst_a' })],
      tasks: [task({ id: 't1', instanceId: 'inst_a', status: 'running' })],
    }));
    const before = q(harness.panel, '[data-role="card"]');

    // 无关广播（别的副本的任务数变了）
    harness.emit(makeState({
      activeInstanceId: null,
      projectInstances: [instance({ instanceId: 'inst_a' })],
      tasks: [
        task({ id: 't1', instanceId: 'inst_a', status: 'running' }),
        task({ id: 't2', instanceId: 'other', status: 'running' }),
      ],
    }));
    expect(q(harness.panel, '[data-role="card"]')).toBe(before);

    // 相关变化（在办数 +1）⇒ 重画
    harness.emit(makeState({
      activeInstanceId: null,
      projectInstances: [instance({ instanceId: 'inst_a' })],
      tasks: [
        task({ id: 't1', instanceId: 'inst_a', status: 'running' }),
        task({ id: 't2', instanceId: 'inst_a', status: 'queued' }),
      ],
    }));
    expect(q(harness.panel, '[data-role="card"]')).not.toBe(before);

    harness.unmount();
  });

  test('卸载退订（不留悬挂订阅）', () => {
    const harness = mountPanel(makeState({ activeInstanceId: null }));
    expect(harness.subscriberCount()).toBe(1);
    harness.unmount();
    expect(harness.subscriberCount()).toBe(0);
  });
});

describe('大厅命令构造（lobby-catalog）', () => {
  test('进入副本 / 添加副本两条命令形状', () => {
    expect(buildEnterInstanceCommand('inst_a')).toEqual({ type: 'project.enter', instanceId: 'inst_a' });
    expect(buildAddInstanceCommand()).toEqual({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
  });
});
