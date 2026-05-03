import { TaskType } from '../../stratix-ai-service/types';

export const TASK_TYPE_COLORS: Record<TaskType, number> = {
  [TaskType.REQUIREMENT]: 0x4A90E2,
  [TaskType.DESIGN]: 0x9B59B6,
  [TaskType.DEVELOPMENT]: 0x2ECC71,
  [TaskType.TEST]: 0xE67E22,
  [TaskType.DEPLOY]: 0xE74C3C,
  [TaskType.WRITING]: 0x1ABC9C,
  [TaskType.RESEARCH]: 0xF1C40F,
  [TaskType.CUSTOM]: 0x95A5A6,
};
