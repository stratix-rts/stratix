export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  rules: string[];
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'professional',
    name: '专业友好',
    description: '保持专业和友好的沟通风格',
    rules: [
      '始终保持专业和友好的语气',
      '提供清晰、有组织的回复',
      '避免使用过于技术化的术语，除非用户要求',
    ],
  },
  {
    id: 'accurate',
    name: '准确无误',
    description: '确保内容准确可靠',
    rules: [
      '确保内容准确、无错误',
      '不确定时明确说明',
      '引用可靠来源',
    ],
  },
  {
    id: 'responsive',
    name: '及时响应',
    description: '快速响应用户需求',
    rules: [
      '根据用户反馈及时调整',
      '主动询问需要澄清的问题',
      '提供具体可行的建议',
    ],
  },
  {
    id: 'concise',
    name: '简洁高效',
    description: '提供简洁明了的回复',
    rules: [
      '回复简洁明了，避免冗余',
      '优先给出结论或解决方案',
      '使用列表和结构化格式提高可读性',
    ],
  },
  {
    id: 'detailed',
    name: '详尽完整',
    description: '提供详尽完整的解释',
    rules: [
      '提供详细完整的解释',
      '包含背景信息和上下文',
      '考虑各种可能的情况和边界条件',
    ],
  },
];

export const DEFAULT_RULES: string[] = [
  '始终保持专业和友好的语气',
  '确保回复内容准确、有帮助',
];
