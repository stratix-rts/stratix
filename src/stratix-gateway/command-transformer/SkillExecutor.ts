/**
 * Stratix Gateway - 技能执行器
 * 
 * 封装具体的技能执行逻辑，支持自定义技能类型扩展
 * 提供技能执行前后的钩子机制
 */

import { StratixSkillConfig, StratixAgentConfig, StratixCommandData } from '../../stratix-core/stratix-protocol';
import { ConnectionPool, OpenClawAction } from '../../stratix-openclaw-adapter';

export type SkillType = 'copywriting' | 'development' | 'analysis' | 'custom';

export interface SkillExecutionContext {
  skill: StratixSkillConfig;
  params: Record<string, any>;
  agentConfig: StratixAgentConfig;
  requestId: string;
}

export interface SkillExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  duration: number;
}

export interface SkillHook {
  before?(context: SkillExecutionContext): Promise<void>;
  after?(context: SkillExecutionContext, result: SkillExecutionResult): Promise<void>;
}

export interface SkillHandler {
  type: SkillType;
  validate?: (context: SkillExecutionContext) => boolean;
  preProcess?: (context: SkillExecutionContext) => SkillExecutionContext;
  postProcess?: (result: SkillExecutionResult) => SkillExecutionResult;
}

export class SkillExecutor {
  private connectionPool: ConnectionPool;
  private hooks: Map<string, SkillHook[]> = new Map();
  private skillTypes: Map<SkillType, SkillHandler> = new Map();
  private globalHooks: SkillHook[] = [];

  constructor(connectionPool?: ConnectionPool) {
    this.connectionPool = connectionPool || new ConnectionPool();
    this.initBuiltInSkillTypes();
  }

  private initBuiltInSkillTypes(): void {
    this.registerSkillType('copywriting', {
      type: 'copywriting',
      validate: (context) => !!context.params.content || !!context.params.topic,
    });

    this.registerSkillType('development', {
      type: 'development',
      validate: (context) => !!context.params.code || !!context.params.task,
    });

    this.registerSkillType('analysis', {
      type: 'analysis',
      validate: (context) => !!context.params.data || !!context.params.target,
    });

    this.registerSkillType('custom', {
      type: 'custom',
    });
  }

  public registerHook(skillId: string, hook: SkillHook): void {
    if (!this.hooks.has(skillId)) {
      this.hooks.set(skillId, []);
    }
    this.hooks.get(skillId)!.push(hook);
  }

  public registerGlobalHook(hook: SkillHook): void {
    this.globalHooks.push(hook);
  }

  public registerSkillType(type: SkillType, handler: SkillHandler): void {
    this.skillTypes.set(type, handler);
  }

  public async execute(context: SkillExecutionContext): Promise<SkillExecutionResult> {
    const startTime = Date.now();

    try {
      await this.executeBeforeHooks(context);

      const handler = this.detectSkillType(context.skill);
      let processedContext = context;
      if (handler?.preProcess) {
        processedContext = handler.preProcess(context);
      }

      const action = this.buildAction(processedContext);
      
      if (!processedContext.agentConfig.openClawConfig) {
        throw new Error('OpenClaw config is required for OpenClaw backend');
      }
      
      const adapter = await this.connectionPool.getAdapter(processedContext.agentConfig.openClawConfig);
      const response = await adapter.execute(action as OpenClawAction);

      let executionResult: SkillExecutionResult = {
        success: response.success,
        data: response.data,
        error: response.error,
        duration: Date.now() - startTime,
      };

      if (handler?.postProcess) {
        executionResult = handler.postProcess(executionResult);
      }

      await this.executeAfterHooks(context, executionResult);

      return executionResult;
    } catch (error) {
      const executionResult: SkillExecutionResult = {
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };

      await this.executeAfterHooks(context, executionResult);

      return executionResult;
    }
  }

  public async executeBatch(contexts: SkillExecutionContext[]): Promise<SkillExecutionResult[]> {
    return Promise.all(contexts.map(context => this.execute(context)));
  }

  public validateParams(skill: StratixSkillConfig, params: Record<string, any>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const param of skill.parameters) {
      if (param.required && !(param.paramId in params)) {
        if (param.defaultValue === undefined || param.defaultValue === null) {
          errors.push(`Missing required parameter: ${param.paramId}`);
        }
      }

      if (param.paramId in params) {
        const value = params[param.paramId];
        const typeValid = this.validateParamType(value, param.type);
        if (!typeValid) {
          errors.push(`Parameter ${param.paramId} has invalid type, expected ${param.type}`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  private validateParamType(value: any, type: string): boolean {
    switch (type) {
      case 'string':
        return typeof value === 'string';
      case 'number':
        return typeof value === 'number' && !isNaN(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'object':
        return typeof value === 'object' && value !== null;
      default:
        return true;
    }
  }

  private detectSkillType(skill: StratixSkillConfig): SkillHandler | undefined {
    const skillType = skill.skillId.split('-')[0] as SkillType;
    if (this.skillTypes.has(skillType)) {
      return this.skillTypes.get(skillType);
    }
    return this.skillTypes.get('custom');
  }

  private buildAction(context: SkillExecutionContext): any {
    let executeScript = context.skill.executeScript || context.skill.prompt || '';

    Object.entries(context.params).forEach(([key, value]) => {
      const regex = new RegExp(`{{${key}}}`, 'g');
      executeScript = executeScript.replace(regex, String(value));
    });

    try {
      return JSON.parse(executeScript);
    } catch {
      return { action: executeScript, params: context.params };
    }
  }

  private async executeBeforeHooks(context: SkillExecutionContext): Promise<void> {
    for (const hook of this.globalHooks) {
      if (hook.before) {
        await hook.before(context);
      }
    }

    const skillHooks = this.hooks.get(context.skill.skillId) || [];
    for (const hook of skillHooks) {
      if (hook.before) {
        await hook.before(context);
      }
    }
  }

  private async executeAfterHooks(context: SkillExecutionContext, result: SkillExecutionResult): Promise<void> {
    const skillHooks = this.hooks.get(context.skill.skillId) || [];
    for (const hook of skillHooks) {
      if (hook.after) {
        await hook.after(context, result);
      }
    }

    for (const hook of this.globalHooks) {
      if (hook.after) {
        await hook.after(context, result);
      }
    }
  }

  public createExecutionContext(
    skill: StratixSkillConfig,
    params: Record<string, any>,
    agentConfig: StratixAgentConfig,
    requestId?: string
  ): SkillExecutionContext {
    return {
      skill,
      params,
      agentConfig,
      requestId: requestId || `stratix-req-${Date.now()}`,
    };
  }

  public getConnectionPool(): ConnectionPool {
    return this.connectionPool;
  }
}

export default SkillExecutor;
