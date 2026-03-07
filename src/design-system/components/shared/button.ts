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
 */
export function getButtonToken(variant: ButtonVariant) {
  const colors = getToken('colors');
  
  const variants = {
    primary: {
      background: colors.primary,
      hover: '#00e6e6',
      active: '#00cccc',
      text: '#0d0d14',
      border: 'none',
    },
    secondary: {
      background: 'transparent',
      hover: 'rgba(0, 212, 255, 0.1)',
      active: 'rgba(0, 212, 255, 0.2)',
      text: '#ffffff',
      border: '1px solid #2a2a3e',
    },
    success: {
      background: '#00ff88',
      hover: '#00e67a',
      active: '#00cc70',
      text: '#0d0d14',
      border: 'none',
    },
    danger: {
      background: '#ff4444',
      hover: '#ff3333',
      active: '#ff2222',
      text: '#ffffff',
      border: 'none',
    },
    warning: {
      background: '#fbbf24',
      hover: '#fbbf24',
      active: '#fbbf24',
      text: '#0d0d14',
      border: 'none',
    },
  };
  
  return {
    ...ButtonBaseConfig,
    style: {
      ...ButtonBaseConfig.style,
      background: variants[variant].background,
      border: variants[variant].border,
    },
  };
}
