// AI 服务相关类型定义

export enum TaskType {
  REQUIREMENT = 'requirement',
  DESIGN = 'design',
  DEVELOPMENT = 'development',
  TEST = 'test',
  DEPLOY = 'deploy',
  WRITING = 'writing',
  RESEARCH = 'research',
  CUSTOM = 'custom'
}

export interface TaskTypeConfig {
  id: string;
  name: string;
  color: string;
  icon: string;
  description: string;
}

export type SplitStrategy = 'sequential' | 'by_type' | 'by_priority';

export interface ParsedTask {
  id: string;
  name: string;
  type: TaskType;
  description: string;
  estimatedTime?: number;
  dependencies: string[];
  priority: number;
}

export interface ParsedRequirement {
  summary: string;
  tasks: ParsedTask[];
  metadata?: {
    originalRequirement: string;
    parseTime: Date;
    model: string;
    provider: string;
  };
}

export interface AIProviderConfig {
  apiKey?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
}

export interface AIConfig {
  defaultProvider: string;
  providers: Record<string, AIProviderConfig>;
  retryAttempts: number;
  timeout: number;
  streaming: boolean;
}

export interface SplitConfig {
  strategy: SplitStrategy;
  maxTasks?: number;
  minTaskDuration?: number;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIStreamCallback {
  onToken: (token: string) => void;
  onComplete: (result: any) => void;
  onError: (error: Error) => void;
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  provider: string;
}

export type AIProviderType = 'openai' | 'claude' | 'ollama';
