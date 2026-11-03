/**
 * 文件职责：**信息层级三档开关**（@since v3.4，task_096）—— 一个演示 / 调试用的浮层，
 *   把「L1 常驻 / L2 事件 / L3 沉浸」三档摆在屏幕角落，点一下即生效。
 *   依据：docs/hud-redesign-proposal.html §2.3（信息三层级）。
 * 输入：层级状态机（InfoLayerController —— 呈现层）+ 命令出口（dispatch）；
 *      DOM 宿主（挂载点）。
 * 输出：浮层 DOM（三枚按钮 + 两个样例区）+ 点击 → HudCommand `hud.layer.set`；
 *      当前档的高亮回显（订阅控制器）。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. 直接 import core/bus —— 命令出口由组合根注入（同其它 HUD 组件的装配口径）；
 *   3. 在本文件里改层级状态 —— 真相在 core：按钮只发命令，等 core 广播回来再改呈现
 *      （HUD 不自己存第二份真相 —— 与顶栏「🎬 导演」按钮同一纪律）；
 *   4. 写死颜色 / 边框 —— 全部引用 --srf-* 变量；
 *   5. 把开关塞进顶栏 / 底栏 —— 本任务不动那两处（顶栏 7 元素化是后续任务的事）。
 *
 * ============ 为什么样例区在开关里 ============
 *   机制要能被**当场看见**：面板里放两个小样例（L1 样例 / L2 样例，各打一个层级标记），
 *   切到 L3 时 —— L1 样例当场降到 18% 对比、L2 样例当场收起 —— 一眼就懂机制在干什么。
 *   真实分区（顶栏 / 控制岛 / 事件轨 / toast）走同一套机制（见 hud/layers/info-layer.ts
 *   的分区映射表），它们的代码一行未改。
 */

import { INFO_LAYERS } from '../../core/info-layer';
import { CONTROL_ISLAND_METRICS } from '../../core/theme/visual-spec';
import type { HudCommand, InfoLayer } from '../../core/types';

import { INFO_LAYER_LABELS, type InfoLayerController } from './info-layer';

/** 开关里按钮的稳定角色（测试 / 调试按它定位）。 */
export const LAYER_SWITCH_BUTTON_ROLE = 'layer-switch-button';

/** 样例区的稳定角色。 */
export const LAYER_SWITCH_SAMPLE_ROLE = 'layer-switch-sample';

/** 开关依赖注入。 */
export interface LayerSwitchOptions {
  /** 层级状态机（呈现层）—— 开关从中读当前档并订阅变化。 */
  readonly controller: InfoLayerController;
  /** 命令出口：把 `hud.layer.set` 发给 core（组合根注入 adapter.dispatch）。 */
  readonly dispatch: (command: HudCommand) => void;
}

/** 挂载句柄。 */
export interface LayerSwitchHandle {
  /** 浮层根节点（测试按它定位）。 */
  readonly element: HTMLElement;
  /** 卸载：撤订阅、撤 DOM（资源必须可清理 —— perf 铁律）。 */
  unmount(): void;
}

/**
 * 开关的样式（模块级常量，随浮层一起挂 —— 浮层是独立于主屏的覆盖物，不吃主屏样式表）。
 * 位置：左侧、**控制岛之上**的一条空带里（bottom = 控制岛高度上限 + 8px；
 *   口径取自唯一事实源 CONTROL_ISLAND_METRICS.maxHeightPx —— @since v3.4 task_090，
 *   底栏改成贴底居中的控制岛后，旧口径 min(34vh, 300px) 会把开关甩到半空里）。
 *   开关挂在 #hud-side，不在 .hud-root 的容器查询上下文里，用不了 cqh —— 直接用常量。
 * why 不用右下角：小地图在那儿（200×120 + 标题栏）；为什么不在左下角贴边：事件轨
 *   （跑马灯）占左下角 16px 起的一条带，两者会重叠。
 */
const LAYER_SWITCH_STYLE = `
.hud-layer-switch {
  position: fixed;
  left: 16px;
  bottom: calc(${CONTROL_ISLAND_METRICS.maxHeightPx}px + 8px);
  z-index: 28;
  pointer-events: auto;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: var(--srf-spacing-xs);
  padding: var(--srf-spacing-xs);
  border-radius: var(--srf-radius, 6px);
  background: var(--srf-panel-overlay);
  border: var(--srf-border-width) solid var(--srf-border);
  box-shadow: var(--srf-shadow);
  font-family: var(--srf-font-ui);
  font-size: var(--srf-font-size-xs);
  color: var(--srf-text);
}
.hud-layer-switch-head { color: var(--srf-text-muted); padding: 0 var(--srf-spacing-xs); }
.hud-layer-switch-row { display: flex; gap: var(--srf-spacing-xs); }
.hud-layer-switch-btn {
  pointer-events: auto;
  cursor: pointer;
  padding: 2px var(--srf-spacing-xs);
  border-radius: var(--srf-radius-pill);
  border: var(--srf-border-width) solid var(--srf-border);
  background: transparent;
  color: var(--srf-text-muted);
  font: inherit;
  /* 微交互（@since v3.6，task_121）：hover 变亮 + 上浮 1px；按下压回。 */
  transition: color 140ms ease-out, background 140ms ease-out, border-color 140ms ease-out, transform 140ms ease-out;
}
.hud-layer-switch-btn:hover { color: var(--srf-text); border-color: var(--srf-border-strong); transform: translateY(-1px); }
.hud-layer-switch-btn:active { transform: translateY(0); }
/* 当前档的激活态（@since v3.6，task_121）：**点亮即当前档** —— 底色换成主色，
   一眼看出"现在是哪一档"。此前的弱高亮（只换描边）在深色底上几乎看不出来
   （死功能报告 P3#11：「L2 点了没反应」）。 */
.hud-layer-switch-btn[aria-pressed="true"] {
  color: var(--srf-bg);
  border-color: var(--srf-accent);
  background: var(--srf-accent);
  font-weight: var(--srf-font-weight-semibold, 600);
}
.hud-layer-switch-btn:focus-visible {
  outline: var(--srf-border-width) solid var(--srf-accent);
  outline-offset: 1px;
}
.hud-layer-switch-samples { display: flex; gap: var(--srf-spacing-xs); }
.hud-layer-sample {
  padding: 2px var(--srf-spacing-xs);
  border-radius: var(--srf-radius-pill);
  background: var(--srf-panel);
  border: var(--srf-border-width) solid var(--srf-border);
  color: var(--srf-text);
  white-space: nowrap;
}
`;

/**
 * 挂载三档开关。
 * @param options 依赖注入（控制器 + 命令出口）。
 * @param host 挂载点（组合根给 #hud-side —— 主屏每次重绘都重写 #hud-root，
 *             挂在那儿会被抹掉，见 app/main/main-entry.ts 的 task_086 注）。
 */
export function mountLayerSwitch(options: LayerSwitchOptions, host: HTMLElement): LayerSwitchHandle {
  const { controller, dispatch } = options;

  const element = document.createElement('div');
  element.className = 'hud-layer-switch';
  element.setAttribute('data-role', 'layer-switch');
  element.innerHTML = `
    <style>${LAYER_SWITCH_STYLE}</style>
    <div class="hud-layer-switch-head">信息层级</div>
    <div class="hud-layer-switch-row">
      ${INFO_LAYERS.map(
        (layer) =>
          `<button class="hud-layer-switch-btn" type="button" data-role="${LAYER_SWITCH_BUTTON_ROLE}" data-layer="${layer}">${INFO_LAYER_LABELS[layer]}</button>`,
      ).join('')}
    </div>
    <div class="hud-layer-switch-samples">
      <div class="hud-layer-sample" data-role="${LAYER_SWITCH_SAMPLE_ROLE}" data-srf-layer="L1">L1 样例 · 常驻</div>
      <div class="hud-layer-sample" data-role="${LAYER_SWITCH_SAMPLE_ROLE}" data-srf-layer="L2">L2 样例 · 事件</div>
    </div>
  `;

  const buttons = Array.from(
    element.querySelectorAll<HTMLButtonElement>(`[data-role="${LAYER_SWITCH_BUTTON_ROLE}"]`),
  );

  /** 回显当前档（按钮点亮 = 状态；不给「开/关」文本标签 —— 与新版顶栏同一口径）。 */
  const render = (layer: InfoLayer): void => {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', button.dataset.layer === layer ? 'true' : 'false');
    }
  };

  /** 点按钮 → 发命令给 core（不在 HUD 里改状态 —— 真相在 core）。 */
  const onClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const layer = target?.closest<HTMLElement>('[data-layer]')?.dataset.layer as InfoLayer | undefined;
    if (!layer) return;
    dispatch({ type: 'hud.layer.set', layer });
  };

  element.addEventListener('click', onClick);
  const unsubscribe = controller.subscribe(render);
  render(controller.current);

  host.appendChild(element);

  return {
    element,
    unmount: (): void => {
      unsubscribe();
      element.removeEventListener('click', onClick);
      element.remove();
    },
  };
}
