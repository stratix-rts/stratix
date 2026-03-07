import { AIServiceProvider } from './AIServiceProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { ClaudeProvider } from './ClaudeProvider';
import { OllamaProvider } from './OllamaProvider';
import { AIConfig, AIProviderConfig, AIProviderType } from '../types';
import fs from 'fs';
import path from 'path';

export class AIServiceFactory {
  private static instance: AIServiceFactory;
  private config: AIConfig;
  private providers: Map<string, AIServiceProvider> = new Map();
  
  private constructor(configPath?: string) {
    this.config = this.loadConfig(configPath);
  }
  
  static getInstance(configPath?: string): AIServiceFactory {
    if (!AIServiceFactory.instance) {
      AIServiceFactory.instance = new AIServiceFactory(configPath);
    }
    return AIServiceFactory.instance;
  }
  
  private loadConfig(configPath?: string): AIConfig {
    const defaultPath = path.join(process.cwd(), 'config', 'ai.config.json');
    const filePath = configPath || defaultPath;
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = JSON.parse(content);
      
      // Replace environment variables
      return this.resolveEnvVars(config);
    } catch (error) {
      console.warn(`Failed to load AI config from ${filePath}, using defaults`);
      return this.getDefaultConfig();
    }
  }
  
  private resolveEnvVars(config: any): any {
    const resolved = JSON.parse(JSON.stringify(config));
    
    if (resolved.providers) {
      for (const provider of Object.values(resolved.providers) as any[]) {
        if (provider.apiKey && typeof provider.apiKey === 'string') {
          provider.apiKey = this.resolveEnvVar(provider.apiKey);
        }
        if (provider.baseUrl && typeof provider.baseUrl === 'string') {
          provider.baseUrl = this.resolveEnvVar(provider.baseUrl);
        }
      }
    }
    
    return resolved;
  }
  
  private resolveEnvVar(value: string): string {
    const envVarMatch = value.match(/\$\{([^}]+)\}/);
    if (envVarMatch) {
      const envVar = envVarMatch[1];
      const [name, defaultValue] = envVar.split(':');
      return process.env[name] || defaultValue || '';
    }
    return value;
  }
  
  private getDefaultConfig(): AIConfig {
    return {
      defaultProvider: 'openai',
      providers: {
        openai: {
          apiKey: process.env.OPENAI_API_KEY || '',
          model: 'gpt-4',
          temperature: 0.7,
          maxTokens: 4000,
        },
      },
      retryAttempts: 3,
      timeout: 60000,
      streaming: true,
    };
  }
  
  createProvider(type?: AIProviderType): AIServiceProvider {
    const providerType = type || this.config.defaultProvider;
    
    if (this.providers.has(providerType)) {
      return this.providers.get(providerType)!;
    }
    
    const providerConfig = this.config.providers[providerType];
    if (!providerConfig) {
      throw new Error(`Provider ${providerType} not configured`);
    }
    
    let provider: AIServiceProvider;
    
    switch (providerType) {
      case 'openai':
        provider = new OpenAIProvider(providerConfig);
        break;
      case 'claude':
        provider = new ClaudeProvider(providerConfig);
        break;
      case 'ollama':
        provider = new OllamaProvider(providerConfig);
        break;
      default:
        throw new Error(`Unknown provider type: ${providerType}`);
    }
    
    this.providers.set(providerType, provider);
    return provider;
  }
  
  getDefaultProvider(): AIServiceProvider {
    return this.createProvider();
  }
  
  getConfig(): AIConfig {
    return { ...this.config };
  }
  
  async checkProvidersHealth(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    
    for (const [type] of Object.entries(this.config.providers)) {
      try {
        const provider = this.createProvider(type as AIProviderType);
        results[type] = await provider.healthCheck();
      } catch {
        results[type] = false;
      }
    }
    
    return results;
  }
}
