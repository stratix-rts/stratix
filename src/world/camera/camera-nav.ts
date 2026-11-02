/**
 * 文件职责：摄像机**交互策略**的纯逻辑部分 —— 用户缩放区间 / 全景位姿 / 橡皮筋越界 / 双击判定
 *   （零 Phaser 依赖，可在 node 下单测）。
 *   方案来源：docs/DEMO-PLAN.md §5 后半「摄像机（06）」。
 * 输入：当前位姿 CameraPose / 视口尺寸 Viewport / 世界边界 Bounds / 拖拽目标点 / 双击时刻戳。
 * 输出：缩放后的 zoom、全景位姿 CameraPose、越界偏移 Point、双击判定布尔。
 * 禁止事项：
 *   1. import phaser —— 本文件是相机策略的唯一事实源，必须能脱离渲染环境直接单测；
 *   2. 重写一遍钳制规则 —— 视口/边界钳制住在 ./camera-math，这里只做「策略层」的取舍；
 *   3. 持有场景 / 相机 / 定时器 —— 手势与动画由场景编排（BattlefieldScene），这里只给数字；
 *   4. 自己另抄一份缩放区间 —— 区间取自唯一事实源（core/theme/visual-spec 的 CAMERA_METRICS）。
 *
 * 坐标系约定：与 camera-math 一致 —— center 是屏幕中心对应的世界坐标，
 *   越界偏移 Point 同为世界坐标（可直接叠加到相机 scroll 上）。
 */

import type { Bounds, Point } from '../../core/types';
import { CAMERA_METRICS } from '../theme';

import {
  DEFAULT_ZOOM_LIMITS,
  clampCameraCenter,
  clampZoom,
  type CameraLimits,
  type CameraPose,
  type Viewport,
} from './camera-math';

/**
 * 用户滚轮可达的缩放区间（DEMO-PLAN §5「滚轮缩放 0.6-1.6x」）。
 *
 * why 与 camera-math 的 DEFAULT_ZOOM_LIMITS（0.25-3）不是一回事：后者是**相机硬护栏**
 *   （防止非法缩放把相机算飞），前者是**产品口径**（用户能拧到的范围）。
 *   两者并存：用户缩放按本区间夹紧，镜头编排（回全景）允许落在硬护栏内。
 */
export const USER_ZOOM_LIMITS: CameraLimits = Object.freeze({
  minZoom: CAMERA_METRICS.zoomMin,
  maxZoom: CAMERA_METRICS.zoomMax,
});

/**
 * 把缩放夹进用户区间。
 *
 * why 下界取 `min(用户下限, 当前缩放)`：全景镜头可能比 0.6 更小（整个战场装进视口时），
 *   那时直接夹到 0.6 会让画面「跳一下」；保底当前值 → 滚轮从全景缓缓爬回区间内，
 *   而一旦回到区间内，缩放就再也不会越过 0.6 / 1.6。
 */
export function clampUserZoom(zoom: number, current: number = zoom): number {
  if (!Number.isFinite(zoom)) return USER_ZOOM_LIMITS.minZoom;
  const floor = Math.min(USER_ZOOM_LIMITS.minZoom, Number.isFinite(current) ? current : USER_ZOOM_LIMITS.minZoom);
  return Math.min(USER_ZOOM_LIMITS.maxZoom, Math.max(floor, zoom));
}

/** 按倍率缩放并夹进用户区间（滚轮一格 = factor）。返回**新的 zoom**，不动中心。 */
export function zoomWithUserLimits(pose: CameraPose, factor: number): number {
  if (!Number.isFinite(factor) || factor <= 0) return clampUserZoom(pose.zoom, pose.zoom);
  return clampUserZoom(pose.zoom * factor, pose.zoom);
}

/**
 * 全景位姿：整个战场装进视口（等比取 min 轴），中心落在战场正中。
 *
 * why 不套用户缩放区间：全景的职责是「看见全部」，战场比视口大时所需的缩放
 *   必然小于 0.6 —— 夹到 0.6 就不是全景了。故这里按**相机硬护栏**（DEFAULT_ZOOM_LIMITS）夹紧。
 */
export function overviewPose(
  viewport: Viewport,
  bounds: Bounds,
  hardLimits: CameraLimits = DEFAULT_ZOOM_LIMITS
): CameraPose {
  const fitWidth = bounds.width > 0 ? viewport.width / bounds.width : 1;
  const fitHeight = bounds.height > 0 ? viewport.height / bounds.height : 1;
  const zoom = clampZoom(Math.min(fitWidth, fitHeight), hardLimits);
  const center = clampCameraCenter(
    { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
    zoom,
    viewport,
    bounds
  );
  return { center, zoom };
}

/**
 * 橡皮筋越界量：拖拽目标点与钳制点之差（世界坐标）。
 * 只有越界的那一轴非零 —— 内侧拖拽时偏移恒为 0。
 */
export function rubberBandOffset(desired: Point, clamped: Point): Point {
  return {
    x: Number.isFinite(desired.x) ? desired.x - clamped.x : 0,
    y: Number.isFinite(desired.y) ? desired.y - clamped.y : 0,
  };
}

/**
 * 越界量按阻力折算成「外显位移」：相机最多只多走 resistance 倍的越界距离，且不超过上限。
 * why 有阻力：全量外显等于允许把镜头拖出世界外，边界感就没了；
 *   折算后既有「拉得动」的反馈（能看出到边了），又有「拉不动」的边界感。
 * why 还要上限：阻力是线性的，拉得越远越界越多 —— 不封顶的话一次长拖能把相机拽出半张地图。
 */
export function rubberBandDisplay(offset: Point, resistance: number = CAMERA_METRICS.rubberBandResistance): Point {
  const ratio = Number.isFinite(resistance) ? Math.max(0, resistance) : 0;
  const max = CAMERA_METRICS.rubberBandMaxPx;
  const cap = (value: number): number => Math.min(max, Math.max(-max, value * ratio));
  return { x: cap(offset.x), y: cap(offset.y) };
}

/** 双击的一次点击时刻（屏幕坐标 + 单位 id + 场景时钟）。 */
export interface ClickStamp {
  /** 命中的单位 id（双击只在同一个单位上成立）。 */
  readonly unitId: string;
  /** 点击时刻（ms，任意单调时钟）。 */
  readonly timeMs: number;
  /** 点击时的屏幕坐标（判手抖容差）。 */
  readonly x: number;
  readonly y: number;
}

/**
 * 双击判定：同一个单位 + 时间在窗口内 + 位移不超容差。
 *
 * why 位移也要判：连续两次点同一个单位，但中间挪了几十像素 —— 那是两次独立的点击，
 *   判成双击会让镜头突然开始跟随，手感很跳。
 */
export function isDoubleClick(
  previous: ClickStamp | null,
  current: ClickStamp,
  windowMs: number = CAMERA_METRICS.doubleClickWindowMs,
  slopPx: number = CAMERA_METRICS.doubleClickSlopPx
): boolean {
  if (!previous) return false;
  if (previous.unitId !== current.unitId) return false;
  const elapsed = current.timeMs - previous.timeMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > windowMs) return false;
  return Math.hypot(current.x - previous.x, current.y - previous.y) <= slopPx;
}
