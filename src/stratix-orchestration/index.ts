// Zone Management
export { ZoneManager } from './zone/ZoneManager';
export { ZoneState, ZoneConfig, ZoneEvent, DEFAULT_ZONE_CONFIG, ZONE_STATUSES, isZoneActive } from './zone/ZoneState';

// Task Queue
export { TaskQueueService } from './task-queue/TaskQueueService';
export { TaskItem, TaskContext, TaskResult, TaskEvent, TaskEventCallback, isTerminalStatus, isValidStatusTransition, TASK_STATUSES, TASK_TYPES } from './task-queue/TaskItem';

// Background Agent Service
export { BackgroundAgentService } from './background/BackgroundAgentService';
export type { AgentProcess, AgentCheckpointData, BackgroundAgentConfig } from './background/AgentProcess';
export { AGENT_STATUSES, isAgentRunning } from './background/AgentProcess';
export { AgentCheckpointManager } from './background/AgentCheckpoint';

// Context Management
export { ContextCompressionService } from './context/ContextCompressionService';
export type { CompressionResult } from './context/ContextCompressionService';
export { RelevanceScorer, type ScoredContext } from './context/RelevanceScorer';
export {
  ContextLayer1,
  ContextLayer2,
  ContextLayer3,
  ContextArchive,
  ContextData,
  DEFAULT_MAX_TOKENS,
  estimateTokens,
  isContextArchiveExpired,
} from './context/ContextManager';

// Messaging
export { AgentMessageRouter } from './messaging/AgentMessageRouter';
export { AgentMessageStore } from './messaging/AgentMessageStore';
export { ConversationConstraints, type ConversationPolicy, type PolicyCheckResult } from './messaging/ConversationConstraints';
export {
  AgentMessageType,
  AGENT_MESSAGE_TYPES,
  isAgentMessageType,
  AgentMessage,
  MessageReference,
  Conversation,
  SendMessageOptions,
  MessageEvent,
  MessageEventCallback,
} from './messaging/MessageTypes';

// Orchestration Sync
export { OrchestrationSync } from './OrchestrationSync';
