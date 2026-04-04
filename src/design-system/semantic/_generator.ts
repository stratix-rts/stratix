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
  
  // 辅助函数：添加透明度
  const alpha = (color: string, opacity: number) => {
    // 确保颜色是有效的 hex 格式
    const hex = color.replace('#', '');
    if (hex.length < 6 || !/^[0-9A-Fa-f]{6}$/.test(hex)) {
      // 如果不是有效的 hex 颜色，返回带透明度的灰色
      return `rgba(128, 128, 128, ${opacity})`;
    }
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  };
  
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

// ============ 完整语义 Token 集合 ============

export interface CompleteSemanticTokens {
  button: ButtonSemanticSet;
  panel: PanelSemanticSet;
  input: InputSemanticSet;
  status: StatusSemanticSet;
  form: FormSemanticSet;
  navigation: NavigationSemanticSet;
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
  };
}
