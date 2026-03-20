import type { WorkflowPreset } from '../types';

export const singleAgentPreset: WorkflowPreset = {
  id: 'single-agent',
  name: '单 Agent 模式',
  description: '基础的单 Agent 对话模式，适用于简单问答和任务',
  category: 'single-agent',
  icon: '🤖',
  definition: {
    properties: {
      name: '单 Agent',
      description: '基础的单 Agent 配置',
    },
    sequence: [
      {
        id: 'agent',
        componentType: 'task',
        type: 'llm',
        name: 'Agent',
        properties: {
          providerId: 'openai',
          model: 'gpt-4o',
          systemPrompt: '你是一个有帮助的 AI 助手。',
          temperature: 0.7,
          maxTokens: 4096,
        },
      },
    ],
  },
};
