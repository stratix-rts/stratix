/**
 * 集成测试：任务确认面板（hud/panels/mission-confirm.ts）。
 * 覆盖：WorldState 驱动渲染（含编组单位摘要）、确认/拒绝 → HudCommand 派发、
 *   卸载退订、纯派生函数（行模型 / 签名判重），以及**整条闭环**：
 *   HudCommand → core 状态机 → WorldState 广播 → 面板重渲染。
 * @jest-environment jsdom
 *
 * 闭环那一段不打桩总线：emitCommand / createCoreRuntime / HudBusAdapter 全是真件，
 * 只有 themeController 是替身（它只管落皮肤，与任务流无关）。断的是"面板自己改状态"
 * 这条捷径 —— 面板一行都不许本地改数据，行还在不在完全由 core 回广播决定。
 */

import { emitCommand, resetBus } from '../../core/bus';
import { createCoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import type { HudCommand, MissionView, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController } from '../theme/theme-controller';

import {
  MISSION_CONFIRM_TAG,
  MAX_ROW_UNIT_NAMES,
  missionConfirmSignature,
  mountMissionConfirm,
  resolveMissionConfirm,
  type MissionConfirmDeps,
  type StratMissionConfirmElement,
} from '../panels/mission-confirm';

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
  { id: 'u-trinity', name: 'Trinity', status: 'idle', missionId: null, power: 5 },
  { id: 'u-morpheus', name: 'Morpheus', status: 'idle', missionId: null, power: 4 },
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

function mission(patch: Partial<MissionView> & { id: string }): MissionView {
  return {
    title: `任务 ${patch.id}`,
    phase: 'pending',
    unitIds: ['u-neo', 'u-trinity'],
    createdAt: 1000,
    ...patch,
  };
}

interface Harness {
  readonly panel: StratMissionConfirmElement;
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  /** core 广播一份新状态（走 adapter.subscribe 的真实订阅链）。 */
  emit(state: WorldState): void;
  subscriberCount(): number;
  unmount(): void;
}

function mountPanel(): Harness {
  const commands: HudCommand[] = [];
  const subs = new Set<(state: WorldState) => void>();
  const deps: MissionConfirmDeps = {
    dispatch: (command) => { commands.push(command); },
    subscribe: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
  };

  const host = document.createElement('div');
  document.body.appendChild(host);
  const unmountPanel = mountMissionConfirm(deps, host);
  const panel = host.querySelector(MISSION_CONFIRM_TAG) as StratMissionConfirmElement;
  if (!panel?.shadowRoot) throw new Error('任务确认面板未 upgrade（shadowRoot 为空）');

  return {
    panel,
    host,
    commands,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    subscriberCount: () => subs.size,
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

/** 进 shadow DOM 点真实按钮：走组件自己的事件链，不直接调方法。 */
function clickDecision(panel: StratMissionConfirmElement, missionId: string, decision: string): void {
  const button = panel.shadowRoot?.querySelector<HTMLButtonElement>(
    `button[data-mission="${missionId}"][data-decision="${decision}"]`
  );
  if (!button) throw new Error(`确认按钮未渲染: ${missionId}/${decision}`);
  button.click();
}

function rowOf(panel: StratMissionConfirmElement, missionId: string): HTMLElement | null {
  return panel.shadowRoot?.querySelector<HTMLElement>(`[data-mission-row="${missionId}"]`) ?? null;
}

describe('WorldState → 行模型（纯函数）', () => {
  test('按相位分组：待确认 / 在办 / 其余；统计只数该数的', () => {
    const model = resolveMissionConfirm(makeState({
      missions: [
        mission({ id: 'm1', phase: 'pending' }),
        mission({ id: 'm2', phase: 'running' }),
        mission({ id: 'm3', phase: 'done' }),
      ],
    }));

    expect(model.pending.map((r) => r.id)).toEqual(['m1']);
    expect(model.active.map((r) => r.id)).toEqual(['m2']);
    expect(model.settled.map((r) => r.id)).toEqual(['m3']);
    expect(model.stats).toEqual({ pending: 1, active: 1, done: 1 });
  });

  test('待确认队列里最新的排前面（用户刚发起的那条最可能要决定）', () => {
    const model = resolveMissionConfirm(makeState({
      missions: [mission({ id: 'm1' }), mission({ id: 'm2' })],
    }));
    expect(model.pending.map((r) => r.id)).toEqual(['m2', 'm1']);
  });

  test('单位名解析成人类可读名；单位已消失时回落 id（不留空位、不编造名字）', () => {
    const model = resolveMissionConfirm(makeState({
      missions: [mission({ id: 'm1', unitIds: ['u-neo', 'ghost'] })],
    }));
    expect(model.pending[0].unitNames).toEqual(['Neo', 'ghost']);
    expect(model.pending[0].unitCount).toBe(2);
  });

  test('非 pending 行不可确认（decidable 只给待确认队列）', () => {
    const model = resolveMissionConfirm(makeState({
      missions: [mission({ id: 'm1', phase: 'draft', unitIds: [] })],
    }));
    expect(model.pending).toHaveLength(0);
    expect(model.settled[0].decidable).toBe(false);
  });

  test('空状态不炸', () => {
    expect(resolveMissionConfirm(null).stats).toEqual({ pending: 0, active: 0, done: 0 });
  });
});

describe('渲染签名：无关变动不重绘', () => {
  test('任务相位 / 名单 / 单位名任一变化才改签名', () => {
    const base = makeState({ missions: [mission({ id: 'm1' })] });
    expect(missionConfirmSignature(base)).toBe(missionConfirmSignature(makeState({
      missions: [mission({ id: 'm1' })],
    })));
    expect(missionConfirmSignature(base)).not.toBe(missionConfirmSignature(makeState({
      missions: [mission({ id: 'm1', phase: 'running' })],
    })));
    expect(missionConfirmSignature(base)).not.toBe(missionConfirmSignature(makeState({
      missions: [mission({ id: 'm1', unitIds: ['u-neo'] })],
    })));
  });

  test('名单之外的单位改名不影响本面板签名（别把无关变动刷成重渲染）', () => {
    const base = makeState({ missions: [mission({ id: 'm1' })] });
    const renamed = makeState({
      units: UNITS.map((u) => (u.id === 'u-morpheus' ? { ...u, name: '改名了' } : u)),
      missions: [mission({ id: 'm1' })],
    });
    expect(missionConfirmSignature(base)).toBe(missionConfirmSignature(renamed));
  });

  test('被指派单位改名要改签名（摘要念的是名字，改名用户必须看见）', () => {
    const base = makeState({ missions: [mission({ id: 'm1' })] });
    const renamed = makeState({
      units: UNITS.map((u) => (u.id === 'u-neo' ? { ...u, name: '改名了' } : u)),
      missions: [mission({ id: 'm1' })],
    });
    expect(missionConfirmSignature(base)).not.toBe(missionConfirmSignature(renamed));
  });
});

describe('面板：渲染与派发', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('待确认任务渲染成带确认/拒绝按钮的行，含编组单位摘要', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1', title: '侦察北门' })] }));

    const row = rowOf(h.panel, 'm1');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('侦察北门');
    expect(row?.textContent).toContain('Neo、Trinity');
    expect(h.panel.pendingMissionIds).toEqual(['m1']);
    expect(h.commands).toHaveLength(0);
  });

  test('点确认 → mission.confirm(accept)；点拒绝 → mission.confirm(reject)', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1' }), mission({ id: 'm2' })] }));

    clickDecision(h.panel, 'm2', 'accept');
    clickDecision(h.panel, 'm1', 'reject');

    expect(h.commands).toEqual([
      { type: 'mission.confirm', missionId: 'm2', decision: 'accept' },
      { type: 'mission.confirm', missionId: 'm1', decision: 'reject' },
    ]);
  });

  test('面板不改本地状态：派发后行还在（等 core 回广播）', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1' })] }));
    clickDecision(h.panel, 'm1', 'accept');
    expect(h.panel.pendingMissionIds).toEqual(['m1']);
  });

  test('core 广播新相位后行自己换位置：待确认 → 进行中', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1', title: '侦察北门' })] }));
    expect(rowOf(h.panel, 'm1')?.getAttribute('data-phase')).toBe('pending');

    h.emit(makeState({ missions: [mission({ id: 'm1', title: '侦察北门', phase: 'running' })] }));

    expect(h.panel.pendingMissionIds).toEqual([]);
    expect(rowOf(h.panel, 'm1')?.getAttribute('data-phase')).toBe('running');
    // 已确认的行不再有确认按钮
    expect(h.panel.shadowRoot?.querySelector('button[data-mission="m1"]')).toBeNull();
  });

  test('单位名单过长时摘要收口（行高稳定，不让面板被几十个名字撑开）', () => {
    h = mountPanel();
    const many = Array.from({ length: MAX_ROW_UNIT_NAMES + 2 }, (_, i) => `u${i}`);
    h.emit(makeState({ missions: [mission({ id: 'm1', unitIds: many })] }));

    const text = rowOf(h.panel, 'm1')?.textContent ?? '';
    expect(text).toContain(`等 ${many.length} 个单位`);
    expect(text).not.toContain('u3');
  });

  test('空状态给引导文案，不是一块白板', () => {
    h = mountPanel();
    h.emit(makeState());
    expect(h.panel.shadowRoot?.querySelector('[data-role="empty"]')?.textContent).toContain('暂无任务');
  });

  test('卸载后退订（反复挂卸不累积监听器）', () => {
    h = mountPanel();
    expect(h.subscriberCount()).toBe(1);
    h.unmount();
    expect(h.subscriberCount()).toBe(0);
    h = undefined as unknown as Harness;
  });
});

describe('闭环：HudCommand → core 状态机 → WorldState 广播 → 面板', () => {
  const themeController: ThemeController = {
    apply: () => {},
    get current(): null { return null; },
    // 皮肤订阅（@since task_115）：本用例只关心任务链，订阅给个空实现。
    subscribe: () => () => undefined,
  };

  test('指派 → 确认 → 状态更新 → 面板收到（真总线 + 真 runtime + 真 adapter）', () => {
    resetBus();
    const store = createStore({ units: UNITS });
    const runtime = createCoreRuntime({ store });
    const adapter = createHudBusAdapter({ themeController });
    const unmountAdapter = adapter.mount();
    const stopRuntime = runtime.start();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmountPanel = mountMissionConfirm(adapter, host);
    const panel = host.querySelector(MISSION_CONFIRM_TAG) as StratMissionConfirmElement;

    try {
      // 1. 指派：HUD → 命令 → core 状态机 → WorldState.missions → 面板
      adapter.dispatch({ type: 'mission.create', title: '侦察北门', unitIds: ['u-neo', 'u-trinity'] });

      const created = store.getState().missions[0];
      expect(created).toMatchObject({ title: '侦察北门', phase: 'pending' });
      expect(panel.pendingMissionIds).toEqual([created.id]);
      expect(rowOf(panel, created.id)?.textContent).toContain('Neo、Trinity');

      // 2. 用户在面板上点确认：面板只发命令，不碰自己的数据。命令总线是同步的 ——
      //    click 之后 core 已经判完并回广播，所以下面看到的是"core 决策的结果"，不是本地乐观更新。
      clickDecision(panel, created.id, 'accept');

      // 3. core 决策后回广播：pending → 接单开工，面板自己换到"其他任务"分组
      expect(store.getState().missions[0].phase).toBe('running');
      expect(panel.pendingMissionIds).toEqual([]);
      expect(rowOf(panel, created.id)?.getAttribute('data-phase')).toBe('running');
      // 单位的任务占用也跟着更新（WorldState 内部自洽）
      expect(store.getState().units.find((u) => u.id === 'u-neo')?.missionId).toBe(created.id);
    } finally {
      unmountPanel();
      host.remove();
      stopRuntime();
      unmountAdapter();
      resetBus();
    }
  });

  test('拒绝走另一条分支：任务作废、单位释放占用', () => {
    resetBus();
    const store = createStore({ units: UNITS });
    const runtime = createCoreRuntime({ store });
    const adapter = createHudBusAdapter({ themeController });
    const unmountAdapter = adapter.mount();
    const stopRuntime = runtime.start();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const unmountPanel = mountMissionConfirm(adapter, host);
    const panel = host.querySelector(MISSION_CONFIRM_TAG) as StratMissionConfirmElement;

    try {
      // 直接从总线发（等价于命令面板那条链路），面板照样收到广播
      emitCommand({ type: 'mission.create', title: '加固城墙', unitIds: ['u-morpheus'] });
      const created = store.getState().missions[0];
      expect(panel.pendingMissionIds).toEqual([created.id]);

      clickDecision(panel, created.id, 'reject');

      expect(store.getState().missions[0].phase).toBe('cancelled');
      expect(store.getState().units.find((u) => u.id === 'u-morpheus')?.missionId).toBeNull();
      expect(panel.pendingMissionIds).toEqual([]);
      expect(rowOf(panel, created.id)?.getAttribute('data-phase')).toBe('cancelled');
    } finally {
      unmountPanel();
      host.remove();
      stopRuntime();
      unmountAdapter();
      resetBus();
    }
  });
});