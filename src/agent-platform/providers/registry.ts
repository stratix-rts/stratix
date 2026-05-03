import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

import {
  OpenAIAdapter,
  AnthropicAdapter,
  GoogleAdapter,
  DeepSeekAdapter,
  QwenAdapter,
  MoonshotAdapter,
  StepFunAdapter,
  OllamaAdapter,
} from './adapters';
import { LLMAdapter } from './adapters/base';
import type { ProviderConfig, CreateProviderOptions, ProviderInstance } from './types';

class ProviderRegistry {
  private adapters: Map<string, LLMAdapter> = new Map();
  private instances: Map<string, ProviderInstance> = new Map();
  private readonly MAX_INSTANCES = 20;

  constructor() {
    this.register('openai', new OpenAIAdapter());
    this.register('anthropic', new AnthropicAdapter());
    this.register('google', new GoogleAdapter());
    this.register('deepseek', new DeepSeekAdapter());
    this.register('qwen', new QwenAdapter());
    this.register('moonshot', new MoonshotAdapter());
    this.register('stepfun', new StepFunAdapter());
    this.register('ollama', new OllamaAdapter());
  }

  private getCacheKey(options: CreateProviderOptions): string {
    return `${options.providerId}:${options.model}:${options.apiKey ?? ''}:${options.temperature ?? ''}:${options.maxTokens ?? ''}`;
  }

  private evictOldestIfNeeded(): void {
    if (this.instances.size < this.MAX_INSTANCES) return;
    // Simple FIFO eviction: delete the first inserted entry
    const firstKey = this.instances.keys().next().value;
    if (firstKey) {
      this.instances.delete(firstKey);
    }
  }

  register(providerId: string, adapter: LLMAdapter): void {
    this.adapters.set(providerId, adapter);
  }

  getAdapter(providerId: string): LLMAdapter | undefined {
    return this.adapters.get(providerId);
  }

  getConfig(providerId: string): ProviderConfig | undefined {
    const adapter = this.adapters.get(providerId);
    return adapter?.getConfig();
  }

  getAllConfigs(): ProviderConfig[] {
    return Array.from(this.adapters.values()).map((adapter) => adapter.getConfig());
  }

  getModels(providerId: string): string[] {
    const adapter = this.adapters.get(providerId);
    return adapter?.getModels() ?? [];
  }

  createModel(options: CreateProviderOptions): BaseChatModel {
    const cacheKey = this.getCacheKey(options);
    const cached = this.instances.get(cacheKey);
    if (cached) {
      return cached.llm;
    }

    const adapter = this.adapters.get(options.providerId);
    if (!adapter) {
      throw new Error(`Unknown provider: ${options.providerId}`);
    }

    const validation = adapter.validateOptions(options);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    return adapter.createModel(options);
  }

  async createAndStore(
    instanceId: string,
    options: CreateProviderOptions
  ): Promise<ProviderInstance> {
    const config = this.getConfig(options.providerId);
    if (!config) {
      throw new Error(`Unknown provider: ${options.providerId}`);
    }

    const cacheKey = this.getCacheKey(options);
    const cached = this.instances.get(cacheKey);
    if (cached) {
      return cached;
    }

    this.evictOldestIfNeeded();

    const llm = this.createModel(options);
    const instance: ProviderInstance = { config, llm, cacheKey };

    this.instances.set(instanceId, instance);
    this.instances.set(cacheKey, instance);
    return instance;
  }

  getInstance(instanceId: string): ProviderInstance | undefined {
    return this.instances.get(instanceId);
  }

  removeInstance(instanceId: string): boolean {
    const instance = this.instances.get(instanceId);
    if (instance?.cacheKey && instance.cacheKey !== instanceId) {
      this.instances.delete(instance.cacheKey);
    }
    return this.instances.delete(instanceId);
  }

  async testConnection(options: CreateProviderOptions): Promise<{ success: boolean; latency?: number; error?: string }> {
    try {
      const cacheKey = this.getCacheKey(options);
      let llm = this.instances.get(cacheKey)?.llm;

      if (!llm) {
        this.evictOldestIfNeeded();
        llm = this.createModel(options);
        const config = this.getConfig(options.providerId)!;
        this.instances.set(cacheKey, { config, llm, cacheKey });
      }

      const start = Date.now();
      await llm.invoke([{ role: 'user', content: 'Hello' }]);
      const latency = Date.now() - start;
      return { success: true, latency };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }
}

export const providerRegistry = new ProviderRegistry();
export { ProviderRegistry };
