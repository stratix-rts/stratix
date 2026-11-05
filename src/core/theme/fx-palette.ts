/**
 * 文件职责：**代码路由特效的运行时调色板契约**（@since v3.3，task_162）。
 *   一期（task_161）走 sprite sheet 静态管线：调色板在**生成期**烘进 PNG，
 *   换皮肤要重跑 `npm run fx:generate`。二期代码路由要的是「热读取」——
 *   皮肤切了，**下一个**特效实例立刻用新色，不用重跑任何脚本。
 *
 * 本模块只定义**词汇**：角色（槽位）↔ HUD 皮肤 token 名 ↔ 兜底色。
 *   它不读 CSS、不读 DOM、不认识 Phaser —— core 是 hud 与 world 两侧共用的唯一事实源，
 *   按 §1 通信铁律，hud ↔ world 不能直接互认，共同词汇只能落在 core。
 *
 * 三层分工（谁读什么）：
 *   - hud/theme/fx-palette-reader.ts：读 DOM 里的 CSS 变量 → 「token 名 → 色值」表；
 *   - app/main/main-entry.ts（组合根）：把这张表塞进 Phaser game registry（唯一同时认识两侧的地方）；
 *   - world/appearance/fx-palette.ts：从 registry 读表 → 解析成 FxPalette（缺项走兜底）。
 *
 * 禁止事项：
 *   1. 在本模块里 import hud / world / phaser / DOM —— 它是叶子常量；
 *   2. 复制第二份色表 —— 兜底色只此一份；
 *   3. 把「战场语义色」（VISUAL_PALETTE）混进来 —— 那是场景层，与皮肤无关（见 visual-spec.ts）。
 */

/** 特效调色板的角色（槽位）—— 键名即语义，不带修饰词。 */
export type FxPaletteRole =
  /** 主强调色（--srf-accent）。 */
  | 'accent'
  /** 徽标色（--srf-badge-accent）—— 与单位染色同源。 */
  | 'badgeAccent'
  /** 危险 / 报错色（--srf-danger）。 */
  | 'danger'
  /** 成功 / 完成色（--srf-success）。 */
  | 'success'
  /** 警告 / 提醒色（--srf-warn）。 */
  | 'warn'
  /** 主文本色（--srf-text）。 */
  | 'text'
  /** 次级文本色（--srf-text-muted）。 */
  | 'textMuted';

/**
 * 角色 → HUD 皮肤 token 名（CSS 自定义属性）。
 *
 * why 指向 token 而不是直接写色值：色值的事实源是皮肤样式表
 *   （src/hud/theme/tokens-<skin>.css），本表只说「这个槽位取哪个 token」。
 * why 只有 7 个角色：特效需要的语义色就这几类 —— 角色多于槽位会让读表的人无从下手。
 */
export const FX_PALETTE_ROLES: Readonly<Record<FxPaletteRole, string>> = Object.freeze({
  accent: '--srf-accent',
  badgeAccent: '--srf-badge-accent',
  danger: '--srf-danger',
  success: '--srf-success',
  warn: '--srf-warn',
  text: '--srf-text',
  textMuted: '--srf-text-muted',
});

/**
 * 兜底色：token 读不到时用（皮肤样式表没装 / 元素不存在 / 值非法）。
 * 取默认皮肤（tokens-default.css）的值 —— 读不到时回到「默认长相」，而不是黑屏。
 */
export const FX_PALETTE_FALLBACK: Readonly<Record<FxPaletteRole, string>> = Object.freeze({
  accent: '#6ea8ff',
  badgeAccent: '#7fb3ff',
  danger: '#e06c75',
  success: '#6fcf97',
  warn: '#f0c674',
  text: '#e6e9ef',
  textMuted: '#9aa3b2',
});

/** 一份完整的特效调色板（角色 → '#rrggbb'）。 */
export type FxPalette = Readonly<Record<FxPaletteRole, string>>;

/** 合法的 CSS 十六进制色（#rgb / #rrggbb / #rrggbbaa）。 */
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * 把「token 名 → 色值」的原始表解析成一份调色板。
 *
 * @param raw 原始表（形状不限：registry 里存什么都能吃）；取不到 / 值非法 → 走兜底色。
 * @returns 冻结的调色板（角色齐全，缺项已补）。
 */
export function resolveFxPalette(raw: unknown): FxPalette {
  const source = isRecord(raw) ? raw : {};
  const resolved = {} as Record<FxPaletteRole, string>;
  for (const role of Object.keys(FX_PALETTE_ROLES) as FxPaletteRole[]) {
    const tokenName = FX_PALETTE_ROLES[role];
    const value = source[tokenName];
    resolved[role] =
      typeof value === 'string' && HEX_COLOR.test(value.trim())
        ? value.trim()
        : FX_PALETTE_FALLBACK[role];
  }
  return Object.freeze(resolved);
}

/** 是不是一个普通对象（数组 / null / 原始值都不算）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
