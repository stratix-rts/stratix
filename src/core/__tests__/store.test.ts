/**
 * 单测：极简响应式 store + 总线封装（core/store.ts、core/bus.ts）。
 * 覆盖：状态写入 / 订阅 / 退订、通知自动过期与队列上限、三条通道的收发隔离。
 */

import { emitCommand, emitState, emitWorldEvent, onCommand, onState, onWorldEvent, resetBus } from '../bus';
import { createStore } from '../store';
import {
  MAX_NOTICES,
  NOTICE_TTL_MS,
  type DetectedAgent,
  type HudCommand,
  type Notice,
  type WorldEvent,
} from '../types';

const notice = (id: string, ttlMs: number, at: number): Notice => ({
  id,
  level: 'info',
  text: `n-${id}`,
  createdAt: at,
  expiresAt: at + ttlMs,
});

describe('createStore', () => {
  test('初始状态为空世界', () => {
    const state = createStore().getState();
    expect(state.units).toEqual([]);
    expect(state.missions).toEqual([]);
    expect(state.selection).toEqual({ unitIds: [], previewUnitIds: [], revision: 0 });
    expect(state.characters).toEqual([]);
    expect(state.notices).toEqual([]);
  });

  test('patch 合并顶层字段', () => {
    const store = createStore();
    store.patch({ units: [{ id: 'u1', name: 'a', status: 'idle', missionId: null, power: 1 }] });
    expect(store.getState().units).toHaveLength(1);
    expect(store.getState().missions).toEqual([]);
  });

  test('setState 用更新函数替换整态', () => {
    const store = createStore();
    store.setState((s) => ({ ...s, characters: [{ id: 'c1', name: 'n', persona: '', level: 1, experience: 0 }] }));
    expect(store.getState().characters).toHaveLength(1);
  });

  test('setState 的更新函数原样返回当前态时不广播（无变化不该刷 revision 与重渲染）', () => {
    const store = createStore();
    const listener = jest.fn();
    store.subscribe(listener);

    const result = store.setState((s) => s);

    expect(result).toBe(store.getState());
    expect(listener).not.toHaveBeenCalled();
  });

  test('subscribe 收到变更，退订后不再收到', () => {
    const store = createStore();
    const listener = jest.fn();
    const unsubscribe = store.subscribe(listener);

    store.patch({ units: [] });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.patch({ units: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  describe('notices', () => {
    test('pushNotice 最新的排在最前', () => {
      const store = createStore();
      store.pushNotice(notice('a', NOTICE_TTL_MS, Date.now()));
      store.pushNotice(notice('b', NOTICE_TTL_MS, Date.now()));
      expect(store.getState().notices.map((n) => n.id)).toEqual(['b', 'a']);
    });

    test('过期通知被剔除', () => {
      const store = createStore();
      const now = Date.now();
      store.pushNotice(notice('old', NOTICE_TTL_MS, now - NOTICE_TTL_MS - 1));
      store.pushNotice(notice('new', NOTICE_TTL_MS, now));
      expect(store.getState().notices.map((n) => n.id)).toEqual(['new']);
    });

    test('队列上限 MAX_NOTICES，防止无限增长', () => {
      const store = createStore();
      const now = Date.now();
      for (let i = 0; i < MAX_NOTICES + 10; i += 1) {
        store.pushNotice(notice(`n${i}`, NOTICE_TTL_MS, now));
      }
      expect(store.getState().notices).toHaveLength(MAX_NOTICES);
      expect(store.getState().notices[0].id).toBe(`n${MAX_NOTICES + 9}`);
    });
  });

  describe('setCurrentScreen（@since v3.6，ui.navigate 落库入口）', () => {
    test('写入新屏：广播一次，store 当前屏位随变', () => {
      const store = createStore();
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      const next = store.setCurrentScreen('settings');

      expect(broadcasts).toBe(1);
      expect(store.getState().currentScreen).toBe('settings');
      expect(next).toBe(store.getState());
    });

    test('与当前屏一致：原样返回、不广播（引用未变即不广播约定）', () => {
      const store = createStore();
      store.setCurrentScreen('character');
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      const next = store.setCurrentScreen('character');

      expect(broadcasts).toBe(0);
      expect(next).toBe(store.getState());
    });

    test('传 null 表示「返回主屏」：清空 currentScreen（缺省回落读取方自管）', () => {
      const store = createStore();
      store.setCurrentScreen('settings');
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      const next = store.setCurrentScreen(null);

      expect(broadcasts).toBe(1);
      expect(next.currentScreen).toBeUndefined();
      expect(store.getState().currentScreen).toBeUndefined();
    });

    test('null → null：不广播', () => {
      const store = createStore();
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      const next = store.setCurrentScreen(null);

      expect(broadcasts).toBe(0);
      expect(next.currentScreen).toBeUndefined();
    });
  });

  describe('setDetectedAgents（@since v3.8，本地 CLI agent 检测结果落库入口）', () => {
    const detected = (kind: 'claude-code' | 'codex'): DetectedAgent => ({
      kind,
      tier: 'T1',
      installed: true,
      status: 'installed',
      version: '1.2.3',
      path: `/usr/local/bin/${kind}`,
    });

    test('写入后状态里带 detectedAgents（随下一次广播全量下发）', () => {
      const store = createStore();
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      const next = store.setDetectedAgents([detected('claude-code')]);

      expect(broadcasts).toBe(1);
      expect(next.detectedAgents).toHaveLength(1);
      expect(next.detectedAgents?.[0]?.kind).toBe('claude-code');
      expect(store.getState().detectedAgents).toHaveLength(1);
    });

    test('整份替换语义：新快照覆盖旧快照，不做增量合并', () => {
      const store = createStore();
      store.setDetectedAgents([detected('claude-code'), detected('codex')]);

      const next = store.setDetectedAgents([detected('codex')]);

      expect(next.detectedAgents).toHaveLength(1);
      expect(next.detectedAgents?.[0]?.kind).toBe('codex');
    });

    test('同内容重复写入不广播（重复扫描不该把两侧白白重渲染一遍）', () => {
      const store = createStore();
      store.setDetectedAgents([detected('claude-code')]);
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      const next = store.setDetectedAgents([detected('claude-code')]);

      expect(broadcasts).toBe(0);
      expect(next).toBe(store.getState());
    });

    test('内容变了就广播（版本更新也算变化）', () => {
      const store = createStore();
      store.setDetectedAgents([detected('claude-code')]);
      let broadcasts = 0;
      store.subscribe(() => { broadcasts += 1; });

      store.setDetectedAgents([{ ...detected('claude-code'), version: '1.2.4' }]);

      expect(broadcasts).toBe(1);
    });
  });
});

describe('bus', () => {
  beforeEach(() => resetBus());

  test('command 通道单向送达', () => {
    const onCmd = jest.fn<void, [HudCommand]>();
    const unsub = onCommand(onCmd);
    emitCommand({ type: 'theme.set', themeId: 'pixel' });
    unsub();
    emitCommand({ type: 'ui.navigate', screen: 'settings' });
    expect(onCmd).toHaveBeenCalledTimes(1);
    expect(onCmd).toHaveBeenCalledWith({ type: 'theme.set', themeId: 'pixel' });
  });

  test('world 事件不串到 command 通道', () => {
    const onCmd = jest.fn<void, [HudCommand]>();
    const onEvt = jest.fn<void, [WorldEvent]>();
    onCommand(onCmd);
    onWorldEvent(onEvt);

    emitWorldEvent({ type: 'unit.click', unitId: 'u1', mods: { shift: false, ctrl: true, meta: false, alt: false } });

    expect(onEvt).toHaveBeenCalledTimes(1);
    expect(onCmd).not.toHaveBeenCalled();
  });

  test('state 广播收到的是 store 的世界态', () => {
    const store = createStore();
    const onSt = jest.fn();
    onState(onSt);

    store.patch({ units: [] });
    emitState(store.getState());

    expect(onSt).toHaveBeenCalledTimes(1);
    expect(onSt.mock.calls[0][0]).toBe(store.getState());
  });

  test('resetBus 清空全部监听（测试隔离）', () => {
    const onCmd = jest.fn<void, [HudCommand]>();
    onCommand(onCmd);
    resetBus();
    emitCommand({ type: 'chat.send', text: 'hi' });
    expect(onCmd).not.toHaveBeenCalled();
  });
});