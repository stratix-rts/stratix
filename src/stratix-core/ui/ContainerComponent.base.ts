/**
 * Container Component Base Class
 * 
 * For game UI, high-frequency animations, complex interactions
 * Uses Phaser Container for canvas rendering
 */

import Phaser from 'phaser';
import { UIComponentBase } from './UIComponent.base';
import type { ContainerComponentConfig } from './types';
import { Depth } from '@/design-system/tokens/depth';
import { getToken } from '@/design-system/config';

export abstract class ContainerComponentBase extends UIComponentBase {
  protected container: Phaser.GameObjects.Container = undefined as any;
  protected config: ContainerComponentConfig = undefined as any;

  constructor(scene: Phaser.Scene, config: ContainerComponentConfig) {
    super(scene, config);
    this.config = config;
    this.depthLayer = config.depth ?? Depth.UI_GROUND;
  }
  
  create(): void {
    this.container = this.scene.add.container(
      this.config.x || 0,
      this.config.y || 0
    );
    
    this.container.setDepth(this.depthLayer);
    
    if (this.config.background?.enabled !== false) {
      this.createBackground();
    }
    
    this.createContent();
    this.setupEventListeners();
    this.onMounted();
  }
  
  protected createBackground(): void {
    const bgConfig = this.config.background || {};
    const width = this.config.width || 0;
    const height = this.config.height || 0;
    
    const bgElevated = getToken('colors.background.secondary') || '#12121a';
    const borderDefault = getToken('colors.border.default') || '#2a2a3e';
    
    const bg = this.scene.add.rectangle(
      0, 0,
      width,
      height,
      bgConfig.color ?? parseInt(bgElevated.slice(1), 16),
      bgConfig.alpha ?? 1
    );
    
    bg.setOrigin(0, 0);
    
    if (bgConfig.borderThickness) {
      bg.setStrokeStyle(
        bgConfig.borderThickness,
        bgConfig.borderColor ?? parseInt(borderDefault.slice(1), 16)
      );
    }
    
    this.container.add(bg);
  }
  
  protected abstract createContent(): void;
  protected setupEventListeners(): void {}
  protected onMounted(): void {}
  
  protected createText(
    x: number,
    y: number,
    content: string,
    style?: Phaser.Types.GameObjects.Text.TextStyle
  ): Phaser.GameObjects.Text {
    const textPrimary = getToken('colors.text.primary') || '#ffffff';
    
    const defaultStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace",
      fontSize: '14px',
      color: textPrimary,
      ...style,
    };
    
    const text = this.scene.add.text(x, y, content, defaultStyle);
    this.container.add(text);
    return text;
  }
  
  protected createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    onClick: () => void
  ): Phaser.GameObjects.Container {
    const button = this.scene.add.container(x, y);
    
    const bg = this.scene.add.rectangle(0, 0, width, height, 0x0f3460);
    bg.setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true });
    button.add(bg);
    
    const label = this.createText(0, 0, text, {
      fontSize: this.scene.add.text(0, 0, '').style.fontSize as string || '14px',
    });
    label.setOrigin(0.5);
    button.add(label);
    
    bg.on('pointerdown', onClick);
    bg.on('pointerover', () => bg.setFillStyle(0x1a4a8a));
    bg.on('pointerout', () => bg.setFillStyle(0x0f3460));
    
    this.container.add(button);
    return button;
  }
}
