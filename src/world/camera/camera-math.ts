/**
 * 文件职责：相机控制的**纯数学部分** —— 缩放钳制与视口边界钳制（零 Phaser 依赖，可在 node 下单测）。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/camera 镜头控制（平移/缩放/边界）」。
 * 输入：目标位姿 CameraPose + 视口尺寸 + 缩放上下限 + 世界边界 Bounds。
 * 输出：钳制后的 CameraPose —— 保证相机视口四角始终落在 worldBounds 之内。
 * 禁止事项：
 *   1. import phaser —— 本文件是相机钳制规则的唯一事实源，必须能脱离渲染环境直接单测；
 *   2. 改用 Phaser 自带的 useBounds/clampX —— 它在 scroll 空间里钳制、无法独立测试，
 *      且与这里的口径（按 zoom 换算半视口）并存会互相拉扯出边界抖动；
 *   3. 持有相机 / 场景引用 —— 这里只算数字，写回相机由 camera-controller 负责；
 *   4. 混进平移手势逻辑 —— 手势在 scene 层，规则在本文件里。
 *
 * 坐标系约定：center 是**屏幕中心所对应的世界坐标**，与 Phaser camera.midPoint 同口径
 * （Phaser 内部等于 scrollX + viewport.width/2，且不受 zoom 影响）。
 * 因此"平移"就是 center 直接加减世界位移，不需要再乘除 zoom。
 */

import type { Bounds, Point } from '../../core/types';

/** 缩放的硬下限：zoom=0 会让半视口变成 Infinity，后续钳制公式整体失效。 */
const MIN_ZOOM_EPSILON = 1e-3;

export interface CameraLimits {
  readonly minZoom: number;
  readonly maxZoom: number;
}

/** 相机位姿：世界坐标下的视口中心 + 缩放。 */
export interface CameraPose {
  readonly center: Point;
  readonly zoom: number;
}

/** 视口尺寸（屏幕像素）。 */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export const DEFAULT_ZOOM_LIMITS: CameraLimits = { minZoom: 0.25, maxZoom: 3 };

export const DEFAULT_ZOOM = 1;

/** 默认战场边界（世界坐标）。v3 暂无地形系统，先给一块固定可用区域，后续由场景配置覆盖。 */
export const DEFAULT_WORLD_BOUNDS: Bounds = { x: 0, y: 0, width: 3200, height: 2400 };

/**
 * 修正 limits：非有限值兜底，并保证 0 < minZoom <= maxZoom。
 * why：钳制公式对非法输入没有任何容错，配置写错时宁可收敛到一个可用区间，也不要让相机失控。
 */
export function normalizeLimits(limits: CameraLimits): CameraLimits {
  const min = Number.isFinite(limits.minZoom) ? limits.minZoom : DEFAULT_ZOOM_LIMITS.minZoom;
  const max = Number.isFinite(limits.maxZoom) ? limits.maxZoom : DEFAULT_ZOOM_LIMITS.maxZoom;
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  return { minZoom: Math.max(MIN_ZOOM_EPSILON, low), maxZoom: Math.max(MIN_ZOOM_EPSILON, high) };
}

/** 把 zoom 收进 [minZoom, maxZoom]；非有限值（NaN / Infinity）一律落到下限。 */
export function clampZoom(zoom: number, limits: CameraLimits = DEFAULT_ZOOM_LIMITS): number {
  const { minZoom, maxZoom } = normalizeLimits(limits);
  if (!Number.isFinite(zoom)) return minZoom;
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

/**
 * 单轴钳制：把 center 限制到 [worldStart + half, worldEnd - half]，half = 视口边长 / (2 * zoom)。
 * why 单独拆出来：横竖两轴规则完全相同，只有"视口比世界还大"这个退化情形需要特判。
 */
function clampAxis(
  center: number,
  viewportSize: number,
  zoom: number,
  worldStart: number,
  worldSize: number
): number {
  // 世界尺寸非法时无从钳制，直接贴到起点，避免产生 NaN 坐标污染下游渲染
  if (!Number.isFinite(worldSize) || worldSize <= 0) return worldStart;

  const half = viewportSize / (2 * zoom);
  // 视口不小于世界时，[起点+half, 终点-half] 会反解（low > high）；
  // 此时该轴无处可平，锁死在世界正中，否则相机会被推到世界之外。
  if (half * 2 >= worldSize) return worldStart + worldSize / 2;

  return Math.min(worldStart + worldSize - half, Math.max(worldStart + half, center));
}

/** 把中心点收进"视口四角不越界"的范围内。 */
export function clampCameraCenter(
  center: Point,
  zoom: number,
  viewport: Viewport,
  worldBounds: Bounds = DEFAULT_WORLD_BOUNDS
): Point {
  // 自行兜一次 zoom：本函数可能被直接调用，不能假设上游已经 clampZoom 过
  const safeZoom = clampZoom(zoom);
  const safeX = Number.isFinite(center.x) ? center.x : worldBounds.x;
  const safeY = Number.isFinite(center.y) ? center.y : worldBounds.y;

  return {
    x: clampAxis(safeX, viewport.width, safeZoom, worldBounds.x, worldBounds.width),
    y: clampAxis(safeY, viewport.height, safeZoom, worldBounds.y, worldBounds.height),
  };
}

/** 一次算完：给定任意目标位姿，返回一定合法的位姿。 */
export function resolveCameraPose(
  pose: CameraPose,
  viewport: Viewport,
  limits: CameraLimits = DEFAULT_ZOOM_LIMITS,
  worldBounds: Bounds = DEFAULT_WORLD_BOUNDS
): CameraPose {
  // why 先 zoom 后 center：半视口 = 视口 / (2 * zoom)，顺序反了会拿旧 zoom 算出错误的活动范围
  const zoom = clampZoom(pose.zoom, limits);
  return { zoom, center: clampCameraCenter(pose.center, zoom, viewport, worldBounds) };
}

/** 以世界坐标为单位平移（拖拽平移的规则入口）。 */
export function panCameraPose(
  pose: CameraPose,
  dx: number,
  dy: number,
  viewport: Viewport,
  limits: CameraLimits = DEFAULT_ZOOM_LIMITS,
  worldBounds: Bounds = DEFAULT_WORLD_BOUNDS
): CameraPose {
  return resolveCameraPose(
    { center: { x: pose.center.x + dx, y: pose.center.y + dy }, zoom: pose.zoom },
    viewport,
    limits,
    worldBounds
  );
}

/** 按倍率缩放（>1 拉近，<1 拉远），以当前视口中心为锚点。 */
export function zoomCameraPose(
  pose: CameraPose,
  factor: number,
  viewport: Viewport,
  limits: CameraLimits = DEFAULT_ZOOM_LIMITS,
  worldBounds: Bounds = DEFAULT_WORLD_BOUNDS
): CameraPose {
  if (!Number.isFinite(factor) || factor <= 0) return resolveCameraPose(pose, viewport, limits, worldBounds);
  return resolveCameraPose(
    { center: pose.center, zoom: pose.zoom * factor },
    viewport,
    limits,
    worldBounds
  );
}

/** 位姿是否实质变化（供调用方跳过无意义的重绘 / 上报，perf：高频输入不触发无变化广播）。 */
export function isSamePose(a: CameraPose, b: CameraPose): boolean {
  return (
    a.zoom === b.zoom && a.center.x === b.center.x && a.center.y === b.center.y
  );
}
