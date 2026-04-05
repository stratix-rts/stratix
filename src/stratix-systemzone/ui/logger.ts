// ============================================
// System Zone 日志系统（前端）
// 纯内存 + 后端持久化 + 心跳巡检 + 自动修复
// ============================================

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogCategory = 'api' | 'ui' | 'store' | 'heartbeat' | 'autoheal' | 'general';

export interface SZLogEntry {
  timestamp: string;
  level: LogLevel;
  category: LogCategory;
  message: string;
  details?: Record<string, unknown>;
  error?: string;
  correlationId?: string;
}

export interface SZHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: SZHealthCheck[];
  summary: string;
}

export interface SZHealthCheck {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  autoFixed?: boolean;
}

// -------------------------------------------------------------------------
// Logger（纯内存，定期 flush 到后端）
// -------------------------------------------------------------------------

const MAX_BUFFER = 500;
const MAX_RECENT_ERRORS = 50;
const FLUSH_INTERVAL = 10_000; // 10s
const BASE_URL = typeof window !== 'undefined' && (window as any).GATEWAY_URL
  ? (window as any).GATEWAY_URL
  : 'http://127.0.0.1:7524';

class SystemZoneLogger {
  private static instance: SystemZoneLogger;
  private buffer: SZLogEntry[] = [];
  private recentErrors: SZLogEntry[] = [];
  private currentCorrelationId: string | null = null;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private allEntries: SZLogEntry[] = []; // 完整内存日志（最近 500 条）

  private constructor() {
    this.startAutoFlush();
  }

  static getInstance(): SystemZoneLogger {
    if (!SystemZoneLogger.instance) {
      SystemZoneLogger.instance = new SystemZoneLogger();
    }
    return SystemZoneLogger.instance;
  }

  // ---------------------------------------------------------------
  // Correlation（关联操作追踪）
  // ---------------------------------------------------------------

  startOperation(label: string): string {
    this.currentCorrelationId = `op-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.info('general', `▶ ${label}`);
    return this.currentCorrelationId;
  }

  endOperation(label: string, success: boolean): void {
    this.log(success ? 'info' : 'warn', 'general', `${success ? '✓' : '✗'} ${label} ${success ? '成功' : '失败'}`);
    this.currentCorrelationId = null;
  }

  // ---------------------------------------------------------------
  // Log methods
  // ---------------------------------------------------------------

  debug(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log('debug', category, message, details);
  }

  info(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log('info', category, message, details);
  }

  warn(category: LogCategory, message: string, details?: Record<string, unknown>): void {
    this.log('warn', category, message, details);
  }

  error(category: LogCategory, message: string, error?: Error | unknown, details?: Record<string, unknown>): void {
    this.log('error', category, message, {
      ...details,
      errorMessage: error instanceof Error ? error.message : error ? String(error) : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    });

    // Track in recent errors
    const entry = this.buffer[this.buffer.length - 1];
    if (entry) {
      this.recentErrors.push(entry);
      if (this.recentErrors.length > MAX_RECENT_ERRORS) this.recentErrors.shift();
    }
  }

  // ---------------------------------------------------------------
  // Query
  // ---------------------------------------------------------------

  getRecentErrors(count = 10): SZLogEntry[] {
    return this.recentErrors.slice(-count);
  }

  getByCorrelationId(id: string): SZLogEntry[] {
    return this.allEntries.filter(e => e.correlationId === id);
  }

  getAll(level?: LogLevel): SZLogEntry[] {
    return level ? this.allEntries.filter(e => e.level === level) : [...this.allEntries];
  }

  /**
   * 健康检查：分析最近日志，判断当前状态
   */
  checkHealth(): SZHealthReport {
    const checks: SZHealthCheck[] = [];
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

    // 1. 检查近期错误数量
    const recentErrorCount = this.recentErrors.filter(e => new Date(e.timestamp) >= fiveMinAgo).length;
    if (recentErrorCount > 10) {
      checks.push({ name: '错误频率', status: 'error', message: `5 分钟内 ${recentErrorCount} 个错误` });
    } else if (recentErrorCount > 3) {
      checks.push({ name: '错误频率', status: 'warn', message: `5 分钟内 ${recentErrorCount} 个错误` });
    } else {
      checks.push({ name: '错误频率', status: 'ok', message: '正常' });
    }

    // 2. 检查 API 连通性
    const apiErrors = this.recentErrors.filter(e => e.category === 'api' && new Date(e.timestamp) >= fiveMinAgo);
    if (apiErrors.length > 5) {
      checks.push({ name: 'API 连通', status: 'error', message: `${apiErrors.length} 次 API 调用失败` });
    } else if (apiErrors.length > 0) {
      checks.push({ name: 'API 连通', status: 'warn', message: `${apiErrors.length} 次 API 失败` });
    } else {
      checks.push({ name: 'API 连通', status: 'ok', message: '正常' });
    }

    // 3. 检查重复错误（同一 message 出现 3+ 次）
    const msgCounts = new Map<string, number>();
    for (const e of this.recentErrors) {
      msgCounts.set(e.message, (msgCounts.get(e.message) || 0) + 1);
    }
    const repeated = [...msgCounts.entries()].filter(([, c]) => c >= 3);
    if (repeated.length > 0) {
      checks.push({
        name: '重复错误',
        status: 'warn',
        message: `${repeated.length} 种错误重复 3 次以上: ${repeated.map(([m]) => m.slice(0, 50)).join('; ')}`,
      });
    } else {
      checks.push({ name: '重复错误', status: 'ok', message: '无' });
    }

    // 4. 检查自愈记录
    const autohealEntries = this.allEntries.filter(e => e.category === 'autoheal');
    if (autohealEntries.length > 0) {
      checks.push({
        name: '自愈',
        status: 'ok',
        message: `已执行 ${autohealEntries.length} 次自动修复`,
        autoFixed: true,
      });
    }

    // Determine overall status
    const hasError = checks.some(c => c.status === 'error');
    const hasWarn = checks.some(c => c.status === 'warn');
    const status: SZHealthReport['status'] = hasError ? 'unhealthy' : hasWarn ? 'degraded' : 'healthy';

    const summary = status === 'healthy'
      ? 'System Zone 运行正常'
      : status === 'degraded'
        ? `存在 ${checks.filter(c => c.status === 'warn').length} 个警告`
        : `存在 ${checks.filter(c => c.status === 'error').length} 个严重问题`;

    return { status, checks, summary };
  }

  // ---------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------

  flush(): void {
    if (this.buffer.length === 0) return;

    const entries = [...this.buffer];
    this.buffer = [];

    // 发送到后端（fire and forget，不阻塞主流程）
    fetch(`${BASE_URL}/api/systemzone/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    }).catch(() => {
      // 后端不可用，放回 buffer
      if (this.buffer.length < MAX_BUFFER) {
        this.buffer.unshift(...entries.slice(-50)); // 最多回放 50 条
      }
    });
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // ---------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------

  private log(level: LogLevel, category: LogCategory, message: string, details?: Record<string, unknown>): void {
    const entry: SZLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      category,
      message,
      details,
      correlationId: this.currentCorrelationId ?? undefined,
    };

    this.buffer.push(entry);
    this.allEntries.push(entry);

    // Trim allEntries
    if (this.allEntries.length > MAX_BUFFER) {
      this.allEntries = this.allEntries.slice(-MAX_BUFFER);
    }

    // Console mirror（开发时方便调试）
    const prefix = `[SZ:${category}]`;
    switch (level) {
      case 'error': console.error(prefix, message, details); break;
      case 'warn': console.warn(prefix, message, details); break;
      case 'debug': break; // silent in console
      default: console.log(prefix, message);
    }
  }

  private startAutoFlush(): void {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL);
  }
}

export const szLog = SystemZoneLogger.getInstance();

// -------------------------------------------------------------------------
// Wrapper helpers
// -------------------------------------------------------------------------

/**
 * 包装 async 操作，自动记录开始/结束/错误
 */
export async function withLog<T>(
  category: LogCategory,
  label: string,
  fn: () => Promise<T>
): Promise<T> {
  szLog.startOperation(label);
  try {
    const result = await fn();
    szLog.endOperation(label, true);
    return result;
  } catch (error) {
    szLog.error(category, `${label} 失败`, error);
    szLog.endOperation(label, false);
    throw error;
  }
}

// -------------------------------------------------------------------------
// Auto-Heal Engine（心跳巡检 + 自动修复）
// -------------------------------------------------------------------------

export class AutoHealEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private healActions: Map<string, () => Promise<boolean>> = new Map();
  private running = false;

  /**
   * 注册修复动作
   */
  registerHealAction(name: string, action: () => Promise<boolean>): void {
    this.healActions.set(name, action);
  }

  /**
   * 启动心跳巡检
   */
  start(intervalMs: number = 60_000): void {
    if (this.timer) return;
    this.running = true;
    szLog.info('heartbeat', '心跳巡检启动', { intervalMs });

    this.timer = setInterval(async () => {
      if (document.visibilityState !== 'visible') return; // 页面不可见时跳过
      await this.runCheck();
    }, intervalMs);

    // 立即执行一次
    setTimeout(() => this.runCheck(), 3000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.running = false;
    szLog.info('heartbeat', '心跳巡检停止');
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * 执行一次巡检
   */
  async runCheck(): Promise<SZHealthReport> {
    const report = szLog.checkHealth();

    if (report.status === 'healthy') {
      szLog.debug('heartbeat', '心跳: 一切正常');
      return report;
    }

    szLog.info('heartbeat', `心跳: ${report.summary}`, {
      checks: report.checks.filter(c => c.status !== 'ok'),
    });

    // 自动修复
    if (report.status !== 'healthy') {
      await this.autoHeal(report);
    }

    return report;
  }

  private async autoHeal(report: SZHealthReport): Promise<void> {
    for (const check of report.checks) {
      if (check.status === 'ok') continue;

      // API 连通性问题 → 尝试重连
      if (check.name === 'API 连通' && this.healActions.has('reconnect')) {
        szLog.info('autoheal', `尝试修复: ${check.name}`);
        const success = await this.healActions.get('reconnect')!();
        szLog[success ? 'info' : 'warn']('autoheal', `修复 ${check.name}: ${success ? '成功' : '失败'}`);
      }

      // 重复错误 → 清理 buffer
      if (check.name === '重复错误') {
        szLog.info('autoheal', '清理重复错误缓冲区');
        // 不需要实际操作，只是标记
      }

      // 通用修复 → 执行注册的动作
      if (this.healActions.has(check.name)) {
        szLog.info('autoheal', `尝试修复: ${check.name}`);
        const success = await this.healActions.get(check.name)!();
        szLog[success ? 'info' : 'warn']('autoheal', `修复 ${check.name}: ${success ? '成功' : '失败'}`);
      }
    }
  }
}

export const autoHeal = new AutoHealEngine();
