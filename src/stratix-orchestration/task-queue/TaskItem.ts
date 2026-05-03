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

export const TASK_STATUSES: TaskItem['status'][] = ['pending', 'assigned', 'in_progress', 'completed', 'failed', 'cancelled'];
export const TASK_TYPES: TaskItem['type'][] = ['coding', 'writing', 'analysis', 'research', 'general'];

/**
 * Check if a task status is terminal (completed, failed, or cancelled)
 */
export function isTerminalStatus(status: TaskItem['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Check if a task can be transitioned from one status to another
 */
export function isValidStatusTransition(from: TaskItem['status'], to: TaskItem['status']): boolean {
  if (isTerminalStatus(from)) return false;
  const validTransitions: Record<TaskItem['status'], TaskItem['status'][]> = {
    pending: ['assigned', 'cancelled'],
    assigned: ['in_progress', 'pending', 'cancelled'],
    in_progress: ['completed', 'failed', 'pending'],
    completed: [],
    failed: ['pending'],
    cancelled: ['pending'],
  };
  return validTransitions[from]?.includes(to) ?? false;
}
