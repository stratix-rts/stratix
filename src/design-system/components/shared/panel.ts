/**
 * Panel 组件 Token (Vue 和 Phaser 共享)
 */

import type { ComponentToken } from '../../types';

/**
 * Panel 基础配置
 */
export const PanelBaseConfig: ComponentToken = {
  size: {
    width: undefined,
    height: undefined,
  },
  layout: {
    padding: 'md',
    gap: 'md',
  },
  style: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    borderRadius: 'md',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
  },
  animation: {
    enter: {
      duration: 300,
      easing: 'ease-out',
    },
    exit: {
      duration: 200,
      easing: 'ease-in',
    },
  },
};

/**
 * Panel 变体配置
 */
export const PanelVariants = {
  default: {
    background: '#12121a',
    border: '1px solid #2a2a3e',
    boxShadow: '0 4px 8px rgba(0, 0, 0, 0.4)',
  },
  elevated: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5e',
    boxShadow: '0 8px 16px rgba(0, 0, 0, 0.5)',
  },
  outlined: {
    background: 'transparent',
    border: '1px solid #2a2a3e',
    boxShadow: 'none',
  },
  ghost: {
    background: 'rgba(18, 18, 26, 0.5)',
    border: 'none',
    boxShadow: 'none',
  },
} as const;

/**
 * 获取 Panel Token
 */
export function getPanelToken(variant: keyof typeof PanelVariants) {
  return {
    ...PanelBaseConfig,
    style: {
      ...PanelBaseConfig.style,
      ...PanelVariants[variant],
    },
  };
}
