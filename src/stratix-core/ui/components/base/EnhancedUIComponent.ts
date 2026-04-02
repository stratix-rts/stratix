/**
 * Enhanced UI Component Base Class
 * 
 * 所有UI组件的增强版基类
 * 提供统一的生命周期、主题管理、深度管理
 * 
 * 特性：
 * - 响应式主题系统
 * - 自动Token订阅
 * - 生命周期管理
 * - 状态追踪
 */

import Phaser from 'phaser';

import { ComponentState } from '../../core/types/component.types';
import type { UIComponentConfig, IThemeAware, IUIComponentLifecycle } from '../../core/types/component.types';
import { ReactiveToken } from '../../foundation/theme/ReactiveToken';
import { ThemeContext } from '../../foundation/theme/ThemeContext';

import { Depth } from '@/design-system/tokens/depth';
import type { DesignSystemTokens } from '@/design-system/types';


export abstract class EnhancedUIComponent implements IThemeAware, IUIComponentLifecycle {
  protected scene: Phaser.Scene;
  protected config: UIComponentConfig;
  
  protected container: Phaser.GameObjects.Container | Phaser.GameObjects.DOMElement | null = null;
  protected isVisible: boolean = true;
  protected depthLayer: number;
  protected state: ComponentState = ComponentState.CREATED;
  
  public readonly id: string;
  
  // Theme management
  protected themeContext: ThemeContext;
  protected theme: DesignSystemTokens;
  private themeUnsubscribe: (() => void) | null = null;
  private reactiveTokens: Map<string, ReactiveToken<any>> = new Map();
  
  constructor(scene: Phaser.Scene, config: UIComponentConfig) {
    this.scene = scene;
    this.config = {
      x: 0,
      y: 0,
      visible: true,
      depth: Depth.UI_MODAL_CONTENT,
      reactiveTheme: true,
      ...config,
    };
    
    this.depthLayer = this.config.depth ?? Depth.UI_MODAL_CONTENT;
    this.id = this.generateId();
    
    // 初始化主题系统
    this.themeContext = ThemeContext.getInstance();
    this.theme = this.themeContext.getTheme();
    
    // 如果启用主题响应，订阅主题变化
    if (this.config.reactiveTheme) {
      this.themeUnsubscribe = this.themeContext.subscribe((newTheme: DesignSystemTokens) => {
        this.onThemeChange(newTheme);
      });
    }
    
    this.state = ComponentState.CREATED;
  }
  
  /**
   * 创建组件（子类必须实现）
   */
  abstract create(): void;
  
  /**
   * 挂载到场景或父容器
   */
  mount(parent?: Phaser.GameObjects.Container): void {
    if (this.state === ComponentState.MOUNTED) {
      console.warn(`[${this.constructor.name}] Component already mounted`);
      return;
    }
    
    if (parent) {
      parent.add(this.container!);
    } else {
      this.scene.add.existing(this.container!);
    }
    
    this.onMount();
    this.state = ComponentState.MOUNTED;
  }
  
  /**
   * 更新组件
   */
  update(delta: number): void {
    if (this.state !== ComponentState.MOUNTED) return;
    this.onUpdate(delta);
  }
  
  /**
   * 销毁组件
   */
  destroy(): void {
    if (this.state === ComponentState.DESTROYED) return;
    
    this.onBeforeDestroy();
    
    // 取消主题订阅
    if (this.themeUnsubscribe) {
      this.themeUnsubscribe();
      this.themeUnsubscribe = null;
    }
    
    // 销毁响应式Token
    this.reactiveTokens.forEach(token => token.destroy());
    this.reactiveTokens.clear();
    
    // 销毁容器
    this.container?.destroy();
    this.container = null;
    
    this.onAfterDestroy();
    this.state = ComponentState.DESTROYED;
  }
  
  /**
   * 显示组件
   */
  show(animate: boolean = true): Promise<void> {
    if (this.isVisible) return Promise.resolve();
    
    this.isVisible = true;
    this.container?.setVisible(true);
    
    if (animate) {
      return this.animateIn();
    }
    return Promise.resolve();
  }
  
  /**
   * 隐藏组件
   */
  hide(animate: boolean = true): Promise<void> {
    if (!this.isVisible) return Promise.resolve();
    
    if (animate) {
      return this.animateOut().then(() => {
        this.isVisible = false;
        this.container?.setVisible(false);
      });
    }
    
    this.isVisible = false;
    this.container?.setVisible(false);
    return Promise.resolve();
  }
  
  /**
   * 获取组件状态
   */
  getState(): ComponentState {
    return this.state;
  }
  
  /**
   * 获取配置
   */
  getConfig(): UIComponentConfig {
    return { ...this.config };
  }
  
  /**
   * 获取容器
   */
  getContainer(): Phaser.GameObjects.Container | Phaser.GameObjects.DOMElement | null {
    return this.container;
  }
  
  // ============ Theme Management ============
  
  /**
   * 使用响应式Token
   */
  protected useToken<T = any>(path: string): ReactiveToken<T> {
    if (!this.reactiveTokens.has(path)) {
      const token = this.themeContext.createReactiveToken<T>(path);
      this.reactiveTokens.set(path, token);
    }
    return this.reactiveTokens.get(path) as ReactiveToken<T>;
  }
  
  /**
   * 批量使用响应式Token
   */
  protected useTokens(paths: string[]): Record<string, ReactiveToken<any>> {
    const result: Record<string, ReactiveToken<any>> = {};
    paths.forEach(path => {
      result[path] = this.useToken(path);
    });
    return result;
  }
  
  /**
   * 获取Token当前值（非响应式）
   */
  protected getTokenValue(path: string): any {
    return this.themeContext.getTokenValue(path);
  }
  
  /**
   * 主题变化时的回调（子类可重写）
   */
  onThemeChange(newTheme: DesignSystemTokens): void {
    this.theme = newTheme;
    this.updateThemeStyles();
  }
  
  /**
   * 更新主题样式（子类实现）
   */
  protected updateThemeStyles(): void {
    // 子类重写此方法来更新样式
  }
  
  // ============ Lifecycle Hooks ============
  
  /**
   * 生命周期：组件创建时
   */
  onCreate(): void {}
  
  /**
   * 生命周期：组件挂载时
   */
  onMount(): void {}
  
  /**
   * 生命周期：组件更新时
   */
  onUpdate(delta: number): void {}
  
  /**
   * 生命周期：组件销毁时
   */
  onDestroy(): void {}
  
  /**
   * 生命周期：销毁前
   */
  protected onBeforeDestroy(): void {}
  
  /**
   * 生命周期：销毁后
   */
  protected onAfterDestroy(): void {}
  
  // ============ Animation ============
  
  /**
   * 进入动画
   */
  protected animateIn(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.container) {
        resolve();
        return;
      }
      
      this.container.setAlpha(0);
      
      this.scene.tweens.add({
        targets: this.container,
        alpha: 1,
        duration: this.theme.animation.duration.fast,
        ease: 'Power2',
        onComplete: () => resolve(),
      });
    });
  }
  
  /**
   * 退出动画
   */
  protected animateOut(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.container) {
        resolve();
        return;
      }
      
      this.scene.tweens.add({
        targets: this.container,
        alpha: 0,
        duration: this.theme.animation.duration.fast,
        ease: 'Power2',
        onComplete: () => resolve(),
      });
    });
  }
  
  // ============ Utilities ============
  
  /**
   * 生成唯一ID
   */
  private generateId(): string {
    const random = Math.random().toString(36).substring(2, 9);
    return `${this.constructor.name}_${Date.now()}_${random}`;
  }
  
  /**
   * 转换为字符串（调试用）
   */
  toString(): string {
    return `${this.constructor.name}(id=${this.id}, state=${this.state})`;
  }
}
