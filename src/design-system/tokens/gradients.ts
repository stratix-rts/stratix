/**
 * 渐变系统 Token
 *
 * 提供品牌、背景、状态和特殊效果的渐变定义
 * 每个主题在 themes/{theme}.ts 中定义具体的颜色映射
 */

// ============ 渐变类型定义 ============

export interface BrandGradients {
  primary: string;
  subtle: string;
  glow: string;
}

export interface BackgroundGradients {
  base: string;
  elevated: string;
  subtle: string;
}

export interface StatusGradients {
  success: string;
  warning: string;
  danger: string;
  info: string;
}

export interface CyberpunkGradients {
  neon: string;
  scanline: string;
  grid: string;
}

export interface GradientToken {
  brand: BrandGradients;
  background: BackgroundGradients;
  status: StatusGradients;
  cyberpunk: CyberpunkGradients;
}

// ============ 基础渐变模板（含占位符） ============

export const GradientTemplates = {
  brand: {
    primary: 'linear-gradient(135deg, {primary} 0%, {secondary} 100%)',
    subtle: 'linear-gradient(135deg, {primary}20 0%, {secondary}10 100%)',
    glow: 'linear-gradient(135deg, {primary}40 0%, transparent 100%)',
  },
  background: {
    base: 'linear-gradient(180deg, {bg-base} 0%, {bg-elevated} 100%)',
    elevated: 'linear-gradient(180deg, {bg-elevated} 0%, {bg-overlay} 100%)',
    subtle: 'linear-gradient(180deg, transparent 0%, {bg-overlay}60 100%)',
  },
  status: {
    success: 'linear-gradient(135deg, {success}20 0%, {success}05 100%)',
    warning: 'linear-gradient(135deg, {warning}20 0%, {warning}05 100%)',
    danger: 'linear-gradient(135deg, {danger}20 0%, {danger}05 100%)',
    info: 'linear-gradient(135deg, {info}20 0%, {info}05 100%)',
  },
  cyberpunk: {
    neon: 'linear-gradient(135deg, #00ffff20 0%, #ff00ff20 50%, #00ffff20 100%)',
    scanline: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.1) 2px, rgba(0,0,0,0.1) 4px)',
    grid: 'linear-gradient(rgba(0,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,255,0.05) 1px, transparent 1px)',
  },
} as const;

// ============ 渐变生成辅助函数 ============

/**
 * 替换渐变模板中的占位符
 */
export function resolveGradient(
  template: string,
  colors: Record<string, string>
): string {
  return template.replace(/\{([^}]+)\}/g, (_, key) => {
    const value = colors[key];
    if (value === undefined || value === null) {
      console.warn(`[resolveGradient] Missing color for placeholder: ${key}`);
    }
    return value || 'transparent';
  });
}

/**
 * 为给定主题色生成完整渐变集合
 */
export function generateGradients(
  colors: {
    primary: string;
    secondary: string;
    bgBase: string;
    bgElevated: string;
    bgOverlay: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
  }
): GradientToken {
  const vars = {
    primary: colors.primary,
    secondary: colors.secondary,
    'bg-base': colors.bgBase,
    'bg-elevated': colors.bgElevated,
    'bg-overlay': colors.bgOverlay,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.info,
  };

  return {
    brand: {
      primary: resolveGradient(GradientTemplates.brand.primary, vars),
      subtle: resolveGradient(GradientTemplates.brand.subtle, vars),
      glow: resolveGradient(GradientTemplates.brand.glow, vars),
    },
    background: {
      base: resolveGradient(GradientTemplates.background.base, vars),
      elevated: resolveGradient(GradientTemplates.background.elevated, vars),
      subtle: resolveGradient(GradientTemplates.background.subtle, vars),
    },
    status: {
      success: resolveGradient(GradientTemplates.status.success, vars),
      warning: resolveGradient(GradientTemplates.status.warning, vars),
      danger: resolveGradient(GradientTemplates.status.danger, vars),
      info: resolveGradient(GradientTemplates.status.info, vars),
    },
    cyberpunk: {
      neon: GradientTemplates.cyberpunk.neon,
      scanline: GradientTemplates.cyberpunk.scanline,
      grid: GradientTemplates.cyberpunk.grid,
    },
  };
}
