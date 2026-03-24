/**
 * 增强的分层提示词构建器
 * 支持 9 层结构，兼容 agency-agents 格式
 */

import { ChatMessage } from '../types';
import { AgentTemplate } from '../types/template';
import { EnhancedSoulConfig, ReflectionEntry } from '../types/soul';

interface PromptConfig {
  includeReflection?: boolean;
  includeWorkflow?: boolean;
  includeSuccessMetrics?: boolean;
  includeHistory?: boolean;
  maxHistoryLength?: number;
}

interface LayerOptions {
  showLayerHeaders?: boolean;
  maxLength?: number;
}

/**
 * 分层提示词构建器
 * Layer 1: Role Definition (角色设定)
 * Layer 2: Mission (核心使命)
 * Layer 3: Workflow (工作流)
 * Layer 4: Rules & Constraints (规则与约束)
 * Layer 5: Available Skills (可用技能)
 * Layer 6: Context & Memory (上下文与记忆)
 * Layer 7: History (历史对话)
 * Layer 8: Reflection (反思机制)
 * Layer 9: Success Metrics (成功指标)
 */
export class EnhancedPromptBuilder {
  private static readonly DEFAULT_MAX_HISTORY = 10;
  private static readonly DEFAULT_MAX_CONTEXT = 4000;

  /**
   * 构建完整的系统提示词 (多层级结构)
   */
  buildFullSystemPrompt(
    template: AgentTemplate,
    soul: EnhancedSoulConfig,
    memoryContext: string,
    skills: Array<{ skillId: string; name: string; description: string; parameters?: unknown[] }>,
    recentHistory: ChatMessage[] = [],
    config?: PromptConfig
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];
    const options: LayerOptions = { showLayerHeaders: true };

    // Layer 1: 角色设定 (Role Definition)
    const roleLayer = this.buildRoleLayer(template, soul, options);
    if (roleLayer.content) messages.push(roleLayer);

    // Layer 2: 核心使命 (Mission)
    const missionLayer = this.buildMissionLayer(template, soul, options);
    if (missionLayer.content) messages.push(missionLayer);

    // Layer 3: 工作流 (Workflow) - 可选
    if (config?.includeWorkflow !== false && template.workflows.length > 0) {
      const workflowLayer = this.buildWorkflowLayer(template, options);
      if (workflowLayer.content) messages.push(workflowLayer);
    }

    // Layer 4: 规则与约束 (Rules & Constraints)
    const rulesLayer = this.buildRulesLayer(template, soul, options);
    if (rulesLayer.content) messages.push(rulesLayer);

    // Layer 5: 可用技能 (Available Skills)
    if (skills.length > 0) {
      const skillsLayer = this.buildSkillsLayer(skills, options);
      if (skillsLayer.content) messages.push(skillsLayer);
    }

    // Layer 6: 上下文与记忆 (Context & Memory)
    if (memoryContext) {
      const memoryLayer = this.buildMemoryLayer(memoryContext, options);
      if (memoryLayer.content) messages.push(memoryLayer);
    }

    // Layer 7: 历史对话 (History)
    if (config?.includeHistory !== false && recentHistory.length > 0) {
      const historyLayer = this.buildHistoryLayer(recentHistory, {
        ...options,
        maxLength: config?.maxHistoryLength || EnhancedPromptBuilder.DEFAULT_MAX_HISTORY
      });
      if (historyLayer.content) messages.push(historyLayer);
    }

    // Layer 8: 反思机制 (Reflection) - 可选
    if (config?.includeReflection && soul.reflection?.enabled) {
      const reflectionLayer = this.buildReflectionLayer(soul.reflection, options);
      if (reflectionLayer.content) messages.push(reflectionLayer);
    }

    // Layer 9: 成功指标 (Success Metrics) - 可选
    if (config?.includeSuccessMetrics && template.successMetrics.length > 0) {
      const metricsLayer = this.buildSuccessMetricsLayer(template, options);
      if (metricsLayer.content) messages.push(metricsLayer);
    }

    return messages;
  }

  /**
   * Layer 1: 角色设定
   */
  private buildRoleLayer(template: AgentTemplate, soul: EnhancedSoulConfig, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('# ═══════════════════════════════════════════');
      parts.push('# 角色设定 ROLE DEFINITION');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    // 身份
    parts.push(`## ${template.name || 'Agent'}`);
    const identity = template.identity || soul.identity || '';
    if (identity) {
      parts.push(identity);
    }

    // 个性特征
    const personality = template.personality || soul.personality || '';
    if (personality) {
      parts.push('\n## 个性特征 Personality');
      parts.push(personality);
    }

    // 语气风格
    const tone = template.tone || soul.tone || soul.speakingStyle || '';
    if (tone) {
      parts.push('\n## 语气风格 Tone');
      parts.push(tone);
    }

    // 价值观
    if (soul.values && soul.values.length > 0) {
      parts.push('\n## 价值观 Values');
      parts.push(soul.values.map((v, i) => `${i + 1}. ${v}`).join('\n'));
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 2: 核心使命
   */
  private buildMissionLayer(template: AgentTemplate, soul: EnhancedSoulConfig, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 核心使命 CORE MISSION');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    const mission = template.mission || soul.mission || soul.core_mission || '';
    if (mission) {
      parts.push(mission);
    } else {
      parts.push(`作为 ${template.name}，提供专业、高效的服务。`);
    }

    // 目标
    const goals = soul.goals || template.workflows.map(w => w.name);
    if (goals.length > 0) {
      parts.push('\n## 核心目标 Goals');
      parts.push(goals.map((g, i) => `${i + 1}. ${g}`).join('\n'));
    }

    // 工作模式
    if (soul.workingMode) {
      const modeNames: Record<string, string> = {
        'autonomous': '自主模式 - 独立完成复杂任务',
        'collaborative': '协作模式 - 与用户合作完成任务',
        'supervised': '监督模式 - 在指导下工作',
      };
      parts.push(`\n## 工作模式 Working Mode: ${modeNames[soul.workingMode] || soul.workingMode}`);
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 3: 工作流
   */
  private buildWorkflowLayer(template: AgentTemplate, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 工作流 WORKFLOW');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    for (const workflow of template.workflows) {
      parts.push(`## ${workflow.name}`);
      if (workflow.description) {
        parts.push(workflow.description);
      }

      if (workflow.steps.length > 0) {
        parts.push('\n### 执行步骤 Steps:');
        for (const step of workflow.steps) {
          parts.push(`${step.order}. **${step.name}**`);
          parts.push(`   - 描述: ${step.description}`);
          if (step.expectedOutput) {
            parts.push(`   - 预期输出: ${step.expectedOutput}`);
          }
          if (step.tools && step.tools.length > 0) {
            parts.push(`   - 工具: ${step.tools.join(', ')}`);
          }
          if (step.skills && step.skills.length > 0) {
            parts.push(`   - 技能: ${step.skills.join(', ')}`);
          }
        }
      }

      parts.push('');
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 4: 规则与约束
   */
  private buildRulesLayer(template: AgentTemplate, soul: EnhancedSoulConfig, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 规则与约束 RULES & CONSTRAINTS');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    // 关键规则
    if (template.rules.length > 0) {
      parts.push('## 关键规则 Critical Rules');
      const sortedRules = [...template.rules].sort((a, b) => {
        const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
        return (priorityOrder[a.priority] ?? 4) - (priorityOrder[b.priority] ?? 4);
      });

      for (const rule of sortedRules) {
        const icon = rule.priority === 'critical' ? '🔴 [CRITICAL]' :
                     rule.priority === 'high' ? '🟡 [HIGH]' : '';
        parts.push(`- ${icon} ${rule.rule}`);
        if (rule.reason) {
          parts.push(`  └─ 原因: ${rule.reason}`);
        }
      }
    }

    // 约束条件
    const constraints = [...template.constraints, ...(soul.constraints || [])];
    if (constraints.length > 0) {
      parts.push('\n## 约束条件 Constraints');
      for (const constraint of constraints) {
        parts.push(`- ${constraint}`);
      }
    }

    // 禁止行为
    const forbidden = [...template.forbiddenActions, ...(soul.forbiddenActions || [])];
    if (forbidden.length > 0) {
      parts.push('\n## 禁止行为 Never Do');
      for (const action of forbidden) {
        parts.push(`🚫 ${action}`);
      }
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 5: 可用技能
   */
  private buildSkillsLayer(skills: Array<{ skillId: string; name: string; description: string; parameters?: unknown[] }>, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 可用技能 AVAILABLE SKILLS');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    for (const skill of skills) {
      parts.push(`## ${skill.name}`);
      parts.push(skill.description);

      if (skill.parameters && Array.isArray(skill.parameters) && skill.parameters.length > 0) {
        parts.push('\n### 参数 Parameters:');
        for (const param of skill.parameters as Array<{ name: string; type: string; required?: boolean; description?: string }>) {
          const required = param.required ? '[必需]' : '[可选]';
          const desc = param.description ? ` - ${param.description}` : '';
          parts.push(`- \`${param.name}\`: ${param.type} ${required}${desc}`);
        }
      }

      parts.push('');
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 6: 上下文与记忆
   */
  private buildMemoryLayer(memoryContext: string, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 上下文与记忆 CONTEXT & MEMORY');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    // 截断过长的上下文
    let context = memoryContext;
    const maxLength = options.maxLength || EnhancedPromptBuilder.DEFAULT_MAX_CONTEXT;
    if (context.length > maxLength) {
      context = context.substring(0, maxLength) + '\n\n[... 上下文已被截断 ...]';
    }

    parts.push(context);

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 7: 历史对话
   */
  private buildHistoryLayer(history: ChatMessage[], options: LayerOptions & { maxLength?: number }): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 最近对话 RECENT HISTORY');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    const maxLength = options.maxLength || EnhancedPromptBuilder.DEFAULT_MAX_HISTORY;
    const recentHistory = history.slice(-maxLength);

    for (const msg of recentHistory) {
      const roleIcon = msg.role === 'user' ? '👤' : msg.role === 'assistant' ? '🤖' : '📝';
      const content = msg.content.length > 500 ? msg.content.substring(0, 500) + '...' : msg.content;
      parts.push(`${roleIcon} **${msg.role}**: ${content}`);
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 8: 反思机制
   */
  private buildReflectionLayer(reflectionConfig: { afterEachTask?: boolean; onError?: boolean; weeklyReview?: boolean }, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 反思机制 REFLECTION');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    parts.push('在完成重要任务后，请进行以下反思:\n');

    if (reflectionConfig.afterEachTask) {
      parts.push('## 任务后反思 Post-Task Reflection');
      parts.push('1. **任务完成度**: 任务是否完全按照要求完成？');
      parts.push('2. **质量检查**: 输出是否符合质量标准？');
      parts.push('3. **改进空间**: 有什么可以改进的地方？');
      parts.push('4. **经验总结**: 从这次任务中学到了什么？\n');
    }

    if (reflectionConfig.onError) {
      parts.push('## 错误反思 Error Reflection');
      parts.push('遇到错误或问题时，请先分析原因，然后提出解决方案。\n');
    }

    if (reflectionConfig.weeklyReview) {
      parts.push('## 周回顾 Weekly Review');
      parts.push('定期回顾你完成的任务，总结常见模式和最佳实践。');
    }

    parts.push('\n你可以使用 <reflection> 标签来记录你的反思。');

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * Layer 9: 成功指标
   */
  private buildSuccessMetricsLayer(template: AgentTemplate, options: LayerOptions): ChatMessage {
    const parts: string[] = [];

    if (options.showLayerHeaders) {
      parts.push('\n# ═══════════════════════════════════════════');
      parts.push('# 成功指标 SUCCESS METRICS');
      parts.push('# ═══════════════════════════════════════════\n');
    }

    for (const metric of template.successMetrics) {
      parts.push(`## ${metric.name}`);
      parts.push(`- 描述: ${metric.description}`);
      if (metric.measurement) {
        parts.push(`- 测量方法: ${metric.measurement}`);
      }
      if (metric.targetValue) {
        parts.push(`- 目标: ${metric.targetValue}`);
      }
      parts.push('');
    }

    return {
      role: 'system',
      content: parts.join('\n'),
    };
  }

  /**
   * 构建 Claude Code 风格的思考指示
   */
  buildThinkingPrompt(): ChatMessage {
    return {
      role: 'system',
      content: `# ═══════════════════════════════════════════
# 思考过程 THINKING PROCESS
# ═══════════════════════════════════════════

在响应用户请求时，应该:
1. **理解需求**: 先理解用户的需求和目标
2. **分析资源**: 分析可用的工具和技能
3. **制定计划**: 制定执行计划
4. **逐步执行**: 逐步执行并检查结果
5. **确认完成**: 在适当时请求确认或澄清

你可以使用 <thinking> 标签来记录你的思考过程:
<thinking>
分析这个请求...
决定使用哪些工具...
执行步骤...
</thinking>

<output>
实际输出内容
</output>`
    };
  }

  /**
   * 构建零样本提示 (用于简单任务)
   */
  buildZeroShotPrompt(
    task: string,
    skills: Array<{ skillId: string; name: string; description: string }>,
    options?: { includeThinking?: boolean }
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // 可选：添加思考提示
    if (options?.includeThinking) {
      messages.push(this.buildThinkingPrompt());
    }

    // 技能说明
    if (skills.length > 0) {
      const skillsContent = skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
      messages.push({
        role: 'system',
        content: `# 可用技能\n${skillsContent}`,
      });
    }

    // 用户任务
    messages.push({
      role: 'user',
      content: task,
    });

    return messages;
  }

  /**
   * 构建少样本提示 (Few-shot)
   */
  buildFewShotPrompt(
    task: string,
    examples: Array<{ input: string; output: string }>,
    skills: Array<{ skillId: string; name: string; description: string }> = []
  ): ChatMessage[] {
    const messages: ChatMessage[] = [];

    // 示例
    if (examples.length > 0) {
      const examplesContent = examples.map((ex, i) =>
        `## 示例 ${i + 1}\n\n**输入**: ${ex.input}\n\n**输出**: ${ex.output}`
      ).join('\n\n');

      messages.push({
        role: 'system',
        content: `# 示例 EXAMPLES\n\n${examplesContent}`,
      });
    }

    // 技能
    if (skills.length > 0) {
      const skillsContent = skills.map(s => `- **${s.name}**: ${s.description}`).join('\n');
      messages.push({
        role: 'system',
        content: `# 可用技能\n${skillsContent}`,
      });
    }

    // 任务
    messages.push({
      role: 'user',
      content: task,
    });

    return messages;
  }

  /**
   * 将多条消息合并为单条系统提示
   * (用于某些不支持多消息的 API)
   */
  collapseToSingleMessage(messages: ChatMessage[]): ChatMessage {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    const combinedContent = systemMessages.map(m => m.content).join('\n\n---\n\n');

    return {
      role: 'system',
      content: combinedContent,
    };
  }
}

export default EnhancedPromptBuilder;
