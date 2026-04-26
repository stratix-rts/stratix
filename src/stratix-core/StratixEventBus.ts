/**
 * Stratix Core - 事件总线实现
 *
 * 基于 mitt 实现的模块间通信事件发布/订阅机制
 * 所有模块通过此事件总线进行通信
 *
 * 特性：事件缓冲 - 在订阅者注册前到达的事件会被缓冲，
 *       订阅时自动重放缓冲的事件，避免时序问题
 */

import mitt, { Emitter } from 'mitt';

import {
  StratixFrontendOperationEvent,
  StratixStateSyncEvent,
} from './stratix-protocol';

/**
 * Stratix 事件类型联合
 */
type StratixEvent = StratixFrontendOperationEvent | StratixStateSyncEvent;

/**
 * Stratix 事件总线
 *
 * 单例模式实现，提供全局统一的事件发布/订阅机制
 */
class StratixEventBus {
  private static instance: StratixEventBus;
  private emitter: Emitter<Record<string, StratixEvent>>;
  // 事件缓冲：在订阅者注册前到达的事件
  private eventBuffer: Map<string, StratixEvent[]> = new Map();
  // 已订阅的事件类型（用于判断是否需要缓冲）
  private subscribedEvents: Set<string> = new Set();
  // 缓冲上限，防止内存无限增长
  private static readonly MAX_BUFFER_SIZE = 100;

  private constructor() {
    this.emitter = mitt<Record<string, StratixEvent>>();
  }

  /**
   * 获取 StratixEventBus 单例实例
   * @returns StratixEventBus 实例
   */
  public static getInstance(): StratixEventBus {
    if (!StratixEventBus.instance) {
      StratixEventBus.instance = new StratixEventBus();
    }
    return StratixEventBus.instance;
  }

  /**
   * 发布事件
   * @param event Stratix 事件对象
   */
  public emit(event: StratixEvent): void {
    // 如果没有人订阅这个事件，缓冲它
    if (!this.subscribedEvents.has(event.eventType)) {
      this.bufferEvent(event);
      return;
    }
    this.emitter.emit(event.eventType, event);
  }

  /**
   * 订阅事件
   * @param eventType 事件类型
   * @param handler 事件处理函数
   */
  public subscribe(
    eventType: string,
    handler: (event: StratixEvent) => void
  ): void {
    this.subscribedEvents.add(eventType);
    this.emitter.on(eventType, handler);

    // 重放缓冲的事件
    this.replayBufferedEvents(eventType, handler);
  }

  /**
   * 取消订阅事件
   * @param eventType 事件类型
   * @param handler 事件处理函数
   */
  public unsubscribe(
    eventType: string,
    handler: (event: StratixEvent) => void
  ): void {
    this.emitter.off(eventType, handler);
    // 检查是否还有其他订阅者
    // 注意：mitt 不提供订阅计数，我们简单处理
  }

  /**
   * 清除所有事件监听器
   * 注意：通常只在测试或重置时使用
   */
  public clearAll(): void {
    this.emitter.all.clear();
    this.eventBuffer.clear();
    this.subscribedEvents.clear();
  }

  /**
   * 缓冲事件（在订阅者注册前到达）
   */
  private bufferEvent(event: StratixEvent): void {
    if (!this.eventBuffer.has(event.eventType)) {
      this.eventBuffer.set(event.eventType, []);
    }
    const buffer = this.eventBuffer.get(event.eventType)!;
    // 超过缓冲上限时，移除最旧的事件
    if (buffer.length >= StratixEventBus.MAX_BUFFER_SIZE) {
      buffer.shift();
    }
    buffer.push(event);
  }

  /**
   * 重放缓冲的事件给新的订阅者
   */
  private replayBufferedEvents(eventType: string, handler: (event: StratixEvent) => void): void {
    const buffered = this.eventBuffer.get(eventType);
    if (buffered && buffered.length > 0) {
      for (const event of buffered) {
        handler(event);
      }
      this.eventBuffer.set(eventType, []);
    }
  }
}

export default StratixEventBus;
