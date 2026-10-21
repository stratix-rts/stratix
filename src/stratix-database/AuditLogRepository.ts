
import { generateId } from '../stratix-core/utils/id';

import { getDatabase } from './StratixDatabase';
import type { Database, Statement } from './sqlite-adapter';

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

const ALL_EVENT_TYPES: AuditEventType[] = [
  'agent_entered',
  'agent_left',
  'task_created',
  'task_assigned',
  'task_claimed',
  'task_started',
  'task_completed',
  'task_failed',
  'message_sent',
  'skill_executed',
  'context_shared'
];

/**
 * 审计事件类型
 */
export type AuditEventType =
  | 'agent_entered'      // Agent 进入 Zone
  | 'agent_left'         // Agent 离开 Zone
  | 'task_created'       // 任务创建
  | 'task_assigned'      // 任务分派
  | 'task_claimed'       // 任务认领
  | 'task_started'       // 任务开始执行
  | 'task_completed'     // 任务完成
  | 'task_failed'        // 任务失败
  | 'message_sent'       // 消息发送
  | 'skill_executed'     // Skill 执行
  | 'context_shared';    // 上下文共享

interface AuditLogRow {
  id: string;
  zone_id: string;
  event_type: string;
  actor_id: string | null;
  target_id: string | null;
  metadata: string | null;
  created_at: number;
}

interface AuditLogCountRow {
  total: number;
}

/**
 * 审计日志记录
 */
export interface AuditLogRecord {
  id: string;
  zoneId: string;
  eventType: AuditEventType;
  actorId: string | null;   // agentId 或 userId
  targetId: string | null;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

/**
 * 审计日志查询选项
 */
export interface AuditLogQueryOptions {
  eventTypes?: AuditEventType[];
  actorId?: string;
  targetId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

interface WhereClauseResult {
  whereClause: string;
  params: (string | number)[];
}

function buildWhereConditions(
  baseConditions: string[],
  baseParams: (string | number)[],
  options?: AuditLogQueryOptions
): WhereClauseResult {
  const conditions = [...baseConditions];
  const params = [...baseParams];

  if (options?.eventTypes && options.eventTypes.length > 0) {
    const placeholders = options.eventTypes.map(() => '?').join(', ');
    conditions.push(`event_type IN (${placeholders})`);
    params.push(...options.eventTypes);
  }

  if (options?.actorId) {
    conditions.push('actor_id = ?');
    params.push(options.actorId);
  }

  if (options?.targetId) {
    conditions.push('target_id = ?');
    params.push(options.targetId);
  }

  if (options?.startTime !== undefined) {
    conditions.push('created_at >= ?');
    params.push(options.startTime);
  }

  if (options?.endTime !== undefined) {
    conditions.push('created_at <= ?');
    params.push(options.endTime);
  }

  return { whereClause: conditions.join(' AND '), params };
}

/**
 * AuditLogRepository - Zone 操作审计日志持久化
 */
export class AuditLogRepository {
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
   * 记录审计事件
   */
  log(
    zoneId: string,
    eventType: AuditEventType,
    actorId?: string,
    targetId?: string,
    metadata?: Record<string, unknown>
  ): AuditLogRecord {
    const now = Date.now();
    const id = generateId('audit');

    this.stmt(`
      INSERT INTO zone_audit_log (id, zone_id, event_type, actor_id, target_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      zoneId,
      eventType,
      actorId ?? null,
      targetId ?? null,
      metadata ? JSON.stringify(metadata) : null,
      now
    );

    return {
      id,
      zoneId,
      eventType,
      actorId: actorId ?? null,
      targetId: targetId ?? null,
      metadata,
      createdAt: now
    };
  }

  /**
   * 批量记录审计事件（事务包装）
   */
  logBatch(records: Omit<AuditLogRecord, 'id' | 'createdAt'>[]): AuditLogRecord[] {
    const now = Date.now();
    const inserted: AuditLogRecord[] = [];

    const insert = this.stmt(`
      INSERT INTO zone_audit_log (id, zone_id, event_type, actor_id, target_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    const tx = this.db.transaction(() => {
      for (const rec of records) {
        const id = generateId('audit');
        insert.run(
          id,
          rec.zoneId,
          rec.eventType,
          rec.actorId ?? null,
          rec.targetId ?? null,
          rec.metadata ? JSON.stringify(rec.metadata) : null,
          now
        );
        inserted.push({ ...rec, id, createdAt: now });
      }
    });

    tx();
    return inserted;
  }

  /**
   * 获取 Zone 审计轨迹（支持分页和过滤）
   * 使用窗口函数 COUNT(*) OVER() 在单次查询中返回总数与数据
   */
  getZoneAuditTrail(
    zoneId: string,
    options?: AuditLogQueryOptions
  ): { events: AuditLogRecord[]; total: number; hasMore: boolean } {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const offset = options?.offset ?? DEFAULT_OFFSET;

    const { whereClause, params } = buildWhereConditions(['zone_id = ?'], [zoneId], options);

    const rows = this.stmt(`
      SELECT *, COUNT(*) OVER() as _total
      FROM zone_audit_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset) as Array<AuditLogRow & { _total: number }>;

    const total = rows.length > 0 ? rows[0]._total : 0;
    const events = rows.map(row => this.mapRowToRecord(row));
    const hasMore = offset + events.length < total;

    return { events, total, hasMore };
  }

  /**
   * 获取 Agent 活动记录
   */
  getAgentActivityLog(
    agentId: string,
    zoneId?: string,
    options?: AuditLogQueryOptions
  ): AuditLogRecord[] {
    const limit = options?.limit ?? DEFAULT_LIMIT;
    const offset = options?.offset ?? DEFAULT_OFFSET;

    const baseConditions: string[] = ['actor_id = ?'];
    const baseParams: (string | number)[] = [agentId];

    if (zoneId) {
      baseConditions.push('zone_id = ?');
      baseParams.push(zoneId);
    }

    const { whereClause, params } = buildWhereConditions(baseConditions, baseParams, options);
    const queryParams = [...params, limit, offset];

    const rows = this.stmt(`
      SELECT * FROM zone_audit_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams) as AuditLogRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 获取 Zone 最近事件
   */
  getRecentEvents(zoneId: string, limit: number = 10): AuditLogRecord[] {
    const rows = this.stmt(`
      SELECT * FROM zone_audit_log
      WHERE zone_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(zoneId, limit) as AuditLogRow[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 按事件类型统计
   */
  countByEventType(zoneId: string): Record<AuditEventType, number> {
    const rows = this.stmt(`
      SELECT event_type, COUNT(*) as count
      FROM zone_audit_log
      WHERE zone_id = ?
      GROUP BY event_type
    `).all(zoneId) as Array<{ event_type: string; count: number }>;

    const counts = new Map<string, number>();
    for (const row of rows) {
      counts.set(row.event_type, row.count);
    }

    const result = {} as Record<AuditEventType, number>;
    for (const type of ALL_EVENT_TYPES) {
      result[type] = counts.get(type) ?? 0;
    }

    return result;
  }

  /**
   * 清理旧日志
   */
  cleanup(zoneId: string, olderThan: number): number {
    const result = this.stmt(`
      DELETE FROM zone_audit_log
      WHERE zone_id = ? AND created_at < ?
    `).run(zoneId, olderThan);
    return result.changes;
  }

  private mapRowToRecord(row: AuditLogRow): AuditLogRecord {
    let metadata: AuditLogRecord['metadata'];
    if (row.metadata) {
      try {
        metadata = JSON.parse(row.metadata) as Record<string, unknown>;
      } catch {
        /* expected: corrupted metadata JSON */
        metadata = undefined;
      }
    }
    return {
      id: row.id,
      zoneId: row.zone_id,
      eventType: row.event_type as AuditEventType,
      actorId: row.actor_id,
      targetId: row.target_id,
      metadata,
      createdAt: row.created_at
    };
  }
}

export const auditLogRepository = new AuditLogRepository();
