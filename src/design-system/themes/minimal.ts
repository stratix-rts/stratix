/**
 * Minimal 主题
 * 
 * 极简风格，浅色背景，圆润边角
 */

import type { DesignSystemTokens } from '../types';
import { MinimalColors } from '../tokens/colors';
import { Spacing } from '../tokens/spacing';
import { Typography } from '../tokens/typography';
import { Animation } from '../tokens/animation';
import { Depth } from '../tokens/depth';
import { IconSizes } from '../icons/registry';
import { PanelSemantic } from '../semantic/panels';

export const MinimalTheme: DesignSystemTokens = {
  colors: MinimalColors,
  
  spacing: Spacing,
  
  radii: {
    none: '0',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '20px',
    full: '9999px',
  },
  
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
  
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.05)',
    md: '0 4px 8px rgba(0, 0, 0, 0.08)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.1)',
    xl: '0 16px 32px rgba(0, 0, 0, 0.12)',
    '2xl': '0 24px 48px rgba(0, 0, 0, 0.15)',
  },
  
  typography: {
    fontFamily: {
      mono: "'SF Mono', 'Monaco', monospace",
      sans: "'Inter', -apple-system, sans-serif",
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
  },
  
  animation: Animation,
  
  depth: Depth,
  
  icons: {
    sizes: IconSizes,
    registry: {},
  },
  
  panel: PanelSemantic,
};
