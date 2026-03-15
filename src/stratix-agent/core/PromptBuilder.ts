import { ChatMessage, SoulConfig, SkillDefinition } from '../types';

export class PromptBuilder {
  buildSystemPrompt(
    soul: SoulConfig,
    memoryContext: string,
    skills: SkillDefinition[],
    rules: string[]
  ): ChatMessage[] {
    const parts: string[] = [];

    if (soul.identity) {
      parts.push(`# 身份\n${soul.identity}`);
    }

    if (soul.personality) {
      parts.push(`# 性格\n${soul.personality}`);
    }

    if (soul.goals && soul.goals.length > 0) {
      parts.push(`# 目标\n${soul.goals.map((g, i) => `${i + 1}. ${g}`).join('\n')}`);
    }

    if (soul.constraints && soul.constraints.length > 0) {
      parts.push(`# 约束\n${soul.constraints.map((c, i) => `${i + 1}. ${c}`).join('\n')}`);
    }

    if (soul.speakingStyle) {
      parts.push(`# 说话风格\n${soul.speakingStyle}`);
    }

    if (memoryContext) {
      parts.push(`# 上下文\n${memoryContext}`);
    }

    if (skills.length > 0) {
      const skillList = skills.map(s => 
        `- **${s.name}**: ${s.description}`
      ).join('\n');
      parts.push(`# 可用技能\n${skillList}`);
    }

    if (rules.length > 0) {
      parts.push(`# 规则\n${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`);
    }

    return [{
      role: 'system',
      content: parts.join('\n\n')
    }];
  }

  buildSkillPrompt(skill: SkillDefinition, params: Record<string, any>): string {
    let prompt = skill.description;

    if (skill.parameters.length > 0) {
      prompt += '\n\n**参数:**\n';
      for (const param of skill.parameters) {
        const value = params[param.name] ?? param.default ?? '(未提供)';
        prompt += `- ${param.name}: ${value}\n`;
      }
    }

    if (skill.prompt) {
      prompt += `\n\n**执行指引:**\n${skill.prompt}`;
    }

    return prompt;
  }
}
