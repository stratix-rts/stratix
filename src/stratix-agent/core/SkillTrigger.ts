import { SkillDefinition, SkillCall } from '../types';

export class SkillTrigger {
  parseSkillCalls(llmResponse: string, availableSkills: SkillDefinition[]): SkillCall[] {
    const calls: SkillCall[] = [];

    const jsonMatch = llmResponse.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed.filter((p: any) => this.isValidSkillCall(p, availableSkills));
      } catch (e) {
        console.warn('[SkillTrigger] Failed to parse JSON skill calls:', e);
      }
    }

    const xmlMatches = Array.from(llmResponse.matchAll(/<skill_call\s+skillId="([^"]+)"[^>]*>([\s\S]*?)<\/skill_call>/g));
    for (const match of xmlMatches) {
      const skillId = match[1];
      if (this.skillExists(skillId, availableSkills)) {
        const params = this.parseXmlParams(match[2]);
        calls.push({ skillId, params });
      }
    }

    const textPatterns = availableSkills.map(s => ({
      skillId: s.skillId,
      pattern: new RegExp(`(?:使用?|调用?|执行?)(${s.name}|${s.skillId})`, 'i')
    }));

    for (const { skillId, pattern } of textPatterns) {
      if (pattern.test(llmResponse)) {
        const params = this.extractParamsFromText(llmResponse, skillId);
        calls.push({ skillId, params });
      }
    }

    return calls;
  }

  private isValidSkillCall(call: any, skills: SkillDefinition[]): boolean {
    return (
      typeof call.skillId === 'string' &&
      this.skillExists(call.skillId, skills) &&
      typeof call.params === 'object'
    );
  }

  private skillExists(skillId: string, skills: SkillDefinition[]): boolean {
    return skills.some(s => s.skillId === skillId);
  }

  private parseXmlParams(xmlContent: string): Record<string, any> {
    const params: Record<string, any> = {};
    const paramMatches = Array.from(xmlContent.matchAll(/<param\s+name="([^"]+)">([^<]+)<\/param>/g));
    for (const match of paramMatches) {
      params[match[1]] = match[2];
    }
    return params;
  }

  private extractParamsFromText(text: string, _skillId: string): Record<string, any> {
    return {};
  }
}
