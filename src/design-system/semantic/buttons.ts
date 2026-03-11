/**
 * 按钮语义 Token
 * 
 * 使用方法：
 * import { getButtonSemantic } from '@/design-system/semantic/buttons';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const btnStyle = getButtonSemantic(theme).primary;
 */

import type { 
  ButtonSemanticSet, 
  ButtonSemanticToken 
} from './_generator';
import { generateButtonSemantic } from './_generator';
import type { DesignSystemTokens } from '../types';

// 重新导出类型
export type { ButtonSemanticSet, ButtonSemanticToken };

/**
 * 获取按钮语义 Token（主题感知）
 * 
 * @param theme - 当前主题 Token 集合
 * @returns 完整的按钮语义 Token 集合
 * 
 * @example
 * const theme = getCurrentTheme();
 * const buttons = getButtonSemantic(theme);
 * 
 * // 使用主按钮样式
 * button.style.backgroundColor = buttons.primary.background;
 * button.style.color = buttons.primary.text;
 */
export function getButtonSemantic(theme: DesignSystemTokens): ButtonSemanticSet {
  return generateButtonSemantic(
    theme.colors as any,
    theme.radii as any
  );
}

/**
 * 快速获取单个按钮变体样式
 * 
 * @param theme - 当前主题 Token 集合
 * @param variant - 按钮变体名称
 * @returns 按钮样式配置
 * 
 * @example
 * const primaryBtn = getButtonVariant(theme, 'primary');
 * const ghostBtn = getButtonVariant(theme, 'ghost');
 */
export function getButtonVariant(
  theme: DesignSystemTokens,
  variant: keyof ButtonSemanticSet
): ButtonSemanticToken {
  return getButtonSemantic(theme)[variant];
}

/**
 * 创建按钮 CSS 变量
 * 
 * 生成 CSS 变量字符串，可用于注入到文档中
 * 
 * @param theme - 当前主题 Token 集合
 * @returns CSS 变量字符串
 */
export function generateButtonCSSVariables(theme: DesignSystemTokens): string {
  const buttons = getButtonSemantic(theme);
  const variables: string[] = [];
  
  (Object.keys(buttons) as Array<keyof ButtonSemanticSet>).forEach((variant) => {
    const btn = buttons[variant];
    const prefix = `--btn-${variant}`;
    
    variables.push(`${prefix}-bg: ${btn.background};`);
    variables.push(`${prefix}-bg-hover: ${btn.backgroundHover};`);
    variables.push(`${prefix}-bg-active: ${btn.backgroundActive};`);
    variables.push(`${prefix}-text: ${btn.text};`);
    variables.push(`${prefix}-border: ${btn.border};`);
    variables.push(`${prefix}-radius: ${btn.borderRadius};`);
    variables.push(`${prefix}-padding: ${btn.padding};`);
    
    if (btn.shadow) {
      variables.push(`${prefix}-shadow: ${btn.shadow};`);
    }
    if (btn.shadowHover) {
      variables.push(`${prefix}-shadow-hover: ${btn.shadowHover};`);
    }
  });
  
  return variables.join('\n');
}

/**
 * 应用按钮样式到 DOM 元素
 * 
 * @param element - 目标按钮元素
 * @param token - 按钮语义 Token
 */
export function applyButtonStyles(
  element: HTMLElement, 
  token: ButtonSemanticToken
): void {
  element.style.backgroundColor = token.background;
  element.style.color = token.text;
  element.style.border = token.border;
  element.style.borderRadius = token.borderRadius;
  element.style.padding = token.padding;
  
  if (token.shadow) {
    element.style.boxShadow = token.shadow;
  }
}

// ============ 向后兼容的常量导出（Cyberpunk 主题默认值） ============

/**
 * @deprecated 使用 getButtonSemantic(theme) 替代
 * 这个常量仅作为向后兼容，始终是 Cyberpunk 主题的值
 */
export const ButtonSemantic = {
  primary: {
    background: '#00ffff',
    backgroundHover: '#00e6e6',
    backgroundActive: '#00cccc',
    text: '#0d0d14',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 20px',
    shadow: '0 2px 4px rgba(0, 255, 255, 0.25)',
    shadowHover: '0 4px 8px rgba(0, 255, 255, 0.38)',
  },
  
  secondary: {
    background: '#12121a',
    backgroundHover: '#1a1a2e',
    backgroundActive: '#3a3a5e',
    text: '#00ffff',
    border: '1px solid #00ffff',
    borderRadius: '4px',
    padding: '10px 20px',
  },
  
  tertiary: {
    background: '#1a1a2e',
    backgroundHover: '#2a2a3e',
    backgroundActive: '#3a3a5e',
    text: '#ffffff',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '10px 20px',
  },
  
  success: {
    background: '#00ff88',
    backgroundHover: '#00e67a',
    backgroundActive: '#00cc70',
    text: '#0d0d14',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 20px',
  },
  
  danger: {
    background: '#ff4444',
    backgroundHover: '#ff3333',
    backgroundActive: '#ff2222',
    text: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 20px',
  },
  
  warning: {
    background: '#fbbf24',
    backgroundHover: '#f5b014',
    backgroundActive: '#e6a010',
    text: '#0d0d14',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 20px',
  },
  
  ghost: {
    background: 'transparent',
    backgroundHover: 'rgba(0, 255, 255, 0.08)',
    backgroundActive: 'rgba(0, 255, 255, 0.15)',
    text: '#00ffff',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 20px',
  },
  
  disabled: {
    background: '#1e1e2e',
    backgroundHover: '#1e1e2e',
    backgroundActive: '#1e1e2e',
    text: '#4a4a6a',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 20px',
  },
} as const;

/**
 * @deprecated 使用 getButtonVariant(theme, variant) 替代
 */
export function getButtonStyle(variant: keyof typeof ButtonSemantic) {
  return ButtonSemantic[variant];
}
