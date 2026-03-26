/**
 * SkillHub 技能配置
 * 共享技能库的预定义技能
 */

export interface SkillHubSkill {
  skillId: string;
  name: string;
  description: string;
  category: SkillCategory;
  icon?: string;
  mcpTool?: string;
  endpoint?: string;
  provider: 'skillhub' | 'builtin' | 'learned';
  keywords?: string[];
}

export type SkillCategory = 'file' | 'code' | 'data' | 'content' | 'mcp' | 'collab';

export const SKILL_CATEGORY_CONFIG: Record<SkillCategory, { name: string; icon: string; color: string }> = {
  file: { name: '文件处理', icon: '📁', color: 'var(--ds-brand-primary)' },
  code: { name: '代码开发', icon: '💻', color: 'var(--ds-status-success)' },
  data: { name: '数据处理', icon: '📊', color: 'var(--ds-status-info)' },
  content: { name: '内容创作', icon: '✍️', color: 'var(--ds-brand-secondary)' },
  mcp: { name: '联网能力', icon: '🌐', color: 'var(--ds-status-warning)' },
  collab: { name: '协作能力', icon: '🤝', color: 'var(--ds-status-danger)' },
};

// 内置技能库
export const SKILLHUB_SKILLS: SkillHubSkill[] = [
  // File 类别
  {
    skillId: 'zone_file_read',
    name: '文件读取',
    description: '读取 Zone 内的文件内容',
    category: 'file',
    mcpTool: 'filesystem_read',
    provider: 'builtin',
    keywords: ['read', 'file', 'zone', '读取'],
  },
  {
    skillId: 'zone_file_write',
    name: '文件写入',
    description: '写入内容到 Zone 文件',
    category: 'file',
    mcpTool: 'filesystem_write',
    provider: 'builtin',
    keywords: ['write', 'file', 'zone', '写入', '保存'],
  },
  {
    skillId: 'zone_file_list',
    name: '文件列表',
    description: '列出 Zone 目录下的文件',
    category: 'file',
    mcpTool: 'filesystem_list',
    provider: 'builtin',
    keywords: ['list', 'file', 'zone', '目录', '列出'],
  },

  // Code 类别
  {
    skillId: 'code_generate',
    name: '代码生成',
    description: '根据需求生成代码',
    category: 'code',
    mcpTool: 'code_execute',
    provider: 'builtin',
    keywords: ['code', 'generate', '生成', '编程'],
  },
  {
    skillId: 'code_review',
    name: '代码审查',
    description: '审查代码质量并提供建议',
    category: 'code',
    provider: 'builtin',
    keywords: ['code', 'review', '审查', '质量'],
  },
  {
    skillId: 'code_debug',
    name: '代码调试',
    description: '定位和修复代码问题',
    category: 'code',
    provider: 'builtin',
    keywords: ['code', 'debug', '调试', '修复', 'bug'],
  },

  // Data 类别
  {
    skillId: 'data_process',
    name: '数据处理',
    description: '处理和分析结构化数据',
    category: 'data',
    provider: 'builtin',
    keywords: ['data', 'process', '分析', '处理'],
  },
  {
    skillId: 'data_transform',
    name: '数据转换',
    description: '不同格式之间的数据转换',
    category: 'data',
    provider: 'builtin',
    keywords: ['data', 'transform', '转换', '格式'],
  },
  {
    skillId: 'data_visualize',
    name: '数据可视化',
    description: '生成图表和数据可视化',
    category: 'data',
    provider: 'builtin',
    keywords: ['data', 'visualize', '图表', '可视化'],
  },

  // Content 类别
  {
    skillId: 'content_create',
    name: '内容创作',
    description: '创建文案和文档',
    category: 'content',
    provider: 'builtin',
    keywords: ['content', 'create', '创作', '文案', '文档'],
  },
  {
    skillId: 'content_edit',
    name: '内容编辑',
    description: '编辑和修改现有内容',
    category: 'content',
    provider: 'builtin',
    keywords: ['content', 'edit', '编辑', '修改'],
  },
  {
    skillId: 'content_translate',
    name: '内容翻译',
    description: '多语言内容翻译',
    category: 'content',
    provider: 'builtin',
    keywords: ['content', 'translate', '翻译', '语言'],
  },

  // MCP 类别
  {
    skillId: 'web_search',
    name: '联网搜索',
    description: '搜索互联网获取信息',
    category: 'mcp',
    mcpTool: 'web_search',
    provider: 'builtin',
    keywords: ['web', 'search', '搜索', '联网', '互联网'],
  },
  {
    skillId: 'web_fetch',
    name: '网页抓取',
    description: '获取指定网页内容',
    category: 'mcp',
    mcpTool: 'web_fetch',
    provider: 'builtin',
    keywords: ['web', 'fetch', '抓取', '网页', 'url'],
  },
  {
    skillId: 'api_call',
    name: 'API 调用',
    description: '调用外部 API 接口',
    category: 'mcp',
    provider: 'builtin',
    keywords: ['api', 'call', '调用', '接口', 'http'],
  },

  // Collab 类别
  {
    skillId: 'zone_communicate',
    name: 'Zone 通信',
    description: '与同 Zone 的 Agent 协作',
    category: 'collab',
    mcpTool: 'agent_message',
    provider: 'builtin',
    keywords: ['zone', 'communicate', '通信', '协作', 'agent'],
  },
  {
    skillId: 'task_delegate',
    name: '任务委托',
    description: '将任务委托给其他 Agent',
    category: 'collab',
    provider: 'builtin',
    keywords: ['task', 'delegate', '委托', '分配'],
  },
  {
    skillId: 'progress_report',
    name: '进度汇报',
    description: '向用户或上级汇报工作进度',
    category: 'collab',
    provider: 'builtin',
    keywords: ['progress', 'report', '汇报', '进度'],
  },
];

// 进化提示词模板
export const EVOLUTION_PROMPT = `你是一个持续成长的 Agent。在完成任务时：

1. 发现自身技能不足时，使用 find-skills 搜索 SkillHub 上可能帮助你的技能
2. 学习新技能后，更新你的能力描述
3. 将新学会的技能添加到你的技能列表中
4. 定期反思工作过程，寻找可改进的地方`;
