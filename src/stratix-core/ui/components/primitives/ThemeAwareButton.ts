/**
 * Example Theme-Aware Button Component
 * 
 * 演示如何使用EnhancedUIComponent和响应式Token
 */

import Phaser from 'phaser';
import { EnhancedUIComponent } from '../base/EnhancedUIComponent';
import type { UIComponentConfig } from '../../core/types/component.types';

export interface ThemeAwareButtonConfig extends UIComponentConfig {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
}

export class ThemeAwareButton extends EnhancedUIComponent {
  private label: string;
  private onClick: () => void;
  private variant: 'primary' | 'secondary' | 'danger';
  
  // 响应式Tokens
  private backgroundColor: any;
  private textColor: any;
  private hoverColor: any;
  
  private background!: Phaser.GameObjects.Rectangle;
  private text!: Phaser.GameObjects.Text;
  
  constructor(scene: Phaser.Scene, config: ThemeAwareButtonConfig) {
    super(scene, config);
    this.label = config.label;
    this.onClick = config.onClick;
    this.variant = config.variant || 'primary';
    
    // 创建响应式Token
    this.backgroundColor = this.useToken<string>(`colors.${this.variant === 'primary' ? 'primary' : this.variant === 'danger' ? 'semantic.danger' : 'secondary'}`);
    this.textColor = this.useToken<string>('colors.text.primary');
    this.hoverColor = this.useToken<string>('colors.accent');
    
    // 订阅Token变化
    this.backgroundColor.subscribe(() => this.updateColors());
    this.textColor.subscribe(() => this.updateColors());
    this.hoverColor.subscribe(() => this.updateColors());
  }
  
  create(): void {
    // 创建容器
    this.container = this.scene.add.container(this.config.x, this.config.y);
    
    // 创建背景
    this.background = this.scene.add.rectangle(
      0,
      0,
      this.config.width || 120,
      this.config.height || 40,
      parseInt(this.backgroundColor.get().slice(1), 16)
    );
    this.background.setOrigin(0, 0);
    
    // 创建文本
    this.text = this.scene.add.text(
      (this.config.width || 120) / 2,
      (this.config.height || 40) / 2,
      this.label,
      {
        fontFamily: this.theme.typography.fontFamily.sans,
        fontSize: this.theme.typography.fontSize.md,
        color: this.textColor.get(),
      }
    );
    this.text.setOrigin(0.5);
    
    // 添加到容器
    (this.container as Phaser.GameObjects.Container).add([this.background, this.text]);
    
    // 设置交互
    this.setupInteraction();
    
    // 设置深度
    this.container.setDepth(this.depthLayer);
    
    this.onCreate();
  }
  
  private setupInteraction(): void {
    this.background.setInteractive({ useHandCursor: true });
    
    this.background.on('pointerover', () => {
      this.background.setFillStyle(parseInt(this.hoverColor.get().slice(1), 16));
    });
    
    this.background.on('pointerout', () => {
      this.background.setFillStyle(parseInt(this.backgroundColor.get().slice(1), 16));
    });
    
    this.background.on('pointerdown', () => {
      this.onClick();
    });
  }
  
  /**
   * 更新主题样式（自动响应主题变化）
   */
  protected updateThemeStyles(): void {
    this.updateColors();
    this.text.setStyle({
      fontFamily: this.theme.typography.fontFamily.sans,
      fontSize: this.theme.typography.fontSize.md,
      color: this.textColor.get(),
    });
  }
  
  private updateColors(): void {
    if (this.background) {
      this.background.setFillStyle(parseInt(this.backgroundColor.get().slice(1), 16));
    }
  }
}
