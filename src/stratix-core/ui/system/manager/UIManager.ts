/**
 * UI Manager - UI管理器
 * 
 * 统一管理所有UI组件、层级、焦点、事件
 * 是整个UI框架的核心
 */

import Phaser from 'phaser';
import { UIEventBus } from '../event/UIEventBus';
import { ThemeContext } from '../../foundation/theme/ThemeContext';
import { UIEventType } from '../../core/types/event.types';
import type { EnhancedUIComponent } from '../../components/base/EnhancedUIComponent';
import { Depth } from '@/design-system/tokens/depth';

/**
 * UI层级容器
 */
interface UILayerContainer {
  name: string;
  depth: number;
  container: Phaser.GameObjects.Container;
}

/**
 * UI管理器配置
 */
export interface UIManagerConfig {
  /** 是否启用调试模式 */
  debug?: boolean;
  /** 是否启用录制 */
  enableRecording?: boolean;
}

export class UIManager {
  private static instance: UIManager;
  private scene: Phaser.Scene | null = null;
  private layers: Map<string, UILayerContainer> = new Map();
  private components: Map<string, EnhancedUIComponent> = new Map();
  private focusStack: string[] = [];
  private eventBus: UIEventBus;
  private themeContext: ThemeContext;
  private config: Required<UIManagerConfig>;
  
  private constructor() {
    this.eventBus = UIEventBus.getInstance();
    this.themeContext = ThemeContext.getInstance();
    this.config = {
      debug: false,
      enableRecording: false,
    };
  }
  
  /**
   * 获取单例实例
   */
  static getInstance(): UIManager {
    if (!UIManager.instance) {
      UIManager.instance = new UIManager();
    }
    return UIManager.instance;
  }
  
  /**
   * 初始化UI管理器
   */
  initialize(scene: Phaser.Scene, config?: UIManagerConfig): void {
    if (this.scene) {
      console.warn('[UIManager] Already initialized');
      return;
    }
    
    this.scene = scene;
    
    if (config) {
      this.config = { ...this.config, ...config };
    }
    
    this.createLayers();
    this.setupEventListeners();
    
    console.log('[UIManager] Initialized');
  }
  
  /**
   * 创建层级容器
   */
  private createLayers(): void {
    if (!this.scene) return;
    
    const layerConfigs = [
      { name: 'background', depth: Depth.WORLD_BASE },
      { name: 'world', depth: Depth.WORLD_OBJECTS },
      { name: 'hud', depth: Depth.UI_GROUND },
      { name: 'dialog', depth: Depth.UI_MODAL_BASE },
      { name: 'popup', depth: Depth.UI_POPUP_BASE },
      { name: 'notification', depth: Depth.UI_NOTIFICATION },
      { name: 'cursor', depth: 9999 },
    ];
    
    layerConfigs.forEach(config => {
      const container = this.scene!.add.container(0, 0);
      container.setDepth(config.depth);
      container.setName(config.name);
      
      this.layers.set(config.name, {
        name: config.name,
        depth: config.depth,
        container,
      });
    });
  }
  
  /**
   * 设置全局事件监听
   */
  private setupEventListeners(): void {
    // 监听场景关闭
    this.scene?.events.once('shutdown', () => {
      this.shutdown();
    });
  }
  
  /**
   * 注册组件
   */
  registerComponent(component: EnhancedUIComponent): void {
    this.components.set(component.id, component);
    this.eventBus.emit(UIEventType.COMPONENT_CREATED, {
      componentId: component.id,
      componentType: component.constructor.name,
    });
  }
  
  /**
   * 注销组件
   */
  unregisterComponent(componentId: string): void {
    const component = this.components.get(componentId);
    if (component) {
      this.components.delete(componentId);
      
      // 从焦点栈中移除
      const index = this.focusStack.indexOf(componentId);
      if (index !== -1) {
        this.focusStack.splice(index, 1);
      }
      
      this.eventBus.emit(UIEventType.COMPONENT_DESTROYED, {
        componentId,
      });
    }
  }
  
  /**
   * 将组件添加到指定层级
   */
  addToLayer(component: EnhancedUIComponent, layerName: string): void {
    const layer = this.layers.get(layerName);
    if (layer && component['container']) {
      layer.container.add(component['container']);
      this.registerComponent(component);
    } else {
      console.warn(`[UIManager] Layer ${layerName} not found or component has no container`);
    }
  }
  
  /**
   * 获取层级容器
   */
  getLayer(layerName: string): Phaser.GameObjects.Container | undefined {
    return this.layers.get(layerName)?.container;
  }
  
  /**
   * 请求焦点
   */
  requestFocus(componentId: string): boolean {
    if (!this.components.has(componentId)) {
      console.warn(`[UIManager] Component ${componentId} not found`);
      return false;
    }
    
    // 如果已经有焦点，先释放
    if (this.focusStack.length > 0) {
      const currentId = this.focusStack[this.focusStack.length - 1];
      if (currentId === componentId) {
        return true; // 已经是焦点组件
      }
    }
    
    // 添加到焦点栈
    this.focusStack.push(componentId);
    
    this.eventBus.emit(UIEventType.FOCUS, {
      componentId,
    });
    
    return true;
  }
  
  /**
   * 释放焦点
   */
  releaseFocus(componentId: string): void {
    const index = this.focusStack.indexOf(componentId);
    if (index !== -1) {
      this.focusStack.splice(index, 1);
      
      this.eventBus.emit(UIEventType.BLUR, {
        componentId,
      });
      
      // 如果还有其他组件在栈中，恢复焦点
      if (this.focusStack.length > 0) {
        const newFocusId = this.focusStack[this.focusStack.length - 1];
        this.eventBus.emit(UIEventType.FOCUS, {
          componentId: newFocusId,
        });
      }
    }
  }
  
  /**
   * 获取当前焦点组件
   */
  getFocusedComponent(): EnhancedUIComponent | null {
    if (this.focusStack.length === 0) return null;
    const componentId = this.focusStack[this.focusStack.length - 1];
    return this.components.get(componentId) || null;
  }
  
  /**
   * 更新所有组件
   */
  update(delta: number): void {
    this.components.forEach(component => {
      component.update(delta);
    });
  }
  
  /**
   * 获取组件
   */
  getComponent(componentId: string): EnhancedUIComponent | undefined {
    return this.components.get(componentId);
  }
  
  /**
   * 获取所有组件
   */
  getAllComponents(): EnhancedUIComponent[] {
    return Array.from(this.components.values());
  }
  
  /**
   * 获取事件总线
   */
  getEventBus(): UIEventBus {
    return this.eventBus;
  }
  
  /**
   * 获取主题上下文
   */
  getThemeContext(): ThemeContext {
    return this.themeContext;
  }
  
  /**
   * 获取场景
   */
  getScene(): Phaser.Scene | null {
    return this.scene;
  }
  
  /**
   * 调试：获取所有层级信息
   */
  debugGetLayers(): UILayerContainer[] {
    return Array.from(this.layers.values());
  }
  
  /**
   * 调试：获取所有组件信息
   */
  debugGetComponents(): Array<{ id: string; type: string; state: string }> {
    return Array.from(this.components.values()).map(comp => ({
      id: comp.id,
      type: comp.constructor.name,
      state: comp.getState(),
    }));
  }
  
  /**
   * 关闭UI管理器
   */
  shutdown(): void {
    // 销毁所有组件
    this.components.forEach(component => {
      component.destroy();
    });
    this.components.clear();
    
    // 清空焦点栈
    this.focusStack = [];
    
    // 销毁层级容器
    this.layers.forEach(layer => {
      layer.container.destroy();
    });
    this.layers.clear();
    
    // 清除事件监听
    this.eventBus.off();
    
    this.scene = null;
    
    console.log('[UIManager] Shutdown complete');
  }
  
  /**
   * 销毁实例
   */
  static destroyInstance(): void {
    if (UIManager.instance) {
      UIManager.instance.shutdown();
      UIManager.instance = undefined as any;
    }
  }
}
