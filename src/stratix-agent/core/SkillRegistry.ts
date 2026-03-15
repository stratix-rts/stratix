import { SkillDefinition, SkillExecutor, SkillResult, ExecutionContext } from '../types';

export class SkillRegistry {
  private availableSkills: Map<string, SkillDefinition> = new Map();
  private enabledSkills: Set<string> = new Set();
  private executors: Map<string, SkillExecutor> = new Map();

  registerSkill(skill: SkillDefinition): void {
    this.availableSkills.set(skill.skillId, skill);
  }

  registerSkills(skills: SkillDefinition[]): void {
    skills.forEach(s => this.registerSkill(s));
  }

  enableSkill(skillId: string): boolean {
    if (this.availableSkills.has(skillId)) {
      this.enabledSkills.add(skillId);
      return true;
    }
    return false;
  }

  disableSkill(skillId: string): void {
    this.enabledSkills.delete(skillId);
  }

  getEnabledSkills(): SkillDefinition[] {
    return Array.from(this.enabledSkills)
      .map(id => this.availableSkills.get(id)!)
      .filter(Boolean);
  }

  registerExecutor(name: string, executor: SkillExecutor): void {
    this.executors.set(name, executor);
  }

  async execute(
    skillId: string,
    params: Record<string, any>,
    context: ExecutionContext
  ): Promise<SkillResult> {
    const startTime = Date.now();

    if (!this.enabledSkills.has(skillId)) {
      return {
        success: false,
        skillId,
        error: `Skill ${skillId} is not enabled`,
        executionTime: Date.now() - startTime
      };
    }

    const skill = this.availableSkills.get(skillId);
    if (!skill) {
      return {
        success: false,
        skillId,
        error: `Skill ${skillId} not found`,
        executionTime: Date.now() - startTime
      };
    }

    const validationError = this.validateParams(skill, params);
    if (validationError) {
      return {
        success: false,
        skillId,
        error: validationError,
        executionTime: Date.now() - startTime
      };
    }

    try {
      const executor = this.executors.get(skill.executor);
      if (!executor) {
        throw new Error(`Executor ${skill.executor} not found`);
      }

      const result = await executor.execute(skill, params, context);
      return {
        success: true,
        skillId,
        result,
        executionTime: Date.now() - startTime
      };
    } catch (error) {
      return {
        success: false,
        skillId,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: Date.now() - startTime
      };
    }
  }

  private validateParams(skill: SkillDefinition, params: Record<string, any>): string | null {
    for (const param of skill.parameters) {
      if (param.required && !(param.name in params) && param.default === undefined) {
        return `Missing required parameter: ${param.name}`;
      }
    }
    return null;
  }
}
