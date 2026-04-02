/**
 * Agent Router Types
 * Defines the core types for the agent task dispatch and execution system.
 */

export type TaskStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export type IsolationStrategy = "none" | "worktree" | "remote";

export type TaskType = "teammate" | "subagent";

export interface AgentTask {
  taskId: string;
  type: TaskType;
  agentId?: string;
  isolation: IsolationStrategy;
  runInBackground?: boolean;
  prompt: string;
  tools?: string[];
  workingDirectory?: string;
}

export interface TaskHandle {
  taskId: string;
  status: TaskStatus;
  abort(): Promise<void>;
  result?: unknown;
  startedAt: Date;
  completedAt?: Date;
}

export interface AgentCapability {
  id: string;
  name: string;
  description: string;
  tools: string[];
  maxConcurrency?: number;
}
