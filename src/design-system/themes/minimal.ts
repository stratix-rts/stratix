/**
 * Minimal 主题
 * 
 * 极简风格，浅色背景，圆润边角
 * - 主色：靛蓝 #4F46E5
 * - 辅色：蓝紫 #818CF8
 * - 背景：纯白 #ffffff
 * 
 * 设计理念：少即是多，留白，清晰的层次
 */

import { IconSizes } from '../icons/registry';
import { generateAllSemanticTokens } from '../semantic/_generator';
import { Animation } from '../tokens/animation';
import {
  MinimalPrimitives,
} from '../tokens/colors';
import { Depth } from '../tokens/depth';
import { Spacing } from '../tokens/spacing';
import type { DesignSystemTokens } from '../types';

// 主题特定的圆角配置（更圆润）
const MinimalRadii = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '20px',
  full: '9999px',
} as const;

// 主题特定的阴影配置（极简、几乎不可见）
const MinimalShadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.04)',
  md: '0 2px 4px rgba(0, 0, 0, 0.06)',
  lg: '0 4px 8px rgba(0, 0, 0, 0.08)',
  xl: '0 8px 16px rgba(0, 0, 0, 0.1)',
  '2xl': '0 12px 24px rgba(0, 0, 0, 0.12)',
  inner: 'inset 0 1px 2px rgba(0, 0, 0, 0.04)',
} as const;

// 主题特定的字体配置
const MinimalTypography = {
  fontFamily: {
    mono: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
    sans: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  fontSize: {
    xs: '11px',
    sm: '13px',
    md: '15px',
    lg: '17px',
    xl: '21px',
    '2xl': '26px',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.25,
    normal: 1.6,
    relaxed: 1.8,
  },
} as const;

// 生成语义 Token
const semanticTokens = generateAllSemanticTokens(
  MinimalPrimitives,
  MinimalRadii,
  MinimalShadows
);

export const MinimalTheme: DesignSystemTokens = {
  colors: MinimalPrimitives,
  spacing: Spacing,
  radii: MinimalRadii,
  borders: {
    width: {
      none: 0,
      hair: 1,
      sm: 1,
      md: 1,
      lg: 2,
    },
    style: 'solid',
  },
  shadows: MinimalShadows,
  typography: MinimalTypography,
  animation: Animation,
  depth: Depth,
  icons: {
    sizes: IconSizes,
    registry: {},
  },
  // 使用生成的语义 Token
  ...semanticTokens,
};

// 导出主题特定配置
export { MinimalRadii, MinimalShadows, MinimalTypography };
