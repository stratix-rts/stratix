/**
 * UI Framework - Event Types
 * 
 * UI事件系统类型定义
 */

/**
 * UI事件类型
 */
export enum UIEventType {
  // 组件生命周期
  COMPONENT_CREATED = 'component:created',
  COMPONENT_MOUNTED = 'component:mounted',
  COMPONENT_UPDATED = 'component:updated',
  COMPONENT_DESTROYED = 'component:destroyed',
  
  // 交互事件
  CLICK = 'ui:click',
  DOUBLE_CLICK = 'ui:double_click',
  RIGHT_CLICK = 'ui:right_click',
  DRAG_START = 'ui:drag_start',
  DRAG = 'ui:drag',
  DRAG_END = 'ui:drag_end',
  HOVER_ENTER = 'ui:hover_enter',
  HOVER_LEAVE = 'ui:hover_leave',
  FOCUS = 'ui:focus',
  BLUR = 'ui:blur',
  
  // 键盘事件
  KEY_DOWN = 'ui:key_down',
  KEY_UP = 'ui:key_up',
  KEY_PRESS = 'ui:key_press',
  
  // 状态事件
  STATE_CHANGE = 'ui:state_change',
  THEME_CHANGE = 'ui:theme_change',
  LAYOUT_UPDATE = 'ui:layout_update',
  
  // 系统事件
  SCENE_READY = 'ui:scene_ready',
  SCENE_SHUTDOWN = 'ui:scene_shutdown',
  RESIZE = 'ui:resize',
  
  // 调试事件
  DEBUG_TOGGLE = 'ui:debug_toggle',
  RECORDING_START = 'ui:recording_start',
  RECORDING_STOP = 'ui:recording_stop',
}

/**
 * UI事件数据基础接口
 */
export interface UIEventBase {
  /** 事件类型 */
  type: UIEventType;
  /** 时间戳 */
  timestamp: number;
  /** 源组件ID */
  sourceId?: string;
  /** 是否冒泡 */
  bubbles?: boolean;
  /** 是否可取消 */
  cancelable?: boolean;
}

/**
 * 组件事件
 */
export interface ComponentEvent extends UIEventBase {
  /** 组件ID */
  componentId: string;
  /** 组件类型 */
  componentType: string;
  /** 组件状态 */
  state?: any;
}

/**
 * 交互事件
 */
export interface InteractionEvent extends UIEventBase {
  /** 目标组件ID */
  targetId: string;
  /** 鼠标/触摸位置 */
  position: { x: number; y: number };
  /** 全局位置 */
  globalPosition: { x: number; y: number };
  /** 是否按下Shift */
  shiftKey?: boolean;
  /** 是否按下Ctrl */
  ctrlKey?: boolean;
  /** 是否按下Alt */
  altKey?: boolean;
  /** 是否按下Meta */
  metaKey?: boolean;
}

/**
 * 键盘事件
 */
export interface KeyboardEvent extends UIEventBase {
  /** 按键 */
  key: string;
  /** 键码 */
  keyCode: number;
  /** 是否按下Shift */
  shiftKey: boolean;
  /** 是否按下Ctrl */
  ctrlKey: boolean;
  /** 是否按下Alt */
  altKey: boolean;
  /** 是否按下Meta */
  metaKey: boolean;
}

/**
 * 状态变化事件
 */
export interface StateChangeEvent extends UIEventBase {
  /** 目标ID */
  targetId: string;
  /** 属性名 */
  property: string;
  /** 旧值 */
  oldValue: any;
  /** 新值 */
  newValue: any;
}

/**
 * 事件监听器
 */
export type UIEventListener<T = any> = (event: T) => void;

/**
 * 事件订阅选项
 */
export interface EventSubscriptionOptions {
  /** 是否只触发一次 */
  once?: boolean;
  /** 优先级 */
  priority?: number;
  /** 是否被动（不能阻止默认行为） */
  passive?: boolean;
}
