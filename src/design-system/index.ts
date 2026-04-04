/**
 * Stratix Design System
 * 
 * 统一的设计语言系统
 * 一人成军，万智听命
 * 
 * @example
 * // 基础使用
 * import { setTheme, getCurrentTheme, getSemanticTokens } from '@/design-system';
 * 
 * // 切换主题
 * setTheme('minimal');
 * 
 * // 获取当前主题
 * const theme = getCurrentTheme();
 * console.log(theme.colors.brand.primary);
 * 
 * // 获取语义 Token（推荐）
 * const semantic = getSemanticTokens();
 * button.style.backgroundColor = semantic.button.primary.background;
 * button.style.color = semantic.button.primary.text;
 * panel.style.boxShadow = semantic.panel.elevated.shadow;
 */

// ============ 核心配置 ============
import { getSemanticTokens } from './config';

export {
  // 主题管理
  DesignSystemConfig,
  getCurrentTheme,
  setTheme,
  getToken,
  getTokens,
  isThemeAvailable,
  getAvailableThemes,
  onThemeChange,
  initDesignSystem,
  restoreThemeFromStorage,
  injectThemeCSSVariables,
  
  // 新增：语义 Token 获取
  getSemanticTokens,
} from './config';

// ============ 类型定义 ============
export type {
  // 基础类型
  DesignSystemTokens,
  ThemeName,
  ThemeConfig,
  TokenPath,
  TokenValue,
  
  // 颜色类型
  ColorPrimitives,
  ColorToken,
  BrandToken,
  BackgroundToken,
  BorderColorToken,
  TextColorToken,
  StatusColorToken,
  InteractiveToken,
  
  // Global Tokens
  SpacingToken,
  RadiiToken,
  BorderToken,
  ShadowToken,
  TypographyToken,
  AnimationToken,
  DepthToken,
  IconToken,
  
  // 语义 Token 类型
  CompleteSemanticTokens,
  ButtonSemanticSet,
  ButtonSemanticToken,
  PanelSemanticSet,
  PanelSemanticToken,
  InputSemanticSet,
  InputStateToken,
  StatusSemanticSet,
  StatusToken,
  FormSemanticSet,
  NavigationSemanticSet,
  
  // 组件类型
  ComponentToken,
  SpacingValue,
  
  // 图标类型
  IconRegistry,
  SVGIconPath,
  GraphicsIconRenderer,
} from './types';

// ============ 基础 Token ============
export {
  // 颜色系统 - 新结构
  Cyan,
  Magenta,
  Indigo,
  Gray,
  Slate,
  Green,
  Amber,
  Red,
  Blue,
  CyberpunkPrimitives,
  MinimalPrimitives,
  ProfessionalPrimitives,
  
  // 向后兼容
  Colors,
  CyberpunkColors,
  MinimalColors,
  ProfessionalColors,
} from './tokens/colors';

export {
  Spacing,
  spacingToPx,
  generateSpacingCSS,
} from './tokens/spacing';

export {
  Radii,
} from './tokens/radii';

export {
  Borders,
  createBorderCSS,
} from './tokens/borders';

export {
  Shadows,
} from './tokens/shadows';

export {
  Typography,
} from './tokens/typography';

export {
  Animation,
  createAnimationCSS,
  generateAnimationCSS,
} from './tokens/animation';

export {
  Depth,
  DepthManager,
  DEPTH_LAYERS,
} from './tokens/depth';

// ============ 语义 Token（主题感知） ============
export {
  // 生成器函数（高级用法）
  generateAllSemanticTokens,
  generateButtonSemantic,
  generatePanelSemantic,
  generateInputSemantic,
  generateStatusSemantic,
  generateFormSemantic,
  generateNavigationSemantic,
} from './semantic/_generator';

export {
  // 按钮
  getButtonSemantic,
  getButtonVariant,
  generateButtonCSSVariables,
  applyButtonStyles,
  ButtonSemantic,  // 向后兼容常量
} from './semantic/buttons';

export {
  // 面板
  getPanelSemantic,
  getPanelVariant,
  generatePanelCSSVariables,
  applyPanelStyles,
  PanelSemantic,  // 向后兼容常量
} from './semantic/panels';

export {
  // 输入框
  getInputSemantic,
  getInputState,
  generateInputCSSVariables,
  applyInputStyles,
  bindInputStateEvents,
  InputSemantic,   // 向后兼容常量
  InputVariants,   // 向后兼容常量
} from './semantic/inputs';

export {
  // 状态
  getStatusSemantic,
  getStatusVariant,
  generateStatusCSSVariables,
  applyStatusStyles,
  getStatusIcon,
  StatusSemantic,  // 向后兼容常量
  BadgeVariants,   // 向后兼容常量
} from './semantic/status';

export {
  // 表单
  getFormSemantic,
  generateFormCSSVariables,
  getFormSize,
  FormSemantic,    // 向后兼容常量
  FormSizes,
} from './semantic/forms';

// ============ 主题系统 ============
export {
  // 主题配置
  CyberpunkTheme,
  MinimalTheme,
  ProfessionalTheme,
  
  // 主题特定配置
  CyberpunkRadii,
  CyberpunkShadows,
  CyberpunkTypography,
  MinimalRadii,
  MinimalShadows,
  MinimalTypography,
  ProfessionalRadii,
  ProfessionalShadows,
  ProfessionalTypography,
  
  // 主题工具
  ThemeRegistry,
  getThemeMeta,
  getAllThemes,
  getThemePreviewStyles,
} from './themes';

export type {
  ThemeMeta,
} from './themes';

// ============ 图标系统 ============
export {
  SVGIconRegistry,
  CustomIconRegistry,
  IconSizes,
  getIconPath,
  getCustomIcon,
  createSVGIcon,
  drawIcon,
  getIconViewBox,
} from './icons/registry';

// ============ 组合式函数 ============
export {
  useZIndexManager,
  resetZIndexCounter,
  getZIndexCounter,
} from './composables/useZIndexManager';

export {
  useSizeContext,
} from './composables/useSizeContext';

// ============ Vue 组件 Token ============
export {
  ModalBaseConfig,
  POSITION_CONFIG,
} from './components/vue/modal';

export type {
  ModalToken,
  ModalSizeConfig,
  ModalPosition,
} from './components/vue/modal';

// ============ 工具函数 ============

/**
 * 快速创建主题感知的按钮样式
 * 
 * @param variant - 按钮变体
 * @returns CSS 样式对象
 * 
 * @example
 * import { createButtonStyle } from '@/design-system';
 * 
 * const style = createButtonStyle('primary');
 * // { backgroundColor: '#00ffff', color: '#0d0d14', ... }
 */
export function createButtonStyle(variant: 'primary' | 'secondary' | 'ghost' | 'danger' = 'primary') {
  const semantic = getSemanticTokens();
  const btn = semantic.button[variant];
  
  return {
    backgroundColor: btn.background,
    color: btn.text,
    border: btn.border,
    borderRadius: btn.borderRadius,
    padding: btn.padding,
    boxShadow: btn.shadow,
    cursor: 'pointer',
    transition: 'all 150ms ease',
    ':hover': {
      backgroundColor: btn.backgroundHover,
      boxShadow: btn.shadowHover,
    },
  };
}

/**
 * 快速创建主题感知的面板样式
 * 
 * @param variant - 面板变体
 * @returns CSS 样式对象
 */
export function createPanelStyle(variant: 'default' | 'elevated' | 'outlined' | 'ghost' = 'default') {
  const semantic = getSemanticTokens();
  const panel = semantic.panel[variant];
  
  return {
    backgroundColor: panel.background,
    border: panel.border,
    borderRadius: panel.borderRadius,
    padding: panel.padding,
    boxShadow: panel.shadow,
  };
}

/**
 * 设计系统版本
 */
export const DesignSystemVersion = '2.0.0';

/**
 * 设计系统描述
 */
export const DesignSystemInfo = {
  name: 'Stratix Design System',
  version: DesignSystemVersion,
  description: '一人成军，万智听命 - 统一的设计语言系统',
  themes: ['cyberpunk', 'minimal', 'professional'],
  features: [
    '主题感知语义 Token',
    'Vue + Phaser 双框架支持',
    '完整的类型定义',
    'CSS 变量自动注入',
    '离线图标系统',
  ],
};
