/**
 * Agency Agents 模板配置
 *
 * 懒加载实现：
 * - 默认只导出元数据（无 rawContent）
 * - 完整内容按需加载（用户点击时才加载）
 * - 使用 Promise 缓存已加载的模板内容
 */

import agencyAgentsData from '@/stratix-data/agency-agents.json';

import type { SoulTemplate } from './soulTemplates';


// Domain mapping from agency-agents to our domain names
const DOMAIN_NAMES: Record<string, string> = {
  engineering: '工程开发',
  design: '设计',
  marketing: '市场营销',
  sales: '销售',
  product: '产品管理',
  'project-management': '项目管理',
  testing: '测试',
  support: '客户支持',
  academic: '学术研究',
  'game-development': '游戏开发',
  'paid-media': '付费媒体',
  specialized: '专业领域',
  'spatial-computing': '空间计算',
};

interface AgencyAgentJSON {
  id: string;
  name: string;
  description: string;
  domain: string;
  color: string;
  emoji: string;
  vibe: string;
  slug: string;
  sections: {
    soul: string[];
    agents: string[];
  };
  filePath: string;
}

interface AgencyAgentsData {
  generatedAt: string;
  version: string;
  domains: string[];
  totalAgents: number;
  agents: AgencyAgentJSON[];
}

// 懒加载：轻量级模板（不含 rawContent）
export interface LightweightSoulTemplate {
  id: string;
  name: string;
  description: string;
  domain: string;
  source: 'agency';
  emoji: string;
  color: string;
  vibe: string;
  isLoaded: boolean;
}

// 全量模板缓存（懒加载后填充）
interface FullSoulTemplate extends SoulTemplate {
  isLoaded: true;
  emoji: string;
  color: string;
  vibe: string;
}

// 内容加载缓存
const contentCache = new Map<string, Promise<FullSoulTemplate>>();

/**
 * 获取轻量级模板列表（不含 rawContent）
 */
export function getLightweightAgencyTemplates(): LightweightSoulTemplate[] {
  const data = agencyAgentsData as AgencyAgentsData;
  return data.agents.map(agent => ({
    id: `agency-${agent.id}`,
    name: `${agent.emoji} ${agent.name}`,
    description: agent.description,
    domain: agent.domain,
    source: 'agency' as const,
    emoji: agent.emoji,
    color: agent.color,
    vibe: agent.vibe,
    isLoaded: false,
  }));
}

/**
 * 按 domain 分组获取轻量级模板
 */
export function getLightweightAgencyTemplatesByDomain(): Map<string, LightweightSoulTemplate[]> {
  const templates = getLightweightAgencyTemplates();
  const grouped = new Map<string, LightweightSoulTemplate[]>();

  for (const t of templates) {
    const domain = t.domain || 'general';
    if (!grouped.has(domain)) {
      grouped.set(domain, []);
    }
    grouped.get(domain)!.push(t);
  }

  return grouped;
}

/**
 * 按需加载完整模板内容
 */
export function loadAgencyTemplate(id: string): Promise<FullSoulTemplate> {
  // 检查缓存
  if (contentCache.has(id)) {
    return contentCache.get(id)!;
  }

  // 懒加载：查找模板并生成完整内容
  const data = agencyAgentsData as AgencyAgentsData;
  const agent = data.agents.find(a => `agency-${a.id}` === id);

  if (!agent) {
    return Promise.reject(new Error(`Template ${id} not found`));
  }

  const allSections = [...agent.sections.soul, ...agent.sections.agents];
  const rawContent = allSections.join('\n\n');

  const fullTemplate: FullSoulTemplate = {
    id: `agency-${agent.id}`,
    name: `${agent.emoji} ${agent.name}`,
    description: agent.description,
    domain: agent.domain,
    source: 'agency',
    emoji: agent.emoji,
    color: agent.color,
    vibe: agent.vibe,
    rawContent: rawContent,
    soul: {
      identity: '',
      goals: [],
      personality: '',
    },
    evolutionPrompt: undefined,
    recommendedSkills: [],
    isLoaded: true,
  };

  const promise = Promise.resolve(fullTemplate);
  contentCache.set(id, promise);
  return promise;
}

/**
 * 预加载多个模板（批量）
 */
export function preloadAgencyTemplates(ids: string[]): Promise<FullSoulTemplate[]> {
  return Promise.all(ids.map(id => loadAgencyTemplate(id)));
}

/**
 * 清除缓存
 */
export function clearAgencyTemplateCache(): void {
  contentCache.clear();
}

/**
 * Get domain display name
 */
export function getDomainDisplayName(domain: string): string {
  return DOMAIN_NAMES[domain] || domain;
}

/**
 * All domain names
 */
export const AGENCY_DOMAIN_NAMES = DOMAIN_NAMES;
