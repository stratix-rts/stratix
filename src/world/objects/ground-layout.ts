/**
 * 文件职责：**地面层的纯几何口径**（task_078）—— 格网步距、四角刻度线段。
 *   方案来源：docs/DEMO-PLAN.md §5「地面（05）」：深色格网（调色板 grid 色，格距 64px）+
 *   四角坐标刻度装饰。
 * 输入：core/types 的 Bounds（战场世界边界）。
 * 输出：常量（格距 / 渐晕深度）+ 纯函数（gridSegments / cornerTickSegments / cornerLabels）。
 * 禁止事项：
 *   1. import phaser —— 本文件是纯几何，画出来是 objects/ground-layer.ts 的事（node 单测直接引本文件）；
 *   2. import hud / app / vue / legacy —— 铁律：world 只认识 core/types；
 *   3. 在这里写色值 —— 色值走 ../theme 的 WORLD_PALETTE（事实源 core/theme/visual-spec.ts）。
 *
 * @since v3.3（task_086）**扫描光带的轨迹口径迁出本文件** —— 光带已迁到 HUD 屏幕空间
 *   （固定屏幕坐标，不随镜头缩放平移），它的周期 / 宽度 / 透明度改由
 *   core/theme/visual-spec 的 SCREEN_FX_METRICS 独家供给（事实源唯一），
 *   屏幕空间的画法在 hud/components/screen-fx/scan-band.ts。
 */

import type { Bounds, Point } from '../../core/types';

/** 格网步距（世界坐标 px）。DEMO-PLAN §5：格距 64px。 */
export const GROUND_GRID_STEP = 64;

/** 边缘渐晕的纵深（世界坐标 px）：自地图边缘向内的渐暗带宽度。 */
export const VIGNETTE_DEPTH = 180;

/** 四角刻度线的边长（世界坐标 px）。 */
export const CORNER_TICK_SIZE = 48;

/** 一条线段（世界坐标）。 */
export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
}

/**
 * 格网线段：横纵各每 GROUND_GRID_STEP 一条，覆盖整个战场边界（含边界本身）。
 * 纯函数：格网是静态装饰，线条数量有界（3200/64 + 2400/64 = 87 条），一次性画完即可，
 * 不做逐帧重绘（perf：静态层不许每帧重建）。
 */
export function gridSegments(bounds: Bounds, step: number = GROUND_GRID_STEP): readonly Segment[] {
  const safeStep = step > 0 ? step : GROUND_GRID_STEP;
  const segments: Segment[] = [];
  for (let x = bounds.x; x <= bounds.x + bounds.width; x += safeStep) {
    segments.push({ x1: x, y1: bounds.y, x2: x, y2: bounds.y + bounds.height });
  }
  for (let y = bounds.y; y <= bounds.y + bounds.height; y += safeStep) {
    segments.push({ x1: bounds.x, y1: y, x2: bounds.x + bounds.width, y2: y });
  }
  return segments;
}

/**
 * 四角刻度线段：每个角两条（L 形），朝地图内侧。
 * 坐标标签（四角坐标刻度上的数字）由渲染层用同样的角点算，本函数只出几何。
 */
export function cornerTickSegments(
  bounds: Bounds,
  size: number = CORNER_TICK_SIZE
): readonly Segment[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const s = size;
  return [
    // 左上
    { x1: bounds.x, y1: bounds.y + s, x2: bounds.x, y2: bounds.y },
    { x1: bounds.x, y1: bounds.y, x2: bounds.x + s, y2: bounds.y },
    // 右上
    { x1: right - s, y1: bounds.y, x2: right, y2: bounds.y },
    { x1: right, y1: bounds.y, x2: right, y2: bounds.y + s },
    // 左下
    { x1: bounds.x, y1: bottom - s, x2: bounds.x, y2: bottom },
    { x1: bounds.x, y1: bottom, x2: bounds.x + s, y2: bottom },
    // 右下
    { x1: right - s, y1: bottom, x2: right, y2: bottom },
    { x1: right, y1: bottom - s, x2: right, y2: bottom },
  ];
}

/** 四角坐标标签的锚点（世界坐标 + 对齐原点）。 */
export interface CornerLabel {
  readonly point: Point;
  readonly text: string;
  readonly origin: number;
}

/** 四角坐标刻度的文字（战场坐标原点在左上角）。 */
export function cornerLabels(bounds: Bounds): readonly CornerLabel[] {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return [
    { point: { x: bounds.x, y: bounds.y }, text: `${bounds.x},${bounds.y}`, origin: 0 },
    { point: { x: right, y: bounds.y }, text: `${right},${bounds.y}`, origin: 1 },
    { point: { x: bounds.x, y: bottom }, text: `${bounds.x},${bottom}`, origin: 0 },
    { point: { x: right, y: bottom }, text: `${right},${bottom}`, origin: 1 },
  ];
}
