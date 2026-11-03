/**
 * 文件职责：**单位联动（Z2b）的纯逻辑** —— 焦点状态的裁决 + 引导弧线的几何 + 描边呼吸曲线。
 *   方案来源：docs/hud-redesign-proposal.html §2.2「视线动线（左下 → 中屏）」/ §2.5 Z2 行。
 *   上游：core/bus 的 world 通道上的 `focus.unit` 事件（HUD 事件轨条目点击 → core 转发，
 *   见 core/types.ts 的 WorldEvent 契约）。
 * 输入：单位 id（点选指令）+ 视口尺寸 + 起终点（屏幕坐标）+ 场景时钟（呼吸相位）。
 * 输出：焦点状态（谁被锁定 / 是否已取消）+ 弧线的采样点列 + 描边的呼吸透明度。
 * 禁止事项：
 *   1. import phaser —— 本文件是零渲染依赖的纯逻辑，单测在 node 下直接打；
 *   2. import hud —— 铁律：world 只认识 core 与 core/bus（HUD 侧的事由总线送来）；
 *   3. 持有单位位置 —— 位置真相在 UnitRegistry / core，本文件只算几何；
 *   4. 自己抄一份常量 —— 描边粗细 / 呼吸周期 / 弧线时长全部取自唯一事实源
 *      （core/theme/visual-spec.ts 的 FOCUS_LINK_METRICS，经 world/theme 门面取）。
 *
 * ★ 焦点的裁决口径（为什么「再次点击」是取消）：
 *   事件轨的条目点击是**锁定**语义 —— 点一次锁住这个单位（描边高亮 + 引导弧线），
 *   再点同一条就是**解除锁定**（规格：「持续到失焦/再次点击」）。锁定的是「一条 ↔ 一个单位」
 *   的对应关系，不是「这个单位被选中」，故它与选中集（core 的 selection）互不相干。
 */

import type { Point, ViewportSize } from '../../core/types';
import { FOCUS_LINK_METRICS } from '../theme';

/** 一次点选之后的状态变化（供渲染层据此决定起弧 / 收弧）。 */
export interface FocusLinkOutcome {
  /** 变化后的焦点单位 id；null = 已取消（弧线收掉、描边褪掉）。 */
  readonly unitId: string | null;
  /** 本次点选是否真的改变了状态（false = 空 id 的无效点选，忽略即可）。 */
  readonly changed: boolean;
  /** 本次点选是否是「取消」（再点同一个单位 → 解锁）。 */
  readonly cleared: boolean;
}

/**
 * 焦点状态的唯一真相（@since v3.4，task_092）。
 *
 * why 单独成板（而不是散在渲染层）：「再点一次是取消还是改锁」是一条**规则**，
 *   规则要有单测；渲染层只负责把状态画出来，不自己判断。
 */
export class FocusLinkBoard {
  private focusedUnitId: string | null = null;

  /** 当前被锁定的单位 id（null = 无锁定）。 */
  get unitId(): string | null {
    return this.focusedUnitId;
  }

  /**
   * 点选一个单位：同一个单位 → 取消锁定；不同单位 → 改锁到它。
   * 空 id = 无效点选（不改变状态）。
   */
  focus(unitId: string): FocusLinkOutcome {
    if (!unitId) return { unitId: this.focusedUnitId, changed: false, cleared: false };
    if (this.focusedUnitId === unitId) {
      this.focusedUnitId = null;
      return { unitId: null, changed: true, cleared: true };
    }
    this.focusedUnitId = unitId;
    return { unitId, changed: true, cleared: false };
  }

  /** 主动解除锁定（失焦：被锁定的单位离场等）。 */
  clear(): FocusLinkOutcome {
    if (this.focusedUnitId === null) return { unitId: null, changed: false, cleared: false };
    this.focusedUnitId = null;
    return { unitId: null, changed: true, cleared: true };
  }
}

/**
 * 引导弧线的起点（屏幕坐标）—— HUD 事件轨（Z2）首行的右缘。
 *
 * why 锚在事件轨：弧线要回答的是「这条事件说的是哪个单位」，从条目所在的轨出发，
 *   指向才是 proposal §2.2 说的「左下 → 中屏」动线（锚在屏幕角就丢了「从这条事件出发」）。
 * 轨道几何取 FOCUS_LINK_METRICS.origin（与 HUD 事件轨的 fixed 定位同口径）。
 */
export function focusLinkOrigin(viewport: ViewportSize): Point {
  const origin = FOCUS_LINK_METRICS.origin;
  return {
    x: origin.trackLeftPx + origin.trackWidthPx,
    y: viewport.height - origin.trackBottomPx - origin.trackRowPx / 2,
  };
}

/**
 * 引导弧线的几何：三次贝塞尔采样成折线点列（起点 → 终点，中间两个控制点把线抬起来）。
 *
 * why 抬起来而不是直线：直线从左下角直插单位，读作「一条斜线」；带弧度的线读作
 *   「视线从事件滑过去」—— 这正是这条弧线要补的那条信息（proposal §2.2）。
 * 控制点的外扩高度随起终点的竖直距离伸缩（arcBendRatio），但保底 arcMinBendPx：
 *   起终点几乎同高时仍要看得出来是条弧线。
 */
export function focusLinkArcPoints(origin: Point, target: Point): Point[] {
  const segments = FOCUS_LINK_METRICS.arcSegments;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  const bend = Math.max(FOCUS_LINK_METRICS.arcMinBendPx, Math.abs(dy) * FOCUS_LINK_METRICS.arcBendRatio);
  // 两个控制点分别落在起终点上方 1/4 与 3/4 处 → 弧线两端都朝上甩，中段走平。
  const c1 = { x: origin.x + dx * 0.25, y: origin.y - bend };
  const c2 = { x: origin.x + dx * 0.75, y: target.y - bend };

  const points: Point[] = [];
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments;
    const inv = 1 - t;
    const inv2 = inv * inv;
    const t2 = t * t;
    points.push({
      x: inv2 * inv * origin.x + 3 * inv2 * t * c1.x + 3 * inv * t2 * c2.x + t2 * t * target.x,
      y: inv2 * inv * origin.y + 3 * inv2 * t * c1.y + 3 * inv * t2 * c2.y + t2 * t * target.y,
    });
  }
  return points;
}

/**
 * 描边高亮的呼吸透明度（0..1）—— 一个周期内从谷值升到峰值再回落。
 *
 * why 用余弦而不是线性三角波：余弦在峰谷处的速度为 0，呼吸看起来是「涨落」而不是「折返」。
 * phase 是**按单位 id 派生**的相位偏移（0..1）—— 同一时刻聚焦两个单位时两圈不同步地呼吸，
 *   避免整场画面齐闪（那看着像掉帧）。
 */
export function focusOutlineAlpha(nowMs: number, phase: number): number {
  const { breathPeriodMs, outlineMaxAlpha, outlineMinAlpha } = FOCUS_LINK_METRICS;
  const safeNow = Number.isFinite(nowMs) ? nowMs : 0;
  const safePhase = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  const wave = 0.5 - 0.5 * Math.cos(((safeNow / breathPeriodMs) + safePhase) * Math.PI * 2);
  return outlineMinAlpha + (outlineMaxAlpha - outlineMinAlpha) * wave;
}
