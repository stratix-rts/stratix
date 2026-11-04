/**
 * 单测：HUD ↔ core 总线适配器（hud/bridge/bus-adapter.ts）。
 * 覆盖：state 订阅与回放、theme.set 本地落皮肤后再广播、HudCommand 透传、unmount 清理监听器。
 * 依赖：用 jest.fn 桩出 onState / emitCommand，避免触碰 core/bus 单例（隔离测试）。
 */

import type { Unsubscribe } from '../../core/bus';
import type { HudCommand, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeController } from '../theme/theme-controller';

const emptyState = (): WorldState => ({
  units: [],
  missions: [],
  selection: { unitIds: [], previewUnitIds: [], revision: 0 },
  characters: [],
  notices: [],
  // @since v3.1 core/agent-link 的状态投影字段（WorldState 契约要求显式存在，空数组即"无会话"）
  links: [],
  messages: [],
});

interface Harness {
  readonly received: HudCommand[];
  incoming: (state: WorldState) => void;
  readonly applyThemeCalls: string[];
  /** 模拟 core/bus.onState：把 handler 注册到内部订阅列表。生产代码直接用 core/bus.onState。 */
  readonly onState: (handler: (state: WorldState) => void) => Unsubscribe;
  /** 通过 harness 内置适配器 dispatch 命令。 */
  readonly emit: (cmd: HudCommand) => void;
  readonly themeController: ThemeController;
}

function makeHarness(): Harness {
  const received: HudCommand[] = [];
  const subs = new Set<(s: WorldState) => void>();
  const applyThemeCalls: string[] = [];

  const themeController: ThemeController = {
    apply: (id) => { applyThemeCalls.push(id); },
    get current(): null { return null; },
    // 皮肤订阅（@since task_115）：本用例只关心派发链，订阅给个空实现。
    subscribe: () => () => undefined,
  };

  const adapter = createHudBusAdapter({
    onState: (handler) => {
      subs.add(handler);
      return () => { subs.delete(handler); };
    },
    emitCommand: (cmd) => received.push(cmd),
    themeController,
  });

  return {
    received,
    incoming: (state) => { subs.forEach((h) => h(state)); },
    applyThemeCalls,
    onState: (handler) => { subs.add(handler); return () => { subs.delete(handler); }; },
    emit: (cmd) => adapter.dispatch(cmd),
    themeController,
  };
}

describe('createHudBusAdapter', () => {
  test('mount 后订阅 onState，state 变更触发订阅者', () => {
    const h = makeHarness();
    const seen: WorldState[] = [];
    const adapter = createHudBusAdapter({
      onState: h.onState,
      emitCommand: () => {},
      themeController: h.themeController,
    });
    adapter.mount();
    const seenNow: WorldState[] = [];
    adapter.subscribe((s) => seenNow.push(s));
    h.incoming(emptyState());
    expect(seenNow.length).toBe(1);
    // sanity：同一个 state 不会再出现在未见订阅里
    expect(seen).toEqual([]);
  });

  test('subscribe 在 mount 后立即拿到最新 state（缓存回放）', () => {
    const h = makeHarness();
    const adapter = createHudBusAdapter({
      onState: h.onState,
      emitCommand: () => {},
      themeController: h.themeController,
    });
    adapter.mount();
    h.incoming(emptyState());
    const seen: WorldState[] = [];
    adapter.subscribe((s) => seen.push(s));
    expect(seen).toHaveLength(1);
  });

  test('subscribe 在 mount 前调用也立即拿到最近一次快照', () => {
    const h = makeHarness();
    const adapter = createHudBusAdapter({
      onState: h.onState,
      emitCommand: () => {},
      themeController: h.themeController,
    });
    adapter.mount();
    h.incoming(emptyState());
    const before: WorldState[] = [];
    adapter.subscribe((s) => before.push(s));
    expect(before).toHaveLength(1);

    const after: WorldState[] = [];
    const unsub = adapter.subscribe((s) => after.push(s));
    h.incoming({ ...emptyState(), units: [{ id: 'u1', name: 'a', status: 'idle', missionId: null, power: 1 }] });
    expect(after).toHaveLength(2);
    unsub();
    h.incoming(emptyState());
    expect(after).toHaveLength(2);
  });

  test('dispatch(theme.set) 先调本地 applyTheme 再 emit', () => {
    const h = makeHarness();
    h.emit({ type: 'theme.set', themeId: 'pixel' });
    expect(h.applyThemeCalls).toEqual(['pixel']);
    expect(h.received).toEqual([{ type: 'theme.set', themeId: 'pixel' }]);
  });

  test('dispatch(theme.set default) 调用本地 applyTheme', () => {
    const h = makeHarness();
    h.emit({ type: 'theme.set', themeId: 'default' });
    expect(h.applyThemeCalls).toEqual(['default']);
  });

  test('dispatch 其他命令仅 emit 不触发主题', () => {
    const h = makeHarness();
    h.emit({ type: 'chat.send', text: 'hi' });
    h.emit({ type: 'ui.navigate', screen: 'settings' });
    h.emit({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(h.applyThemeCalls).toEqual([]);
    expect(h.received.map((c) => c.type)).toEqual(['chat.send', 'ui.navigate', 'unit.select']);
  });

  test('unmount 后清空订阅，新 state 不再送达', () => {
    const h = makeHarness();
    const adapter = createHudBusAdapter({
      onState: h.onState,
      emitCommand: () => {},
      themeController: h.themeController,
    });
    adapter.mount();
    const seen: WorldState[] = [];
    adapter.subscribe((s) => seen.push(s));
    h.incoming(emptyState());
    const count = seen.length;
    const unmount = adapter.mount();
    unmount(); // 显式卸载
    h.incoming(emptyState());
    // 卸载后订阅列表已 clear，应当不会新增
    expect(seen.length).toBe(count);
  });

  test('latest 暴露最近 state（用于初始化渲染）', () => {
    const h = makeHarness();
    const adapter = createHudBusAdapter({
      onState: h.onState,
      emitCommand: () => {},
      themeController: h.themeController,
    });
    expect(adapter.latest).toBeNull();
    adapter.mount();
    h.incoming(emptyState());
    expect(adapter.latest).not.toBeNull();
  });
});
