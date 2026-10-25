/**
 * 单测：core 相机纯函数（core/camera.ts，task_057）—— camera.center 命令的世界边界钳制。
 * 纯函数直打：内点原样、外点收边、非有限值回落世界中心。
 */

import { clampWorldPoint } from '../camera';
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
