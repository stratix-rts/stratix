/**
 * UI Event Bus - UI事件总线
 * 
 * 集中式事件管理系统
 * 支持事件的发布、订阅、过滤和优先级
 */

import { UIEventType } from '../../core/types/event.types';
import type { UIEventListener, EventSubscriptionOptions } from '../../core/types/event.types';

interface EventSubscription {
  id: string;
  eventType: UIEventType | string;
  listener: UIEventListener;
  options: Required<EventSubscriptionOptions>;
}

export class UIEventBus {
  private static instance: UIEventBus;
  private subscriptions: Map<string, Set<EventSubscription>> = new Map();
  private subscriptionId: number = 0;
  private enabled: boolean = true;
  
  private constructor() {}
  
  /**
   * 获取单例实例
   */
  static getInstance(): UIEventBus {
    if (!UIEventBus.instance) {
      UIEventBus.instance = new UIEventBus();
    }
    return UIEventBus.instance;
  }
  
  /**
   * 订阅事件
   * 
   * @param eventType - 事件类型
   * @param listener - 监听器
   * @param options - 订阅选项
   * @returns 取消订阅函数
   */
  on<T = any>(
    eventType: UIEventType | string,
    listener: UIEventListener<T>,
    options: EventSubscriptionOptions = {}
  ): () => void {
    const subscription: EventSubscription = {
      id: this.generateSubscriptionId(),
      eventType,
      listener: listener as UIEventListener,
      options: {
        once: options.once ?? false,
        priority: options.priority ?? 0,
        passive: options.passive ?? false,
      },
    };
    
    if (!this.subscriptions.has(eventType)) {
      this.subscriptions.set(eventType, new Set());
    }
    
    const listeners = this.subscriptions.get(eventType)!;
    listeners.add(subscription);
    
    // 返回取消订阅函数
    return () => {
      listeners.delete(subscription);
      if (listeners.size === 0) {
        this.subscriptions.delete(eventType);
      }
    };
  }
  
  /**
   * 订阅一次（触发后自动取消）
   */
  once<T = any>(
    eventType: UIEventType | string,
    listener: UIEventListener<T>,
    options: Omit<EventSubscriptionOptions, 'once'> = {}
  ): () => void {
    return this.on(eventType, listener, { ...options, once: true });
  }
  
  /**
   * 发布事件
   */
  emit<T = any>(eventType: UIEventType | string, data?: T): void {
    if (!this.enabled) return;
    
    const listeners = this.subscriptions.get(eventType);
    if (!listeners || listeners.size === 0) return;
    
    // 按优先级排序（优先级高的先执行）
    const sortedListeners = Array.from(listeners).sort(
      (a, b) => b.options.priority - a.options.priority
    );
    
    const toRemove: EventSubscription[] = [];
    
    sortedListeners.forEach(subscription => {
      try {
        subscription.listener(data);
        
        // 标记一次性订阅待删除
        if (subscription.options.once) {
          toRemove.push(subscription);
        }
      } catch (error) {
        console.error(`[UIEventBus] Error in listener for ${eventType}:`, error);
      }
    });
    
    // 删除一次性订阅
    toRemove.forEach(subscription => {
      listeners.delete(subscription);
    });
    
    if (listeners.size === 0) {
      this.subscriptions.delete(eventType);
    }
  }
  
  /**
   * 取消所有订阅
   */
  off(eventType?: UIEventType | string): void {
    if (eventType) {
      this.subscriptions.delete(eventType);
    } else {
      this.subscriptions.clear();
    }
  }
  
  /**
   * 检查是否有订阅者
   */
  hasListeners(eventType: UIEventType | string): boolean {
    const listeners = this.subscriptions.get(eventType);
    return listeners !== undefined && listeners.size > 0;
  }
  
  /**
   * 获取订阅者数量
   */
  getListenerCount(eventType?: UIEventType | string): number {
    if (eventType) {
      return this.subscriptions.get(eventType)?.size ?? 0;
    }
    
    let total = 0;
    this.subscriptions.forEach(listeners => {
      total += listeners.size;
    });
    return total;
  }
  
  /**
   * 启用/禁用事件总线
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }
  
  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.enabled;
  }
  
  /**
   * 销毁实例（用于测试）
   */
  static destroyInstance(): void {
    if (UIEventBus.instance) {
      UIEventBus.instance.subscriptions.clear();
      UIEventBus.instance = undefined as any;
    }
  }
  
  /**
   * 生成订阅ID
   */
  private generateSubscriptionId(): string {
    return `sub_${++this.subscriptionId}_${Date.now()}`;
  }
}
