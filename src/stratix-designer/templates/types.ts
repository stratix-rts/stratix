import { StratixAgentConfig, StratixSkillConfig } from '@/stratix-core/stratix-protocol';

export type HeroType = 'writer' | 'dev' | 'analyst';

export interface HeroTemplateBase {
  getTemplate(agentId?: string): StratixAgentConfig;
  getType(): HeroType;
  getName(): string;
  getDescription(): string;
}

export function generateAgentId(type: HeroType): string {
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `stratix-${id}-${type}`;
}

export function generateSkillId(action: string): string {
  return `stratix-skill-${action}`;
}

export function getHeroColor(type: HeroType | string): string {
  const colors: Record<string, string> = {
    writer: '#3B82F6',
    dev: '#22C55E',
    analyst: '#8B5CF6',
  };
  return colors[type] || '#64748B';
}
