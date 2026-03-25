import type { StratixCommandData, StratixAgentConfig, StratixSkillConfig, StratixDirectConfig } from '../stratix-protocol';
import type { AgentExecutor, ExecutorResult, ExecutorOptions } from './AgentExecutor';
import { PROVIDER_CONFIGS } from '../config/provider-config';
import { LLM_DEFAULTS } from '@/stratix-core/config/defaults';
import { buildChatCompletionsURL } from '../utils/OpenAIEndpointBuilder';

export class StratixAgentExecutor implements AgentExecutor {
  async execute(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig,
    options?: ExecutorOptions
  ): Promise<ExecutorResult> {
    if (!agentConfig.stratixConfig) {
      return {
        success: false,
        error: 'Stratix config not found for agent',
      };
    }

    try {
      const skill = this.findSkill(agentConfig, command.skillId);
      const userMessage = this.buildUserMessage(skill, command.params);

      const config = agentConfig.stratixConfig;
      const response = await this.callLLM(config, userMessage, agentConfig.soul, options?.history);

      return {
        success: true,
        data: response,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  validate(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!agentConfig.stratixConfig) {
      errors.push('Stratix config not found for agent');
      return { valid: false, errors };
    }

    if (!agentConfig.stratixConfig.provider) {
      errors.push('Provider is required');
    }

    if (!agentConfig.stratixConfig.model) {
      errors.push('Model is required');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async testConnection(agentConfig: StratixAgentConfig): Promise<{ success: boolean; message: string }> {
    if (!agentConfig.stratixConfig) {
      return { success: false, message: 'Stratix config not found' };
    }

    try {
      const config = agentConfig.stratixConfig;
      const testMessage = 'Hello';
      
      const timeoutMs = LLM_DEFAULTS.TIMEOUT_MS;
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout (10s)')), timeoutMs)
      );
      
      const connectionPromise = this.callLLM(config, testMessage, {
        identity: 'You are a test assistant.',
        goals: ['Respond to test queries'],
        personality: 'Helpful'
      }, undefined);
      
      await Promise.race([connectionPromise, timeoutPromise]);
      
      return { success: true, message: 'Connection successful' };
    } catch (error) {
      return { 
        success: false, 
        message: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  private findSkill(
    agentConfig: StratixAgentConfig,
    skillId: string
  ): StratixSkillConfig | null {
    return agentConfig.skills?.find(s => s.skillId === skillId) || null;
  }

  private buildMessagesWithHistory(
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    currentMessage: string,
    systemPrompt?: string
  ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
    const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    // Add history messages
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }

    // Add current message
    messages.push({ role: 'user', content: currentMessage });

    return messages;
  }

  private buildUserMessage(skill: StratixSkillConfig | null, params: Record<string, any>): string {
    if (!skill) {
      return Object.keys(params).length > 0 
        ? JSON.stringify(params) 
        : 'Hello';
    }

    if (skill.prompt) {
      let message = skill.prompt;
      Object.entries(params).forEach(([key, value]) => {
        message = message.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
      });
      return message;
    }

    const parts = [`Execute skill: ${skill.name}`];
    
    if (skill.description) {
      parts.push(`Description: ${skill.description}`);
    }

    if (Object.keys(params).length > 0) {
      parts.push('Parameters:');
      Object.entries(params).forEach(([key, value]) => {
        parts.push(`  - ${key}: ${JSON.stringify(value)}`);
      });
    }

    return parts.join('\n');
  }

  private async callLLM(
    config: StratixDirectConfig,
    userMessage: string,
    soul?: { identity: string; goals: string[]; personality: string },
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const { provider, model, apiKey, endpoint, temperature, maxTokens } = config;

    const providerConfig = PROVIDER_CONFIGS[provider];
    if (!providerConfig) {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    // Custom provider requires endpoint
    if (provider === 'custom' && !endpoint) {
      throw new Error('Custom provider requires an endpoint URL');
    }

    // Build chat completions URL using OpenAI-compatible endpoint builder
    // This handles auto-append of /chat/completions and /v1 prefix for all providers
    const baseUrl = endpoint || providerConfig.defaultEndpoint;
    const url = buildChatCompletionsURL(baseUrl);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    // Set auth header based on provider config
    if (providerConfig.authHeader === 'Authorization' && apiKey) {
      const scheme = providerConfig.authScheme || 'Bearer';
      headers['Authorization'] = `${scheme} ${apiKey}`;
    } else if (providerConfig.authHeader === 'x-api-key' && apiKey) {
      headers['x-api-key'] = apiKey;
    }

    // Add extra headers (e.g., anthropic-version)
    if (providerConfig.extraHeaders) {
      Object.assign(headers, providerConfig.extraHeaders);
    }

    // Build messages with or without history
    const messages = history && history.length > 0
      ? this.buildMessagesWithHistory(history, userMessage, soul?.identity)
      : [
          ...(soul?.identity ? [{ role: 'system', content: soul.identity }] : []),
          { role: 'user', content: userMessage }
        ];

    const body: Record<string, any> = {
      model,
      messages,
      temperature: temperature || LLM_DEFAULTS.TEMPERATURE
    };

    // Add max_tokens for non-ollama providers
    if (provider !== 'ollama') {
      body.max_tokens = maxTokens || LLM_DEFAULTS.MAX_TOKENS;
    } else {
      body.stream = false;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    return this.extractResponse(data, providerConfig.responsePath);
  }

  private extractResponse(data: any, path: string): string {
    const parts = path.split('.');
    let result = data;
    for (const part of parts) {
      if (result == null) return '';
      // Support array index notation like 'choices.0.message.content'
      const match = part.match(/^(\w+)\[(\d+)\]$/);
      if (match) {
        result = result[match[1]]?.[parseInt(match[2])];
      } else {
        result = result[part];
      }
    }
    return result || '';
  }
}

export default StratixAgentExecutor;
