/**
 * 文件职责：**从 DOM 里热读皮肤 token**（@since v3.3，task_162）。
 *   HUD 是唯一能碰 DOM 的一层（world 零 DOM，见 world/motion.ts 的同款口径），
 *   所以「皮肤当前长什么样」这件事只有这里能问。
 *
 * 输入：document（可注入，便于单测）。
 * 输出：「CSS 变量名 → 色值」表（只含解析得到的 token；解析不到的直接不出现）。
 * 禁止事项：
 *   1. import world / core 的运行时逻辑 —— 本模块只依赖 core 的**词汇表**
 *      （core/theme/fx-palette.ts 的 FX_PALETTE_ROLES）；
 *   2. 自己缓存结果 —— 皮肤随时能切，缓存 = 读到旧色（宁可每次现取）；
 *   3. 往 DOM 里写东西 —— 只读。
 *
 * ★ 为什么热读是可靠的：皮肤切换的机制是「把各皮肤的 <style> 元素的 disabled 属性翻一翻」
 *   （hud/theme/theme-controller.ts）—— 所有皮肤的 token 表**同时在文档里**，
 *   只是没启用的那个不生效。getComputedStyle 只认生效的那份 → 读到的永远是当前皮肤。
 */

import { FX_PALETTE_ROLES } from '../../core/theme/fx-palette';

/** 读出来的原始表：CSS 变量名 → 色值。 */
export type FxPaletteTokenTable = Readonly<Record<string, string>>;

/**
 * 读当前生效皮肤的 token 色值。
 *
 * @param doc 文档（缺省用全局 document）。
 * @returns 「token 名 → 色值」表；元素或样式表不可用时返回空表（下游会走兜底色）。
 */
export function readFxPaletteTokens(doc: Document = document): FxPaletteTokenTable {
  const root = doc?.documentElement;
  if (!root || typeof doc.defaultView?.getComputedStyle !== 'function') return {};
  const computed = doc.defaultView.getComputedStyle(root);
  const table: Record<string, string> = {};
  for (const tokenName of Object.values(FX_PALETTE_ROLES)) {
    const value = computed.getPropertyValue(tokenName).trim();
    if (value) table[tokenName] = value;
  }
  return Object.freeze(table);
}
