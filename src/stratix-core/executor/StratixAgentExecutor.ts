import type { StratixCommandData, StratixAgentConfig, StratixSkillConfig, StratixDirectConfig } from '../stratix-protocol';
import type { AgentExecutor, ExecutorResult, ExecutorOptions } from './AgentExecutor';

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
      const response = await this.callLLM(config, userMessage, agentConfig.soul);

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
      
      const timeoutMs = 10000;
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout (10s)')), timeoutMs)
      );
      
      const connectionPromise = this.callLLM(config, testMessage, { 
        identity: 'You are a test assistant.', 
        goals: ['Respond to test queries'], 
        personality: 'Helpful' 
      });
      
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
    soul?: { identity: string; goals: string[]; personality: string }
  ): Promise<string> {
    const { provider, model, apiKey, endpoint, temperature, maxTokens } = config;

    let url = '';
    let headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    let body: any = {};

    if (provider === 'openai') {
      url = endpoint || 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model,
        messages: [
          ...(soul?.identity ? [{ role: 'system', content: soul.identity }] : []),
          { role: 'user', content: userMessage }
        ],
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096
      };
    } else if (provider === 'anthropic') {
      url = endpoint || 'https://api.anthropic.com/v1/messages';
      headers['x-api-key'] = apiKey || '';
      headers['anthropic-version'] = '2023-06-01';
      body = {
        model,
        messages: [{ role: 'user', content: userMessage }],
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096
      };
    } else if (provider === 'ollama') {
      url = (endpoint || 'http://localhost:11434') + '/api/chat';
      body = {
        model,
        messages: [
          ...(soul?.identity ? [{ role: 'system', content: soul.identity }] : []),
          { role: 'user', content: userMessage }
        ],
        temperature: temperature || 0.7,
        stream: false
      };
    } else if (provider === 'deepseek') {
      url = endpoint || 'https://api.deepseek.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model,
        messages: [
          ...(soul?.identity ? [{ role: 'system', content: soul.identity }] : []),
          { role: 'user', content: userMessage }
        ],
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096
      };
    } else if (provider === 'qwen') {
      url = endpoint || 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
      body = {
        model,
        messages: [
          ...(soul?.identity ? [{ role: 'system', content: soul.identity }] : []),
          { role: 'user', content: userMessage }
        ],
        temperature: temperature || 0.7,
        max_tokens: maxTokens || 4096
      };
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
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

    if (provider === 'openai' || provider === 'deepseek' || provider === 'qwen') {
      return data.choices?.[0]?.message?.content || '';
    } else if (provider === 'anthropic') {
      return data.content?.[0]?.text || '';
    } else if (provider === 'ollama') {
      return data.message?.content || '';
    }

    return '';
  }
}

export default StratixAgentExecutor;
