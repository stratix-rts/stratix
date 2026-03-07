/**
 * Theme Context - 主题上下文管理器
 * 
 * 提供响应式的主题管理系统
 * 与Design System深度集成
 */

import { DesignSystemConfig, getCurrentTheme } from '@/design-system/config';
import type { DesignSystemTokens, ThemeName } from '@/design-system/types';
import type { ThemeChangeHandler, TokenChangeHandler, ThemeContextState } from '../../core/types/theme.types';
import { ReactiveToken } from './ReactiveToken';

export class ThemeContext {
  private static instance: ThemeContext;
  private currentTheme: ThemeName;
  private subscribers: Set<ThemeChangeHandler> = new Set();
  private tokenSubscriptions: Map<string, Set<TokenChangeHandler>> = new Map();
  private isTransitioning: boolean = false;
  
  private constructor() {
    this.currentTheme = DesignSystemConfig.activeTheme;
    this.listenToThemeChanges();
  }
  
  /**
   * 获取单例实例
   */
  static getInstance(): ThemeContext {
    if (!ThemeContext.instance) {
      ThemeContext.instance = new ThemeContext();
    }
    return ThemeContext.instance;
  }
  
  /**
   * 监听全局主题变化事件（由design-system/config.ts触发）
   */
  private listenToThemeChanges(): void {
    window.addEventListener('theme:change', ((event: CustomEvent<ThemeName>) => {
      this.handleThemeChange(event.detail);
    }) as EventListener);
  }
  
  /**
   * 处理主题变化
   */
  private handleThemeChange(newThemeName: ThemeName): void {
    const oldThemeName = this.currentTheme;
    this.currentTheme = newThemeName;
    
    console.log(`[ThemeContext] Theme changed: ${oldThemeName} -> ${newThemeName}`);
    
    this.isTransitioning = true;
    
    try {
      this.notifyAllSubscribers();
    } finally {
      this.isTransitioning = false;
    }
  }
  
  /**
   * 订阅主题变化
   * 
   * @param handler - 变化处理器
   * @returns 取消订阅的函数
   */
  subscribe(handler: ThemeChangeHandler): () => void {
    this.subscribers.add(handler);
    
    // 返回取消订阅函数
    return () => {
      this.subscribers.delete(handler);
    };
  }
  
  /**
   * 订阅特定Token的变化
   * 
   * @param tokenPath - Token路径，如 'colors.primary'
   * @param handler - 变化处理器
   * @returns 取消订阅的函数
   */
  subscribeToken(tokenPath: string, handler: TokenChangeHandler): () => void {
    if (!this.tokenSubscriptions.has(tokenPath)) {
      this.tokenSubscriptions.set(tokenPath, new Set());
    }
    
    this.tokenSubscriptions.get(tokenPath)!.add(handler);
    
    return () => {
      const subscriptions = this.tokenSubscriptions.get(tokenPath);
      if (subscriptions) {
        subscriptions.delete(handler);
        // 如果没有订阅者了，清理Map
        if (subscriptions.size === 0) {
          this.tokenSubscriptions.delete(tokenPath);
        }
      }
    };
  }
  
  /**
   * 通知所有订阅者
   */
  private notifyAllSubscribers(): void {
    const theme = this.getTheme();
    
    // 通知全局主题订阅者
    this.subscribers.forEach(handler => {
      try {
        handler(theme);
      } catch (error) {
        console.error('[ThemeContext] Error in theme change handler:', error);
      }
    });
    
    // 通知Token订阅者
    this.tokenSubscriptions.forEach((handlers, tokenPath) => {
      const value = this.getTokenValue(tokenPath);
      handlers.forEach(handler => {
        try {
          handler(value);
        } catch (error) {
          console.error(`[ThemeContext] Error in token change handler for ${tokenPath}:`, error);
        }
      });
    });
  }
  
  /**
   * 切换主题
   * 
   * @param themeName - 主题名称
   */
  changeTheme(themeName: ThemeName): void {
    if (themeName === this.currentTheme) {
      console.log(`[ThemeContext] Theme ${themeName} is already active`);
      return;
    }
    
    // 使用design-system的setTheme方法，会自动触发theme:change事件
    const { setTheme } = require('@/design-system/config');
    setTheme(themeName);
  }
  
  /**
   * 获取当前主题
   */
  getTheme(): DesignSystemTokens {
    return getCurrentTheme();
  }
  
  /**
   * 获取当前主题名称
   */
  getCurrentThemeName(): ThemeName {
    return this.currentTheme;
  }
  
  /**
   * 获取Token值
   * 
   * @param path - Token路径，如 'colors.primary'
   * @returns Token值
   */
  getTokenValue(path: string): any {
    const theme = this.getTheme();
    return path.split('.').reduce((obj, key) => {
      return obj?.[key as keyof typeof obj];
    }, theme as any);
  }
  
  /**
   * 创建响应式Token
   * 
   * @param path - Token路径
   * @returns ReactiveToken实例
   */
  createReactiveToken<T = any>(path: string): ReactiveToken<T> {
    return new ReactiveToken<T>(this, path);
  }
  
  /**
   * 获取上下文状态（用于调试）
   */
  getState(): ThemeContextState {
    return {
      currentTheme: this.currentTheme,
      isTransitioning: this.isTransitioning,
      subscriberCount: this.subscribers.size + Array.from(this.tokenSubscriptions.values()).reduce((sum, set) => sum + set.size, 0),
    };
  }
  
  /**
   * 清理所有订阅（用于测试）
   */
  clearAllSubscriptions(): void {
    this.subscribers.clear();
    this.tokenSubscriptions.clear();
  }
  
  /**
   * 销毁实例（用于测试）
   */
  static destroyInstance(): void {
    if (ThemeContext.instance) {
      ThemeContext.instance.clearAllSubscriptions();
      ThemeContext.instance = undefined as any;
    }
  }
}
