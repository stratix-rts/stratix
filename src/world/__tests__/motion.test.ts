/**
 * 单测：**动效降级开关的 world 侧读口**（world/motion.ts）。
 *
 * why 单独测：这个开关决定"入场是走进来还是直接落位"（reduced-motion 场景）。
 *   读错了的后果很具体：对动效敏感的用户在屏幕上被一条 800ms 的位移晃一下。
 *   口径必须严格 —— 只有**显式 true** 才降级（其它值都当作"不降级"）。
 */

import { REDUCED_MOTION_KEY, readReducedMotion } from '../motion';

/** 假 registry（形状与 Phaser 的 DataManager 对齐）。 */
function store(value: unknown): { get(key: string): unknown } {
  return { get: (key: string) => (key === REDUCED_MOTION_KEY ? value : undefined) };
}

describe('动效降级开关（reduced-motion）', () => {
  test('显式 true → 降级（入场直接落位）', () => {
    expect(readReducedMotion(store(true))).toBe(true);
  });

  test('false / undefined / 缺失 → 不降级', () => {
    expect(readReducedMotion(store(false))).toBe(false);
    expect(readReducedMotion(store(undefined))).toBe(false);
    expect(readReducedMotion(store(null))).toBe(false);
  });

  test('非布尔真值不算降级（严格 === true）', () => {
    expect(readReducedMotion(store(1))).toBe(false);
    expect(readReducedMotion(store('true'))).toBe(false);
  });

  test('拿不到 registry → 不降级（宁走动效也别崩）', () => {
    expect(readReducedMotion(null)).toBe(false);
    expect(readReducedMotion(undefined)).toBe(false);
  });
});
