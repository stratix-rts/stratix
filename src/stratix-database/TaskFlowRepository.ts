import type { Database, Statement } from './sqlite-adapter';

import { generateId } from '../stratix-project/utils/helpers';

import { getDatabase } from './StratixDatabase';

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

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

interface TaskFlowRow {
  flow_id: string;
  task_id: string;
  zone_id: string;
  from_agent_id: string | null;
  to_agent_id: string | null;
  action: string;
  metadata: string | null;
  created_at: number;
}

/**
 * Task 流转记录
 */
export interface TaskFlowRecord {
  flowId: string;
  taskId: string;
  zoneId: string;
  fromAgentId: string | null;  // null 表示 Zone 创建
  toAgentId: string | null;
  action: TaskFlowAction;
  metadata?: {
    reason?: string;
    output?: string;
    files?: string[];
    issues?: string[];
    duration?: number;
    reassignedFrom?: string;
    reassignedTo?: string;
  };
  createdAt: number;
}

export interface FlowQueryOptions {
  limit?: number;
  offset?: number;
  actions?: TaskFlowAction[];
}

function buildFlowQuery(
  baseSql: string,
  baseParams: (string | number)[],
  options?: FlowQueryOptions
): { sql: string; params: (string | number)[] } {
  let sql = baseSql;
  const params = [...baseParams];

  if (options?.actions && options.actions.length > 0) {
    const placeholders = options.actions.map(() => '?').join(', ');
    sql += ` AND action IN (${placeholders})`;
    params.push(...options.actions);
  }

  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(options?.limit ?? DEFAULT_LIMIT, options?.offset ?? DEFAULT_OFFSET);

  return { sql, params };
}

/**
 * TaskFlowRepository - 任务流转记录持久化
 */
export class TaskFlowRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  private statements = new Map<string, Statement>();

  private stmt(sql: string): Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /**
   * 清理 prepared statement 缓存
   */
  shutdown(): void {
    this.statements.clear();
  }

  /**
   * 检查数据库连接是否健康
   */
  isHealthy(): boolean {
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 创建流转记录
   */
  addFlow(
    taskId: string,
    zoneId: string,
    fromAgentId: string | null,
    toAgentId: string | null,
    action: TaskFlowAction,
    metadata?: TaskFlowRecord['metadata']
  ): TaskFlowRecord {
    const now = Date.now();
    const flowId = generateId('flow');

    this.stmt(`
      INSERT INTO task_flow (flow_id, task_id, zone_id, from_agent_id, to_agent_id, action, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
   * 批量创建流转记录（事务包装）
   */
  addFlows(flows: Array<Omit<TaskFlowRecord, 'flowId' | 'createdAt'>>): TaskFlowRecord[] {
    const now = Date.now();
    const result: TaskFlowRecord[] = [];

    const insert = this.stmt(`
      INSERT INTO task_flow (flow_id, task_id, zone_id, from_agent_id, to_agent_id, action, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const flow of flows) {
        const flowId = generateId('flow');
        insert.run(
          flowId,
          flow.taskId,
          flow.zoneId,
          flow.fromAgentId,
          flow.toAgentId,
          flow.action,
          flow.metadata ? JSON.stringify(flow.metadata) : null,
          now
        );
        result.push({ ...flow, flowId, createdAt: now });
      }
    });

    tx();
    return result;
  }

  /**
   * 获取任务完整流转历史
   */
  getTaskFlowHistory(taskId: string): TaskFlowRecord[] {
    const rows = this.stmt(`
      SELECT * FROM task_flow
      WHERE task_id = ?
      ORDER BY created_at ASC
    `).all(taskId) as TaskFlowRow[];
    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 获取任务最新流转记录
   */
  getLatestFlow(taskId: string): TaskFlowRecord | null {
    const row = this.stmt(`
      SELECT * FROM task_flow
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(taskId) as TaskFlowRow | undefined;
    return row ? this.mapRowToRecord(row) : null;
  }

  /**
   * 获取 Zone 的流转记录（支持分页、过滤 action）
   */
  getZoneFlows(zoneId: string, options?: FlowQueryOptions): TaskFlowRecord[] {
    const { sql, params } = buildFlowQuery('SELECT * FROM task_flow WHERE zone_id = ?', [zoneId], options);
    const rows = this.stmt(sql).all(...params) as TaskFlowRow[];
    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 获取 Agent 相关流转记录
   */
  getAgentFlows(agentId: string, zoneId?: string, options?: FlowQueryOptions): TaskFlowRecord[] {
    let baseSql = 'SELECT * FROM task_flow WHERE to_agent_id = ?';
    const baseParams: (string | number)[] = [agentId];

    if (zoneId) {
      baseSql += ' AND zone_id = ?';
      baseParams.push(zoneId);
    }

    const { sql, params } = buildFlowQuery(baseSql, baseParams, options);
    const rows = this.stmt(sql).all(...params) as TaskFlowRow[];
    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 按 action 统计任务数量
   */
  getTaskCountByStatus(zoneId: string): Record<TaskFlowAction, number> {
    const rows = this.stmt(`
      SELECT action, COUNT(*) as count
      FROM task_flow
      WHERE zone_id = ?
      GROUP BY action
    `).all(zoneId) as Array<{ action: string; count: number }>;

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.action, row.count);
    }

    return {
      created: counts.get('created') ?? 0,
      delegated: counts.get('delegated') ?? 0,
      claimed: counts.get('claimed') ?? 0,
      started: counts.get('started') ?? 0,
      completed: counts.get('completed') ?? 0,
      failed: counts.get('failed') ?? 0,
      cancelled: counts.get('cancelled') ?? 0
    };
  }

  private mapRowToRecord(row: TaskFlowRow): TaskFlowRecord {
    let metadata: TaskFlowRecord['metadata'];
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as TaskFlowRecord['metadata'];
      } catch {
        /* expected: corrupted metadata JSON */
        metadata = undefined;
      }
    }
    return {
      flowId: row.flow_id,
      taskId: row.task_id,
      zoneId: row.zone_id,
      fromAgentId: row.from_agent_id,
      toAgentId: row.to_agent_id,
      action: row.action as TaskFlowAction,
      metadata,
      createdAt: row.created_at
    };
  }
}

export const taskFlowRepository = new TaskFlowRepository();
