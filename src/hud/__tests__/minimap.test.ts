/**
 * 集成测试：小地图组件（hud/components/minimap/minimap.ts，task_057；v3.3 视觉升级 task_079）。
 * jsdom + canvas 2d 上下文 mock（jsdom 无 canvas 实现，stub 只记录绘制调用 —— 断言语义面：
 * 画了几个点 / 画没画视口框 / 光点按什么色上色）。
 * 覆盖：映射纯函数（世界↔画布往返 / letterbox / 钳制 / 坏尺寸回落）、点命中、
 * 点击/拖拽 → 命令分发（camera.center / unit.select）、固定展开（v3.5：折叠钮 / 折叠记忆
 * 全解除）、挂卸，
 * 以及 v3.3 的视觉面：岛屿轮廓 + 视野白框 + 外框 + MAP 角标 + 状态着色光点。
 * @jest-environment jsdom
 */

import {
  clampToCanvas,
  defineStratMinimap,
  hitTestUnit,
  MINIMAP_HEIGHT_PX,
  MINIMAP_TAG,
  MINIMAP_WIDTH_PX,
  minimapToWorld,
  mountMinimap,
  worldToMinimap,
  type MinimapDispatchCommand,
  type MinimapUnit,
  type StratMinimapElement,
} from '../components/minimap/minimap';
import {
  CONTROL_ISLAND_METRICS,
  MINIMAP_METRICS,
  VISUAL_PALETTE,
} from '../../core/theme/visual-spec';
import { WORLD_BOUNDS } from '../../core/types';

/** 默认尺寸（200×120）下世界 3200×2400 等比铺进画布（scale=1/20，左右各留 20px）。 */
const SIZE = { width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX };

/** 世界中心在画布上的位置（= 画布中心：letterbox 左右对称）。 */
const CANVAS_CENTER = { x: MINIMAP_WIDTH_PX / 2, y: MINIMAP_HEIGHT_PX / 2 };

/** canvas 2d 上下文 stub：记录绘制调用（jsdom 没有 canvas，mock 模式参照 appearance fakes）。 */
interface CtxStub {
  readonly clearRect: jest.Mock;
  readonly fillRect: jest.Mock;
  readonly strokeRect: jest.Mock;
  readonly beginPath: jest.Mock;
  readonly arc: jest.Mock;
  readonly fill: jest.Mock;
  readonly stroke: jest.Mock;
  readonly moveTo: jest.Mock;
  readonly lineTo: jest.Mock;
  readonly closePath: jest.Mock;
  readonly fillText: jest.Mock;
  /** 每次 fill() 时的 fillStyle（光点着色断言用）。 */
  readonly fills: string[];
  /** 每次 strokeRect() 时的 strokeStyle（视野白框 / 外框描边断言用）。 */
  readonly strokes: string[];
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
}

function createCtxStub(): CtxStub {
  const fills: string[] = [];
  const strokes: string[] = [];
  const ctx: CtxStub = {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(() => {
      strokes.push(ctx.strokeStyle);
    }),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(() => {
      fills.push(ctx.fillStyle);
    }),
    stroke: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    closePath: jest.fn(),
    fillText: jest.fn(),
    fills,
    strokes,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    font: '',
    textBaseline: '',
  };
  return ctx;
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

/** 建一个挂好的小地图元素（挂在 #mm-host 容器里），并记录它发出的命令。 */
function host(): { el: StratMinimapElement; commands: MinimapDispatchCommand[] } {
  defineStratMinimap();
  const el = document.createElement(MINIMAP_TAG) as StratMinimapElement;
  const commands: MinimapDispatchCommand[] = [];
  el.ports = { dispatch: (command) => commands.push(command) };
  const container = document.getElementById('mm-host');
  if (!container) throw new Error('#mm-host not found');
  container.appendChild(el);
  return { el, commands };
}

/** 画布派发一个指针事件（jsdom 无 PointerEvent —— 用 MouseEvent 打同名事件；offsetX 缺席，坐标走 clientX/rect 口径）。 */
function fire(el: StratMinimapElement, type: 'pointerdown' | 'pointermove' | 'pointerup', x: number, y: number): void {
  const canvas = el.shadowRoot?.querySelector('canvas');
  if (!canvas) throw new Error('canvas not found');
  canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 }));
}

// ============================================================================
// 纯函数：映射与命中
// ============================================================================

describe('映射纯函数：世界 ↔ 画布', () => {
  test('四角与中心：默认尺寸下世界等比铺进画布（200×120 装 4:3 → 左右各留 20px）', () => {
    expect(worldToMinimap({ x: 0, y: 0 }, SIZE)).toEqual({ x: 20, y: 0 });
    expect(worldToMinimap({ x: WORLD_BOUNDS.width, y: WORLD_BOUNDS.height }, SIZE)).toEqual({
      x: MINIMAP_WIDTH_PX - 20,
      y: MINIMAP_HEIGHT_PX,
    });
    expect(worldToMinimap({ x: 1600, y: 1200 }, SIZE)).toEqual(CANVAS_CENTER);
  });

  test('往返：世界 → 画布 → 世界，闭合（任取内点，浮点容差内还原）', () => {
    const samples = [
      { x: 0, y: 0 },
      { x: 3200, y: 2400 },
      { x: 13.7, y: 2399.9 },
      { x: 1600, y: 1200 },
    ];
    for (const p of samples) {
      const round = minimapToWorld(worldToMinimap(p, SIZE), SIZE);
      expect(round.x).toBeCloseTo(p.x, 6);
      expect(round.y).toBeCloseTo(p.y, 6);
    }
  });

  test('letterbox：宽高比不一致时等比留边不拉伸（往返仍闭合）', () => {
    const tall = { width: 200, height: 400 }; // 世界 4:3 进竖画布 → 上下留边 125
    const topLeft = worldToMinimap({ x: 0, y: 0 }, tall);
    expect(topLeft).toEqual({ x: 0, y: 125 });
    const round = minimapToWorld(worldToMinimap({ x: 777, y: 1234 }, tall), tall);
    expect(round.x).toBeCloseTo(777, 6);
    expect(round.y).toBeCloseTo(1234, 6);
  });

  test('逆映射的坏尺寸回落：零尺寸画布 → 世界中心（不吐 Infinity）', () => {
    const center = minimapToWorld({ x: 50, y: 50 }, { width: 0, height: 0 });
    expect(center).toEqual({ x: 1600, y: 1200 });
  });

  test('clampToCanvas：四向越界各自收边', () => {
    expect(clampToCanvas({ x: -5, y: 20 }, SIZE)).toEqual({ x: 0, y: 20 });
    expect(clampToCanvas({ x: 999, y: 999 }, SIZE)).toEqual({
      x: MINIMAP_WIDTH_PX,
      y: MINIMAP_HEIGHT_PX,
    });
  });
});

describe('点命中检测', () => {
  const units: MinimapUnit[] = [
    { id: 'u1', x: 1600, y: 1200 }, // → 画布中心 (100, 60)
    { id: 'u2', x: 0, y: 0 }, // → 画布 (20, 0)
  ];

  test('命中半径内（比点半径大一圈）：返回单位 id', () => {
    expect(hitTestUnit(CANVAS_CENTER, units, SIZE)).toBe('u1');
    expect(hitTestUnit({ x: CANVAS_CENTER.x + 7, y: CANVAS_CENTER.y }, units, SIZE)).toBe('u1'); // 命中半径 8px
  });

  test('半径外 → null', () => {
    expect(hitTestUnit({ x: CANVAS_CENTER.x + 9, y: CANVAS_CENTER.y }, units, SIZE)).toBeNull();
    expect(hitTestUnit({ x: 30, y: 30 }, units, SIZE)).toBeNull();
  });

  test('重叠点：数组后面的（画在顶层）优先命中', () => {
    const overlapped: MinimapUnit[] = [
      { id: 'bottom', x: 1600, y: 1200 },
      { id: 'top', x: 1632, y: 1200 }, // 画布上相距 1.6px —— 都在命中半径内
    ];
    expect(hitTestUnit(CANVAS_CENTER, overlapped, SIZE)).toBe('top');
  });

  test('空单位集 / 空点击 → null 不炸', () => {
    expect(hitTestUnit({ x: 0, y: 0 }, [], SIZE)).toBeNull();
  });
});

// ============================================================================
// 组件：数据喂入与绘制
// ============================================================================

describe('组件：喂入与绘制', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="mm-host"></div>';
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    jest.clearAllMocks();
  });

  test('setUnits / setViewport：数据面可读回，喂入触发重绘', () => {
    const { el } = host();
    const before = el.drawCount;
    el.setUnits([
      { id: 'u1', x: 100, y: 100, skinId: 'crimson' },
      { id: 'u2', x: 200, y: 200, online: false },
    ]);
    expect(el.drawCount).toBe(before + 1);
    jest.clearAllMocks(); // 首绘不计入：只看本次 setViewport 触发的那一次重绘

    el.setViewport({ x: 400, y: 300, width: 800, height: 600 });

    expect(el.unitCount).toBe(2);
    expect(el.viewport).toEqual({ x: 400, y: 300, width: 800, height: 600 });
    expect(el.drawCount).toBe(before + 2);

    // 语义面：视野框填充（fillRect × 1）+ 视野框与外框描边（strokeRect × 2）
    //   + 岛屿轮廓（moveTo/lineTo/closePath/stroke）+ 两个单位光点（arc × 2）
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(2);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    // fill = 岛屿填充 1 次 + 两个光点 2 次
    expect(ctx.fill).toHaveBeenCalledTimes(3);
    // 岛屿轮廓：一条闭合多边形（16 个归一化点）
    expect(ctx.moveTo).toHaveBeenCalledTimes(1);
    expect(ctx.closePath).toHaveBeenCalledTimes(1);
    expect(ctx.stroke).toHaveBeenCalledTimes(1);
    // 「MAP」角标
    expect(ctx.fillText).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('MAP', expect.any(Number), expect.any(Number));
  });

  test('视野框是白框（规格钦定）：描边色为纯白', () => {
    const { el } = host();
    el.setViewport({ x: 0, y: 0, width: 100, height: 100 });
    expect(ctx.strokes).toContain('#ffffff');
  });

  test('单位光点按状态着色（忙=琥珀 / 错=绯红 / 闲=青蓝 / 离线=灰）', () => {
    const { el } = host();
    el.setUnits([
      { id: 'busy', x: 100, y: 100, status: 'busy' },
      { id: 'err', x: 200, y: 200, status: 'error' },
      { id: 'idle', x: 300, y: 300, status: 'idle' },
      { id: 'off', x: 400, y: 400, status: 'offline' },
    ]);
    // 每次重绘都是「岛屿填充 → 四个光点」，光点是最后四次 fill
    const dots = ctx.fills.slice(-4);
    expect(dots).toEqual([
      VISUAL_PALETTE.progress,
      VISUAL_PALETTE.danger,
      VISUAL_PALETTE.unit,
      '#5a6373',
    ]);
  });

  test('setViewport(null)：清掉视口框（null = 未知视口）', () => {
    const { el } = host();
    el.setViewport({ x: 0, y: 0, width: 100, height: 100 });
    el.setViewport(null);
    expect(el.viewport).toBeNull();
  });

  test('canvas 拿不到 2d 上下文（极端环境）：喂入不炸，数据面照常', () => {
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null);
    const { el } = host();
    el.setUnits([{ id: 'u1', x: 0, y: 0 }]);
    expect(el.unitCount).toBe(1);
  });
});

// ============================================================================
// 组件：交互 → 命令分发
// ============================================================================

describe('组件：点击 / 拖拽 → 命令分发', () => {
  beforeEach(() => {
    document.body.innerHTML = `<div id="mm-host"></div>`;
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
    jest.clearAllMocks();
  });

  test('点空地 → 只发 camera.center（世界坐标按画布比例换算，core 侧再钳制）', () => {
    const { el, commands } = host();
    fire(el, 'pointerdown', CANVAS_CENTER.x, CANVAS_CENTER.y); // 画布中心 → 世界中心

    expect(commands).toEqual([{ type: 'camera.center', x: 1600, y: 1200 }]);
  });

  test('点单位点 → 先 unit.select(set) 再 camera.center（跳过去看它）', () => {
    const { el, commands } = host();
    el.setUnits([{ id: 'u1', x: 1600, y: 1200, skinId: 'forest' }]);
    fire(el, 'pointerdown', CANVAS_CENTER.x, CANVAS_CENTER.y);

    expect(commands[0]).toEqual({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(commands[1]).toEqual({ type: 'camera.center', x: 1600, y: 1200 });
  });

  test('拖拽 → 连续 camera.center；松手后停止；未按下时 move 不发', () => {
    const { el, commands } = host();

    fire(el, 'pointermove', 10, 10); // 未按下：纯 hover，不发
    expect(commands).toHaveLength(0);

    fire(el, 'pointerdown', 20, 0);
    fire(el, 'pointermove', 60, 30);
    fire(el, 'pointermove', CANVAS_CENTER.x, CANVAS_CENTER.y);
    fire(el, 'pointerup', CANVAS_CENTER.x, CANVAS_CENTER.y);
    fire(el, 'pointermove', 120, 90); // 已松手：不再发

    const centers = commands.filter((c) => c.type === 'camera.center');
    expect(centers).toHaveLength(3); // down + 两次 move
    // 画布 (60,30) → 世界 ((60-20)/0.05, 30/0.05) = (800, 600)
    expect(centers[1]).toEqual({ type: 'camera.center', x: 800, y: 600 });
    expect(centers[2]).toEqual({ type: 'camera.center', x: 1600, y: 1200 });
  });

  test('ports 未注入：交互命令被丢弃，组件不炸（被动渲染仍可用）', () => {
    defineStratMinimap();
    const el = document.createElement(MINIMAP_TAG) as StratMinimapElement;
    document.body.appendChild(el);
    const canvas = el.shadowRoot?.querySelector('canvas');
    expect(() => {
      canvas?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10 }));
    }).not.toThrow();
  });
});

// ============================================================================
// 固定展开（@since v3.5，task_098）
// ============================================================================

describe('组件：固定展开（一切折叠路径已解除）', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="mm-host"></div>';
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  test('没有折叠钮：shadow 里不存在 toggle 按钮（唯一可点的只有画布）', () => {
    const { el } = host();
    expect(el.shadowRoot?.querySelector('[data-role="toggle"]')).toBeNull();
  });

  test('画布常驻：样式表里没有任何隐藏画布的规则（无折叠属性选择器 / display:none）', () => {
    const { el } = host();
    const css = el.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).not.toContain('data-collapsed');
    expect(css).not.toMatch(/display:\s*none/);
    // 画布本身照常显示（展开态的实体）。
    expect(css).toMatch(/canvas\s*\{[^}]*display:\s*block/);
  });

  test('遗留折叠记忆键不再生效：旧值 stratix.minimap.collapsed=1 也照常展开', () => {
    localStorage.setItem('stratix.minimap.collapsed', '1');
    const { el } = host();
    expect(el.hasAttribute('data-collapsed')).toBe(false);
    const canvas = el.shadowRoot?.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('width')).toBe(String(MINIMAP_WIDTH_PX));
    expect(canvas?.getAttribute('height')).toBe(String(MINIMAP_HEIGHT_PX));
  });

  test('标题栏保留（「小地图」标签仍在，折叠钮已摘）', () => {
    const { el } = host();
    expect(el.shadowRoot?.querySelector('.label')?.textContent).toBe('小地图');
  });

  test('拖拽残留复位：拖拽中卸载 → 重挂不携带 _dragging（先卸载再重挂安全）', () => {
    const { el, commands } = host();
    fire(el, 'pointerdown', 10, 10);
    el.remove();
    fire(el, 'pointermove', 20, 20); // 已离场：拖拽态已复位，无新命令
    document.body.appendChild(el);
    expect(commands).toHaveLength(1);
  });
});

// ============================================================================
// hover 提亮 + 贴边留边（@since v3.4，task_093）
// ============================================================================

describe('Z3 小地图：hover 提升亮度（有过渡）', () => {
  test('hover 时外框提亮，且亮度倍数来自唯一事实源', () => {
    const { el } = host();
    const css = el.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toContain(':host(:hover)');
    expect(css).toContain(`brightness(${MINIMAP_METRICS.hoverBrightness})`);
    // 提亮必须是「变亮」而不是变暗 / 不动。
    expect(MINIMAP_METRICS.hoverBrightness).toBeGreaterThan(1);
  });

  test('提亮有过渡（不许啪地一下变亮）', () => {
    const { el } = host();
    const css = el.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toMatch(/\.frame\s*\{[^}]*transition:\s*filter/);
    expect(css).toContain(`${MINIMAP_METRICS.hoverTransitionMs}ms`);
    expect(MINIMAP_METRICS.hoverTransitionMs).toBeGreaterThan(0);
  });

  test('只动 filter（合成层属性）—— 不触发布局重排', () => {
    const { el } = host();
    const css = el.shadowRoot?.querySelector('style')?.textContent ?? '';
    // 只取 hover 那一条规则（到第一个右花括号为止），别把后面的规则也扫进来。
    const hoverRule = css.match(/:host\(:hover\)\s*\.frame\s*\{[^}]*\}/)?.[0] ?? '';
    expect(hoverRule).toContain('filter');
    expect(hoverRule).not.toMatch(/width|height|margin|padding|top|left/);
  });
});

describe('Z3 小地图：贴边留边与控制岛留边同一口径', () => {
  test('小地图的 right / bottom 留边 = MINIMAP_METRICS.cornerMarginPx（16px）', () => {
    const { el } = host();
    const css = el.shadowRoot?.querySelector('style')?.textContent ?? '';
    expect(css).toContain(`right: ${MINIMAP_METRICS.cornerMarginPx}px`);
    expect(css).toContain(`bottom: ${MINIMAP_METRICS.cornerMarginPx}px`);
    // 与事件轨（CONTROL_ISLAND_METRICS.cornerMarginPx）同值 → 两角件的间距推得出来。
    expect(MINIMAP_METRICS.cornerMarginPx).toBe(CONTROL_ISLAND_METRICS.cornerMarginPx);
  });
});

// ============================================================================
// 挂载工厂
// ============================================================================

describe('mountMinimap：建元素挂进容器并接好命令口', () => {
  test('挂载 → 元素在容器内，ports 生效；unmount 移除', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const commands: MinimapDispatchCommand[] = [];
    const { element, unmount } = mountMinimap(container, {
      dispatch: (command) => commands.push(command),
    });
    expect(container.querySelector(MINIMAP_TAG)).toBe(element);

    element.setUnits([{ id: 'u1', x: 0, y: 0 }]);
    expect(element.unitCount).toBe(1);

    // 点在单位点之外（避开命中半径）：只发跳转命令
    element.shadowRoot?.querySelector('canvas')?.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 50 })
    );
    // 画布 (50,50) → 世界 ((50-20)/0.05, 50/0.05) = (600, 1000)
    expect(commands).toEqual([{ type: 'camera.center', x: 600, y: 1000 }]);

    unmount();
    expect(container.querySelector(MINIMAP_TAG)).toBeNull();
  });
});
