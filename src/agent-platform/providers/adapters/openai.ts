import { ChatOpenAI } from '@langchain/openai';
import { LLMAdapter } from './base';
import type { CreateProviderOptions, ProviderConfig } from '../types';

const OPENAI_CONFIG: ProviderConfig = {
  id: 'openai',
  name: 'OpenAI',
  icon: '🤖',
  requiresApiKey: true,
  defaultEndpoint: 'https://api.openai.com/v1',
  models: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'gpt-4',
    'gpt-3.5-turbo',
    'o1-preview',
    'o1-mini',
  ],
  langchainClass: 'ChatOpenAI',
  langchainModule: '@langchain/openai',
  envKey: 'OPENAI_API_KEY',
};

export class OpenAIAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOpenAI {
    return new ChatOpenAI({
      modelName: options.model,
      openAIApiKey: options.apiKey,
      configuration: options.endpoint
        ? { baseURL: options.endpoint }
        : undefined,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return OPENAI_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return OPENAI_CONFIG;
  }
}
