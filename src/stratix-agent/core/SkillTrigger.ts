import { SkillDefinition, SkillCall } from '../types';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[SkillTrigger] ${message}`, ctx || '');
}

export class SkillTrigger {
  parseSkillCalls(llmResponse: string, availableSkills: SkillDefinition[]): SkillCall[] {
    const calls: SkillCall[] = [];

    const jsonMatch = llmResponse.match(/```json\s*(\[[\s\S]*?\])\s*```/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        return parsed.filter((p: unknown) => this.isValidSkillCall(p, availableSkills));
      } catch (e) {
        log('warn', 'Failed to parse JSON skill calls', { error: String(e) });
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

  private isValidSkillCall(call: unknown, skills: SkillDefinition[]): boolean {
    if (!call || typeof call !== 'object') return false;
    const c = call as Record<string, unknown>;
    const skillId = c.skillId;
    const params = c.params;
    return (
      typeof skillId === 'string' &&
      this.skillExists(skillId, skills) &&
      (params === undefined || params === null || typeof params === 'object')
    );
  }

  private skillExists(skillId: string, skills: SkillDefinition[]): boolean {
    return skills.some(s => s.skillId === skillId);
  }

  private parseXmlParams(xmlContent: string): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    const paramMatches = Array.from(xmlContent.matchAll(/<param\s+name="([^"]+)">([^<]+)<\/param>/g));
    for (const match of paramMatches) {
      params[match[1]] = match[2];
    }
    return params;
  }

  private extractParamsFromText(_text: string, _skillId: string): Record<string, unknown> {
    return {};
  }
}
