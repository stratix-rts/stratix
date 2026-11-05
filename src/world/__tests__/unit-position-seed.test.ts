/**
 * 单测：站位种子的**键分区 + 一次性迁移**（@since v3.3，task_185 / M1-11）。
 *
 * 背景（为什么这是真问题）：
 *   恢复站位种子原先放在 Phaser `game.registry` 的**一个全局键**里（`stratix:unit-position-seed`）
 *   ⇒ A 副本的位置会漏到 B 副本（design §2.5 #6 / #18 / #22）。
 *   修法不是「保留旧键作 fallback」（旧键是全局单份，回落之后 A 的位置**仍然**漏进 B，
 *   只是不报错 —— design §7.1 M1-11 行③ 点名禁止），而是：
 *   **按副本分区的新键 + 老存档一次性迁移（旧全局键 → 新键，迁完即删旧键）**。
 *
 * 覆盖三条验收点：
 *   ① 迁移后旧键被删除（不残留）；
 *   ② A 副本的位置不出现在 B 副本；
 *   ③ 无「读不到新键就回落旧键」的逻辑（旧键迁完即消失 ⇒ 回落实体上不可能）。
 *
 * why 用一个假键仓而不是真 Phaser：迁移与读取都是纯逻辑（world 层零 Phaser 依赖）。
 */

import { DEFAULT_INSTANCE_ID } from '../../core/types';
import {
  LEGACY_UNIT_POSITION_SEED_KEY,
  UNIT_POSITION_SEED_KEY_PREFIX,
  migrateLegacyPositionSeed,
  resolvePositionSeed,
  unitPositionSeedKey,
  type PositionSeedStore,
} from '../objects/unit-registry';

/** 假键仓：语义与 Phaser 的 DataManager 一致（get / set / remove）。 */
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

const INSTANCE_A = 'wsp_a';
const INSTANCE_B = 'wsp_b';

describe('站位种子键分区（M1-11）', () => {
  test('新键按副本分区：同前缀不同 instance ⇒ 不同键；旧全局键只剩迁移专用', () => {
    expect(UNIT_POSITION_SEED_KEY_PREFIX).toBe('stratix:unit-position-seed:');
    expect(unitPositionSeedKey(INSTANCE_A)).toBe('stratix:unit-position-seed:wsp_a');
    expect(unitPositionSeedKey(INSTANCE_B)).toBe('stratix:unit-position-seed:wsp_b');
    expect(unitPositionSeedKey(INSTANCE_A)).not.toBe(unitPositionSeedKey(INSTANCE_B));
    // 旧全局键本身不再是「读点」，只是迁移的输入。
    expect(LEGACY_UNIT_POSITION_SEED_KEY).toBe('stratix:unit-position-seed');
  });

  test('老存档一次性迁移：旧全局键 → 各副本的新键，迁完旧键被删（不残留）', () => {
    const store = createStore({
      [LEGACY_UNIT_POSITION_SEED_KEY]: new Map([
        ['unit_chr_a_1', { x: 10, y: 20 }],
        ['unit_chr_b_1', { x: 30, y: 40 }],
      ]),
    });

    const result = migrateLegacyPositionSeed(store, {
      ownerOf: (unitId) => (unitId.startsWith('unit_chr_a') ? INSTANCE_A : INSTANCE_B),
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });

    expect(result.legacyPresent).toBe(true);
    expect(result.migrated).toBe(2);
    // ① 旧键被删除（不残留）
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
    // 各副本的站位进了各自的键
    const seedA = store.get(unitPositionSeedKey(INSTANCE_A)) as Map<string, { x: number; y: number }>;
    const seedB = store.get(unitPositionSeedKey(INSTANCE_B)) as Map<string, { x: number; y: number }>;
    expect(seedA.get('unit_chr_a_1')).toEqual({ x: 10, y: 20 });
    expect(seedB.get('unit_chr_b_1')).toEqual({ x: 30, y: 40 });
  });

  test('② A 副本的位置不出现在 B 副本（分区键 + 迁移后旧键已消失）', () => {
    const store = createStore({
      [LEGACY_UNIT_POSITION_SEED_KEY]: new Map([['unit_chr_a_1', { x: 10, y: 20 }]]),
    });

    migrateLegacyPositionSeed(store, {
      ownerOf: () => INSTANCE_A,
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });

    // A 读到自己的位置
    expect(resolvePositionSeed(store, INSTANCE_A)?.get('unit_chr_a_1')).toEqual({ x: 10, y: 20 });
    // B 读不到 A 的位置（旧键已删 ⇒ 没有回落口）
    expect(resolvePositionSeed(store, INSTANCE_B)).toBeUndefined();
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
  });

  test('③ 无回落旧键：新键缺失且旧键已被迁走 ⇒ 读不到（不是回落旧键）', () => {
    const store = createStore({
      [LEGACY_UNIT_POSITION_SEED_KEY]: new Map([['unit_chr_a_1', { x: 10, y: 20 }]]),
    });

    // 先给 A 迁走（正常路径：app 层启动时迁）
    migrateLegacyPositionSeed(store, {
      ownerOf: () => INSTANCE_A,
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });

    // 换另一个副本读 ⇒ 旧键已经没了 ⇒ 没有可回落的东西
    const seedForC = resolvePositionSeed(store, 'wsp_c');
    expect(seedForC).toBeUndefined();
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
  });

  test('迁移只发生一次：第二次调用是空转（旧键已删）', () => {
    const store = createStore({
      [LEGACY_UNIT_POSITION_SEED_KEY]: new Map([['unit_chr_a_1', { x: 10, y: 20 }]]),
    });

    const first = migrateLegacyPositionSeed(store, {
      ownerOf: () => INSTANCE_A,
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });
    const second = migrateLegacyPositionSeed(store, {
      ownerOf: () => INSTANCE_A,
      fallbackInstanceId: DEFAULT_INSTANCE_ID,
    });

    expect(first.migrated).toBe(1);
    expect(second.legacyPresent).toBe(false);
    expect(second.migrated).toBe(0);
    // 新键里的数据没被二次迁移搅动
    expect(resolvePositionSeed(store, INSTANCE_A)?.get('unit_chr_a_1')).toEqual({ x: 10, y: 20 });
  });

  test('读不到新键时的兜底迁移：旧数据归默认沙盒，不落到正在读的副本头上', () => {
    // 旧键还在（老版本残留），且没有归属信息可用
    const store = createStore({
      [LEGACY_UNIT_POSITION_SEED_KEY]: new Map([['unit_chr_a_1', { x: 10, y: 20 }]]),
    });

    // B 副本读不到自己的键 ⇒ 触发一次性迁移（搬走，不是回落）
    expect(resolvePositionSeed(store, INSTANCE_B)).toBeUndefined();
    // 旧数据按 COALESCE 口径归默认沙盒，**没有**落到 B 头上
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
    const sandboxSeed = store.get(unitPositionSeedKey(DEFAULT_INSTANCE_ID)) as Map<string, unknown>;
    expect(sandboxSeed.get('unit_chr_a_1')).toEqual({ x: 10, y: 20 });
  });

  test('新键已有数据时旧键是残留：当场删掉，绝不留回落口', () => {
    const store = createStore({
      [LEGACY_UNIT_POSITION_SEED_KEY]: new Map([['unit_chr_a_1', { x: 999, y: 999 }]]),
      [unitPositionSeedKey(INSTANCE_A)]: new Map([['unit_chr_a_1', { x: 10, y: 20 }]]),
    });

    const seed = resolvePositionSeed(store, INSTANCE_A);

    expect(seed?.get('unit_chr_a_1')).toEqual({ x: 10, y: 20 });
    expect(store.get(LEGACY_UNIT_POSITION_SEED_KEY)).toBeUndefined();
  });
});
