/**
 * 面板语义 Token
 * 
 * 使用方法：
 * import { getPanelSemantic } from '@/design-system/semantic/panels';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const panelStyle = getPanelSemantic(theme).elevated;
 */

import type { DesignSystemTokens } from '../types';

import type { 
  PanelSemanticSet, 
  PanelSemanticToken 
} from './_generator';
import { generatePanelSemantic } from './_generator';

// 重新导出类型
export type { PanelSemanticSet, PanelSemanticToken };

/**
 * 获取面板语义 Token（主题感知）
 * 
 * @param theme - 当前主题 Token 集合
 * @returns 完整的面板语义 Token 集合
 * 
 * @example
 * const theme = getCurrentTheme();
 * const panels = getPanelSemantic(theme);
 * 
 * // 使用浮起面板样式
 * div.style.backgroundColor = panels.elevated.background;
 * div.style.boxShadow = panels.elevated.shadow;
 */
export function getPanelSemantic(theme: DesignSystemTokens): PanelSemanticSet {
  return generatePanelSemantic(
    theme.colors as any,
    theme.radii as any,
    theme.shadows as any
  );
}

/**
 * 快速获取单个面板变体样式
 * 
 * @param theme - 当前主题 Token 集合
 * @param variant - 面板变体名称
 * @returns 面板样式配置
 */
export function getPanelVariant(
  theme: DesignSystemTokens,
  variant: keyof PanelSemanticSet
): PanelSemanticToken {
  return getPanelSemantic(theme)[variant];
}

/**
 * 创建面板 CSS 变量
 * 
 * @param theme - 当前主题 Token 集合
 * @returns CSS 变量字符串
 */
export function generatePanelCSSVariables(theme: DesignSystemTokens): string {
  const panels = getPanelSemantic(theme);
  const variables: string[] = [];
  
  (Object.keys(panels) as Array<keyof PanelSemanticSet>).forEach((variant) => {
    const panel = panels[variant];
    const prefix = `--panel-${variant}`;
    
    variables.push(`${prefix}-bg: ${panel.background};`);
    variables.push(`${prefix}-border: ${panel.border};`);
    variables.push(`${prefix}-radius: ${panel.borderRadius};`);
    variables.push(`${prefix}-padding: ${panel.padding};`);
    variables.push(`${prefix}-shadow: ${panel.shadow};`);
  });
  
  return variables.join('\n');
}

/**
 * 应用面板样式到 DOM 元素
 * 
 * @param element - 目标元素
 * @param token - 面板语义 Token
 */
export function applyPanelStyles(
  element: HTMLElement, 
  token: PanelSemanticToken
): void {
  element.style.backgroundColor = token.background;
  element.style.border = token.border;
  element.style.borderRadius = token.borderRadius;
  element.style.padding = token.padding;
  element.style.boxShadow = token.shadow;
}

// ============ 向后兼容的常量导出（Cyberpunk 主题默认值） ============

/**
 * @deprecated 使用 getPanelSemantic(theme) 替代
 * 这个常量仅作为向后兼容，始终是 Cyberpunk 主题的值
 */
export const PanelSemantic = {
  default: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '16px',
    shadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
  },
  
  elevated: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5e',
    borderRadius: '8px',
    padding: '20px',
    shadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
  },
  
  outlined: {
    background: 'transparent',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '16px',
    shadow: 'none',
  },
  
  ghost: {
    background: 'rgba(18, 18, 26, 0.5)',
    border: 'none',
    borderRadius: '4px',
    padding: '16px',
    shadow: 'none',
  },
  
  sunken: {
    background: '#08080c',
    border: '1px solid #1e1e2e',
    borderRadius: '4px',
    padding: '16px',
    shadow: 'inset 0 2px 4px rgba(0,0,0,0.3)',
  },
} as const;

/**
 * @deprecated 使用 getPanelVariant(theme, variant) 替代
 */
export function getPanelStyle(variant: keyof typeof PanelSemantic) {
  return PanelSemantic[variant];
}
