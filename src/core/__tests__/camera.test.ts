/**
 * 单测：core 相机纯函数（core/camera.ts，task_057 / task_080）—— camera.center 命令的世界
 * 边界钳制 + camera.shake 命令的震动参数钳制。
 * 纯函数直打：内点原样、外点收边、非有限值回落世界中心；震动参数钳进安全区间。
 */

import { clampShake, clampWorldPoint, MAX_SHAKE_DURATION_MS, MAX_SHAKE_INTENSITY } from '../camera';
import { WORLD_BOUNDS } from '../types';

describe('clampWorldPoint：世界边界钳制（task_057）', () => {
  test('边界内的点原样通过（不引入浮点噪声）', () => {
    const inside = { x: 100.5, y: WORLD_BOUNDS.height - 10 };
    expect(clampWorldPoint(inside)).toEqual(inside);
  });

  test('四向越界各自收边（x/y 独立钳制）', () => {
    expect(clampWorldPoint({ x: -50, y: 100 })).toEqual({ x: 0, y: 100 });
    expect(clampWorldPoint({ x: WORLD_BOUNDS.width + 100, y: 100 })).toEqual({
      x: WORLD_BOUNDS.width,
      y: 100,
    });
    expect(clampWorldPoint({ x: 100, y: -1 })).toEqual({ x: 100, y: 0 });
    expect(clampWorldPoint({ x: 100, y: WORLD_BOUNDS.height + 1 })).toEqual({
      x: 100,
      y: WORLD_BOUNDS.height,
    });
  });

  test('边界上的点不算越界（闭区间口径）', () => {
    expect(clampWorldPoint({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(clampWorldPoint({ x: WORLD_BOUNDS.width, y: WORLD_BOUNDS.height })).toEqual({
      x: WORLD_BOUNDS.width,
      y: WORLD_BOUNDS.height,
    });
  });

  test('非有限值回落世界中心（NaN/Infinity 不许进渲染链）', () => {
    const cx = WORLD_BOUNDS.width / 2;
    const cy = WORLD_BOUNDS.height / 2;
    expect(clampWorldPoint({ x: Number.NaN, y: 100 })).toEqual({ x: cx, y: 100 });
    expect(clampWorldPoint({ x: 100, y: Number.POSITIVE_INFINITY })).toEqual({ x: 100, y: cy });
    expect(clampWorldPoint({ x: Number.NaN, y: Number.NaN })).toEqual({ x: cx, y: cy });
  });
});

// ============================================================================
// camera.shake（@since v3.3，task_080）：里程碑大字的那记小震 —— 参数钳制。
// 口径：震动是点缀，不是灾难 —— 时长封顶 500ms、强度封顶 2% 视口；坏值回落到「不震」。
// ============================================================================

describe('clampShake：震动参数钳制（task_080）', () => {
  test('区间内的参数原样通过（不引入浮点噪声）', () => {
    expect(clampShake(100, 0.005)).toEqual({ durationMs: 100, intensity: 0.005 });
  });

  test('超上限的参数收边（时长封顶 500ms、强度封顶 2%）', () => {
    expect(clampShake(99_999, 0.9)).toEqual({
      durationMs: MAX_SHAKE_DURATION_MS,
      intensity: MAX_SHAKE_INTENSITY,
    });
  });

  test('负值收到底（负时长 / 负强度 = 不震）', () => {
    expect(clampShake(-10, -1)).toEqual({ durationMs: 0, intensity: 0 });
  });

  test('非有限值回落到「不震」（NaN / Infinity 不许进渲染链）', () => {
    expect(clampShake(Number.NaN, Number.NaN)).toEqual({ durationMs: 0, intensity: 0 });
    // Infinity 也按坏输入处理 = 不震（口径同 clampWorldPoint 的「坏值回落安全位」，
    // 区别只是这里的「安全位」是零效果 —— 坏参数不该换来一次巨震）。
    expect(clampShake(Number.POSITIVE_INFINITY, 0.005)).toEqual({
      durationMs: 0,
      intensity: 0.005,
    });
  });
});
