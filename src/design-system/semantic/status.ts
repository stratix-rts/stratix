/**
 * 状态/反馈语义 Token
 * 
 * 用于：
 * - Alert 警告提示
 * - Toast 轻提示
 * - Badge 徽章
 * - Validation 表单验证
 * - Progress 进度指示
 * 
 * 使用方法：
 * import { getStatusSemantic } from '@/design-system/semantic/status';
 * import { getCurrentTheme } from '@/design-system/config';
 * 
 * const theme = getCurrentTheme();
 * const statusStyles = getStatusSemantic(theme);
 * 
 * // 显示成功消息
 * alert.style.backgroundColor = statusStyles.success.background;
 * alert.style.borderColor = statusStyles.success.border;
 * alert.style.color = statusStyles.success.text;
 */

import type { DesignSystemTokens } from '../types';

import type { 
  StatusSemanticSet, 
  StatusToken 
} from './_generator';
import { generateStatusSemantic } from './_generator';

// 重新导出类型
export type { StatusSemanticSet, StatusToken };

/**
 * 获取状态语义 Token（主题感知）
 * 
 * @param theme - 当前主题 Token 集合
 * @returns 完整的状态语义 Token 集合
 * 
 * @example
 * const theme = getCurrentTheme();
 * const statuses = getStatusSemantic(theme);
 * 
 * // 创建错误提示
 * errorAlert.style.backgroundColor = statuses.danger.backgroundSubtle;
 * errorAlert.style.borderLeft = `3px solid ${statuses.danger.border}`;
 * errorAlert.style.color = statuses.danger.text;
 */
export function getStatusSemantic(theme: DesignSystemTokens): StatusSemanticSet {
  return generateStatusSemantic(theme.colors as any);
}

/**
 * 快速获取特定状态样式
 * 
 * @param theme - 当前主题 Token 集合
 * @param status - 状态类型
 * @returns 该状态的样式配置
 */
export function getStatusVariant(
  theme: DesignSystemTokens,
  status: keyof StatusSemanticSet
): StatusToken {
  return getStatusSemantic(theme)[status];
}

/**
 * 创建状态 CSS 变量
 * 
 * @param theme - 当前主题 Token 集合
 * @returns CSS 变量字符串
 */
export function generateStatusCSSVariables(theme: DesignSystemTokens): string {
  const statuses = getStatusSemantic(theme);
  const variables: string[] = [];
  
  (Object.keys(statuses) as Array<keyof StatusSemanticSet>).forEach((status) => {
    const s = statuses[status];
    const prefix = `--status-${status}`;
    
    variables.push(`${prefix}-bg: ${s.background};`);
    variables.push(`${prefix}-bg-subtle: ${s.backgroundSubtle};`);
    variables.push(`${prefix}-border: ${s.border};`);
    variables.push(`${prefix}-text: ${s.text};`);
    variables.push(`${prefix}-icon: ${s.icon};`);
  });
  
  return variables.join('\n');
}

/**
 * 应用状态样式到 DOM 元素
 * 
 * @param element - 目标元素
 * @param token - 状态语义 Token
 * @param options - 配置选项
 */
export function applyStatusStyles(
  element: HTMLElement, 
  token: StatusToken,
  options?: {
    variant?: 'default' | 'subtle' | 'outline';
    radii?: string;
  }
): void {
  const { variant = 'default', radii = '6px' } = options || {};
  
  switch (variant) {
    case 'default':
      element.style.backgroundColor = token.background;
      element.style.border = `1px solid ${token.border}`;
      element.style.color = token.text;
      break;
      
    case 'subtle':
      element.style.backgroundColor = token.backgroundSubtle;
      element.style.border = 'none';
      element.style.color = token.text;
      break;
      
    case 'outline':
      element.style.backgroundColor = 'transparent';
      element.style.border = `1px solid ${token.border}`;
      element.style.color = token.text;
      break;
  }
  
  element.style.borderRadius = radii;
}

/**
 * 获取状态图标名称
 * 
 * @param status - 状态类型
 * @returns 图标名称
 */
export function getStatusIcon(status: keyof StatusSemanticSet): string {
  const iconMap: Record<string, string> = {
    success: 'check-circle',
    warning: 'alert-triangle',
    danger: 'alert-circle',
    info: 'info',
    neutral: 'info',
  };
  
  return iconMap[status] || 'info';
}

// ============ 向后兼容的常量导出（Cyberpunk 主题默认值） ============

/**
 * @deprecated 使用 getStatusSemantic(theme) 替代
 * 这个常量仅作为向后兼容，始终是 Cyberpunk 主题的值
 */
export const StatusSemantic = {
  success: {
    background: 'rgba(0, 255, 136, 0.15)',
    backgroundSubtle: 'rgba(0, 255, 136, 0.08)',
    border: 'rgba(0, 255, 136, 0.3)',
    text: '#00ff88',
    icon: '#00ff88',
  },
  
  warning: {
    background: 'rgba(251, 191, 36, 0.15)',
    backgroundSubtle: 'rgba(251, 191, 36, 0.08)',
    border: 'rgba(251, 191, 36, 0.3)',
    text: '#fbbf24',
    icon: '#fbbf24',
  },
  
  danger: {
    background: 'rgba(255, 68, 68, 0.15)',
    backgroundSubtle: 'rgba(255, 68, 68, 0.08)',
    border: 'rgba(255, 68, 68, 0.3)',
    text: '#ff4444',
    icon: '#ff4444',
  },
  
  info: {
    background: 'rgba(0, 212, 255, 0.15)',
    backgroundSubtle: 'rgba(0, 212, 255, 0.08)',
    border: 'rgba(0, 212, 255, 0.3)',
    text: '#00d4ff',
    icon: '#00d4ff',
  },
  
  neutral: {
    background: 'rgba(160, 160, 176, 0.1)',
    backgroundSubtle: 'rgba(160, 160, 176, 0.05)',
    border: 'rgba(160, 160, 176, 0.2)',
    text: '#a0a0b0',
    icon: '#a0a0b0',
  },
} as const;

/**
 * 徽章变体配置（保留向后兼容）
 * @deprecated 推荐使用新的状态系统
 */
export const BadgeVariants = {
  success: {
    background: '#00ff88',
    text: '#0d0d14',
  },
  warning: {
    background: '#fbbf24',
    text: '#0d0d14',
  },
  danger: {
    background: '#ff4444',
    text: '#ffffff',
  },
  info: {
    background: '#00d4ff',
    text: '#0d0d14',
  },
  neutral: {
    background: '#3a3a5e',
    text: '#a0a0b0',
  },
} as const;
