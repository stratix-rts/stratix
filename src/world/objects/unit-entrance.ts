/**
 * 文件职责：**单位上场 / 下场的走位参数**（纯逻辑，零 Phaser —— 可直接单测）。
 *   任务：.long-run-agent/tasks/task_140.md「角色上场——形象合成 + 战场入场走位」。
 * 输入：目标格位 + 战场边界 + 入场序号。
 * 输出：入场起点坐标 / 时长 / 退场时长。
 * 禁止事项：
 *   1. import phaser —— 本文件只算数字与坐标（tween 在 objects/unit-layer.ts）；
 *   2. 判定"能不能动"（reduced-motion）—— 那是渲染层的裁决（world/motion.ts）；
 *   3. 碰业务态 —— 单位为什么上场（下场对称）是 core 的事，这里只管走位。
 *
 * ★ why 入场要走位（而不是凭空出现在格位）：
 *   "新用户 60 秒内看见战场上第一个会动的单位" —— 凭空出现是"多了一个东西"，
 *   从边缘走进来是"有人来了"。后者才是"角色上场"的观感。
 *
 * ★ why 起点在战场**外沿**（不是战场中心）：
 *   单位要走到格位，得有个"来处"。从战场边界外侧起步 = 走位有方向、有起点，
 *   用户能看出它是从哪边来的（而不是原地瞬移）。
 */

/** 入场走位时长（ms）。 */
export const UNIT_ENTRANCE_DURATION_MS = 800;

/** 下场淡出时长（ms）。 */
export const UNIT_EXIT_DURATION_MS = 260;

/** 起点离战场边沿的外扩距离（px）—— 刚好在边界外，走进来才看得见"入场"。 */
export const UNIT_ENTRANCE_MARGIN = 48;

/** 起点与目标点之间至少保留的纵向余量（px）—— 别贴着边界走（贴边会被地面层盖住）。 */
const ENTRANCE_EDGE_PADDING = 24;

/** 坐标 / 边界形状（与 core/types 的 Point / Bounds 同形 —— 本文件不 import core 以免耦合）。 */
export interface EntrancePoint {
  readonly x: number;
  readonly y: number;
}

export interface EntranceBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 入场起点：从**可视区域**的左边或右边的外沿走进来（按序号左右交替）。
 *
 * why 可视区域而不是战场边界：战场是 3200×2400（core/types 的 WORLD_BOUNDS），
 *   默认镜头只看得到中间一块 —— 从战场边界起步的话，单位在屏幕外走完全程，
 *   用户只看到它"凭空出现"（走位白做）。从可视区域外沿起步 = 用户真看得见它走进来。
 *
 * why 左右交替：所有单位都从同一侧进来会挤成一条直线（看着像队列，不像"各自上场"）；
 *   左右交替让入场有纵深。
 *
 * @param target 目标格位。
 * @param view 可视区域（屏幕当前看得到的那块世界矩形）。
 * @param index 入场序号（第几个上场的单位 —— 决定从哪一侧来）。
 */
export function entranceStartPosition(
  target: EntrancePoint,
  view: EntranceBounds,
  index: number
): EntrancePoint {
  const fromLeft = index % 2 === 0;
  const minY = view.y + ENTRANCE_EDGE_PADDING;
  const maxY = view.y + view.height - ENTRANCE_EDGE_PADDING;
  const y = Math.min(Math.max(target.y, minY), Math.max(minY, maxY));
  return {
    x: fromLeft ? view.x - UNIT_ENTRANCE_MARGIN : view.x + view.width + UNIT_ENTRANCE_MARGIN,
    y,
  };
}

/**
 * 入场朝向（0=上 1=左 2=下 3=右）—— 朝着格位的方向。
 *
 * @param start 入场起点。
 * @param target 目标格位。
 */
export function entranceDirection(
  start: EntrancePoint,
  target: EntrancePoint
): number {
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 3 : 1) : dy >= 0 ? 2 : 0;
}
