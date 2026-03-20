import type { WorkflowPreset } from '../types';

export const multiAgentChatPreset: WorkflowPreset = {
  id: 'multi-agent-chat',
  name: '多 Agent 协作讨论',
  description: '多个专业 Agent 并行处理任务后汇总结果',
  category: 'multi-agent',
  icon: '👥',
  definition: {
    properties: {
      name: '多 Agent 协作',
      description: '协调者分配任务，专家并行处理，汇总者整合结果',
    },
    sequence: [
      {
        id: 'coordinator',
        componentType: 'task',
        type: 'llm',
        name: '协调者',
        properties: {
          role: 'coordinator',
          systemPrompt: '你是一个协调者。分析用户请求，将其分解为子任务，分配给合适的专家处理。',
          temperature: 0.3,
        },
      },
      {
        id: 'parallel-experts',
        componentType: 'parallel',
        type: 'parallel',
        name: '专家并行处理',
        properties: {},
        sequences: [
          [
            {
              id: 'researcher',
              componentType: 'task',
              type: 'llm',
              name: '研究员',
              properties: {
                role: 'researcher',
                systemPrompt: '你是一个研究员。根据分配的任务，收集和分析相关信息。',
              },
            },
          ],
          [
            {
              id: 'analyst',
              componentType: 'task',
              type: 'llm',
              name: '分析师',
              properties: {
                role: 'analyst',
                systemPrompt: '你是一个分析师。对数据进行深入分析，提供见解和建议。',
              },
            },
          ],
          [
            {
              id: 'writer',
              componentType: 'task',
              type: 'llm',
              name: '撰写者',
              properties: {
                role: 'writer',
                systemPrompt: '你是一个撰写者。根据提供的信息，生成清晰、有吸引力的内容。',
              },
            },
          ],
        ],
      },
      {
        id: 'summarizer',
        componentType: 'task',
        type: 'llm',
        name: '汇总者',
        properties: {
          role: 'summarizer',
          systemPrompt: '你是一个汇总者。整合各个专家的输出，生成最终回复。',
        },
      },
    ],
  },
};
