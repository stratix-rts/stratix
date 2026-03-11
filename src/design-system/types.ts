/**
 * Stratix Design System 类型定义
 * 
 * 简洁、可推断、类型安全
 * 大模型友好：命名清晰，减少 token 消耗
 */

// ============ Global Tokens ============

/** 品牌色 Token */
export interface BrandToken {
  primary: string;
  secondary: string;
  accent: string;
}

/** 背景色 Token */
export interface BackgroundToken {
  base: string;
  elevated: string;
  overlay: string;
  sunken: string;
}

/** 边框色 Token */
export interface BorderColorToken {
  subtle: string;
  default: string;
  strong: string;
  focus: string;
}

/** 文字色 Token */
export interface TextColorToken {
  primary: string;
  secondary: string;
  muted: string;
  disabled: string;
  inverse: string;
}

/** 状态色 Token */
export interface StatusColorToken {
  success: string;
  warning: string;
  danger: string;
  info: string;
}

/** 交互色 Token */
export interface InteractiveToken {
  default: string;
  hover: string;
  active: string;
  disabled: string;
}

/** 
 * 颜色 Token - 新结构（基于 Primitives）
 */
export interface ColorPrimitives {
  brand: BrandToken;
  background: BackgroundToken;
  border: BorderColorToken;
  text: TextColorToken;
  status: StatusColorToken;
  interactive: InteractiveToken;
}

/** 
 * 向后兼容：旧版颜色 Token
 * @deprecated 使用 ColorPrimitives
 */
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
  semantic: StatusColorToken;
}

/** 颜色类型 - 联合类型 */
export type Colors = ColorPrimitives | ColorToken;

/** 间距 Token (基于 8px) */
export interface SpacingToken {
  xs: number;   // 4px
  sm: number;   // 8px
  md: number;   // 16px
  lg: number;   // 24px
  xl: number;   // 32px
  '2xl': number; // 48px
  '3xl'?: number; // 64px (可选)
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
  glow?: string;
  'glow-sm'?: string;
  'glow-lg'?: string;
  inner?: string;
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
    '3xl'?: string;
    '4xl'?: string;
  };
  fontWeight: {
    normal: number;
    medium: number;
    semibold: number;
    bold: number;
    extrabold?: number;
  };
  lineHeight: {
    tight: number;
    normal: number;
    relaxed: number;
    loose?: number;
  };
  letterSpacing?: {
    tighter: string;
    tight: string;
    normal: string;
    wide: string;
    wider: string;
    widest: string;
  };
}

/** 动画 Token */
export interface AnimationToken {
  duration: {
    fast: number;    // 150ms
    normal: number;  // 250ms
    slow: number;    // 400ms
    instant?: number; // 75ms
    deliberate?: number; // 600ms
  };
  easing: {
    linear: string;
    ease: string;
    easeIn: string;
    easeOut: string;
    easeInOut: string;
    spring?: string;
  };
  presets?: {
    fadeIn?: { from: Record<string, number>; to: Record<string, number>; duration: number; easing: string };
    fadeOut?: { from: Record<string, number>; to: Record<string, number>; duration: number; easing: string };
    slideUp?: { from: Record<string, number>; to: Record<string, number>; duration: number; easing: string };
    slideDown?: { from: Record<string, number>; to: Record<string, number>; duration: number; easing: string };
    scaleIn?: { from: Record<string, number>; to: Record<string, number>; duration: number; easing: string };
  };
  components?: {
    button?: { hover?: number; active?: number; focus?: number };
    modal?: { enter?: number; exit?: number; backdrop?: number };
    dropdown?: { enter?: number; exit?: number };
    tooltip?: { enter?: number; exit?: number };
  };
}

/** 深度 Token */
export interface DepthToken {
  base: number;
  overlay: number;
  modal: number;
  popup: number;
  notification: number;
  // 详细层级
  WORLD_BASE?: number;
  WORLD_OBJECTS?: number;
  WORLD_AGENTS?: number;
  UI_GROUND?: number;
  UI_MODAL_BASE?: number;
  UI_POPUP_BASE?: number;
  UI_NOTIFICATION?: number;
  UI_DEBUG?: number;
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

// ============ Semantic Tokens ============

/** 按钮语义 Token */
export interface ButtonSemanticToken {
  background: string;
  backgroundHover: string;
  backgroundActive: string;
  text: string;
  border: string;
  borderRadius: string;
  padding: string;
  shadow?: string;
  shadowHover?: string;
}

/** 按钮语义集合 */
export interface ButtonSemanticSet {
  primary: ButtonSemanticToken;
  secondary: ButtonSemanticToken;
  tertiary: ButtonSemanticToken;
  success: ButtonSemanticToken;
  danger: ButtonSemanticToken;
  warning: ButtonSemanticToken;
  ghost: ButtonSemanticToken;
  disabled: ButtonSemanticToken;
}

/** 面板语义 Token */
export interface PanelSemanticToken {
  background: string;
  border: string;
  borderRadius: string;
  padding: string;
  shadow: string;
}

/** 面板语义集合 - 向后兼容（包含 sunken） */
export interface PanelSemanticSet {
  default: PanelSemanticToken;
  elevated: PanelSemanticToken;
  outlined: PanelSemanticToken;
  ghost: PanelSemanticToken;
  sunken?: PanelSemanticToken;  // 可选，向后兼容
}

/** 输入框状态 Token */
export interface InputStateToken {
  background: string;
  border: string;
  text: string;
  placeholder: string;
  shadow?: string;
}

/** 输入框语义集合 */
export interface InputSemanticSet {
  default: InputStateToken;
  hover: InputStateToken;
  focus: InputStateToken;
  error: InputStateToken;
  success: InputStateToken;
  disabled: InputStateToken;
  readonly: InputStateToken;
}

/** 状态语义 Token */
export interface StatusToken {
  background: string;
  backgroundSubtle: string;
  border: string;
  text: string;
  icon: string;
}

/** 状态语义集合 */
export interface StatusSemanticSet {
  success: StatusToken;
  warning: StatusToken;
  danger: StatusToken;
  info: StatusToken;
  neutral: StatusToken;
}

/** 表单语义集合 */
export interface FormSemanticSet {
  label: {
    color: string;
    requiredColor: string;
    fontSize: string;
    fontWeight: number;
  };
  helpText: {
    color: string;
    errorColor: string;
    successColor: string;
    fontSize: string;
  };
  fieldset: {
    border: string;
    background: string;
  };
  layout: {
    gap: string;
    labelGap: string;
    fieldMarginBottom: string;
  };
}

/** 导航语义集合 */
export interface NavigationSemanticSet {
  background: string;
  itemDefault: {
    background: string;
    text: string;
  };
  itemHover: {
    background: string;
    text: string;
  };
  itemActive: {
    background: string;
    text: string;
    indicator: string;
  };
  divider: string;
}

/** 完整语义 Token 集合 */
export interface CompleteSemanticTokens {
  button: ButtonSemanticSet;
  panel: PanelSemanticSet;
  input: InputSemanticSet;
  status: StatusSemanticSet;
  form: FormSemanticSet;
  navigation: NavigationSemanticSet;
}

// ============ Design System ============

/** 完整 Token 集合 - 使用新的颜色结构 */
export interface DesignSystemTokens extends Partial<CompleteSemanticTokens> {
  colors: ColorPrimitives;
  spacing: SpacingToken;
  radii: RadiiToken;
  borders: BorderToken;
  shadows: ShadowToken;
  typography: TypographyToken;
  animation: AnimationToken;
  depth: DepthToken;
  icons: IconToken;
  // 向后兼容：允许额外属性
  [key: string]: any;
}

/** 向后兼容：旧版完整 Token 集合 */
export interface LegacyDesignSystemTokens {
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

// ============ Theme ============

/** 主题名称 */
export type ThemeName = 'cyberpunk' | 'minimal' | 'professional';

/** 主题配置 */
export interface ThemeConfig {
  name: ThemeName;
  tokens: DesignSystemTokens;
}

// ============ Token Path ============

/** Token 路径类型 (用于智能提示) */
export type TokenPath = 
  | 'colors.brand.primary'
  | 'colors.background.base'
  | 'colors.text.primary'
  | 'colors.status.success'
  | 'spacing.md'
  | 'radii.md'
  | 'animation.duration.fast'
  | 'semantic.button.primary.background'
  | 'semantic.panel.elevated.shadow'
  | string; // 兜底类型

/** Token 值类型 */
export type TokenValue<T extends string> = 
  T extends 'colors.brand.primary' ? string :
  T extends 'colors.background.base' ? string :
  T extends 'spacing.md' ? number :
  T extends 'animation.duration.fast' ? number :
  T extends `semantic.button.${infer V}.background` ? string :
  T extends `semantic.panel.${infer V}.shadow` ? string :
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

// ============ Helper Types ============

/** 类型守卫：检查是否为 ColorPrimitives */
export function isColorPrimitives(colors: Colors): colors is ColorPrimitives {
  return 'brand' in colors && 'background' in colors && 'border' in colors;
}
