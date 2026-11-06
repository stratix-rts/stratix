/**
 * 文件职责：**遮挡规则机制层**（@since v3.5，task_099）—— 方案 docs/interaction-reduction-v3.5.md §二 的
 *   R1（全屏弹窗 = 模态）/ R2（侧滑抽屉 = 半模态）/ R4（统一关闭途径）三条规则的**唯一实现处**。
 *   与 task_096 的信息三层级（hud/layers/info-layer.ts）是同族的机制层：
 *   那边管「常驻 / 事件 / 沉浸」三档，这边管「谁压着谁、压着的时候别人还能不能点」。
 * 输入：DOM（document / 根元素）+ 注入的 L1 降对比通道写入口（L1DimSink）+ 弹窗登记时的关闭回调。
 * 输出：根元素上的标记属性（data-srf-modal-open / data-srf-drawer-open）+ 一张注入的样式表
 *      （弹窗开着时：四角常驻件降对比 + pointer-events:none）+ 弹窗栈状态。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. 直接 import core/bus —— 命令由调用方（组合根 / 屏）发，本文件只管呈现与栈；
 *   3. **另造一条降对比 CSS 变量通道** —— 弹窗的降对比经 L1DimSink 复用 096 的
 *      --srf-layer-l1-opacity（这是硬要求：通道只有一条，触发源可以多个）；
 *   4. 写死颜色 / 时长 —— 视觉一律引用 --srf-* token，数字取自 core/theme/visual-spec.ts；
 *   5. 逐元素改内联样式 —— 禁点与降对比全靠样式表（改一个属性 → 一次重绘）。
 *
 * ============ 三条规则的口径（为什么这么切）============
 *   ① **R1 全屏弹窗 = 模态**：弹窗开着时，四角常驻件（顶栏 / 控制岛 / 事件轨 / 小地图）
 *      统一降对比 + `pointer-events: none`（防误触 —— 弹窗上层的遮罩已经挡住点击，
 *      这层是「结构上的防呆」，也让规则本身可断言）。关闭即全恢复（撤掉降对比触发源）。
 *      同一时刻至多一个全屏弹窗：**后来者顶掉前者**（栈顶即当前模态；ESC 只关栈顶）。
 *   ② **R2 侧滑抽屉 = 半模态**：抽屉只压暗**对侧**内容，不锁四角、不接管全屏。
 *      why 抽屉不锁四角：抽屉是「顺手看一眼」的旁路，关掉它不该让用户重新找按钮；
 *      why 抽屉压暗对侧：对侧是当前注意力之外的东西，压暗它 = 说「现在看这边」，
 *      但不夺走点击权（overlay 是 pointer-events:none）。
 *   ③ **R4 统一关闭途径**：全屏弹窗 **ESC 可关 + 点遮罩可关**（双途径必齐）。
 *      ESC 由本模块统一路由（一个 document 监听器 → 关栈顶），遮罩点击由弹窗壳自己接。
 *      why ESC 集中在这里：多个弹窗同时在场时，ESC 只能关**最上层**那个 ——
 *      各弹窗各挂一个监听器会把它们一起关掉。
 *
 * ★ 与「层级真相」的关系：本模块**不改**任何层级状态（infoLayer 仍在 core）——
 *   弹窗的降对比只是往同一条 L1 通道上**叠加**了一个触发源（见 L1DimSink），
 *   L3 演出期间该暗还是暗，演出结束弹窗还在 → 仍是弹窗那档。
 */

import { HUD_LAYER_METRICS } from '../../core/theme/visual-spec';
import { MOTION_REDUCED_CSS } from '../theme/motion-tokens';

import type { L1DimSink } from './info-layer';

/** 注入样式表的稳定 id（幂等覆盖，便于重复挂载与测试定位）。 */
export const OCCLUSION_STYLE_ID = 'srf-occlusion';

/** 打在根元素上的「有全屏弹窗开着」标记属性（值 = 'true' / 'false'）。 */
export const OCCLUSION_MODAL_ATTRIBUTE = 'data-srf-modal-open';

/** 打在根元素上的「有半模态抽屉开着」标记属性（值 = 'true' / 'false'）。 */
export const OCCLUSION_DRAWER_ATTRIBUTE = 'data-srf-drawer-open';

/**
 * 弹窗开着时「统一降对比 + 禁点」的常驻件（= 方案 §二 R1 点名的**四角件**：
 *   顶栏 / 控制岛 / 事件轨 / 小地图）。
 * why 是一张显式清单：四角件是「产品的固定位置」，规则要能被逐条核对；
 *   将来新增常驻件，往这张表加一行即可（别去逐个组件写样式）。
 * 注：事件轨（strat-marquee）在 096 的分区表里属 L2（事件件），但它在 R1 里是四角件之一 ——
 *   所以这里额外给它降对比（复用同一个 L1 变量，不另开通道）。
 */
export const OCCLUSION_CORNER_REGIONS: readonly string[] = Object.freeze([
  '.hud-topbar',
  '.hud-bottom-bar',
  'strat-minimap',
  'strat-marquee',
]);

/** 弹窗降对比在 L1 通道里的触发源名（通道只有一条 —— 源名只是「谁触发的」的记账）。 */
export const MODAL_DIM_SOURCE = 'modal';

/**
 * 生成遮挡规则样式表（纯函数 —— 单测直接断言文本）。
 * 规则有两类：**弹窗开着时**四角件的降对比 + 禁点，以及事件轨的可点部件开关。
 * why 用属性选择器而不是给元素逐个加 class：属性写在根上 → 开关一次全屏生效，
 *   不用遍历 DOM（perf 铁律：改一个属性 = 一次重绘）。
 *
 * why 禁点带 `!important`：小地图（strat-minimap）的影子树里 `:host { pointer-events: auto }`
 *   是组件自己开的交互口，而影子树里的声明与外层文档的声明**同源**（作者样式）——
 *   不加 !important 时外层这条可能被组件自己的规则盖住，弹窗期间就还能点到小地图（误触）。
 *   why 事件轨单独走自定义属性：它的可点部件（条目 / 折叠按钮）在**影子树内部**且自带
 *   `pointer-events: auto`，外层样式表穿不进影子树 —— 只有**自定义属性**能穿透影子边界继承，
 *   所以组件那边读 `var(--srf-marquee-pe, auto)`，这边在弹窗时把它翻成 none。
 */
export function buildOcclusionCss(): string {
  const corners = OCCLUSION_CORNER_REGIONS.map(
    (selector) => `[${OCCLUSION_MODAL_ATTRIBUTE}="true"] ${selector}`
  ).join(',\n');
  return `${corners} {
  opacity: var(--srf-layer-l1-opacity, 1);
  pointer-events: none !important;
}
/* 事件轨（strat-marquee）可点部件的开关（自定义属性穿透影子边界继承）。 */
[${OCCLUSION_MODAL_ATTRIBUTE}="true"] strat-marquee {
  --srf-marquee-pe: none;
}
`;
}

/** 遮挡状态快照（订阅者拿到的就是这一份）。 */
export interface OcclusionState {
  /** 全屏弹窗栈（底 → 顶；栈顶 = 当前模态）。 */
  readonly modals: readonly string[];
  /** 当前最上层的全屏弹窗 id（null = 没有全屏弹窗）。 */
  readonly activeModal: string | null;
  /** 当前开着的半模态抽屉 id（null = 没有抽屉）。 */
  readonly drawer: string | null;
}

/**
 * 遮挡控制器（单一实例 —— 全屏一份遮挡态，不允许各弹窗各存一份）。
 * 单一实例的理由和 096 的层级控制器同源：遮挡是**跨件**的事实
 * （「现在有没有模态」必须全场一致，否则一个弹窗关了、另一个还开着，规则就自相矛盾）。
 */
export interface OcclusionController {
  /** 当前状态快照。 */
  readonly state: OcclusionState;
  /** 开一个全屏弹窗（叠在已有弹窗之上 —— 后来者顶掉前者）。 */
  openModal(id: string, requestClose?: () => void): void;
  /** 关掉某个全屏弹窗（关掉 / 从未开过 = no-op）。 */
  closeModal(id: string): void;
  /** 关掉最上层的全屏弹窗（ESC 走这条）；返回是否真的关掉了。 */
  closeTopModal(): boolean;
  /** 半模态抽屉开合（R2）：只压暗对侧，**不锁四角、不接管全屏**。 */
  setDrawer(id: string | null): void;
  /** 订阅状态变化；返回退订函数。 */
  subscribe(listener: (state: OcclusionState) => void): () => void;
  /** 卸载：撤监听器、撤样式表、撤属性、清订阅者与触发源（资源必须可清理）。 */
  destroy(): void;
}

/** 控制器依赖注入（document / 根元素 / L1 通道写入口可换 —— 单测用内存 document）。 */
export interface OcclusionControllerDeps {
  /** 目标 document；缺省取全局 document。 */
  readonly document?: Document;
  /** 属性与样式的落点；缺省取 document.documentElement。 */
  readonly root?: HTMLElement;
  /**
   * L1 降对比通道的写入口（task_096 的 info-layer 控制器）——
   * 弹窗降对比经这里**复用**那条通道，不另造变量。缺省 = 只禁点、不降对比。
   */
  readonly l1Dim?: L1DimSink | null;
}

/** 栈里的一项：id + 「请关闭我」的回调（ESC 由控制器统一路由到栈顶）。 */
interface ModalEntry {
  readonly id: string;
  readonly requestClose?: () => void;
}

/**
 * 工厂：构造遮挡控制器。
 * 副作用只有一处：往 document.body 末尾注入一张样式表 + 在根元素上写标记属性 —— 都是可撤销的。
 */
export function createOcclusionController(deps: OcclusionControllerDeps = {}): OcclusionController {
  const doc = deps.document ?? (typeof document === 'undefined' ? null : document);
  const root = deps.root ?? doc?.documentElement ?? null;
  const dim = deps.l1Dim ?? null;
  /** 弹窗栈（底 → 顶）。 */
  const stack: ModalEntry[] = [];
  const listeners = new Set<(state: OcclusionState) => void>();
  let drawer: string | null = null;
  let destroyed = false;

  // 注入样式表（幂等：同 id 先摘旧的，避免重复挂载留下两份规则）。
  // why 挂在 body 末尾（不是 head）：本表要盖过各屏自己的样式表（如主屏的
  //   `.hud-topbar { pointer-events: auto }` —— 那张表挂在宿主子节点里），
  //   挂在 body 末尾 = 文档顺序最后 = 同特异度下稳赢（也满足 jsdom 的顺序级联口径）。
  let style: HTMLStyleElement | null = null;
  const styleHost = doc?.body ?? doc?.head ?? null;
  if (doc && styleHost) {
    doc.getElementById(OCCLUSION_STYLE_ID)?.remove();
    style = doc.createElement('style');
    style.id = OCCLUSION_STYLE_ID;
    style.setAttribute('data-srf-occlusion', 'true');
    style.textContent = buildOcclusionCss();
    styleHost.appendChild(style);
  }

  /** 当前状态快照（栈 + 抽屉位）—— 订阅者拿到的就是这一份（纯读，不改状态）。 */
  const snapshot = (): OcclusionState => ({
    modals: stack.map((entry) => entry.id),
    activeModal: stack.length > 0 ? stack[stack.length - 1]!.id : null,
    drawer,
  });

  /** 已登记到 L1 通道上的降对比触发源值（null = 没登记）；用于避免重复登记（少写通道 = 少重绘）。 */
  let dimApplied: number | null = null;
  /** 把状态落到 DOM + L1 通道上（改属性 / 改变量 = 一次重绘，不逐元素写样式）。 */
  const sync = (): void => {
    const modalOpen = stack.length > 0;
    if (root) {
      root.setAttribute(OCCLUSION_MODAL_ATTRIBUTE, modalOpen ? 'true' : 'false');
      root.setAttribute(OCCLUSION_DRAWER_ATTRIBUTE, drawer ? 'true' : 'false');
    }
    // 样式表必须**排在最后**：各屏的样式表是在屏挂载时才插进来的（可能插在本表之后），
    //   顺序级联下「最后」的那张才赢 —— 所以每次同步都把本表挪到 body 末尾。
    //   why 不是每次重建：重建会让浏览器重新解析一遍样式表，挪动只是改位置。
    if (style && styleHost && style.parentNode === styleHost && styleHost.lastChild !== style) {
      styleHost.appendChild(style);
    }
    // 弹窗降对比 = 往 L1 通道叠加一个触发源（通道本身还是 096 那条）。
    const next = modalOpen ? HUD_LAYER_METRICS.l1DimOpacity : null;
    if (next !== dimApplied) {
      dimApplied = next;
      dim?.setDimSource(MODAL_DIM_SOURCE, next);
    }
  };

  /** 通知订阅者（状态变了才叫 —— 少通知 = 少重绘）。 */
  const notify = (): void => {
    const state = snapshot();
    // 快照后再回调：订阅者可能在回调里退订 + 重新订阅。
    for (const listener of Array.from(listeners)) listener(state);
  };

  /** 开一个全屏弹窗（后来者顶掉前者；同 id 重复登记只更新关闭回调）。 */
  const openModal = (id: string, requestClose?: () => void): void => {
    if (destroyed || id.length === 0) return;
    const existing = stack.find((entry) => entry.id === id);
    if (existing) {
      // 同一个弹窗重复登记：只更新关闭回调（不重复入栈 —— 否则栈会越堆越深）。
      if (requestClose) {
        stack.splice(stack.indexOf(existing), 1, { id, requestClose });
      }
      return;
    }
    stack.push(requestClose ? { id, requestClose } : { id });
    sync();
    notify();
  };

  /** 关掉某个全屏弹窗（从未开过 = no-op —— 关闭即全恢复）。 */
  const closeModal = (id: string): void => {
    const index = stack.findIndex((entry) => entry.id === id);
    if (index < 0) return;
    stack.splice(index, 1);
    sync();
    notify();
  };

  /** 关掉栈顶那个（ESC 走这条）—— 先摘栈（遮挡立刻解除）再请主人关闭。 */
  const closeTopModal = (): boolean => {
    const top = stack[stack.length - 1];
    if (!top) return false;
    // 先摘栈（遮挡立刻解除 —— 关闭即全恢复），再请主人关闭（主人多半是发 ui.navigate）。
    stack.pop();
    sync();
    notify();
    top.requestClose?.();
    return true;
  };

  /** 半模态抽屉开合（R2）：只改标记属性 —— 不碰 L1 通道、不禁点、不接管全屏。 */
  const setDrawer = (id: string | null): void => {
    if (destroyed || drawer === id) return;
    drawer = id;
    // R2：抽屉只改标记属性（供调试与断言观察）—— **不碰 L1 通道、不禁点**。
    sync();
    notify();
  };

  // ESC → 关最上层的全屏弹窗（一个监听器统管，避免多弹窗各关各的）。
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') return;
    closeTopModal();
  };
  doc?.addEventListener('keydown', onKeydown);

  /** 订阅状态变化；返回退订函数（资源必须可清理）。 */
  const subscribe = (listener: (state: OcclusionState) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  /** 卸载：撤 ESC 监听、撤样式表、撤属性、撤通道触发源、清订阅者。 */
  const destroy = (): void => {
    destroyed = true;
    doc?.removeEventListener('keydown', onKeydown);
    listeners.clear();
    stack.length = 0;
    drawer = null;
    // 撤掉降对比触发源（别把 L1 留在暗处）。
    dimApplied = null;
    dim?.setDimSource(MODAL_DIM_SOURCE, null);
    style?.remove();
    style = null;
    if (!root) return;
    root.removeAttribute(OCCLUSION_MODAL_ATTRIBUTE);
    root.removeAttribute(OCCLUSION_DRAWER_ATTRIBUTE);
  };

  // 初始态：属性写上（观察口 + 样式表兜底选择器的锚）。
  sync();

  return {
    get state(): OcclusionState {
      return snapshot();
    },
    openModal,
    closeModal,
    closeTopModal,
    setDrawer,
    subscribe,
    destroy,
  };
}

// ============================================================================
// 全屏弹窗壳（遮罩 + 面板 + 双关闭途径）
// ============================================================================

/** 弹窗壳的样式表 id（幂等覆盖）。 */
export const MODAL_SHELL_STYLE_ID = 'srf-modal-shell';

/**
 * 全屏弹窗壳的样式（模块级常量）。
 * why 面板不是「铺满全屏」：铺满就没有遮罩了 —— 没有遮罩就没有「点遮罩可关」这条路（R4）。
 *   所以形态是「全屏遮罩 + 居中面板」：遮罩吃掉全屏点击（顺带把后面的画面压暗），
 *   面板是内容面（弹窗本体）。
 *
 * ============ 出入场过渡（@since v3.6，task_121）============
 *   入场：遮罩淡入 + 面板「升起」（--srf-motion-panel：200ms）—— 纯 CSS（@starting-style），零 JS 计时器。
 *   退场：**同步摘除**（不是过渡）—— 遮挡契约要求遮罩一关就消失、
 *     四角常驻件的降对比立刻解除（见 interaction-occlusion 单测的同步断言），
 *     所以这一层不能延迟卸载。退场的"余韵"交给各子屏自己的内容过渡。
 */
const MODAL_SHELL_STYLE = `
.hud-modal-mask {
  position: absolute;
  inset: 0;
  background: var(--srf-backdrop);
  pointer-events: auto;
  opacity: 1;
  transition: opacity var(--srf-motion-panel);
}
.hud-modal-panel {
  position: absolute;
  inset: 0;
  margin: auto;
  width: min(1180px, 92vw);
  height: 86vh;
  overflow: hidden;
  background: var(--srf-bg);
  color: var(--srf-text);
  border: var(--srf-border-width) solid var(--srf-border);
  border-radius: var(--srf-radius);
  box-shadow: var(--srf-shadow-lg);
  pointer-events: auto;
  opacity: 1;
  transform: translateY(0) scale(1);
  transition: opacity var(--srf-motion-panel), transform var(--srf-motion-panel);
}
@starting-style {
  .hud-modal-mask { opacity: 0; }
  .hud-modal-panel { opacity: 0; transform: translateY(10px) scale(0.985); }
}
${MOTION_REDUCED_CSS}
`;

/** 弹窗壳依赖。 */
export interface ModalShellDeps {
  /** 弹窗 id（进遮挡栈用；同 id 重复登记 = 同一个弹窗）。 */
  readonly id: string;
  /** 「请关闭我」—— ESC 与点遮罩都走它（通常是发 ui.navigate main）。 */
  readonly onClose: () => void;
  /** 遮挡控制器（登记自己 → 弹窗开 → 四角降对比禁点；ESC 由控制器路由到栈顶）。 */
  readonly occlusion?: OcclusionController | null;
}

/** 弹窗壳句柄。 */
export interface ModalShellHandle {
  /** 遮罩节点（测试按它点）。 */
  readonly mask: HTMLElement;
  /** 面板节点（弹窗内容挂这儿）。 */
  readonly panel: HTMLElement;
  /** 卸载：撤登记、撤 DOM（资源必须可清理）。 */
  unmount(): void;
}

/**
 * 挂一个全屏弹窗壳：遮罩 + 居中面板，并接上双关闭途径。
 * @param host 挂载点（一般是 .hud-sub-screen 那层覆盖宿主）。
 */
export function mountModalShell(deps: ModalShellDeps, host: HTMLElement): ModalShellHandle {
  const doc = host.ownerDocument;

  // 样式表幂等注入（多个弹窗共用一张）。
  if (doc?.head && !doc.getElementById(MODAL_SHELL_STYLE_ID)) {
    const style = doc.createElement('style');
    style.id = MODAL_SHELL_STYLE_ID;
    style.setAttribute('data-srf-modal-shell', 'true');
    style.textContent = MODAL_SHELL_STYLE;
    doc.head.appendChild(style);
  }

  const mask = doc.createElement('div');
  mask.className = 'hud-modal-mask';
  mask.setAttribute('data-role', 'modal-mask');

  const panel = doc.createElement('div');
  panel.className = 'hud-modal-panel';
  panel.setAttribute('data-role', 'modal-panel');

  host.append(mask, panel);

  // 关闭途径之一：点遮罩（遮罩与面板是兄弟节点 —— 点面板不会冒泡到遮罩）。
  /** 关闭途径之一：点遮罩（遮罩与面板是兄弟节点 —— 点面板不冒泡到遮罩）。 */
  const onMaskClick = (): void => {
    deps.onClose();
  };
  mask.addEventListener('click', onMaskClick);

  // 关闭途径之二：ESC —— 交给控制器统一路由（只关栈顶那个）。
  deps.occlusion?.openModal(deps.id, deps.onClose);

  return {
    mask,
    panel,
    unmount: (): void => {
      mask.removeEventListener('click', onMaskClick);
      // 撤登记（关闭即全恢复：四角降对比与禁点随之解除）。
      deps.occlusion?.closeModal(deps.id);
      mask.remove();
      panel.remove();
    },
  };
}
