import type { WorkflowPreset } from '../types';

export const codeReviewPreset: WorkflowPreset = {
  id: 'code-review',
  name: '代码审查流程',
  description: '多个角度审查代码：安全、性能、最佳实践',
  category: 'automation',
  icon: '🔍',
  definition: {
    properties: {
      name: '代码审查',
      description: '多角度代码审查工作流',
    },
    sequence: [
      {
        id: 'security-reviewer',
        componentType: 'task',
        type: 'llm',
        name: '安全审查',
        properties: {
          role: 'security-reviewer',
          systemPrompt: '你是安全审查专家。检查代码中的安全漏洞、SQL注入、XSS等风险。',
        },
      },
      {
        id: 'performance-reviewer',
        componentType: 'task',
        type: 'llm',
        name: '性能审查',
        properties: {
          role: 'performance-reviewer',
          systemPrompt: '你是性能优化专家。分析代码的时间复杂度、内存使用和优化机会。',
        },
      },
      {
        id: 'best-practice-reviewer',
        componentType: 'task',
        type: 'llm',
        name: '最佳实践审查',
        properties: {
          role: 'best-practice-reviewer',
          systemPrompt: '你是代码规范专家。检查代码风格、命名规范、设计模式应用。',
        },
      },
      {
        id: 'final-reviewer',
        componentType: 'task',
        type: 'llm',
        name: '综合评估',
        properties: {
          role: 'final-reviewer',
          systemPrompt: '整合所有审查结果，提供最终的代码评估报告和改进建议。',
        },
      },
    ],
  },
};
