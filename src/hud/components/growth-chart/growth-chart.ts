/**
 * 文件职责：成长曲线图组件（task_061）—— `<strat-growth-chart>` WebComponent，
 *   **纯 canvas 折线图**（无图表库、无新依赖；实现范式对齐 057 minimap：固定尺寸画布 +
 *   2d 上下文直绘 + pointer 命中纯函数）。画的内容：
 *   ① 网格：4 条水平参考线（0 / 25 / 50 / 75 / 100% 高度）+ 纵轴最大值角标；
 *   ② 折线：近 30 天窗口内累计经验曲线（数据来自 growth-catalog 的 buildExpSeries）；
 *   ③ 里程碑标记：升级日的点上方画「Lv.N」标记（数据来自 extractMilestones，按日历日落桶）；
 *   ④ 悬浮值：pointermove 命中最近数据点 → 竖线 + 圆点 + 当日增量 / 窗口累计文案（fillText）。
 * 输入：setData(points, milestones)（视图模型纯数据，经属性注入 —— 本组件不取数、不碰端口）。
 * 输出：纯展示（无命令派发；hover 状态对外只读可测）。
 * 禁止事项：
 *   1. import world / app —— hud 铁律；数据一律 setData 进来；
 *   2. 认识 exp 事件原行 —— 只认折线点与里程碑两个纯形状（时序聚合在 growth-catalog）；
 *   3. jsdom 里炸 —— 2d 上下文拿不到就静默跳过绘制（同 minimap 的降级口径，单测再 mock）。
 *
 * @since v3.36，task_061。依赖：growth-catalog 的 ExpSeriesPoint / GrowthMilestone 形状。
 */

import type { ExpSeriesPoint, GrowthMilestone } from '../../screens/growth-catalog';
import { DAY_MS, dayStartOf } from '../../screens/growth-catalog';

/** 自定义元素标签（幂等注册，与 minimap 同约定）。 */
export const GROWTH_CHART_TAG = 'strat-growth-chart';

/** 画布尺寸（CSS 像素；固定尺寸与 minimap 同口径 —— 容器滚动适配，不动态测容）。 */
export const GROWTH_CHART_WIDTH_PX = 480;
export const GROWTH_CHART_HEIGHT_PX = 160;

/** 绘图区内边距（左留纵轴角标、下留横轴日期角标）。 */
const PLOT_PADDING = { left: 40, right: 12, top: 14, bottom: 18 };

export interface StratGrowthChartElement extends HTMLElement {
  /** 注入折线数据并重画（points 期望按 dayIndex 升序；milestones 按发生时刻升序）。 */
  setData(points: readonly ExpSeriesPoint[], milestones: readonly GrowthMilestone[]): void;
  /** 当前悬浮命中的数据点下标（-1 = 无悬浮；测试观察口）。 */
  readonly hoverIndex: number;
  /** 最近一次注入的数据点数（空数据判定归调用方，这里如实回显）。 */
  readonly pointCount: number;
}

/**
 * 折线几何（纯函数）：数据点 → 画布坐标。yMax 至少 1（全零曲线也画得出基线，不除 0）。
 * 导出供单测对拍（往返口径：x 均分、y 顶格）。
 */
export interface ChartGeometry {
  /** 每个数据点的 x 坐标（CSS 像素）。 */
  readonly xs: readonly number[];
  /** 每个数据点的 y 坐标（CSS 像素）。 */
  readonly ys: readonly number[];
  /** 纵轴最大值（角标文案与 y 映射共用，两处不漂移）。 */
  readonly yMax: number;
}

export function chartGeometry(
  points: readonly ExpSeriesPoint[],
  width: number,
  height: number
): ChartGeometry {
  const innerW = Math.max(1, width - PLOT_PADDING.left - PLOT_PADDING.right);
  const innerH = Math.max(1, height - PLOT_PADDING.top - PLOT_PADDING.bottom);
  const xs: number[] = [];
  const ys: number[] = [];
  const n = points.length;
  const yMax = Math.max(1, ...points.map((p) => p.cumulative));
  for (let i = 0; i < n; i += 1) {
    // 单点也能画（x 居中不除 0）；多点均分内区宽。
    xs.push(PLOT_PADDING.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW));
    // 累计曲线从基线起：y = 顶 + (1 - v/yMax) × 内高。
    ys.push(PLOT_PADDING.top + (1 - points[i]!.cumulative / yMax) * innerH);
  }
  return { xs, ys, yMax };
}

/**
 * 悬浮命中（纯函数）：给数据点 x 坐标数组与画布内 x，取最近点下标；空数组返回 -1。
 * 阈值不做（折线图全宽都是命中区 ——「最近的一天」语义比「±N 像素」更贴使用直觉）。
 */
export function nearestPointIndex(xs: readonly number[], x: number): number {
  let best = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < xs.length; i += 1) {
    const dist = Math.abs(xs[i]! - x);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/** 里程碑时刻 → 数据点下标（按日历日落桶；窗口外 / 无桶返回 -1 —— 防御不猜）。 */
export function milestoneDayIndex(points: readonly ExpSeriesPoint[], at: number): number {
  const dayStart = dayStartOf(at);
  for (let i = 0; i < points.length; i += 1) {
    if (points[i]!.dayStart === dayStart) return i;
  }
  return -1;
}

/** 画布内 x（CSS 像素；getBoundingClientRect 差值换算，不依赖 offsetX —— jsdom 同 minimap 用 rect 口径）。 */
function canvasX(canvas: HTMLCanvasElement, clientX: number): number {
  const rect = canvas.getBoundingClientRect();
  return clientX - rect.left;
}

export function defineStratGrowthChart(): typeof HTMLElement {
  if (customElements.get(GROWTH_CHART_TAG)) {
    return customElements.get(GROWTH_CHART_TAG) as unknown as typeof HTMLElement;
  }

  class StratGrowthChart extends HTMLElement implements StratGrowthChartElement {
    private _points: readonly ExpSeriesPoint[] = [];
    private _milestones: readonly GrowthMilestone[] = [];
    private _hoverIndex = -1;

    get hoverIndex(): number { return this._hoverIndex; }
    get pointCount(): number { return this._points.length; }

    connectedCallback(): void {
      // attachShadow 后 TS 仍认为 shadowRoot 可空：接管到局部常量再操作（与 minimap 同手法）。
      const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host { all: initial; display: block; width: 100%; }
          canvas { display: block; max-width: 100%; height: auto; }
        </style>
        <canvas width="${GROWTH_CHART_WIDTH_PX}" height="${GROWTH_CHART_HEIGHT_PX}"></canvas>
      `;
      const canvas = root.querySelector('canvas');
      if (canvas) {
        canvas.addEventListener('pointermove', (ev: PointerEvent) => {
          this.updateHover(canvasX(canvas, ev.clientX));
        });
        canvas.addEventListener('pointerleave', () => {
          if (this._hoverIndex === -1) return;
          this._hoverIndex = -1;
          this.draw();
        });
      }
      this.draw();
    }

    disconnectedCallback(): void {
      // 影子树整体随节点摘除释放；无定时器 / 订阅需要清（与 minimap 的卸载口径一致）。
      this._hoverIndex = -1;
    }

    setData(points: readonly ExpSeriesPoint[], milestones: readonly GrowthMilestone[]): void {
      this._points = points;
      this._milestones = milestones;
      this._hoverIndex = -1;
      this.draw();
    }

    private updateHover(x: number): void {
      const geo = chartGeometry(this._points, GROWTH_CHART_WIDTH_PX, GROWTH_CHART_HEIGHT_PX);
      const index = nearestPointIndex(geo.xs, x);
      if (index === this._hoverIndex) return;
      this._hoverIndex = index;
      this.draw();
    }

    private draw(): void {
      const canvas = this.shadowRoot?.querySelector('canvas');
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      // jsdom / 无 GPU 环境拿不到 2d 上下文：数据已就位，画不了不报错（单测 mock 后再断言绘制）。
      if (!ctx) return;
      const cssW = GROWTH_CHART_WIDTH_PX;
      const cssH = GROWTH_CHART_HEIGHT_PX;
      const dpr = typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1;
      if (canvas.width !== Math.round(cssW * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const computed = getComputedStyle(this);
      const text = computed.getPropertyValue('--srf-text-muted').trim() || '#9aa3b2';
      const accent = computed.getPropertyValue('--srf-accent').trim() || '#6ea8ff';
      const warn = computed.getPropertyValue('--srf-warn').trim() || '#f0c674';
      const gridColor = computed.getPropertyValue('--srf-border').trim() || '#2a313d';
      const fontFamily = computed.getPropertyValue('--srf-font-mono').trim() || 'sans-serif';
      const fontSize = computed.getPropertyValue('--srf-font-size-xs').trim() || '10px';
      const labelSize = computed.getPropertyValue('--srf-font-size-sm').trim() || '11px';

      const points = this._points;
      if (points.length === 0) return;
      const geo = chartGeometry(points, cssW, cssH);
      const innerBottom = cssH - PLOT_PADDING.bottom;

      // ① 网格：5 条水平参考线 + 纵轴 0 / max 角标。
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      ctx.fillStyle = text;
      ctx.font = `${fontSize} ${fontFamily}`;
      ctx.textAlign = 'left';
      for (let g = 0; g <= 4; g += 1) {
        const y = PLOT_PADDING.top + (g / 4) * (innerBottom - PLOT_PADDING.top);
        ctx.beginPath();
        ctx.moveTo(PLOT_PADDING.left, y);
        ctx.lineTo(cssW - PLOT_PADDING.right, y);
        ctx.stroke();
        if (g === 0 || g === 4) {
          const value = g === 0 ? geo.yMax : 0;
          ctx.fillText(String(Math.round(value)), 4, y + 4);
        }
      }
      // 横轴角标：窗口首末日的月-日。
      const fmt = (ms: number): string => {
        const d = new Date(ms);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      };
      ctx.textAlign = 'left';
      ctx.fillText(fmt(points[0]!.dayStart), PLOT_PADDING.left, cssH - 5);
      ctx.textAlign = 'right';
      ctx.fillText(fmt(points[points.length - 1]!.dayStart + DAY_MS - 1), cssW - PLOT_PADDING.right, cssH - 5);

      // ② 折线（先描边后落里程碑点，里程碑盖在线上）。
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 1) {
        const x = geo.xs[i]!;
        const y = geo.ys[i]!;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      // ③ 里程碑标记：升级日的点画暖色圆点 + 「Lv.N」上标。
      for (const milestone of this._milestones) {
        const idx = milestoneDayIndex(points, milestone.at);
        if (idx < 0) continue;
        const x = geo.xs[idx]!;
        const y = geo.ys[idx]!;
        ctx.fillStyle = warn;
        ctx.beginPath();
        ctx.arc(x, y, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.textAlign = 'center';
        ctx.fillText(`Lv.${milestone.level}`, x, Math.max(9, y - 6));
      }

      // ④ 悬浮值：竖线 + 圆点 + 文案（当日增量 + 窗口累计）。
      const hover = this._hoverIndex;
      if (hover >= 0 && hover < points.length) {
        const x = geo.xs[hover]!;
        const y = geo.ys[hover]!;
        const point = points[hover]!;
        ctx.strokeStyle = warn;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, PLOT_PADDING.top);
        ctx.lineTo(x, innerBottom);
        ctx.stroke();
        ctx.fillStyle = warn;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
        const label = `${fmt(point.dayStart)} +${point.gained}（累计 +${point.cumulative}）`;
        ctx.font = `${labelSize} ${fontFamily}`;
        ctx.textAlign = x > cssW - 110 ? 'right' : 'left';
        const labelX = x > cssW - 110 ? x - 8 : x + 8;
        ctx.fillText(label, labelX, Math.max(12, y - 10));
      }
    }
  }

  customElements.define(GROWTH_CHART_TAG, StratGrowthChart);
  return StratGrowthChart;
}
