import { zoneRepository } from '../../stratix-database/ZoneRepository';
import { Zone, ZoneTask, ZoneTaskUpdateRequest } from '../../stratix-project/types';
import { gatewayEventBus } from '../GatewayEventBus';

export class ZoneTaskService {
  constructor(
    private checkPermission: (action: string, resource: string, agentId: string) => void,
    private ensureInitialized: () => Promise<void>
  ) {}

  public async getTasks(zoneId: string, limit?: number, offset?: number): Promise<ZoneTask[]> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getTasks(zoneId, limit, offset);
  }

  public async getTasksCount(zoneId: string): Promise<number> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }
    return zoneRepository.getTasksCount(zoneId);
  }

  public async getTask(zoneId: string, taskId: string): Promise<ZoneTask | null> {
    await this.ensureInitialized();
    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const task = zoneRepository.getTask(taskId);
    if (!task || task.zoneId !== zoneId) {
      return null;
    }

    return task;
  }

  public async createTask(zoneId: string, agentId: string, title: string): Promise<ZoneTask> {
    await this.ensureInitialized();

    this.checkPermission('create_task', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const ctx = zoneRepository.getZoneContext(zoneId);
    if (!ctx) {
      throw new Error(`Zone context not found: ${zoneId}`);
    }

    if (!ctx.taskCreatorId) {
      zoneRepository.updateZoneContext(zoneId, { taskCreatorId: agentId });
    } else if (ctx.taskCreatorId !== agentId) {
      throw new Error('只有任务创建者可以创建新任务');
    }

    const task = zoneRepository.createTask(zoneId, title, agentId);

    gatewayEventBus.publishZoneEvent('zone:task_created', zoneId, zone.id, {
      task
    });

    return task;
  }

  public async updateTask(zoneId: string, taskId: string, agentId: string, updates: ZoneTaskUpdateRequest): Promise<ZoneTask> {
    await this.ensureInitialized();

    this.checkPermission('update_task', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const task = zoneRepository.getTask(taskId);
    if (!task || task.zoneId !== zoneId) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const ctx = zoneRepository.getZoneContext(zoneId);
    const isCreator = ctx?.taskCreatorId === agentId;
    const isAssignee = task.assignee === agentId;

    if (!isCreator && !isAssignee) {
      throw new Error('只有任务创建者或认领者可以更新任务');
    }

    const updated = zoneRepository.updateTask(taskId, updates);
    if (!updated) {
      throw new Error(`Task not found: ${taskId}`);
    }

    gatewayEventBus.publishZoneEvent('zone:task_updated', zoneId, zone.id, {
      task: updated
    });

    return updated;
  }

  public async deleteTask(zoneId: string, taskId: string, agentId: string): Promise<boolean> {
    await this.ensureInitialized();

    this.checkPermission('delete_task', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const ctx = zoneRepository.getZoneContext(zoneId);
    if (ctx?.taskCreatorId !== agentId) {
      throw new Error('只有任务创建者可以删除任务');
    }

    const deleted = zoneRepository.deleteTask(taskId);

    if (deleted) {
      gatewayEventBus.publishZoneEvent('zone:task_deleted', zoneId, zone.id, {
        taskId
      });
    }

    return deleted;
  }

  public async claimTask(zoneId: string, taskId: string, agentId: string): Promise<ZoneTask> {
    await this.ensureInitialized();

    this.checkPermission('claim_task', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const task = zoneRepository.getTask(taskId);
    if (!task || task.zoneId !== zoneId) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (task.assignee) {
      throw new Error('任务已被认领');
    }

    if (task.status === 'done') {
      throw new Error('任务已完成，无法认领');
    }

    const updated = zoneRepository.updateTask(taskId, {
      assignee: agentId,
      status: 'in_progress'
    });

    if (!updated) {
      throw new Error(`Task not found: ${taskId}`);
    }

    gatewayEventBus.publishZoneEvent('zone:task_claimed', zoneId, zone.id, {
      taskId,
      assignee: agentId
    });

    return updated;
  }

  public async createTasksBatch(
    zoneId: string,
    agentId: string,
    titles: string[]
  ): Promise<{ success: ZoneTask[]; failed: Array<{ title: string; error: string }> }> {
    await this.ensureInitialized();

    this.checkPermission('create_tasks_batch', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const success: ZoneTask[] = [];
    const failed: Array<{ title: string; error: string }> = [];

    for (const title of titles) {
      try {
        const task = zoneRepository.createTask(zoneId, title, agentId);
        success.push(task);

        gatewayEventBus.publishZoneEvent('zone:task_created', zoneId, zone.id, {
          task
        });
      } catch (error) {
        failed.push({
          title,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }

  public async updateTasksBatch(
    zoneId: string,
    agentId: string,
    updates: Array<{ taskId: string; title?: string; status?: string; assignee?: string | null }>
  ): Promise<{ success: ZoneTask[]; failed: Array<{ taskId: string; error: string }> }> {
    await this.ensureInitialized();

    this.checkPermission('update_tasks_batch', `zone:${zoneId}`, agentId);

    const zone = zoneRepository.getZone(zoneId);
    if (!zone) {
      throw new Error(`Zone not found: ${zoneId}`);
    }

    const success: ZoneTask[] = [];
    const failed: Array<{ taskId: string; error: string }> = [];

    for (const update of updates) {
      try {
        const task = zoneRepository.getTask(update.taskId);
        if (!task || task.zoneId !== zoneId) {
          throw new Error(`Task not found: ${update.taskId}`);
        }

        const ctx = zoneRepository.getZoneContext(zoneId);
        const isCreator = ctx?.taskCreatorId === agentId;
        const isAssignee = task.assignee === agentId;

        if (!isCreator && !isAssignee) {
          throw new Error('只有任务创建者或认领者可以更新任务');
        }

        const updated = zoneRepository.updateTask(update.taskId, {
          title: update.title,
          status: update.status as any,
          assignee: update.assignee
        });

        if (updated) {
          success.push(updated);

          gatewayEventBus.publishZoneEvent('zone:task_updated', zoneId, zone.id, {
            task: updated
          });
        }
      } catch (error) {
        failed.push({
          taskId: update.taskId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return { success, failed };
  }
}
