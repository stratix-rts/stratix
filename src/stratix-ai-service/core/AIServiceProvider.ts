import { AIMessage, AIResponse, AIStreamCallback, AIProviderConfig } from '../types';

export interface AIServiceProvider {
  readonly name: string;
  
  chat(messages: AIMessage[]): Promise<AIResponse>;
  
  chatStream(messages: AIMessage[], callback: AIStreamCallback): Promise<void>;
  
  complete(prompt: string): Promise<AIResponse>;
  
  healthCheck(): Promise<boolean>;
}

export abstract class BaseAIProvider implements AIServiceProvider {
  abstract readonly name: string;
  protected config: AIProviderConfig;
  
  constructor(config: AIProviderConfig) {
    this.config = config;
  }
  
  abstract chat(messages: AIMessage[]): Promise<AIResponse>;
  abstract chatStream(messages: AIMessage[], callback: AIStreamCallback): Promise<void>;
  abstract complete(prompt: string): Promise<AIResponse>;
  abstract healthCheck(): Promise<boolean>;
  
  protected handleError(error: any, operation: string): never {
    const message = error?.message || 'Unknown error';
    throw new Error(`[${this.name}] ${operation} failed: ${message}`);
  }
}
