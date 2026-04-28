/**
 * Navigation 语义 Token
 *
 * 独立的导航语义文件，与 _generator.ts 中的定义保持一致
 */

import type { DesignSystemTokens } from '../types';

import type { NavigationSemanticSet } from './_generator';
import { generateNavigationSemantic } from './_generator';

export type { NavigationSemanticSet };

/**
 * 获取 Navigation 语义 Token（主题感知）
 */
export function getNavigationSemantic(theme: DesignSystemTokens): NavigationSemanticSet {
  return generateNavigationSemantic(theme.colors);
}

/**
 * 创建 Navigation CSS 变量
 */
export function generateNavigationCSSVariables(theme: DesignSystemTokens): string {
  const nav = getNavigationSemantic(theme);
  return `
    --nav-bg: ${nav.background};
    --nav-item-default-bg: ${nav.itemDefault.background};
    --nav-item-default-text: ${nav.itemDefault.text};
    --nav-item-hover-bg: ${nav.itemHover.background};
    --nav-item-hover-text: ${nav.itemHover.text};
    --nav-item-active-bg: ${nav.itemActive.background};
    --nav-item-active-text: ${nav.itemActive.text};
    --nav-item-active-indicator: ${nav.itemActive.indicator};
    --nav-divider: ${nav.divider};
  `;
}
