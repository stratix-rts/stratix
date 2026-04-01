import { getDatabase } from './StratixDatabase';
import { generateId } from '../stratix-project/utils/helpers';

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

/**
 * 审计日志记录
 */
export interface AuditLogRecord {
  id: string;
  zoneId: string;
  eventType: AuditEventType;
  actorId: string | null;   // agentId 或 userId
  targetId: string | null;
  metadata?: Record<string, any>;
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

/**
 * AuditLogRepository - Zone 操作审计日志持久化
 */
export class AuditLogRepository {
  private get db() {
    return getDatabase().getDatabase();
  }

  /**
   * 记录审计事件
   */
  log(
    zoneId: string,
    eventType: AuditEventType,
    actorId?: string,
    targetId?: string,
    metadata?: Record<string, any>
  ): AuditLogRecord {
    const now = Date.now();
    const id = generateId('audit');

    const stmt = this.db.prepare(`
      INSERT INTO zone_audit_log (id, zone_id, event_type, actor_id, target_id, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
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
   * 获取 Zone 审计轨迹（支持分页和过滤）
   */
  getZoneAuditTrail(
    zoneId: string,
    options?: AuditLogQueryOptions
  ): { events: AuditLogRecord[]; total: number; hasMore: boolean } {
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    // Build WHERE clause
    const conditions: string[] = ['zone_id = ?'];
    const params: any[] = [zoneId];

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

    const whereClause = conditions.join(' AND ');

    // Get total count
    const countRow = this.db.prepare(`
      SELECT COUNT(*) as total FROM zone_audit_log WHERE ${whereClause}
    `).get(...params) as any;
    const total = countRow.total;

    // Get paginated results
    const queryParams = [...params, limit, offset];
    const rows = this.db.prepare(`
      SELECT * FROM zone_audit_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams) as any[];

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
    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const conditions: string[] = ['actor_id = ?'];
    const params: any[] = [agentId];

    if (zoneId) {
      conditions.push('zone_id = ?');
      params.push(zoneId);
    }

    if (options?.eventTypes && options.eventTypes.length > 0) {
      const placeholders = options.eventTypes.map(() => '?').join(', ');
      conditions.push(`event_type IN (${placeholders})`);
      params.push(...options.eventTypes);
    }

    if (options?.startTime !== undefined) {
      conditions.push('created_at >= ?');
      params.push(options.startTime);
    }

    if (options?.endTime !== undefined) {
      conditions.push('created_at <= ?');
      params.push(options.endTime);
    }

    const whereClause = conditions.join(' AND ');
    const queryParams = [...params, limit, offset];

    const rows = this.db.prepare(`
      SELECT * FROM zone_audit_log
      WHERE ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(...queryParams) as any[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 获取 Zone 最近事件
   */
  getRecentEvents(zoneId: string, limit: number = 10): AuditLogRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM zone_audit_log
      WHERE zone_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(zoneId, limit) as any[];

    return rows.map(row => this.mapRowToRecord(row));
  }

  /**
   * 按事件类型统计
   */
  countByEventType(zoneId: string): Record<AuditEventType, number> {
    const rows = this.db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM zone_audit_log
      WHERE zone_id = ?
      GROUP BY event_type
    `).all(zoneId) as any[];

    const counts: Record<string, number> = {};
    for (const row of rows) {
      counts[row.event_type] = row.count;
    }

    // Initialize all event types with 0
    const allTypes: AuditEventType[] = [
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

    const result: Record<AuditEventType, number> = {} as any;
    for (const type of allTypes) {
      result[type] = counts[type] ?? 0;
    }

    return result;
  }

  /**
   * 清理旧日志
   */
  cleanup(zoneId: string, olderThan: number): number {
    const stmt = this.db.prepare(`
      DELETE FROM zone_audit_log
      WHERE zone_id = ? AND created_at < ?
    `);
    const result = stmt.run(zoneId, olderThan);
    return result.changes;
  }

  private mapRowToRecord(row: any): AuditLogRecord {
    return {
      id: row.id,
      zoneId: row.zone_id,
      eventType: row.event_type as AuditEventType,
      actorId: row.actor_id,
      targetId: row.target_id,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at
    };
  }
}

export const auditLogRepository = new AuditLogRepository();
