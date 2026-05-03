/**
 * 语义 Token 生成器
 * 
 * 根据主题色板动态生成语义 Token
 * 解决硬编码问题，实现主题切换时语义 Token 自动更新
 */

import type {
  CyberpunkPrimitives,
  MinimalPrimitives,
  ProfessionalPrimitives
} from '../tokens/colors';
import type { ColorPrimitives } from '../types';

// 定义主题原语类型 - 兼容 colors.ts 中导出的所有主题原语
export type ThemePrimitives =
  | typeof CyberpunkPrimitives
  | typeof MinimalPrimitives
  | typeof ProfessionalPrimitives
  | ColorPrimitives;

// 辅助函数：为 hex 颜色添加透明度（返回 rgba）
function alpha(color: string, opacity: number): string {
  const hex = color.replace('#', '');
  if (!/^[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$/.test(hex)) {
    return `rgba(128, 128, 128, ${opacity})`;
  }
  let fullHex: string;
  if (hex.length === 3) {
    fullHex = hex.split('').map(c => c + c).join('');
  } else {
    fullHex = hex;
  }
  const r = parseInt(fullHex.slice(0, 2), 16);
  const g = parseInt(fullHex.slice(2, 4), 16);
  const b = parseInt(fullHex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// ============ 按钮语义 Token ============

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

export interface ButtonSemanticSet {
  primary: ButtonSemanticToken;
  secondary: ButtonSemanticToken;
  tertiary: ButtonSemanticToken;  // 第三级按钮（幽灵按钮）
  success: ButtonSemanticToken;
  danger: ButtonSemanticToken;
  warning: ButtonSemanticToken;
  ghost: ButtonSemanticToken;     // 透明背景
  disabled: ButtonSemanticToken;
}

export function generateButtonSemantic(
  colors: ThemePrimitives,
  radii: { md: string }
): ButtonSemanticSet {
  const { brand, background, text, border, interactive, status } = colors;
  
  return {
    primary: {
      background: brand.primary,
      backgroundHover: interactive.hover,
      backgroundActive: interactive.active,
      text: text.inverse,
      border: 'none',
      borderRadius: radii.md,
      padding: '10px 20px',
      shadow: `0 2px 4px ${brand.primary}40`,
      shadowHover: `0 4px 8px ${brand.primary}60`,
    },
    
    secondary: {
      background: background.elevated,
      backgroundHover: background.overlay,
      backgroundActive: border.strong,
      text: brand.primary,
      border: `1px solid ${brand.primary}`,
      borderRadius: radii.md,
      padding: '10px 20px',
    },
    
    tertiary: {
      background: background.overlay,
      backgroundHover: border.subtle,
      backgroundActive: border.default,
      text: text.primary,
      border: `1px solid ${border.default}`,
      borderRadius: radii.md,
      padding: '10px 20px',
    },
    
    success: {
      background: status.success,
      backgroundHover: `${status.success}e0`,  // 87% 不透明度
      backgroundActive: `${status.success}c0`, // 75% 不透明度
      text: text.inverse,
      border: 'none',
      borderRadius: radii.md,
      padding: '10px 20px',
    },
    
    danger: {
      background: status.danger,
      backgroundHover: `${status.danger}e0`,
      backgroundActive: `${status.danger}c0`,
      text: text.inverse,
      border: 'none',
      borderRadius: radii.md,
      padding: '10px 20px',
    },
    
    warning: {
      background: status.warning,
      backgroundHover: `${status.warning}e0`,
      backgroundActive: `${status.warning}c0`,
      text: background.base,  // 在亮色警告上使用深色文字
      border: 'none',
      borderRadius: radii.md,
      padding: '10px 20px',
    },
    
    ghost: {
      background: 'transparent',
      backgroundHover: `${brand.primary}15`,  // 8% 品牌色
      backgroundActive: `${brand.primary}25`, // 15% 品牌色
      text: brand.primary,
      border: 'none',
      borderRadius: radii.md,
      padding: '10px 20px',
    },
    
    disabled: {
      background: background.sunken,
      backgroundHover: background.sunken,
      backgroundActive: background.sunken,
      text: text.disabled,
      border: 'none',
      borderRadius: radii.md,
      padding: '10px 20px',
    },
  };
}

// ============ 面板语义 Token ============

export interface PanelSemanticToken {
  background: string;
  border: string;
  borderRadius: string;
  padding: string;
  shadow: string;
}

export interface PanelSemanticSet {
  default: PanelSemanticToken;
  elevated: PanelSemanticToken;
  outlined: PanelSemanticToken;
  ghost: PanelSemanticToken;
  sunken: PanelSemanticToken;  // 凹陷面板
}

export function generatePanelSemantic(
  colors: ThemePrimitives,
  radii: { md: string; lg: string },
  shadows: { sm: string; md: string }
): PanelSemanticSet {
  const { background, border } = colors;
  
  return {
    default: {
      background: background.elevated,
      border: `1px solid ${border.default}`,
      borderRadius: radii.md,
      padding: '16px',
      shadow: shadows.sm,
    },
    
    elevated: {
      background: background.elevated,
      border: `1px solid ${border.subtle}`,
      borderRadius: radii.lg,
      padding: '20px',
      shadow: shadows.md,
    },
    
    outlined: {
      background: 'transparent',
      border: `1px solid ${border.default}`,
      borderRadius: radii.md,
      padding: '16px',
      shadow: 'none',
    },
    
    ghost: {
      background: `${background.elevated}80`,  // 50% 透明
      border: 'none',
      borderRadius: radii.md,
      padding: '16px',
      shadow: 'none',
    },
    
    sunken: {
      background: background.sunken,
      border: `1px solid ${border.subtle}`,
      borderRadius: radii.md,
      padding: '16px',
      shadow: 'inset 0 2px 4px rgba(0,0,0,0.1)',
    },
  };
}

// ============ 输入框语义 Token ============

export interface InputStateToken {
  background: string;
  border: string;
  text: string;
  placeholder: string;
  shadow?: string;
}

export interface InputSemanticSet {
  default: InputStateToken;
  hover: InputStateToken;
  focus: InputStateToken;
  error: InputStateToken;
  success: InputStateToken;
  disabled: InputStateToken;
  readonly: InputStateToken;
}

export function generateInputSemantic(
  colors: ThemePrimitives
): InputSemanticSet {
  const { background, border, text, interactive, status } = colors;
  
  return {
    default: {
      background: background.sunken,
      border: border.default,
      text: text.primary,
      placeholder: text.muted,
    },
    
    hover: {
      background: background.sunken,
      border: border.strong,
      text: text.primary,
      placeholder: text.muted,
    },
    
    focus: {
      background: background.sunken,
      border: interactive.default,
      text: text.primary,
      placeholder: text.muted,
      shadow: `0 0 0 3px ${interactive.default}20`,  // 12% 透明度
    },
    
    error: {
      background: background.sunken,
      border: status.danger,
      text: text.primary,
      placeholder: text.muted,
      shadow: `0 0 0 3px ${status.danger}20`,
    },
    
    success: {
      background: background.sunken,
      border: status.success,
      text: text.primary,
      placeholder: text.muted,
      shadow: `0 0 0 3px ${status.success}20`,
    },
    
    disabled: {
      background: background.elevated,
      border: border.subtle,
      text: text.disabled,
      placeholder: text.disabled,
    },
    
    readonly: {
      background: background.elevated,
      border: border.subtle,
      text: text.secondary,
      placeholder: text.muted,
    },
  };
}

// ============ 状态/反馈语义 Token ============

export interface StatusToken {
  background: string;
  backgroundSubtle: string;
  border: string;
  text: string;
  icon: string;
}

export interface StatusSemanticSet {
  success: StatusToken;
  warning: StatusToken;
  danger: StatusToken;
  info: StatusToken;
  neutral: StatusToken;
}

export function generateStatusSemantic(
  colors: ThemePrimitives
): StatusSemanticSet {
  const { text, status } = colors;

  return {
    success: {
      background: alpha(status.success, 0.15),
      backgroundSubtle: alpha(status.success, 0.08),
      border: alpha(status.success, 0.3),
      text: status.success,
      icon: status.success,
    },
    
    warning: {
      background: alpha(status.warning, 0.15),
      backgroundSubtle: alpha(status.warning, 0.08),
      border: alpha(status.warning, 0.3),
      text: status.warning,
      icon: status.warning,
    },
    
    danger: {
      background: alpha(status.danger, 0.15),
      backgroundSubtle: alpha(status.danger, 0.08),
      border: alpha(status.danger, 0.3),
      text: status.danger,
      icon: status.danger,
    },
    
    info: {
      background: alpha(status.info, 0.15),
      backgroundSubtle: alpha(status.info, 0.08),
      border: alpha(status.info, 0.3),
      text: status.info,
      icon: status.info,
    },
    
    neutral: {
      background: alpha(text.secondary, 0.1),
      backgroundSubtle: alpha(text.secondary, 0.05),
      border: alpha(text.secondary, 0.2),
      text: text.secondary,
      icon: text.secondary,
    },
  };
}

// ============ 表单语义 Token ============

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

export function generateFormSemantic(
  colors: ThemePrimitives
): FormSemanticSet {
  const { text, border, background, status } = colors;
  
  return {
    label: {
      color: text.secondary,
      requiredColor: status.danger,
      fontSize: '13px',
      fontWeight: 500,
    },
    helpText: {
      color: text.muted,
      errorColor: status.danger,
      successColor: status.success,
      fontSize: '12px',
    },
    fieldset: {
      border: border.default,
      background: background.elevated,
    },
    layout: {
      gap: '16px',
      labelGap: '6px',
      fieldMarginBottom: '16px',
    },
  };
}

// ============ 导航语义 Token ============

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

export function generateNavigationSemantic(
  colors: ThemePrimitives
): NavigationSemanticSet {
  const { background, text, border, interactive } = colors;
  
  return {
    background: background.elevated,
    itemDefault: {
      background: 'transparent',
      text: text.secondary,
    },
    itemHover: {
      background: `${interactive.default}10`,  // 6% 透明度
      text: text.primary,
    },
    itemActive: {
      background: `${interactive.default}15`,  // 8% 透明度
      text: interactive.default,
      indicator: interactive.default,
    },
    divider: border.default,
  };
}

// ============ Tooltip 语义 Token ============

export interface TooltipSemanticToken {
  background: string;
  text: string;
  border: string;
  shadow: string;
  borderRadius: string;
  padding: string;
  arrowColor: string;
}

export interface TooltipSemanticSet {
  default: TooltipSemanticToken;
  dark: TooltipSemanticToken;
  light: TooltipSemanticToken;
}

export function generateTooltipSemantic(
  colors: ThemePrimitives,
  radii: { sm: string; md: string },
  shadows: { sm: string; md: string }
): TooltipSemanticSet {
  const { background, text, border } = colors;

  return {
    default: {
      background: background.elevated,
      text: text.primary,
      border: `1px solid ${border.default}`,
      shadow: shadows.md,
      borderRadius: radii.md,
      padding: '8px 12px',
      arrowColor: background.elevated,
    },
    dark: {
      background: background.base,
      text: text.primary,
      border: `1px solid ${border.subtle}`,
      shadow: shadows.md,
      borderRadius: radii.md,
      padding: '8px 12px',
      arrowColor: background.base,
    },
    light: {
      background: background.overlay,
      text: text.primary,
      border: `1px solid ${border.default}`,
      shadow: shadows.sm,
      borderRadius: radii.sm,
      padding: '6px 10px',
      arrowColor: background.overlay,
    },
  };
}

// ============ Table / DataGrid 语义 Token ============

export interface TableSemanticToken {
  headerBackground: string;
  headerText: string;
  rowBackground: string;
  rowBackgroundAlt: string;
  rowHover: string;
  border: string;
  text: string;
  selectedBackground: string;
}

export function generateTableSemantic(
  colors: ThemePrimitives
): TableSemanticToken {
  const { background, text, border, interactive } = colors;

  return {
    headerBackground: background.elevated,
    headerText: text.primary,
    rowBackground: background.base,
    rowBackgroundAlt: background.elevated,
    rowHover: alpha(interactive.default, 0.06),
    border: border.subtle,
    text: text.primary,
    selectedBackground: alpha(interactive.default, 0.1),
  };
}

// ============ Card 语义 Token ============

export interface CardSemanticToken {
  background: string;
  border: string;
  borderRadius: string;
  shadow: string;
  padding: string;
  headerBackground: string;
  footerBackground: string;
}

export interface CardSemanticSet {
  default: CardSemanticToken;
  elevated: CardSemanticToken;
  outlined: CardSemanticToken;
  compact: CardSemanticToken;
}

export function generateCardSemantic(
  colors: ThemePrimitives,
  radii: { md: string; lg: string },
  shadows: { sm: string; md: string }
): CardSemanticSet {
  const { background, border } = colors;

  return {
    default: {
      background: background.elevated,
      border: `1px solid ${border.default}`,
      borderRadius: radii.md,
      shadow: shadows.sm,
      padding: '16px',
      headerBackground: background.elevated,
      footerBackground: background.elevated,
    },
    elevated: {
      background: background.elevated,
      border: `1px solid ${border.subtle}`,
      borderRadius: radii.lg,
      shadow: shadows.md,
      padding: '20px',
      headerBackground: background.elevated,
      footerBackground: background.elevated,
    },
    outlined: {
      background: 'transparent',
      border: `1px solid ${border.default}`,
      borderRadius: radii.md,
      shadow: 'none',
      padding: '16px',
      headerBackground: 'transparent',
      footerBackground: 'transparent',
    },
    compact: {
      background: background.elevated,
      border: `1px solid ${border.subtle}`,
      borderRadius: radii.md,
      shadow: 'none',
      padding: '12px',
      headerBackground: background.elevated,
      footerBackground: background.elevated,
    },
  };
}

// ============ Divider 语义 Token ============

export interface DividerSemanticToken {
  color: string;
  width: string;
  style: 'solid' | 'dashed' | 'dotted';
  margin: string;
}

export function generateDividerSemantic(
  colors: ThemePrimitives
): DividerSemanticToken {
  const { border } = colors;

  return {
    color: border.subtle,
    width: '1px',
    style: 'solid',
    margin: '16px 0',
  };
}

// ============ Scrollbar 语义 Token ============

export interface ScrollbarSemanticToken {
  track: string;
  thumb: string;
  thumbHover: string;
  width: string;
  borderRadius: string;
}

export function generateScrollbarSemantic(
  colors: ThemePrimitives
): ScrollbarSemanticToken {
  const { background, border, interactive } = colors;

  return {
    track: background.sunken,
    thumb: border.strong,
    thumbHover: interactive.hover,
    width: '8px',
    borderRadius: '4px',
  };
}

// ============ Badge / Tag 语义 Token ============

export interface BadgeSemanticToken {
  background: string;
  text: string;
  border: string;
  borderRadius: string;
  padding: string;
}

export interface BadgeSemanticSet {
  success: BadgeSemanticToken;
  warning: BadgeSemanticToken;
  danger: BadgeSemanticToken;
  info: BadgeSemanticToken;
  neutral: BadgeSemanticToken;
  primary: BadgeSemanticToken;
}

export function generateBadgeSemantic(
  colors: ThemePrimitives
): BadgeSemanticSet {
  const { text, status, brand } = colors;

  return {
    success: {
      background: alpha(status.success, 0.15),
      text: status.success,
      border: `1px solid ${alpha(status.success, 0.3)}`,
      borderRadius: '9999px',
      padding: '2px 10px',
    },
    warning: {
      background: alpha(status.warning, 0.15),
      text: status.warning,
      border: `1px solid ${alpha(status.warning, 0.3)}`,
      borderRadius: '9999px',
      padding: '2px 10px',
    },
    danger: {
      background: alpha(status.danger, 0.15),
      text: status.danger,
      border: `1px solid ${alpha(status.danger, 0.3)}`,
      borderRadius: '9999px',
      padding: '2px 10px',
    },
    info: {
      background: alpha(status.info, 0.15),
      text: status.info,
      border: `1px solid ${alpha(status.info, 0.3)}`,
      borderRadius: '9999px',
      padding: '2px 10px',
    },
    neutral: {
      background: alpha(text.secondary, 0.1),
      text: text.secondary,
      border: `1px solid ${alpha(text.secondary, 0.2)}`,
      borderRadius: '9999px',
      padding: '2px 10px',
    },
    primary: {
      background: alpha(brand.primary, 0.15),
      text: brand.primary,
      border: `1px solid ${alpha(brand.primary, 0.3)}`,
      borderRadius: '9999px',
      padding: '2px 10px',
    },
  };
}

// ============ Avatar 语义 Token ============

export interface AvatarSemanticToken {
  background: string;
  text: string;
  border: string;
  borderRadius: string;
  placeholderBackground: string;
  placeholderText: string;
}

export function generateAvatarSemantic(
  colors: ThemePrimitives
): AvatarSemanticToken {
  const { background, text, border, brand } = colors;

  return {
    background: alpha(brand.primary, 0.15),
    text: brand.primary,
    border: `2px solid ${border.subtle}`,
    borderRadius: '9999px',
    placeholderBackground: background.sunken,
    placeholderText: text.muted,
  };
}

// ============ Progress / Loading 语义 Token ============

export interface ProgressSemanticToken {
  track: string;
  fill: string;
  fillSuccess: string;
  fillWarning: string;
  fillDanger: string;
  text: string;
  height: string;
  borderRadius: string;
}

export function generateProgressSemantic(
  colors: ThemePrimitives
): ProgressSemanticToken {
  const { background, text, status, brand } = colors;

  return {
    track: background.sunken,
    fill: brand.primary,
    fillSuccess: status.success,
    fillWarning: status.warning,
    fillDanger: status.danger,
    text: text.secondary,
    height: '8px',
    borderRadius: '4px',
  };
}

// ============ Skeleton 语义 Token ============

export interface SkeletonSemanticToken {
  base: string;
  highlight: string;
  borderRadius: string;
  shimmerDuration: number;
}

export function generateSkeletonSemantic(
  colors: ThemePrimitives
): SkeletonSemanticToken {
  const { background, border } = colors;

  return {
    base: background.elevated,
    highlight: border.subtle,
    borderRadius: '4px',
    shimmerDuration: 1500,
  };
}

// ============ 渐变语义 Token ============

export interface GradientSemanticToken {
  brand: {
    primary: string;
    subtle: string;
    glow: string;
  };
  background: {
    base: string;
    elevated: string;
    subtle: string;
  };
  status: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
}

export function generateGradientSemantic(
  colors: ThemePrimitives
): GradientSemanticToken {
  const { brand, background, status } = colors;

  return {
    brand: {
      primary: `linear-gradient(135deg, ${brand.primary} 0%, ${brand.secondary} 100%)`,
      subtle: `linear-gradient(135deg, ${brand.primary}20 0%, ${brand.secondary}10 100%)`,
      glow: `linear-gradient(135deg, ${brand.primary}40 0%, transparent 100%)`,
    },
    background: {
      base: `linear-gradient(180deg, ${background.base} 0%, ${background.elevated} 100%)`,
      elevated: `linear-gradient(180deg, ${background.elevated} 0%, ${background.overlay} 100%)`,
      subtle: `linear-gradient(180deg, transparent 0%, ${background.overlay}60 100%)`,
    },
    status: {
      success: `linear-gradient(135deg, ${status.success}20 0%, ${status.success}05 100%)`,
      warning: `linear-gradient(135deg, ${status.warning}20 0%, ${status.warning}05 100%)`,
      danger: `linear-gradient(135deg, ${status.danger}20 0%, ${status.danger}05 100%)`,
      info: `linear-gradient(135deg, ${status.info}20 0%, ${status.info}05 100%)`,
    },
  };
}

// ============ Glassmorphism 语义 Token ============

export interface GlassSemanticToken {
  background: string;
  backgroundHover: string;
  border: string;
  borderRadius: string;
  shadow: string;
  backdropBlur: string;
  saturation: string;
}

export function generateGlassSemantic(
  colors: ThemePrimitives,
  radii: { md: string },
  shadows: { md: string }
): GlassSemanticToken {
  const { background, border, brand } = colors;

  // 根据背景色亮度判断主题类型
  const bgHex = background.base.replace('#', '');
  const r = parseInt(bgHex.slice(0, 2), 16);
  const g = parseInt(bgHex.slice(2, 4), 16);
  const b = parseInt(bgHex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const isDark = luminance < 0.5;

  if (isDark) {
    // Cyberpunk / 深色主题
    return {
      background: 'rgba(13, 13, 20, 0.7)',
      backgroundHover: 'rgba(13, 13, 20, 0.8)',
      border: `1px solid ${brand.primary}20`,
      borderRadius: radii.md,
      shadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 16px ${brand.primary}15`,
      backdropBlur: '12px',
      saturation: '120%',
    };
  }

  // 浅色主题（Minimal / Professional）
  return {
    background: 'rgba(255, 255, 255, 0.8)',
    backgroundHover: 'rgba(255, 255, 255, 0.9)',
    border: `1px solid ${border.subtle}`,
    borderRadius: radii.md,
    shadow: shadows.md,
    backdropBlur: '16px',
    saturation: '100%',
  };
}

// ============ 完整语义 Token 集合 ============

export interface CompleteSemanticTokens {
  button: ButtonSemanticSet;
  panel: PanelSemanticSet;
  input: InputSemanticSet;
  status: StatusSemanticSet;
  form: FormSemanticSet;
  navigation: NavigationSemanticSet;
  tooltip: TooltipSemanticSet;
  table: TableSemanticToken;
  card: CardSemanticSet;
  divider: DividerSemanticToken;
  scrollbar: ScrollbarSemanticToken;
  badge: BadgeSemanticSet;
  avatar: AvatarSemanticToken;
  progress: ProgressSemanticToken;
  skeleton: SkeletonSemanticToken;
  gradient: GradientSemanticToken;
  glass: GlassSemanticToken;
}

export function generateAllSemanticTokens(
  colors: ThemePrimitives,
  radii: { sm: string; md: string; lg: string; xl: string },
  shadows: { sm: string; md: string; lg: string }
): CompleteSemanticTokens {
  return {
    button: generateButtonSemantic(colors, radii),
    panel: generatePanelSemantic(colors, radii, shadows),
    input: generateInputSemantic(colors),
    status: generateStatusSemantic(colors),
    form: generateFormSemantic(colors),
    navigation: generateNavigationSemantic(colors),
    tooltip: generateTooltipSemantic(colors, radii, shadows),
    table: generateTableSemantic(colors),
    card: generateCardSemantic(colors, radii, shadows),
    divider: generateDividerSemantic(colors),
    scrollbar: generateScrollbarSemantic(colors),
    badge: generateBadgeSemantic(colors),
    avatar: generateAvatarSemantic(colors),
    progress: generateProgressSemantic(colors),
    skeleton: generateSkeletonSemantic(colors),
    gradient: generateGradientSemantic(colors),
    glass: generateGlassSemantic(colors, radii, shadows),
  };
}
