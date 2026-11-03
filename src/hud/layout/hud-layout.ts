/**
 * 文件职责：**HUD 边角件版面计算**（@since v3.4，task_093）——
 *   把 Z3 小地图 / Z4 控制岛 / Z5 时间戳角标之间的**版面规则**写成纯函数。
 *
 * 输入：视口宽高（px）与 core/theme/visual-spec.ts 的唯一事实源常量。
 * 输出：矩形盒与间距（纯计算，零 DOM、零 IO、零 import 副作用）。
 * 禁止事项：
 *   1. import world / phaser / app / DOM —— 纯计算模块，两侧都能引；
 *   2. 直接 import core/bus —— 本模块不发命令、不订阅总线；
 *   3. 抄第二份度量 —— 宽度 / 留边 / 间距数字一律从 visual-spec 取（本模块只做**组合**）；
 *   4. 自己另算一套 CSS 公式 —— 本模块的公式必须与 main-screen 的样式表**逐字同源**，
 *      否则「单测说不撞、浏览器里撞了」。（公式变了，两处一起改。）
 *
 * ============ 为什么要有这层 ============
 *   两条硬验收是**几何关系**，不是样式细节：
 *     ① 小地图（Z3）与控制岛（Z4）的水平间距 ≥40px（CONTROL_ISLAND_METRICS.cornerClearancePx）；
 *     ② 时间戳角标（Z5）与顶栏（Z1）的包围盒不相交。
 *   jsdom 没有排版引擎（bounding box 全 0），真排版的断言在
 *   scripts/check-hud-island-layout.mjs（浏览器里量）；但**规则本身**必须有一处
 *   可断言的落点 —— 就是本模块：把「宽度公式 + 留边 + 间距」摊成纯函数，
 *   单测按同一份常量断言，改坏了当场红。
 *
 * @since v3.4（task_093）
 */

import {
  CONTROL_ISLAND_METRICS,
  CONTROL_ISLAND_SIDE_INSET_PX,
  MINIMAP_METRICS,
  REPLAY_CLOCK_TOP_INSET_PX,
  REPLAY_METRICS,
  TOPBAR_METRICS,
} from '../../core/theme/visual-spec';

/** 版面矩形（与 DOMRect 同口径，但只留本模块用得到的四个边 + 尺寸）。 */
export interface HudRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** 造一个矩形（left/top/宽高 → 四条边）。 */
function rect(left: number, top: number, width: number, height: number): HudRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

/**
 * 控制岛（Z4）的实际宽度（px）。
 *
 * 与 main-screen 样式表的公式逐字对应：
 *   width: min(var(--hud-island-w), calc(100% - 2 * var(--hud-island-inset)))
 *   其中 --hud-island-w = widthRatio × 100%，--hud-island-inset = CONTROL_ISLAND_SIDE_INSET_PX。
 */
export function controlIslandWidthPx(viewportWidth: number): number {
  return Math.min(
    viewportWidth * CONTROL_ISLAND_METRICS.widthRatio,
    viewportWidth - 2 * CONTROL_ISLAND_SIDE_INSET_PX
  );
}

/**
 * 控制岛的盒子（贴底居中）。
 * why 高度取上限（maxHeightPx）：岛高随内容自适应，**上边界**得按上限算 ——
 *   宁可让下边界高估一截，也不能让别的件压到岛上。
 */
export function controlIslandRect(viewportWidth: number, viewportHeight: number): HudRect {
  const width = controlIslandWidthPx(viewportWidth);
  const height = Math.min(CONTROL_ISLAND_METRICS.maxHeightPx, viewportHeight);
  const left = (viewportWidth - width) / 2;
  return rect(left, viewportHeight - height, width, height);
}

/** 小地图外框的宽度（px）= 画布 + 左右两边的外框描边。 */
export function minimapWidthPx(): number {
  return MINIMAP_METRICS.widthPx + MINIMAP_METRICS.frameBorderPx * 2;
}

/** 小地图外框的高度（px）= 标题栏 + 画布 + 上下两边的外框描边。 */
export function minimapHeightPx(): number {
  return MINIMAP_METRICS.headHeightPx + MINIMAP_METRICS.heightPx + MINIMAP_METRICS.frameBorderPx * 2;
}

/** 小地图的盒子（右下 fixed；留边 = MINIMAP_METRICS.cornerMarginPx）。 */
export function minimapRect(viewportWidth: number, viewportHeight: number): HudRect {
  const width = minimapWidthPx();
  const height = minimapHeightPx();
  return rect(
    viewportWidth - MINIMAP_METRICS.cornerMarginPx - width,
    viewportHeight - MINIMAP_METRICS.cornerMarginPx - height,
    width,
    height
  );
}

/**
 * 小地图与控制岛的水平间距（px；正数 = 不重叠）。
 *
 * 口径与 scripts/check-hud-island-layout.mjs 的 horizontalGap 一致：
 *   岛居中 → 岛右缘 = 视口中线 + 岛宽 / 2；小地图左缘 = 视口右缘 − 留边 − 小地图宽。
 */
export function minimapIslandClearancePx(viewportWidth: number): number {
  const island = controlIslandRect(viewportWidth, 0);
  const map = minimapRect(viewportWidth, 0);
  return map.left - island.right;
}

/** 顶栏（Z1）的下边缘（px）—— 顶栏是 fixed 全宽条，高度 = TOPBAR_METRICS.heightPx。 */
export function topbarBottomPx(): number {
  return TOPBAR_METRICS.heightPx;
}

/** 时间戳角标（Z5）的顶部 inset（px）—— 顶栏高度 + 与顶栏的间距 = 56。 */
export function replayClockTopPx(): number {
  return REPLAY_CLOCK_TOP_INSET_PX;
}

/**
 * 角标与顶栏之间的垂直净距（px；正数 = 不相交）。
 * why 只算垂直：顶栏是**全宽**条、角标在左上 —— 水平方向必然重叠，
 *   相交与否只由垂直方向决定。
 */
export function replayClockTopbarGapPx(): number {
  return replayClockTopPx() - topbarBottomPx();
}

/** 两个盒子是否相交（面积 > 0 才算撞 —— 边缘擦过不算）。 */
export function rectsIntersect(a: HudRect, b: HudRect): boolean {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0;
}

/**
 * 角标（Z5）与顶栏（Z1）是否相交 —— **Z5 的硬验收**。
 *
 * why 用「角标盒的顶边 + 一个最小高度」而不是完整角标尺寸：角标的宽高随内容变
 *   （时间文本长度不同），但它的**顶边**是定值（inset 56px）—— 相交与否由顶边决定，
 *   所以这里只需要一个「顶边以下至少 1px」的盒子来判定。
 */
export function replayClockIntersectsTopbar(): boolean {
  const clock = rect(REPLAY_METRICS.clockInsetPx, replayClockTopPx(), 1, 1);
  const topbar = rect(0, 0, Number.POSITIVE_INFINITY, topbarBottomPx());
  return rectsIntersect(clock, topbar);
}
