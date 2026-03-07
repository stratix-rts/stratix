/**
 * Reactive Token - 响应式Token
 * 
 * 自动响应主题变化的Token包装器
 */

import type { ThemeContext } from './ThemeContext';
import type { TokenChangeHandler } from '../../core/types/theme.types';

export class ReactiveToken<T = any> {
  private context: ThemeContext;
  private path: string;
  private currentValue: T;
  private subscribers: Set<TokenChangeHandler<T>> = new Set();
  private unsubscribe: (() => void) | null = null;
  
  constructor(context: ThemeContext, path: string) {
    this.context = context;
    this.path = path;
    this.currentValue = context.getTokenValue(path);
    
    // 自动订阅Token变化
    this.unsubscribe = context.subscribeToken(path, (value: T) => {
      if (this.currentValue !== value) {
        const oldValue = this.currentValue;
        this.currentValue = value;
        this.notifySubscribers(oldValue, value);
      }
    });
  }
  
  /**
   * 获取当前值
   */
  get(): T {
    return this.currentValue;
  }
  
  /**
   * 获取Token路径
   */
  getPath(): string {
    return this.path;
  }
  
  /**
   * 订阅值变化
   * 
   * @param handler - 变化处理器
   * @returns 取消订阅函数
   */
  subscribe(handler: TokenChangeHandler<T>): () => void {
    this.subscribers.add(handler);
    
    return () => {
      this.subscribers.delete(handler);
    };
  }
  
  /**
   * 通知订阅者
   */
  private notifySubscribers(oldValue: T, newValue: T): void {
    this.subscribers.forEach(handler => {
      try {
        handler(newValue, oldValue);
      } catch (error) {
        console.error(`[ReactiveToken] Error in subscriber for ${this.path}:`, error);
      }
    });
  }
  
  /**
   * 强制刷新（重新从context获取值）
   */
  refresh(): void {
    const newValue = this.context.getTokenValue(this.path);
    if (this.currentValue !== newValue) {
      const oldValue = this.currentValue;
      this.currentValue = newValue;
      this.notifySubscribers(oldValue, newValue);
    }
  }
  
  /**
   * 销毁（清理订阅）
   */
  destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.subscribers.clear();
  }
  
  /**
   * 转换为字符串（调试用）
   */
  toString(): string {
    return `ReactiveToken(${this.path}=${this.currentValue})`;
  }
}
