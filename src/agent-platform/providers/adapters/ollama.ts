import { ChatOllama } from '@langchain/ollama';
import { LLMAdapter } from './base';
import type { CreateProviderOptions, ProviderConfig } from '../types';

const OLLAMA_CONFIG: ProviderConfig = {
  id: 'ollama',
  name: 'Ollama (本地)',
  icon: '🐑',
  requiresApiKey: false,
  defaultEndpoint: 'http://localhost:11434',
  models: [
    'llama3.3',
    'llama3.1',
    'llama3',
    'llama2',
    'mistral',
    'codellama',
    'phi4',
    'qwen2.5',
    'deepseek-r1',
    'phi3',
    'gemma2',
  ],
  langchainClass: 'ChatOllama',
  langchainModule: '@langchain/community/chat_models/ollama',
  envKey: null,
};

export class OllamaAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOllama {
    return new ChatOllama({
      model: options.model,
      baseUrl: options.endpoint || OLLAMA_CONFIG.defaultEndpoint,
      temperature: options.temperature ?? 0.7,
      numPredict: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return OLLAMA_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return OLLAMA_CONFIG;
  }
}
