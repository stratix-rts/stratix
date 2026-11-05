/**
 * 文件职责：**首批特效触点**的单测（@since v3.3，task_161，requirement 6）——
 *   固化两件事：
 *   ① 触点映射（objects/task-fx.ts 的 fxKindForTaskPhase）：任务相位 → 该播哪条特效；
 *   ② 每条触点各一条断言：实例创建 / 到期清理 / 并发上限（六个触点逐条过一遍）。
 * 输入：零 Phaser 的纯逻辑模块（node 环境直接跑）。
 * 输出：断言结果。
 * 禁止事项：
 *   1. import phaser —— 触点规则刻意零渲染依赖，这条断言本身就是纪律的一部分；
 *   2. 只断言一条触点 —— requirement 6 说的是「各补一条」，六个触点都要过；
 *   3. 在这里重写一遍映射 —— 映射只有 objects/task-fx.ts 一处（改了那里这里就该红）。
 */

import { SPRITE_FX_METRICS } from '../../../core/theme/visual-spec';
import { SpriteFxPool, type SpriteFxKind } from '../../appearance/fx-atlas';
import { fxKindForTaskPhase } from '../task-fx';

/** 首批接线的六个触点（每个一条语义 kind）。 */
const TOUCHPOINTS: readonly { readonly kind: SpriteFxKind; readonly from: string }[] = [
  { kind: 'celebrate', from: '任务完成 / 建筑完工' },
  { kind: 'levelUp', from: '角色升级' },
  { kind: 'error', from: '任务报错 / 卡住' },
  { kind: 'spawn', from: '单位上场' },
  { kind: 'despawn', from: '单位退场' },
  { kind: 'command', from: '指令下达' },
];

describe('触点映射（fxKindForTaskPhase）', () => {
  it('完成 → 庆祝；报错 → 冲击', () => {
    expect(fxKindForTaskPhase('completed')).toBe('celebrate');
    expect(fxKindForTaskPhase('failed')).toBe('error');
  });

  it('开工 / 挂起不上特效（头顶浮标已经在说这件事）', () => {
    expect(fxKindForTaskPhase('started')).toBeNull();
    expect(fxKindForTaskPhase('awaiting_approval')).toBeNull();
  });
});

describe('首批特效触点（逐条：实例创建 / 清理 / 并发上限）', () => {
  it.each(TOUCHPOINTS)('$from → $kind：实例创建', ({ kind }) => {
    const pool = new SpriteFxPool(SPRITE_FX_METRICS.maxConcurrent);
    const spawn = pool.spawn(kind, 320, 480, 1000, 2000);

    expect(spawn.instance.kind).toBe(kind);
    expect(pool.size).toBe(1);
    expect(pool.list()[0]?.id).toBe(spawn.instance.id);
  });

  it.each(TOUCHPOINTS)('$from → $kind：到期清理', ({ kind }) => {
    const pool = new SpriteFxPool(SPRITE_FX_METRICS.maxConcurrent);
    pool.spawn(kind, 320, 480, 1000, 2000);

    expect(pool.collect(2999)).toHaveLength(0);
    expect(pool.collect(3000)).toHaveLength(1);
    expect(pool.size).toBe(0);
  });

  it.each(TOUCHPOINTS)('$from → $kind：并发上限不破（连打 8 条也不超上限）', ({ kind }) => {
    const pool = new SpriteFxPool(SPRITE_FX_METRICS.maxConcurrent);
    for (let index = 0; index < 8; index += 1) {
      pool.spawn(kind, index * 10, 0, index * 10, 5000);
    }
    expect(pool.size).toBeLessThanOrEqual(SPRITE_FX_METRICS.maxConcurrent);
  });

  it('六个触点同时爆发 → 仍然守住上限（挤掉最老的两条）', () => {
    const pool = new SpriteFxPool(SPRITE_FX_METRICS.maxConcurrent);
    const evicted: number[] = [];
    TOUCHPOINTS.forEach((touchpoint, index) => {
      const spawn = pool.spawn(touchpoint.kind, index * 10, 0, index * 10, 2000);
      evicted.push(...spawn.evicted.map((instance) => instance.id));
    });

    expect(pool.size).toBe(SPRITE_FX_METRICS.maxConcurrent);
    expect(evicted).toEqual([1, 2]);
    // 留在场上的四条按 kind 都能查到（账目平）。
    expect(pool.list().map((instance) => instance.kind)).toEqual([
      'error',
      'spawn',
      'despawn',
      'command',
    ]);
  });
});
