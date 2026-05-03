/**
 * ZoneAgent - Zone as Agent 实现
 *
 * Zone 本身作为一个 Agent 运行，agentId = zoneId = projectId
 * ZoneAgent 负责：
 * 1. 解析 Zone 的 OKR (prompt 字段)
 * 2. 将 OKR 拆分为具体的 Task
 * 3. 将任务发布到 TaskQueueService
 */

import { TaskQueueService } from '../../stratix-orchestration/task-queue/TaskQueueService';
const taskQueueService = TaskQueueService.getInstance();
import type { TaskContext, TaskItem } from '../../stratix-orchestration/task-queue/TaskItem';
import { generateId } from '../../stratix-project/utils/helpers';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[ZoneAgent] ${message}`, ctx || '');
}

export interface ZoneOKR {
  objective: string;      // Zone 的 O (Objective)
  keyResults: string[];  // Zone 的 KR (Key Results) 列表
}

export interface ZoneTask {
  id: string;
  title: string;
  description?: string;
  priority?: number;
  createdBy: string;
  zoneId: string;
  projectId: string;
}

/**
 * ZoneAgent - Zone 作为一个 Agent
 *
 * agentId = zoneId = projectId
 */
export class ZoneAgent {
  public readonly agentId: string;
  public readonly zoneId: string;
  public readonly projectId: string;
  public title: string;
  public okr: ZoneOKR;

  private taskQueue: TaskQueueService;

  constructor(zoneId: string, title: string, prompt: string) {
    this.zoneId = zoneId;
    this.projectId = zoneId;  // zoneId === projectId
    this.agentId = zoneId;    // agentId === zoneId
    this.title = title;
    this.okr = this.parseOKR(prompt);
    this.taskQueue = taskQueueService;
  }

  /**
   * 解析 OKR 字符串
   * 格式：O: xxx\nKR1: xxx\nKR2: xxx
   */
  private parseOKR(prompt: string): ZoneOKR {
    const lines = prompt.split('\n').map(l => l.trim()).filter(Boolean);

    // 尝试提取 Objective
    let objective = prompt;  // 默认用整个 prompt 作为 objective
    const keyResults: string[] = [];

    for (const line of lines) {
      // 匹配 O: 或 Objective: 开头
      if (/^(O|Objective):\s*(.+)/i.test(line)) {
        objective = line.replace(/^(O|Objective):\s*/i, '');
        continue;
      }
      // 匹配 KR1: KR2: 或 KeyResult: 开头
      if (/^(KR\d*|KeyResult):\s*(.+)/i.test(line)) {
        const kr = line.replace(/^(KR\d*|KeyResult):\s*/i, '');
        keyResults.push(kr);
      }
    }

    return { objective, keyResults };
  }

  /**
   * 拆分 OKR 为具体任务
   * 将 keyResults 转换为 TaskQueue 任务
   */
  async splitOKRToTasks(): Promise<ZoneTask[]> {
    const tasks: ZoneTask[] = [];
    const taskContext: TaskContext = {
      description: `Zone ${this.title} OKR task`,
    };

    // 为每个 Key Result 创建任务
    for (let i = 0; i < this.okr.keyResults.length; i++) {
      const kr = this.okr.keyResults[i];
      const taskId = generateId('task');

      const task: ZoneTask = {
        id: taskId,
        title: `KR${i + 1}: ${kr}`,
        description: `Key Result for ${this.okr.objective}: ${kr}`,
        priority: 5,  // medium priority
        createdBy: this.agentId,
        zoneId: this.zoneId,
        projectId: this.projectId,
      };

      tasks.push(task);

      // 创建任务到 TaskQueueService
      try {
        await this.taskQueue.createTask(
          taskId,
          this.zoneId,
          this.projectId,
          task.title,
          'general',  // type
          taskContext,
          {
            priority: task.priority,
            description: task.description,
          }
        );

        // 入队以便 Agent 认领
        await this.taskQueue.enqueueTask(taskId);

        log('info', `Task created and enqueued: ${task.title}`);
      } catch (error) {
        log('error', `Failed to create task: ${task.title}`, { error: String(error) });
      }
    }

    return tasks;
  }

  /**
   * 获取 OKR 状态
   */
  getOKRStatus(): ZoneOKR {
    return this.okr;
  }

  /**
   * 获取任务列表
   */
  async getTasks(): Promise<ZoneTask[]> {
    const taskItems = await this.taskQueue.getTasksByZone(this.zoneId);
    return taskItems.map((item: TaskItem) => ({
      id: item.taskId,
      title: item.name,
      description: item.description || undefined,
      priority: item.priority,
      createdBy: this.agentId,
      zoneId: item.zoneId,
      projectId: item.projectId,
    }));
  }
}
