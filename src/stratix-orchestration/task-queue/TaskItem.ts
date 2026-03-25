export interface TaskItem {
  taskId: string;
  zoneId: string;
  projectId: string;
  name: string;
  description?: string;
  type: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
  priority: number; // 1-10, higher = more urgent
  status: 'pending' | 'assigned' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  assignedAgentId?: string;
  dependencies: string[];
  context: TaskContext;
  result?: TaskResult;
  error?: string;
  createdAt: number;
  assignedAt?: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskContext {
  description: string;
  files?: string[];
  outputPath?: string;
  parameters?: Record<string, unknown>;
}

export interface TaskResult {
  output?: string;
  files?: string[];
  summary?: string;
  metrics?: Record<string, number>;
}

export interface TaskEvent {
  type: 'created' | 'assigned' | 'started' | 'completed' | 'failed' | 'cancelled' | 'requeued';
  taskId: string;
  agentId?: string;
  timestamp: number;
  data?: Record<string, unknown>;
}

export type TaskEventCallback = (event: TaskEvent) => void;
