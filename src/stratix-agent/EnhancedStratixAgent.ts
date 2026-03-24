/**
 * 增强的 StratixAgent
 * 支持工作流执行、反思机制、多步骤规划
 */

import { AgentConfig, SoulConfig, ChatMessage, SkillDefinition, SkillResult } from './types';
import { StratixAgent } from './StratixAgent';
import { EnhancedPromptBuilder } from './core/EnhancedPromptBuilder';
import { EnhancedSoulConfig, ReflectionEntry } from './types/soul';
import { AgentTemplate, WorkflowDefinition, WorkflowStep } from './types/template';
import { MixinComposer } from './mixins/MixinComposer';

export interface AgentCapabilities {
  workflowExecution: boolean;
  reflection: boolean;
  toolUse: boolean;
  multiStepPlanning: boolean;
  selfCorrection: boolean;
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

interface MemoryEntry {
  id: string;
  title: string;
  content: string;
  importance: number;
  createdAt: string;
}

/**
 * 增强的 StratixAgent
 * 支持模板加载、工作流执行、反思机制
 */
export class EnhancedStratixAgent extends StratixAgent {
  private template: AgentTemplate | null = null;
  private enhancedPromptBuilder: EnhancedPromptBuilder;
  private mixinComposer: MixinComposer;
  private capabilities: AgentCapabilities;
  private currentWorkflow: WorkflowStep[] = [];
  private reflectionHistory: ReflectionEntry[] = [];
  private memoryEntries: MemoryEntry[] = [];

  constructor(config: AgentConfig, soul: SoulConfig, template?: AgentTemplate) {
    super(config, soul);
    this.template = template ? this.loadTemplate(template) : null;
    this.enhancedPromptBuilder = new EnhancedPromptBuilder();
    this.mixinComposer = new MixinComposer();
    this.capabilities = this.detectCapabilities();
  }

  /**
   * 加载模板
   */
  loadTemplate(template: AgentTemplate): AgentTemplate {
    // 应用 mixin 组合
    if (template.mixins.length > 0) {
      template = this.mixinComposer.compose(template, template.mixins);
    }
    this.template = template;
    this.capabilities = this.detectCapabilities();
    return template;
  }

  /**
   * 应用 Mixin
   */
  applyMixin(mixin: 'base' | 'resource' | 'compliance'): void {
    if (!this.template) return;
    this.template = this.mixinComposer.compose(this.template, [mixin]);
    this.capabilities = this.detectCapabilities();
  }

  /**
   * 移除 Mixin
   */
  removeMixin(mixin: 'base' | 'resource' | 'compliance'): void {
    if (!this.template) return;
    this.template = this.mixinComposer.removeMixin(this.template, mixin);
    this.capabilities = this.detectCapabilities();
  }

  /**
   * 获取当前模板
   */
  getTemplate(): AgentTemplate | null {
    return this.template;
  }

  /**
   * 获取能力列表
   */
  getCapabilities(): AgentCapabilities {
    return { ...this.capabilities };
  }

  /**
   * 检测 Agent 能力
   */
  private detectCapabilities(): AgentCapabilities {
    return {
      workflowExecution: (this.template?.workflows.length ?? 0) > 0,
      reflection: true,
      toolUse: this.skills.getEnabledSkills().length > 0,
      multiStepPlanning: (this.template?.workflowSteps.length ?? 0) > 1,
      selfCorrection: true,
    };
  }

  /**
   * 增强的聊天方法
   */
  async chat(
    message: string,
    options?: {
      sessionId?: string;
      stream?: boolean;
      onChunk?: (chunk: string) => void;
      includeWorkflow?: boolean;
      includeReflection?: boolean;
    }
  ): Promise<EnhancedAgentResponse> {
    const { includeWorkflow = true, includeReflection = true } = options || {};

    // 如果没有模板，使用标准聊天
    if (!this.template) {
      return super.chat(message, options) as Promise<EnhancedAgentResponse>;
    }

    // 1. 检测是否需要执行工作流
    if (includeWorkflow && this.template.workflows.length > 0) {
      const matchedWorkflow = this.matchWorkflow(message);
      if (matchedWorkflow) {
        return this.executeWorkflow(matchedWorkflow, message, options);
      }
    }

    // 2. 构建增强提示词
    const systemMessages = this.enhancedPromptBuilder.buildFullSystemPrompt(
      this.template,
      this.soul as EnhancedSoulConfig,
      this.memory.buildContext(),
      this.skills.getEnabledSkills(),
      this.sessions.getMessages(options?.sessionId || '', 10),
      { includeReflection, includeWorkflow }
    );

    // 3. 执行聊天
    const session = this.sessions.getOrCreateSession(this.config.agentId, options?.sessionId);
    this.sessions.addMessage(session.sessionId, { role: 'user', content: message });
    this.memory.addMessage('user', message);

    // 调用 LLM
    let result;
    if (options?.stream && options?.onChunk) {
      result = await this.llm.generateStream(systemMessages, options.onChunk);
    } else {
      result = await this.llm.generate(systemMessages);
    }

    this.sessions.addMessage(session.sessionId, { role: 'assistant', content: result.content });
    this.memory.addMessage('assistant', result.content);

    const response: EnhancedAgentResponse = {
      sessionId: session.sessionId,
      response: result.content,
      usage: result.usage,
      reflectionUsed: false,
    };

    // 4. 反思机制
    if (includeReflection && (this.soul as EnhancedSoulConfig).reflection?.afterEachTask) {
      await this.performReflection(message, result.content);
      response.reflectionUsed = true;
    }

    return response;
  }

  /**
   * 匹配工作流
   */
  private matchWorkflow(message: string): WorkflowDefinition | null {
    if (!this.template?.workflows) return null;

    const messageLower = message.toLowerCase();

    for (const workflow of this.template.workflows) {
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
  private async executeWorkflow(
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
    const session = this.sessions.getOrCreateSession(this.config.agentId, options?.sessionId);

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
        results.push(`\n[ERROR in Step ${step.order}]: ${error}\n`);
        if (step.onError === 'stop') break;
      }
    }

    results.push(`\n[工作流完成: ${workflow.name}]`);

    const finalResponse = results.join('\n');

    // 保存到会话
    this.sessions.addMessage(session.sessionId, { role: 'user', content: initialMessage });
    this.sessions.addMessage(session.sessionId, { role: 'assistant', content: finalResponse });

    return {
      sessionId: session.sessionId,
      response: finalResponse,
      workflowUsed: workflow.name,
    };
  }

  /**
   * 执行单个工作流步骤
   */
  private async executeWorkflowStep(
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
        .filter(s => step.skills!.includes(s.skillId));

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
    const messages: ChatMessage[] = [{ role: 'user', content: prompt }];

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
  private async handleWorkflowError(step: WorkflowStep, context: string): Promise<string> {
    const errorPrompt = `错误发生在了步骤: ${step.name}
错误上下文: ${context}

请分析错误原因并提供解决方案。`;

    const response = await this.llm.generate([{ role: 'user', content: errorPrompt }]);
    return response.content;
  }

  /**
   * 反思机制
   */
  private async performReflection(task: string, result: string): Promise<void> {
    const reflectionConfig = (this.soul as EnhancedSoulConfig).reflection;
    if (!reflectionConfig?.enabled) return;

    const reflectionPrompt = `任务: ${task}
结果: ${result}

请简短反思:
1. 任务完成度如何？
2. 有什么可以改进的地方？
3. 从中学到了什么？`;

    const response = await this.llm.generate([{ role: 'user', content: reflectionPrompt }]);
    const reflectionContent = response.content;

    // 创建反思条目
    const entry: ReflectionEntry = {
      id: `reflection-${Date.now()}`,
      timestamp: new Date().toISOString(),
      task,
      result,
      reflection: reflectionContent,
    };

    this.reflectionHistory.push(entry);

    // 如果启用了长期记忆，保存重要反思
    if (this.reflectionHistory.length > 10) {
      const summary = await this.summarizeReflections();
      await this.addMemoryEntry(summary, 2);
      this.reflectionHistory = [];
    }

    // 自我纠正检查
    if (reflectionConfig.onError && result.includes('[ERROR]')) {
      await this.selfCorrect(task, result, reflectionContent);
    }
  }

  /**
   * 自我纠正
   */
  private async selfCorrect(task: string, result: string, reflection: string): Promise<void> {
    const correctionPrompt = `原始任务: ${task}
执行结果: ${result}
反思: ${reflection}

请分析问题并提出纠正方案。不要重复相同的错误。`;

    const correction = await this.llm.generate([{ role: 'user', content: correctionPrompt }]);

    // 保存纠正历史
    await this.addMemoryEntry(
      `自我纠正: ${correction.content}`,
      3
    );
  }

  /**
   * 总结反思历史
   */
  private async summarizeReflections(): Promise<string> {
    if (this.reflectionHistory.length === 0) return '';

    const summaryPrompt = `请总结以下反思要点，提取关键经验（不超过 200 字）:\n\n${
      this.reflectionHistory.map(r => `- ${r.reflection}`).join('\n')
    }`;

    const response = await this.llm.generate([{ role: 'user', content: summaryPrompt }]);
    return response.content;
  }

  /**
   * 添加长期记忆
   */
  private async addMemoryEntry(content: string, importance: 1 | 2 | 3 = 2): Promise<void> {
    if (this.memory) {
      // 使用内置的记忆系统
      const entry: MemoryEntry = {
        id: `memory-${Date.now()}`,
        title: content.substring(0, 50),
        content,
        importance,
        createdAt: new Date().toISOString(),
      };
      this.memoryEntries.push(entry);

      // 如果支持长期记忆，添加到 MemoryManager
      if ((this.memory as any).addLongTermMemory) {
        (this.memory as any).addLongTermMemory({
          title: entry.title,
          content: entry.content,
          importance: entry.importance,
        });
      }
    }
  }

  /**
   * 获取反思历史
   */
  getReflectionHistory(): ReflectionEntry[] {
    return [...this.reflectionHistory];
  }

  /**
   * 获取记忆条目
   */
  getMemoryEntries(): MemoryEntry[] {
    return [...this.memoryEntries];
  }

  /**
   * 清空反思历史
   */
  clearReflectionHistory(): void {
    this.reflectionHistory = [];
  }

  /**
   * 清空记忆
   */
  clearMemory(): void {
    this.memoryEntries = [];
  }
}

export default EnhancedStratixAgent;
