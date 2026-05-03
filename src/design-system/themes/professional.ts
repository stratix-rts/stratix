/**
 * Professional 主题
 * 
 * 商务风格，深蓝灰色系，标准圆角
 * - 主色：深蓝 #1E40AF
 * - 辅色：中蓝 #3B82F6
 * - 背景：灰白 #f8fafc
 * 
 * 设计理念：专业、可信、保守、易读
 */

import { IconSizes } from '../icons/registry';
import { generateAllSemanticTokens } from '../semantic/_generator';
import { Animation } from '../tokens/animation';
import {
  ProfessionalPrimitives,
  Blue,
  Slate,
} from '../tokens/colors';
import { generateGradients } from '../tokens/gradients';
import { Depth } from '../tokens/depth';
import { Spacing } from '../tokens/spacing';
import type { DesignSystemTokens } from '../types';

// 主题特定的圆角配置（标准圆角，比 Minimal 更小）
const ProfessionalRadii = {
  none: '0',
  sm: '2px',
  md: '4px',
  lg: '6px',
  xl: '8px',
  full: '9999px',
} as const;

// 主题特定的阴影配置（稳重但有层次）
const ProfessionalShadows = {
  sm: '0 1px 2px rgba(15, 23, 42, 0.06), 0 1px 3px rgba(15, 23, 42, 0.04)',
  md: '0 3px 6px rgba(15, 23, 42, 0.08), 0 2px 4px rgba(15, 23, 42, 0.05)',
  lg: '0 6px 12px rgba(15, 23, 42, 0.1), 0 4px 8px rgba(15, 23, 42, 0.06)',
  xl: '0 12px 24px rgba(15, 23, 42, 0.12), 0 8px 16px rgba(15, 23, 42, 0.07)',
  '2xl': '0 18px 36px rgba(15, 23, 42, 0.14), 0 12px 24px rgba(15, 23, 42, 0.08)',
  inner: 'inset 0 2px 4px rgba(15, 23, 42, 0.05)',
} as const;

// 主题特定的字体配置（更注重可读性）
const ProfessionalTypography = {
  fontFamily: {
    mono: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
    sans: "'Inter', 'SF Pro Display', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  fontSize: {
    xs: '11px',
    sm: '13px',
    md: '15px',
    lg: '17px',
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
    tight: 1.3,
    normal: 1.6,
    relaxed: 1.8,
  },
} as const;

// 主题特定渐变配置
const ProfessionalGradients = generateGradients({
  primary: Blue[700],
  secondary: Slate[500],
  bgBase: ProfessionalPrimitives.background.base,
  bgElevated: ProfessionalPrimitives.background.elevated,
  bgOverlay: ProfessionalPrimitives.background.overlay,
  success: ProfessionalPrimitives.status.success,
  warning: ProfessionalPrimitives.status.warning,
  danger: ProfessionalPrimitives.status.danger,
  info: ProfessionalPrimitives.status.info,
});

// 生成语义 Token
const semanticTokens = generateAllSemanticTokens(
  ProfessionalPrimitives,
  ProfessionalRadii,
  ProfessionalShadows
);

export const ProfessionalTheme: DesignSystemTokens = {
  colors: ProfessionalPrimitives,
  spacing: Spacing,
  radii: ProfessionalRadii,
  borders: {
    width: {
      none: 0,
      hair: 1,
      sm: 1,
      md: 2,
      lg: 2,
    },
    style: 'solid',
  },
  shadows: ProfessionalShadows,
  typography: ProfessionalTypography,
  animation: Animation,
  depth: Depth,
  icons: {
    sizes: IconSizes,
    registry: {},
  },
  gradients: ProfessionalGradients,
  // 使用生成的语义 Token — 语义 Token 的属性结构与 DesignSystemTokens 兼容
  ...semanticTokens,
};

// 导出主题特定配置
export { ProfessionalRadii, ProfessionalShadows, ProfessionalTypography, ProfessionalGradients };
