import type { StratixCommandData, StratixAgentConfig, StratixSkillConfig } from '../stratix-protocol';
import type { AgentExecutor, ExecutorResult, ExecutorOptions } from './AgentExecutor';
import { DirectLLMService } from '../services/DirectLLMService';

export class DirectLLMExecutor implements AgentExecutor {
  private llmService: DirectLLMService;

  constructor(llmService?: DirectLLMService) {
    this.llmService = llmService || new DirectLLMService();
  }

  async execute(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig,
    options?: ExecutorOptions
  ): Promise<ExecutorResult> {
    try {
      if (!agentConfig.directConfig) {
        return {
          success: false,
          error: 'Direct LLM config not found for agent',
        };
      }

      const skill = this.findSkill(agentConfig, command.skillId);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${command.skillId}`,
        };
      }

      const userMessage = this.buildUserMessage(skill, command.params);

      if (options?.stream && options.onChunk) {
        const result = await this.llmService.generateStreamResponse(
          agentConfig.directConfig,
          agentConfig.soul || { identity: '', goals: [], personality: '' },
          agentConfig.memory || { shortTerm: [], longTerm: [], context: '' },
          agentConfig.skills || [],
          agentConfig.rules || [],
          userMessage,
          options.onChunk
        );

        return {
          success: result.finishReason !== 'error',
          data: result.content,
          usage: result.usage,
          error: result.finishReason === 'error' ? 'Generation failed' : undefined,
        };
      }

      const result = await this.llmService.generateResponse(
        agentConfig.directConfig,
        agentConfig.soul || { identity: '', goals: [], personality: '' },
        agentConfig.memory || { shortTerm: [], longTerm: [], context: '' },
        agentConfig.skills || [],
        agentConfig.rules || [],
        userMessage
      );

      return {
        success: result.finishReason !== 'error',
        data: result.content,
        usage: result.usage,
        error: result.finishReason === 'error' ? 'Generation failed' : undefined,
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

    if (!agentConfig.directConfig) {
      errors.push('Direct LLM config not found for agent');
      return { valid: false, errors };
    }

    const skill = this.findSkill(agentConfig, command.skillId);
    if (!skill) {
      errors.push(`Skill not found: ${command.skillId}`);
      return { valid: false, errors };
    }

    if (skill.parameters) {
      for (const param of skill.parameters) {
        if (param.required && !(param.name in command.params)) {
          errors.push(`Missing required parameter: ${param.name}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async testConnection(agentConfig: StratixAgentConfig): Promise<{ success: boolean; message: string }> {
    if (!agentConfig.directConfig) {
      return { success: false, message: 'Direct LLM config not found' };
    }

    return this.llmService.testConnection(agentConfig.directConfig);
  }

  private findSkill(
    agentConfig: StratixAgentConfig,
    skillId: string
  ): StratixSkillConfig | null {
    return agentConfig.skills?.find(s => s.skillId === skillId) || null;
  }

  private buildUserMessage(skill: StratixSkillConfig, params: Record<string, any>): string {
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
}

export default DirectLLMExecutor;
