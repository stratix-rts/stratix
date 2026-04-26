import type { StratixSkillConfig, StratixCommandData, StratixFrontendOperationEvent } from '@/stratix-core/stratix-protocol';

export interface CommandBuildOptions {
  agentIds: string[];
  skill: StratixSkillConfig;
  params: Record<string, any>;
  executeAt?: number;
}

export interface CommandBuildResult {
  commands: StratixCommandData[];
  agentCount: number;
}

export class CommandBuilder {
  private static generateCommandId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 10);
    return `stratix-cmd-${timestamp}-${random}`;
  }

  private static generateRequestId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).slice(2, 8);
    return `stratix-req-${timestamp}-${random}`;
  }

  static buildSingleCommand(
    agentId: string,
    skill: StratixSkillConfig,
    params: Record<string, any>,
    executeAt?: number
  ): StratixCommandData {
    return {
      commandId: this.generateCommandId(),
      skillId: skill.skillId,
      agentId,
      params: { ...params },
      executeAt: executeAt ?? Date.now()
    };
  }

  static buildCommands(options: CommandBuildOptions): CommandBuildResult {
    const { agentIds, skill, params, executeAt } = options;
    const commands: StratixCommandData[] = [];
    const timestamp = executeAt ?? Date.now();

    for (const agentId of agentIds) {
      commands.push({
        commandId: this.generateCommandId(),
        skillId: skill.skillId,
        agentId,
        params: { ...params },
        executeAt: timestamp
      });
    }

    return {
      commands,
      agentCount: commands.length
    };
  }

  static buildCommandEvent(
    agentIds: string[],
    skill: StratixSkillConfig,
    command: StratixCommandData
  ): StratixFrontendOperationEvent {
    return {
      eventType: 'stratix:command_execute',
      payload: {
        agentIds,
        skill,
        command
      },
      timestamp: Date.now(),
      requestId: this.generateRequestId()
    };
  }

  static buildBatchCommandEvents(
    agentIds: string[],
    skill: StratixSkillConfig,
    params: Record<string, any>
  ): StratixFrontendOperationEvent[] {
    const { commands } = this.buildCommands({ agentIds, skill, params });
    const events: StratixFrontendOperationEvent[] = [];

    for (const command of commands) {
      events.push(this.buildCommandEvent([command.agentId], skill, command));
    }

    return events;
  }

  static formatCommandPreview(command: StratixCommandData, skillName: string): string {
    const escapeHtml = (str: string): string => {
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    };

    const paramsPreview = Object.entries(command.params)
      .slice(0, 5) // Limit to 5 params to prevent DoS
      .map(([key, value]) => {
        const valueStr = JSON.stringify(value);
        const truncatedValue = valueStr.length > 200 ? valueStr.slice(0, 200) + '...' : valueStr;
        return `${key}: ${truncatedValue}`;
      })
      .join(', ');

    return `执行技能 "${escapeHtml(skillName)}" | 参数: ${paramsPreview || '无'}`;
  }

  static validateCommandParams(
    skill: StratixSkillConfig,
    params: Record<string, any>
  ): { isValid: boolean; missingParams: string[] } {
    const missingParams: string[] = [];
    
    for (const param of skill.parameters) {
      if (param.required) {
        const value = params[param.paramId];
        if (value === undefined || value === null || value === '') {
          missingParams.push(param.name);
        }
      }
    }

    return {
      isValid: missingParams.length === 0,
      missingParams
    };
  }
}

export default CommandBuilder;
