/**
 * 文件职责：**模式状态条**（@since v3.6，task_117）——
 *   顶栏正下方的一条全局细条：演示模式（▶）/ 导演镜头（🎬）任一开启时亮出，
 *   写清「开着的是什么 + 怎么关」，点它即可退出对应模式。
 *   为什么要有（死功能报告 P3#9 / P3#10 的原症状）：
 *     ① 演示模式：点开只有 localStorage 里多了个 'on' —— 画面 0 变化、无状态指示，
 *        刷新后仍然静默生效，用户既不知道开了、也不知道从哪儿关；
 *     ② 导演镜头：点开只有战场里多了一小片取景框，没有任何文字说明它是什么、开没开。
 *   本组件是这两个开关**唯一的全局指示位**：顶栏按钮的「点亮即状态」只回答"开没开"，
 *   回答不了"这是什么 / 怎么关"（§4 A13 不许把开关状态再抄一遍文字 —— 那是**开关旁**的标签，
 *   本条是**独立于顶栏控件**的全局提示，不是同一处的第二次表达）。
 * 输入：两个端口（真相各自唯一，组件不存第二份）：
 *   演示态 —— hud/theme/demo-mode.ts 的单例（本地展示态 + localStorage 记忆）；
 *   导演态 —— core 广播的 WorldState.directorEnabled（core 是唯一真相）。
 * 输出：Shadow DOM 细条（无模式时整条隐藏）+ 根上的 --srf-mode-strip-h（版面让位）。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core 与注入的端口；
 *   2. 自己存一份「开着吗」—— 两个端口各自是真相，本组件只呈现；
 *   3. 硬编码颜色 —— 一律引用 --srf-* token；
 *   4. 泄漏订阅 —— disconnectedCallback 必须退订（perf 硬约束）；
 *   5. 直接改 WorldState —— 退出导演镜头发的是 HudCommand（camera.director），
 *      由 core 裁决后广播回来（铁律：HUD 不直接操控 world）。
 *
 * ============ 版面口径 ============
 *   细条挂在 **#hud-side**（覆盖层容器，pointer-events:none，JS 永不重写）——
 *   why 不挂 #hud-root：主屏每次重绘都 `host.innerHTML = ...` 重写 #hud-root，
 *   挂里面的东西当场被抹掉（与 task_084 逮到的回放角标同一个坑）。
 *   纵向位置 = 顶栏下沿（顶栏高度取 core/theme/visual-spec.ts 的唯一事实源
 *   TOPBAR_METRICS.heightPx）；下方版面（左右竖栏 / 网关横幅 / 回放角标）整体让位
 *   `--srf-mode-strip-h` —— 细条亮出时由本组件在 <html> 上写这个变量，
 *   读方各让各的（main-screen 的竖栏 / gateway-banner / replay-clock）。
 */

import { TOPBAR_METRICS } from '../../../core/theme/visual-spec';
// 图标组（@since v3.6，task_121）：细条上的两个图标从 emoji（▶ / 🎬）换成 SVG ——
//   emoji 是字形不是图标，跟线条风对不上；SVG 走 currentColor → 自动继承条目的语义色
//   （演示 = 主色 / 导演 = 警示色），不另抄一份色值。
import { iconSvg } from '../../widgets/icon-set';
import { zVar } from '../../theme/layer-tokens';

export const MODE_STRIP_TAG = 'strat-mode-strip';

/** 细条高度（px）—— 顶栏下沿 → 细条下沿。 */
export const MODE_STRIP_HEIGHT_PX = 22;

/** 版面让位变量（写在 <html> 上；下方版面读它整体下移）。 */
export const MODE_STRIP_CSS_VAR = '--srf-mode-strip-h';

/** 打在 <html> 上的标记（值 'on'）—— 调试与 e2e 断言用。 */
export const MODE_STRIP_ATTRIBUTE = 'data-srf-mode-strip';

/** 细条文案（人话：是什么 + 怎么关）。 */
export const MODE_STRIP_DEMO_LABEL = '演示模式运行中';
export const MODE_STRIP_DIRECTOR_LABEL = '导演镜头 ON';
/** 退出提示（两项共用）—— 点了就是关。 */
export const MODE_STRIP_HINT = '· 点击退出';
/** 整条文案（e2e / 单测按它断言）。 */
export const MODE_STRIP_DEMO_TEXT = `${MODE_STRIP_DEMO_LABEL} ${MODE_STRIP_HINT}`;
export const MODE_STRIP_DIRECTOR_TEXT = `${MODE_STRIP_DIRECTOR_LABEL} ${MODE_STRIP_HINT}`;

/** 演示模式端口（HUD 侧的本地展示态 —— 真源是 demo-mode 单例）。 */
export interface ModeStripDemoPort {
  /** 当前是否开启（首次读取时从 localStorage 恢复）。 */
  readonly enabled: boolean;
  /** 订阅开关变化；返回退订函数。 */
  subscribe(listener: (enabled: boolean) => void): () => void;
  /** 设置开关（写入 localStorage 记忆 + 应用副作用）。 */
  set(enabled: boolean): void;
}

/** 导演镜头端口（真相在 core —— WorldState.directorEnabled）。 */
export interface ModeStripDirectorPort {
  /** 当前是否开启（读 core 广播的那一份）。 */
  readonly enabled: boolean;
  /** 订阅变化；返回退订函数。 */
  subscribe(listener: (enabled: boolean) => void): () => void;
  /** 退出导演镜头 —— 发关闭命令给 core（core 裁决后广播回来，本组件不直接改状态）。 */
  disable(): void;
}

/** 组件对外形状（测试与装配方按它断言）。 */
export interface StratModeStripElement extends HTMLElement {
  /** 演示模式端口（组合根注入；null = 没有端口 → 该项不显示）。 */
  demo?: ModeStripDemoPort | null;
  /** 导演镜头端口（组合根注入；null = 没有端口 → 该项不显示）。 */
  director?: ModeStripDirectorPort | null;
  /** 当前细条是否可见（观察口）。 */
  readonly visible: boolean;
}

export function defineStratModeStrip(): typeof HTMLElement {
  if (customElements.get(MODE_STRIP_TAG)) {
    return customElements.get(MODE_STRIP_TAG) as unknown as typeof HTMLElement;
  }

  class ModeStrip extends HTMLElement implements StratModeStripElement {
    private _demo: ModeStripDemoPort | null = null;
    private _director: ModeStripDirectorPort | null = null;
    private _unsubscribes: Array<() => void> = [];
    private _root: HTMLElement | null = null;
    private _visible = false;

    get demo(): ModeStripDemoPort | null {
      return this._demo;
    }

    set demo(value: ModeStripDemoPort | null) {
      this._demo = value;
      this.rebind();
    }

    get director(): ModeStripDirectorPort | null {
      return this._director;
    }

    set director(value: ModeStripDirectorPort | null) {
      this._director = value;
      this.rebind();
    }

    get visible(): boolean {
      return this._visible;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          :host {
            all: initial;
            position: absolute;
            /* 顶栏下沿 —— 顶栏高度取唯一事实源（core/theme/visual-spec.ts）。 */
            top: ${TOPBAR_METRICS.heightPx}px;
            left: 0;
            right: 0;
            z-index: ${zVar('strip')};
            pointer-events: none;
            font-family: var(--srf-font-ui, system-ui, -apple-system, sans-serif);
          }
          .strip {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-sm, 8px);
            height: ${MODE_STRIP_HEIGHT_PX}px;
            box-sizing: border-box;
            padding: 0 var(--srf-spacing-md, 12px);
            background: var(--srf-panel-overlay, rgba(24, 28, 37, 0.88));
            border-bottom: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            color: var(--srf-text, #e6e9ef);
            font-size: var(--srf-font-size-xs, 11px);
            line-height: var(--srf-line-height, 1.4);
            pointer-events: auto;
          }
          .strip[hidden] { display: none; }
          .item {
            display: inline-flex;
            align-items: center;
            gap: var(--srf-spacing-xs, 4px);
            font: inherit;
            font-weight: var(--srf-font-weight-semibold, 600);
            color: var(--srf-accent, #6ea8ff);
            background: transparent;
            border: var(--srf-border-width, 1px) solid transparent;
            border-radius: var(--srf-radius-pill, 999px);
            padding: 0 var(--srf-spacing-sm, 8px);
            cursor: pointer;
            white-space: nowrap;
          }
          .item[hidden] { display: none; }
          .icon { display: inline-flex; align-items: center; }
          /* 图标硬笔（@since v3.7，task_128）：像素皮 2px + crispEdges，现代皮兜底 1.5px（零变化）。 */
          .icon svg {
            width: 1.15em;
            height: 1.15em;
            display: block;
            stroke-width: var(--srf-icon-stroke, 1.5);
            shape-rendering: var(--srf-icon-rendering, geometricPrecision);
          }
          .item:hover { background: color-mix(in srgb, var(--srf-accent, #6ea8ff) 18%, transparent); }
          .item:focus-visible {
            outline: var(--srf-border-width, 1px) solid var(--srf-accent, #6ea8ff);
            outline-offset: 1px;
          }
          /* 导演镜头用警示色 —— 与演示模式（主色）一眼分得开是哪条在亮。 */
          .item[data-mode="director"] { color: var(--srf-warn, #f0c674); }
          .item[data-mode="director"]:hover { background: color-mix(in srgb, var(--srf-warn, #f0c674) 18%, transparent); }
          .hint { color: var(--srf-text-muted, #9aa3b2); font-weight: 400; }
        </style>
        <div class="strip" data-role="mode-strip" role="status" aria-live="polite" hidden>
          <!-- label 与 hint 之间那个空格：flex 容器里纯空白的匿名项不渲染（不撑版面），
               但 textContent 里保留 —— e2e / 单测按整句文案断言时能对上。 -->
          <button class="item" type="button" data-role="mode-item" data-mode="demo" hidden>
            <span class="icon" aria-hidden="true">${iconSvg('demo')}</span><span class="label">${MODE_STRIP_DEMO_LABEL}</span> <span class="hint">${MODE_STRIP_HINT}</span>
          </button>
          <button class="item" type="button" data-role="mode-item" data-mode="director" hidden>
            <span class="icon" aria-hidden="true">${iconSvg('director')}</span><span class="label">${MODE_STRIP_DIRECTOR_LABEL}</span> <span class="hint">${MODE_STRIP_HINT}</span>
          </button>
        </div>
      `;
      this._root = root.querySelector('[data-role="mode-strip"]');
      root.querySelectorAll('[data-role="mode-item"]').forEach((node) => {
        node.addEventListener('click', this.onItemClick);
      });
      this.rebind();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：退订 + 撤掉版面让位变量（元素离场后不该再占版面）。
      this.unbind();
      this.setLayoutVar(false);
      this._visible = false;
    }

    /** 换端口 / 首次入层：退订旧的、按新端口重订阅。 */
    private rebind(): void {
      this.unbind();
      if (!this.isConnected) return;
      const demo = this._demo;
      if (demo) {
        this._unsubscribes.push(demo.subscribe(() => this.render()));
      }
      const director = this._director;
      if (director) {
        this._unsubscribes.push(director.subscribe(() => this.render()));
      }
      this.render();
    }

    private unbind(): void {
      for (const off of this._unsubscribes) off();
      this._unsubscribes = [];
    }

    /** 呈现：端口是真相，本组件只把真相画出来（不另存一份）。 */
    private render(): void {
      const demoOn = this._demo?.enabled === true;
      const directorOn = this._director?.enabled === true;
      const root = this._root;
      if (root) {
        root.hidden = !(demoOn || directorOn);
        const demoItem = root.querySelector<HTMLElement>('[data-mode="demo"]');
        if (demoItem) demoItem.hidden = !demoOn;
        const directorItem = root.querySelector<HTMLElement>('[data-mode="director"]');
        if (directorItem) directorItem.hidden = !directorOn;
      }
      this._visible = demoOn || directorOn;
      this.setLayoutVar(this._visible);
    }

    /** 版面让位：细条亮出时把下方版面整体下移一条的高度。 */
    private setLayoutVar(on: boolean): void {
      const doc = this.ownerDocument;
      const html = doc?.documentElement;
      if (!html) return;
      if (on) {
        html.style.setProperty(MODE_STRIP_CSS_VAR, `${MODE_STRIP_HEIGHT_PX}px`);
        html.setAttribute(MODE_STRIP_ATTRIBUTE, 'on');
      } else {
        html.style.removeProperty(MODE_STRIP_CSS_VAR);
        html.removeAttribute(MODE_STRIP_ATTRIBUTE);
      }
    }

    /** 点细条上的某一项 = 退出对应模式。 */
    private onItemClick = (event: Event): void => {
      const target = (event.target as HTMLElement | null)?.closest?.('[data-mode]') as HTMLElement | null;
      const mode = target?.getAttribute('data-mode');
      if (mode === 'demo') this._demo?.set(false);
      else if (mode === 'director') this._director?.disable();
    };
  }

  customElements.define(MODE_STRIP_TAG, ModeStrip);
  return ModeStrip as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与 mountGatewayBanner / mountDayReplay 同一装配口径）：建元素、挂进容器，
 * 返回元素引用 + unmount 闭包。
 */
export function mountModeStrip(
  host: HTMLElement,
  deps: { readonly demo: ModeStripDemoPort | null; readonly director: ModeStripDirectorPort | null }
): { readonly element: StratModeStripElement; readonly unmount: () => void } {
  defineStratModeStrip();
  const element = document.createElement(MODE_STRIP_TAG) as StratModeStripElement;
  element.demo = deps.demo;
  element.director = deps.director;
  host.appendChild(element);
  return { element, unmount: () => { element.remove(); } };
}
