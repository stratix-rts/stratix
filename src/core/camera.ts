/**
 * 文件职责：core 侧的相机纯函数 —— 把 hud 给的世界点钳进战场边界（task_057 小地图跳转），
 *   以及把 hud 给的镜头震动参数钳进安全区间（task_080 里程碑大字的那记小震）。
 *   来源：core/types.ts 的 HudCommand `camera.center` / `camera.shake` 契约注
 *   （「core 纯函数钳制」）。
 * 输入：任意世界坐标点（小地图点击换算出的目标点，可能带浮点噪声 / 越界分量）；
 *   镜头震动参数（时长 ms + 强度比例）。
 * 输出：钳制后的点 —— x/y 分别落在 [WORLD_BOUNDS.x, x+width] / [y, y+height] 内；
 *   钳制后的震动参数（时长 ≤ MAX_SHAKE_DURATION_MS、强度 ≤ MAX_SHAKE_INTENSITY）。
 * 禁止事项：
 *   1. import world / hud / phaser —— core 是依赖图底层；世界侧的相机位姿钳制
 *      （视口半宽参与的那套）在 world/camera/camera-math，这里只管「一个点在不在边界内」，
 *      两层钳制口径同源（都从 WORLD_BOUNDS 出发）互为防线，不重复实现对方的规则；
 *   2. 持有状态 / 依赖相机实例 —— 纯函数，同一输入永远同一输出；
 *   3. 在这里改写 zoom / 视口 —— camera.center 只动中心，缩放语义不在本文件。
 *
 * 非有限值（NaN / ±Infinity）：回落到世界中心 —— 坏输入宁可跳到一个安全位置，
 * 也不把 NaN 顺着事件链喂给渲染层（相机 scroll 直接变 NaN 是最坏结局）；
 * 震动参数同理回落到 0（等于不震）。
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

/** 镜头震动的时长上限（ms）—— 震动是点缀，晃久了画面就没法看了。 */
export const MAX_SHAKE_DURATION_MS = 500;

/** 镜头震动的强度上限（Phaser 口径：视口宽高的比例）。 */
export const MAX_SHAKE_INTENSITY = 0.02;

/** 镜头震动参数（钳制后的形态）。 */
export interface ShakeParams {
  readonly durationMs: number;
  readonly intensity: number;
}

/**
 * 把 HUD 传来的镜头震动参数钳进安全区间（task_080 里程碑大字的那记小震）。
 *
 * why 在 core 钳：HUD 是表现层，它给出的数字可能被别处的调用方写坏（负时长 / NaN /
 *   一上来就 0.5 的巨震）。core 是总线的中枢 —— 参数在这里过一次闸，下游（世界场景的
 *   Phaser 相机）拿到的永远是合法值。口径同 clampWorldPoint：非有限值回落到「什么都不做」。
 *
 * @param durationMs 请求时长（ms）；非有限 / 负 → 0（等于不震）。
 * @param intensity  请求强度（视口比例）；非有限 / 负 → 0。
 */
export function clampShake(durationMs: number, intensity: number): ShakeParams {
  const safeDuration = Number.isFinite(durationMs) ? Math.min(Math.max(durationMs, 0), MAX_SHAKE_DURATION_MS) : 0;
  const safeIntensity = Number.isFinite(intensity) ? Math.min(Math.max(intensity, 0), MAX_SHAKE_INTENSITY) : 0;
  return { durationMs: safeDuration, intensity: safeIntensity };
}
