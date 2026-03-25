export interface ZoneState {
  zoneId: string;
  name: string;
  type: 'task' | 'project' | 'general';
  projectId?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  status: 'idle' | 'active' | 'busy' | 'completed' | 'error';
  config: ZoneConfig;
  enteredAgents: string[];
  taskPool: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ZoneConfig {
  allowAgentDM: boolean;
  allowBroadcast: boolean;
  contextSharingPolicy: 'isolated' | 'shared';
  maxAgents?: number;
}

export interface ZoneEvent {
  type: 'enter' | 'exit' | 'status_change' | 'task_added' | 'task_removed';
  zoneId: string;
  agentId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export const DEFAULT_ZONE_CONFIG: ZoneConfig = {
  allowAgentDM: true,
  allowBroadcast: true,
  contextSharingPolicy: 'isolated',
};
