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
  // Zone context (OKR data from zone_contexts table)
  zoneContext?: {
    title: string;
    prompt: string;
    members: string[];
  };
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

// ============================================
// 项目Channel消息系统类型定义
// 基于OpenClaw消息结构扩展
// ============================================

// 消息角色 - 兼容OpenClaw
export type MessageRole = 'user' | 'assistant' | 'tool' | 'system' | 'other';

// 发送者信息
export interface MessageSender {
  id: string;
  type: 'agent' | 'user';
  name: string;
  avatar?: string;
  role?: string;
}

// 消息类型
export type ProjectMessageType = 'chat' | 'task_assign' | 'task_update' | 'system';

// 项目Channel消息
export interface ProjectChannelMessage {
  id: string;
  projectId: string;
  channelId: string;
  role: MessageRole;
  content: string;
  timestamp: number;
  sender: MessageSender;
  mentions: string[];
  rawContent?: string;
  messageType: ProjectMessageType;
  taskId?: string;
  sessionKey?: string;
  runId?: string;
  metadata: {
    source: 'openclaw' | 'local' | 'user';
    createdAt: string;
  };
}

// Channel类型
export type ProjectChannelType = 'general' | 'tasks' | 'agent_dm';

// Channel配置
export interface ProjectChannel {
  id: string;
  projectId: string;
  name: string;
  type: ProjectChannelType;
  description?: string;
  subscriberIds: string[];
  isPrivate: boolean;
  createdAt: number;
  updatedAt: number;
}

// Agent工牌
export interface AgentBadge {
  agentId: string;
  name: string;
  avatar?: string;
  role: string;
  status: 'online' | 'offline' | 'busy';
  roleDefinition?: {
    personality?: string;
    responsibilities?: string[];
    communicationStyle?: string;
  };
}

// ============================================
// Zone 类型定义
// ============================================

export type FileType = 'md' | 'txt' | 'ts' | 'js' | 'fig' | 'image' | 'link' | 'folder' | 'other';

// ============================================
// File Version History Types
// ============================================

export interface FileVersion {
  id: string;          // 版本 ID
  content: string;     // 版本内容
  createdAt: number;   // 创建时间
  description?: string; // 版本描述
}

export interface FileMetadata {
  versions?: FileVersion[];      // 版本列表
  currentVersionId?: string;     // 当前版本 ID
  size?: number;
  mimeType?: string;
  [key: string]: any;
}

// ============================================
// Zone Types
// ============================================

export interface ZoneFile {
  id: string;
  zoneId: string;
  name: string;
  sourceType: 'local' | 'url';
  source: string;
  content?: string;
  fileType?: FileType;
  lastFetched?: number;
  metadata?: FileMetadata;
  createdAt: number;
  updatedAt: number;
}

export interface Zone {
  id: string;
  projectId: string;
  title: string;
  prompt: string;
  files: ZoneFile[];
  members: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ZoneCreateRequest {
  title: string;
  prompt?: string;
}

export interface ZoneUpdateRequest {
  title?: string;
  prompt?: string;
}

export interface ZoneFileAddRequest {
  name: string;
  sourceType: 'local' | 'url';
  source: string;
}

export interface ZoneFolderScanRequest {
  folderPath: string;
  recursive?: boolean;
  extensions?: string[];
}

// Zone Task
export type ZoneTaskStatus = 'pending' | 'in_progress' | 'done';

export interface ZoneTask {
  id: string;
  zoneId: string;
  title: string;
  status: ZoneTaskStatus;
  assignee: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface ZoneTaskCreateRequest {
  title: string;
}

export interface ZoneTaskUpdateRequest {
  title?: string;
  status?: ZoneTaskStatus;
  assignee?: string | null;
}

export interface ZoneTaskClaimRequest {
  agentId: string;
}

// Zone Message
export type SenderType = 'user' | 'agent';

export interface ZoneMessage {
  id: string;
  zoneId: string;
  senderId: string;
  senderType: SenderType;
  content: string;
  createdAt: number;
}

export interface ZoneMessageCreateRequest {
  senderId: string;
  senderType: SenderType;
  content: string;
}

// Zone Template
export interface ZoneTemplate {
  id: string;
  name: string;
  description?: string;
  title: string;
  prompt: string;
  fileTemplates: Array<{
    name: string;
    sourceType: 'local' | 'url';
    source: string;
  }>;
  tags: string[];
  createdAt: number;
}

export interface ZoneExportData {
  version: string;
  exportedAt: number;
  zone: {
    title: string;
    prompt: string;
    files: Array<{
      name: string;
      sourceType: 'local' | 'url';
      source: string;
    }>;
    tasks: Array<{
      title: string;
    }>;
  };
}
