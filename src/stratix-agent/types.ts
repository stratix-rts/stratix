export interface AgentConfig {
  agentId: string;
  name: string;
  type: 'dev' | 'writer' | 'analyst' | 'custom';
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  endpoint?: string;
  apiKey?: string;
  temperature: number;
  maxTokens: number;
  maxShortTerm: number;
  enableLongTerm: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SoulConfig {
  identity?: string;
  personality?: string;
  goals?: string[];
  constraints?: string[];
  speakingStyle?: string;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface SkillDefinition {
  skillId: string;
  name: string;
  description: string;
  parameters: SkillParameter[];
  prompt?: string;
  executor: string;
}

export interface SkillParameter {
  name: string;
  type: string;
  required: boolean;
  default?: any;
  description?: string;
}

export interface ExecutionContext {
  agentId: string;
  sessionId?: string;
  userId?: string;
  variables?: Record<string, any>;
}

export interface SkillResult {
  success: boolean;
  skillId: string;
  result?: any;
  error?: string;
  executionTime: number;
}

export interface SkillExecutor {
  execute(
    skill: SkillDefinition,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<any>;
}

export interface SkillCall {
  skillId: string;
  params: Record<string, any>;
  reasoning?: string;
}

export interface Session {
  sessionId: string;
  agentId: string;
  title?: string;
  status: 'active' | 'closed';
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  metadata?: Record<string, any>;
  messageCount?: number;
}

export interface AgentResponse {
  sessionId: string;
  response: string;
  skillExecutions?: SkillResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'ollama' | 'deepseek' | 'qwen' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  anthropicVersion?: string;
}

export interface GenerateResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  finishReason: 'stop' | 'length' | 'error';
}

export interface TokenLimit {
  maxTokens: number;
  reservedForResponse: number;
}

export interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: 1 | 2 | 3;
  tags?: string[];
  createdAt: string;
}

export interface MemoryLayers {
  shortTerm: ChatMessage[];
  midTerm: MemoryEntry[];
  longTerm: MemoryEntry[];
}

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface HealthStatus {
  healthy: boolean;
  lastCheck: number;
  details?: Record<string, any>;
}

export interface MetricsData {
  requests: number;
  errors: number;
  latency: number;
  tokenUsage: number;
}
