/**
 * 单测：progression-service 的经验事件审计注入件（task_061）。
 *
 * 测的是**真件**（真 core/bus + 真 store + 真 CharacterManager，同 progression-service.test.ts
 * 的口径），额外注入 persistExpEvent 桩观察落库时序：
 *   1. 每条 exp.gained 落一行来源行（delta = amount，reason = source，level = null）；
 *   2. 升级结算补一条 level_up 里程碑行（delta = 0，level = 升级后等级），且在 level.up 广播之前；
 *   3. 未升级只落来源行；注入件缺省（不传）行为与 040 基线一致（回归护栏）。
 */

import { emitWorldEvent, onWorldEvent, resetBus } from '../../core/bus';
import { createCharacterManager } from '../../core/character';
import { createCoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import type { WorldEvent } from '../../core/types';

import { createProgressionService } from '../services/progression-service';

type PersistedInsert = {
  readonly characterId: string;
  readonly delta: number;
  readonly reason: string;
  readonly level: number | null;
  readonly createdAt: number;
};

let cleanups: (() => void)[] = [];

beforeEach(() => {
  resetBus();
  cleanups = [];
});

afterEach(() => {
  cleanups.forEach((fn) => fn());
  cleanups = [];
  resetBus();
});

function setup(
  persist?: ((insert: PersistedInsert) => void) | null
): { characterId: string; inserts: PersistedInsert[]; unstubbed: boolean } {
  const store = createStore();
  const manager = createCharacterManager({ store });
  const stopRuntime = createCoreRuntime({ store, character: manager }).start();
  cleanups.push(stopRuntime);
  const created = manager.createCharacter({
    name: 'Audit',
    agentKind: 'claude-code',
    skinId: 'skin-default',
  });
  if (!created.ok) throw new Error(`建档失败: ${created.code}`);
  const inserts: PersistedInsert[] = [];
  // persist === null 的哨兵：完全不注入 persistExpEvent（040 基线路径）。
  const unstubbed = persist === null;
  createProgressionService({
    characterManager: manager,
    ...(persist === null ? {} : { persistExpEvent: (insert) => (persist ? persist(insert) : inserts.push(insert)) }),
  }).start();
  return { characterId: created.character.id, inserts, unstubbed };
}

describe('persistExpEvent 注入件（审计流）', () => {
  test('一次未升级的 exp.gained：只落一行来源行（delta = amount，reason = source，level = null）', () => {
    const { characterId, inserts } = setup();
    emitWorldEvent({ type: 'exp.gained', characterId, source: 'chat_round', amount: 5 });

    expect(inserts).toEqual([{ characterId, delta: 5, reason: 'chat_round', level: null, createdAt: expect.any(Number) }]);
  });

  test('跨阈值升级：来源行 + level_up 里程碑行（delta = 0，level = 升级后等级），里程碑先于广播', () => {
    const { characterId, inserts } = setup();
    const seen: string[] = []; // 插入序与广播序的互锁：level_up 行必须先于 level.up 事件。
    const off = onWorldEvent((event: WorldEvent) => {
      if (event.type === 'level.up') seen.push(`event:${event.toLevel}`);
    });
    cleanups.push(off);

    emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 100 }); // 100 → Lv.2

    expect(inserts).toEqual([
      { characterId, delta: 100, reason: 'task_completed', level: null, createdAt: expect.any(Number) },
      { characterId, delta: 0, reason: 'level_up', level: 2, createdAt: expect.any(Number) },
    ]);
    // 广播到达时插入序里已有里程碑（先落库后广播，订阅者拿到库里最新序）。
    expect(seen).toEqual(['event:2']);
  });

  test('写入被拒（幽灵角色）：一行都不落（拒绝路径不产生半截审计）', () => {
    const { inserts } = setup();
    emitWorldEvent({ type: 'exp.gained', characterId: 'ghost', source: 'chat_round', amount: 5 });

    expect(inserts).toEqual([]);
  });

  test('注入件缺省（040 基线）：不注入也照常运转（真件零改动路径，回归护栏）', () => {
    // persist = null 哨兵：完全不注入 —— 服务构造 / start / 事件处理不得抛。
    const { characterId, inserts, unstubbed } = setup(null);
    expect(unstubbed).toBe(true);
    expect(() =>
      emitWorldEvent({ type: 'exp.gained', characterId, source: 'task_completed', amount: 100 })
    ).not.toThrow();
    expect(inserts).toEqual([]);
  });
});
