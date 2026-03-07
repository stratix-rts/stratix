/**
 * UI Framework - Theme Types
 * 
 * 主题相关类型定义
 */

import type { DesignSystemTokens, ThemeName } from '@/design-system/types';

/**
 * 主题变化处理器
 */
export type ThemeChangeHandler = (theme: DesignSystemTokens) => void;

/**
 * Token变化处理器
 */
export type TokenChangeHandler<T = any> = (newValue: T, oldValue?: T) => void;

/**
 * 主题订阅配置
 */
export interface ThemeSubscriptionConfig {
  /** 是否立即触发一次 */
  immediate?: boolean;
  /** 订阅特定Token路径 */
  tokenPath?: string;
}

/**
 * 响应式Token配置
 */
export interface ReactiveTokenConfig {
  /** Token路径 */
  path: string;
  /** 默认值 */
  defaultValue?: any;
  /** 转换函数 */
  transform?: (value: any) => any;
}

/**
 * 主题上下文状态
 */
export interface ThemeContextState {
  /** 当前主题名称 */
  currentTheme: ThemeName;
  /** 是否正在切换主题 */
  isTransitioning: boolean;
  /** 订阅者数量 */
  subscriberCount: number;
}
