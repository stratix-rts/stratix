/**
 * 文件职责：**动效规格的唯一事实源**（@since v3.8，task_138）——
 *   HUD 侧动效的时长 / 缓动 / 关键帧名，全仓库只有这一份常量。
 *
 * 背景（v3.8 之前）：动效是「各写各的」——某面板写 150ms、某面板写 0.3s，
 *   缓动有 cubic-bezier 有 ease 有 linear，同屏两种面板的入场快慢不一样，
 *   用户感受是「这软件还没长好」。动效是**工具感 → 产品感**的分界线，
 *   而这条线靠的不是华丽，是**节奏统一**：同一个系统里，所有东西都该同速呼吸。
 *
 * 为什么是独立文件而不是并进 core/theme/visual-spec.ts：
 *   visual-spec.ts 是**战场调色板 + 世界层时长**的事实源（Phaser 侧消费），
 *   本文件是 **HUD / DOM 侧动效**的事实源（CSS 消费）。两者消费方不同（Phaser vs CSS），
 *   数值口径也不同（世界层用 tween 的 Back.Out / Cubic.In，DOM 层用 CSS 关键字与 cubic-bezier）。
 *   并进去会让两个消费方共用一张表，反而互相污染（world 层要 250ms 的 Back.Out，
 *   DOM 层要 120ms 的 ease-out —— 共用一个「时长」字段必然有一边妥协）。
 *
 * 输入：无（纯静态常量；零 IO、零 DOM、零 import —— 与 visual-spec.ts 同纪律）。
 * 输出：MOTION_DURATIONS（三档时长）/ MOTION_EASINGS（三档缓动）/ MOTION_KEYFRAMES（关键帧名）
 *      / MOTION_TOKENS_CSS（CSS 变量文本，HUD 侧注入）/ motionTokenValue（取值辅助）。
 * 禁止事项：
 *   1. import world / hud / phaser / 任何 DOM —— 本模块是叶子常量；
 *   2. 复制第二份时长表 —— 谁要动效时长只能来这里改；
 *   3. 写组件级选择器 —— 本模块只发 token 与关键帧名，组件样式归各组件；
 *   4. 在本模块里做「按皮肤改数值」的推导 —— 皮肤差异走 HUD 侧的 motion-tokens.ts。
 *
 * ★ 为什么时长是 120 / 200 / 360 这三档（而不是随手取整）：
 *   - 120ms（fast）：**反馈类**——hover / 按下 / 光标反馈。低于 100ms 人眼会当成
 *     「没动」（延迟感），高于 200ms 会开始拖手（按键响应迟钝的错觉）。
 *   - 200ms（base）：**状态切换类**——面板入场 / 横幅出现 / 列表项换位。
 *     这是「看得清变化过程，但不至于等它」的临界点。
 *   - 360ms（slow）：**叙事类**——签名瞬间（完成确认）。允许慢一点，因为它是**要被看见的**，
 *     但也不能超过 ~400ms —— 再慢就变成「界面卡住了」的错觉。
 *   三档的比例（1 : 1.7 : 3）刻意不成整数倍，这样「快 / 中 / 慢」的层级感来自数值本身，
 *   而不是靠命名约定。
 */

/** 动效时长（三档）—— 单位 ms。 */
export const MOTION_DURATIONS = Object.freeze({
  /** 反馈类：hover / 按下 / 光标。 */
  fast: 120,
  /** 状态切换类：入场 / 出场 / 换位。 */
  base: 200,
  /** 叙事类：签名瞬间（完成确认）。 */
  slow: 360,
} as const);

/** 动效缓动（三档）—— CSS 关键字或 cubic-bezier 字符串。 */
export const MOTION_EASINGS = Object.freeze({
  /** 进入：出场更快（ease-out = 起步快、收尾稳 —— 元素「就位」而不是「刹停」）。 */
  enter: 'ease-out',
  /** 退出：起步稳、收尾快（ease-in）—— 元素「离开」而不是「被弹走」。 */
  exit: 'ease-in',
  /** 强调：轻微回弹（spring 感）—— 只给一次性签名瞬间用（过冲过头会显得廉价）。 */
  spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const);

/** 关键帧名（组件引用它们，名字变了就集中改这一处）。 */
export const MOTION_KEYFRAMES = Object.freeze({
  /** 入场：位移 + 透明度（自上而下 8px）。 */
  enterIn: 'srf-motion-enter-in',
  /** 签名瞬间：一次性 scale + brightness 脉冲。 */
  confirmPop: 'srf-motion-confirm-pop',
  /** 对勾描边（stroke-dashoffset 走完）。 */
  checkDraw: 'srf-motion-check-draw',
  /** 输入行微脉冲（提交回执）。 */
  inputPulse: 'srf-motion-input-pulse',
} as const);

/** 语义 → CSS 变量名（HUD 侧注入用；core 不碰 DOM，只给映射）。 */
export const MOTION_CSS_VARS = Object.freeze({
  fast: '--srf-motion-fast',
  base: '--srf-motion-base',
  slow: '--srf-motion-slow',
  easeEnter: '--srf-motion-ease-enter',
  easeExit: '--srf-motion-ease-exit',
  easeSpring: '--srf-motion-ease-spring',
} as const);

/**
 * 动效 token 的 CSS 变量文本（`:root` 块）—— HUD 侧注入这张表。
 * why 由 core 生成而不是手写：时长值只有一份（上面三个常量），HUD 只是翻译成 CSS。
 */
export const MOTION_TOKENS_CSS = `:root {
  /* —— 动效时长（三档）—— */
  ${MOTION_CSS_VARS.fast}: ${MOTION_DURATIONS.fast}ms;
  ${MOTION_CSS_VARS.base}: ${MOTION_DURATIONS.base}ms;
  ${MOTION_CSS_VARS.slow}: ${MOTION_DURATIONS.slow}ms;
  /* —— 动效缓动（三档）—— */
  ${MOTION_CSS_VARS.easeEnter}: ${MOTION_EASINGS.enter};
  ${MOTION_CSS_VARS.easeExit}: ${MOTION_EASINGS.exit};
  ${MOTION_CSS_VARS.easeSpring}: ${MOTION_EASINGS.spring};
}
`;

/**
 * 取某个 CSS 变量名的声明值（如 `--srf-motion-fast` → `120ms`）。
 * 供 HUD 侧拼样式表与测试断言共用（避免各处手写 "120ms" 字符串）。
 */
export function motionTokenValue(name: string): string {
  switch (name) {
    case MOTION_CSS_VARS.fast:
      return `${MOTION_DURATIONS.fast}ms`;
    case MOTION_CSS_VARS.base:
      return `${MOTION_DURATIONS.base}ms`;
    case MOTION_CSS_VARS.slow:
      return `${MOTION_DURATIONS.slow}ms`;
    case MOTION_CSS_VARS.easeEnter:
      return MOTION_EASINGS.enter;
    case MOTION_CSS_VARS.easeExit:
      return MOTION_EASINGS.exit;
    case MOTION_CSS_VARS.easeSpring:
      return MOTION_EASINGS.spring;
    default:
      throw new Error(`[motion-spec] unknown motion token: ${name}`);
  }
}
