/**
 * 文件职责：**地面层的纯几何/时序口径**（task_078）—— 格网步距、扫描光带轨迹、四角刻度线段。
 *   方案来源：docs/DEMO-PLAN.md §5「地面（05）」：深色格网（调色板 grid 色，格距 64px）+
 *   缓慢移动的横向扫描光带（每 12s 扫过一次，宽度 120px，8% 透明白）+ 四角坐标刻度装饰。
 * 输入：core/types 的 Bounds（战场世界边界）。
 * 输出：常量（格距 / 光带宽度·周期·透明度 / 渐晕深度）+ 纯函数
 *   （gridSegments / scanBandX / scanBandVisible / cornerTickSegments）。
 * 禁止事项：
 *   1. import phaser —— 本文件是纯几何，画出来是 objects/ground-layer.ts 的事（node 单测直接引本文件）；
 *   2. import hud / app / vue / legacy —— 铁律：world 只认识 core/types；
 *   3. 读时钟 / 用随机数 —— 扫描光带的位置是「 elapsed 时刻在哪」的纯函数（单测可穷举），
 *      随机相位只属于单位动画（§2），地面不许有；
 *   4. 在这里写色值 —— 色值走 ../theme 的 WORLD_PALETTE（事实源 core/theme/visual-spec.ts）。
 *
 * ★ 为什么扫描光带走「纯函数 + elapsed」而不是 tween 插值：
 *   tween 的 repeat 会在周期末把值瞬间拉回起点，视觉上是一次跳变；这里用
 *   「相位 = elapsed % 周期」把位置定义成时间的连续函数，再把行程的两端都放到
 *   **地图之外**（左侧出界 / 右侧出界），循环点的光带不在画面里 —— 于是既连续又无跳变，
 *   而且「无跳变」这件事可以被单测直接断言（见 __tests__/ground-layout.test.ts）。
 */

import type { Bounds, Point } from '../../core/types';

/** 格网步距（世界坐标 px）。DEMO-PLAN §5：格距 64px。 */
export const GROUND_GRID_STEP = 64;

/** 扫描光带宽度（世界坐标 px）。 */
export const SCAN_BAND_WIDTH = 120;

/** 扫描光带透明度（白，8%）。 */
export const SCAN_BAND_ALPHA = 0.08;

/** 扫描光带周期（ms）：每 12s 扫过一次。 */
export const SCAN_BAND_PERIOD_MS = 12_000;

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
 * 扫描光带在 elapsedMs 时刻的左边缘 x（世界坐标）。
 *
 * 行程：从「地图左边界外侧一个带宽」扫到「地图右边界外侧两个带宽」——
 * 行程比地图宽出一个带宽，光带在周期末**完全出界**后才回绕，
 * 于是相位回绕发生在画面之外（无跳变）。
 * 相位取模保证 elapsed 为负或超周期时依然落在同一段行程里（tween 驱动时 elapsed 单调递增）。
 */
export function scanBandX(
  elapsedMs: number,
  bounds: Bounds,
  bandWidth: number = SCAN_BAND_WIDTH,
  periodMs: number = SCAN_BAND_PERIOD_MS
): number {
  const safePeriod = periodMs > 0 ? periodMs : SCAN_BAND_PERIOD_MS;
  const safeWidth = bandWidth >= 0 ? bandWidth : SCAN_BAND_WIDTH;
  const phase = (((elapsedMs % safePeriod) + safePeriod) % safePeriod) / safePeriod;
  const travel = bounds.width + safeWidth * 2;
  return bounds.x - safeWidth + phase * travel;
}

/** 光带此刻是否压在地图范围内（出界即视为不可见 —— 循环点的无跳变依据）。 */
export function scanBandVisible(
  bandX: number,
  bounds: Bounds,
  bandWidth: number = SCAN_BAND_WIDTH
): boolean {
  return bandX < bounds.x + bounds.width && bandX + bandWidth > bounds.x;
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
