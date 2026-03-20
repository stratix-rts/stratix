import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { LLMAdapter } from './base';
import type { CreateProviderOptions, ProviderConfig } from '../types';

const GOOGLE_CONFIG: ProviderConfig = {
  id: 'google',
  name: 'Google',
  icon: '🔍',
  requiresApiKey: true,
  defaultEndpoint: 'https://generativelanguage.googleapis.com',
  models: [
    'gemini-2.0-flash-exp',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-flash-8b',
    'gemini-pro',
  ],
  langchainClass: 'ChatGoogleGenerativeAI',
  langchainModule: '@langchain/google-genai',
  envKey: 'GOOGLE_API_KEY',
};

export class GoogleAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatGoogleGenerativeAI {
    return new ChatGoogleGenerativeAI({
      model: options.model,
      apiKey: options.apiKey,
      temperature: options.temperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? 4096,
    });
  }

  getModels(): string[] {
    return GOOGLE_CONFIG.models;
  }

  getConfig(): ProviderConfig {
    return GOOGLE_CONFIG;
  }
}
