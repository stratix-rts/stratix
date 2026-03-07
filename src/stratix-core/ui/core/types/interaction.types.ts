/**
 * UI Framework - Interaction Types
 * 
 * 交互相关类型定义
 */

/**
 * 交互适配器配置
 */
export interface InteractionAdapterConfig {
  /** 是否启用 */
  enabled?: boolean;
  /** 是否静音 */
  muted?: boolean;
}

/**
 * 按钮交互配置
 */
export interface ButtonInteractionConfig extends InteractionAdapterConfig {
  /** 普通状态颜色 */
  normalColor?: string;
  /** Hover状态颜色 */
  hoverColor?: string;
  /** Active状态颜色 */
  activeColor?: string;
  /** Disabled状态颜色 */
  disabledColor?: string;
  /** 点击回调 */
  onClick: () => void;
  /** 动画持续时间（毫秒） */
  animationDuration?: number;
}

/**
 * Hover交互配置
 */
export interface HoverInteractionConfig extends InteractionAdapterConfig {
  /** 进入回调 */
  onEnter?: () => void;
  /** 离开回调 */
  onLeave?: () => void;
  /** Hover状态颜色 */
  hoverColor?: string;
  /** 动画持续时间（毫秒） */
  animationDuration?: number;
}

/**
 * 拖拽交互配置
 */
export interface DragInteractionConfig extends InteractionAdapterConfig {
  /** 拖拽开始回调 */
  onDragStart?: (x: number, y: number) => void;
  /** 拖拽中回调 */
  onDrag?: (x: number, y: number) => void;
  /** 拖拽结束回调 */
  onDragEnd?: (x: number, y: number) => void;
  /** 是否限制在父容器内 */
  constrainToParent?: boolean;
}

/**
 * 交互状态
 */
export enum InteractionState {
  IDLE = 'idle',
  HOVER = 'hover',
  ACTIVE = 'active',
  DRAGGING = 'dragging',
  DISABLED = 'disabled',
}
