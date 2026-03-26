/**
 * Agency Agents 模板配置
 *
 * 直接加载 JSON 中的 rawContent，不做解析提取
 * rawContent = soul sections + agents sections 的完整 markdown
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

/**
 * Convert agency agent JSON to SoulTemplate
 * 直接拼接 rawContent，不解析提取
 */
function agencyToSoulTemplate(agent: AgencyAgentJSON): SoulTemplate {
  // 直接拼接所有 sections 作为 rawContent
  const allSections = [...agent.sections.soul, ...agent.sections.agents];
  const rawContent = allSections.join('\n\n');

  return {
    id: `agency-${agent.id}`,
    name: `${agent.emoji} ${agent.name}`,
    description: agent.description,
    domain: agent.domain,
    source: 'agency',
    // rawContent 存储完整原文，用户可编辑
    rawContent: rawContent,
    // soul 字段保留但为空，用户可在编辑态填充
    soul: {
      identity: '',
      goals: [],
      personality: '',
    },
    // evolutionPrompt 使用默认
    evolutionPrompt: undefined,
    recommendedSkills: [],
  };
}

/**
 * Get all agency templates
 */
export function getAgencySoulTemplates(): SoulTemplate[] {
  const data = agencyAgentsData as AgencyAgentsData;
  return data.agents.map(agencyToSoulTemplate);
}

/**
 * Get agency templates grouped by domain
 */
export function getAgencyTemplatesByDomain(): Map<string, SoulTemplate[]> {
  const templates = getAgencySoulTemplates();
  const grouped = new Map<string, SoulTemplate[]>();

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
 * Get domain display name
 */
export function getDomainDisplayName(domain: string): string {
  return DOMAIN_NAMES[domain] || domain;
}

/**
 * All domain names
 */
export const AGENCY_DOMAIN_NAMES = DOMAIN_NAMES;
