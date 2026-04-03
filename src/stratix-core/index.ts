/**
 * Stratix Core - 核心协议层
 *
 * 统一数据协议定义和事件总线，是所有模块的依赖基础
 */

// 导出数据协议
export * from './stratix-protocol';

// 导出事件总线
export { default as StratixEventBus } from './StratixEventBus';

// 导出事件总线类型
export type {
  TypedEventBus,
  WildcardEventBus,
  EnableableEventBus,
  QueuedEventBus,
  RequestResponseEventBus,
  EventBusFactory,
} from './types/event-bus-types';

// 导出类型定义 (global declarations)
export type {
  AgentStatus,
  CommandStatus,
  AgentType,
  SkillParameterType,
  AgentConfigStatus,
  AgentConnectionStatus,
  AgentActivityStatus,
  AgentStatusInfo
} from './types/stratix-types';

// 导出工具类
export * from './utils/index';
