/**
 * Input 组件 Token (Vue 和 Phaser 共享)
 */

/**
 * Input 基础配置
 */
export const InputBaseConfig = {
  size: {
    width: '100%',
  },
  style: {
    background: '#1a1a2e',
    border: '1px solid #2a2a3e',
    borderRadius: 'md',
  },
};

/**
 * Input 尺寸配置
 */
export const InputSizes = {
  sm: {
    height: '32px',
    padding: '4px 8px',
    fontSize: '12px',
  },
  md: {
    height: '40px',
    padding: '8px 12px',
    fontSize: '14px',
  },
  lg: {
    height: '48px',
    padding: '12px 16px',
    fontSize: '16px',
  },
} as const;

/**
 * Input 变体类型
 */
export type InputVariant = 'default' | 'filled' | 'outlined';
