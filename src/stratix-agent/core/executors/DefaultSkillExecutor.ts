import { SkillDefinition, SkillExecutor, ExecutionContext } from '../../types';

export class DefaultSkillExecutor implements SkillExecutor {
  async execute(
    skill: SkillDefinition,
    params: Record<string, unknown>,
    _context: ExecutionContext
  ): Promise<any> {
    return {
      skillId: skill.skillId,
      params,
      message: `Skill ${skill.name} executed successfully`,
    };
  }
}
