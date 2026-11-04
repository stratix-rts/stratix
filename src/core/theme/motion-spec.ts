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
 * ★ 为什么时长是 60 / 120 / 200 / 360 这四档（而不是随手取整）：
 *   - 60ms（instant）：**微反馈类**——按下 / 勾选 / 即时回执。快到「感觉像没有延迟」，
 *     但仍有一帧可被眼睛捕捉到（0ms 会被当成「没按到」）。
 *   - 120ms（fast）：**反馈类**——hover / 聚焦 / 光标反馈。低于 100ms 人眼会当成
 *     「没动」（延迟感），高于 200ms 会开始拖手（按键响应迟钝的错觉）。
 *   - 200ms（base）：**状态切换类**——面板入场 / 横幅出现 / 列表项换位。
 *     这是「看得清变化过程，但不至于等它」的临界点。
 *   - 360ms（slow）：**叙事类**——签名瞬间（完成确认）。允许慢一点，因为它是**要被看见的**，
 *     但也不能超过 ~400ms —— 再慢就变成「界面卡住了」的错觉。
 *   四档的比例刻意不成整数倍，这样「即时 / 快 / 中 / 慢」的层级感来自数值本身，
 *   而不是靠命名约定。
 */

/** 动效时长（四档）—— 单位 ms。 */
export const MOTION_DURATIONS = Object.freeze({
  /** 微反馈类：按下 / 勾选 / 即时回执。 */
  instant: 60,
  /** 反馈类：hover / 聚焦 / 光标。 */
  fast: 120,
  /** 状态切换类：入场 / 出场 / 换位。 */
  base: 200,
  /** 叙事类：签名瞬间（完成确认）。 */
  slow: 360,
} as const);

/**
 * 环境循环时长（装饰性 infinite 动画）—— **与交互节拍分表**（@since v3.9，task_147）。
 *
 * why 单独一档而不是塞进四档节拍：
 *   交互节拍讲的是「用户动作 → 界面回应」有多快（越快越跟手）；
 *   环境循环讲的是「没人操作时画面自己在动多快」（越慢越不抢戏）。
 *   两者的评价标准相反，混在一张表里必然互相妥协 ——
 *   所以这里单列，并在收编时明确：**循环时长不进「交互节拍表」，只进「环境循环表」**。
 */
export const MOTION_LOOP_DURATIONS = Object.freeze({
  /** 战场空态：扫描扫线绕一圈（2.4s）。 */
  sweep: 2400,
  /** 战场空态：待命光标呼吸（1.8s）。 */
  pulse: 1800,
  /** 全屏扫描光带：扫过一次（12s）。 */
  scan: 12_000,
  /** 报错红光晕：一次呼吸（650ms）。 */
  glow: 650,
  /** 输入光标：眨一次眼（900ms）。 */
  caret: 900,
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
  instant: '--srf-motion-instant',
  fast: '--srf-motion-fast',
  base: '--srf-motion-base',
  slow: '--srf-motion-slow',
  easeEnter: '--srf-motion-ease-enter',
  easeExit: '--srf-motion-ease-exit',
  easeSpring: '--srf-motion-ease-spring',
  loopSweep: '--srf-motion-loop-sweep',
  loopPulse: '--srf-motion-loop-pulse',
  loopScan: '--srf-motion-loop-scan',
  loopGlow: '--srf-motion-loop-glow',
  loopCaret: '--srf-motion-loop-caret',
} as const);

/**
 * **交互节拍**（复合档：时长 + 缓动打包成一个 CSS 变量）—— @since v3.9，task_147。
 *
 * why 要复合档：单写 `var(--srf-motion-fast)` 时，缓动还得再补一句
 *   `var(--srf-motion-ease-enter)` —— 两处凑一对，少写一处就掉回默认缓动（linear），
 *   而且**每个组件各凑一次就各错一次**（这正是收编前「同屏两种曲线」的由来）。
 *   把「时长 + 缓动」合成一档，组件只写 `var(--srf-motion-hover)` ——
 *   语义直接写在名字里，节拍表也就能一眼看懂（见交付的「交互类别-时长映射表」）。
 *
 * 命名即类别：组件按**交互类别**取档，不按数值取档 —— 数值永远在 core 那张表里。
 */
export const MOTION_BEAT_CSS_VARS = Object.freeze({
  /** 微反馈：按下 / 勾选 / 即时回执。 */
  tap: '--srf-motion-tap',
  /** 悬停 / 聚焦反馈。 */
  hover: '--srf-motion-hover',
  /** 面板 / 浮层开合、横幅进出、列表换位（进）。 */
  panel: '--srf-motion-panel',
  /** 退场（与 panel 同时长，退场缓动）。 */
  panelExit: '--srf-motion-panel-exit',
  /** 签名瞬间（一次性强调脉冲）。 */
  signature: '--srf-motion-signature',
} as const);

/**
 * token 名 → 声明值（**唯一事实源**）。
 * MOTION_TOKENS_CSS 与 motionTokenValue 都从这里出，两边不可能漂移。
 */
const MOTION_TOKEN_VALUES: Readonly<Record<string, string>> = Object.freeze({
  [MOTION_CSS_VARS.instant]: `${MOTION_DURATIONS.instant}ms`,
  [MOTION_CSS_VARS.fast]: `${MOTION_DURATIONS.fast}ms`,
  [MOTION_CSS_VARS.base]: `${MOTION_DURATIONS.base}ms`,
  [MOTION_CSS_VARS.slow]: `${MOTION_DURATIONS.slow}ms`,
  [MOTION_CSS_VARS.easeEnter]: MOTION_EASINGS.enter,
  [MOTION_CSS_VARS.easeExit]: MOTION_EASINGS.exit,
  [MOTION_CSS_VARS.easeSpring]: MOTION_EASINGS.spring,
  [MOTION_CSS_VARS.loopSweep]: `${MOTION_LOOP_DURATIONS.sweep}ms`,
  [MOTION_CSS_VARS.loopPulse]: `${MOTION_LOOP_DURATIONS.pulse}ms`,
  [MOTION_CSS_VARS.loopScan]: `${MOTION_LOOP_DURATIONS.scan}ms`,
  [MOTION_CSS_VARS.loopGlow]: `${MOTION_LOOP_DURATIONS.glow}ms`,
  [MOTION_CSS_VARS.loopCaret]: `${MOTION_LOOP_DURATIONS.caret}ms`,
  // —— 交互节拍（复合档：时长 + 缓动）——
  [MOTION_BEAT_CSS_VARS.tap]: `var(${MOTION_CSS_VARS.instant}) var(${MOTION_CSS_VARS.easeEnter})`,
  [MOTION_BEAT_CSS_VARS.hover]: `var(${MOTION_CSS_VARS.fast}) var(${MOTION_CSS_VARS.easeEnter})`,
  [MOTION_BEAT_CSS_VARS.panel]: `var(${MOTION_CSS_VARS.base}) var(${MOTION_CSS_VARS.easeEnter})`,
  [MOTION_BEAT_CSS_VARS.panelExit]: `var(${MOTION_CSS_VARS.base}) var(${MOTION_CSS_VARS.easeExit})`,
  [MOTION_BEAT_CSS_VARS.signature]: `var(${MOTION_CSS_VARS.slow}) var(${MOTION_CSS_VARS.easeSpring})`,
});

/**
 * 动效 token 的 CSS 变量文本（`:root` 块）—— HUD 侧注入这张表。
 * why 由 core 生成而不是手写：时长值只有一份（上面几个常量），HUD 只是翻译成 CSS。
 */
export const MOTION_TOKENS_CSS = `:root {
  /* —— 动效时长（四档）—— */
  ${MOTION_CSS_VARS.instant}: ${MOTION_DURATIONS.instant}ms;
  ${MOTION_CSS_VARS.fast}: ${MOTION_DURATIONS.fast}ms;
  ${MOTION_CSS_VARS.base}: ${MOTION_DURATIONS.base}ms;
  ${MOTION_CSS_VARS.slow}: ${MOTION_DURATIONS.slow}ms;
  /* —— 动效缓动（三档）—— */
  ${MOTION_CSS_VARS.easeEnter}: ${MOTION_EASINGS.enter};
  ${MOTION_CSS_VARS.easeExit}: ${MOTION_EASINGS.exit};
  ${MOTION_CSS_VARS.easeSpring}: ${MOTION_EASINGS.spring};
  /* —— 环境循环时长（装饰性 infinite 动画；与交互节拍分表）—— */
  ${MOTION_CSS_VARS.loopSweep}: ${MOTION_LOOP_DURATIONS.sweep}ms;
  ${MOTION_CSS_VARS.loopPulse}: ${MOTION_LOOP_DURATIONS.pulse}ms;
  ${MOTION_CSS_VARS.loopScan}: ${MOTION_LOOP_DURATIONS.scan}ms;
  ${MOTION_CSS_VARS.loopGlow}: ${MOTION_LOOP_DURATIONS.glow}ms;
  ${MOTION_CSS_VARS.loopCaret}: ${MOTION_LOOP_DURATIONS.caret}ms;
  /* —— 交互节拍（时长 + 缓动的复合档；组件只认这五个）—— */
  ${MOTION_BEAT_CSS_VARS.tap}: var(${MOTION_CSS_VARS.instant}) var(${MOTION_CSS_VARS.easeEnter});
  ${MOTION_BEAT_CSS_VARS.hover}: var(${MOTION_CSS_VARS.fast}) var(${MOTION_CSS_VARS.easeEnter});
  ${MOTION_BEAT_CSS_VARS.panel}: var(${MOTION_CSS_VARS.base}) var(${MOTION_CSS_VARS.easeEnter});
  ${MOTION_BEAT_CSS_VARS.panelExit}: var(${MOTION_CSS_VARS.base}) var(${MOTION_CSS_VARS.easeExit});
  ${MOTION_BEAT_CSS_VARS.signature}: var(${MOTION_CSS_VARS.slow}) var(${MOTION_CSS_VARS.easeSpring});
}
`;

/**
 * 取某个 CSS 变量名的声明值（如 `--srf-motion-fast` → `120ms`）。
 * 供 HUD 侧拼样式表与测试断言共用（避免各处手写 "120ms" 字符串）。
 */
export function motionTokenValue(name: string): string {
  const value = MOTION_TOKEN_VALUES[name];
  if (value === undefined) throw new Error(`[motion-spec] unknown motion token: ${name}`);
  return value;
}
