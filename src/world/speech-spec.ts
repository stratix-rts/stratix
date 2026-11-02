/**
 * 文件职责：**气泡说话系统的规格常量**（task_076 / DEMO-PLAN.md §3）——
 *   气泡的尺寸（最大宽 160px / 字号 13px / 圆角 10px / 最多 2 行）、配色（黑底 85% + 白字）、
 *   尾巴、时序（入场 250ms / 出场 300ms / 存活 4s）与频率（同屏 ≤3 / 同单位 5s 冷却）。
 * 输入：无（纯静态常量）。
 * 输出：SPEECH_BUBBLE_SPEC（全部规格数字）。
 * 禁止事项：
 *   1. import phaser —— 纯常量（便于 node 单测直接引，不牵渲染引擎）；
 *   2. import hud / app —— 铁律：world 只认识 core；
 *   3. 写死通用时长 —— 入场 / 出场时长直接引用**唯一事实源**的通用口径
 *      （core/theme/visual-spec.ts 的 VISUAL_METRICS.enter / exit），
 *      气泡与其它入场演出共用同一把尺子，不另立一份「250ms」；
 *   4. 把气泡色值抄进别的文件 —— 气泡的底衬 / 文字色只此一份，改这里即可。
 *
 * ★ 为什么这份规格落在 world 而不是 core/theme/visual-spec.ts（唯一事实源）：
 *   core 的事实源收的是**跨层共享**的规格（七色语义调色板 / 通用时长 / 跑马灯 / 单位动画），
 *   消费者跨 hud 与 world 两侧；气泡是**纯 world 侧**的表现（只有战场画它），
 *   与 task_078 的地面格网步距（world/objects/ground-layout.ts）同一处境 ——
 *   事实仍然只有一份（就在本文件），不与别的模块各抄一份。
 *   真正跨层的部分（通用进出时长）依然走 core 事实源，两层不重复。
 *
 * @since v3.3（task_076）。
 */

import { VISUAL_METRICS } from './theme';

/**
 * 气泡规格（一份常量，改观感只动这里）。
 *
 * 尺寸口径全部是**世界坐标 px**（与战场其它层同一坐标系，随镜头一起缩放）。
 */
export const SPEECH_BUBBLE_SPEC = Object.freeze({
  // ——— 视觉 ———
  /** 气泡最大宽度（含内边距）。规格：最大宽 160px。 */
  maxWidthPx: 160,
  /** 字号。规格：白字 13px。 */
  fontSizePx: 13,
  /** 字体族（与战场其它文字同款：等宽，中文走系统回退）。 */
  fontFamily: 'monospace',
  /** 行高（两行文字的总高按此估）。 */
  lineHeightPx: 18,
  /** Phaser 的额外行距（行距 = 字体的自然行高 + 这个值）。 */
  lineSpacingPx: 2,
  /** 内边距（文字到边框）。 */
  paddingPx: 8,
  /** 圆角半径。规格：圆角 10px。 */
  cornerRadiusPx: 10,
  /** 最多几行，超出用省略号截断。规格：最多 2 行。 */
  maxLines: 2,
  /** 底衬色（黑）。 */
  backdropColor: '#000000',
  /** 底衬透明度（85%）。 */
  backdropAlpha: 0.85,
  /** 文字色（白）。 */
  textColor: '#ffffff',
  /** 尾巴底边宽度（指向单位头顶的小三角）。 */
  tailWidthPx: 11,
  /** 尾巴高度（从气泡底边到尖端）。 */
  tailHeightPx: 8,
  /**
   * 尾巴锚点相对单位中心的纵向偏移（负 = 头顶之上）。
   * why 取 -104：头顶那一条已经排满了 —— 任务浮标 ✓/! 在 -44、名字 / Lv 在 -66、
   *   「···」说话指示在 -84（顶到 -96）。气泡挂在它们**上方**，尾巴尖落在 -104，
   *   谁也不压谁（气泡是临时话术，出现时压住名字最难看）。
   */
  anchorOffsetY: -104,

  // ——— 时序 ———
  /** 入场时长（ms）= 通用入场口径（Back.Out 250ms）。 */
  enterDurationMs: VISUAL_METRICS.enter.durationMs,
  /** 出场时长（ms）= 通用退场口径（Cubic.In 300ms）。 */
  exitDurationMs: VISUAL_METRICS.exit.durationMs,
  /** 出场上浮距离（px）。 */
  exitRisePx: 10,
  /** 气泡存活时长（ms）：到点自动收起。规格：存活 4s 自动收。 */
  lifeMs: 4000,

  // ——— 频率 ———
  /** 同屏最多几个气泡。规格：同屏 ≤ 3 个。 */
  maxOnScreen: 3,
  /** 同一单位的重复冷却（ms）。规格：同单位 5s 内不重复冒泡。 */
  unitCooldownMs: 5000,
  /** 排队上限（超出丢最老的一条）—— 防止事件风暴把队列撑爆（perf：队列必须有界）。 */
  maxQueue: 6,
});
