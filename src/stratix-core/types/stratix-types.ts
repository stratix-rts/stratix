export type {
  AgentConfigStatus,
  AgentConnectionStatus,
  AgentActivityStatus,
  AgentStatusInfo
} from '../stratix-protocol';

export type AgentStatus = 'online' | 'offline' | 'busy' | 'error';
export type CommandStatus = 'pending' | 'running' | 'success' | 'failed';
export type AgentType = 'writer' | 'dev' | 'analyst' | string;
export type SkillParameterType = 'string' | 'number' | 'boolean' | 'object';
