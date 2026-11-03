/**
 * 文件职责：**导演取景框（L3）的纯逻辑** —— 中屏可视区的换算 + 四角括号的开关与几何。
 *   方案来源：docs/hud-redesign-proposal.html §2.5 A6（「🎬 导演开启后中屏出现取景框」）
 *   与 G1（「HUD 侧新增取景框作为状态回显」）；本任务落在 world 侧（战场画面区）。
 * 输入：视口尺寸（屏幕像素）+ 导演开关。
 * 输出：中屏矩形（战场画面区）+ 四角括号线段 + 开关状态。
 * 禁止事项：
 *   1. import phaser —— 纯逻辑，单测在 node 下直接打；
 *   2. import hud —— 铁律：world 只认识 core（HUD 的分区尺寸按 STAGE_METRICS 复算，
 *      耦合声明见 core/theme/visual-spec.ts 的 STAGE_METRICS）；
 *   3. 自己判断导演模式开没开 —— 真相在 core（WorldState.directorEnabled → world 通道
 *      的 camera.director 事件 → 场景），本文件只持有「当前要不要画」的这份镜像。
 *
 * ★ 为什么取景框是 L3（沉浸层）元素：
 *   L1 是常驻信息、L2 是事件件，L3 是「此刻画面被接管」的沉浸态 —— 导演模式正是
 *   镜头被别人接管的状态。取景框是它在画面里的**唯一回显**：开关一亮，四角立刻出现，
 *   观众立刻知道「镜头现在不听我的」。
 */

import type { Bounds, Point, ViewportSize } from '../../core/types';
import { STAGE_METRICS, TOPBAR_METRICS } from '../theme';

/** 取景框的开关状态（单一真相：enabled = 要画）。 */
export class DirectorFrameBoard {
  private enabled = false;

  /** 当前是否显示取景框。 */
  get visible(): boolean {
    return this.enabled;
  }

  /**
   * 开关取景框（导演模式开启 / 关闭）。
   * 返回值 = 状态是否真的变了（false = 重复设置，渲染层可跳过重绘）。
   */
  setEnabled(enabled: boolean): boolean {
    if (this.enabled === enabled) return false;
    this.enabled = enabled;
    return true;
  }
}

/**
 * 中屏可视区（战场画面区）的矩形（屏幕坐标）。
 *
 * why 要减掉 HUD 的分区：HUD 是覆盖在战场画布之上的浮层（顶栏 / 左右栏 / 底栏），
 *   取景框若框在整个画布上，四角会藏在侧栏与底栏底下 —— 观众看不见「镜头被接管」这回事。
 *   减掉的留白按 STAGE_METRICS 与 HUD 侧 main-screen 的布局表达式同口径复算
 *   （耦合声明见 STAGE_METRICS）。
 */
export function stageRect(viewport: ViewportSize): Bounds {
  const width = Number.isFinite(viewport.width) ? Math.max(0, viewport.width) : 0;
  const height = Number.isFinite(viewport.height) ? Math.max(0, viewport.height) : 0;
  const { gapPx, bottomBarMaxPx, bottomBarRatio, leftRailMaxPx, leftRailRatio, rightRailMaxPx, rightRailRatio } =
    STAGE_METRICS;

  const top = TOPBAR_METRICS.heightPx + gapPx; // 顶栏高度 + 分区间留白
  const bottom = Math.min(height * bottomBarRatio, bottomBarMaxPx) + gapPx;
  const left = Math.min(width * leftRailRatio, leftRailMaxPx) + gapPx;
  const right = Math.min(width * rightRailRatio, rightRailMaxPx) + gapPx;

  // 视口太小的时候留白会吃掉整个画面 —— 兜一个最小可视区，别把框画没了。
  const minSize = 80;
  const rectWidth = Math.max(minSize, width - left - right);
  const rectHeight = Math.max(minSize, height - top - bottom);
  return { x: left, y: top, width: rectWidth, height: rectHeight };
}

/** 一条括号线段（屏幕坐标）。 */
export interface FrameSegment {
  readonly from: Point;
  readonly to: Point;
}

/**
 * 四角括号的几何：每个角两条短线（横 + 竖），共 8 段。
 *
 * why 画括号而不是整圈边框：整圈边框会把中屏切成「窗」，观感是遮挡；
 *   四角括号是取景器的传统语言 —— 提示「这里在被拍摄」，不遮挡内容。
 */
export function directorFrameSegments(rect: Bounds, cornerSizePx: number): FrameSegment[] {
  const size = Math.max(1, cornerSizePx);
  const { x, y, width, height } = rect;
  const right = x + width;
  const bottom = y + height;

  return [
    // 左上
    { from: { x, y: y + size }, to: { x, y } },
    { from: { x, y }, to: { x: x + size, y } },
    // 右上
    { from: { x: right - size, y }, to: { x: right, y } },
    { from: { x: right, y }, to: { x: right, y: y + size } },
    // 右下
    { from: { x: right, y: bottom - size }, to: { x: right, y: bottom } },
    { from: { x: right, y: bottom }, to: { x: right - size, y: bottom } },
    // 左下
    { from: { x: x + size, y: bottom }, to: { x, y: bottom } },
    { from: { x, y: bottom }, to: { x, y: bottom - size } },
  ];
}
