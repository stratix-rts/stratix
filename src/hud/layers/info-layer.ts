/**
 * 文件职责：**HUD 信息三层级的全局状态机 + CSS 变量驱动的对比度切换**
 *   （@since v3.4，task_096）—— L1 常驻 / L2 事件 / L3 沉浸三档。
 *   依据：docs/hud-redesign-proposal.html §2.3（信息三层级）+ §2.5（分区规格表的「层级」列）。
 * 输入：InfoLayer（core/types.ts 的契约类型；core/info-layer.ts 给纯语义）；
 *      DOM（document / 根元素）。
 * 输出：根元素上的 CSS 变量（--srf-layer-*）+ 层级标记属性 + 一张注入的样式表；
 *      控制器对外提供 current / apply / subscribe / destroy。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. 直接 import core/bus —— 组件与服务零总线依赖，订阅由组合根注入（同 toast-host / sfx-service 口径）；
 *   3. 写死 0.18 / 200ms —— 数字取自 core/theme/visual-spec.ts（HUD_LAYER_METRICS，唯一事实源）；
 *   4. 逐元素改内联样式 —— 对比度切换**只改根上的 CSS 变量**，由样式表统一落到各分区
 *      （改一个变量 → 一次重绘，不逐元素写样式、不触发布局重排）；
 *   5. 在本文件里发 HudCommand —— 命令由调用方（组合根 / 演示开关）发，本文件只管呈现。
 *
 * ============ 机制（为什么是这样切）============
 *   ① **CSS 变量驱动**：根元素上写 `--srf-layer-l1-opacity` 等四个变量，样式表把
 *      「哪些元素属于哪一层」映射到这些变量。切档 = 改四个变量的值 —— 不重建 DOM、
 *      不逐元素改样式、opacity / visibility 不触发布局重排（性能铁律）。
 *   ② **分区 → 层级的映射集中在一张表**（HUD_LAYER_REGIONS）：顶栏 / 控制岛 / 小地图 = L1，
 *      事件轨（跑马灯）/ toast = L2，回放时间戳角标 = L3（@since v3.4，task_093）。
 *      ★ 这张表是**机制层**的知识，不是各组件自己的事 ——
 *      故顶栏 / 事件轨的代码**一行未改**（本任务不动它们），层级语义集中在这里。
 *   ③ **通用属性口径**（`[data-srf-layer="L1"|"L2"]`）：给后续任务一个「谁想入层就自己标」的入口
 *      —— 新增 L3 元素或新的 L2 件时，标一个属性即可，不必改这张表。
 *   ④ **L2 收起用 visibility（不是 display）**：display 会与各元素自身的 display 规则打架
 *      （`display: none` 覆盖 flex 布局、`display: var(...)` 又会回退成 block）；
 *      visibility 是**独立属性**、不吃布局、且连带禁掉子元素的指针事件 —— 正是「收起」要的。
 *   ⑤ **L1 通道对外只开一个口**（@since v3.5，task_099）：别的机制要「再叠一层降对比」
 *      （如全屏弹窗打开时四角常驻件让位）时，经 setDimSource 登记自己的触发源，
 *      由本控制器合成（取最暗）后写进同一个变量 —— 通道只有一条，触发源可以多个。
 *
 * ★ 与「层级状态放哪」的关系：状态的**真相**在 core（WorldState.infoLayer，见 core/types.ts）——
 *   因为 world 侧也要订阅它（导演取景框等 L3 元素）。本文件是 HUD 侧对那份真相的**呈现层**：
 *   core 广播什么层级，这里就呈现成什么样；本文件自己不发命令、不改状态。
 */

import {
  DEFAULT_INFO_LAYER,
  INFO_LAYERS,
  layerL1Opacity,
  layerL2Collapsed,
  layerL2Opacity,
  normalizeInfoLayer,
} from '../../core/info-layer';
import { HUD_LAYER_METRICS } from '../../core/theme/visual-spec';
import type { InfoLayer } from '../../core/types';

/** 注入样式表的稳定 id（幂等覆盖，便于重复挂载与测试定位）。 */
export const INFO_LAYER_STYLE_ID = 'srf-info-layers';

/** 打在根元素上的层级标记属性（值 = 当前层级）—— 调试观察口 + CSS 兜底选择器的锚。 */
export const INFO_LAYER_ROOT_ATTRIBUTE = 'data-srf-info-layer';

/**
 * CSS 变量名（唯一约定处 —— 变量名只有这一处出现，改名不会漏改一处）。
 * 前缀 --srf-* 与皮肤 token 同族，但它们是**语义开关**而非皮肤色：换皮肤不影响它们。
 */
export const INFO_LAYER_CSS_VARS = Object.freeze({
  /** L1（常驻件）的对比因子 = 元素不透明度。 */
  l1Opacity: '--srf-layer-l1-opacity',
  /** L2（事件件）的对比因子 = 元素不透明度。 */
  l2Opacity: '--srf-layer-l2-opacity',
  /** L2 是否收起（visible / hidden）。 */
  l2Visibility: '--srf-layer-l2-visibility',
  /** 切档过渡时长（ms）。 */
  transitionMs: '--srf-layer-transition-ms',
});

/**
 * HUD 分区 → 层级 的映射（docs/hud-redesign-proposal.html §2.5 分区规格表的「层级」列）。
 *   L1 常驻：顶栏（Z1）/ 左右侧栏（agent 面板 / 态势总览 / 会话 / 日志）/ 小地图（Z3）/ 控制岛（Z4）
 *           —— 解释画面的基准信息；L3 激活时整体降对比（L3 的价值就在于「能把 L1 关掉」）。
 *   L2 事件：事件轨（Z2，跑马灯）/ toast（瞬时反馈）—— 随总线事件出现；L3 激活时收起。
 * why 用**选择器**而不是给每个组件打标记：打标记要改各组件的代码（顶栏 / 事件轨本任务不动），
 *   而选择器把「分区 → 层级」这张表收在机制层一处 —— 组件零改动，语义一处可查。
 */
export const HUD_LAYER_REGIONS: Readonly<Record<'L1' | 'L2' | 'L3', readonly string[]>> = Object.freeze({
  L1: Object.freeze([
    '.hud-topbar',
    '.hud-rail-left',
    '.hud-rail-right',
    '.hud-bottom-bar',
    'strat-minimap',
  ]),
  L2: Object.freeze(['strat-marquee', 'strat-toast-host']),
  // L3 沉浸（@since v3.4，task_093）：回放时间戳角标 —— L3 激活时它满对比，
  // L1 降对比、L2 收起，给「沉浸」让出画面。
  L3: Object.freeze(['strat-replay-clock']),
});

/** 层级 → 中文显示名（演示开关 / 调试面板共用；名字只有这一处）。 */
export const INFO_LAYER_LABELS: Readonly<Record<InfoLayer, string>> = Object.freeze({
  L1: 'L1 常驻',
  L2: 'L2 事件',
  L3: 'L3 沉浸',
});

export { INFO_LAYERS };

/**
 * L1 降对比通道的**写入口**（@since v3.5，task_099）—— 别的机制（如「全屏弹窗打开 →
 * 四角常驻件降对比」的遮挡规则）要再叠一层降对比时，经这个口登记自己的触发源，
 * **而不是另造一条 CSS 变量通道**。
 *
 * why 是「口」而不是「变量」：通道只有一条（--srf-layer-l1-opacity），谁写、写成多少
 * 由通道主人（= 本控制器）裁决 —— 多个触发源叠加时取**最暗**的那个
 * （弹窗压着 L3 演出时，L1 仍然是暗的；演出结束、弹窗还在 → 仍是弹窗那档）。
 * 触发源是**独立**的（演出占用是一种、弹窗是另一种），但出口只有这一个。
 */
export interface L1DimSink {
  /** 登记一个独立触发源的降对比因子（0-1）；传 null = 撤掉这个源。 */
  setDimSource(source: string, opacity: number | null): void;
}

/**
 * 层级口径 + 叠加触发源的**有效 L1 对比因子**（纯函数）。
 * 取最暗的那个：层级口径（L3 = 0.18）与触发源（弹窗 = 0.18）谁更暗听谁的。
 */
export function composeL1Opacity(
  layer: InfoLayer,
  dimSources?: ReadonlyMap<string, number>
): number {
  let opacity = layerL1Opacity(layer);
  if (dimSources) {
    for (const value of dimSources.values()) opacity = Math.min(opacity, value);
  }
  return opacity;
}

/**
 * 解析某层级下的 CSS 变量取值（纯函数 —— 单测直接断言，不起浏览器）。
 * 返回值即「写进根元素上的那几行」。
 * @param dimSources 叠加的独立降对比触发源（task_099：弹窗那路）—— 缺省 = 只有层级口径。
 */
export function infoLayerVars(
  layer: InfoLayer,
  dimSources?: ReadonlyMap<string, number>
): Record<string, string> {
  return {
    [INFO_LAYER_CSS_VARS.l1Opacity]: String(composeL1Opacity(layer, dimSources)),
    [INFO_LAYER_CSS_VARS.l2Opacity]: String(layerL2Opacity(layer)),
    [INFO_LAYER_CSS_VARS.l2Visibility]: layerL2Collapsed(layer) ? 'hidden' : 'visible',
    [INFO_LAYER_CSS_VARS.transitionMs]: `${HUD_LAYER_METRICS.transitionMs}ms`,
  };
}

/**
 * 生成层级样式表文本（纯函数）。
 * 规则只有两类：分区选择器（表驱动）与通用属性口径（`[data-srf-layer=...]`）。
 */
export function buildInfoLayerCss(): string {
  const l1 = [...HUD_LAYER_REGIONS.L1, '[data-srf-layer="L1"]'].join(',\n');
  const l2 = [...HUD_LAYER_REGIONS.L2, '[data-srf-layer="L2"]'].join(',\n');
  const l3 = [...HUD_LAYER_REGIONS.L3, '[data-srf-layer="L3"]'].join(',\n');
  const transition = `var(${INFO_LAYER_CSS_VARS.transitionMs}, ${HUD_LAYER_METRICS.transitionMs}ms)`;
  return `:root {
  ${INFO_LAYER_CSS_VARS.l1Opacity}: 1;
  ${INFO_LAYER_CSS_VARS.l2Opacity}: 1;
  ${INFO_LAYER_CSS_VARS.l2Visibility}: visible;
  ${INFO_LAYER_CSS_VARS.transitionMs}: ${HUD_LAYER_METRICS.transitionMs}ms;
}
${l1} {
  opacity: var(${INFO_LAYER_CSS_VARS.l1Opacity}, 1);
  transition: opacity ${transition} ease;
}
${l2} {
  opacity: var(${INFO_LAYER_CSS_VARS.l2Opacity}, 1);
  visibility: var(${INFO_LAYER_CSS_VARS.l2Visibility}, visible);
  transition: opacity ${transition} ease, visibility ${transition} ease;
}
/* L3 沉浸层元素（@since v3.4）：始终满对比 —— L3 期间 L1 降对比、L2 收起，
   沉浸的那几件（回放时间戳角标）必须是画面里最清楚的东西。 */
${l3} {
  opacity: 1;
  transition: opacity ${transition} ease;
}
`;
}

/** 控制器依赖注入（document / 根元素可换 —— 单测用内存 document）。 */
export interface InfoLayerControllerDeps {
  /** 目标 document；缺省取全局 document（node 环境无 document 时降级为「无 DOM 副作用」）。 */
  readonly document?: Document;
  /** 变量与标记属性的落点；缺省取 document.documentElement（变量要能继承进 shadow DOM）。 */
  readonly root?: HTMLElement;
}

/** HUD 全局层级状态机（单一实例 —— 全屏一份层级，不允许各面板各存一份）。 */
export interface InfoLayerController {
  /** 当前层级（缺省 L1 常驻）。 */
  readonly current: InfoLayer;
  /** 切档：改根上的 CSS 变量 + 标记属性；同档重复调用是 no-op（不重复通知）。 */
  apply(layer: InfoLayer): void;
  /**
   * 叠加一个独立的降对比触发源（@since v3.5，task_099）—— 弹窗遮挡规则经这条口
   * 复用 L1 通道，不另造 CSS 变量。传 null = 撤掉该源（弹窗关闭 → 全恢复）。
   */
  setDimSource(source: string, opacity: number | null): void;
  /** 订阅层级变化；返回退订函数。 */
  subscribe(listener: (layer: InfoLayer) => void): () => void;
  /** 卸载：撤样式表、撤变量、撤标记、清订阅者（资源必须可清理 —— perf 铁律）。 */
  destroy(): void;
}

/**
 * 工厂：构造 HUD 层级状态机。
 * 副作用只有一处：往 document.head 注入一张样式表 + 在根元素上写变量 —— 都是可撤销的。
 */
export function createInfoLayerController(deps: InfoLayerControllerDeps = {}): InfoLayerController {
  const doc = deps.document ?? (typeof document === 'undefined' ? null : document);
  const root = deps.root ?? doc?.documentElement ?? null;
  const listeners = new Set<(layer: InfoLayer) => void>();
  let current: InfoLayer = DEFAULT_INFO_LAYER;
  /**
   * 叠加的独立降对比触发源（@since v3.5，task_099）—— key = 源名（'modal' 等），value = 对比因子。
   * why 是 Map 而不是单个布尔：触发源可能不止一个（弹窗 + 演出各自一路），但**出口只有一条**
   * （--srf-layer-l1-opacity），合成时取最暗的那个（见 composeL1Opacity）。
   */
  const dimSources = new Map<string, number>();
  /** 卸载标记：destroy 之后 apply 一律 no-op（别把刚撤掉的样式表与变量又写回去）。 */
  let destroyed = false;

  // 注入样式表（幂等：同 id 先摘旧的，避免重复挂载留下两份规则）。
  let style: HTMLStyleElement | null = null;
  if (doc?.head) {
    doc.getElementById(INFO_LAYER_STYLE_ID)?.remove();
    style = doc.createElement('style');
    style.id = INFO_LAYER_STYLE_ID;
    style.setAttribute('data-srf-info-layers', 'true');
    style.textContent = buildInfoLayerCss();
    doc.head.appendChild(style);
  }

  const writeVars = (layer: InfoLayer): void => {
    if (!root) return;
    const vars = infoLayerVars(layer, dimSources);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    root.setAttribute(INFO_LAYER_ROOT_ATTRIBUTE, layer);
  };

  const apply = (layer: InfoLayer): void => {
    if (destroyed) return;
    const next = normalizeInfoLayer(layer);
    if (next === current) {
      // 同档重复调用：不通知订阅者（避免无谓重绘）—— 但变量仍写一次，
      // 保证「外部把变量改乱了」也能被下一次同档调用纠回来。
      writeVars(next);
      return;
    }
    current = next;
    writeVars(next);
    // 快照后再回调：订阅者可能在回调里退订 + 重新订阅（如主屏重渲）。
    for (const listener of Array.from(listeners)) listener(next);
  };

  const subscribe = (listener: (layer: InfoLayer) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /**
   * 叠加 / 撤掉一个独立降对比触发源（@since v3.5，task_099）。
   * why 不通知层级订阅者：层级本身没变（还是那一档），变的只是「有多暗」——
   *   订阅者（三档开关）只关心「当前是第几档」，多此一举的通知会让它白重绘。
   */
  const setDimSource = (source: string, opacity: number | null): void => {
    if (destroyed) return;
    if (opacity === null) {
      if (!dimSources.delete(source)) return;
    } else {
      const clamped = Math.min(1, Math.max(0, opacity));
      if (dimSources.get(source) === clamped) return;
      dimSources.set(source, clamped);
    }
    writeVars(current);
  };

  const destroy = (): void => {
    destroyed = true;
    listeners.clear();
    dimSources.clear();
    style?.remove();
    style = null;
    if (!root) return;
    for (const name of Object.values(INFO_LAYER_CSS_VARS)) root.style.removeProperty(name);
    root.removeAttribute(INFO_LAYER_ROOT_ATTRIBUTE);
  };

  // 初始态：把 L1 的口径写上去（变量初值与样式表默认值一致 —— 写出来是为了让
  // 「当前层级」在 DOM 上可观察，也保证 root 被换掉后仍能纠回来）。
  writeVars(current);

  return {
    get current(): InfoLayer {
      return current;
    },
    apply,
    setDimSource,
    subscribe,
    destroy,
  };
}
