/**
 * 文件职责：**HUD 侧的调色板注入器** —— 把唯一事实源（core/theme/visual-spec.ts）的七色
 *   语义色注入成 CSS 自定义属性（`--srf-visual-*`），供 HUD 组件按变量取色。
 *   来源：docs/DEMO-PLAN.md §1（调色板与 Design Token）。
 * 输入：无（读唯一事实源的常量；DOM 只写 document.head）。
 * 输出：`<style id="srf-visual-tokens">`（含 `:root { --srf-visual-*: #rrggbb; }`）。
 * 禁止事项：
 *   1. import world / phaser —— 铁律：hud 只认识 core；
 *   2. 在本文件里另抄一份色值 —— 色值只在 core/theme/visual-spec.ts 一处，这里只做「常量 → CSS」翻译；
 *   3. 写组件级样式 —— 本文件只发 token，组件样式归属各 Web Component；
 *   4. 改 document.body —— 只允许写 document.head。
 *
 * why 单独一层「视觉 token」而不是并进 tokens-*.css：tokens-*.css 是**皮肤层**
 *   （chrome 配色：面板底色、边框、字色，共 8 套皮肤）；调色板是**场景层**
 *   （战场语义色：背景 / 网格 / 单位 / 进度 / 完成 / 报错 / 装饰，共 1 套）。
 *   两层正交 —— 单色皮肤（mono）也仍然需要场景语义色，故不能塞进皮肤文件里逐份抄。
 *
 * 用法：组合根（app/main/main-entry.ts）挂载时调一次 `installVisualTokens()`。
 */

import { PALETTE_CSS_VARS, VISUAL_PALETTE, type PaletteKey } from '../../core/theme/visual-spec';

/** 注入样式的稳定 id（幂等覆盖，便于重复调用与测试定位）。 */
export const VISUAL_TOKEN_STYLE_ID = 'srf-visual-tokens';

/** 语义色键的稳定次序（注入顺序 = 变量书写顺序，便于 diff）。 */
const PALETTE_KEYS: readonly PaletteKey[] = [
  'background',
  'grid',
  'unit',
  'progress',
  'success',
  'danger',
  'accent',
];

/**
 * 生成调色板 CSS 文本。
 * 纯函数（不碰 DOM）—— 单测直接断言文本内容，不起浏览器。
 */
export function buildVisualTokenCss(): string {
  const lines = PALETTE_KEYS.map((key) => `  ${PALETTE_CSS_VARS[key]}: ${VISUAL_PALETTE[key]};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}

/**
 * 把调色板 token 注入 document.head（幂等：同 id 重复注入覆盖旧标签）。
 * 返回卸载闭包（拔掉这张样式表）。
 */
export function installVisualTokens(doc: Document = document): () => void {
  doc.getElementById(VISUAL_TOKEN_STYLE_ID)?.remove();
  const style = doc.createElement('style');
  style.id = VISUAL_TOKEN_STYLE_ID;
  style.setAttribute('data-srf-visual-tokens', 'true');
  style.textContent = buildVisualTokenCss();
  doc.head.appendChild(style);
  return () => style.remove();
}
