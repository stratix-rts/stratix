/**
 * Stratix Design System 类型定义
 * 
 * 简洁、可推断、类型安全
 * 大模型友好：命名清晰，减少 token 消耗
 */

// ============ Global Tokens ============

/** 颜色 Token */
export interface ColorToken {
  primary: string;
  secondary: string;
  accent: string;
  background: {
    primary: string;
    secondary: string;
    tertiary: string;
  };
  border: {
    default: string;
    subtle: string;
    strong: string;
  };
  text: {
    primary: string;
    secondary: string;
    muted: string;
    disabled: string;
  };
  semantic: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
}

/** 间距 Token (基于 8px) */
export interface SpacingToken {
  xs: number;   // 4px
  sm: number;   // 8px
  md: number;   // 16px
  lg: number;   // 24px
  xl: number;   // 32px
  '2xl': number; // 48px
}

/** 圆角 Token */
export interface RadiiToken {
  none: string;
  sm: string;
  md: string;
  lg: string;
  xl: string;
  full: string;
}

/** 边框 Token */
export interface BorderToken {
  width: {
    none: number;
    hair: number;
    sm: number;
    md: number;
    lg: number;
  };
  style: 'solid' | 'dashed' | 'dotted';
}

/** 阴影 Token */
export interface ShadowToken {
  sm: string;
  md: string;
  lg: string;
  xl: string;
  '2xl': string;
}

/** 字体 Token */
export interface TypographyToken {
  fontFamily: {
    mono: string;
    sans: string;
  };
  fontSize: {
    xs: string;
    sm: string;
    md: string;
    lg: string;
    xl: string;
    '2xl': string;
  };
  fontWeight: {
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
  };
  lineHeight: {
    tight: number;
    normal: number;
    relaxed: number;
  };
}

/** 动画 Token */
export interface AnimationToken {
  duration: {
    fast: number;    // 150ms
    normal: number;  // 250ms
    slow: number;    // 400ms
  };
  easing: {
    linear: string;
    ease: string;
    easeIn: string;
    easeOut: string;
    easeInOut: string;
  };
  // 预留扩展接口
  components?: {
    button?: { hover?: number; active?: number };
    modal?: { enter?: number; exit?: number };
  };
}

/** 深度 Token */
export interface DepthToken {
  base: number;
  overlay: number;
  modal: number;
  popup: number;
  notification: number;
}

/** 图标 Token */
export interface IconToken {
  sizes: {
    xs: number;
    sm: number;
    md: number;
    lg: number;
    xl: number;
  };
  registry: Record<string, string>;
}

// ============ Design System ============

/** 完整 Token 集合 */
export interface DesignSystemTokens {
  colors: ColorToken;
  spacing: SpacingToken;
  radii: RadiiToken;
  borders: BorderToken;
  shadows: ShadowToken;
  typography: TypographyToken;
  animation: AnimationToken;
  depth: DepthToken;
  icons: IconToken;
  panel?: {
    default?: PanelSemanticToken;
    elevated?: PanelSemanticToken;
    outlined?: PanelSemanticToken;
    ghost?: PanelSemanticToken;
  };
}

// ============ Semantic Tokens ============

/** 按钮语义 Token */
export interface ButtonSemanticToken {
  background: string;
  hover: string;
  text: string;
  border: string;
  borderRadius: string;
  padding: string;
  animation: {
    duration: number;
  };
}

/** 面板语义 Token */
export interface PanelSemanticToken {
  background: string;
  border: string;
  borderRadius: string;
  padding: string;
  boxShadow: string;
}

// ============ Component Tokens ============

export type SpacingValue = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | number | Partial<SpacingToken>;

/** 组件 Token 基础接口 */
export interface ComponentToken {
  size?: {
    width?: string | number;
    height?: string | number;
    minWidth?: string | number;
    minHeight?: string | number;
  };
  width?: string | number;
  padding?: SpacingValue;
  layout?: {
    padding?: SpacingValue;
    gap?: SpacingValue;
  };
  style?: {
    background?: string;
    border?: string;
    borderRadius?: string;
    boxShadow?: string;
  };
  depth?: number;
  interaction?: {
    hover?: Partial<ComponentToken>;
    active?: Partial<ComponentToken>;
    focus?: Partial<ComponentToken>;
  };
  responsive?: {
    mobile?: Partial<ComponentToken>;
    tablet?: Partial<ComponentToken>;
  };
  animation?: {
    enter?: {
      duration: number;
      easing: string;
      from?: Record<string, number>;
    };
    exit?: {
      duration: number;
      easing: string;
      to?: Record<string, number>;
    };
  };
}

// ============ Theme ============

/** 主题名称 */
export type ThemeName = 'cyberpunk' | 'minimal' | 'professional';

// ============ Token Path ============

/** Token 路径类型 (用于智能提示) */
export type TokenPath = 
  | 'colors.primary'
  | 'colors.background.primary'
  | 'spacing.md'
  | 'radii.md'
  | 'animation.duration.fast'
  | 'button.primary'
  | 'panel.default'
  | string; // 兜底类型

/** Token 值类型 */
export type TokenValue<T extends string> = 
  T extends 'colors.primary' ? string :
  T extends 'spacing.md' ? number :
  T extends 'animation.duration.fast' ? number :
  any; // 兜底类型

// ============ Icons ============

/** SVG 图标路径 */
export type SVGIconPath = string;

/** Phaser Graphics 图标绘制函数 */
export type GraphicsIconRenderer = (
  graphics: any,
  size: number,
  color: string
) => void;

/** 图标注册表 */
export interface IconRegistry {
  svg: Record<string, SVGIconPath>;
  custom: Record<string, GraphicsIconRenderer>;
}
