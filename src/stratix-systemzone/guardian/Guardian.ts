// ============================================
// Guardian.ts - 守护者模块
// Phase 1: Guardian 路径保护 + 熔断器
// ============================================

import {
  GuardianState,
  GuardianStatus,
  GuardianProtection,
  Alert,
  Proposal,
  PermissionMatrix,
  Lesson,
} from '../types';
import { PathProtection, ValidationResult } from './PathProtection';
import { CircuitBreakerClass } from './CircuitBreaker';

export interface GuardianConfig {
  protection: GuardianProtection;
  permissions?: PermissionMatrix;
  circuitBreakerConfig?: {
    maxConsecutiveFailures?: number;
    resetAfterMs?: number;
  };
}

export interface GuardianValidationResult {
  valid: boolean;
  reasons: string[];
  alerts: Alert[];
  circuitTripped?: boolean;
  pathValidation?: {
    pathType: 'forbidden' | 'readonly' | 'allowed';
  };
}

/**
 * 守护者模块
 * 负责：路径保护、熔断器、用户审批
 */
export class Guardian {
  private state: GuardianState;
  private pathProtection: PathProtection;
  private circuitBreaker: CircuitBreakerClass;
  private config: GuardianConfig;

  // 事件回调
  private onAlert?: (alert: Alert) => void;
  private onLesson?: (lesson: Lesson) => void;
  private onCircuitTripped?: (failureCount: number) => void;

  constructor(config: GuardianConfig) {
    this.config = config;

    // 初始化路径保护
    this.pathProtection = new PathProtection(config.permissions);

    // 初始化熔断器
    this.circuitBreaker = new CircuitBreakerClass(config.circuitBreakerConfig, {
      onTrip: (failureCount) => {
        this.state.status = 'alert';
        this.state.protection.circuitBreakerEnabled = true;
        this.onCircuitTripped?.(failureCount);
      },
      onReset: () => {
        this.state.status = 'guarding';
      },
    });

    // 初始化 Guardian 状态
    this.state = {
      status: 'guarding',
      permissions: config.permissions ?? {
        forbiddenPaths: config.protection.forbiddenPaths,
        readonlyPaths: [],
      },
      recentAlerts: [],
      protection: config.protection,
    };
  }

  /**
   * 验证提案是否安全
   * @param proposal - 待验证的提案
   * @returns 验证结果
   */
  validateProposal(proposal: Proposal): GuardianValidationResult {
    const reasons: string[] = [];
    const alerts: Alert[] = [];

    // 1. 检查熔断器状态
    if (!this.circuitBreaker.isAllowed()) {
      const alert = this.circuitBreaker.createAlert(proposal.id);
      alerts.push(alert);
      this.addAlert(alert);

      return {
        valid: false,
        reasons: ['Circuit breaker is open, proposals are blocked'],
        alerts,
        circuitTripped: true,
      };
    }

    // 2. 检查路径保护
    const pathResult: ValidationResult = this.pathProtection.validateProposal(proposal);

    if (!pathResult.valid) {
      reasons.push(pathResult.reason ?? 'Path is protected');

      const alert: Alert = {
        id: `alert_path_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date(),
        type: 'path_violation',
        message: `Proposal blocked: ${pathResult.reason}`,
        proposalId: proposal.id,
      };
      alerts.push(alert);
      this.addAlert(alert);

      return {
        valid: false,
        reasons,
        alerts,
        pathValidation: { pathType: pathResult.pathType ?? 'forbidden' },
      };
    }

    if (pathResult.pathType === 'readonly') {
      reasons.push(pathResult.reason ?? 'Path is readonly');
    }

    // 3. 记录成功
    this.circuitBreaker.recordSuccess();

    return {
      valid: true,
      reasons,
      alerts,
      pathValidation: { pathType: pathResult.pathType ?? 'allowed' },
    };
  }

  /**
   * 记录提案执行失败（用于熔断器计数）
   */
  recordFailure(): void {
    this.circuitBreaker.recordFailure();
  }

  /**
   * 记录提案执行成功（重置熔断器）
   */
  recordSuccess(): void {
    this.circuitBreaker.recordSuccess();
  }

  /**
   * 添加告警记录
   */
  private addAlert(alert: Alert): void {
    this.state.recentAlerts.push(alert);

    // 保持最近 100 条告警
    if (this.state.recentAlerts.length > 100) {
      this.state.recentAlerts = this.state.recentAlerts.slice(-100);
    }

    // 触发告警回调
    this.onAlert?.(alert);
  }

  /**
   * 创建 Lesson 记录
   */
  createLesson(type: Lesson['type'], category: string, content: string, context: string, avoidanceRule?: string): Lesson {
    const lesson: Lesson = {
      id: `lesson_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      type,
      category,
      content,
      context,
      avoidanceRule,
      reuseCount: 0,
    };

    this.onLesson?.(lesson);
    return lesson;
  }

  /**
   * 获取当前 Guardian 状态
   */
  getState(): GuardianState {
    return {
      ...this.state,
      recentAlerts: [...this.state.recentAlerts],
    };
  }

  /**
   * 获取熔断器状态
   */
  getCircuitBreakerState(): string {
    return this.circuitBreaker.getStatus();
  }

  /**
   * 获取路径保护实例（用于测试）
   */
  getPathProtection(): PathProtection {
    return this.pathProtection;
  }

  /**
   * 获取熔断器实例（用于测试）
   */
  getCircuitBreaker(): CircuitBreakerClass {
    return this.circuitBreaker;
  }

  /**
   * 手动重置熔断器
   */
  resetCircuitBreaker(): void {
    this.circuitBreaker.reset();
    this.state.status = 'guarding';
  }

  /**
   * 添加保护路径
   */
  addForbiddenPath(pattern: string): void {
    this.pathProtection.addForbiddenPath(pattern);
    this.state.permissions.forbiddenPaths.push(pattern);
  }

  /**
   * 设置告警回调
   */
  setOnAlert(callback: (alert: Alert) => void): void {
    this.onAlert = callback;
  }

  /**
   * 设置 Lesson 回调
   */
  setOnLesson(callback: (lesson: Lesson) => void): void {
    this.onLesson = callback;
  }

  /**
   * 设置熔断器触发回调
   */
  setOnCircuitTripped(callback: (failureCount: number) => void): void {
    this.onCircuitTripped = callback;
  }

  /**
   * 获取状态摘要
   */
  getSummary(): {
    status: GuardianStatus;
    circuitBreaker: string;
    alertCount: number;
    forbiddenPathCount: number;
  } {
    return {
      status: this.state.status,
      circuitBreaker: this.circuitBreaker.getStatus(),
      alertCount: this.state.recentAlerts.length,
      forbiddenPathCount: this.state.permissions.forbiddenPaths.length,
    };
  }
}
