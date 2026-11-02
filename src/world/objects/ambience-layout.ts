/**
 * 文件职责：**氛围彩蛋的纯口径**（task_079）—— 小云的出场时刻 / 漂移轨迹 + 入夜变暖的格网配色。
 *   方案来源：docs/DEMO-PLAN.md §5 后半「氛围彩蛋（06）」：地图边缘每 30-60s 漂过一朵慢速小云；
 *   每晚（真实时间 19-24 点）背景网格微微变暖。
 * 输入：战场边界 Bounds + 随机源（纯函数注入）+ 时刻（小时）。
 * 输出：小云的出场参数（起点/终点/纵向位置/行程时长）/ 某时刻的云位置 / 变暖后的格网色 /
 *   是否处于入夜时段。
 * 禁止事项：
 *   1. import phaser —— 本文件是纯口径，画出来是 objects/cloud-layer.ts 与
 *      objects/ground-layer.ts 的事（node 单测直接引本文件）；
 *   2. import hud / app / vue / legacy —— 铁律：world 只认识 core/types；
 *   3. 自己取随机 / 读墙钟 —— 随机源与时刻都由调用方注入（单测可确定性地断言）；
 *   4. 在这里写色值 —— 色值走 ../theme 的 WORLD_PALETTE（事实源 core/theme/visual-spec.ts）。
 */

import type { Bounds } from '../../core/types';
import { AMBIENCE_METRICS } from '../theme';

/**
 * 小云的轮廓点列（归一化坐标 0-1，绕行一周）。
 *
 * why 用**单一多边形**而不是几个叠加的圆：叠加的圆在交界处会叠出更深的色块，
 *   一条闭合多边形一次填色 → 整朵云的透明度均匀（Phaser Graphics 每个形状各填一次）。
 */
export const CLOUD_SHAPE_POINTS: readonly Readonly<{ x: number; y: number }>[] = Object.freeze([
  { x: 0.02, y: 0.92 },
  { x: 0.03, y: 0.70 },
  { x: 0.12, y: 0.57 },
  { x: 0.22, y: 0.55 },
  { x: 0.28, y: 0.41 },
  { x: 0.40, y: 0.34 },
  { x: 0.51, y: 0.41 },
  { x: 0.59, y: 0.28 },
  { x: 0.72, y: 0.24 },
  { x: 0.84, y: 0.35 },
  { x: 0.90, y: 0.50 },
  { x: 0.97, y: 0.61 },
  { x: 0.98, y: 0.80 },
  { x: 0.88, y: 0.93 },
  { x: 0.60, y: 0.97 },
  { x: 0.30, y: 0.95 },
]);

/** 一朵小云的出场参数（世界坐标）。 */
export interface CloudSpawn {
  /** 起点 x（世界坐标；出场时已在画面外）。 */
  readonly startX: number;
  /** 终点 x（世界坐标；到达即销毁）。 */
  readonly endX: number;
  /** 纵向位置 y（世界坐标）。 */
  readonly y: number;
  /** 漂移方向（1 = 向右，-1 = 向左）。 */
  readonly direction: 1 | -1;
  /** 漂移速度（世界 px/s）。 */
  readonly speedPxPerSec: number;
  /** 走完全程的时长（ms）。 */
  readonly travelMs: number;
}

/**
 * 下一朵云的等待时长（ms）：区间内随机（规格钦定每 30-60s 一朵）。
 *
 * why 用注入的随机源而不是 Math.random：单测要能断言「间隔落在 30-60s 区间内」，
 *   且要能确定性地复现同一串出场序列。
 */
export function nextCloudDelayMs(random: () => number): number {
  const { min, max } = AMBIENCE_METRICS.cloudIntervalMs;
  const raw = random();
  const roll = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0.5;
  return min + roll * (max - min);
}

/**
 * 一朵云的出场参数：从画面外的一侧入场，横穿战场，贴着上/下边缘漂过。
 *
 * why 纵向位置取「上边缘带」或「下边缘带」：规格写的是「地图边缘漂过」——
 *   云从正中穿场会挡住单位，贴边才像背景。
 */
export function cloudSpawn(
  bounds: Bounds,
  cloudWidth: number,
  speedPxPerSec: number,
  random: () => number
): CloudSpawn {
  const roll = (): number => {
    const value = random();
    return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.5;
  };
  const direction: 1 | -1 = roll() < 0.5 ? 1 : -1;
  const width = Math.max(0, cloudWidth);
  // 两端都完全在画面外（cloud 的宽也算进去）—— 云是「飘过」边缘，不是「冒出来」。
  const startX = direction === 1 ? bounds.x - width : bounds.x + bounds.width + width;
  const endX = direction === 1 ? bounds.x + bounds.width + width : bounds.x - width;

  const band = AMBIENCE_METRICS.cloudBandRatio;
  // 上半带 [top, mid] 与下半带 [mid, bottom]：云贴着上/下边缘漂，不横穿正中。
  const mid = (band.top + band.bottom) / 2;
  const nearTop = roll() < 0.5;
  const from = nearTop ? band.top : mid;
  const to = nearTop ? mid : band.bottom;
  const y = bounds.y + bounds.height * (from + roll() * (to - from));

  const speed = Math.max(1, speedPxPerSec);
  const travelMs = (Math.abs(endX - startX) / speed) * 1000;
  return { startX, endX, y, direction, speedPxPerSec: speed, travelMs };
}

/** 某时刻（距出场 elapsedMs）的云位置 x（世界坐标）。 */
export function cloudX(spawn: CloudSpawn, elapsedMs: number): number {
  const elapsed = Math.max(0, elapsedMs) / 1000;
  return spawn.startX + spawn.direction * elapsed * spawn.speedPxPerSec;
}

/**
 * 变暖后的格网色：基色向暖色混合（比例 = level × mix）。
 * why 走「混合」而不是直接换成暖色：直接换会让 19 点整场地图「啪」地变色，
 *   混合（且 level 可为小数）能让暖意是渐变出来的。
 */
export function warmColor(baseColor: number, warm: number, level: number, mix: number): number {
  const safeLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  const safeMix = Number.isFinite(mix) ? Math.min(1, Math.max(0, mix)) : 0;
  const ratio = safeLevel * safeMix;
  if (ratio <= 0) return baseColor;
  const channel = (shift: number): number => {
    const base = (baseColor >> shift) & 0xff;
    const target = (warm >> shift) & 0xff;
    return Math.round(base + (target - base) * ratio);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/**
 * 是否处于入夜时段（真实本地时间的小时数）。
 * 规格：19-24 点。end 取 24 表示「当天结束」（小时数恒 < 24，故上界是通配）。
 */
export function isWarmHour(hour: number, startHour: number = AMBIENCE_METRICS.warmHours.start, endHour: number = AMBIENCE_METRICS.warmHours.end): boolean {
  if (!Number.isFinite(hour)) return false;
  const safeEnd = endHour > startHour ? endHour : startHour + 1;
  return hour >= startHour && hour < safeEnd;
}
