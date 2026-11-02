/**
 * 文件职责：**视觉常量的唯一事实源** —— 调色板（七色语义色）/ 尺寸 / 时长 / easing / 演示模式参数。
 *   来源：docs/DEMO-PLAN.md §1（调色板与 Design Token）+ §8（演示模式）。
 * 输入：无（纯静态常量；零 IO、零 DOM、零 import）。
 * 输出：VISUAL_PALETTE（色值）/ VISUAL_METRICS（尺寸·时长·easing）/ DEMO_MODE（演示模式参数）
 *      / PALETTE_CSS_VARS（语义色 → CSS 变量名的映射）/ hexToNumber（色值换算）。
 * 禁止事项：
 *   1. import world / hud / phaser / 任何 DOM —— 本模块是**叶子常量**，谁都能引，谁都不许它引；
 *   2. 依赖运行时状态（时间、随机、localStorage）—— 常量必须是常量；
 *   3. 在本模块内做「按皮肤改色」的推导 —— 皮肤是 chrome 层，场景调色板是场景层，两层分开；
 *   4. 复制第二份色表 —— 世界侧门面在 src/world/visual-spec.ts，HUD 侧注入在
 *      src/hud/theme/visual-tokens.ts，两者都从这里取色，不各自抄一份。
 *
 * ★ 为什么落在 core/theme/ 而不是 world/（与 skin-registry.ts 同一条纪律）：
 *   这份调色板有**两个消费者** —— 战场侧（world，Phaser 数字色）与 HUD 侧（hud，CSS 变量）。
 *   按 §1 通信铁律「任何 hud ↔ world 直接调用 = 架构违规」，两侧不能互相 import；
 *   而 world 只允许认识 core。故「唯一事实源」必须落在两侧共用的 core —— 与皮肤登记表
 *   （core/theme/skin-registry.ts）同一处境、同一解法。
 *   world 侧的入口仍是 src/world/visual-spec.ts（门面 + Phaser 数字色），hud 侧是
 *   src/hud/theme/visual-tokens.ts（注入 CSS 变量）—— 门面不同，事实只有一份。
 */

/** 语义色键（七色）。键名即语义，值即色值 —— 键名不许带修饰词（换肤在 skin 层做）。 */
export type PaletteKey =
  /** 背景基底（深夜蓝渐变的底色）。 */
  | 'background'
  /** 网格线（低亮度）。 */
  | 'grid'
  /** 我方单位主色（青蓝）。 */
  | 'unit'
  /** 进度 / 施工（琥珀）。 */
  | 'progress'
  /** 完成 / 成功（翠绿）。 */
  | 'success'
  /** 报错 / 卡住（绯红）。 */
  | 'danger'
  /** 事件流 / 装饰（紫）。 */
  | 'accent';

/**
 * 调色板（DEMO-PLAN §1 表，逐字照抄 —— 这是「唯一事实源」的含义：改这里，别处跟着改）。
 * 只冻结语义色；皮肤（chrome）色仍在 skin-registry + tokens-*.css，两层互不覆盖。
 */
export const VISUAL_PALETTE: Readonly<Record<PaletteKey, string>> = Object.freeze({
  background: '#0d1126',
  grid: '#1a2140',
  unit: '#4fc3f7',
  progress: '#f0a020',
  success: '#2ecc71',
  danger: '#ff5470',
  accent: '#8a6bff',
});

/**
 * 语义色 → HUD CSS 变量名。
 * why 单独一张表：注入器（hud/theme/visual-tokens.ts）按这张表生成 CSS，
 *   变量名只有这一处约定，改名不会漏改一处。
 */
export const PALETTE_CSS_VARS: Readonly<Record<PaletteKey, string>> = Object.freeze({
  background: '--srf-visual-background',
  grid: '--srf-visual-grid',
  unit: '--srf-visual-unit',
  progress: '--srf-visual-progress',
  success: '--srf-visual-success',
  danger: '--srf-visual-danger',
  accent: '--srf-visual-accent',
});

/**
 * 十六进制色 → 数字色（Phaser 的 0xRRGGBB）。
 * 只吃 6 位 `#rrggbb`（本模块的色值都是这个形态）；不合法的输入抛错 —— 静默吞掉会让
 * 战场画出一个说不清来源的颜色，比报错难查得多。
 */
export function hexToNumber(hex: string): number {
  const normalized = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`[visual-spec] not a #rrggbb color: ${hex}`);
  }
  return Number.parseInt(normalized, 16);
}

/**
 * 十六进制色 → `rgba(...)` 字符串（带透明度）。
 * 用于「同一语义色 + 不同 alpha」的场合（战场浮标底衬等）—— 免得为了半透明再抄一份 rgba 字面量。
 */
export function hexToRgba(hex: string, alpha: number): string {
  const value = hexToNumber(hex);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** 尺寸 / 时长 / easing 规范（DEMO-PLAN §1「尺寸/时长规范」）。 */
export const VISUAL_METRICS = Object.freeze({
  /** 单位命中盒（px）。 */
  unitHitboxPx: 48,
  /** hover 放大倍率。 */
  hoverScale: 1.1,
  /** 入场：ease Back.Out，250ms。 */
  enter: Object.freeze({ ease: 'Back.Out', durationMs: 250 }),
  /** 退场：ease Cubic.In，300ms。 */
  exit: Object.freeze({ ease: 'Cubic.In', durationMs: 300 }),
  /** 摄像机移动：ease Cubic.easeInOut，600ms。 */
  camera: Object.freeze({ ease: 'Cubic.easeInOut', durationMs: 600 }),
});

/**
 * 演示模式参数（DEMO-PLAN §8）。
 * 字号放大倍率 1.3 = 「字号 +30%」；storageKey 是开关记忆的 localStorage 键。
 */
export const DEMO_MODE = Object.freeze({
  /** localStorage 键名（值 'on' / 'off'）。 */
  storageKey: 'stratix.demo-mode',
  /** 字号放大倍率（1.3 = +30%）。 */
  fontScale: 1.3,
});
