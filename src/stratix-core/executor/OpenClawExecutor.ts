import { ConnectionPool, OpenClawAction } from '../../stratix-openclaw-adapter';
import type { StratixCommandData, StratixAgentConfig, StratixSkillConfig } from '../stratix-protocol';
import { retryPolicyEngine } from '../retry/RetryPolicyEngine';
import type { RetryConfig } from '../retry/types';

import type { AgentExecutor, ExecutorResult, ExecutorOptions } from './AgentExecutor';

export class OpenClawExecutor implements AgentExecutor {
  private connectionPool: ConnectionPool;

  constructor(connectionPool?: ConnectionPool) {
    this.connectionPool = connectionPool || new ConnectionPool();
  }

  /**
   * Retry config tuned for OpenClaw network/connection errors
   */
  private getRetryConfig(): Partial<RetryConfig> {
    return {
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 10000,
      backoffMultiplier: 2,
      retryableStatuses: [429, 500, 502, 503, 504, 529],
    };
  }

  async execute(
    command: StratixCommandData,
    agentConfig: StratixAgentConfig,
    _options?: ExecutorOptions
  ): Promise<ExecutorResult> {
    try {
      if (!agentConfig.openClawConfig) {
        return {
          success: false,
          error: 'OpenClaw config not found for agent',
        };
      }

      const skill = this.findSkill(agentConfig, command.skillId);
      if (!skill) {
        return {
          success: false,
          error: `Skill not found: ${command.skillId}`,
        };
      }

      const executeScript = skill.executeScript;
      if (!executeScript) {
        return {
          success: false,
          error: `Skill ${command.skillId} has no executeScript`,
        };
      }

      const processedScript = this.replaceTemplateVariables(
        executeScript,
        command.params
      );

      const action = this.parseExecuteScript(processedScript);
      const adapter = await this.connectionPool.getAdapter(agentConfig.openClawConfig);
      const response = await retryPolicyEngine.executeWithRetry(
        () => adapter.execute(action as OpenClawAction),
        this.getRetryConfig(),
        { source: 'background', provider: 'openclaw' }
      );

      if (!response.success) {
        return {
          success: false,
          error: response.error || 'Execution failed',
        };
      }

      return {
        success: true,
        data: response.data,
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

    if (!agentConfig.openClawConfig) {
      errors.push('OpenClaw config not found for agent');
      return { valid: false, errors };
    }

    const skill = this.findSkill(agentConfig, command.skillId);
    if (!skill) {
      errors.push(`Skill not found: ${command.skillId}`);
      return { valid: false, errors };
    }

    if (!skill.executeScript) {
      errors.push(`Skill ${command.skillId} has no executeScript`);
      return { valid: false, errors };
    }

    const requiredParams = this.extractRequiredParameters(skill.executeScript);
    for (const param of requiredParams) {
      if (!(param in command.params)) {
        errors.push(`Missing required parameter: ${param}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  async testConnection(agentConfig: StratixAgentConfig): Promise<{ success: boolean; message: string }> {
    if (!agentConfig.openClawConfig) {
      return { success: false, message: 'OpenClaw config not found' };
    }

    try {
      const adapter = await this.connectionPool.getAdapter(agentConfig.openClawConfig);
      const status = await retryPolicyEngine.executeWithRetry(
        () => adapter.getStatus(),
        this.getRetryConfig(),
        { source: 'foreground', provider: 'openclaw' }
      );

      if (status.connected) {
        return { success: true, message: `Connected to OpenClaw at ${agentConfig.openClawConfig.endpoint}` };
      }
      return { success: false, message: status.error || 'Failed to connect to OpenClaw' };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  private findSkill(
    agentConfig: StratixAgentConfig,
    skillId: string
  ): StratixSkillConfig | null {
    return agentConfig.skills?.find(s => s.skillId === skillId) || null;
  }

  private replaceTemplateVariables(
    template: string,
    params: Record<string, any>
  ): string {
    let result = template;

    Object.entries(params).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      result = result.replace(regex, String(value));
    });

    const missingParams = this.findMissingParameters(result);
    if (missingParams.length > 0) {
      throw new Error(`Missing parameters: ${missingParams.join(', ')}`);
    }

    return result;
  }

  private findMissingParameters(template: string): string[] {
    const regex = /{{([^}]+)}}/g;
    const matches: string[] = [];
    let match;

    while ((match = regex.exec(template)) !== null) {
      matches.push(match[1]);
    }

    return [...new Set(matches)];
  }

  private parseExecuteScript(script: string): any {
    try {
      return JSON.parse(script);
    } catch (error) {
      throw new Error(`Failed to parse executeScript: ${error}`);
    }
  }

  private extractRequiredParameters(template: string): string[] {
    const regex = /{{([^}]+)}}/g;
    const params: string[] = [];
    let match;

    while ((match = regex.exec(template)) !== null) {
      params.push(match[1]);
    }

    return [...new Set(params)];
  }

  getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }
}

export default OpenClawExecutor;
