/**
 * 组件测试：任务详情展示（@since v3.39 / task_078）—— 正文四段 / 检查点倒序 / 依赖两态。
 *
 * 覆盖 hud/panels/mission-confirm.ts 的三块新渲染：
 *   1. 正文：brief 有 → 四段渲染（空段不占位）；brief 无 → 整块不出现；
 *   2. 检查点：倒序（最新在最上）+ 时间与 note 都渲染；没有记账 → 不出现折叠块；
 *   3. 依赖：未满足 → 警示态；全部满足 → 就绪态；每个依赖显示「短码 · 相位」。
 * 外加渲染签名：正文 / 检查点 / **依赖相位**变化都要触发重绘（否则界面留着过期状态）。
 *
 * @jest-environment jsdom
 */

import { resetBus } from '../../core/bus';
import { createCoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import type { HudCommand, MissionView, UnitView, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController } from '../theme/theme-controller';

import {
  MISSION_CONFIRM_TAG,
  missionConfirmSignature,
  mountMissionConfirm,
  type MissionConfirmDeps,
  type StratMissionConfirmElement,
} from '../panels/mission-confirm';

const UNITS: UnitView[] = [
  { id: 'u-neo', name: 'Neo', status: 'idle', missionId: null, power: 3 },
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
    unitIds: ['u-neo'],
    createdAt: 1000,
    ...patch,
  };
}

interface Harness {
  readonly panel: StratMissionConfirmElement;
  readonly commands: HudCommand[];
  emit(state: WorldState): void;
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
    commands,
    emit: (state) => { subs.forEach((handler) => handler(state)); },
    unmount: () => { unmountPanel(); host.remove(); },
  };
}

function rowOf(panel: StratMissionConfirmElement, missionId: string): HTMLElement | null {
  return panel.shadowRoot?.querySelector<HTMLElement>(`[data-mission-row="${missionId}"]`) ?? null;
}

describe('正文（brief）：有则显示，无则隐藏', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('四段全部渲染（标签 + 正文），顺序即契约顺序', () => {
    h = mountPanel();
    h.emit(makeState({
      missions: [
        mission({
          id: 'm1',
          brief: {
            requirements: '侦察北门',
            acceptance: '带回敌军布防图',
            deliverables: '一份口头汇报',
            constraints: '不得暴露单位编号',
          },
        }),
      ],
    }));

    const brief = rowOf(h.panel, 'm1')?.querySelector('[data-role="brief"]');
    expect(brief).not.toBeNull();
    const labels = Array.from(brief?.querySelectorAll('.brief-label') ?? []).map((el) => el.textContent);
    expect(labels).toEqual(['需求', '验收标准', '交付物', '约束']);
    expect(brief?.textContent).toContain('带回敌军布防图');
  });

  test('缺省的段直接不占位（不画空标题）', () => {
    h = mountPanel();
    h.emit(makeState({
      missions: [mission({ id: 'm1', brief: { acceptance: '带回敌军布防图' } })],
    }));

    const brief = rowOf(h.panel, 'm1')?.querySelector('[data-role="brief"]');
    const labels = Array.from(brief?.querySelectorAll('.brief-label') ?? []).map((el) => el.textContent);
    expect(labels).toEqual(['验收标准']);
  });

  test('没有正文 → 整块不出现', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1' })] }));

    expect(rowOf(h.panel, 'm1')?.querySelector('[data-role="brief"]')).toBeNull();
  });
});

describe('检查点：倒序折叠列表', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('最新的在最上，每条带时间与 note', () => {
    h = mountPanel();
    h.emit(makeState({
      missions: [
        mission({
          id: 'm1',
          checkpoints: [
            { at: 1000, note: '派两人出门' },
            { at: 2000, note: '发现巡逻队' },
            { at: 3000, note: '带回布防图' },
          ],
        }),
      ],
    }));

    const details = rowOf(h.panel, 'm1')?.querySelector('[data-role="checkpoints"]');
    expect(details?.tagName.toLowerCase()).toBe('details'); // 原生折叠（零 JS）
    const notes = Array.from(details?.querySelectorAll('.checkpoint-note') ?? []).map(
      (el) => el.textContent,
    );
    expect(notes).toEqual(['带回布防图', '发现巡逻队', '派两人出门']); // 倒序
    expect(details?.querySelector('.checkpoint-time')?.textContent).toMatch(/\d{2}-\d{2} \d{2}:\d{2}/);
  });

  test('没有记账 → 不出现折叠块', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1' })] }));

    expect(rowOf(h.panel, 'm1')?.querySelector('[data-role="checkpoints"]')).toBeNull();
  });
});

describe('依赖状态行：警示 / 就绪两态', () => {
  let h: Harness;
  afterEach(() => h?.unmount());

  test('前置还在办 → 警示态，依赖标未满足，并显示短码与相位', () => {
    h = mountPanel();
    h.emit(makeState({
      missions: [
        mission({ id: 'dep', title: '侦察北门', phase: 'running' }),
        mission({ id: 'm1', title: '加固城墙', dependsOn: ['dep'] }),
      ],
    }));

    const deps = rowOf(h.panel, 'm1')?.querySelector('[data-role="deps"]');
    expect(deps?.getAttribute('data-state')).toBe('warn');
    const dep = deps?.querySelector('.dep');
    expect(dep?.getAttribute('data-satisfied')).toBe('false');
    expect(dep?.textContent).toContain('dep');
    expect(dep?.textContent).toContain('进行中');
    expect(rowOf(h.panel, 'm1')?.getAttribute('data-locked')).toBe('true');
  });

  test('前置都收尾 → 就绪态，依赖标已满足', () => {
    h = mountPanel();
    h.emit(makeState({
      missions: [
        mission({ id: 'dep', title: '侦察北门', phase: 'done' }),
        mission({ id: 'm1', title: '加固城墙', dependsOn: ['dep'] }),
      ],
    }));

    const deps = rowOf(h.panel, 'm1')?.querySelector('[data-role="deps"]');
    expect(deps?.getAttribute('data-state')).toBe('ready');
    expect(deps?.querySelector('.dep')?.getAttribute('data-satisfied')).toBe('true');
    expect(deps?.textContent).toContain('已就绪');
    expect(rowOf(h.panel, 'm1')?.getAttribute('data-locked')).toBe('false');
  });

  test('没有依赖 → 不出现依赖行', () => {
    h = mountPanel();
    h.emit(makeState({ missions: [mission({ id: 'm1' })] }));

    expect(rowOf(h.panel, 'm1')?.querySelector('[data-role="deps"]')).toBeNull();
  });
});

describe('渲染签名：正文 / 检查点 / 依赖相位变了都要重绘', () => {  const base = makeState({
    missions: [
      mission({ id: 'dep', phase: 'running' }),
      mission({ id: 'm1', dependsOn: ['dep'], brief: { acceptance: '甲' } }),
    ],
  });

  test('依赖的相位变了 → 签名变（否则依赖行留着过期的警示色）', () => {
    const changed = makeState({
      missions: [
        mission({ id: 'dep', phase: 'done' }),
        mission({ id: 'm1', dependsOn: ['dep'], brief: { acceptance: '甲' } }),
      ],
    });
    expect(missionConfirmSignature(base)).not.toBe(missionConfirmSignature(changed));
  });

  test('正文变了 → 签名变', () => {
    const changed = makeState({
      missions: [
        mission({ id: 'dep', phase: 'running' }),
        mission({ id: 'm1', dependsOn: ['dep'], brief: { acceptance: '乙' } }),
      ],
    });
    expect(missionConfirmSignature(base)).not.toBe(missionConfirmSignature(changed));
  });

  test('追加一条检查点 → 签名变', () => {
    const changed = makeState({
      missions: [
        mission({ id: 'dep', phase: 'running' }),
        mission({
          id: 'm1',
          dependsOn: ['dep'],
          brief: { acceptance: '甲' },
          checkpoints: [{ at: 1, note: '记一笔' }],
        }),
      ],
    });
    expect(missionConfirmSignature(base)).not.toBe(missionConfirmSignature(changed));
  });

  test('无关变动（没被指派的单位改名）→ 签名不变', () => {
    const changed = makeState({
      units: [
        ...UNITS,
        { id: 'u-other', name: '改名了', status: 'idle', missionId: null, power: 1 },
      ],
      missions: [
        mission({ id: 'dep', phase: 'running' }),
        mission({ id: 'm1', dependsOn: ['dep'], brief: { acceptance: '甲' } }),
      ],
    });
    expect(missionConfirmSignature(base)).toBe(missionConfirmSignature(changed));
  });
});

/**
 * 闭环（真总线 + 真 runtime + 真 adapter）：HudCommand → core 状态机 → WorldState 广播 → 面板重绘。
 * 这一段证明"解锁状态经既有 store 投影广播"真的接通了：core 把前置改成终态 → 一次状态广播 →
 * 面板自己算出依赖行从"未满足"翻成"已就绪"（面板没改过任何本地状态）。
 */
describe('闭环：前置收尾 → 依赖行自己从警示翻成就绪', () => {
  const themeController: ThemeController = {
    apply: () => {},
    get current(): null { return null; },
    // 皮肤订阅（@since task_115）：本用例只关心任务链，订阅给个空实现。
    subscribe: () => () => undefined,
  };

  test('前置取消 → 下游解锁；未解锁时确认被 core 拒绝', () => {
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
      adapter.dispatch({ type: 'mission.create', title: '侦察北门', unitIds: ['u-neo'] });
      const upstream = store.getState().missions[0];
      adapter.dispatch({
        type: 'mission.create',
        title: '加固城墙',
        unitIds: ['u-neo'],
        dependsOn: [upstream.id],
      });
      const downstream = store.getState().missions[1];

      // 前置还在办 → 依赖行是警示态
      const depsOf = (): Element | null | undefined =>
        rowOf(panel, downstream.id)?.querySelector('[data-role="deps"]');
      expect(depsOf()?.getAttribute('data-state')).toBe('warn');

      // 依赖未满足 → core 拒绝确认（任务仍在待确认，界面不动）
      adapter.dispatch({ type: 'mission.confirm', missionId: downstream.id, decision: 'accept' });
      expect(store.getState().missions[1].phase).toBe('pending');
      expect(
        store.getState().notices.some((n) => n.text.includes('依赖未满足')),
      ).toBe(true);

      // 前置被叫停（终态）→ core 广播 → 依赖行自己翻成就绪
      adapter.dispatch({ type: 'mission.cancel', missionId: upstream.id });
      expect(depsOf()?.getAttribute('data-state')).toBe('ready');
      // 解锁只是"允许"：下游没有被自动确认，仍要人显式推进
      expect(store.getState().missions[1].phase).toBe('pending');
    } finally {
      unmountPanel();
      host.remove();
      stopRuntime();
      unmountAdapter();
      resetBus();
    }
  });
});
