import { StratixAgentConfig } from '@/stratix-core/stratix-protocol';
import { HeroTemplateBase, HeroType, generateAgentId, generateSkillId } from './types';

export class DevHeroTemplate implements HeroTemplateBase {
  private static readonly TYPE: HeroType = 'dev';
  private static readonly NAME = '开发英雄';
  private static readonly DESCRIPTION = '资深程序员，擅长多种编程语言，能够编写可靠、高效的代码，解决开发中的各类问题';

  getType(): HeroType {
    return DevHeroTemplate.TYPE;
  }

  getName(): string {
    return DevHeroTemplate.NAME;
  }

  getDescription(): string {
    return DevHeroTemplate.DESCRIPTION;
  }

  getTemplate(agentId?: string): StratixAgentConfig {
    const id = agentId || generateAgentId(DevHeroTemplate.TYPE);
    return {
      agentId: id,
      name: DevHeroTemplate.NAME,
      type: DevHeroTemplate.TYPE,
      profile: {
        characterId: id,
        name: DevHeroTemplate.NAME,
        bodyType: 'male',
        parts: {},
      },
      backendType: 'stratix',
      stratixConfig: {
        provider: 'openai',
        model: 'gpt-4',
        temperature: 0.6,
        maxTokens: 4096,
      },
      soul: {
        identity: '资深程序员，擅长多种编程语言，能够编写可靠、高效的代码，解决开发中的各类问题',
        goals: [
          '编写符合需求的代码',
          '调试代码中的bug',
          '优化代码性能',
        ],
        personality: '严谨、细致、高效，善于逻辑分析，快速定位并解决问题',
      },
      memory: {
        shortTerm: [],
        longTerm: [],
        context: '我是 Stratix 星策系统的开发英雄，专注于代码编写与调试。',
      },
      skills: [
        {
          skillId: generateSkillId('write-code'),
          name: '编写代码',
          description: '根据需求，生成指定编程语言的代码，支持注释、格式优化',
          parameters: [
            { paramId: 'demand', name: '开发需求', type: 'string', required: true, defaultValue: '' },
            { paramId: 'language', name: '编程语言', type: 'string', required: true, defaultValue: 'javascript' },
          ],
          prompt: `你是一位资深程序员。请根据以下需求编写代码：

需求：{{demand}}
编程语言：{{language}}

请生成高质量、可读性强、带有必要注释的代码。`,
        },
      ],
      rules: [
        '确保代码可运行、无语法错误',
        '添加必要的注释说明',
        '遵循最佳实践和代码规范',
      ],
      configStatus: 'ready',
    };
  }
}
