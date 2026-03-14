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

export interface ProjectChannelMessage {
  id: string;
  projectId: string;
  channelId: string;
  content: string;
  timestamp: number;
  sender: {
    id: string;
    type: 'agent' | 'user';
    name: string;
    role?: string;
  };
  mentions?: string[];
}

export interface AgentInterface {
  getState(): AgentState;
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  /**
   * 处理 channel 消息（当 agent 被@提及时调用）
   * @param message 消息内容
   */
  handleMessage?(message: ProjectChannelMessage): Promise<void>;
}