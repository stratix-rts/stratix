/**
 * 边框系统
 * 
 * 宽度和样式定义
 */

export const Borders = {
  width: {
    none: 0,
    hair: 1,
    sm: 1,
    md: 2,
    lg: 3,
    xl: 4,
  },
  style: ['solid', 'dashed', 'dotted'] as const,
} as const;

/** 边框 CSS 生成工具 */
export function createBorderCSS(width: number, color: string, style: string = 'solid'): string {
  if (typeof width !== 'number' || width < 0) {
    throw new RangeError('[createBorderCSS] width must be a non-negative number');
  }
  if (!color || typeof color !== 'string') {
    throw new TypeError('[createBorderCSS] color must be a non-empty string');
  }
  return `${width}px ${style} ${color}`;
}
