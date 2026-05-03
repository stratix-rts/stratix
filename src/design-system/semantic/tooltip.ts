/**
 * Tooltip / Popover 语义 Token
 *
 * 使用方法：
 * import { getTooltipSemantic } from '@/design-system/semantic/tooltip';
 * import { getCurrentTheme } from '@/design-system/config';
 *
 * const theme = getCurrentTheme();
 * const tooltip = getTooltipSemantic(theme).default;
 */

import type { DesignSystemTokens } from '../types';

import type { TooltipSemanticSet, TooltipSemanticToken } from './_generator';
import { generateTooltipSemantic } from './_generator';

export type { TooltipSemanticSet, TooltipSemanticToken };

/**
 * 获取 Tooltip 语义 Token（主题感知）
 */
export function getTooltipSemantic(theme: DesignSystemTokens): TooltipSemanticSet {
  return generateTooltipSemantic(
    theme.colors,
    theme.radii,
    theme.shadows
  );
}

/**
 * 快速获取单个 Tooltip 变体样式
 */
export function getTooltipVariant(
  theme: DesignSystemTokens,
  variant: keyof TooltipSemanticSet
): TooltipSemanticToken {
  return getTooltipSemantic(theme)[variant];
}

/**
 * 创建 Tooltip CSS 变量
 */
export function generateTooltipCSSVariables(theme: DesignSystemTokens): string {
  const tooltips = getTooltipSemantic(theme);
  const variables: string[] = [];

  (Object.keys(tooltips) as Array<keyof TooltipSemanticSet>).forEach((variant) => {
    const t = tooltips[variant];
    const prefix = `--tooltip-${variant}`;
    variables.push(`${prefix}-bg: ${t.background};`);
    variables.push(`${prefix}-text: ${t.text};`);
    variables.push(`${prefix}-border: ${t.border};`);
    variables.push(`${prefix}-shadow: ${t.shadow};`);
    variables.push(`${prefix}-radius: ${t.borderRadius};`);
    variables.push(`${prefix}-padding: ${t.padding};`);
    variables.push(`${prefix}-arrow: ${t.arrowColor};`);
  });

  return variables.join('\n');
}

/**
 * 应用 Tooltip 样式到 DOM 元素
 */
export function applyTooltipStyles(
  element: HTMLElement,
  token: TooltipSemanticToken
): void {
  if (!element) {
    console.warn('[applyTooltipStyles] element is required');
    return;
  }
  element.style.backgroundColor = token.background;
  element.style.color = token.text;
  element.style.border = token.border;
  element.style.boxShadow = token.shadow;
  element.style.borderRadius = token.borderRadius;
  element.style.padding = token.padding;
}
