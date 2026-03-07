import { TaskType } from '../types';

export const REQUIREMENT_PARSING_PROMPT = `你是一个专业的项目需求分析师。请分析以下需求并提取结构化信息。

需求描述:
{requirement}

请按照以下 JSON 格式输出解析结果:
{
  "summary": "需求摘要（一句话概括）",
  "tasks": [
    {
      "id": "task_1",
      "name": "任务名称",
      "type": "requirement|design|development|test|deploy|writing|research|custom",
      "description": "任务详细描述",
      "estimatedTime": 120,
      "dependencies": ["task_0"],
      "priority": 1
    }
  ],
  "metadata": {
    "projectType": "web|mobile|desktop|api|other",
    "technologies": ["技术栈列表"],
    "complexity": "low|medium|high"
  }
}

注意事项:
1. 任务类型必须从以下选择: requirement, design, development, test, deploy, writing, research, custom
2. estimatedTime 是预估时间，单位为分钟
3. dependencies 是依赖的任务 ID 列表
4. priority 范围是 1-5，1 最高，5 最低
5. 确保任务之间的依赖关系合理
6. 任务应该足够细化，每个任务 1-4 小时为宜

请仅输出 JSON，不要有其他文字。`;

export function getRequirementParsingPrompt(requirement: string): string {
  return REQUIREMENT_PARSING_PROMPT.replace('{requirement}', requirement);
}

export const TASK_TYPE_DESCRIPTIONS: Record<TaskType, string> = {
  [TaskType.REQUIREMENT]: '需求分析和理解',
  [TaskType.DESIGN]: '系统设计和架构',
  [TaskType.DEVELOPMENT]: '代码开发和实现',
  [TaskType.TEST]: '功能测试和质量保证',
  [TaskType.DEPLOY]: '部署和发布',
  [TaskType.WRITING]: '文档写作和内容创作',
  [TaskType.RESEARCH]: '技术调研和可行性分析',
  [TaskType.CUSTOM]: '自定义任务',
};
