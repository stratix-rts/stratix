/**
 * Button 组件 Token (Vue 和 Phaser 共享)
 */

import type { ComponentToken } from '../../types';
import { getToken } from '../../config';

/**
 * Button 基础配置
 */
export const ButtonBaseConfig: ComponentToken = {
  size: {
    width: undefined,
    height: undefined,
  },
  layout: {
    padding: 'md',
    gap: 'sm',
  },
  style: {
    borderRadius: 'md',
  },
  animation: {
    enter: {
      duration: 200,
      easing: 'ease-out',
    },
    exit: {
      duration: 150,
      easing: 'ease-in',
    },
  },
};

/**
 * Button 尺寸配置
 */
export const ButtonSizes = {
  sm: {
    padding: '4px 8px',
    fontSize: '12px',
  },
  md: {
    padding: '8px 16px',
    fontSize: '14px',
  },
  lg: {
    padding: '12px 24px',
    fontSize: '16px',
  },
} as const;

/**
 * Button 变体类型
 */
export type ButtonVariant = 'primary' | 'secondary' | 'success' | 'danger' | 'warning';

/**
 * 获取 Button Token
 * 使用 CSS 变量以支持主题切换
 */
export function getButtonToken(variant: ButtonVariant) {
  const variants = {
    primary: {
      background: 'var(--ds-btn-primary-bg)',
      hover: 'var(--ds-btn-primary-bg-hover)',
      text: 'var(--ds-btn-primary-text)',
      border: 'none',
    },
    secondary: {
      background: 'var(--ds-btn-secondary-bg)',
      hover: 'var(--ds-btn-secondary-bg-hover)',
      text: 'var(--ds-btn-secondary-text)',
      border: '1px solid var(--ds-border)',
    },
    success: {
      background: 'var(--ds-status-success)',
      hover: 'var(--ds-status-success)',
      text: 'var(--ds-text-inverse)',
      border: 'none',
    },
    danger: {
      background: 'var(--ds-status-danger)',
      hover: 'var(--ds-status-danger)',
      text: 'var(--ds-text-inverse)',
      border: 'none',
    },
    warning: {
      background: 'var(--ds-status-warning)',
      hover: 'var(--ds-status-warning)',
      text: 'var(--ds-text-inverse)',
      border: 'none',
    },
  };
  
  const variantConfig = variants[variant];
  
  return {
    ...ButtonBaseConfig,
    style: {
      ...ButtonBaseConfig.style,
      background: variantConfig.background,
      border: variantConfig.border,
      text: variantConfig.text,
    },
    hover: {
      background: variantConfig.hover,
    },
  };
}
