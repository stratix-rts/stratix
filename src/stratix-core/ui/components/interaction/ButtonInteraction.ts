/**
 * Button Interaction
 * 
 * 按钮交互适配器
 * 实现与Vue按钮一致的交互行为
 */

import Phaser from 'phaser';
import { InteractionAdapter } from './InteractionAdapter';
import { InteractionState } from '../../core/types/interaction.types';
import type { ButtonInteractionConfig } from '../../core/types/interaction.types';

export class ButtonInteraction extends InteractionAdapter {
  private rectangleTarget: Phaser.GameObjects.Rectangle;
  private onClick: () => void;
  private normalColor: string;
  private hoverColor: string;
  private activeColor: string;
  private disabledColor: string;
  private animationDuration: number;
  
  constructor(target: Phaser.GameObjects.Rectangle, config: ButtonInteractionConfig) {
    super(target, config);
    
    this.rectangleTarget = target;
    this.onClick = config.onClick;
    
    // 从设计系统获取默认颜色
    this.normalColor = config.normalColor || this.getToken('colors.background.tertiary');
    this.hoverColor = config.hoverColor || this.getToken('colors.accent');
    this.activeColor = config.activeColor || this.getToken('colors.secondary');
    this.disabledColor = config.disabledColor || this.getToken('colors.border.default');
    this.animationDuration = config.animationDuration || this.theme.animation.duration.fast;
  }
  
  enable(): void {
    this.rectangleTarget.setInteractive({ useHandCursor: true });
    
    this.rectangleTarget.on('pointerover', this.onPointerOver, this);
    this.rectangleTarget.on('pointerout', this.onPointerOut, this);
    this.rectangleTarget.on('pointerdown', this.onPointerDown, this);
    this.rectangleTarget.on('pointerup', this.onPointerUp, this);
    
    // 设置初始颜色
    this.setState(InteractionState.IDLE);
    this.tweenColor(this.normalColor);
  }
  
  disable(): void {
    this.rectangleTarget.removeInteractive();
    
    this.rectangleTarget.off('pointerover', this.onPointerOver, this);
    this.rectangleTarget.off('pointerout', this.onPointerOut, this);
    this.rectangleTarget.off('pointerdown', this.onPointerDown, this);
    this.rectangleTarget.off('pointerup', this.onPointerUp, this);
  }
  
  destroy(): void {
    this.disable();
  }
  
  /**
   * 设置禁用状态
   */
  setDisabled(disabled: boolean): void {
    if (disabled) {
      this.setState(InteractionState.DISABLED);
      this.tweenColor(this.disabledColor);
      this.rectangleTarget.disableInteractive();
    } else {
      this.setState(InteractionState.IDLE);
      this.tweenColor(this.normalColor);
      this.rectangleTarget.setInteractive({ useHandCursor: true });
    }
  }
  
  /**
   * 设置颜色
   */
  setColors(config: Partial<ButtonInteractionConfig>): void {
    if (config.normalColor) this.normalColor = config.normalColor;
    if (config.hoverColor) this.hoverColor = config.hoverColor;
    if (config.activeColor) this.activeColor = config.activeColor;
    if (config.disabledColor) this.disabledColor = config.disabledColor;
    
    // 更新当前颜色
    this.updateCurrentColor();
  }
  
  private onPointerOver(): void {
    if (this.state === InteractionState.DISABLED) return;
    
    this.setState(InteractionState.HOVER);
    this.tweenColor(this.hoverColor);
  }
  
  private onPointerOut(): void {
    if (this.state === InteractionState.DISABLED) return;
    
    this.setState(InteractionState.IDLE);
    this.tweenColor(this.normalColor);
  }
  
  private onPointerDown(): void {
    if (this.state === InteractionState.DISABLED) return;
    
    this.setState(InteractionState.ACTIVE);
    this.tweenColor(this.activeColor);
  }
  
  private onPointerUp(): void {
    if (this.state === InteractionState.DISABLED) return;
    
    this.onClick();
    this.setState(InteractionState.HOVER);
    this.tweenColor(this.hoverColor);
  }
  
  private tweenColor(color: string): void {
    const scene = this.rectangleTarget.scene;
    
    scene.tweens.add({
      targets: this.rectangleTarget,
      fillColor: this.hexToNumber(color),
      duration: this.animationDuration,
      ease: 'Power2',
    });
  }
  
  private updateCurrentColor(): void {
    switch (this.state) {
      case InteractionState.IDLE:
        this.tweenColor(this.normalColor);
        break;
      case InteractionState.HOVER:
        this.tweenColor(this.hoverColor);
        break;
      case InteractionState.ACTIVE:
        this.tweenColor(this.activeColor);
        break;
      case InteractionState.DISABLED:
        this.tweenColor(this.disabledColor);
        break;
    }
  }
}
