/**
 * 集成测试：成长曲线图组件（hud/components/growth-chart/growth-chart.ts，task_061）。
 * jsdom + canvas 2d 上下文 mock（jsdom 无 canvas 实现，stub 只记录绘制调用 —— 断言语义面：
 * 画了折线 / 网格 / 悬浮值，颜色数值不归单测管；模式对齐 057 minimap.test.ts）。
 * 覆盖：几何纯函数（坐标均分 / y 映射 / 单点退化）、悬浮命中、里程碑落桶、
 * setData 重画、pointer 交互改 hoverIndex、空数据不画。
 * @jest-environment jsdom
 */

import {
  chartGeometry,
  defineStratGrowthChart,
  GROWTH_CHART_HEIGHT_PX,
  GROWTH_CHART_TAG,
  GROWTH_CHART_WIDTH_PX,
  milestoneDayIndex,
  nearestPointIndex,
  type StratGrowthChartElement,
} from '../components/growth-chart/growth-chart';
import { buildExpSeries, dayStartOf, type ExpSeriesPoint } from '../screens/growth-catalog';

const DAY = 86_400_000;

/** canvas 2d 上下文 stub：记录绘制调用（jsdom 没有 canvas）。 */
interface CtxStub {
  readonly clearRect: jest.Mock;
  readonly beginPath: jest.Mock;
  readonly moveTo: jest.Mock;
  readonly lineTo: jest.Mock;
  readonly stroke: jest.Mock;
  readonly arc: jest.Mock;
  readonly fill: jest.Mock;
  readonly fillText: jest.Mock;
  readonly setTransform: jest.Mock;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textAlign: string;
}

function createCtxStub(): CtxStub {
  return {
    clearRect: jest.fn(),
    beginPath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    stroke: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillText: jest.fn(),
    setTransform: jest.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
  };
}

let ctx: CtxStub;

beforeAll(() => {
  ctx = createCtxStub();
  jest
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

afterAll(() => {
  jest.restoreAllMocks();
});

/** 挂好的曲线元素（升级后 shadowRoot 就位；容器必须进 document，否则 connectedCallback 不触发）。 */
function mountChart(): StratGrowthChartElement {
  defineStratGrowthChart();
  const el = document.createElement(GROWTH_CHART_TAG) as StratGrowthChartElement;
  const container = document.createElement('div');
  document.body.appendChild(container);
  container.appendChild(el);
  return el;
}

const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime();
const TODAY = dayStartOf(NOW);

/** 手工点列（不走 buildExpSeries，几何断言不掺聚合逻辑）。 */
function flatPoints(n: number, cumulative = 10): ExpSeriesPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    dayIndex: i,
    dayStart: TODAY - (n - 1 - i) * 86_400_000,
    gained: 0,
    cumulative,
  }));
}

// ============================================================================
// 纯函数：几何 / 命中 / 落桶
// ============================================================================

describe('几何纯函数 chartGeometry', () => {
  test('x 均分内区宽（首点贴左内边、末点贴右内边）；y 顶格映射', () => {
    const geo = chartGeometry(flatPoints(3), GROWTH_CHART_WIDTH_PX, GROWTH_CHART_HEIGHT_PX);
    expect(geo.xs).toHaveLength(3);
    expect(geo.xs[0]).toBe(40); // PLOT_PADDING.left
    expect(geo.xs[2]).toBeCloseTo(GROWTH_CHART_WIDTH_PX - 12, 5);
    // 同值三点：y 相同（顶格不抖动）。
    expect(geo.ys[0]).toBe(geo.ys[1]);
  });

  test('全零曲线 yMax 兜底为 1（不除 0）；单点 x 居中', () => {
    const flat = chartGeometry(flatPoints(2, 0), 480, 160);
    expect(flat.yMax).toBe(1);
    const single = chartGeometry(flatPoints(1), 480, 160);
    expect(single.xs[0]).toBeCloseTo(40 + (480 - 52) / 2, 5);
  });
});

describe('命中 / 落桶纯函数', () => {
  test('nearestPointIndex：取最近点；空数组 -1', () => {
    expect(nearestPointIndex([40, 200, 400], 190)).toBe(1);
    expect(nearestPointIndex([40, 200, 400], 480)).toBe(2);
    expect(nearestPointIndex([], 100)).toBe(-1);
  });

  test('milestoneDayIndex：按日历日落到对应桶；窗口外 -1', () => {
    const points = flatPoints(3);
    const yesterdayStart = points[1]!.dayStart;
    expect(milestoneDayIndex(points, yesterdayStart + 5 * 3_600_000)).toBe(1);
    expect(milestoneDayIndex(points, TODAY + 5 * DAY)).toBe(-1);
  });
});

// ============================================================================
// 组件：setData / 重画 / 悬浮
// ============================================================================

describe('组件渲染与交互', () => {
  test('setData 喂数后 pointCount 可观察；空数据清空', () => {
    const el = mountChart();
    expect(el.pointCount).toBe(0);
    el.setData(buildExpSeries([{ delta: 5, reason: 'chat_round', level: null, createdAt: NOW }], NOW), []);
    expect(el.pointCount).toBe(30);
    el.setData([], []);
    expect(el.pointCount).toBe(0);
  });

  test('有数据时重画（clearRect + 折线描边 + 网格）；空数据只清屏不画线', () => {
    ctx.clearRect.mockClear();
    ctx.stroke.mockClear();
    const el = mountChart();
    el.setData([], []);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.stroke).not.toHaveBeenCalled();

    ctx.clearRect.mockClear();
    el.setData(buildExpSeries([{ delta: 5, reason: 'chat_round', level: null, createdAt: NOW }], NOW), []);
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.stroke).toHaveBeenCalled(); // 网格线 + 折线都走 stroke
    expect(ctx.fillText).toHaveBeenCalled(); // 角标文案
  });

  test('里程碑标记：窗口内的 level_up 画标记（arc 调用 > 0）', () => {
    ctx.arc.mockClear();
    const el = mountChart();
    el.setData(
      buildExpSeries([{ delta: 0, reason: 'level_up', level: 2, createdAt: TODAY + 100 }], NOW),
      [{ at: TODAY + 100, level: 2 }]
    );
    // 里程碑圆点 + 悬浮圆点（未悬浮）—— 至少一次 arc。
    expect(ctx.arc.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(ctx.fillText).toHaveBeenCalledWith('Lv.2', expect.any(Number), expect.any(Number));
  });

  test('悬浮：pointermove 命中最近点（hoverIndex 变化 + 悬浮圆点重画）', () => {
    const el = mountChart();
    el.setData(buildExpSeries([{ delta: 5, reason: 'chat_round', level: null, createdAt: NOW }], NOW), []);
    expect(el.hoverIndex).toBe(-1);

    ctx.arc.mockClear();
    ctx.fillText.mockClear();
    const canvas = el.shadowRoot?.querySelector('canvas');
    if (!canvas) throw new Error('canvas not found');
    // jsdom 的 getBoundingClientRect 全零：clientX 即画布内 x。480 宽 30 点：首点 x=40。
    canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 40, clientY: 10 }));
    expect(el.hoverIndex).toBe(0);
    // 悬浮值文案（fillText 次数增加：角标 + 悬浮标签）。
    const labels = ctx.fillText.mock.calls.map((c) => String(c[0]));
    expect(labels.some((text) => text.includes('累计'))).toBe(true);

    // 指到最右（468 附近）命中末点；pointerleave 清悬浮。
    canvas.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 468, clientY: 10 }));
    expect(el.hoverIndex).toBe(29);
    canvas.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));
    expect(el.hoverIndex).toBe(-1);
  });
});
