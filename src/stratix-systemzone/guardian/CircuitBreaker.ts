// ============================================
// CircuitBreaker.ts - 熔断器模块
// Phase 1: Guardian 路径保护 + 熔断器
// ============================================

import { CircuitBreakerState, CircuitBreakerMetrics, CircuitBreakerThresholds, Lesson, Alert } from '../types';

export interface CircuitBreakerConfig {
  maxConsecutiveFailures?: number;
  resetAfterMs?: number;
}

export interface CircuitBreakerEvents {
  onTrip?: (failureCount: number) => void;
  onReset?: () => void;
  onHalfOpen?: () => void;
}

/**
 * 熔断器状态
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * 熔断器模块
 * 连续失败 N 次后打开熔断，暂停所有提案执行
 */
export class CircuitBreakerClass {
  private metrics: CircuitBreakerMetrics;
  private thresholds: CircuitBreakerThresholds;
  private state: CircuitBreakerState;
  private timer?: NodeJS.Timeout;
  private events: CircuitBreakerEvents;

  constructor(config: CircuitBreakerConfig = {}, events: CircuitBreakerEvents = {}) {
    this.thresholds = {
      maxConsecutiveFailures: config.maxConsecutiveFailures ?? 3,
      resetAfterMs: config.resetAfterMs ?? 60000, // 1 minute
    };

    this.metrics = {
      consecutiveFailures: 0,
      lastFailureTimestamp: null,
    };

    this.state = 'closed';
    this.events = events;
  }

  /**
   * 记录一次成功
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      // -half-open 状态下成功，重置熔断器
      this.reset();
      return;
    }

    // 正常状态下重置失败计数
    this.metrics.consecutiveFailures = 0;
    this.metrics.lastFailureTimestamp = null;
  }

  /**
   * 记录一次失败
   */
  recordFailure(): void {
    this.metrics.consecutiveFailures++;
    this.metrics.lastFailureTimestamp = new Date();

    if (this.state === 'half-open') {
      // half-open 状态下失败，立即打开熔断
      this.trip();
      return;
    }

    // 检查是否达到熔断阈值
    if (this.metrics.consecutiveFailures >= this.thresholds.maxConsecutiveFailures) {
      this.trip();
    }
  }

  /**
   * 触发熔断（open 状态）
   */
  private trip(): void {
    this.state = 'open';
    this.events.onTrip?.(this.metrics.consecutiveFailures);
    this.scheduleHalfOpen();
  }

  /**
   * 安排进入 half-open 状态
   */
  private scheduleHalfOpen(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      this.toHalfOpen();
    }, this.thresholds.resetAfterMs);
  }

  /**
   * 进入 half-open 状态（允许一个测试请求）
   */
  private toHalfOpen(): void {
    this.state = 'half-open';
    this.events.onHalfOpen?.();
  }

  /**
   * 重置熔断器到关闭状态
   */
  reset(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }

    this.state = 'closed';
    this.metrics.consecutiveFailures = 0;
    this.metrics.lastFailureTimestamp = null;
    this.events.onReset?.();
  }

  /**
   * 检查当前是否允许执行
   */
  isAllowed(): boolean {
    return this.state !== 'open';
  }

  /**
   * 获取当前状态
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * 获取当前指标
   */
  getMetrics(): CircuitBreakerMetrics {
    return { ...this.metrics };
  }

  /**
   * 获取阈值配置
   */
  getThresholds(): CircuitBreakerThresholds {
    return { ...this.thresholds };
  }

  /**
   * 创建与当前状态对应的 Lesson 记录
   */
  createLessonRecord(context: string): Lesson {
    return {
      id: `lesson_cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      type: 'error',
      category: 'circuit_breaker',
      content: `Circuit breaker opened after ${this.metrics.consecutiveFailures} consecutive failures`,
      context: context,
      avoidanceRule: `Wait ${this.thresholds.resetAfterMs}ms for half-open state, then retry with single test request`,
      reuseCount: 0,
    };
  }

  /**
   * 创建与当前状态对应的 Alert 记录
   */
  createAlert(proposalId?: string): Alert {
    return {
      id: `alert_cb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      type: 'circuit_tripped',
      message: `Circuit breaker tripped: ${this.metrics.consecutiveFailures} consecutive failures`,
      proposalId,
    };
  }

  /**
   * 获取状态描述
   */
  getStatus(): string {
    switch (this.state) {
      case 'closed':
        return `CircuitBreaker[closed] - failures: ${this.metrics.consecutiveFailures}/${this.thresholds.maxConsecutiveFailures}`;
      case 'open':
        return `CircuitBreaker[open] - ${this.thresholds.resetAfterMs}ms until half-open`;
      case 'half-open':
        return `CircuitBreaker[half-open] - testing...`;
    }
  }
}
