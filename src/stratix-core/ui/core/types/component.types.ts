/**
 * UI Framework - Component Types
 * 
 * 组件相关类型定义
 */

import type { DesignSystemTokens } from '@/design-system/types';

/**
 * UI组件状态
 */
export enum ComponentState {
  CREATED = 'created',
  READY = 'ready',
  MOUNTED = 'mounted',
  UPDATED = 'updated',
  DESTROYED = 'destroyed',
  ERROR = 'error',
}

/**
 * UI组件配置基础接口
 */
export interface UIComponentConfig {
  /** X坐标 */
  x?: number;
  /** Y坐标 */
  y?: number;
  /** 宽度 */
  width?: number;
  /** 高度 */
  height?: number;
  /** 深度层级 */
  depth?: number;
  /** 是否可见 */
  visible?: boolean;
  /** 是否响应主题变化 */
  reactiveTheme?: boolean;
  /** 自定义数据 */
  data?: Record<string, any>;
}

/**
 * 主题感知接口
 */
export interface IThemeAware {
  /** 当主题变化时调用 */
  onThemeChange(newTheme: DesignSystemTokens): void;
}

/**
 * UI组件生命周期接口
 */
export interface IUIComponentLifecycle {
  /** 组件创建时 */
  onCreate(): void;
  /** 组件挂载时 */
  onMount(): void;
  /** 组件更新时 */
  onUpdate(delta: number): void;
  /** 组件销毁时 */
  onDestroy(): void;
}

/**
 * 响应式Token（类型引用）
 */
export type ReactiveTokenRef<T = any> = {
  get(): T;
  subscribe(handler: (value: T, oldValue?: T) => void): () => void;
  destroy(): void;
};
