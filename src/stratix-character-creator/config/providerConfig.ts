import type { LLMProvider } from '@/stratix-core/stratix-protocol';

export interface ProviderConfig {
  name: string;
  icon: string;
  requiresApiKey: boolean;
  defaultEndpoint: string;
  models: string[];
  envKey: string | null;
}

export const PROVIDER_CONFIGS: Record<LLMProvider, ProviderConfig> = {
  openai: {
    name: 'OpenAI',
    icon: '🤖',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.openai.com/v1',
    models: ['gpt-4', 'gpt-4-turbo', 'gpt-4o', 'gpt-3.5-turbo'],
    envKey: 'OPENAI_API_KEY',
  },
  anthropic: {
    name: 'Anthropic',
    icon: '🧠',
    requiresApiKey: true,
    defaultEndpoint: 'https://api.anthropic.com',
    models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 'claude-3-5-sonnet'],
    envKey: 'ANTHROPIC_API_KEY',
  },
  ollama: {
    name: 'Ollama',
    icon: '🐑',
    requiresApiKey: false,
    defaultEndpoint: 'http://localhost:11434',
    models: ['llama3', 'llama3:70b', 'mistral', 'codellama', 'deepseek-coder'],
    envKey: null,
  },
  custom: {
    name: 'Custom',
    icon: '⚙️',
    requiresApiKey: false,
    defaultEndpoint: '',
    models: [],
    envKey: null,
  },
};

export const PROVIDER_LIST: LLMProvider[] = ['openai', 'anthropic', 'ollama', 'custom'];
