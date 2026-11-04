/**
 * 文件职责：**HUD 动效层**（@since v3.8，task_138）—— 把 core 的动效规格翻译成 CSS：
 *   ① `:root` 上的动效 token（--srf-motion-*）；② 全套关键帧与工具类；③ 入场 / 确认 / 脉冲三类动效。
 *
 * 与 core 的关系（双 token 体系）：core/theme/motion-spec.ts 是**唯一事实源**（时长 / 缓动数值），
 *   本文件只做「常量 → CSS」翻译 + 提供组件可直接引用的 class。
 *   谁想改时长只能改 core 那份常量 —— 本文件不允许出现手写的时间数字。
 *
 * 输入：无（纯 CSS 字符串常量；core 的常量 + 本文件的 class 名）。
 * 输出：MOTION_TOKENS_CSS（:root 变量表）/ MOTION_COMPONENT_CSS（关键帧 + 工具类 + 降级动效兜底）
 *      / MOTION_REDUCED_CSS（降级动效兜底块，组件自挂）/ installMotionTokens（把 token 表注入
 *      document.head，幂等）/ installReducedMotionChannel（文档级降级通道）。
 * 禁止事项：
 *   1. 手写时长 / 缓动字面量 —— 一律 var(--srf-motion-*)；
 *   2. import world / phaser / app —— 铁律：hud 只认识 core；
 *   3. 写业务选择器（.hud-topbar / .row / .panel 之类）—— 本文件只发**动效工具类**，
 *      组件自己决定挂哪个类（动效层与业务层解耦：加动效不改布局骨架）；
 *   4. 在本文件内静态 import *.css —— 与 theme-controller 同纪律，CSS 源由调用方注入。
 *
 * ★ 为什么工具类而不是每个组件各写各的 @keyframes：
 *   关键帧一旦各写各的，同一个「入场」在不同面板会是两种曲线两种位移 —— 那不叫统一节奏。
 *   工具类把「位移 8px + 淡入」「scale + 亮度脉冲」「对勾描边」定成三套可复用的动作，
 *   组件只需要挂类名（并按需覆盖 --srf-motion-* 变量调快慢）。
 *
 * ★ prefers-reduced-motion 的口径（全量禁用，不是「减弱」）：
 *   本块用 `animation: none` / `transition: none`（而不是 0.001ms）——
 *   前者让 computed animationName 直接是 "none"、transitionDuration 是 "0s"，
 *   可被自动化断言（验收口径 4）；后者只是「快到看不见」，仍占一次合成。
 *   注意：文档级规则**不穿透 shadow root** —— 所以每个 shadow 组件的样式表里
 *   都要带上本文件里的降级块（组件通过引入 MOTION_COMPONENT_CSS 自动带上）。
 */

/** 动效 token 样式表的稳定 id（幂等覆盖，便于重复调用与测试定位）。 */
// 动效规格的唯一事实源（core 侧）—— 时长 / 缓动 / 关键帧名都从那里来。
// 本文件只做「常量 → CSS」翻译：任何时长字面量都不许出现在这里（除了 var() 的兜底值）。
import {
  MOTION_KEYFRAMES,
  MOTION_TOKENS_CSS as CORE_MOTION_TOKENS_CSS,
} from '../../core/theme/motion-spec';

export const MOTION_TOKEN_STYLE_ID = 'srf-motion-tokens';

/** `:root` 上的动效 token 表（由 core 规格生成 —— 值只有一份）。 */
export const MOTION_TOKENS_CSS = CORE_MOTION_TOKENS_CSS;

/**
 * 工具类名（组件挂这些类，不自己写 keyframes）。
 * why 导出成常量：类名散落字符串拼错一个就是「静默不生效」，这里收口。
 */
export const MOTION_CLASS = Object.freeze({
  /** 入场（位移 + 淡入）。 */
  enter: 'srf-motion-enter',
  /** 签名瞬间：scale + 亮度脉冲（一次性）。 */
  confirm: 'srf-motion-confirm',
  /** 对勾描边（配合 .srf-motion-check 使用）。 */
  check: 'srf-motion-check',
  /** 输入行微脉冲（提交回执）。 */
  pulse: 'srf-motion-pulse',
});

/** 入场位移量（px）—— 上下同值：入场统一「从上方 8px 落位」。 */
export const MOTION_ENTER_OFFSET_PX = 8;

/**
 * 皮肤的运动语言（@since v3.8，task_138 加分项）——
 *   同一套动效在**像素皮肤**下应该「一格一格地跳」，在现代皮肤下应该「滑着落位」。
 *   这不是装饰，是皮肤语言的一致性：像素皮的一切都是硬边的（连过渡都是 steps(2)），
 *   若动效在像素皮里还带缓动回弹，皮与动效会互相拆台。
 *
 * why 靠「探测」而不是「每套皮肤各写一份动效 token」：
 *   皮肤 token 表里已经有**它自己的运动语言**（像素皮 --srf-transition: 120ms steps(2, end)），
 *   动效层读同一个信号（缓动里有没有 steps()）就能跟着走 —— 皮肤表是事实源，动效层不重复发明。
 *   代价：不碰任何皮肤 token 文件（那些是在途文件），也不新增一份「像素动效表」去和皮肤表打架。
 */
export const MOTION_SKIN_ID = Object.freeze({
  /** 像素皮：重帧感（逐格跳）。 */
  pixel: 'pixel',
} as const);

export type MotionSkinId = (typeof MOTION_SKIN_ID)[keyof typeof MOTION_SKIN_ID];

/** 各皮肤的运动语言 → 动效缓动覆盖值。 */
const MOTION_SKIN_EASINGS: Record<MotionSkinId, { enter: string; exit: string; spring: string }> = {
  [MOTION_SKIN_ID.pixel]: {
    // steps() 帧数：入场 3 格（落位看得清）/ 退出 2 格（干脆）/ 强调 4 格（脉冲一格一格顶上去）。
    enter: 'steps(3, end)',
    exit: 'steps(2, end)',
    spring: 'steps(4, end)',
  },
};

/**
 * 皮肤动效覆盖块（CSS 文本）。
 * why 用 `html:root` 而不是 `:root`：基础 token 表是 `:root`（特异度 0,1,0），
 *   覆盖块写成 `html:root`（0,1,1）才能**无论注入顺序都赢**——
 *   组件每次挂载都会重注基础表（幂等覆盖），若两者同特异度就变成「谁后到谁赢」。
 */
export function motionSkinCss(skin: MotionSkinId | null): string {
  if (!skin) return '';
  const easing = MOTION_SKIN_EASINGS[skin];
  if (!easing) return '';
  return `html:root {
  /* 皮肤运动语言（@since v3.8，task_138）：像素皮走 steps() 重帧感 */
  --srf-motion-ease-enter: ${easing.enter};
  --srf-motion-ease-exit: ${easing.exit};
  --srf-motion-ease-spring: ${easing.spring};
}
`;
}

/**
 * 探测当前皮肤的运动语言（返回 null = 现代皮肤，用默认缓动）。
 *
 * why 读 `--srf-transition`：那是每套皮肤 token 表里**已经存在**的运动语言信号
 *   （像素皮 = 120ms steps(2, end)，现代皮 = 160ms ease-out）—— 不新增皮肤约定，不改皮肤文件。
 */
export function detectMotionSkin(doc: Document = document): MotionSkinId | null {
  const root = doc.documentElement;
  if (!root) return null;
  // 先读行内（测试可注入），再读计算值（真实皮肤表走这条）。
  const inline = root.style?.getPropertyValue('--srf-transition') ?? '';
  if (inline.includes('steps(')) return MOTION_SKIN_ID.pixel;
  const view = doc.defaultView;
  if (!view?.getComputedStyle) return null;
  const computed = view.getComputedStyle(root).getPropertyValue('--srf-transition') ?? '';
  return computed.includes('steps(') ? MOTION_SKIN_ID.pixel : null;
}

/** 完整动效 token 表文本（基础表 + 皮肤覆盖块）。 */
export function motionTokensCss(doc: Document = document): string {
  return MOTION_TOKENS_CSS + motionSkinCss(detectMotionSkin(doc));
}

/**
 * **降级动效兜底块**（@since v3.9，task_147 拆出）——
 *   `prefers-reduced-motion: reduce` 时把 animation / transition 全部禁用。
 *
 * why 单独导出一份（而不是只埋在 MOTION_COMPONENT_CSS 里）：
 *   收编后 HUD 里**每个带动效的组件**都必须挂上这条通道 ——
 *   文档级规则穿不进影子树（shadow root 自成样式作用域），
 *   所以「谁的影子树里有 transition，谁的样式表里就得有这块」是硬约束。
 *   组件把这一块拼进自己的 <style>，也就是「统一走既有禁用通道」这条纪律落地。
 *
 * 用 none（而非 0.001ms）：computed animationName 直接是 "none"、transitionDuration 是 "0s"，
 * 可被自动化断言；也真的不产生任何合成开销。
 */
export const MOTION_REDUCED_CSS = `
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
`;

/** 文档级降级动效通道的样式表 id（幂等覆盖）。 */
export const MOTION_REDUCED_STYLE_ID = 'srf-motion-reduced';

/**
 * 装上**文档级**降级动效通道（浅 DOM 的 HUD 样式全归它管）。
 *
 * why 需要文档级这一份：HUD 有一批样式是直接注入 document.head 的浅 DOM 样式
 *   （弹窗壳 / 层级切换 / 主屏 / 信息层），它们不在任何影子树里 ——
 *   影子树里的兜底块管不到它们，文档级规则才管得到。
 *
 * 幂等：同 id 重复注入覆盖旧标签（多个组件都调 installMotionTokens 也不会堆叠）。
 */
export function installReducedMotionChannel(doc: Document = document): void {
  doc.getElementById(MOTION_REDUCED_STYLE_ID)?.remove();
  const style = doc.createElement('style');
  style.id = MOTION_REDUCED_STYLE_ID;
  style.setAttribute('data-srf-motion-reduced', 'true');
  style.textContent = MOTION_REDUCED_CSS;
  doc.head.appendChild(style);
}

/**
 * 动效关键帧 + 工具类 + 降级动效兜底 —— **组件样式表里带这一份**即可用全套动效。
 *
 * 结构：
 *   1. 关键帧定义（srf-motion-*）；
 *   2. 工具类（.srf-motion-enter / -confirm / -check / -pulse）；
 *   3. 降级动效兜底（prefers-reduced-motion: reduce → 全部 animation/transition 归零）。
 */
export const MOTION_COMPONENT_CSS = `
/* —— 动效关键帧（名字来自 core/theme/motion-spec.ts 的 MOTION_KEYFRAMES）—— */
@keyframes ${MOTION_KEYFRAMES.enterIn} {
  from { opacity: 0; transform: translateY(-${MOTION_ENTER_OFFSET_PX}px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes ${MOTION_KEYFRAMES.confirmPop} {
  0%   { transform: scale(1); filter: brightness(1); }
  35%  { transform: scale(1.08); filter: brightness(1.45); }
  70%  { transform: scale(0.985); filter: brightness(1.12); }
  100% { transform: scale(1); filter: brightness(1); }
}
@keyframes ${MOTION_KEYFRAMES.checkDraw} {
  from { stroke-dashoffset: 22; opacity: 0; }
  60%  { opacity: 1; }
  to   { stroke-dashoffset: 0; opacity: 1; }
}
@keyframes ${MOTION_KEYFRAMES.inputPulse} {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.02); }
  100% { transform: scale(1); }
}

/* —— 工具类 —— */
.${MOTION_CLASS.enter} {
  animation: ${MOTION_KEYFRAMES.enterIn} var(--srf-motion-base, 200ms) var(--srf-motion-ease-enter, ease-out) both;
}
.${MOTION_CLASS.confirm} {
  animation: ${MOTION_KEYFRAMES.confirmPop} var(--srf-motion-slow, 360ms) var(--srf-motion-ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1)) both;
}
.${MOTION_CLASS.check} {
  stroke-dasharray: 22;
  stroke-dashoffset: 22;
  animation: ${MOTION_KEYFRAMES.checkDraw} var(--srf-motion-slow, 360ms) var(--srf-motion-ease-enter, ease-out) both;
}
.${MOTION_CLASS.pulse} {
  animation: ${MOTION_KEYFRAMES.inputPulse} var(--srf-motion-fast, 120ms) var(--srf-motion-ease-enter, ease-out) both;
}

/* —— 降级动效兜底：prefers-reduced-motion: reduce 时全部禁用（与文档级通道同一块）—— */
${MOTION_REDUCED_CSS}
`;

/**
 * 把动效 token 注入 document.head（幂等：同 id 重复注入覆盖旧标签）。
 *
 * why 需要全局注入：动效 token 是 `:root` 变量，**跨 shadow root 可见** ——
 *   各组件在自己的 shadow 里用 var(--srf-motion-base) 时，取的是文档根上的值，
 *   于是「一次注入，全 HUD 同速」，而不是每个组件各带一份数值。
 *
 * @returns 卸载闭包（拔掉这张样式表）。
 */
export function installMotionTokens(doc: Document = document): () => void {
  doc.getElementById(MOTION_TOKEN_STYLE_ID)?.remove();
  const style = doc.createElement('style');
  style.id = MOTION_TOKEN_STYLE_ID;
  style.setAttribute('data-srf-motion-tokens', 'true');
  style.textContent = motionTokensCss(doc);
  doc.head.appendChild(style);
  // 文档级降级动效通道（浅 DOM 的 HUD 样式归它管；影子树里的由各组件自带的兜底块管）。
  installReducedMotionChannel(doc);
  ensureSkinSync(doc);
  subscribers += 1;
  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    style.remove();
    subscribers -= 1;
    if (subscribers <= 0) {
      subscribers = 0;
      skinObserver?.disconnect();
      skinObserver = null;
      observedDoc = null;
    }
  };
}

/* —— 皮肤切换同步（像素皮走 steps() 重帧感）——
   why 需要监听：切皮是**换掉**皮肤样式表（theme-controller 整张换），
   动效 token 表不会跟着换 —— 不监听的话，用户从像素皮切回现代皮后，
   动效还留在 steps()（重帧感留在了不该留的皮肤上）。
   why 只监听 head 的 childList：切皮 = 换样式表节点；不监听 attribute，避免过度触发。
   why 有引用计数：组件在时保持监听（应用期只有一个），最后一个卸载者离开时断开（不留悬挂观察者）。 */
let subscribers = 0;
let skinObserver: MutationObserver | null = null;
let observedDoc: Document | null = null;

function ensureSkinSync(doc: Document): void {
  if (skinObserver && observedDoc === doc) return;
  skinObserver?.disconnect();
  skinObserver = null;
  observedDoc = null;
  const view = doc.defaultView;
  if (!view || typeof view.MutationObserver !== 'function') return;
  const observer = new view.MutationObserver(() => {
    const style = doc.getElementById(MOTION_TOKEN_STYLE_ID);
    if (!style) return;
    const next = motionTokensCss(doc);
    if (style.textContent === next) return;
    // 原地改文本而不是重插节点：重插会让正在跑的动画从头再来（切皮不该打断已有动效）。
    style.textContent = next;
  });
  observer.observe(doc.head, { childList: true });
  skinObserver = observer;
  observedDoc = doc;
}
