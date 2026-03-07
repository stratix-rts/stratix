/**
 * 阴影系统
 * 
 * 不同层级和场景的阴影
 */

export const Shadows = {
  /** 小阴影 - 卡片悬停 */
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  
  /** 中阴影 - 卡片默认 */
  md: '0 4px 8px rgba(0, 0, 0, 0.4)',
  
  /** 大阴影 - 模态框 */
  lg: '0 8px 16px rgba(0, 0, 0, 0.5)',
  
  /** 超大阴影 - 弹出层 */
  xl: '0 16px 32px rgba(0, 0, 0, 0.6)',
  
  /** 巨大阴影 - 重要提示 */
  '2xl': '0 24px 48px rgba(0, 0, 0, 0.7)',
  
  /** 发光效果 - Cyberpunk 专属 */
  glow: '0 0 20px rgba(0, 212, 255, 0.5)',
  
  /** 内阴影 */
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.3)',
} as const;
