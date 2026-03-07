/**
 * Stratix Design System
 * 
 * 统一的设计语言系统
 * 一人成军，万智听命
 */

// 导出配置
export { DesignSystemConfig, getCurrentTheme, setTheme, getToken, getTokens } from './config';

// 导出类型
export type * from './types';

// 导出 Global Tokens
export * from './tokens';

// 导出 Semantic Tokens
export * from './semantic';

// 导出图标系统
export * from './icons/registry';

// 导出主题
export * from './themes';

// 导出工具函数
export { DepthManager } from './tokens/depth';
export { createBorderCSS } from './tokens/borders';
export { generateSpacingCSS } from './tokens/spacing';
export { createAnimationCSS, generateAnimationCSS } from './tokens/animation';
export { createSVGIcon, drawIcon } from './icons/registry';

// 导出 Composables
export * from './composables';

// 导出 Modal Token
export { ModalBaseConfig, POSITION_CONFIG, type ModalToken, type ModalSizeConfig, type ModalPosition } from './components/vue/modal';
