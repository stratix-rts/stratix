/**
 * 集成测试：空态组件（@since v3.8，task_136）。
 *
 * 覆盖两块：
 *   ① 统一空态组件 `<strat-empty-state>` —— 图标位 + 插槽文案 + 可选动作；
 *   ② 战场空态覆盖层 `<strat-battlefield-empty>` —— 显隐跟着 core 广播的单位表走，
 *      两个动作分别派 create / command 事件（真实联动由 e2e 兜）。
 *
 * @jest-environment jsdom
 */

import { emitCommand, emitState, onState, resetBus } from '../../core/bus';
import { createCoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import type { WorldState } from '../../core/types';
import {
  createEmptyState,
  defineEmptyState,
  EMPTY_STATE_ACTION_EVENT,
  EMPTY_STATE_TAG,
} from '../components/empty-state/empty-state';
import {
  BATTLEFIELD_EMPTY_ACTION_EVENT,
  BATTLEFIELD_EMPTY_HINT,
  BATTLEFIELD_EMPTY_TAG,
  BATTLEFIELD_EMPTY_TITLE,
  mountBattlefieldEmpty,
} from '../components/battlefield-empty/battlefield-empty';

/** 造一份最小 WorldState（只带 units —— 空态只读这一项）。 */
function stateWithUnits(count: number): WorldState {
  return {
    units: Array.from({ length: count }, (_, i) => ({
      id: `u${i}`,
      name: `单位${i}`,
      status: 'idle' as const,
      missionId: null,
      power: 1,
    })),
  } as unknown as WorldState;
}

describe('统一空态组件 <strat-empty-state>（task_136）', () => {
  test('注册后可建元素：图标位 + 文案在 light DOM（断言读得到）+ 影子里的图标位', () => {
    defineEmptyState();
    const el = createEmptyState('还没有会话', { icon: '◎' });
    expect(el.tagName.toLowerCase()).toBe(EMPTY_STATE_TAG);
    expect(el.textContent).toContain('还没有会话');
    expect(el.shadowRoot?.querySelector('[data-role="icon"]')).not.toBeNull();
    // 插槽：文案进插槽 → 版式由组件统一（shadow 内有 slot）。
    expect(el.shadowRoot?.querySelector('slot')).not.toBeNull();
  });

  test('无 action 属性 → 动作按钮隐藏；带 action → 可见且点击派事件', () => {
    defineEmptyState();
    const plain = createEmptyState('没有匹配的命令');
    const button = plain.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="action"]');
    expect(button?.hidden).toBe(true);

    const withAction = createEmptyState('还没有会话', { action: '去建角色' });
    const action = withAction.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="action"]');
    expect(action?.hidden).toBe(false);
    expect(action?.textContent).toBe('去建角色');

    const seen: string[] = [];
    withAction.addEventListener(EMPTY_STATE_ACTION_EVENT, (event) => {
      seen.push((event as CustomEvent<{ action: string }>).detail.action);
    });
    action?.click();
    expect(seen).toEqual(['primary']);
  });
});

describe('战场空态覆盖层 <strat-battlefield-empty>（task_136）', () => {
  test('0 单位 → 亮出；有单位 → 收起（跟着 core 广播走）', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    // 订阅句柄装在盒子里（TS 的流分析对闭包里的局部变量赋值会误判为 null）。
    const captured: { current: ((state: WorldState) => void) | null } = { current: null };
    const handle = mountBattlefieldEmpty(host, {
      subscribe: (h) => {
        captured.current = h;
        return () => {
          captured.current = null;
        };
      },
    });
    expect(host.querySelector(BATTLEFIELD_EMPTY_TAG)).not.toBeNull();

    captured.current?.(stateWithUnits(0));
    expect(handle.element.hidden).toBe(false);
    captured.current?.(stateWithUnits(2));
    expect(handle.element.hidden).toBe(true);
    captured.current?.(stateWithUnits(0));
    expect(handle.element.hidden).toBe(false);

    handle.unmount();
    expect(host.querySelector(BATTLEFIELD_EMPTY_TAG)).toBeNull();
    host.remove();
  });

  test('文案是人话（不含 gateway / 数据流这类开发者词）+ 两个动作分别派事件', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const created: string[] = [];
    const opened: string[] = [];
    const handle = mountBattlefieldEmpty(host, {
      subscribe: () => () => undefined,
      onCreateCharacter: () => created.push('create'),
      onOpenCommand: () => opened.push('command'),
    });
    const root = handle.element.shadowRoot;
    expect(root?.querySelector('[data-role="title"]')?.textContent).toBe(BATTLEFIELD_EMPTY_TITLE);
    expect(root?.querySelector('[data-role="hint"]')?.textContent).toBe(BATTLEFIELD_EMPTY_HINT);
    // 人话口径：不得出现开发者词。
    expect(BATTLEFIELD_EMPTY_HINT).not.toMatch(/gateway|数据流|接入/);
    expect(BATTLEFIELD_EMPTY_TITLE).not.toMatch(/gateway|数据流|接入/);

    const events: string[] = [];
    handle.element.addEventListener(BATTLEFIELD_EMPTY_ACTION_EVENT, (event) => {
      events.push((event as CustomEvent<{ action: string }>).detail.action);
    });
    (root?.querySelector('[data-role="action-create"]') as HTMLButtonElement).click();
    (root?.querySelector('[data-role="action-command"]') as HTMLButtonElement).click();
    expect(events).toEqual(['create', 'command']);
    expect(created).toEqual(['create']);
    expect(opened).toEqual(['command']);

    handle.unmount();
    host.remove();
  });
});

describe('战场空态的真联动（task_136）：建角色 → 空态消失；删角色 → 空态回来', () => {
  test('走**真 core**（真命令 → 真状态广播 → 覆盖层显隐），不造假数据', () => {
    resetBus();
    const runtime = createCoreRuntime({ store: createStore() });
    const stop = runtime.start();

    const host = document.createElement('div');
    document.body.appendChild(host);
    const handle = mountBattlefieldEmpty(host, { subscribe: (h) => onState(h) });
    // 首帧状态（真 app 里 core 起跑后广播的同一份世界态）。
    emitState(runtime.store.getState());

    // 起点：0 单位 → 空态亮着。
    expect(runtime.store.getState().units).toHaveLength(0);
    expect(handle.element.hidden).toBe(false);

    // 建一个角色 → core 投影出战场单位 → 状态广播 → 空态收起。
    emitCommand({ type: 'character.create', name: '验收员', agentKind: 'claude-code', skinId: 'default' });
    const afterCreate = runtime.store.getState();
    expect(afterCreate.characters).toHaveLength(1);
    expect(afterCreate.units).toHaveLength(1);
    expect(handle.element.hidden).toBe(true);

    // 删掉角色 → 单位没了 → 空态回来。
    const characterId = afterCreate.characters[0]?.id;
    expect(characterId).toBeTruthy();
    emitCommand({ type: 'character.delete', characterId: characterId! });
    expect(runtime.store.getState().units).toHaveLength(0);
    expect(handle.element.hidden).toBe(false);

    handle.unmount();
    stop();
    host.remove();
    resetBus();
  });
});
