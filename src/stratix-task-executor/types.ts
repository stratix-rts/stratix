export enum TaskStatus {
  PENDING = 'pending',
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PAUSED = 'paused'
}

export enum ProjectStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

export interface TaskExecution {
  readonly taskId: string;
  readonly projectId: string;
  status: TaskStatus;
  progress: number;
  startTime?: Date;
  endTime?: Date;
  error?: string;
  resultPath?: string;
}

export interface ProjectExecution {
  readonly projectId: string;
  status: ProjectStatus;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  currentTaskId?: string;
  startTime?: Date;
  endTime?: Date;
}

export interface TaskResult {
  readonly taskId: string;
  success: boolean;
  outputPath?: string;
  files?: string[];
  summary?: string;
  error?: string;
}

export interface ProgressFile {
  readonly taskId: string;
  progress: number;
  status: TaskStatus;
  message?: string;
  readonly timestamp: string;
}

export const PROGRESS_FILE_NAME = '.stratix-progress.json';
export const RESULT_FILE_NAME = '.stratix-result.json';
