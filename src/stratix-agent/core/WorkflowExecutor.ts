/**
 * WorkflowExecutor - 工作流执行逻辑
 * 从 EnhancedStratixAgent 拆分出来的独立职责类
 */

import type { SessionRuntime } from '../runtime/SessionRuntime';
import type { LLMConnector } from './LLMConnector';
import type { SkillRegistry } from './SkillRegistry';
import type { AgentTemplate, WorkflowDefinition, WorkflowStep } from '../types/template';
import type { ChatMessage as AgentChatMessage, SkillResult } from '../types';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[WorkflowExecutor] ${message}`, ctx || '');
}

export interface EnhancedAgentResponse {
  sessionId: string;
  response: string;
  skillExecutions?: SkillResult[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  workflowUsed?: string;
  reflectionUsed?: boolean;
}

export interface WorkflowExecutorOptions {
  llm: LLMConnector;
  getRuntime: () => SessionRuntime;
  skills: SkillRegistry;
  agentId: string;
}

export class WorkflowExecutor {
  private llm: LLMConnector;
  private getRuntime: () => SessionRuntime;
  private skills: SkillRegistry;
  private agentId: string;

  constructor(options: WorkflowExecutorOptions) {
    this.llm = options.llm;
    this.getRuntime = options.getRuntime;
    this.skills = options.skills;
    this.agentId = options.agentId;
  }

  /**
   * 匹配工作流
   */
  matchWorkflow(message: string, template: AgentTemplate | null): WorkflowDefinition | null {
    if (!template?.workflows) return null;

    const messageLower = message.toLowerCase();

    for (const workflow of template.workflows) {
      // 检查触发条件
      if (workflow.triggerConditions) {
        for (const condition of workflow.triggerConditions) {
          if (messageLower.includes(condition.toLowerCase())) {
            return workflow;
          }
        }
      }

      // 检查步骤中的工具/技能是否匹配
      for (const step of workflow.steps) {
        if (step.tools?.some(tool => messageLower.includes(tool.toLowerCase()))) {
          return workflow;
        }
        if (step.skills?.some(skill => messageLower.includes(skill.toLowerCase()))) {
          return workflow;
        }
        // 检查步骤名称是否匹配
        if (messageLower.includes(step.name.toLowerCase())) {
          return workflow;
        }
      }
    }

    return null;
  }

  /**
   * 执行工作流
   */
  async executeWorkflow(
    workflow: WorkflowDefinition,
    initialMessage: string,
    options?: {
      sessionId?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<EnhancedAgentResponse> {
    const results: string[] = [];
    let context = initialMessage;

    const runtime = this.getRuntime();

    // 使用 SessionRuntime 管理会话
    let session;
    if (options?.sessionId) {
      const existingSession = await runtime.getSession(options.sessionId);
      if (existingSession) {
        session = existingSession;
      }
    }
    if (!session) {
      session = await runtime.createSession(this.agentId);
    }

    results.push(`[开始执行工作流: ${workflow.name}]\n`);

    for (const step of workflow.steps) {
      try {
        // 执行步骤
        const stepResult = await this.executeWorkflowStep(step, context, options);
        results.push(`\n[Step ${step.order}: ${step.name}]\n${stepResult}\n`);

        // 更新上下文
        context = stepResult;

        // 检查错误处理
        if (step.onError && stepResult.includes('[ERROR]')) {
          const errorResult = await this.handleWorkflowError(step, context);
          results.push(`\n[错误处理]\n${errorResult}\n`);
          if (step.onError === 'stop') break;
        }

        // 执行后续步骤
        if (step.nextSteps && step.nextSteps.length > 0) {
          for (const nextStepId of step.nextSteps) {
            const nextStep = workflow.steps.find(s => s.id === nextStepId);
            if (nextStep) {
              const nextResult = await this.executeWorkflowStep(nextStep, context, options);
              results.push(`\n[Step ${nextStep.order}: ${nextStep.name}]\n${nextResult}\n`);
              context = nextResult;
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log('error', `Workflow step "${step.name}" failed`, { stepOrder: step.order, error: errorMsg });
        results.push(`\n[ERROR in Step ${step.order}]: ${errorMsg}\n`);
        if (step.onError === 'stop') break;
      }
    }

    results.push(`\n[工作流完成: ${workflow.name}]`);

    const finalResponse = results.join('\n');

    // 保存到会话（通过 SessionRuntime）
    const now = Date.now();
    session.messages.push({ id: `user_${now}`, role: 'user', content: initialMessage, timestamp: now });
    session.messages.push({ id: `asst_${now}`, role: 'assistant', content: finalResponse, timestamp: now });

    // 记录到 transcript
    await runtime.getTranscriptStore().append({
      sessionId: session.sessionId,
      turnId: `user_${now}`,
      role: 'user',
      content: initialMessage,
      timestamp: now,
    });
    await runtime.getTranscriptStore().append({
      sessionId: session.sessionId,
      turnId: `asst_${now}`,
      role: 'assistant',
      content: finalResponse,
      timestamp: now,
    });

    return {
      sessionId: session.sessionId,
      response: finalResponse,
      workflowUsed: workflow.name,
    };
  }

  /**
   * 执行单个工作流步骤
   */
  async executeWorkflowStep(
    step: WorkflowStep,
    context: string,
    options?: {
      stream?: boolean;
      onChunk?: (chunk: string) => void;
    }
  ): Promise<string> {
    let prompt = `任务: ${step.description}\n\n上下文: ${context}\n\n`;

    if (step.skills && step.skills.length > 0) {
      const relevantSkills = this.skills.getEnabledSkills()
        .filter(s => step.skills?.includes(s.skillId));

      if (relevantSkills.length > 0) {
        prompt += `使用技能:\n`;
        for (const skill of relevantSkills) {
          prompt += `- **${skill.name}**: ${skill.description}\n`;
        }
        prompt += '\n';
      }
    }

    if (step.expectedOutput) {
      prompt += `预期输出: ${step.expectedOutput}\n`;
    }

    prompt += `\n请执行这个步骤并给出结果。`;

    // 调用 LLM
    const messages: AgentChatMessage[] = [{ role: 'user', content: prompt }];

    let result;
    if (options?.stream && options?.onChunk) {
      result = await this.llm.generateStream(messages, options.onChunk);
    } else {
      result = await this.llm.generate(messages);
    }

    return result.content;
  }

  /**
   * 处理工作流错误
   */
  async handleWorkflowError(step: WorkflowStep, context: string): Promise<string> {
    const errorPrompt = `错误发生在了步骤: ${step.name}
错误上下文: ${context}

请分析错误原因并提供解决方案。`;

    const response = await this.llm.generate([{ role: 'user', content: errorPrompt }]);
    return response.content;
  }
}
