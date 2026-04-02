import { getDatabase } from '../../stratix-database/StratixDatabase';

import { TaskItem, TaskContext, TaskResult, TaskEvent, TaskEventCallback } from './TaskItem';

// Database row interface
interface TaskRow {
  task_id: string;
  zone_id: string;
  project_id: string;
  name: string;
  description: string | null;
  type: 'coding' | 'writing' | 'analysis' | 'research' | 'general';
  priority: number;
  status: string;
  assigned_agent_id: string | null;
  dependencies: string;
  context: string;
  result: string | null;
  error: string | null;
  created_at: number;
  assigned_at: number | null;
  started_at: number | null;
  completed_at: number | null;
}

export class TaskQueueService {
  private static instance: TaskQueueService;
  private tasks: Map<string, TaskItem> = new Map();
  private zoneTaskPools: Map<string, string[]> = new Map(); // zoneId -> taskIds (priority order)
  private eventListeners: Map<string, TaskEventCallback[]> = new Map();
  private globalListeners: TaskEventCallback[] = [];

  private constructor() {}

  static getInstance(): TaskQueueService {
    if (!TaskQueueService.instance) {
      TaskQueueService.instance = new TaskQueueService();
    }
    return TaskQueueService.instance;
  }

  // ==================== Task CRUD ====================

  async createTask(
    taskId: string,
    zoneId: string,
    projectId: string,
    name: string,
    type: 'coding' | 'writing' | 'analysis' | 'research' | 'general',
    context: TaskContext,
    options: {
      priority?: number;
      dependencies?: string[];
      description?: string;
    } = {}
  ): Promise<TaskItem> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    const task: TaskItem = {
      taskId,
      zoneId,
      projectId,
      name,
      description: options.description,
      type,
      priority: options.priority ?? 5,
      status: 'pending',
      dependencies: options.dependencies || [],
      context,
      createdAt: now,
    };

    db.prepare(`
      INSERT INTO tasks (task_id, zone_id, project_id, name, description, type, priority, status, dependencies, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      taskId,
      zoneId,
      projectId,
      name,
      options.description || null,
      type,
      task.priority,
      JSON.stringify(task.dependencies),
      JSON.stringify(task.context),
      now
    );

    this.tasks.set(taskId, task);
    this.addToZonePool(zoneId, taskId);
    this.emitEvent({ type: 'created', taskId, timestamp: now });

    return task;
  }

  async getTask(taskId: string): Promise<TaskItem | null> {
    if (this.tasks.has(taskId)) {
      return this.tasks.get(taskId)!;
    }

    const db = getDatabase().getDatabase();
    const row = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as TaskRow | undefined;

    if (!row) return null;

    const task = this.rowToTask(row);
    this.tasks.set(taskId, task);
    return task;
  }

  async getTasksByZone(zoneId: string): Promise<TaskItem[]> {
    const db = getDatabase().getDatabase();
    const rows = db.prepare('SELECT * FROM tasks WHERE zone_id = ? ORDER BY priority DESC, created_at ASC').all(zoneId) as TaskRow[];

    return rows.map(row => {
      const task = this.rowToTask(row);
      this.tasks.set(task.taskId, task);
      return task;
    });
  }

  async getTasksByAgent(agentId: string): Promise<TaskItem[]> {
    const db = getDatabase().getDatabase();
    const rows = db.prepare(
      "SELECT * FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress') ORDER BY priority DESC"
    ).all(agentId) as TaskRow[];

    return rows.map(row => this.rowToTask(row));
  }

  async updateTask(taskId: string, updates: Partial<TaskItem>): Promise<TaskItem | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;

    const db = getDatabase().getDatabase();
    const now = Date.now();

    const setClauses: string[] = [];
    const values: any[] = [];

    if (updates.status !== undefined) {
      task.status = updates.status;
      setClauses.push('status = ?');
      values.push(updates.status);

      if (updates.status === 'assigned' && !task.assignedAt) {
        task.assignedAt = now;
        setClauses.push('assigned_at = ?');
        values.push(now);
      } else if (updates.status === 'in_progress' && !task.startedAt) {
        task.startedAt = now;
        setClauses.push('started_at = ?');
        values.push(now);
      } else if (updates.status === 'completed' || updates.status === 'failed') {
        task.completedAt = now;
        setClauses.push('completed_at = ?');
        values.push(now);
      }
    }

    if (updates.assignedAgentId !== undefined) {
      task.assignedAgentId = updates.assignedAgentId;
      setClauses.push('assigned_agent_id = ?');
      values.push(updates.assignedAgentId);
    }

    if (updates.result !== undefined) {
      task.result = updates.result;
      setClauses.push('result = ?');
      values.push(JSON.stringify(updates.result));
    }

    if (updates.error !== undefined) {
      task.error = updates.error;
      setClauses.push('error = ?');
      values.push(updates.error);
    }

    if (setClauses.length === 0) return task;

    values.push(taskId);
    db.prepare(`UPDATE tasks SET ${setClauses.join(', ')} WHERE task_id = ?`).run(...values);

    // Handle status change events
    if (updates.status) {
      const eventType = updates.status === 'completed' ? 'completed'
        : updates.status === 'failed' ? 'failed'
        : updates.status === 'assigned' ? 'assigned'
        : updates.status === 'in_progress' ? 'started'
        : null;

      if (eventType) {
        this.emitEvent({ type: eventType, taskId, agentId: task.assignedAgentId, timestamp: now });
      }
    }

    this.tasks.set(taskId, task);
    return task;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId);
    if (!task) return false;

    const db = getDatabase().getDatabase();
    const result = db.prepare('DELETE FROM tasks WHERE task_id = ?').run(taskId);

    if (result.changes > 0) {
      this.tasks.delete(taskId);
      this.removeFromZonePool(task.zoneId, taskId);
      return true;
    }
    return false;
  }

  // ==================== Task Queue Operations ====================

  async enqueueTask(taskId: string): Promise<boolean> {
    const task = await this.getTask(taskId);
    if (!task) return false;

    // Check dependencies
    for (const depId of task.dependencies) {
      const dep = await this.getTask(depId);
      if (dep && dep.status !== 'completed' && dep.status !== 'failed') {
        // Dependency not satisfied, cannot enqueue yet
        return false;
      }
    }

    this.addToZonePool(task.zoneId, taskId);
    return true;
  }

  async dequeueTask(agentId: string, zoneId: string): Promise<TaskItem | null> {
    const pool = this.zoneTaskPools.get(zoneId);
    if (!pool || pool.length === 0) return null;

    // Find highest priority task with satisfied dependencies
    for (const taskId of pool) {
      const task = await this.getTask(taskId);
      if (!task || task.status !== 'pending') continue;

      // Check dependencies
      let depsSatisfied = true;
      for (const depId of task.dependencies) {
        const dep = await this.getTask(depId);
        if (!dep || (dep.status !== 'completed' && dep.status !== 'failed')) {
          depsSatisfied = false;
          break;
        }
      }

      if (depsSatisfied) {
        // Assign to agent
        await this.updateTask(taskId, {
          status: 'assigned',
          assignedAgentId: agentId,
        });

        // Remove from pending pool but keep in task
        this.removeFromZonePool(zoneId, taskId);

        return task;
      }
    }

    return null;
  }

  async requeueAbandonedTasks(): Promise<string[]> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    // Find tasks assigned to agents that haven't sent heartbeat in 5 minutes
    // For now, just find tasks in 'assigned' or 'in_progress' status
    const abandonedTasks = db.prepare(`
      SELECT t.* FROM tasks t
      LEFT JOIN agent_backgrounds ab ON t.assigned_agent_id = ab.agent_id
      WHERE t.status IN ('assigned', 'in_progress')
        AND (ab.last_heartbeat_at IS NULL OR ab.last_heartbeat_at < ?)
    `).all(now - 5 * 60 * 1000) as TaskRow[];

    const requeued: string[] = [];

    for (const row of abandonedTasks) {
      const task = this.rowToTask(row);
      await this.updateTask(task.taskId, { status: 'pending', assignedAgentId: undefined });
      this.addToZonePool(task.zoneId, task.taskId);
      this.emitEvent({ type: 'requeued', taskId: task.taskId, timestamp: now });
      requeued.push(task.taskId);
    }

    return requeued;
  }

  async getPendingTasks(zoneId: string): Promise<TaskItem[]> {
    const tasks = await this.getTasksByZone(zoneId);
    return tasks.filter(t => t.status === 'pending');
  }

  async getNextTask(zoneId: string): Promise<TaskItem | null> {
    const pending = await this.getPendingTasks(zoneId);

    // Sort by priority (desc), then created_at (asc)
    pending.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.createdAt - b.createdAt;
    });

    return pending[0] || null;
  }

  // ==================== Event System ====================

  on(event: string, callback: TaskEventCallback): void {
    if (event === '*') {
      this.globalListeners.push(callback);
    } else {
      if (!this.eventListeners.has(event)) {
        this.eventListeners.set(event, []);
      }
      this.eventListeners.get(event)!.push(callback);
    }
  }

  off(event: string, callback: TaskEventCallback): void {
    if (event === '*') {
      this.globalListeners = this.globalListeners.filter(cb => cb !== callback);
    } else {
      const listeners = this.eventListeners.get(event);
      if (listeners) {
        this.eventListeners.set(event, listeners.filter(cb => cb !== callback));
      }
    }
  }

  private emitEvent(event: TaskEvent): void {
    const listeners = this.eventListeners.get(event.type);
    if (listeners) {
      listeners.forEach(cb => cb(event));
    }
    this.globalListeners.forEach(cb => cb(event));
  }

  // ==================== Zone Pool Management ====================

  private addToZonePool(zoneId: string, taskId: string): void {
    if (!this.zoneTaskPools.has(zoneId)) {
      this.zoneTaskPools.set(zoneId, []);
    }

    const pool = this.zoneTaskPools.get(zoneId)!;
    if (!pool.includes(taskId)) {
      pool.push(taskId);
      // Re-sort by priority
      pool.sort((a, b) => {
        const taskA = this.tasks.get(a);
        const taskB = this.tasks.get(b);
        if (!taskA || !taskB) return 0;
        return taskB.priority - taskA.priority;
      });
    }
  }

  private removeFromZonePool(zoneId: string, taskId: string): void {
    const pool = this.zoneTaskPools.get(zoneId);
    if (pool) {
      const index = pool.indexOf(taskId);
      if (index !== -1) {
        pool.splice(index, 1);
      }
    }
  }

  // ==================== Helpers ====================

  private rowToTask(row: TaskRow): TaskItem {
    let dependencies: string[] = [];
    let context: TaskContext = { description: '' };
    let result: TaskResult | undefined;

    try {
      dependencies = JSON.parse(row.dependencies || '[]');
    } catch { /* ignore */ }

    try {
      context = JSON.parse(row.context || '{}');
    } catch { /* ignore */ }

    try {
      if (row.result) result = JSON.parse(row.result);
    } catch { /* ignore */ }

    return {
      taskId: row.task_id,
      zoneId: row.zone_id,
      projectId: row.project_id,
      name: row.name,
      description: row.description ?? undefined,
      type: row.type as TaskItem['type'],
      priority: row.priority,
      status: row.status as TaskItem['status'],
      assignedAgentId: row.assigned_agent_id ?? undefined,
      dependencies,
      context,
      result,
      error: row.error ?? undefined,
      createdAt: row.created_at,
      assignedAt: row.assigned_at ?? undefined,
      startedAt: row.started_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }
}

export default TaskQueueService;
