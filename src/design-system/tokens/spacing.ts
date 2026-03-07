/**
 * 间距系统
 * 
 * 基于 8px 基准
 * 符合人体工学和视觉节奏
 */

export const Spacing = {
  /** 4px - 最小间距 */
  xs: 4,
  
  /** 8px - 基础间距单位 */
  sm: 8,
  
  /** 16px - 标准间距 */
  md: 16,
  
  /** 24px - 大间距 */
  lg: 24,
  
  /** 32px - 超大间距 */
  xl: 32,
  
  /** 48px - 巨大间距 */
  '2xl': 48,
  
  /** 64px - 特别场景 */
  '3xl': 64,
} as const;

/**
 * 间距工具函数
 */
export function spacingToPx(value: keyof typeof Spacing): string {
  return `${Spacing[value]}px`;
}

/**
 * CSS 变量生成
 */
export function generateSpacingCSS(): string {
  return Object.entries(Spacing)
    .map(([key, value]) => `--spacing-${key}: ${value}px;`)
    .join('\n');
}
