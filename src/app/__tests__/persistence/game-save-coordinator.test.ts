/**
 * 单测：游戏存档协调器（app/services/persistence/game-save-coordinator.ts）。
 *
 * 测试打的是**真实的 core/bus 单例 + 真实 store + runtime 广播链**（与 runtime.test 同一策略）：
 * 协调器的输入就是"state 广播"与"world 事件"，mock 掉等于把被测行为一起 mock 掉了。
 * 只有 IPC 面（GameSaveApi）是 fake —— 那是进程边界，单元测试到不了主进程。
 * 防抖窗口用 jest 假定时器推进，不靠真实睡眠。
 */

import { emitWorldEvent, resetBus } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore } from '../../../core/store';
import type { CharacterView, UnitView } from '../../../core/types';
import type { GameSaveApi, GameSaveSnapshotResult } from '../../services/persistence/game-save-coordinator';
import {
  buildRestoreInjection,
  characterIdFromUnitId,
  characterViewToRecord,
  createGameSaveCoordinator,
  parseAppearanceJson,
  recordToCharacterView,
} from '../../services/persistence/game-save-coordinator';

// ============================================================================
// 夹具
// ============================================================================

function character(patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id: 'character_1',
    name: '阿锻',
    persona: '沉着冷静',
    level: 2,
    experience: 120,
    agentKind: 'claude-code',
    skinId: 'skin_forge',
    externalSessionId: null,
    appearance: { bodyType: 'male', parts: { hair: 'black' } },
    ...patch,
  };
}

function unit(id: string, patch: Partial<UnitView> = {}): UnitView {
  return { id, name: id, status: 'idle', missionId: null, power: 0, ...patch };
}

function snapshotResult(result: Partial<GameSaveSnapshotResult> = {}): GameSaveSnapshotResult {
  return { ok: true, characters: [], unitPositions: [], ...result };
}

function createFakeApi(snapshot: GameSaveSnapshotResult = snapshotResult()): GameSaveApi & {
  loadSnapshot: jest.Mock;
  saveCharacters: jest.Mock;
  saveUnitPositions: jest.Mock;
} {
  return {
    loadSnapshot: jest.fn(async () => snapshot),
    saveCharacters: jest.fn(async () => ({ ok: true })),
    saveUnitPositions: jest.fn(async () => ({ ok: true })),
  };
}

interface Harness {
  api: ReturnType<typeof createFakeApi>;
  store: ReturnType<typeof createStore>;
  stopRuntime: () => void;
}

/** 真总线 + 真 runtime：store.setState 的变更必须经 runtime 广播才能到协调器（与生产同链路）。 */
function harness(snapshot?: GameSaveSnapshotResult): Harness {
  const store = createStore();
  const runtime = createCoreRuntime({ store, onUnhandled: () => {} });
  const stopRuntime = runtime.start();
  return { api: createFakeApi(snapshot), store, stopRuntime };
}

/** 排空微任务：fake api 的 async resolve / then 链要落定后才能断言调用。
 *  why 不用 setTimeout(0)：假定时器开着时它永远不触发（防抖窗口归 advanceTimersByTime 管），
 *  纯 Promise.resolve 链才是与定时器无关的微任务排空。 */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  resetBus();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  resetBus();
});

// ============================================================================
// 翻译纯函数
// ============================================================================

describe('parseAppearanceJson', () => {
  it('合法 JSON → CharacterAppearance', () => {
    expect(parseAppearanceJson('{"bodyType":"male","parts":{"hair":"black"}}')).toEqual({
      bodyType: 'male',
      parts: { hair: 'black' },
    });
  });

  it('null / 坏 JSON / 体型不在词表 / parts 不是对象 → 一律 null（降级，不抛）', () => {
    expect(parseAppearanceJson(null)).toBeNull();
    expect(parseAppearanceJson('{oops')).toBeNull();
    expect(parseAppearanceJson('{"bodyType":"robot","parts":{}}')).toBeNull();
    expect(parseAppearanceJson('{"bodyType":"male","parts":"no"}')).toBeNull();
  });
});

describe('recordToCharacterView / characterViewToRecord', () => {
  it('记录 → 视图 → 记录 往返保真', () => {
    const record = {
      id: 'c1',
      name: '阿锻',
      agentKind: 'claude-code',
      persona: 'p',
      level: 2,
      exp: 120,
      appearanceJson: '{"bodyType":"male","parts":{"hair":"black"}}',
      bodyType: 'male',
      skinId: 'skin_forge',
      externalSessionId: null,
      contextEnabled: true,
      createdAt: 1,
    };
    const view = recordToCharacterView(record);
    expect(view).not.toBeNull();
    const back = characterViewToRecord(view as CharacterView, 42);
    expect(back).toEqual({ ...record, createdAt: 42 });
  });

  it('不认识的 agentKind 归为未绑定（null），不编造种类', () => {
    const view = recordToCharacterView({
      id: 'c1', name: 'x', agentKind: 'skynet', persona: '', level: 1, exp: 0,
      appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 1,
    });
    expect(view?.agentKind).toBeNull();
  });

  it('task_056：自定义段 kind（custom:<id>）恢复时照绑 —— 注册删了也不抹档案（删除只断检测）', () => {
    // 形状合法的注册段：恢复翻译保留绑定（isBindableAgentKind 同 core 建档校验一份口径）。
    const view = recordToCharacterView({
      id: 'c1', name: '自研单位', agentKind: 'custom:myagent', persona: '', level: 1, exp: 0,
      appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 1,
    });
    expect(view?.agentKind).toBe('custom:myagent');
    // 形状不合法的（非注册段字符集）仍归未绑定 —— 档案层只认形状，注册在与否是检测层的事。
    const dirty = recordToCharacterView({
      id: 'c1', name: 'x', agentKind: 'custom:not/a-slug', persona: '', level: 1, exp: 0,
      appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 1,
    });
    expect(dirty?.agentKind).toBeNull();
  });

  it('脏行（id 或 name 为空）→ null', () => {
    expect(recordToCharacterView({
      id: '', name: 'x', agentKind: null, persona: '', level: 1, exp: 0,
      appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 1,
    })).toBeNull();
    expect(recordToCharacterView({
      id: 'c1', name: '', agentKind: null, persona: '', level: 1, exp: 0,
      appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 1,
    })).toBeNull();
  });
});

describe('characterIdFromUnitId', () => {
  it('带前缀剥出角色 id；其余返回 null', () => {
    expect(characterIdFromUnitId('unit_character_9')).toBe('character_9');
    expect(characterIdFromUnitId('gateway-unit-7')).toBeNull();
  });
});

// ============================================================================
// 恢复注入
// ============================================================================

describe('buildRestoreInjection', () => {
  it('快照 → 角色 + 单位投影 + 站位种子（characterId 映射成 unitId）', () => {
    const injection = buildRestoreInjection({
      characters: [
        {
          id: 'character_1', name: '阿锻', agentKind: 'kimi', persona: 'p', level: 1, exp: 0,
          appearanceJson: null, bodyType: null, skinId: 's', externalSessionId: null, contextEnabled: true, createdAt: 1,
        },
      ],
      unitPositions: [{ characterId: 'character_1', x: 10, y: 20 }],
    });

    expect(injection.characters).toHaveLength(1);
    expect(injection.units).toHaveLength(1);
    expect(injection.units[0]?.id).toBe('unit_character_1');
    expect(injection.units[0]?.characterId).toBe('character_1');
    expect(injection.positionsByUnitId.get('unit_character_1')).toEqual({ x: 10, y: 20 });
  });

  it('脏行跳过；孤儿站位（对应角色没恢复）不进种子', () => {
    const injection = buildRestoreInjection({
      characters: [
        {
          id: '', name: '脏行', agentKind: null, persona: '', level: 1, exp: 0,
          appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 1,
        },
        {
          id: 'character_ok', name: '好的', agentKind: null, persona: '', level: 1, exp: 0,
          appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: 2,
        },
      ],
      unitPositions: [
        { characterId: 'character_ok', x: 1, y: 2 },
        { characterId: 'character_ghost', x: 3, y: 4 },
      ],
    });

    expect(injection.characters.map((c) => c.id)).toEqual(['character_ok']);
    expect([...injection.positionsByUnitId.keys()]).toEqual(['unit_character_ok']);
  });

  it('超过契约上限（MAX_CHARACTERS）的多余档案不恢复', () => {
    const rows = Array.from({ length: 70 }, (_, i) => ({
      id: `c_${i}`, name: `n${i}`, agentKind: null, persona: '', level: 1, exp: 0,
      appearanceJson: null, bodyType: null, skinId: null, externalSessionId: null, contextEnabled: true, createdAt: i,
    }));
    const injection = buildRestoreInjection({ characters: rows, unitPositions: [] });
    expect(injection.characters.length).toBeLessThanOrEqual(64);
  });
});

// ============================================================================
// 协调器（restore + 落库订阅）
// ============================================================================

describe('coordinator.restore', () => {
  it('读档成功 → 返回注入包', async () => {
    const { api, stopRuntime } = harness(snapshotResult({
      characters: [
        {
          id: 'character_1', name: '阿锻', agentKind: 'claude-code', persona: 'p', level: 2, exp: 120,
          appearanceJson: '{"bodyType":"male","parts":{}}', bodyType: 'male', skinId: 's',
          externalSessionId: null, contextEnabled: true, createdAt: 1,
        },
      ],
      unitPositions: [{ characterId: 'character_1', x: 5, y: 6 }],
    }));
    const coordinator = createGameSaveCoordinator({ api, store: createStore() });

    const injection = await coordinator.restore();
    expect(injection.characters).toHaveLength(1);
    expect(injection.characters[0]?.experience).toBe(120);
    expect(injection.units[0]?.id).toBe('unit_character_1');
    expect(injection.positionsByUnitId.get('unit_character_1')).toEqual({ x: 5, y: 6 });
    stopRuntime();
  });

  it('读档被拒 / 通道异常 → 空注入（降级不抛，启动不被存档问题卡死）', async () => {
    const { api, stopRuntime } = harness(snapshotResult({ ok: false, error: 'boom' }));
    const coordinator = createGameSaveCoordinator({ api, store: createStore() });
    const injection = await coordinator.restore();
    expect(injection.characters).toHaveLength(0);
    expect(injection.units).toHaveLength(0);
    stopRuntime();

    const broken: GameSaveApi = {
      loadSnapshot: async () => {
        throw new Error('ipc dead');
      },
      saveCharacters: async () => ({ ok: true }),
      saveUnitPositions: async () => ({ ok: true }),
    };
    const injection2 = await createGameSaveCoordinator({ api: broken, store: createStore() }).restore();
    expect(injection2.characters).toHaveLength(0);
  });
});

describe('coordinator 档案落库（订阅 state 广播）', () => {
  it('start 后新增/变更的档案才回写；注入时的存量不回写', async () => {
    const existing = character();
    const { api, store, stopRuntime } = harness();
    store.setState((s) => ({ ...s, characters: [existing] }));

    const coordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    coordinator.start();
    await flushMicrotasks();
    expect(api.saveCharacters).not.toHaveBeenCalled();

    // 新增一个角色 → 恰好回写这一条
    const added = character({ id: 'character_2', name: '新角色' });
    store.setState((s) => ({ ...s, characters: [...s.characters, added] }));
    await flushMicrotasks();
    expect(api.saveCharacters).toHaveBeenCalledTimes(1);
    expect(api.saveCharacters.mock.calls[0]?.[0]).toHaveLength(1);
    const savedRecord = api.saveCharacters.mock.calls[0]?.[0][0];
    expect(savedRecord?.id).toBe('character_2');
    expect(savedRecord?.exp).toBe(120);

    // 改既有角色的 persona（新对象）→ 只回写这一条
    const updated = { ...existing, persona: '新提示词' };
    store.setState((s) => ({ ...s, characters: s.characters.map((c) => (c.id === existing.id ? updated : c)) }));
    await flushMicrotasks();
    expect(api.saveCharacters).toHaveBeenCalledTimes(2);
    expect(api.saveCharacters.mock.calls[1]?.[0]).toHaveLength(1);
    expect(api.saveCharacters.mock.calls[1]?.[0][0]?.persona).toBe('新提示词');

    // 无实质变化（引用未变）→ 不回写
    store.setState((s) => ({ ...s, selection: { ...s.selection, revision: s.selection.revision + 1 } }));
    await flushMicrotasks();
    expect(api.saveCharacters).toHaveBeenCalledTimes(2);

    coordinator.stop();
    stopRuntime();
  });

  it('存档写失败（ok:false / 抛异常）不影响后续订阅', async () => {
    const { api, store, stopRuntime } = harness();
    api.saveCharacters.mockResolvedValueOnce({ ok: false, error: 'disk full' });
    api.saveCharacters.mockRejectedValueOnce(new Error('ipc gone'));

    const coordinator = createGameSaveCoordinator({ api, store });
    coordinator.start();
    store.setState((s) => ({ ...s, characters: [character()] }));
    await flushMicrotasks();
    store.setState((s) => ({
      ...s,
      characters: [...s.characters, character({ id: 'character_2' })],
    }));
    await flushMicrotasks();
    // 两次都失败，但协调器还活着：第三次变化照样回写
    store.setState((s) => ({
      ...s,
      characters: [...s.characters, character({ id: 'character_3' })],
    }));
    await flushMicrotasks();

    expect(api.saveCharacters).toHaveBeenCalledTimes(3);
    coordinator.stop();
    stopRuntime();
  });
});

describe('coordinator 站位落库（防抖）', () => {
  it('unit.position 进缓冲，防抖窗口后批量落库；同角色只留最新坐标', async () => {
    const { api, store, stopRuntime } = harness();
    store.setState((s) => ({ ...s, characters: [character()] }));

    const coordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    coordinator.start();
    await flushMicrotasks();

    emitWorldEvent({ type: 'unit.position', unitId: 'unit_character_1', x: 1, y: 2 });
    emitWorldEvent({ type: 'unit.position', unitId: 'unit_character_1', x: 3, y: 4 });
    expect(coordinator.pendingPositionCount).toBe(1);

    jest.advanceTimersByTime(999);
    expect(api.saveUnitPositions).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(api.saveUnitPositions).toHaveBeenCalledTimes(1);
    expect(api.saveUnitPositions.mock.calls[0]?.[0]).toEqual([{ characterId: 'character_1', x: 3, y: 4 }]);
    expect(coordinator.pendingPositionCount).toBe(0);

    coordinator.stop();
    stopRuntime();
  });

  it('非角色单位 / 台账外角色的位置不入库', async () => {
    const { api, store, stopRuntime } = harness();
    store.setState((s) => ({ ...s, characters: [character()] }));

    const coordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    coordinator.start();
    await flushMicrotasks();

    emitWorldEvent({ type: 'unit.position', unitId: 'gateway-unit-7', x: 1, y: 1 });
    emitWorldEvent({ type: 'unit.position', unitId: 'unit_character_unknown', x: 2, y: 2 });
    jest.advanceTimersByTime(5000);

    expect(api.saveUnitPositions).not.toHaveBeenCalled();
    coordinator.stop();
    stopRuntime();
  });

  it('stop 立即冲刷未落盘的缓冲（页面卸载不丢最后一段站位）', async () => {
    const { api, store, stopRuntime } = harness();
    store.setState((s) => ({ ...s, characters: [character()] }));

    const coordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    coordinator.start();
    await flushMicrotasks();

    emitWorldEvent({ type: 'unit.position', unitId: 'unit_character_1', x: 9, y: 8 });
    coordinator.stop();
    await flushMicrotasks();

    expect(api.saveUnitPositions).toHaveBeenCalledTimes(1);
    expect(api.saveUnitPositions.mock.calls[0]?.[0]).toEqual([{ characterId: 'character_1', x: 9, y: 8 }]);
    stopRuntime();
  });

  it('重复 start 是 no-op（不叠加订阅、不双份落库）', async () => {
    const { api, store, stopRuntime } = harness();
    store.setState((s) => ({ ...s, characters: [character()] }));

    const coordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    const stop = coordinator.start();
    coordinator.start();
    await flushMicrotasks();

    store.setState((s) => ({ ...s, characters: [...s.characters, character({ id: 'character_2' })] }));
    await flushMicrotasks();
    expect(api.saveCharacters).toHaveBeenCalledTimes(1);

    stop();
    stopRuntime();
  });
});
