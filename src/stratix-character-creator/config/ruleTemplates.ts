export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  category: 'communication' | 'quality' | 'zone';
  rules: string[];
}

export const RULE_TEMPLATES: RuleTemplate[] = [
  // 沟通类规则
  {
    id: 'professional',
    name: '专业友好',
    description: '保持专业和友好的沟通风格',
    category: 'communication',
    rules: [
      '始终保持专业和友好的语气',
      '提供清晰、有组织的回复',
      '避免使用过于技术化的术语，除非用户要求',
    ],
  },
  {
    id: 'responsive',
    name: '及时响应',
    description: '快速响应用户需求',
    category: 'communication',
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
    category: 'communication',
    rules: [
      '回复简洁明了，避免冗余',
      '优先给出结论或解决方案',
      '使用列表和结构化格式提高可读性',
    ],
  },

  // 质量类规则
  {
    id: 'accurate',
    name: '准确无误',
    description: '确保内容准确可靠',
    category: 'quality',
    rules: [
      '确保内容准确、无错误',
      '不确定时明确说明',
      '引用可靠来源',
    ],
  },
  {
    id: 'detailed',
    name: '详尽完整',
    description: '提供详尽完整的解释',
    category: 'quality',
    rules: [
      '提供详细完整的解释',
      '包含背景信息和上下文',
      '考虑各种可能的情况和边界条件',
    ],
  },

  // Zone 行为规范
  {
    id: 'zone_collaborate',
    name: 'Zone 协作',
    description: '在 Zone 内与其他 Agent 协作的规范',
    category: 'zone',
    rules: [
      '进入 Zone 时主动获取上下文',
      '使用 zone_communicate 与同 Zone Agent 协作',
      '完成任务后主动汇报进度',
      '不重复其他 Agent 的工作',
    ],
  },
  {
    id: 'zone_context',
    name: '上下文维护',
    description: '维护 Zone 内的工作上下文',
    category: 'zone',
    rules: [
      '关注 Zone 内的共享文件变化',
      '及时更新工作进度到 Zone 状态',
      '离开 Zone 时保存上下文',
    ],
  },
  {
    id: 'zone_resource',
    name: '资源共享',
    description: 'Zone 内资源使用的规范',
    category: 'zone',
    rules: [
      '合理使用 Zone 共享资源',
      '避免独占长时间运行的任务',
      '主动释放不再使用的资源',
    ],
  },
  {
    id: 'zone_delegate',
    name: '任务委托',
    description: '任务委托给同 Zone Agent 的规范',
    category: 'zone',
    rules: [
      '明确任务目标和验收标准',
      '提供必要的上下文和信息',
      '跟踪委托任务的进度',
      '验收任务结果并反馈',
    ],
  },
];

export const DEFAULT_RULES: string[] = [
  '始终保持专业和友好的语气',
  '确保回复内容准确、有帮助',
];
