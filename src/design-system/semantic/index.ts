/**
 * Semantic Tokens 聚合导出
 *
 * Level 2: 语义化令牌 - 主题感知
 *
 * 使用方法：
 * import { getButtonSemantic, getPanelSemantic } from '@/design-system/semantic';
 * import { getCurrentTheme } from '@/design-system/config';
 *
 * const theme = getCurrentTheme();
 * const buttons = getButtonSemantic(theme);
 * const panels = getPanelSemantic(theme);
 */

// 核心生成器（高级用法）
export {
  generateAllSemanticTokens,
  generateButtonSemantic,
  generatePanelSemantic,
  generateInputSemantic,
  generateStatusSemantic,
  generateFormSemantic,
  generateNavigationSemantic,
  generateTooltipSemantic,
  generateTableSemantic,
  generateCardSemantic,
  generateDividerSemantic,
  generateScrollbarSemantic,
  generateBadgeSemantic,
  generateAvatarSemantic,
  generateProgressSemantic,
  generateSkeletonSemantic,
  generateGradientSemantic,
  generateGlassSemantic,
} from './_generator';

export type { ThemePrimitives } from './_generator';

export type {
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
  TooltipSemanticSet,
  TooltipSemanticToken,
  TableSemanticToken,
  CardSemanticSet,
  CardSemanticToken,
  DividerSemanticToken,
  ScrollbarSemanticToken,
  BadgeSemanticSet,
  BadgeSemanticToken,
  AvatarSemanticToken,
  ProgressSemanticToken,
  SkeletonSemanticToken,
  GradientSemanticToken,
  GlassSemanticToken,
} from './_generator';

// 按钮语义
export {
  getButtonSemantic,
  getButtonVariant,
  generateButtonCSSVariables,
  applyButtonStyles,
  ButtonSemantic,  // 向后兼容
} from './buttons';

// 面板语义
export {
  getPanelSemantic,
  getPanelVariant,
  generatePanelCSSVariables,
  applyPanelStyles,
  PanelSemantic,  // 向后兼容
} from './panels';

// 输入框语义
export {
  getInputSemantic,
  getInputState,
  generateInputCSSVariables,
  applyInputStyles,
  bindInputStateEvents,
  InputSemantic,   // 向后兼容
  InputVariants,   // 向后兼容
} from './inputs';

// 状态语义
export {
  getStatusSemantic,
  getStatusVariant,
  generateStatusCSSVariables,
  applyStatusStyles,
  getStatusIcon,
  StatusSemantic,  // 向后兼容
  BadgeVariants,   // 向后兼容
} from './status';

// 表单语义
export {
  getFormSemantic,
  generateFormCSSVariables,
  getFormSize,
  FormSemantic,    // 向后兼容
  FormSizes,
} from './forms';

// 导航语义
export {
  getNavigationSemantic,
  generateNavigationCSSVariables,
} from './navigation';

// Tooltip 语义
export {
  getTooltipSemantic,
  getTooltipVariant,
  generateTooltipCSSVariables,
  applyTooltipStyles,
} from './tooltip';

// Table 语义
export {
  getTableSemantic,
  generateTableCSSVariables,
  applyTableStyles,
} from './table';

// Card 语义
export {
  getCardSemantic,
  getCardVariant,
  generateCardCSSVariables,
  applyCardStyles,
} from './card';

// Divider 语义
export {
  getDividerSemantic,
  generateDividerCSSVariables,
  applyDividerStyles,
} from './divider';

// Scrollbar 语义
export {
  getScrollbarSemantic,
  generateScrollbarCSSVariables,
  generateScrollbarCSS,
} from './scrollbar';

// Badge 语义
export {
  getBadgeSemantic,
  getBadgeVariant,
  generateBadgeCSSVariables,
  applyBadgeStyles,
} from './badge';

// Avatar 语义
export {
  getAvatarSemantic,
  generateAvatarCSSVariables,
  applyAvatarStyles,
} from './avatar';

// Progress 语义
export {
  getProgressSemantic,
  generateProgressCSSVariables,
  applyProgressStyles,
} from './progress';

// Skeleton 语义
export {
  getSkeletonSemantic,
  generateSkeletonCSSVariables,
  applySkeletonStyles,
} from './skeleton';
