/**
 * UI Framework - Recording Types
 * 
 * UI录制/回放系统类型定义
 */

/**
 * 录制的事件类型
 */
export enum EventType {
  CLICK = 'click',
  DRAG_START = 'drag_start',
  DRAG_MOVE = 'drag_move',
  DRAG_END = 'drag_end',
  HOVER = 'hover',
  HOVER_LEAVE = 'hover_leave',
  KEY_PRESS = 'key_press',
  STATE_CHANGE = 'state_change',
  LAYOUT_UPDATE = 'layout_update',
  COMPONENT_MOUNT = 'component_mount',
  COMPONENT_DESTROY = 'component_destroy',
  THEME_CHANGE = 'theme_change',
  SNAPSHOT = 'snapshot',
}

/**
 * 录制的事件
 */
export interface RecordedEvent {
  /** 时间戳（相对于录制开始） */
  timestamp: number;
  /** 事件类型 */
  type: EventType;
  /** 目标组件ID */
  target: string;
  /** 事件数据 */
  data: any;
  /** UI快照（可选） */
  snapshot?: UIComponentSnapshot;
}

/**
 * UI组件快照
 */
export interface UIComponentSnapshot {
  /** 组件ID */
  id: string;
  /** 组件类型 */
  type: string;
  /** 边界 */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** 组件状态 */
  state: Record<string, any>;
  /** 子组件快照 */
  children?: UIComponentSnapshot[];
}

/**
 * 录制元数据
 */
export interface RecordingMetadata {
  /** 版本号 */
  version: string;
  /** 游戏版本 */
  gameVersion: string;
  /** 屏幕分辨率 */
  screenResolution: {
    width: number;
    height: number;
  };
  /** FPS */
  fps: number;
  /** 标签 */
  tags: string[];
  /** 创建时间 */
  createdAt: number;
  /** 持续时间（毫秒） */
  duration: number;
  /** 事件数量 */
  eventCount: number;
}

/**
 * 完整的UI录制
 */
export interface UIRecording {
  /** 录制ID */
  id: string;
  /** 录制名称 */
  name: string;
  /** 描述 */
  description?: string;
  /** 开始时间 */
  startTime: number;
  /** 结束时间 */
  endTime: number;
  /** 事件列表 */
  events: RecordedEvent[];
  /** 元数据 */
  metadata: RecordingMetadata;
}

/**
 * 录制配置
 */
export interface RecordingOptions {
  /** 快照间隔（毫秒） */
  snapshotInterval?: number;
  /** 是否记录快照 */
  recordSnapshots?: boolean;
  /** 要记录的事件类型 */
  eventTypes?: EventType[];
  /** 最大事件数量 */
  maxEvents?: number;
}

/**
 * 回放配置
 */
export interface PlaybackOptions {
  /** 播放速度（1.0为正常速度） */
  speed?: number;
  /** 是否恢复快照 */
  restoreSnapshot?: boolean;
  /** 开始时间（毫秒） */
  startTime?: number;
  /** 是否循环播放 */
  loop?: boolean;
}

/**
 * 录制摘要（用于列表显示）
 */
export interface RecordingSummary {
  /** 录制ID */
  id: string;
  /** 录制名称 */
  name: string;
  /** 持续时间（毫秒） */
  duration: number;
  /** 事件数量 */
  eventCount: number;
  /** 创建时间 */
  createdAt: number;
}
