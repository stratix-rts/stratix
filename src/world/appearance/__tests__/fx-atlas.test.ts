/**
 * 文件职责：精灵特效**实例池**与帧名推导的单测（@since v3.3，task_161）——
 *   固化三条纪律（task_161 requirement 5 / 6）：
 *   ① 实例创建：播一次 → 账本里多一条（kind / 坐标 / 到期时刻都对）；
 *   ② 清理：到期（播完）与离屏（滚出视口）的实例被回收；
 *   ③ 并发上限：同时最多 N 个，超出的最老实例被挤掉（先来的先让位）。
 * 输入：appearance/fx-atlas.ts（零 Phaser 的纯逻辑，node 环境直接跑）。
 * 输出：断言结果。
 * 禁止事项：
 *   1. import phaser —— 被测模块刻意零渲染依赖，这条断言本身就是纪律的一部分；
 *   2. 断言实现细节 —— 断言**不变量**（上限不破、账目平、该收的收掉）。
 */

import { SPRITE_FX_METRICS } from '../../../core/theme/visual-spec';
import {
  SpriteFxPool,
  spriteFxFrameNames,
  spriteFxOrigin,
  type SpriteFxSource,
} from '../fx-atlas';

/** 造一张特效源（字段与生成索引同形）。 */
function source(patch: Partial<SpriteFxSource> = {}): SpriteFxSource {
  return {
    kind: 'celebrate',
    atlasKey: 'fx:celebrate',
    animKey: 'fx-anim:celebrate',
    pngPath: 'default/celebrate.png',
    jsonPath: 'default/celebrate.json',
    framePrefix: 'confetti',
    frames: 3,
    fps: 20,
    loop: false,
    frameWidth: 200,
    frameHeight: 140,
    pivotX: 100,
    pivotY: 126,
    scale: 0.45,
    durationMs: 150,
    ...patch,
  };
}

describe('精灵特效帧名与原点', () => {
  it('帧名按 "<前缀> <序号>" 推导（atlas 里的帧名就是这个形状）', () => {
    expect(spriteFxFrameNames(source({ framePrefix: 'confetti', frames: 3 }))).toEqual([
      'confetti 0',
      'confetti 1',
      'confetti 2',
    ]);
  });

  it('原点取枢轴（特效的接地处），不是帧中心', () => {
    const origin = spriteFxOrigin(source({ pivotX: 100, pivotY: 126, frameWidth: 200, frameHeight: 140 }));
    expect(origin.x).toBeCloseTo(0.5);
    expect(origin.y).toBeCloseTo(0.9);
  });
});

describe('精灵特效实例池（SpriteFxPool）', () => {
  it('实例创建：播一次 → 账本多一条，坐标与到期时刻都对', () => {
    const pool = new SpriteFxPool(4);
    const spawn = pool.spawn('celebrate', 100, 200, 1000, 150);

    expect(pool.size).toBe(1);
    expect(spawn.evicted).toHaveLength(0);
    expect(spawn.instance.kind).toBe('celebrate');
    expect(spawn.instance.x).toBe(100);
    expect(spawn.instance.y).toBe(200);
    expect(spawn.instance.startedAtMs).toBe(1000);
    expect(spawn.instance.endsAtMs).toBe(1150);
  });

  it('清理：到期（now ≥ 到期时刻）的实例被回收', () => {
    const pool = new SpriteFxPool(4);
    pool.spawn('error', 10, 20, 1000, 150);

    // 未到期：不动。
    expect(pool.collect(1100)).toHaveLength(0);
    expect(pool.size).toBe(1);

    // 到期：收掉。
    const removed = pool.collect(1150);
    expect(removed).toHaveLength(1);
    expect(removed[0]?.kind).toBe('error');
    expect(pool.size).toBe(0);
  });

  it('离屏：判定为不可见的实例被回收（镜头拉走就不烧 CPU）', () => {
    const pool = new SpriteFxPool(4);
    pool.spawn('spawn', 10, 20, 1000, 5000);

    const removed = pool.collect(1100, () => false);
    expect(removed).toHaveLength(1);
    expect(pool.size).toBe(0);
  });

  it('并发上限：同时最多 N 个，超出的最老实例被挤掉', () => {
    const max = SPRITE_FX_METRICS.maxConcurrent;
    const pool = new SpriteFxPool(max);

    const evicted: number[] = [];
    for (let index = 0; index < max + 3; index += 1) {
      const spawn = pool.spawn('command', index, 0, index * 10, 1000);
      evicted.push(...spawn.evicted.map((instance) => instance.id));
    }

    expect(pool.size).toBe(max);
    // 挤掉的是最老的三个（先来的先让位）。
    expect(evicted).toEqual([1, 2, 3]);
    // 留在账本里的是最后 max 个。
    expect(pool.list().map((instance) => instance.id)).toEqual([4, 5, 6, 7]);
  });

  it('并发上限由唯一事实源给定（≤4）', () => {
    expect(SPRITE_FX_METRICS.maxConcurrent).toBeLessThanOrEqual(4);
    expect(new SpriteFxPool(SPRITE_FX_METRICS.maxConcurrent).maxConcurrent).toBe(4);
  });

  it('上限非法时报错（别静默跑成一个没有上限的池）', () => {
    expect(() => new SpriteFxPool(0)).toThrow(/maxConcurrent/);
    expect(() => new SpriteFxPool(1.5)).toThrow(/maxConcurrent/);
  });

  it('按 id 摘除与清空：账本与显示对象的对应关系由调用方维持', () => {
    const pool = new SpriteFxPool(4);
    const spawn = pool.spawn('levelUp', 1, 2, 0, 100);
    expect(pool.remove(spawn.instance.id)?.kind).toBe('levelUp');
    expect(pool.size).toBe(0);
    expect(pool.remove(spawn.instance.id)).toBeNull();

    pool.spawn('despawn', 0, 0, 0, 100);
    expect(pool.clear()).toHaveLength(1);
    expect(pool.size).toBe(0);
  });
});
