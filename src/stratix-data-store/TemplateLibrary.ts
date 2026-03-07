import { StratixAgentConfig } from '../stratix-core/stratix-protocol';
import { StratixDataStore } from './StratixDataStore';

const PRESET_TEMPLATES: StratixAgentConfig[] = [
  {
    agentId: 'stratix-template-writer',
    name: '文案英雄（模板）',
    type: 'writer',
    profile: {
      characterId: 'template-writer',
      name: '文案英雄',
      bodyType: 'male',
      parts: {},
    },
    backendType: 'openclaw',
    configStatus: 'draft',
    soul: {
      identity: '专业文案创作者，擅长各类文案撰写，语言生动、贴合主题',
      goals: ['快速生成高质量文案', '优化文案语言', '保持文案风格统一'],
      personality: '细心、高效、有创意'
    },
    memory: { shortTerm: [], longTerm: [], context: '' },
    skills: [
      {
        skillId: 'stratix-skill-write-article',
        name: '快速写文案',
        description: '根据主题生成文案',
        parameters: [
          { paramId: 'topic', name: '文案主题', type: 'string', required: true, defaultValue: '' },
          { paramId: 'wordCount', name: '字数', type: 'number', required: true, defaultValue: 500 },
          { paramId: 'tone', name: '语气', type: 'string', required: false, defaultValue: '正式' }
        ],
        executeScript: '{"action":"generate_content","params":{"prompt":"{{topic}}","wordCount":{{wordCount}},"tone":"{{tone}}"}}'
      },
      {
        skillId: 'stratix-skill-optimize-article',
        name: '文案优化',
        description: '优化已有文案',
        parameters: [
          { paramId: 'content', name: '原有文案', type: 'string', required: true, defaultValue: '' },
          { paramId: 'optimizeType', name: '优化类型', type: 'string', required: false, defaultValue: '可读性优化' }
        ],
        executeScript: '{"action":"optimize_content","params":{"content":"{{content}}","optimizeType":"{{optimizeType}}"}}'
      }
    ],
    directConfig: { provider: 'openai', model: 'claude-3-sonnet', temperature: 0.7 },
    openClawConfig: { accountId: '', endpoint: 'http://localhost:8000' }
  },
  {
    agentId: 'stratix-template-dev',
    name: '开发英雄（模板）',
    type: 'dev',
    profile: {
      characterId: 'template-dev',
      name: '开发英雄',
      bodyType: 'male',
      parts: {},
    },
    backendType: 'openclaw',
    configStatus: 'draft',
    soul: {
      identity: '资深程序员，擅长多种编程语言，编写可靠高效的代码',
      goals: ['编写符合需求的代码', '调试和修复bug', '优化代码性能'],
      personality: '严谨、细致、高效'
    },
    memory: { shortTerm: [], longTerm: [], context: '' },
    skills: [
      {
        skillId: 'stratix-skill-write-code',
        name: '编写代码',
        description: '根据需求生成代码',
        parameters: [
          { paramId: 'demand', name: '开发需求', type: 'string', required: true, defaultValue: '' },
          { paramId: 'language', name: '编程语言', type: 'string', required: true, defaultValue: 'javascript' }
        ],
        executeScript: '{"action":"generate_code","params":{"demand":"{{demand}}","language":"{{language}}"}}'
      }
    ],
    directConfig: { provider: 'openai', model: 'gpt-4o', temperature: 0.6 },
    openClawConfig: { accountId: '', endpoint: 'http://localhost:8000' }
  },
  {
    agentId: 'stratix-template-analyst',
    name: '数据分析英雄（模板）',
    type: 'analyst',
    profile: {
      characterId: 'template-analyst',
      name: '数据分析英雄',
      bodyType: 'male',
      parts: {},
    },
    backendType: 'openclaw',
    configStatus: 'draft',
    soul: {
      identity: '专业数据分析师，擅长数据处理、分析与可视化',
      goals: ['处理原始数据', '分析数据趋势', '生成分析报告'],
      personality: '严谨、客观、细致'
    },
    memory: { shortTerm: [], longTerm: [], context: '' },
    skills: [
      {
        skillId: 'stratix-skill-analyze-data',
        name: '数据分析',
        description: '分析数据并生成结论',
        parameters: [
          { paramId: 'data', name: '数据', type: 'string', required: true, defaultValue: '' },
          { paramId: 'analysisType', name: '分析类型', type: 'string', required: false, defaultValue: '趋势分析' }
        ],
        executeScript: '{"action":"analyze_data","params":{"data":"{{data}}","analysisType":"{{analysisType}}"}}'
      }
    ],
    directConfig: { provider: 'openai', model: 'claude-3-opus', temperature: 0.5 },
    openClawConfig: { accountId: '', endpoint: 'http://localhost:8000' }
  }
];

export class TemplateLibrary {
  private dataStore: StratixDataStore;

  constructor(dataStore: StratixDataStore) {
    this.dataStore = dataStore;
  }

  public async initialize(): Promise<void> {
    await this.dataStore.setPresetTemplates(PRESET_TEMPLATES);
  }

  public getPresetTemplates(): StratixAgentConfig[] {
    return PRESET_TEMPLATES.map(t => ({ ...t }));
  }

  public getPresetTemplateByType(type: 'writer' | 'dev' | 'analyst'): StratixAgentConfig | null {
    return PRESET_TEMPLATES.find(t => t.type === type) || null;
  }

  public async getCustomTemplates(): Promise<StratixAgentConfig[]> {
    const templates = await this.dataStore.listTemplates();
    return templates.custom;
  }

  public async getAllTemplates(): Promise<{ preset: StratixAgentConfig[]; custom: StratixAgentConfig[] }> {
    return this.dataStore.listTemplates();
  }

  public async saveCustomTemplate(config: StratixAgentConfig): Promise<void> {
    await this.dataStore.saveCustomTemplate(config);
  }

  public async deleteCustomTemplate(agentId: string): Promise<boolean> {
    return this.dataStore.deleteCustomTemplate(agentId);
  }

  public generateId(): string {
    return `stratix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  public createFromTemplate(
    templateType: 'writer' | 'dev' | 'analyst',
    name?: string
  ): StratixAgentConfig | null {
    const template = this.getPresetTemplateByType(templateType);
    if (!template) return null;

    return {
      ...template,
      agentId: this.generateId(),
      name: name || template.name.replace('（模板）', ''),
      openClawConfig: template.openClawConfig ? { ...template.openClawConfig, accountId: '' } : undefined
    };
  }
}
