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
    boxShadow: '0 4px 8px color-mix(in srgb, black 40%, transparent)',
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
    boxShadow: '0 4px 8px color-mix(in srgb, black 40%, transparent)',
  },
  elevated: {
    background: '#1a1a2e',
    border: '1px solid #3a3a5e',
    boxShadow: '0 8px 16px color-mix(in srgb, black 50%, transparent)',
  },
  outlined: {
    background: 'transparent',
    border: '1px solid #2a2a3e',
    boxShadow: 'none',
  },
  ghost: {
    background: 'color-mix(in srgb, #12121a 50%, transparent)',
    border: 'none',
    boxShadow: 'none',
  },
  glass: {
    background: 'var(--ds-glass-bg)',
    border: 'var(--ds-glass-border)',
    boxShadow: 'var(--ds-glass-shadow)',
    backdropFilter: 'blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate))',
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
