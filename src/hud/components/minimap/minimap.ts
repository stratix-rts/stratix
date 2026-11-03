/**
 * 文件职责：**小地图** Web Component（`<strat-minimap>`，task_057；v3.3 视觉升级 task_079）——
 *   战场缩略图（右下角 200×120）：
 *   岛屿轮廓（纯代码绘制的多边形，「项目 = 岛屿」隐喻）+ 单位状态光点（按状态着色）
 *   + 当前视野白框 + 外框描边 + 「MAP」角标；
 *   视口矩形（相机事件驱动刷新）；点击单位点 = 选中该单位（unit.select），
 *   点击 / 拖拽任意处 = 相机对中该世界点（camera.center 命令，core 钳制后转发 world 落位）。
 *   **固定展开**（@since v3.5，task_098）：200×120 常驻展开 —— 不折叠、不自动收起。
 *   折叠按钮与折叠记忆（localStorage `stratix.minimap.collapsed`）已整体解除：
 *   任何场景（hover / L3 演出 / 全屏弹窗 / 窄屏）下都保持展开态。
 * 输入：注入的 ports.dispatch（命令出口 —— 组合根喂 adapter.dispatch，组件零 import core/bus）；
 *   setUnits(snapshot) / setViewport(rect)（数据入口 —— 组合根从 WorldState + unit.position /
 *   camera.moved 事件喂；**hud 不 import world**，坐标语义见各口注记）。
 * 输出：Shadow DOM 画布（fixed 右下角）；点击 → unit.select / camera.center 命令。
 * 禁止事项：
 *   1. import world/、app/、phaser、任何 UI 库 —— 铁律（kind→色用 core/theme 的皮肤登记表，
 *      与 world/theme.resolveUnitColor 同一来源，绝不在 hud 再抄一份色表）；
 *   2. 直接 import core/bus 发命令 —— 一律走注入的 ports.dispatch（组合根接线，见 main-entry）；
 *   3. innerHTML 写外部输入 —— 本组件没有文本外部输入；单位色值只进 canvas 绘制调用；
 *   4. 泄漏监听 —— 元素离场（disconnectedCallback）时交互态复位；画布监器随 Shadow DOM
 *      一并销毁，无全局 / 定时器资源；
 *   5. 硬编码皮肤色 —— 视觉 token 走 --srf-*（jsdom 拿不到时回落内联常量，与皮肤默认值同源）。
 *
 * ============ 坐标口径 ============
 * 世界 → 画布：WORLD_BOUNDS（core/types 契约常量，与 world 相机钳制同一份）等比缩放进
 * 200×120 画布（letterbox 居中 —— 宽高比不一致时留边，不拉伸）；逆映射同理。
 * 点击坐标由 clientX/Y − 画布 rect 换算（jsdom 不实现 offsetX，这条路两边都能跑）。
 *
 * ============ 数据流（组件只认注入口）============
 * 单位：组合根喂 {id, x, y, skinId, online, status} 快照 —— 位置真相在世界（core 契约无坐标），
 *   组合根从 unit.position 事件 + 恢复站位累积，见 main-entry 的接线注；
 * 视口：组合根从 camera.moved（center + zoom）+ 战场容器尺寸换算出世界坐标矩形喂入。
 *
 * @since v3.33（task_057）；@since v3.3（task_079：尺寸 200×120 / 岛屿轮廓 / 状态光点 /
 *   视野白框 / 外框描边 / MAP 角标）；@since v3.4（task_093：hover 提升亮度 + 过渡，
 *   贴边留边提为常量 MINIMAP_METRICS.cornerMarginPx —— 与事件轨同一口径，
 *   Z3 与 Z4 的「≥40px 间距」才推得出来）；@since v3.5（task_098：**固定展开** ——
 *   折叠按钮 / 折叠记忆 / 折叠态 DOM 全解除，只剩「常驻展开」一条路）。
 */

import { resolveAccent } from '../../../core/theme/skin-registry';
import { MINIMAP_METRICS, VISUAL_PALETTE } from '../../../core/theme/visual-spec';
import { WORLD_BOUNDS } from '../../../core/types';
import type { Bounds, HudCommand, Point, UnitStatus } from '../../../core/types';

export const MINIMAP_TAG = 'strat-minimap';

/** 画布逻辑尺寸（CSS px = canvas px；数值取自唯一事实源 core/theme/visual-spec 的 MINIMAP_METRICS）。 */
export const MINIMAP_WIDTH_PX = MINIMAP_METRICS.widthPx;
export const MINIMAP_HEIGHT_PX = MINIMAP_METRICS.heightPx;

/** 单位点半径（画布 px）。 */
const DOT_RADIUS_PX = MINIMAP_METRICS.dotRadiusPx;
/** 点击命中半径（画布 px）：比点本身大一圈 —— 缩略图上按像素级命中的体验不可用。 */
const HIT_RADIUS_PX = MINIMAP_METRICS.hitRadiusPx;

/**
 * 视野白框的描边色（纯白）。
 * why 不在调色板里取：调色板七色都是**语义色**（单位 / 进度 / 完成 / 报错 / 装饰），
 *   「当前视野」是中性参照物（不是状态），规格钦定白框 —— 故此处是唯一的一处中性白，
 *   不另立语义色（不污染唯一事实源的语义色表）。
 */
const VIEWPORT_STROKE_COLOR = '#ffffff';

/** 无皮肤单位的兜底色（与 world/theme 的 DEFAULT_UNIT_COLOR 同值 —— 两侧同源注记）。 */
const NEUTRAL_DOT_COLOR = '#94a3b8';
/** jsdom / 无 token 环境的回落值（与 tokens-default.css 的默认值同源）。 */
const FALLBACK_DISABLED = '#5a6373';

/**
 * 岛屿轮廓的归一化点列（0-1，绕行一周）—— 「项目 = 岛屿」隐喻的缩略图轮廓。
 * why 固定点列而不是随机生成：缩略图每次重绘都得是同一座岛（随机会让岛每次都在变形）。
 */
const ISLAND_OUTLINE: readonly Point[] = Object.freeze([
  { x: 0.06, y: 0.30 },
  { x: 0.12, y: 0.14 },
  { x: 0.30, y: 0.06 },
  { x: 0.50, y: 0.10 },
  { x: 0.70, y: 0.08 },
  { x: 0.88, y: 0.18 },
  { x: 0.96, y: 0.36 },
  { x: 0.92, y: 0.56 },
  { x: 0.97, y: 0.74 },
  { x: 0.82, y: 0.92 },
  { x: 0.60, y: 0.96 },
  { x: 0.40, y: 0.92 },
  { x: 0.22, y: 0.94 },
  { x: 0.08, y: 0.80 },
  { x: 0.03, y: 0.58 },
  { x: 0.09, y: 0.44 },
]);

/** 小地图会发出的命令面（Extract 保持与契约同步 —— 新增字段不改这里）。 */
export type MinimapDispatchCommand = Extract<HudCommand, { type: 'unit.select' | 'camera.center' }>;

/** 命令出口：组合根注入 adapter.dispatch（组件对总线零直接依赖）。 */
export interface MinimapPorts {
  readonly dispatch: (command: MinimapDispatchCommand) => void;
}

/**
 * 单位点快照（组合根喂入）。位置是世界坐标（真相经组合根从 unit.position 事件累积）；
 * skinId / online / status 的语义与 UnitView 契约一致（缺省 online = 在线）。
 * status 用于**按状态着色**的光点（v3.3 / task_079）；缺省时退回皮肤徽标色。
 */
export interface MinimapUnit {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly skinId?: string | null;
  readonly online?: boolean;
  /** 单位忙闲（idle / busy / offline / error）—— 缺省 = 未知，按皮肤色画。 */
  readonly status?: UnitStatus;
}

/** 画布尺寸（纯函数入参，测试可注入任意值）。 */
export interface MinimapSize {
  readonly width: number;
  readonly height: number;
}

// ============================================================================
// 纯函数：世界 ↔ 画布映射（独立导出，单测直打）
// ============================================================================

/** 世界矩形等比缩放进画布的参数（letterbox 居中：宽高比不一致留边，不拉伸）。 */
function fitParams(size: MinimapSize): { scale: number; offsetX: number; offsetY: number } {
  const scale = Math.min(
    size.width / WORLD_BOUNDS.width,
    size.height / WORLD_BOUNDS.height
  );
  return {
    scale,
    offsetX: (size.width - WORLD_BOUNDS.width * scale) / 2,
    offsetY: (size.height - WORLD_BOUNDS.height * scale) / 2,
  };
}

/** 世界点 → 画布 px（越界点如实映射出画布 —— 钳制是调用方的显式选择，不在这里藏着做）。 */
export function worldToMinimap(point: Point, size: MinimapSize): Point {
  const { scale, offsetX, offsetY } = fitParams(size);
  return {
    x: offsetX + (point.x - WORLD_BOUNDS.x) * scale,
    y: offsetY + (point.y - WORLD_BOUNDS.y) * scale,
  };
}

/**
 * 画布 px → 世界点（逆映射）。scale 非正（画布零尺寸）→ 世界中心（坏输入回落安全位，
 * 与 core/camera 的钳制回落同口径；core 侧还会再钳一道，这里只保证不吐 NaN/Infinity）。
 */
export function minimapToWorld(point: Point, size: MinimapSize): Point {
  const { scale, offsetX, offsetY } = fitParams(size);
  if (!(scale > 0) || !Number.isFinite(scale)) {
    return { x: WORLD_BOUNDS.x + WORLD_BOUNDS.width / 2, y: WORLD_BOUNDS.y + WORLD_BOUNDS.height / 2 };
  }
  return {
    x: WORLD_BOUNDS.x + (point.x - offsetX) / scale,
    y: WORLD_BOUNDS.y + (point.y - offsetY) / scale,
  };
}

/** 把画布点钳回画布内（拖拽出界的兜底 —— 点击换算前先收进来，交互手感才不「点出图」）。 */
export function clampToCanvas(point: Point, size: MinimapSize): Point {
  return {
    x: Math.min(size.width, Math.max(0, point.x)),
    y: Math.min(size.height, Math.max(0, point.y)),
  };
}

/**
 * 点命中检测：命中返回单位 id，未命中返回 null。
 * 遍历**倒序**（数组后面的画在顶层 —— 与 draw 的绘制顺序一致，重叠点命中视觉最上层）。
 */
export function hitTestUnit(at: Point, units: readonly MinimapUnit[], size: MinimapSize): string | null {
  for (let i = units.length - 1; i >= 0; i -= 1) {
    const dot = worldToMinimap(units[i], size);
    if (Math.hypot(at.x - dot.x, at.y - dot.y) <= HIT_RADIUS_PX) return units[i].id;
  }
  return null;
}

/** CSS 十六进制（#rrggbb）→ rgba(...)；解析不了回落默认主色（视口框色调不因坏 token 消失）。 */
function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(110, 168, 255, ${alpha})`;
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ============================================================================
// Web Component
// ============================================================================

/** 元素对外形状（组合根与测试按它操作）。 */
export interface StratMinimapElement extends HTMLElement {
  /** 命令出口（组合根注入；未注入时交互命令被丢弃 —— 组件仍可被动渲染）。 */
  ports: MinimapPorts | null;
  /** 单位快照喂入口（组合根从 WorldState + 位置累积喂）。 */
  setUnits(units: readonly MinimapUnit[]): void;
  /** 视口矩形喂入口（世界坐标；null = 未知视口，不画框）。 */
  setViewport(rect: Bounds | null): void;
  // —— 观察口（测试 / 调试断言用，不外泄渲染内部态）——
  readonly unitCount: number;
  readonly viewport: Bounds | null;
  /** 重绘计数（测试断言「喂入必重绘」；不跨挂卸清零）。 */
  readonly drawCount: number;
}

/**
 * 工厂：注册 `<strat-minimap>`。
 * 幂等（与 defineToastHost / defineTaskOutputPanel 同约定）：重复 register 返回已注册构造器。
 */
export function defineStratMinimap(): typeof HTMLElement {
  if (customElements.get(MINIMAP_TAG)) {
    return customElements.get(MINIMAP_TAG) as unknown as typeof HTMLElement;
  }

  class StratMinimap extends HTMLElement implements StratMinimapElement {
    private _ports: MinimapPorts | null = null;
    private _units: readonly MinimapUnit[] = [];
    private _viewport: Bounds | null = null;
    private _drawCount = 0;
    private _dragging = false;
    private _domBuilt = false;

    // —— 属性面 ——
    get ports(): MinimapPorts | null { return this._ports; }
    set ports(value: MinimapPorts | null) { this._ports = value; }

    get unitCount(): number { return this._units.length; }
    get viewport(): Bounds | null { return this._viewport; }
    get drawCount(): number { return this._drawCount; }

    connectedCallback(): void {
      if (!this._domBuilt) {
        this._domBuilt = true;
        this.buildDom();
      }
      // 固定展开（@since v3.5，task_098）：这里**不再读任何折叠记忆** ——
      // 挂载即展开，唯一状态就是「展开」。
      this.draw();
    }

    disconnectedCallback(): void {
      // 交互态复位：重挂（元素复用）不携带上一次的拖拽残留。
      this._dragging = false;
    }

    setUnits(units: readonly MinimapUnit[]): void {
      this._units = [...units];
      this.draw();
    }

    setViewport(rect: Bounds | null): void {
      this._viewport = rect;
      this.draw();
    }

    // ==========================================================================
    // DOM 构建
    // ==========================================================================

    private buildDom(): void {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            position: fixed;
            right: ${MINIMAP_METRICS.cornerMarginPx}px;
            bottom: ${MINIMAP_METRICS.cornerMarginPx}px;
            z-index: 45; /* 抽屉(40)之上、toast(50)之下：控制件，不遮反馈层 */
            pointer-events: auto; /* hud-root 整层 none，本组件自接交互 */
            font-family: var(--srf-font-ui);
          }
          .frame {
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            background: var(--srf-panel);
            box-shadow: var(--srf-shadow-lg);
            overflow: hidden;
            line-height: 1;
            /* hover 提亮要有过渡（Z3 规格「hover 提升亮度」）——
               只动 filter（合成层属性），不触发布局重排（性能铁律）。 */
            transition: filter ${MINIMAP_METRICS.hoverTransitionMs}ms ease;
          }
          :host(:hover) .frame { filter: brightness(${MINIMAP_METRICS.hoverBrightness}); }
          .head {
            display: flex;
            align-items: center;
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            border-bottom: var(--srf-border-width) solid var(--srf-border);
          }
          .label { font-size: var(--srf-font-size-xs); color: var(--srf-text-muted); font-weight: var(--srf-font-weight-semibold); user-select: none; }
          canvas { display: block; touch-action: none; }
        </style>
        <div class="frame" part="frame">
          <div class="head">
            <span class="label">小地图</span>
          </div>
          <canvas data-role="canvas" width="${MINIMAP_WIDTH_PX}" height="${MINIMAP_HEIGHT_PX}"
                  role="img" aria-label="战场小地图"></canvas>
        </div>
      `;

      const canvas = this.canvas();
      canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event));
      canvas.addEventListener('pointermove', (event) => this.onPointerMove(event));
      canvas.addEventListener('pointerup', () => this.endDrag());
      canvas.addEventListener('pointercancel', () => this.endDrag());
    }

    private canvas(): HTMLCanvasElement {
      return this.shadowRoot?.querySelector('[data-role="canvas"]') as HTMLCanvasElement;
    }

    // ==========================================================================
    // 交互：点击 / 拖拽 → 命令（经注入的 ports.dispatch）
    // ==========================================================================

    /** 事件坐标 → 画布 px（clientX/Y − rect；jsdom 无 offsetX，这条路两侧都能跑）。 */
    private eventToCanvasPoint(event: PointerEvent): Point {
      const rect = this.canvas().getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }

    private onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;
      const size = this.canvasSize();
      const at = clampToCanvas(this.eventToCanvasPoint(event), size);
      // 命中单位点 = 选中（规格③：点选）；同一按下也发跳转 —— 点了单位就跳过去看它，RTS 惯例。
      const hit = hitTestUnit(at, this._units, size);
      if (hit !== null) {
        this._ports?.dispatch({ type: 'unit.select', unitIds: [hit], mode: 'set' });
      }
      this.dispatchCenter(at);
      this._dragging = true;
      // 指针捕获：拖出画布仍持续收到 move（jsdom 无此 API 时静默降级 —— 事件仍会冒泡到画布）。
      this.canvas().setPointerCapture?.(event.pointerId);
    }

    private onPointerMove(event: PointerEvent): void {
      if (!this._dragging) return;
      this.dispatchCenter(clampToCanvas(this.eventToCanvasPoint(event), this.canvasSize()));
    }

    private endDrag(): void {
      this._dragging = false;
    }

    private canvasSize(): MinimapSize {
      return { width: MINIMAP_WIDTH_PX, height: MINIMAP_HEIGHT_PX };
    }

    /** 画布点 → 世界点 → camera.center 命令（core 会钳进世界边界；这里只管如实换算）。 */
    private dispatchCenter(at: Point): void {
      const world = minimapToWorld(at, this.canvasSize());
      this._ports?.dispatch({ type: 'camera.center', x: world.x, y: world.y });
    }

    // ==========================================================================
    // 绘制
    // ==========================================================================

    /** 皮肤 token 读取（jsdom 拿不到自定义属性 → 回落默认值，与 tokens-default 同源）。 */
    private token(name: string, fallback: string): string {
      const value = getComputedStyle(this).getPropertyValue(name).trim();
      return value.length > 0 ? value : fallback;
    }

    /** 重绘：喂入 / 折叠展开时调用；jsdom 无 2d 上下文时跳过绘制（数据面仍可断言）。 */
    private draw(): void {
      this._drawCount += 1;
      const canvas = this.canvas();
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const size = this.canvasSize();
      ctx.clearRect(0, 0, size.width, size.height);
      // 层次：岛屿（底）→ 视野白框（中）→ 单位光点（顶）→ 外框与角标（最上层装饰）。
      this.drawIsland(ctx, size);
      this.drawViewport(ctx, size);
      this.drawUnits(ctx, size);
      this.drawFrame(ctx, size);
      this.drawBadge(ctx);
    }

    /** 世界矩形在画布上的位置（letterbox 后的实际占位）—— 岛屿轮廓贴着它画。 */
    private worldRect(size: MinimapSize): Bounds {
      const { scale, offsetX, offsetY } = fitParams(size);
      return {
        x: offsetX,
        y: offsetY,
        width: WORLD_BOUNDS.width * scale,
        height: WORLD_BOUNDS.height * scale,
      };
    }

    /**
     * 岛屿轮廓：一条闭合多边形（淡填充 + 描边）—— 「项目 = 岛屿」在缩略图上的样子。
     * why 画在世界矩形的**内缩**里：轮廓是岛，矩形是画布，两者不该完全重合（重合就成了边框）。
     */
    private drawIsland(ctx: CanvasRenderingContext2D, size: MinimapSize): void {
      const rect = this.worldRect(size);
      const insetX = rect.width * 0.04;
      const insetY = rect.height * 0.08;
      const accent = this.token('--srf-visual-accent', VISUAL_PALETTE.accent);

      ctx.beginPath();
      ISLAND_OUTLINE.forEach((point, index) => {
        const x = rect.x + insetX + point.x * (rect.width - insetX * 2);
        const y = rect.y + insetY + point.y * (rect.height - insetY * 2);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = hexToRgba(accent, MINIMAP_METRICS.islandFillAlpha);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(accent, MINIMAP_METRICS.islandStrokeAlpha);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    /** 视口矩形（世界坐标）：半透明填充 + **白框** —— 相机在哪、看多大，一眼可读。 */
    private drawViewport(ctx: CanvasRenderingContext2D, size: MinimapSize): void {
      const rect = this._viewport;
      if (!rect) return;
      const { scale } = fitParams(size);
      const at = worldToMinimap({ x: rect.x, y: rect.y }, size);
      ctx.fillStyle = hexToRgba(VIEWPORT_STROKE_COLOR, MINIMAP_METRICS.viewportFillAlpha);
      ctx.fillRect(at.x, at.y, rect.width * scale, rect.height * scale);
      ctx.strokeStyle = VIEWPORT_STROKE_COLOR;
      ctx.lineWidth = MINIMAP_METRICS.viewportStrokeWidthPx;
      ctx.strokeRect(at.x, at.y, rect.width * scale, rect.height * scale);
    }

    /**
     * 单位光点：**按状态着色**（v3.3 / task_079）—— 忙 / 错 / 离线一眼可辨；
     * 离线灰显（054 同语义）；状态未知时退回皮肤徽标色（core/theme 登记表）。
     */
    private drawUnits(ctx: CanvasRenderingContext2D, size: MinimapSize): void {
      for (const unit of this._units) {
        const at = worldToMinimap(unit, size);
        ctx.beginPath();
        ctx.arc(at.x, at.y, DOT_RADIUS_PX, 0, Math.PI * 2);
        ctx.fillStyle = this.dotColor(unit);
        ctx.fill();
      }
    }

    /** 单位光点颜色：离线 > 状态 > 皮肤 > 中性灰（优先级从上到下）。 */
    private dotColor(unit: MinimapUnit): string {
      if (unit.online === false) return this.token('--srf-text-disabled', FALLBACK_DISABLED);
      switch (unit.status) {
        case 'busy':
          return this.token('--srf-visual-progress', VISUAL_PALETTE.progress);
        case 'error':
          return this.token('--srf-visual-danger', VISUAL_PALETTE.danger);
        case 'offline':
          return this.token('--srf-text-disabled', FALLBACK_DISABLED);
        case 'idle':
          return this.token('--srf-visual-unit', VISUAL_PALETTE.unit);
        default:
          return unit.skinId ? resolveAccent(unit.skinId) : NEUTRAL_DOT_COLOR;
      }
    }

    /** 外框描边：小地图自己的画框（与 HUD 面板的边框叠在一起更清楚）。 */
    private drawFrame(ctx: CanvasRenderingContext2D, size: MinimapSize): void {
      const inset = MINIMAP_METRICS.frameInsetPx;
      ctx.strokeStyle = this.token('--srf-visual-accent', VISUAL_PALETTE.accent);
      ctx.lineWidth = MINIMAP_METRICS.frameStrokeWidthPx;
      ctx.strokeRect(inset, inset, size.width - inset * 2, size.height - inset * 2);
    }

    /** 「MAP」角标：左上角的小字，标明这是小地图（规格钦定）。 */
    private drawBadge(ctx: CanvasRenderingContext2D): void {
      const inset = MINIMAP_METRICS.frameInsetPx;
      ctx.font = `${MINIMAP_METRICS.badgeFontPx}px monospace`;
      ctx.textBaseline = 'top';
      ctx.fillStyle = this.token('--srf-visual-accent', VISUAL_PALETTE.accent);
      ctx.fillText(MINIMAP_METRICS.badgeText, inset + 4, inset + 3);
    }
  }

  customElements.define(MINIMAP_TAG, StratMinimap);
  return StratMinimap as unknown as typeof HTMLElement;
}

// ============================================================================
// 挂载工厂
// ============================================================================

/**
 * 挂载工厂（仓库统一装配口径，与 mountToastHost 一致）：建元素、注入 ports、挂进容器。
 * 组合根（main-entry）用它装配；测试直接 document.createElement + 赋 ports 亦可。
 */
export function mountMinimap(host: HTMLElement, ports: MinimapPorts): {
  element: StratMinimapElement;
  unmount: () => void;
} {
  defineStratMinimap();
  const element = document.createElement(MINIMAP_TAG) as StratMinimapElement;
  element.ports = ports;
  host.appendChild(element);
  return {
    element,
    unmount: () => {
      element.remove();
    },
  };
}
