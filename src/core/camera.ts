/**
 * 文件职责：core 侧的相机纯函数 —— 把 hud 给的世界点钳进战场边界（task_057 小地图跳转）。
 *   来源：core/types.ts 的 HudCommand `camera.center` 契约注（「core 纯函数钳制世界边界」）。
 * 输入：任意世界坐标点（小地图点击换算出的目标点，可能带浮点噪声 / 越界分量）。
 * 输出：钳制后的点 —— x/y 分别落在 [WORLD_BOUNDS.x, x+width] / [y, y+height] 内。
 * 禁止事项：
 *   1. import world / hud / phaser —— core 是依赖图底层；世界侧的相机位姿钳制
 *      （视口半宽参与的那套）在 world/camera/camera-math，这里只管「一个点在不在边界内」，
 *      两层钳制口径同源（都从 WORLD_BOUNDS 出发）互为防线，不重复实现对方的规则；
 *   2. 持有状态 / 依赖相机实例 —— 纯函数，同一输入永远同一输出；
 *   3. 在这里改写 zoom / 视口 —— camera.center 只动中心，缩放语义不在本文件。
 *
 * 非有限值（NaN / ±Infinity）：回落到世界中心 —— 坏输入宁可跳到一个安全位置，
 * 也不把 NaN 顺着事件链喂给渲染层（相机 scroll 直接变 NaN 是最坏结局）。
 */

import { WORLD_BOUNDS } from './types';
import type { Point } from './types';

/**
 * 把世界点钳进 WORLD_BOUNDS。
 * 载荷来自 hud 小地图（minimapToWorld 的换算结果），分量可能因画布越界点击 / 浮点噪声
 * 出界；core 在转发成 WorldEvent 前先钳一道，保证 world 通道上的坐标永远合法
 * （场景侧 camera-math 还会按视口再钳一次 —— 双重钳制同源无害）。
 */
export function clampWorldPoint(point: { x: number; y: number }): Point {
  const minX = WORLD_BOUNDS.x;
  const maxX = WORLD_BOUNDS.x + WORLD_BOUNDS.width;
  const minY = WORLD_BOUNDS.y;
  const maxY = WORLD_BOUNDS.y + WORLD_BOUNDS.height;
  const center: Point = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  const x = Number.isFinite(point.x) ? Math.min(maxX, Math.max(minX, point.x)) : center.x;
  const y = Number.isFinite(point.y) ? Math.min(maxY, Math.max(minY, point.y)) : center.y;
  return { x, y };
}
