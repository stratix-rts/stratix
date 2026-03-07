/**
 * Cyberpunk 主题
 * 
 * 深色背景，高对比度，赛博朋克风格
 */

import type { DesignSystemTokens } from '../types';
import { CyberpunkColors } from '../tokens/colors';
import { Spacing } from '../tokens/spacing';
import { Radii } from '../tokens/radii';
import { Borders } from '../tokens/borders';
import { Shadows } from '../tokens/shadows';
import { Typography } from '../tokens/typography';
import { Animation } from '../tokens/animation';
import { Depth } from '../tokens/depth';
import { IconSizes } from '../icons/registry';
import { PanelSemantic } from '../semantic/panels';

export const CyberpunkTheme: DesignSystemTokens = {
  colors: CyberpunkColors,
  
  spacing: Spacing,
  
  radii: {
    none: '0',
    sm: '2px',
    md: '4px',
    lg: '8px',
    xl: '16px',
    full: '9999px',
  },
  
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
  
  shadows: {
    sm: '0 1px 2px rgba(0, 0, 0, 0.3)',
    md: '0 4px 8px rgba(0, 0, 0, 0.4)',
    lg: '0 8px 16px rgba(0, 0, 0, 0.5)',
    xl: '0 16px 32px rgba(0, 0, 0, 0.6)',
    '2xl': '0 24px 48px rgba(0, 0, 0, 0.7)',
  },
  
  typography: {
    fontFamily: {
      mono: "'SF Mono', 'Monaco', 'Inconsolata', monospace",
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
