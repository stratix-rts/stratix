/**
 * Interaction Adapter Base
 * 
 * 交互适配器基类
 * 提供统一的交互行为接口
 */

import Phaser from 'phaser';

import type { DesignSystemTokens } from '@/design-system/types';

import { InteractionState } from '../../core/types/interaction.types';
import type { InteractionAdapterConfig } from '../../core/types/interaction.types';
import { ThemeContext } from '../../foundation/theme/ThemeContext';


export abstract class InteractionAdapter {
  protected target: Phaser.GameObjects.GameObject;
  protected theme: DesignSystemTokens;
  protected themeContext: ThemeContext;
  protected config: InteractionAdapterConfig;
  protected state: InteractionState = InteractionState.IDLE;
  
  constructor(target: Phaser.GameObjects.GameObject, config: InteractionAdapterConfig = {}) {
    this.target = target;
    this.config = {
      enabled: true,
      muted: false,
      ...config,
    };
    
    this.themeContext = ThemeContext.getInstance();
    this.theme = this.themeContext.getTheme();
  }
  
  /**
   * 启用交互
   */
  abstract enable(): void;
  
  /**
   * 禁用交互
   */
  abstract disable(): void;
  
  /**
   * 销毁交互
   */
  abstract destroy(): void;
  
  /**
   * 获取当前状态
   */
  getState(): InteractionState {
    return this.state;
  }
  
  /**
   * 设置状态
   */
  protected setState(state: InteractionState): void {
    this.state = state;
  }
  
  /**
   * 是否启用
   */
  isEnabled(): boolean {
    return this.config.enabled ?? true;
  }
  
  /**
   * 设置启用状态
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled) {
      this.enable();
    } else {
      this.disable();
    }
  }
  
  /**
   * 获取主题Token值
   */
  protected getToken(path: string): any {
    return this.themeContext.getTokenValue(path);
  }
  
  /**
   * 颜色转换：Hex string -> Number
   */
  protected hexToNumber(hex: string): number {
    return parseInt(hex.slice(1), 16);
  }
}
