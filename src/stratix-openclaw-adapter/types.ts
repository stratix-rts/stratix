import { StratixOpenClawConfig } from '@/stratix-core/stratix-protocol';

export interface OpenClawAdapterInterface {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  execute(action: OpenClawAction): Promise<OpenClawResponse>;
  getStatus(): Promise<OpenClawStatus>;
  subscribe(callback: (event: OpenClawEvent) => void): void;
  sendMessage(message: string, options?: ChatOptions): Promise<ChatResponse>;
  invokeTool<T = unknown>(
    tool: string,
    args?: Record<string, unknown>,
    options?: { sessionKey?: string; action?: string }
  ): Promise<T>;
  openaiChatCompletion(request: OpenAIChatCompletionRequest): Promise<OpenAIChatCompletionResponse>;
  streamChatCompletion(
    request: OpenAIChatCompletionRequest,
    onChunk: (chunk: string) => void,
    options?: { agentId?: string }
  ): Promise<void>;
  listSessions(): Promise<unknown[]>;
  listAgents(): Promise<unknown[]>;
  listModels(): Promise<unknown[]>;
  isConnected(): boolean;
}

export interface OpenClawAction {
  method: string;
  params: Record<string, unknown>;
}

export interface OpenClawResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface OpenClawStatus {
  connected: boolean;
  accountId: string;
  lastActive: number;
  version?: string;
  status?: string;
  error?: string;
  [key: string]: unknown;
}

export interface OpenClawEvent {
  type: string;
  data: unknown;
}

export interface OpenClawConnectionConfig extends StratixOpenClawConfig {
  timeout?: number;
  retryAttempts?: number;
}

export interface ChatOptions {
  sessionId?: string;
  stream?: boolean;
  agentId?: string;
}

export interface ChatResponse {
  messageId: string;
  content: string;
  role: 'assistant';
  sessionId?: string;
  done: boolean;
}

export interface WebSocketMessage {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface WebSocketResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface WebSocketEvent {
  type: string;
  data: unknown;
}

export interface OpenAIChatCompletionRequest {
  model?: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

export interface OpenAIChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}
