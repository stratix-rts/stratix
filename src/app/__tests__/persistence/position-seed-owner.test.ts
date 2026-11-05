/**
 * 单测：站位种子的**归属裁决 + app 层一次性迁移**（@since v3.3，task_185 / M1-11）。
 *
 * 覆盖 app 侧那条链（组合根 main-entry 的 preBoot 就是这么接的）：
 *   读档（旧格式：全局一份、无法归属副本）
 *     → 落进旧全局键
 *     → 按「角色归属」拆进各副本的新键（stratix:unit-position-seed:<instanceId>）
 *     → **删掉旧键**（不残留 ⇒ 此后没有任何回落口）。
 *
 * 验收（design §7.1 M1-11 行）：
 *   ① 迁移后旧键被删除（不残留）；
 *   ② A 副本的位置不出现在 B 副本；
 *   ③ 无「读不到新键就回落旧键」的逻辑。
 */

import { DEFAULT_INSTANCE_ID, type CharacterView, type Point } from '../../../core/types';
import {
  LEGACY_UNIT_POSITION_SEED_KEY,
  migrateLegacyPositionSeed,
  resolvePositionSeed,
  unitPositionSeedKey,
  type PositionSeedStore,
} from '../../../world/objects/unit-registry';
import { positionSeedOwner, type RestoreInjection } from '../../services/persistence/character-record';

const INSTANCE_A = 'wsp_a';
const INSTANCE_B = 'wsp_b';

function character(id: string, instanceId?: string | null): CharacterView {
  return {
    id,
    name: id,
    persona: '沉着冷静',
    level: 1,
    experience: 0,
    agentKind: 'claude-code',
    skinId: null,
    externalSessionId: null,
    appearance: { bodyType: 'male', parts: { hair: 'black' } },
    instanceId,
  };
}

/** 读档注入包（老存档形态：站位是全局一份，单位 id 派生自角色 id）。 */
function injection(patch: Partial<RestoreInjection> = {}): RestoreInjection {
  return {
    characters: [],
    units: [],
    positionsByUnitId: new Map<string, Point>(),
    ...patch,
  };
}

function createStore(initial: Record<string, unknown> = {}): PositionSeedStore & {
  readonly data: Map<string, unknown>;
} {
  const data = new Map<string, unknown>(Object.entries(initial));
  return {
    data,
    get: (key: string) => data.get(key),
    set: (key: string, value: unknown) => {
      data.set(key, value);
      return value;
    },
    remove: (key: string) => {
      data.delete(key);
    },
  };
}

describe('站位种子归属裁决（task_185 / M1-11）', () => {
  test('归属来自角色档案上的 instanceId；缺省归默认沙盒（COALESCE 口径）', () => {
    const owner = positionSeedOwner(
      injection({
        characters: [character('chr_a_1', INSTANCE_A), character('chr_b_1', INSTANCE_B), character('chr_old')],
      })
    );

    expect(owner('unit_chr_a_1')).toBe(INSTANCE_A);
    expect(owner('unit_chr_b_1')).toBe(INSTANCE_B);
    // 老数据没有副本维度 ⇒ 归默认沙盒（不是「无归属」）
    expect(owner('unit_chr_old')).toBe(DEFAULT_INSTANCE_ID);
    // 非角色单位（无前缀）⇒ 同样归默认沙盒
    expect(owner('some_other_unit')).toBe(DEFAULT_INSTANCE_ID);
  });

  test('app 层一次性迁移：旧全局键 → 各副本新键，旧键删除不残留', () => {
    const restore = injection({
      characters: [character('chr_a_1', INSTANCE_A), character('chr_b_1', INSTANCE_B)],
      positionsByUnitId: new Map<string, Point>([
        ['unit_chr_a_1', { x: 10, y: 20 }],
        ['unit_chr_b_1', { x: 30, y: 40 }],
      ]),
    });

    // —— 组合根 preBoot 的两步：旧存档先落旧键 ——
    const store = createStore({ [LEGACY_UNIT_POSITION_SEED_KEY]: restore.positionsByUnitId });

    // —— 再一次性迁移（带归属）——
    const result = migrateLegacyPositionSeed(store, {
      ownerOf: positionSeedOwner(restore),
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });

    expect(result.legacyPresent).toBe(true);
    expect(result.migrated).toBe(2);
    // ① 旧键被删除（不残留）
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();

    // ② A 的位置只在 A 的键里，B 的键里没有 A 的单位
    const seedA = store.get(unitPositionSeedKey(INSTANCE_A)) as Map<string, Point>;
    const seedB = store.get(unitPositionSeedKey(INSTANCE_B)) as Map<string, Point>;
    expect(seedA.get('unit_chr_a_1')).toEqual({ x: 10, y: 20 });
    expect(seedA.has('unit_chr_b_1')).toBe(false);
    expect(seedB.get('unit_chr_b_1')).toEqual({ x: 30, y: 40 });
    expect(seedB.has('unit_chr_a_1')).toBe(false);

    // ③ 迁移后各自读自己的键：互不可见，也没有旧键可回落
    expect(resolvePositionSeed(store, INSTANCE_A)?.has('unit_chr_b_1')).toBe(false);
    expect(resolvePositionSeed(store, INSTANCE_B)?.has('unit_chr_a_1')).toBe(false);
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
  });

  test('老存档（角色无副本维度）迁移后归默认沙盒，不落到别的副本头上', () => {
    const restore = injection({
      characters: [character('chr_old')],
      positionsByUnitId: new Map<string, Point>([['unit_chr_old', { x: 1, y: 2 }]]),
    });

    const store = createStore({ [LEGACY_UNIT_POSITION_SEED_KEY]: restore.positionsByUnitId });
    migrateLegacyPositionSeed(store, {
      ownerOf: positionSeedOwner(restore),
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });

    expect(store.get(unitPositionSeedKey(INSTANCE_A))).toBeUndefined();
    expect(store.get(unitPositionSeedKey(INSTANCE_B))).toBeUndefined();
    const sandboxSeed = store.get(unitPositionSeedKey(DEFAULT_INSTANCE_ID)) as Map<string, Point>;
    expect(sandboxSeed.get('unit_chr_old')).toEqual({ x: 1, y: 2 });
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
  });
});
