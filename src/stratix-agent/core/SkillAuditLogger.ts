/**
 * SkillAuditLogger - 技能执行审计日志
 *
 * 记录所有技能执行的详细信息，用于：
 * - 执行历史追踪
 * - 性能分析
 * - 错误排查
 * - Agent 行为审计
 */

import { randomUUID } from 'crypto';

export interface SkillExecutionLog {
  id: string;
  agentId: string;
  skillId: string;
  params: Record<string, any>;
  result?: any;
  error?: string;
  executionTime: number;
  timestamp: number;
  sessionId?: string;
}

export interface AuditLogQuery {
  agentId?: string;
  skillId?: string;
  startTime?: number;
  endTime?: number;
  limit?: number;
  offset?: number;
}

export class SkillAuditLogger {
  private logs: Map<string, SkillExecutionLog>;
  private agentLogsIndex: Map<string, string[]>;  // agentId -> logIds
  private skillLogsIndex: Map<string, string[]>;  // skillId -> logIds

  // 最大日志数量限制，防止内存溢出
  private static readonly MAX_LOG_ENTRIES = 10000;

  constructor() {
    this.logs = new Map();
    this.agentLogsIndex = new Map();
    this.skillLogsIndex = new Map();
  }

  /**
   * 记录一次技能执行
   */
  log(params: {
    agentId: string;
    skillId: string;
    params: Record<string, any>;
    result?: any;
    error?: string;
    executionTime: number;
    sessionId?: string;
  }): SkillExecutionLog {
    const log: SkillExecutionLog = {
      id: randomUUID(),
      agentId: params.agentId,
      skillId: params.skillId,
      params: params.params,
      result: params.result,
      error: params.error,
      executionTime: params.executionTime,
      timestamp: Date.now(),
      sessionId: params.sessionId,
    };

    this.logs.set(log.id, log);

    // 更新索引
    const agentLogs = this.agentLogsIndex.get(params.agentId) || [];
    agentLogs.push(log.id);
    this.agentLogsIndex.set(params.agentId, agentLogs);

    const skillLogs = this.skillLogsIndex.get(params.skillId) || [];
    skillLogs.push(log.id);
    this.skillLogsIndex.set(params.skillId, skillLogs);

    // 如果日志数量超过限制，删除最旧的日志
    if (this.logs.size > SkillAuditLogger.MAX_LOG_ENTRIES) {
      this.evictOldestLogs();
    }

    return log;
  }

  /**
   * 获取所有审计日志
   */
  getAllLogs(query: AuditLogQuery = {}): SkillExecutionLog[] {
    let logs = Array.from(this.logs.values());

    // 按时间倒序
    logs.sort((a, b) => b.timestamp - a.timestamp);

    // 时间范围过滤
    if (query.startTime) {
      logs = logs.filter(log => log.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      logs = logs.filter(log => log.timestamp <= query.endTime!);
    }

    // 技能 ID 过滤
    if (query.skillId) {
      logs = logs.filter(log => log.skillId === query.skillId);
    }

    // 分页
    const offset = query.offset || 0;
    const limit = query.limit || 100;

    return logs.slice(offset, offset + limit);
  }

  /**
   * 获取指定 Agent 的审计日志
   */
  getLogsByAgent(agentId: string, query: Omit<AuditLogQuery, 'agentId'> = {}): SkillExecutionLog[] {
    const logIds = this.agentLogsIndex.get(agentId) || [];
    let logs = logIds.map(id => this.logs.get(id)).filter((log): log is SkillExecutionLog => log !== undefined);

    // 按时间倒序
    logs.sort((a, b) => b.timestamp - a.timestamp);

    // 时间范围过滤
    if (query.startTime) {
      logs = logs.filter(log => log.timestamp >= query.startTime!);
    }
    if (query.endTime) {
      logs = logs.filter(log => log.timestamp <= query.endTime!);
    }

    // 分页
    const offset = query.offset || 0;
    const limit = query.limit || 100;

    return logs.slice(offset, offset + limit);
  }

  /**
   * 获取指定 Agent 的审计日志数量
   */
  getLogsCountByAgent(agentId: string): number {
    return this.agentLogsIndex.get(agentId)?.length || 0;
  }

  /**
   * 获取所有日志数量
   */
  getTotalCount(): number {
    return this.logs.size;
  }

  /**
   * 根据 ID 获取日志
   */
  getLogById(id: string): SkillExecutionLog | undefined {
    return this.logs.get(id);
  }

  /**
   * 清除指定时间之前的日志（用于清理）
   */
  clearBefore(timestamp: number): number {
    let cleared = 0;
    const entries = Array.from(this.logs.entries());
    for (const [id, log] of entries) {
      if (log.timestamp < timestamp) {
        this.logs.delete(id);
        cleared++;
      }
    }
    // 重建索引
    this.rebuildIndexes();
    return cleared;
  }

  /**
   * 清除所有日志
   */
  clearAll(): void {
    this.logs.clear();
    this.agentLogsIndex.clear();
    this.skillLogsIndex.clear();
  }

  /**
   * 驱逐最旧的日志以保持在限制内
   */
  private evictOldestLogs(): void {
    const toEvict = this.logs.size - SkillAuditLogger.MAX_LOG_ENTRIES + 100; // 驱逐到限制以下，留点余地

    // 按时间排序（最旧的在前）
    const sortedLogs = Array.from(this.logs.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);

    // 删除最旧的条目
    for (let i = 0; i < toEvict && i < sortedLogs.length; i++) {
      const [id, log] = sortedLogs[i];
      this.logs.delete(id);

      // 更新索引
      const agentLogs = this.agentLogsIndex.get(log.agentId);
      if (agentLogs) {
        const idx = agentLogs.indexOf(id);
        if (idx !== -1) agentLogs.splice(idx, 1);
      }

      const skillLogs = this.skillLogsIndex.get(log.skillId);
      if (skillLogs) {
        const idx = skillLogs.indexOf(id);
        if (idx !== -1) skillLogs.splice(idx, 1);
      }
    }
  }

  /**
   * 重建索引
   */
  private rebuildIndexes(): void {
    this.agentLogsIndex.clear();
    this.skillLogsIndex.clear();

    const logs = Array.from(this.logs.values());
    for (const log of logs) {
      const agentLogs = this.agentLogsIndex.get(log.agentId) || [];
      agentLogs.push(log.id);
      this.agentLogsIndex.set(log.agentId, agentLogs);

      const skillLogs = this.skillLogsIndex.get(log.skillId) || [];
      skillLogs.push(log.id);
      this.skillLogsIndex.set(log.skillId, skillLogs);
    }
  }
}

// 全局单例
export const skillAuditLogger = new SkillAuditLogger();
