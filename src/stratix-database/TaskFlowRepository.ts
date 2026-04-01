import { getDatabase } from './StratixDatabase';
import { generateId } from '../stratix-project/utils/helpers';

/**
 * Task 流转动作
 */
export type TaskFlowAction =
  | 'created'    // Zone 创建任务
  | 'delegated'  // Zone 分派给 Agent
  | 'claimed'    // Agent 主动认领
  | 'started'    // Agent 开始执行
  | 'completed'  // Agent 完成
  | 'failed'     // Agent 失败
  | 'cancelled'; // 取消

/**
 * Task 流转记录
 */
export interface TaskFlowRecord {
  flowId: string;
  taskId: string;
  zoneId: string;
  fromAgentId: string | null;  // null 表示 Zone 创建
  toAgentId: string;
  action: TaskFlowAction;
  metadata?: {
    reason?: string;
    output?: string;
    files?: string[];
    issues?: string[];
    duration?: number;
  };
  createdAt: number;
}

export interface FlowQueryOptions {
  limit?: number;
  offset?: number;
  actions?: TaskFlowAction[];
}

/**
 * TaskFlowRepository - 任务流转记录持久化
 */
export class TaskFlowRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  /**
   * 创建流转记录
   */
  addFlow(
    taskId: string,
    zoneId: string,
    fromAgentId: string | null,
    toAgentId: string,
    action: TaskFlowAction,
    metadata?: TaskFlowRecord['metadata']
  ): TaskFlowRecord {
    const now = Date.now();
    const flowId = generateId('flow');

    const stmt = this.db.prepare(`
      INSERT INTO task_flow (flow_id, task_id, zone_id, from_agent_id, to_agent_id, action, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      flowId,
      taskId,
      zoneId,
      fromAgentId,
      toAgentId,
      action,
      metadata ? JSON.stringify(metadata) : null,
      now
    );

    return {
      flowId,
      taskId,
      zoneId,
      fromAgentId,
      toAgentId,
      action,
      metadata,
      createdAt: now
    };
  }

  /**
   * 获取任务完整流转历史
   */
  getTaskFlowHistory(taskId: string): TaskFlowRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM task_flow
      WHERE task_id = ?
      ORDER BY created_at ASC
    `).all(taskId) as any[];
    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 获取任务最新流转记录
   */
  getLatestFlow(taskId: string): TaskFlowRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM task_flow
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(taskId) as any;
    return row ? this.mapRowToRecord(row) : null;
  }

  /**
   * 获取 Zone 的流转记录（支持分页、过滤 action）
   */
  getZoneFlows(zoneId: string, options?: FlowQueryOptions): TaskFlowRecord[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let sql = 'SELECT * FROM task_flow WHERE zone_id = ?';
    const params: any[] = [zoneId];

    if (options?.actions && options.actions.length > 0) {
      const placeholders = options.actions.map(() => '?').join(', ');
      sql += ` AND action IN (${placeholders})`;
      params.push(...options.actions);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 获取 Agent 相关流转记录
   */
  getAgentFlows(agentId: string, zoneId?: string, options?: FlowQueryOptions): TaskFlowRecord[] {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    let sql = 'SELECT * FROM task_flow WHERE to_agent_id = ?';
    const params: any[] = [agentId];

    if (zoneId) {
      sql += ' AND zone_id = ?';
      params.push(zoneId);
    }

    if (options?.actions && options.actions.length > 0) {
      const placeholders = options.actions.map(() => '?').join(', ');
      sql += ` AND action IN (${placeholders})`;
      params.push(...options.actions);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const rows = this.db.prepare(sql).all(...params) as any[];
    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 按 action 统计任务数量
   */
  getTaskCountByStatus(zoneId: string): Record<TaskFlowAction, number> {
    const rows = this.db.prepare(`
      SELECT action, COUNT(*) as count
      FROM task_flow
      WHERE zone_id = ?
      GROUP BY action
    `).all(zoneId) as any[];

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.action] = row.count;
    }

    return {
      created: counts['created'] ?? 0,
      delegated: counts['delegated'] ?? 0,
      claimed: counts['claimed'] ?? 0,
      started: counts['started'] ?? 0,
      completed: counts['completed'] ?? 0,
      failed: counts['failed'] ?? 0,
      cancelled: counts['cancelled'] ?? 0
    };
  }

  private mapRowToRecord(row: any): TaskFlowRecord {
    return {
      flowId: row.flow_id,
      taskId: row.task_id,
      zoneId: row.zone_id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      action: row.action as TaskFlowAction,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at
    };
  }
}

export const taskFlowRepository = new TaskFlowRepository();
