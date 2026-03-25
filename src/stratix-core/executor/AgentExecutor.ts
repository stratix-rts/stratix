import type { StratixCommandData, StratixAgentConfig } from '../stratix-protocol';

export interface ExecutorResult {
  success: boolean;
  data?: any;
  error?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface ExecutorOptions {
  stream?: boolean;
  onChunk?: (chunk: string) => void;
  timeout?: number;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface AgentExecutor {
  execute(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig,
    options?: ExecutorOptions
  ): Promise<ExecutorResult>;
  
  validate(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): { valid: boolean; errors: string[] };
  
  testConnection(agentConfig: StratixAgentConfig): Promise<{ success: boolean; message: string }>;
}
