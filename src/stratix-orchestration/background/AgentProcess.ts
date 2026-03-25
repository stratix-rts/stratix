export interface AgentProcess {
  agentId: string;
  zoneId?: string;
  status: 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';
  currentTaskId?: string;
  startedAt: number;
  lastHeartbeatAt: number;
  error?: string;
}

export interface AgentCheckpointData {
  agentId: string;
  currentTaskId?: string;
  context: {
    recentMessages: Array<{ role: string; content: string; timestamp: number }>;
    memoryLayers: {
      shortTerm: number;
      midTerm: number;
      longTerm: number;
    };
    activeFiles?: string[];
  };
  zoneId?: string;
  checkpointAt: number;
}

export interface BackgroundAgentConfig {
  agentId: string;
  zoneId?: string;
  autoRestart?: boolean;
  maxRestarts?: number;
  heartbeatInterval?: number;
}
