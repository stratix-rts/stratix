/**
 * 表单语义 Token
 * 
 * 用于统一表单组件的视觉样式：
 * - FormLabel 表单标签
 * - FormField 表单字段
 * - FormHelp 帮助文本
 * - FormError 错误提示
 * 
 * 使用方法：
 * import { getFormSemantic } from '@/design-system/semantic/forms';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const formStyles = getFormSemantic(theme);
 * 
 * // 标签样式
 * label.style.color = formStyles.label.color;
 * label.style.fontSize = formStyles.label.fontSize;
 * 
 * // 帮助文本样式
 * helpText.style.color = formStyles.helpText.color;
 * helpText.style.fontSize = formStyles.helpText.fontSize;
 */

import type { FormSemanticSet } from './_generator';
import { generateFormSemantic } from './_generator';
import type { DesignSystemTokens } from '../types';

// 重新导出类型
export type { FormSemanticSet };

/**
 * 表单尺寸规范
 */
export const FormSizes = {
  sm: {
    height: '32px',
    padding: '4px 8px',
    fontSize: '12px',
    labelFontSize: '11px',
  },
  md: {
    height: '40px',
    padding: '8px 12px',
    fontSize: '14px',
    labelFontSize: '13px',
  },
  lg: {
    height: '48px',
    padding: '12px 16px',
    fontSize: '16px',
    labelFontSize: '14px',
  },
} as const;

export type FormSize = keyof typeof FormSizes;

/**
 * 获取表单语义 Token（主题感知）
 * 
 * @param theme - 当前主题 Token 集合
 * @returns 完整的表单语义 Token 集合
 * 
 * @example
 * const theme = getCurrentTheme();
 * const form = getFormSemantic(theme);
 * 
 * // 必填标记颜色
 * requiredMarker.style.color = form.label.requiredColor;
 * 
 * // 表单布局间距
 * formContainer.style.gap = form.layout.gap;
 */
export function getFormSemantic(theme: DesignSystemTokens): FormSemanticSet {
  return generateFormSemantic(theme.colors as any);
}

/**
 * 创建表单 CSS 变量
 * 
 * @param theme - 当前主题 Token 集合
 * @returns CSS 变量字符串
 */
export function generateFormCSSVariables(theme: DesignSystemTokens): string {
  const form = getFormSemantic(theme);
  
  return `
    --form-label-color: ${form.label.color};
    --form-label-required: ${form.label.requiredColor};
    --form-label-font-size: ${form.label.fontSize};
    --form-label-font-weight: ${form.label.fontWeight};
    
    --form-help-color: ${form.helpText.color};
    --form-help-error: ${form.helpText.errorColor};
    --form-help-success: ${form.helpText.successColor};
    --form-help-font-size: ${form.helpText.fontSize};
    
    --form-fieldset-border: ${form.fieldset.border};
    --form-fieldset-bg: ${form.fieldset.background};
    
    --form-layout-gap: ${form.layout.gap};
    --form-layout-label-gap: ${form.layout.labelGap};
    --form-layout-field-margin: ${form.layout.fieldMarginBottom};
  `;
}

/**
 * 获取表单尺寸配置
 * 
 * @param size - 尺寸名称
 * @returns 尺寸配置
 */
export function getFormSize(size: FormSize) {
  return FormSizes[size];
}

// ============ 向后兼容的常量导出（Cyberpunk 主题默认值） ============

/**
 * @deprecated 使用 getFormSemantic(theme) 替代
 * 这个常量仅作为向后兼容，始终是 Cyberpunk 主题的值
 */
export const FormSemantic = {
  field: {
    default: {
      background: '#1a1a2e',
      border: '#2a2a3e',
      text: '#ffffff',
    },
    hover: {
      background: '#2a2a3e',
      border: '#3a3a5e',
    },
    focus: {
      border: '#00ffff',
      shadow: 'rgba(0, 255, 255, 0.15)',
    },
    error: {
      border: '#ff4444',
      shadow: 'rgba(255, 68, 68, 0.15)',
      text: '#ff4444',
    },
    success: {
      border: '#00ff88',
      shadow: 'rgba(0, 255, 136, 0.15)',
    },
    disabled: {
      background: '#12121a',
      text: '#6a6a8a',
      opacity: 0.5,
    },
  },
  
  label: {
    default: {
      color: '#a0a0b0',
      fontSize: '13px',
      fontWeight: 500,
    },
    required: {
      color: '#ff4444',
      marker: '*',
    },
    optional: {
      color: '#6a6a8a',
    },
  },
  
  helpText: {
    default: {
      color: '#6a6a8a',
      fontSize: '12px',
    },
    error: {
      color: '#ff4444',
    },
    success: {
      color: '#00ff88',
    },
  },
  
  layout: {
    gap: '16px',
    fieldMarginBottom: '8px',
    actionsGap: '12px',
    actionsPaddingTop: '16px',
  },
} as const;
