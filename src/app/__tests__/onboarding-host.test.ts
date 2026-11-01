/**
 * 集成测试：首启向导覆盖层的挂载管理（app/main/onboarding-host.ts）。
 * 覆盖：该挂才挂、只挂一次、完成 / 跳过后收起且不再弹、dispose 收干净。
 * @jest-environment jsdom
 *
 * 边界说明：宿主只做"挂不挂 / 什么时候收"—— 屏内四步由 hud/screens/onboarding-screen.ts 负责，
 *   那边已有自己的单测；这里测的是接线契约（挂载时机 + 事件 → 收起）。
 */

import type { DetectedAgent, HudCommand, WorldState } from '../../core/types';
import { ONBOARDING_COMPLETE_EVENT, ONBOARDING_SCREEN_TAG } from '../../hud/screens/onboarding-screen';

import { createOnboardingHost } from '../main/onboarding-host';

function detected(partial: Partial<DetectedAgent> & { kind: DetectedAgent['kind'] }): DetectedAgent {
  return {
    tier: 'T1',
    installed: false,
    status: 'not-installed',
    version: null,
    path: null,
    ...partial,
  };
}

const CLAUDE = detected({ kind: 'claude-code', tier: 'T1', installed: true, status: 'installed' });

function stateWith(patch: Partial<WorldState>): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    detectedAgents: [],
    ...patch,
  };
}

interface Harness {
  readonly host: HTMLElement;
  readonly commands: HudCommand[];
  readonly completed: unknown[];
  readonly skipped: number[];
  readonly controller: ReturnType<typeof createOnboardingHost>;
  /** 当前挂着的向导屏元素（未挂 = null）。 */
  screen(): HTMLElement | null;
}

function setup(force = false): Harness {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const commands: HudCommand[] = [];
  const completed: unknown[] = [];
  const skipped: number[] = [];

  const controller = createOnboardingHost({
    deps: {
      dispatch: (command) => { commands.push(command); },
      subscribe: () => () => { /* 本测试不关心状态回放 */ },
    },
    host,
    force,
    onComplete: (detail) => { completed.push(detail); },
    onSkip: () => { skipped.push(1); },
  });

  return {
    host,
    commands,
    completed,
    skipped,
    controller,
    screen: () => host.querySelector(ONBOARDING_SCREEN_TAG),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('首启向导覆盖层', () => {
  test('角色为空 + 探到已装 agent → 挂上向导屏', () => {
    const h = setup();

    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE] }));

    expect(h.screen()).not.toBeNull();
    expect(h.controller.mounted).toBe(true);
  });

  test('没探到已装 agent → 不挂', () => {
    const h = setup();

    h.controller.evaluate(stateWith({ detectedAgents: [] }));

    expect(h.screen()).toBeNull();
    expect(h.controller.mounted).toBe(false);
  });

  test('已经有角色 → 不挂（不是首启）', () => {
    const h = setup();

    h.controller.evaluate(
      stateWith({
        detectedAgents: [CLAUDE],
        characters: [
          { id: 'c1', name: 'Neo', persona: '', level: 1, experience: 0 },
        ],
      })
    );

    expect(h.screen()).toBeNull();
  });

  test('强制开关：没有 agent 也挂（开发期走查用）', () => {
    const h = setup(true);

    h.controller.evaluate(stateWith({ detectedAgents: [] }));

    expect(h.screen()).not.toBeNull();
  });

  test('只挂一次：后续广播不再重复挂', () => {
    const h = setup();

    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE] }));
    const first = h.screen();
    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE, CLAUDE] }));

    expect(h.screen()).toBe(first);
    expect(h.host.querySelectorAll(ONBOARDING_SCREEN_TAG)).toHaveLength(1);
  });

  test('用户跳过 → 收起覆盖层，且本次会话不再弹', () => {
    const h = setup();
    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE] }));

    const screen = h.screen() as HTMLElement & { skip: () => void };
    screen.skip();

    expect(h.screen()).toBeNull();
    expect(h.controller.mounted).toBe(false);
    expect(h.controller.settled).toBe(true);
    expect(h.skipped).toHaveLength(1);

    // 之后再评估也不挂（已结束）。
    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE] }));
    expect(h.screen()).toBeNull();
  });

  test('建档完成 → 收起覆盖层并回调（附带建了哪些角色）', () => {
    const h = setup();
    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE] }));

    const screen = h.screen() as HTMLElement;
    screen.dispatchEvent(
      new CustomEvent(ONBOARDING_COMPLETE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { created: [{ kind: 'claude-code', name: 'Neo', skinId: 'crimson' }] },
      })
    );

    expect(h.screen()).toBeNull();
    expect(h.controller.settled).toBe(true);
    expect(h.completed).toHaveLength(1);
  });

  test('dispose：收掉覆盖层（元素移除即退订，不留监听器）', () => {
    const h = setup();
    h.controller.evaluate(stateWith({ detectedAgents: [CLAUDE] }));

    h.controller.dispose();

    expect(h.screen()).toBeNull();
    expect(h.controller.mounted).toBe(false);
  });
});
