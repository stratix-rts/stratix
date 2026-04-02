/**
 * 输入框语义 Token
 * 
 * 使用方法：
 * import { getInputSemantic } from '@/design-system/semantic/inputs';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const inputStates = getInputSemantic(theme);
 * 
 * // 应用默认状态
 * input.style.backgroundColor = inputStates.default.background;
 * input.style.borderColor = inputStates.default.border;
 * 
 * // 聚焦时切换
 * input.addEventListener('focus', () => {
 *   input.style.borderColor = inputStates.focus.border;
 *   input.style.boxShadow = inputStates.focus.shadow;
 * });
 */

import type { DesignSystemTokens } from '../types';

import type { 
  InputSemanticSet, 
  InputStateToken 
} from './_generator';
import { generateInputSemantic } from './_generator';

// 重新导出类型
export type { InputSemanticSet, InputStateToken };

/**
 * 获取输入框语义 Token（主题感知）
 * 
 * @param theme - 当前主题 Token 集合
 * @returns 完整的输入框语义 Token 集合，包含所有状态
 * 
 * @example
 * const theme = getCurrentTheme();
 * const inputStates = getInputSemantic(theme);
 * 
 * // 验证错误时
 * if (hasError) {
 *   input.style.borderColor = inputStates.error.border;
 *   input.style.boxShadow = inputStates.error.shadow;
 * }
 */
export function getInputSemantic(theme: DesignSystemTokens): InputSemanticSet {
  return generateInputSemantic(theme.colors as any);
}

/**
 * 快速获取特定状态的输入框样式
 * 
 * @param theme - 当前主题 Token 集合
 * @param state - 输入框状态
 * @returns 该状态的样式配置
 */
export function getInputState(
  theme: DesignSystemTokens,
  state: keyof InputSemanticSet
): InputStateToken {
  return getInputSemantic(theme)[state];
}

/**
 * 创建输入框 CSS 变量
 * 
 * @param theme - 当前主题 Token 集合
 * @returns CSS 变量字符串
 */
export function generateInputCSSVariables(theme: DesignSystemTokens): string {
  const inputs = getInputSemantic(theme);
  const variables: string[] = [];
  
  (Object.keys(inputs) as Array<keyof InputSemanticSet>).forEach((state) => {
    const input = inputs[state];
    const prefix = `--input-${state}`;
    
    variables.push(`${prefix}-bg: ${input.background};`);
    variables.push(`${prefix}-border: ${input.border};`);
    variables.push(`${prefix}-text: ${input.text};`);
    variables.push(`${prefix}-placeholder: ${input.placeholder};`);
    
    if (input.shadow) {
      variables.push(`${prefix}-shadow: ${input.shadow};`);
    }
  });
  
  return variables.join('\n');
}

/**
 * 应用输入框样式到 DOM 元素
 * 
 * @param element - 目标输入框元素
 * @param token - 输入框状态 Token
 * @param radii - 圆角值（可选）
 * @param padding - 内边距（可选）
 */
export function applyInputStyles(
  element: HTMLElement, 
  token: InputStateToken,
  radii?: string,
  padding?: string
): void {
  element.style.backgroundColor = token.background;
  element.style.border = `1px solid ${token.border}`;
  element.style.color = token.text;
  
  // 设置 placeholder 颜色通过 CSS
  element.style.setProperty('--placeholder-color', token.placeholder);
  
  if (token.shadow) {
    element.style.boxShadow = token.shadow;
  }
  
  if (radii) {
    element.style.borderRadius = radii;
  }
  
  if (padding) {
    element.style.padding = padding;
  }
}

/**
 * 检查元素是否为只读（处理不同类型元素）
 */
function isReadOnlyElement(element: HTMLElement): boolean {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.readOnly;
  }
  return false;
}

/**
 * 检查元素是否禁用（处理不同类型元素）
 */
function isDisabledElement(element: HTMLElement): boolean {
  return (element as HTMLInputElement).disabled === true;
}

/**
 * 为输入框添加状态切换事件监听
 * 
 * @param element - 目标输入框元素
 * @param theme - 当前主题 Token 集合
 * @param options - 配置选项
 */
export function bindInputStateEvents(
  element: HTMLElement,
  theme: DesignSystemTokens,
  options?: {
    validate?: () => boolean;  // 验证函数
    radii?: string;
    padding?: string;
  }
): void {
  const states = getInputSemantic(theme);
  const { radii = '4px', padding = '8px 12px' } = options || {};
  
  // 初始状态
  applyInputStyles(element, states.default, radii, padding);
  
  // 悬停状态
  element.addEventListener('mouseenter', () => {
    if (!isDisabledElement(element) && !isReadOnlyElement(element)) {
      applyInputStyles(element, states.hover, radii, padding);
    }
  });
  
  element.addEventListener('mouseleave', () => {
    if (!isDisabledElement(element) && !isReadOnlyElement(element)) {
      if (document.activeElement === element) {
        applyInputStyles(element, states.focus, radii, padding);
      } else {
        applyInputStyles(element, states.default, radii, padding);
      }
    }
  });
  
  // 聚焦状态
  element.addEventListener('focus', () => {
    if (!isDisabledElement(element) && !isReadOnlyElement(element)) {
      applyInputStyles(element, states.focus, radii, padding);
    }
  });
  
  element.addEventListener('blur', () => {
    if (isDisabledElement(element)) {
      applyInputStyles(element, states.disabled, radii, padding);
    } else if (isReadOnlyElement(element)) {
      applyInputStyles(element, states.readonly, radii, padding);
    } else if (options?.validate) {
      const isValid = options.validate();
      applyInputStyles(element, isValid ? states.success : states.error, radii, padding);
    } else {
      applyInputStyles(element, states.default, radii, padding);
    }
  });
}

// ============ 向后兼容的常量导出（Cyberpunk 主题默认值） ============

/**
 * @deprecated 使用 getInputSemantic(theme) 替代
 * 这个常量仅作为向后兼容，始终是 Cyberpunk 主题的值
 */
export const InputSemantic = {
  default: {
    background: '#08080c',
    border: '#2a2a3e',
    text: '#ffffff',
    placeholder: '#6a6a8a',
  },
  
  hover: {
    background: '#08080c',
    border: '#3a3a5e',
    text: '#ffffff',
    placeholder: '#6a6a8a',
  },
  
  focus: {
    background: '#08080c',
    border: '#00ffff',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    shadow: '0 0 0 3px rgba(0, 255, 255, 0.12)',
  },
  
  error: {
    background: '#08080c',
    border: '#ff4444',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    shadow: '0 0 0 3px rgba(255, 68, 68, 0.12)',
  },
  
  success: {
    background: '#08080c',
    border: '#00ff88',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    shadow: '0 0 0 3px rgba(0, 255, 136, 0.12)',
  },
  
  disabled: {
    background: '#12121a',
    border: '#1e1e2e',
    text: '#4a4a6a',
    placeholder: '#4a4a6a',
  },
  
  readonly: {
    background: '#12121a',
    border: '#1e1e2e',
    text: '#a0a0b0',
    placeholder: '#6a6a8a',
  },
} as const;

/**
 * 传统输入框变体配置（保留向后兼容）
 * @deprecated 推荐使用新的状态系统
 */
export const InputVariants = {
  default: {
    background: '#1a1a2e',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '8px 12px',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    focusBorder: '#00ffff',
    errorBorder: '#ff4444',
  },
  
  filled: {
    background: '#08080c',
    border: 'none',
    borderRadius: '4px',
    padding: '10px 14px',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    focusBorder: '#00ffff',
    errorBorder: '#ff4444',
  },
  
  outlined: {
    background: 'transparent',
    border: '1px solid #2a2a3e',
    borderRadius: '4px',
    padding: '8px 12px',
    text: '#ffffff',
    placeholder: '#6a6a8a',
    focusBorder: '#00ffff',
    errorBorder: '#ff4444',
  },
} as const;
