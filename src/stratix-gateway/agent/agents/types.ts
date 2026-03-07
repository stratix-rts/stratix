export type AgentStatus = 'idle' | 'working' | 'paused' | 'stopping' | 'error';

export interface AgentState {
  agentId: string;
  name: string;
  projectId: string;
  status: AgentStatus;
  currentTaskId?: string;
  startedAt?: Date;
  error?: string;
}

export interface AgentInterface {
  getState(): AgentState;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}