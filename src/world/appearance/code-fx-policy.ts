/**
 * 文件职责：**代码路由特效的预算护栏**（@since v3.3，task_162）—— 纯逻辑，零 Phaser。
 *
 * ★ 为什么护栏要单独一层：一期 sheet 路由的护栏是「并发实例数」（fx-atlas.ts 的池），
 *   因为贴图动画的成本几乎全在 GPU 合成，CPU 侧只是换纹理帧。
 *   二期代码路由的成本在**主线程的逐像素计算**上（实测见 docs/research/pixelfx-runtime-poc.md）：
 *   120Hz 粒子步进几乎免费（≈0.001ms/帧），**合成一帧画布才是大头**（≈5ns/px）。
 *   于是护栏的旋钮从「并发数」变成「并发数 × 画布面积」，并且必须有降级动作
 *   （降渲染频率 / 挤掉最老实例），否则一次特效高峰就能把战场帧率拖垮。
 *
 * 输入：预算（core/theme/visual-spec.ts 的 CODE_FX_METRICS）+ 实测帧耗时。
 * 输出：准入裁决 / 渲染频率 / 是否该挤实例 / 是否离屏。
 * 禁止事项：
 *   1. import phaser —— 本模块零渲染依赖（单测直接跑）；
 *   2. 引用具体的效果 id —— 只按面积与并发裁决；
 *   3. 自己做时间推进 —— 时间由宿主层给（world 不自己开定时器，perf 硬约束）。
 */

/** 代码路由的预算（唯一事实源在 core/theme/visual-spec.ts 的 CODE_FX_METRICS）。 */
export interface CodeFxBudget {
  /** 同时最多几个代码路由实例。 */
  readonly maxConcurrent: number;
  /** 单个效果的画布面积上限（px）—— 超了直接不播（成本与面积成正比，见实测）。 */
  readonly maxCanvasAreaPx: number;
  /** 目标渲染频率（Hz）—— 仿真仍是 120Hz（由效果自己的 update 内部切子步），只是画面抽帧。 */
  readonly renderHz: number;
  /** 降级后的最低渲染频率（Hz）—— 再低就看不出动画了，宁可挤实例。 */
  readonly minRenderHz: number;
  /** 每帧允许占用的主线程时间（ms）—— 超过就降级。 */
  readonly frameBudgetMs: number;
  /** 离屏判定的留边（世界 px）。 */
  readonly offscreenMarginPx: number;
}

/** 准入裁决的结果。 */
export type CodeFxAdmission =
  | { readonly admitted: true; readonly reason: 'ok' }
  | { readonly admitted: false; readonly reason: 'area-too-large' }
  | { readonly admitted: false; readonly reason: 'concurrency-full' };

/**
 * 准入裁决：这个效果现在能不能播。
 *
 * @param canvasAreaPx 效果的画布面积（px）。
 * @param activeCount 当前在播的实例数。
 * @param budget 预算。
 * @returns 裁决（面积超标 = 永远不播；并发满 = 该挤掉最老的再播）。
 */
export function admitCodeFx(
  canvasAreaPx: number,
  activeCount: number,
  budget: CodeFxBudget,
): CodeFxAdmission {
  if (canvasAreaPx > budget.maxCanvasAreaPx) {
    return { admitted: false, reason: 'area-too-large' };
  }
  if (activeCount >= budget.maxConcurrent) {
    return { admitted: false, reason: 'concurrency-full' };
  }
  return { admitted: true, reason: 'ok' };
}

/**
 * 渲染频率的下一档：按实测帧耗时自适应（超预算降档、宽裕则升回目标档）。
 *
 * why 要自适应而不是写死：特效的峰值成本随粒子密度起伏（爆发那一帧最贵），
 *   写死一个频率要么平时浪费、要么峰值爆帧。自适应是唯一两头都不吃亏的做法。
 *
 * @param currentHz 当前渲染频率（Hz）。
 * @param measuredMs 上一帧代码路由实际占用的主线程时间（ms）。
 * @param budget 预算。
 * @returns 下一档渲染频率（Hz）。
 */
export function nextRenderHz(currentHz: number, measuredMs: number, budget: CodeFxBudget): number {
  if (measuredMs > budget.frameBudgetMs) {
    return Math.max(budget.minRenderHz, Math.floor(currentHz / 2));
  }
  if (measuredMs < budget.frameBudgetMs / 2 && currentHz < budget.renderHz) {
    return Math.min(budget.renderHz, currentHz * 2);
  }
  return currentHz;
}

/**
 * 已经降到最低频率还超预算 → 该挤掉最老的实例了。
 *
 * why 不再降频率：低于 minRenderHz 的画面已经不像动画了（抽帧感明显），
 *   这时保住帧率比保住特效更重要 —— 挤掉最老的一条是损失最小的一招。
 */
export function shouldEvictForBudget(
  measuredMs: number,
  renderHz: number,
  budget: CodeFxBudget,
): boolean {
  return measuredMs > budget.frameBudgetMs && renderHz <= budget.minRenderHz;
}

/** 视口矩形（Phaser 的 camera.worldView 同形）。 */
export interface CodeFxView {
  readonly x: number;
  readonly y: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * 离屏判定：特效挂载点是否还在视口（含留边）里。
 *
 * why 离屏要**停**：镜头拉走时画面上没有任何东西在动，可代码路由还在逐像素算 ——
 *   白烧 CPU（perf 硬约束，与一期 sheet 路由同一条纪律）。
 * why 视口尺寸为 0 时一律算「可见」：相机还没算出可视区（首帧前后），
 *   那时判成离屏会把刚播的特效秒收掉 —— 首帧误杀的坑不踩。
 */
export function isCodeFxOnScreen(
  x: number,
  y: number,
  view: CodeFxView | null | undefined,
  margin: number,
): boolean {
  if (!view || view.right <= view.x || view.bottom <= view.y) return true;
  return (
    x >= view.x - margin &&
    x <= view.right + margin &&
    y >= view.y - margin &&
    y <= view.bottom + margin
  );
}
