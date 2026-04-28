/**
 * Badge / Tag 语义 Token
 */

import type { DesignSystemTokens } from '../types';

import type { BadgeSemanticSet, BadgeSemanticToken } from './_generator';
import { generateBadgeSemantic } from './_generator';

export type { BadgeSemanticSet, BadgeSemanticToken };

/**
 * 获取 Badge 语义 Token（主题感知）
 */
export function getBadgeSemantic(theme: DesignSystemTokens): BadgeSemanticSet {
  return generateBadgeSemantic(theme.colors);
}

/**
 * 快速获取单个 Badge 变体样式
 */
export function getBadgeVariant(
  theme: DesignSystemTokens,
  variant: keyof BadgeSemanticSet
): BadgeSemanticToken {
  return getBadgeSemantic(theme)[variant];
}

/**
 * 创建 Badge CSS 变量
 */
export function generateBadgeCSSVariables(theme: DesignSystemTokens): string {
  const badges = getBadgeSemantic(theme);
  const variables: string[] = [];

  (Object.keys(badges) as Array<keyof BadgeSemanticSet>).forEach((variant) => {
    const b = badges[variant];
    const prefix = `--badge-${variant}`;
    variables.push(`${prefix}-bg: ${b.background};`);
    variables.push(`${prefix}-text: ${b.text};`);
    variables.push(`${prefix}-border: ${b.border};`);
    variables.push(`${prefix}-radius: ${b.borderRadius};`);
    variables.push(`${prefix}-padding: ${b.padding};`);
  });

  return variables.join('\n');
}

/**
 * 应用 Badge 样式到 DOM 元素
 */
export function applyBadgeStyles(
  element: HTMLElement,
  token: BadgeSemanticToken
): void {
  element.style.backgroundColor = token.background;
  element.style.color = token.text;
  element.style.border = token.border;
  element.style.borderRadius = token.borderRadius;
  element.style.padding = token.padding;
  element.style.display = 'inline-flex';
  element.style.alignItems = 'center';
  element.style.fontSize = '12px';
  element.style.fontWeight = '500';
  element.style.lineHeight = '1';
}
