/**
 * Cyberpunk 主题
 * 
 * 深色背景，高对比度，赛博朋克风格
 * - 主色：青色 #00ffff
 * - 辅色：品红 #ff00ff
 * - 背景：深空黑 #0d0d14
 */

import { IconSizes } from '../icons/registry';
import { generateAllSemanticTokens } from '../semantic/_generator';
import { Animation } from '../tokens/animation';
import { 
  CyberpunkPrimitives,
  Cyan, 
  Magenta,
  Gray 
} from '../tokens/colors';
import { Depth } from '../tokens/depth';
import { Spacing } from '../tokens/spacing';
import { Typography } from '../tokens/typography';
import type { DesignSystemTokens } from '../types';

// 主题特定的圆角配置
const CyberpunkRadii = {
  none: '0',
  sm: '2px',
  md: '4px',
  lg: '8px',
  xl: '16px',
  full: '9999px',
} as const;

// 主题特定的阴影配置
const CyberpunkShadows = {
  sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
  md: '0 4px 8px rgba(0, 0, 0, 0.4)',
  lg: '0 8px 16px rgba(0, 0, 0, 0.5)',
  xl: '0 16px 32px rgba(0, 0, 0, 0.6)',
  '2xl': '0 24px 48px rgba(0, 0, 0, 0.7)',
  // Cyberpunk 特有的发光阴影
  glow: `0 0 20px ${Cyan[500]}80`,
  'glow-sm': `0 0 10px ${Cyan[500]}60`,
  'glow-lg': `0 0 40px ${Cyan[500]}40`,
  inner: 'inset 0 2px 4px rgba(0, 0, 0, 0.4)',
} as const;

// 主题特定的字体配置
const CyberpunkTypography = {
  fontFamily: {
    mono: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
    sans: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  fontSize: {
    xs: '10px',
    sm: '12px',
    md: '14px',
    lg: '16px',
    xl: '20px',
    '2xl': '24px',
  },
  fontWeight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

// 生成语义 Token
const semanticTokens = generateAllSemanticTokens(
  CyberpunkPrimitives,
  CyberpunkRadii,
  CyberpunkShadows
);

export const CyberpunkTheme: DesignSystemTokens = {
  colors: CyberpunkPrimitives,
  spacing: Spacing,
  radii: CyberpunkRadii,
  borders: {
    width: {
      none: 0,
      hair: 1,
      sm: 1,
      md: 2,
      lg: 3,
    },
    style: 'solid',
  },
  shadows: CyberpunkShadows,
  typography: CyberpunkTypography,
  animation: Animation,
  depth: Depth,
  icons: {
    sizes: IconSizes,
    registry: {},
  },
  // 使用生成的语义 Token
  ...semanticTokens,
};

// 导出主题特定配置，供需要精细控制的组件使用
export { CyberpunkRadii, CyberpunkShadows, CyberpunkTypography };
