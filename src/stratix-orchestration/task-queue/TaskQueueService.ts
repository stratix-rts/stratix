/**
 * 编排层任务队列（agent 平台的 `tasks` 表 —— 与游戏存档域的 `character_tasks` **不是同一张表**）。
 *
 * ⚠️ `tasks.project_id` 已退役（@since v3.3，task_206 / M2-09）：
 *   编排层不再有「项目」维（副本维统一到 instance），新代码**不读不写**该列；
 *   物理删列留 M3。权威依据：docs/DESIGN-project-map.md §1.3.1.1 三条裁决第 1 条。
 */

import { getDatabase } from '../../stratix-database';

import { TaskItem, TaskContext, TaskResult, TaskEvent, TaskEventCallback } from './TaskItem';

function log(level: 'info' | 'warn' | 'error', message: string, ctx?: Record<string, unknown>): void {
  console[level](`[TaskQueueService] ${message}`, ctx);
}

// Database row interface
interface TaskRow {
  task_id: string;
  zone_id: string;
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

const DEFAULT_PRIORITY = 5;
const ABANDONED_TASK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export class TaskQueueService {
  private static instance: TaskQueueService;
  private tasks: Map<string, TaskItem> = new Map();
  private zoneTaskPools: Map<string, string[]> = new Map(); // zoneId -> taskIds (priority order)
  private zoneTaskPoolSets: Map<string, Set<string>> = new Map(); // zoneId -> taskId Set (for O(1) lookup)
  private eventListeners: Map<string, TaskEventCallback[]> = new Map();
  private globalListeners: TaskEventCallback[] = [];
  private inFlightDequeues: Set<string> = new Set(); // Prevent concurrent dequeue of same task

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
      name,
      description: options.description,
      type,
      priority: options.priority ?? DEFAULT_PRIORITY,
      status: 'pending',
      dependencies: options.dependencies || [],
      context,
      createdAt: now,
    };

    db.prepare(`
      INSERT INTO tasks (task_id, zone_id, name, description, type, priority, status, dependencies, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(
      taskId,
      zoneId,
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

    // Also ensure zone pool is initialized for dequeueTask
    if (!this.zoneTaskPools.has(zoneId)) {
      this.zoneTaskPools.set(zoneId, []);
    }
    const pool = this.zoneTaskPools.get(zoneId)!;

    return rows.map(row => {
      const task = this.rowToTask(row);
      this.tasks.set(task.taskId, task);
      // Sync pending tasks to zone pool for dequeueTask
      if (task.status === 'pending' && !pool.includes(task.taskId)) {
        pool.push(task.taskId);
      }
      return task;
    });
  }

  async getTasksByAgent(agentId: string): Promise<TaskItem[]> {
    const db = getDatabase().getDatabase();

    // Query 1: Tasks assigned to this agent in the tasks table
    const rows = db.prepare(
      "SELECT * FROM tasks WHERE assigned_agent_id = ? AND status IN ('assigned', 'in_progress') ORDER BY priority DESC"
    ).all(agentId) as TaskRow[];

    // Query 2: Delegated tasks from task_flow (ZoneCoordinator writes here when delegating)
    // This catches cases where tasks might not be properly synced to the tasks table
    const delegatedFlows = db.prepare(
      "SELECT task_id, to_agent_id, created_at FROM task_flow WHERE to_agent_id = ? AND action = 'delegated' ORDER BY created_at DESC"
    ).all(agentId) as { task_id: string; to_agent_id: string; created_at: number }[];

    // Use a Map to deduplicate by taskId (tasks table takes precedence)
    const taskMap = new Map<string, TaskItem>();

    // Add tasks from the tasks table first
    for (const row of rows) {
      const task = this.rowToTask(row);
      taskMap.set(task.taskId, task);
    }

    // Add/merge delegated tasks from task_flow (if not already present)
    for (const flow of delegatedFlows) {
      if (taskMap.has(flow.task_id)) continue; // Already have this task

      // Query the tasks table for this task
      const taskRow = db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(flow.task_id) as TaskRow | undefined;
      if (taskRow) {
        const task = this.rowToTask(taskRow);
        taskMap.set(task.taskId, task);
      }
      // If task doesn't exist in tasks table, skip it (can't return partial data)
    }

    // Sort by priority descending
    const result = Array.from(taskMap.values());
    result.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

    return result;
  }

  async updateTask(taskId: string, updates: Partial<TaskItem>): Promise<TaskItem | null> {
    const task = await this.getTask(taskId);
    if (!task) return null;

    const db = getDatabase().getDatabase();
    const now = Date.now();

    const setClauses: string[] = [];
    const values: Array<string | number | null> = [];

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
    this.emitEvent({ type: 'requeued', taskId, timestamp: Date.now() });
    return true;
  }

  async dequeueTask(agentId: string, zoneId: string): Promise<TaskItem | null> {
    const pool = this.zoneTaskPools.get(zoneId);
    if (!pool || pool.length === 0) return null;

    // Find highest priority task with satisfied dependencies
    for (const taskId of pool) {
      // Skip if another dequeue is currently processing this task
      if (this.inFlightDequeues.has(taskId)) continue;

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
        // Prevent concurrent assignment of the same task
        this.inFlightDequeues.add(taskId);
        try {
          // Re-fetch and re-verify status to avoid race conditions
          const freshTask = await this.getTask(taskId);
          if (!freshTask || freshTask.status !== 'pending') continue;

          // Assign to agent
          await this.updateTask(taskId, {
            status: 'assigned',
            assignedAgentId: agentId,
          });

          // Remove from pending pool but keep in task
          this.removeFromZonePool(zoneId, taskId);

          return freshTask;
        } finally {
          this.inFlightDequeues.delete(taskId);
        }
      }
    }

    return null;
  }

  async requeueAbandonedTasks(): Promise<string[]> {
    const db = getDatabase().getDatabase();
    const now = Date.now();

    // Find tasks assigned to agents that haven't sent heartbeat in 5 minutes
    // Only check agents that are registered in agent_backgrounds (INNER JOIN)
    const abandonedTasks = db.prepare(`
      SELECT t.* FROM tasks t
      INNER JOIN agent_backgrounds ab ON t.assigned_agent_id = ab.agent_id
      WHERE t.status IN ('assigned', 'in_progress')
        AND ab.last_heartbeat_at < ?
    `).all(now - ABANDONED_TASK_THRESHOLD_MS) as TaskRow[];

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

  getStatus(): { pending: number; total: number } {
    const allTasks = Array.from(this.tasks.values());
    return {
      pending: allTasks.filter(t => t.status === 'pending').length,
      total: allTasks.length,
    };
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

  clearAllListeners(): void {
    this.globalListeners = [];
    this.eventListeners.clear();
  }

  destroy(): void {
    this.clearAllListeners();
    this.tasks.clear();
    this.zoneTaskPools.clear();
    this.zoneTaskPoolSets.clear();
    this.inFlightDequeues.clear();
  }

  /**
   * Health check for the task queue service
   */
  isHealthy(): boolean {
    return this.inFlightDequeues.size < 100;
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
      this.zoneTaskPoolSets.set(zoneId, new Set());
    }

    const pool = this.zoneTaskPools.get(zoneId)!;
    const poolSet = this.zoneTaskPoolSets.get(zoneId)!;
    if (!poolSet.has(taskId)) {
      pool.push(taskId);
      poolSet.add(taskId);
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
    const poolSet = this.zoneTaskPoolSets.get(zoneId);
    if (poolSet) {
      poolSet.delete(taskId);
    }
  }

  // ==================== Helpers ====================

  private rowToTask(row: TaskRow): TaskItem {
    let dependencies: string[] = [];
    let context: TaskContext = { description: '' };
    let result: TaskResult | undefined;

    try {
      dependencies = JSON.parse(row.dependencies || '[]');
    } catch (err) {
      log('warn', 'Failed to parse task dependencies', { error: String(err) });
    }

    try {
      context = JSON.parse(row.context || '{}');
    } catch (err) {
      log('warn', 'Failed to parse task context', { error: String(err) });
    }

    try {
      if (row.result) result = JSON.parse(row.result);
    } catch (err) {
      log('warn', 'Failed to parse task result', { error: String(err) });
    }

    return {
      taskId: row.task_id,
      zoneId: row.zone_id,
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
