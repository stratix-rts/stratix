/**
 * 文件职责：导演模式的**纯策略** —— 事件优先级裁决 / 静默判定 / 巡视漂移路径。
 *   方案来源：docs/DEMO-PLAN.md §7「导演模式（08）」。
 * 输入：任务事件种类（开工 / 完成 / 报错）+ 事件点 + 视口 / 世界边界 / 距上次事件的时长。
 * 输出：该跟随哪个事件（焦点槽位）/ 是否进入静默巡视 / 巡视镜头该落在哪个世界点。
 * 禁止事项：
 *   1. import phaser —— 本文件是策略的唯一事实源，必须能脱离渲染环境直接单测；
 *   2. 持有相机 / 场景 / 定时器 —— 镜头怎么动、什么时候动由 ./director 编排，这里只给数字；
 *   3. 自己另抄一份时长 / 倍率 —— 规格数字取自唯一事实源（core/theme/visual-spec 的
 *      DIRECTOR_METRICS），各抄一份必然两边对不上；
 *   4. 直接 import hud —— 铁律：world 只认识 core 与 core/bus。
 *
 * 坐标系约定：与 camera-math 一致 —— center 是屏幕中心所对应的世界坐标。
 */

import type { Bounds, Point } from '../../core/types';
import { DIRECTOR_METRICS } from '../theme';

import type { CameraPose, Viewport } from './camera-math';

/**
 * 导演关心的事件种类（DEMO-PLAN §7「开工 / 完成 / 报错」三档）。
 * why 独立成词表而不是复用 core 的任务相位：导演只关心「镜头该看哪儿」，
 *   任务相位（queued / awaiting_approval / running …）与镜头编排不是一回事 ——
 *   派活（queued）不必惊动镜头，只有真正落到人身上的开工 / 完成 / 报错才值得一看。
 */
export type DirectorEventKind = 'started' | 'completed' | 'failed';

/**
 * 事件优先级（规格钦定：报错 > 完成 > 开工）。
 * why 用数字而不是数组下标：下标顺序一旦调整，优先级就静默变了 —— 数字自带语义。
 */
export const DIRECTOR_EVENT_PRIORITY: Readonly<Record<DirectorEventKind, number>> = Object.freeze({
  failed: 3,
  completed: 2,
  started: 1,
});

/** 一个候选事件（还没裁决要不要跟随它）。 */
export interface DirectorFocusCandidate {
  readonly kind: DirectorEventKind;
  /** 事件点（世界坐标）—— 镜头要对准的地方。 */
  readonly target: Point;
  /** 事件发生的时刻（ms，单调时钟）。 */
  readonly at: number;
}

/** 已裁决的焦点槽位（正在被镜头跟随的事件）。 */
export interface DirectorFocusSlot extends DirectorFocusCandidate {
  readonly priority: number;
}

/**
 * 优先级裁决：这一条事件该不该抢下镜头。
 *
 * 规则（DEMO-PLAN §7「优先级：报错 > 完成 > 开工；同级取最新」）：
 *   - 当前没有焦点 → 跟随（任何等级都行）；
 *   - 新事件等级**更高** → 立即接管（报错抢下正在看的完成镜头）；
 *   - 新事件等级**相同** → 接管（同级取最新）；
 *   - 新事件等级**更低** → 忽略（正在看报错时，一个开工不值得把镜头拉走）。
 *
 * 返回 null = 忽略这条事件（调用方不得改动当前焦点）。
 */
export function resolveFocus(
  current: DirectorFocusSlot | null,
  incoming: DirectorFocusCandidate
): DirectorFocusSlot | null {
  const priority = DIRECTOR_EVENT_PRIORITY[incoming.kind];
  if (current === null) return { ...incoming, priority };
  if (priority < current.priority) return null;
  // 同级取最新 / 更高优先级接管：直接换成新槽位。
  return { ...incoming, priority };
}

/**
 * 静默判定：距上一次导演事件是否已超过阈值（规格钦定 8s）。
 *
 * why 用「严格大于」：满 8s 那一刻仍在编排窗口里 —— 阈值是「静默**超过** 8s 才巡视」。
 * lastEventAt 为 null = 从未有过事件（刚开启导演）→ 不算静默。
 */
export function isSilentSince(lastEventAt: number | null, now: number): boolean {
  if (lastEventAt === null) return false;
  if (!Number.isFinite(now)) return false;
  return now - lastEventAt > DIRECTOR_METRICS.silenceMs;
}

/**
 * 巡视漂移的横向进度（0..1，来回折返）。
 *
 * why 折返而不是循环：循环到边界会「啪」一下跳回另一头（穿帮）；
 *   折返是三角波，走到头自然折回，边界处速度连续。
 */
function pingPong(elapsedMs: number, periodMs: number): number {
  if (!Number.isFinite(elapsedMs) || !Number.isFinite(periodMs) || periodMs <= 0) return 0;
  const phase = (elapsedMs % periodMs) / periodMs;
  return phase < 0.5 ? phase * 2 : (1 - phase) * 2;
}

/**
 * 巡视镜头位姿（DEMO-PLAN §7「事件静默 > 8s：镜头缓慢巡视全图（漂移 pan）」）。
 *
 * 口径：沿世界宽度**缓慢来回漂移** + 纵向**缓慢正弦摆动** —— 纯横移太机械，
 *   纯正弦太规律，两者叠加才像「镜头在随便看看」。
 *
 * why 横向范围按「视口可见范围」收缩：相机中心必须落在
 *   [世界边缘 + 半视口, 世界边缘 - 半视口] 之间，否则相机一半在地图外（画面里是空白）。
 *   可见范围比世界还大时（world 比视口小）无处可漂 —— 锁在正中（退化情形不许抖）。
 */
export function patrolPose(
  bounds: Bounds,
  viewport: Viewport,
  zoom: number,
  elapsedMs: number
): CameraPose {
  const safeZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const halfWidth = viewport.width / (2 * safeZoom);
  const halfHeight = viewport.height / (2 * safeZoom);
  const minX = bounds.x + halfWidth;
  const maxX = bounds.x + bounds.width - halfWidth;
  const minY = bounds.y + halfHeight;
  const maxY = bounds.y + bounds.height - halfHeight;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const worldCenterX = bounds.x + bounds.width / 2;
  const worldCenterY = bounds.y + bounds.height / 2;

  // 横向漂移：来回折返的三角波。速度越慢，单程越久。
  const periodMs = spanX > 0 ? (2 * spanX) / DIRECTOR_METRICS.patrolSpeedPxPerSec * 1000 : 0;
  const progress = pingPong(elapsedMs, periodMs);
  const centerX = spanX > 0 ? minX + spanX * progress : worldCenterX;

  // 纵向摆动：以可见范围的中线为轴，摆幅不超过可见范围的一半（否则会撞到边界被钳）。
  const amplitude = spanY > 0 ? Math.min(DIRECTOR_METRICS.patrolAmplitudePx, spanY / 2) : 0;
  const baseY = spanY > 0 ? minY + spanY / 2 : worldCenterY;
  const wave = periodMs > 0 ? Math.sin((elapsedMs / periodMs) * Math.PI * 2) : 0;
  const centerY = baseY + amplitude * wave;

  return { center: { x: centerX, y: centerY }, zoom: safeZoom };
}
