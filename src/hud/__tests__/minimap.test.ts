/**
 * 集成测试：小地图组件（hud/components/minimap/minimap.ts，task_057）。
 * jsdom + canvas 2d 上下文 mock（jsdom 无 canvas 实现，stub 只记录绘制调用 —— 断言语义面：
 * 画了几个点 / 画没画视口框，颜色数值不归单测管）。
 * 覆盖：映射纯函数（世界↔画布往返 / letterbox / 钳制 / 坏尺寸回落）、点命中、
 * 点击/拖拽 → 命令分发（camera.center / unit.select）、折叠记忆（localStorage）、挂卸。
 * @jest-environment jsdom
 */

import {
  clampToCanvas,
  defineStratMinimap,
  hitTestUnit,
  MINIMAP_COLLAPSED_KEY,
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
import { WORLD_BOUNDS } from '../../core/types';

/** 默认尺寸（200×150）下世界 3200×2400 恰好铺满（scale=1/16，无 letterbox）。 */
const SIZE = { width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX };

/** canvas 2d 上下文 stub：记录绘制调用（jsdom 没有 canvas，mock 模式参照 appearance fakes）。 */
interface CtxStub {
  readonly clearRect: jest.Mock;
  readonly fillRect: jest.Mock;
  readonly strokeRect: jest.Mock;
  readonly beginPath: jest.Mock;
  readonly arc: jest.Mock;
  readonly fill: jest.Mock;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
}

function createCtxStub(): CtxStub {
  return {
    clearRect: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    beginPath: jest.fn(),
    arc: jest.fn(),
    fill: jest.fn(),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
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
  test('四角与中心：默认尺寸下世界恰好铺满（scale=1/16）', () => {
    expect(worldToMinimap({ x: 0, y: 0 }, SIZE)).toEqual({ x: 0, y: 0 });
    expect(worldToMinimap({ x: WORLD_BOUNDS.width, y: WORLD_BOUNDS.height }, SIZE)).toEqual({
      x: MINIMAP_WIDTH_PX,
      y: MINIMAP_HEIGHT_PX,
    });
    expect(worldToMinimap({ x: 1600, y: 1200 }, SIZE)).toEqual({ x: 100, y: 75 });
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
    expect(clampToCanvas({ x: 999, y: 999 }, SIZE)).toEqual({ x: 200, y: 150 });
  });
});

describe('点命中检测', () => {
  const units: MinimapUnit[] = [
    { id: 'u1', x: 1600, y: 1200 }, // → 画布 (100, 75)
    { id: 'u2', x: 0, y: 0 }, // → 画布 (0, 0)
  ];

  test('命中半径内（比点半径大一圈）：返回单位 id', () => {
    expect(hitTestUnit({ x: 100, y: 75 }, units, SIZE)).toBe('u1');
    expect(hitTestUnit({ x: 100 + 7, y: 75 }, units, SIZE)).toBe('u1'); // 命中半径 8px
  });

  test('半径外 → null', () => {
    expect(hitTestUnit({ x: 100 + 9, y: 75 }, units, SIZE)).toBeNull();
    expect(hitTestUnit({ x: 30, y: 30 }, units, SIZE)).toBeNull();
  });

  test('重叠点：数组后面的（画在顶层）优先命中', () => {
    const overlapped: MinimapUnit[] = [
      { id: 'bottom', x: 1600, y: 1200 },
      { id: 'top', x: 1632, y: 1200 }, // 画布上相距 2px —— 都在命中半径内
    ];
    expect(hitTestUnit({ x: 100, y: 75 }, overlapped, SIZE)).toBe('top');
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

    // 语义面：视口框（fill + stroke 各一次）+ 两个单位点（arc × 2）
    expect(ctx.fillRect).toHaveBeenCalledTimes(1);
    expect(ctx.strokeRect).toHaveBeenCalledTimes(1);
    expect(ctx.arc).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
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

  test('点空地 → 只发 camera.center（世界坐标按 1/16 换算，core 侧再钳制）', () => {
    const { el, commands } = host();
    fire(el, 'pointerdown', 100, 75); // 画布中心 → 世界中心

    expect(commands).toEqual([{ type: 'camera.center', x: 1600, y: 1200 }]);
  });

  test('点单位点 → 先 unit.select(set) 再 camera.center（跳过去看它）', () => {
    const { el, commands } = host();
    el.setUnits([{ id: 'u1', x: 1600, y: 1200, skinId: 'forest' }]);
    fire(el, 'pointerdown', 100, 75);

    expect(commands[0]).toEqual({ type: 'unit.select', unitIds: ['u1'], mode: 'set' });
    expect(commands[1]).toEqual({ type: 'camera.center', x: 1600, y: 1200 });
  });

  test('拖拽 → 连续 camera.center；松手后停止；未按下时 move 不发', () => {
    const { el, commands } = host();

    fire(el, 'pointermove', 10, 10); // 未按下：纯 hover，不发
    expect(commands).toHaveLength(0);

    fire(el, 'pointerdown', 0, 0);
    fire(el, 'pointermove', 50, 37.5);
    fire(el, 'pointermove', 100, 75);
    fire(el, 'pointerup', 100, 75);
    fire(el, 'pointermove', 120, 90); // 已松手：不再发

    const centers = commands.filter((c) => c.type === 'camera.center');
    expect(centers).toHaveLength(3); // down + 两次 move
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
// 折叠记忆（localStorage）
// ============================================================================

describe('组件：折叠与记忆', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="mm-host"></div>';
    try {
      localStorage.clear();
    } catch {
      /* ignore */
    }
  });

  test('默认展开；点折叠钮 → 收起 + localStorage 记忆；再点 → 展开 + 记忆清除位', () => {
    const { el } = host();
    expect(el.collapsed).toBe(false);

    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="toggle"]')?.click();
    expect(el.collapsed).toBe(true);
    expect(localStorage.getItem(MINIMAP_COLLAPSED_KEY)).toBe('1');
    expect(el.hasAttribute('data-collapsed')).toBe(true);

    el.shadowRoot?.querySelector<HTMLButtonElement>('[data-role="toggle"]')?.click();
    expect(el.collapsed).toBe(false);
    expect(localStorage.getItem(MINIMAP_COLLAPSED_KEY)).toBe('0');
    expect(el.hasAttribute('data-collapsed')).toBe(false);
  });

  test('重挂读取记忆：上次收起 → 新元素初始即收起', () => {
    localStorage.setItem(MINIMAP_COLLAPSED_KEY, '1');
    const { el } = host();
    expect(el.collapsed).toBe(true);
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
    expect(commands).toEqual([{ type: 'camera.center', x: 800, y: 800 }]);

    unmount();
    expect(container.querySelector(MINIMAP_TAG)).toBeNull();
  });
});
