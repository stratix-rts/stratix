/**
 * 文件职责：**world 侧的视觉规格门面** —— 把「视觉常量唯一事实源」翻译成战场可直接用的形态
 *   （Phaser 数字色 + 尺寸/时长/easing 常量）。
 *   来源：docs/DEMO-PLAN.md §1；事实源在 src/core/theme/visual-spec.ts（唯一事实源）。
 * 输入：无（纯常量派生）。
 * 输出：WORLD_PALETTE（0xRRGGBB 数字色）/ VISUAL_METRICS（尺寸·时长·easing）/ VISUAL_PALETTE（十六进制）。
 * 禁止事项：
 *   1. import hud —— 铁律：world 只认识 core 与 core/bus；
 *   2. 在本文件里另抄一份色值 —— 色值只在 core/theme/visual-spec.ts 一处，这里只做换算；
 *   3. import phaser —— 本文件是纯常量（不依赖渲染引擎，便于单测）。
 *
 * ★ 为什么门面在 world 而事实在 core（与 core/theme/skin-registry.ts 同一处境）：
 *   调色板同时被 world（数字色）与 hud（CSS 变量）消费，而 hud ↔ world 不能互相 import
 *   （总线铁律）。故事实落 core 共用底座，两侧各留一个门面：world 侧是本文件，
 *   hud 侧是 src/hud/theme/visual-tokens.ts。门面不同，事实只有一份。
 */

import { VISUAL_PALETTE, hexToNumber } from '../core/theme/visual-spec';

export { VISUAL_METRICS, VISUAL_PALETTE, hexToNumber, hexToRgba } from '../core/theme/visual-spec';

/** 战场调色板（Phaser 数字色）。色值由唯一事实源换算而来，不另立一份表。 */
export const WORLD_PALETTE = Object.freeze({
  /** 背景基底。 */
  background: hexToNumber(VISUAL_PALETTE.background),
  /** 网格线。 */
  grid: hexToNumber(VISUAL_PALETTE.grid),
  /** 我方单位主色。 */
  unit: hexToNumber(VISUAL_PALETTE.unit),
  /** 进度 / 施工。 */
  progress: hexToNumber(VISUAL_PALETTE.progress),
  /** 完成 / 成功。 */
  success: hexToNumber(VISUAL_PALETTE.success),
  /** 报错 / 卡住。 */
  danger: hexToNumber(VISUAL_PALETTE.danger),
  /** 事件流 / 装饰。 */
  accent: hexToNumber(VISUAL_PALETTE.accent),
});
