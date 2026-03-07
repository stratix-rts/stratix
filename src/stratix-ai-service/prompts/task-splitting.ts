import { SplitStrategy } from '../types';

export const TASK_SPLITTING_PROMPTS: Record<SplitStrategy, string> = {
  sequential: `你是一个项目规划专家。请按流程顺序拆分以下需求。

需求摘要: {summary}
已识别的任务: {tasks}

拆分规则:
1. 按照软件开发生命周期拆分: 分析 → 设计 → 开发 → 测试 → 部署
2. 每个阶段创建对应的任务
3. 确保任务之间有清晰的顺序依赖
4. 优先级按执行顺序设置

请输出 JSON 格式的任务列表:
{
  "tasks": [
    {
      "id": "task_1",
      "name": "任务名称",
      "type": "requirement|design|development|test|deploy|writing|research|custom",
      "description": "详细描述",
      "estimatedTime": 120,
      "dependencies": ["task_0"],
      "priority": 1
    }
  ]
}`,

  by_type: `你是一个项目规划专家。请按任务类型拆分以下需求。

需求摘要: {summary}
已识别的任务: {tasks}

拆分规则:
1. 按照技术栈和功能模块分类
2. 将相似类型的任务合并
3. 为每种类型创建独立的任务组
4. 优先级按重要性设置

请输出 JSON 格式的任务列表:
{
  "tasks": [
    {
      "id": "task_1",
      "name": "任务名称",
      "type": "requirement|design|development|test|deploy|writing|research|custom",
      "description": "详细描述",
      "estimatedTime": 120,
      "dependencies": ["task_0"],
      "priority": 1
    }
  ]
}`,

  by_priority: `你是一个项目规划专家。请按优先级拆分以下需求。

需求摘要: {summary}
已识别的任务: {tasks}

拆分规则:
1. 识别核心功能 (P1) - 必须实现的最小可行产品
2. 识别重要功能 (P2) - 提升用户体验的功能
3. 识别优化功能 (P3) - 锦上添花的功能
4. 为每个优先级创建任务组

请输出 JSON 格式的任务列表:
{
  "tasks": [
    {
      "id": "task_1",
      "name": "任务名称",
      "type": "requirement|design|development|test|deploy|writing|research|custom",
      "description": "详细描述",
      "estimatedTime": 120,
      "dependencies": ["task_0"],
      "priority": 1
    }
  ]
}`,
};

export function getTaskSplittingPrompt(
  strategy: SplitStrategy,
  summary: string,
  tasks: string
): string {
  return TASK_SPLITTING_PROMPTS[strategy]
    .replace('{summary}', summary)
    .replace('{tasks}', tasks);
}
