/**
 * Divider / Separator 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { DividerSemanticToken } from './_generator';
import { generateDividerSemantic } from './_generator';

export type { DividerSemanticToken };

/**
 * 获取 Divider 语义 Token（主题感知）
 */
export function getDividerSemantic(theme: DesignSystemTokens): DividerSemanticToken {
  return generateDividerSemantic(theme.colors);
}

/**
 * 创建 Divider CSS 变量
 */
export function generateDividerCSSVariables(theme: DesignSystemTokens): string {
  const divider = getDividerSemantic(theme);
  return `
    --divider-color: ${divider.color};
    --divider-width: ${divider.width};
    --divider-style: ${divider.style};
    --divider-margin: ${divider.margin};
  `;
}

/**
 * 应用 Divider 样式到 DOM 元素
 */
export function applyDividerStyles(
  element: HTMLElement,
  token: DividerSemanticToken
): void {
  element.style.backgroundColor = token.color;
  element.style.height = token.width;
  element.style.border = 'none';
  element.style.margin = token.margin;
}
