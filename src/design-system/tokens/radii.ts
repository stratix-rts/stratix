/**
 * 圆角系统
 * 
 * 不同主题使用不同圆角值
 * Cyberpunk: 锐利 (sm-md)
 * Minimal: 圆润 (md-lg)
 * Professional: 标准 (md)
 */

export const Radii = {
  /** 无圆角 */
  none: '0',
  
  /** 小圆角 - 2px */
  sm: '2px',
  
  /** 中圆角 - 4px */
  md: '4px',
  
  /** 大圆角 - 8px */
  lg: '8px',
  
  /** 超大圆角 - 16px */
  xl: '16px',
  
  /** 完全圆形 */
  full: '9999px',
} as const;
