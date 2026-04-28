/**
 * Card 语义 Token（与 Panel 区分）
 *
 * Card 更侧重于内容展示，Panel 更侧重于容器布局
 */

import type { DesignSystemTokens } from '../types';

import type { CardSemanticSet, CardSemanticToken } from './_generator';
import { generateCardSemantic } from './_generator';

export type { CardSemanticSet, CardSemanticToken };

/**
 * 获取 Card 语义 Token（主题感知）
 */
export function getCardSemantic(theme: DesignSystemTokens): CardSemanticSet {
  return generateCardSemantic(
    theme.colors,
    theme.radii,
    theme.shadows
  );
}

/**
 * 快速获取单个 Card 变体样式
 */
export function getCardVariant(
  theme: DesignSystemTokens,
  variant: keyof CardSemanticSet
): CardSemanticToken {
  return getCardSemantic(theme)[variant];
}

/**
 * 创建 Card CSS 变量
 */
export function generateCardCSSVariables(theme: DesignSystemTokens): string {
  const cards = getCardSemantic(theme);
  const variables: string[] = [];

  (Object.keys(cards) as Array<keyof CardSemanticSet>).forEach((variant) => {
    const card = cards[variant];
    const prefix = `--card-${variant}`;
    variables.push(`${prefix}-bg: ${card.background};`);
    variables.push(`${prefix}-border: ${card.border};`);
    variables.push(`${prefix}-radius: ${card.borderRadius};`);
    variables.push(`${prefix}-shadow: ${card.shadow};`);
    variables.push(`${prefix}-padding: ${card.padding};`);
    variables.push(`${prefix}-header-bg: ${card.headerBackground};`);
    variables.push(`${prefix}-footer-bg: ${card.footerBackground};`);
  });

  return variables.join('\n');
}

/**
 * 应用 Card 样式到 DOM 元素
 */
export function applyCardStyles(
  element: HTMLElement,
  token: CardSemanticToken
): void {
  element.style.backgroundColor = token.background;
  element.style.border = token.border;
  element.style.borderRadius = token.borderRadius;
  element.style.boxShadow = token.shadow;
  element.style.padding = token.padding;
}
