export type ProjectStatus = 'pending' | 'active' | 'paused' | 'completed' | 'failed';

export type TaskType = 'writing' | 'coding' | 'drawing' | 'video' | 'research';

export type AgentMode = 'openclaw' | 'llm';

export type PlanningRule = 'sequential' | 'by_type' | 'by_priority';

export type ExecutionPermission = 'auto' | 'confirm' | 'mark_only';

export type ProgressRule = 'average' | 'all_complete';

export interface GitConfig {
  enabled: boolean;
  remoteUrl?: string;
  branch?: string;
  commitMessage?: string;
  credentials?: GitCredentials;
}

export interface GitCredentials {
  username?: string;
  token?: string;
}

export interface ProjectRequirement {
  type: 'text' | 'markdown';
  content: string;
  filePath?: string;
}

export interface ProjectConfig {
  name: string;
  description?: string;
  priority: number;
  localFolderPath: string;
  gitConfig?: GitConfig;
  agentMode: AgentMode;
  planningRule: PlanningRule;
  executionPermission: ExecutionPermission;
  requirement: ProjectRequirement;
  progressRule: ProgressRule;
}

export interface ProjectZoneConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: number;
  opacity?: number;
  visible?: boolean;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  priority: number;
  status: ProjectStatus;
  config: ProjectConfig;
  path: string;
  presentAgentIds: string[];
  zoneConfig: ProjectZoneConfig;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export type TaskStatus = 'pending' | 'configured' | 'waiting' | 'running' | 'completed' | 'paused' | 'failed';

export type OperationScope = 'local' | 'remote';

export type TypeSpecificConfig =
  | WritingTaskConfig
  | CodingTaskConfig
  | DrawingTaskConfig
  | VideoTaskConfig
  | ResearchTaskConfig;

export interface WritingTaskConfig {
  type: 'writing';
  materials?: string[];
  format?: 'markdown' | 'html' | 'plain';
}

export interface CodingTaskConfig {
  type: 'coding';
  language?: string;
  framework?: string;
  permissions?: {
    canExecute?: boolean;
    canTest?: boolean;
  };
}

export interface DrawingTaskConfig {
  type: 'drawing';
  dimensions?: {
    width: number;
    height: number;
  };
  format?: 'png' | 'jpg' | 'svg';
  layers?: LayerConfig[];
}

export interface LayerConfig {
  name: string;
  description?: string;
}

export interface VideoTaskConfig {
  type: 'video';
  duration?: number;
  resolution?: string;
  format?: 'mp4' | 'mov' | 'avi';
  materials?: string[];
}

export interface ResearchTaskConfig {
  type: 'research';
  sources?: string[];
  outputFormat?: 'summary' | 'report' | 'analysis';
  maxLength?: number;
}

export interface TaskConfig {
  requirementText: string;
  requirementFilePath?: string;
  executionPermission: ExecutionPermission;
  agentMode?: AgentMode;
  operationScope: OperationScope;
  customDeliveryPath?: string;
  gitConfig?: Partial<GitConfig>;
  typeSpecificConfig?: TypeSpecificConfig;
}

export interface TaskZoneConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  color?: number;
  opacity?: number;
  visible?: boolean;
}

export interface TaskLog {
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: any;
}

export interface TaskResult {
  status: 'success' | 'failed';
  outputFiles: string[];
  outputData?: any;
  error?: string;
  logs: TaskLog[];
  completedAt: Date;
  duration: number;
}

export interface Task {
  id: string;
  projectId: string;
  name: string;
  type: TaskType;
  description?: string;
  priority: number;
  status: TaskStatus;
  config: TaskConfig;
  dependencies: string[];
  progress: number;
  result?: TaskResult;
  zoneConfig: TaskZoneConfig;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface SuggestedTask {
  name: string;
  type: TaskType;
  description: string;
  priority: number;
  dependencies: string[];
  estimatedDuration?: number;
}

export interface ParsedRequirement {
  projectId: string;
  projectType: TaskType;
  objectives: string[];
  scope: string[];
  deliverables: string[];
  constraints: string[];
  suggestedTasks: SuggestedTask[];
}

export type AIProvider = 'openai' | 'claude' | 'ollama' | 'custom';

export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}
