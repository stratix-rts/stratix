/**
 * 增强的模板库
 * 支持按领域分类、标签搜索、Mixin 组合
 */

import * as fs from 'fs';
import * as path from 'path';

import { AgencyAgentsParser } from '../stratix-agent/parsers/AgencyAgentsParser';
import {
  AgentTemplate,
  AgentDomain,
  MixinType,
  DOMAIN_NAMES,
  DOMAIN_DESCRIPTIONS,
} from '../stratix-agent/types/template';
import { StratixAgentConfig, AgentBackendType } from '../stratix-core/stratix-protocol';

export interface TemplateQuery {
  domain?: AgentDomain;
  tags?: string[];
  mixins?: MixinType[];
  searchText?: string;
  limit?: number;
  offset?: number;
}

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  count: number;
  domains?: AgentDomain[];
}

export interface ImportResult {
  imported: number;
  failed: number;
  skipped: number;
  errors: string[];
}

export interface TemplateStats {
  total: number;
  byDomain: Record<string, number>;
  byMixin: Record<string, number>;
}

/**
 * 增强模板库
 */
export class EnhancedTemplateLibrary {
  private templates: Map<string, AgentTemplate> = new Map();
  private categoryIndex: Map<AgentDomain, Set<string>> = new Map();
  private tagIndex: Map<string, Set<string>> = new Map();
  private mixinIndex: Map<MixinType, Set<string>> = new Map();
  private agencyParser: AgencyAgentsParser;
  private dataPath: string;

  constructor(dataPath?: string) {
    this.dataPath = dataPath || path.join(process.cwd(), 'stratix-data', 'templates');
    this.agencyParser = new AgencyAgentsParser();
    this.initializeIndexes();
  }

  /**
   * 初始化索引
   */
  private initializeIndexes(): void {
    const domains: AgentDomain[] = [
      'engineering', 'design', 'paid-media', 'sales', 'marketing',
      'product', 'project-management', 'testing', 'support',
      'spatial-computing', 'specialized', '_mixins'
    ];
    for (const domain of domains) {
      this.categoryIndex.set(domain, new Set());
    }

    const mixins: MixinType[] = ['base', 'resource', 'compliance'];
    for (const mixin of mixins) {
      this.mixinIndex.set(mixin, new Set());
    }
  }

  /**
   * 从 agency-agents 目录导入所有模板
   */
  async importFromDirectory(directoryPath: string): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    try {
      const templates = await this.agencyParser.importDirectory(directoryPath);

      for (const template of templates) {
        try {
          // 跳过 _mixins 目录的模板（它们是模块而非完整 agent）
          if (template.domain === '_mixins') {
            result.skipped++;
            continue;
          }

          // 检查是否已存在
          if (this.templates.has(template.id)) {
            result.skipped++;
            continue;
          }

          this.registerTemplate(template);
          result.imported++;
        } catch (error) {
          result.failed++;
          result.errors.push(`Failed to register ${template.id}: ${error}`);
        }
      }

      console.log(`Import complete: ${result.imported} imported, ${result.skipped} skipped, ${result.failed} failed`);

    } catch (error) {
      result.errors.push(`Failed to import from directory: ${error}`);
    }

    return result;
  }

  /**
   * 导入单个模板
   */
  async importFromFile(filePath: string): Promise<AgentTemplate | null> {
    try {
      const template = await this.agencyParser.parseFile(filePath);
      this.registerTemplate(template);
      return template;
    } catch (error) {
      console.error(`Failed to import ${filePath}:`, error);
      return null;
    }
  }

  /**
   * 注册模板
   */
  registerTemplate(template: AgentTemplate): void {
    this.templates.set(template.id, template);

    // 更新领域索引
    const domainSet = this.categoryIndex.get(template.domain);
    if (domainSet) {
      domainSet.add(template.id);
    }

    // 更新标签索引
    for (const tag of template.tags) {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set());
      }
      this.tagIndex.get(tag)!.add(template.id);
    }

    // 更新 mixin 索引
    for (const mixin of template.mixins) {
      const mixinSet = this.mixinIndex.get(mixin);
      if (mixinSet) {
        mixinSet.add(template.id);
      }
    }
  }

  /**
   * 取消注册模板
   */
  unregisterTemplate(templateId: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;

    this.templates.delete(templateId);

    // 从领域索引移除
    this.categoryIndex.get(template.domain)?.delete(templateId);

    // 从标签索引移除
    for (const tag of template.tags) {
      this.tagIndex.get(tag)?.delete(templateId);
    }

    // 从 mixin 索引移除
    for (const mixin of template.mixins) {
      this.mixinIndex.get(mixin)?.delete(templateId);
    }

    return true;
  }

  /**
   * 查询模板
   */
  query(query: TemplateQuery): AgentTemplate[] {
    let results = Array.from(this.templates.values());

    // 按领域过滤
    if (query.domain) {
      const domainIds = this.categoryIndex.get(query.domain);
      if (domainIds) {
        results = results.filter(t => domainIds.has(t.id));
      }
    }

    // 按标签过滤
    if (query.tags && query.tags.length > 0) {
      results = results.filter(t =>
        query.tags!.some(tag =>
          t.tags.map(tg => tg.toLowerCase()).includes(tag.toLowerCase())
        )
      );
    }

    // 按 mixin 过滤
    if (query.mixins && query.mixins.length > 0) {
      results = results.filter(t =>
        query.mixins!.some(mixin => t.mixins.includes(mixin))
      );
    }

    // 全文搜索
    if (query.searchText) {
      const searchLower = query.searchText.toLowerCase();
      results = results.filter(t =>
        t.name.toLowerCase().includes(searchLower) ||
        t.description.toLowerCase().includes(searchLower) ||
        t.identity.toLowerCase().includes(searchLower) ||
        t.mission.toLowerCase().includes(searchLower) ||
        t.tags.some(tag => tag.toLowerCase().includes(searchLower)) ||
        t.id.toLowerCase().includes(searchLower)
      );
    }

    // 分页
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    return results.slice(offset, offset + limit);
  }

  /**
   * 获取所有模板
   */
  getAllTemplates(): AgentTemplate[] {
    return Array.from(this.templates.values());
  }

  /**
   * 获取模板
   */
  getTemplate(id: string): AgentTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 获取模板数量
   */
  getCount(): number {
    return this.templates.size;
  }

  /**
   * 获取按领域分组的模板
   */
  getTemplatesByDomain(): Map<AgentDomain, AgentTemplate[]> {
    const result = new Map<AgentDomain, AgentTemplate[]>();

    for (const [domain, ids] of this.categoryIndex) {
      const templates = Array.from(ids)
        .map(id => this.templates.get(id))
        .filter((t): t is AgentTemplate => t !== undefined);
      result.set(domain, templates);
    }

    return result;
  }

  /**
   * 获取所有分类
   */
  getCategories(): TemplateCategory[] {
    const categories: TemplateCategory[] = [];

    for (const [domain, ids] of this.categoryIndex) {
      if (ids.size === 0) continue;

      categories.push({
        id: domain,
        name: DOMAIN_NAMES[domain] || domain,
        description: DOMAIN_DESCRIPTIONS[domain] || '',
        count: ids.size,
        domains: [domain],
      });
    }

    return categories.sort((a, b) => b.count - a.count);
  }

  /**
   * 获取推荐模板
   */
  getRecommendations(context: {
    recentSkills?: string[];
    recentDomains?: AgentDomain[];
    userPreferences?: string[];
  }): AgentTemplate[] {
    const scored = Array.from(this.templates.values()).map(template => {
      let score = 0;

      // 匹配最近使用的领域
      if (context.recentDomains?.includes(template.domain)) {
        score += 10;
      }

      // 匹配用户偏好标签
      if (context.userPreferences) {
        score += template.tags.filter(tag =>
          context.userPreferences!.map(p => p.toLowerCase()).includes(tag.toLowerCase())
        ).length;
      }

      // 热门标签权重
      const popularTags = ['typescript', 'react', 'node', 'api', 'database', 'python', 'aws', 'docker'];
      score += template.tags.filter(tag => popularTags.includes(tag.toLowerCase())).length * 2;

      return { template, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(s => s.template);
  }

  /**
   * 获取统计信息
   */
  getStats(): TemplateStats {
    const byDomain: Record<string, number> = {};
    const byMixin: Record<string, number> = {};

    for (const [domain, ids] of this.categoryIndex) {
      byDomain[domain] = ids.size;
    }

    for (const [mixin, ids] of this.mixinIndex) {
      byMixin[mixin] = ids.size;
    }

    return {
      total: this.templates.size,
      byDomain,
      byMixin,
    };
  }

  /**
   * 搜索相似模板
   */
  findSimilar(templateId: string, limit: number = 5): AgentTemplate[] {
    const template = this.templates.get(templateId);
    if (!template) return [];

    const scored = Array.from(this.templates.values())
      .filter(t => t.id !== templateId)
      .map(t => {
        let score = 0;

        // 相同领域
        if (t.domain === template.domain) score += 5;

        // 共同标签
        const commonTags = t.tags.filter(tag =>
          template.tags.map(tg => tg.toLowerCase()).includes(tag.toLowerCase())
        );
        score += commonTags.length * 2;

        // 共同 mixin
        const commonMixins = t.mixins.filter(m => template.mixins.includes(m));
        score += commonMixins.length;

        return { template: t, score };
      });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.template);
  }

  /**
   * 将 AgentTemplate 转换为 StratixAgentConfig
   */
  toAgentConfig(template: AgentTemplate, name?: string): StratixAgentConfig {
    return {
      agentId: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || template.name,
      type: this.domainToAgentType(template.domain),
      profile: {
        characterId: template.id,
        name: template.name,
        bodyType: 'male',
        parts: {},
      },
      backendType: 'stratix' as AgentBackendType,
      configStatus: 'draft',
      soul: {
        identity: template.identity,
        goals: template.workflows.map(w => w.name),
        personality: template.personality,
      },
      memory: { shortTerm: [], longTerm: [], context: '' },
      skills: template.skills.map(s => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        parameters: s.parameters.map(p => ({
          paramId: p.name,
          name: p.name,
          type: p.type === 'array' ? 'object' : p.type,
          required: p.required,
          defaultValue: p.defaultValue,
        })),
      })),
      rules: template.rules.map(r => r.rule),
      stratixConfig: {
        provider: 'anthropic',
        model: 'claude-3-sonnet-20240229',
        temperature: 0.7,
      },
    };
  }

  /**
   * 从 StratixAgentConfig 创建模板
   */
  fromAgentConfig(config: StratixAgentConfig): AgentTemplate {
    return {
      id: config.agentId,
      name: config.name,
      version: '1.0.0',
      description: '',
      domain: this.agentTypeToDomain(config.type),
      tags: [config.type],
      mixins: ['base'],
      identity: config.soul?.identity || '',
      personality: config.soul?.personality || '',
      tone: '',
      mission: config.soul?.goals?.join(' ') || '',
      workflows: [],
      rules: (config.rules || []).map((r, i) => ({
        id: `rule-${i}`,
        priority: 'medium' as const,
        rule: r,
      })),
      constraints: [],
      forbiddenActions: [],
      skills: (config.skills || []).map(s => ({
        skillId: s.skillId,
        name: s.name,
        description: s.description,
        parameters: s.parameters.map(p => ({
          name: p.paramId,
          type: 'string' as const,
          required: false,
          description: '',
        })),
      })),
      workflowSteps: [],
      successMetrics: [],
      metadata: {
        source: 'converted',
        createdAt: new Date().toISOString(),
      },
    };
  }

  /**
   * 保存模板到文件
   */
  async saveToFile(filePath: string): Promise<void> {
    const data = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      templates: Array.from(this.templates.values()),
    };

    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 从文件加载模板
   */
  async loadFromFile(filePath: string): Promise<number> {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.templates && Array.isArray(data.templates)) {
      for (const template of data.templates) {
        this.registerTemplate(template as AgentTemplate);
      }
      return data.templates.length;
    }

    return 0;
  }

  /**
   * 清除所有模板
   */
  clear(): void {
    this.templates.clear();
    this.initializeIndexes();
  }

  /**
   * 获取热门标签
   */
  getPopularTags(limit: number = 20): Array<{ tag: string; count: number }> {
    const tagCounts = new Map<string, number>();

    for (const [tag, ids] of this.tagIndex) {
      tagCounts.set(tag, ids.size);
    }

    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }

  /**
   * 搜索标签
   */
  searchTags(query: string, limit: number = 10): string[] {
    const queryLower = query.toLowerCase();
    return Array.from(this.tagIndex.keys())
      .filter(tag => tag.toLowerCase().includes(queryLower))
      .slice(0, limit);
  }

  /**
   * 领域转 Agent 类型
   */
  private domainToAgentType(domain: AgentDomain): string {
    const mapping: Record<string, string> = {
      'engineering': 'dev',
      'design': 'writer',
      'marketing': 'writer',
      'sales': 'writer',
      'paid-media': 'writer',
      'product': 'analyst',
      'project-management': 'analyst',
      'testing': 'dev',
      'support': 'writer',
      'spatial-computing': 'dev',
      'specialized': 'custom',
      '_mixins': 'custom',
    };
    return mapping[domain] || 'custom';
  }

  /**
   * Agent 类型转领域
   */
  private agentTypeToDomain(type: string): AgentDomain {
    const mapping: Record<string, AgentDomain> = {
      'dev': 'engineering',
      'writer': 'marketing',
      'analyst': 'product',
      'custom': 'specialized',
    };
    return mapping[type] || 'specialized';
  }
}

export default EnhancedTemplateLibrary;
