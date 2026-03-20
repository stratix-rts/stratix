import { ChatOpenAI } from '@langchain/openai';
import { LLMAdapter } from './base';
import type { CreateProviderOptions, ProviderConfig } from '../types';

const QWEN_CONFIG: ProviderConfig = {
  id: 'qwen',
  name: 'Qwen (阿里)',
  icon: '🐱',
  requiresApiKey: true,
  defaultEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen-long', 'qwen-coder-turbo'],
  langchainClass: 'ChatOpenAI',
  langchainModule: '@langchain/openai',
  envKey: 'DASHSCOPE_API_KEY',
};

export class QwenAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOpenAI {
    return new ChatOpenAI({
      modelName: options.model,
      openAIApiKey: options.apiKey,
      configuration: {
        baseURL: options.endpoint || QWEN_CONFIG.defaultEndpoint,
      },
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return QWEN_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return QWEN_CONFIG;
  }
}
