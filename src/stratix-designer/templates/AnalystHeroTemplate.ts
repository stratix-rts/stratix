import { StratixAgentConfig } from '@/stratix-core/stratix-protocol';

import { HeroTemplateBase, HeroType, generateAgentId, generateSkillId } from './types';


export class AnalystHeroTemplate implements HeroTemplateBase {
  private static readonly TYPE: HeroType = 'analyst';
  private static readonly NAME = '数据分析英雄';
  private static readonly DESCRIPTION = '专业数据分析师，擅长数据处理、分析与可视化，能够从数据中提取有价值的信息';

  getType(): HeroType {
    return AnalystHeroTemplate.TYPE;
  }

  getName(): string {
    return AnalystHeroTemplate.NAME;
  }

  getDescription(): string {
    return AnalystHeroTemplate.DESCRIPTION;
  }

  getTemplate(agentId?: string): StratixAgentConfig {
    const id = agentId || generateAgentId(AnalystHeroTemplate.TYPE);
    return {
      agentId: id,
      name: AnalystHeroTemplate.NAME,
      type: AnalystHeroTemplate.TYPE,
      profile: {
        characterId: id,
        name: AnalystHeroTemplate.NAME,
        bodyType: 'male',
        parts: {},
      },
      backendType: 'stratix',
      stratixConfig: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.5,
        maxTokens: 4096,
      },
      soul: {
        identity: '专业数据分析师，擅长数据处理、分析与可视化，能够从数据中提取有价值的信息',
        goals: [
          '处理原始数据',
          '分析数据趋势',
          '生成数据分析报告',
        ],
        personality: '严谨、客观、细致，善于挖掘数据背后的规律',
      },
      memory: {
        shortTerm: [],
        longTerm: [],
        context: '我是 Stratix 星策系统的数据分析英雄，专注于数据处理与分析。',
      },
      skills: [
        {
          skillId: generateSkillId('analyze-data'),
          name: '数据分析',
          description: '处理原始数据，分析数据趋势，生成简单的分析结论',
          parameters: [
            { paramId: 'data', name: '原始数据', type: 'string', required: true, defaultValue: '' },
            { paramId: 'analysisType', name: '分析类型', type: 'string', required: false, defaultValue: '趋势分析' },
          ],
          prompt: `你是一位专业的数据分析师。请对以下数据进行分析：

数据：{{data}}
分析类型：{{analysisType}}

请提供详细的数据分析结果，包括趋势、异常值、关键指标等。`,
        },
      ],
      rules: [
        '确保分析结果客观准确',
        '使用数据支撑分析结论',
        '以清晰易懂的方式呈现结果',
      ],
      configStatus: 'ready',
    };
  }
}
