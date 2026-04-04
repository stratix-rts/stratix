/**
 * UI Component Base Class
 * 
 * All UI components inherit from this base class
 * Provides unified lifecycle, theme, depth management
 */

import Phaser from 'phaser';


import { DesignSystemConfig, getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';

import type { UIComponentConfig } from './types';

export abstract class UIComponentBase {
  protected scene: Phaser.Scene;
  protected config: UIComponentConfig;
  
  protected container: Phaser.GameObjects.Container | Phaser.GameObjects.DOMElement;
  protected isVisible: boolean = true;
  protected depthLayer: number;
  
  public readonly id: string;
  
  constructor(scene: Phaser.Scene, config: UIComponentConfig) {
    this.scene = scene;
    this.config = {
      padding: 16,
      visible: true,
      depth: Depth.UI_MODAL_CONTENT,
      ...config,
    };
    this.depthLayer = this.config.depth ?? Depth.UI_MODAL_CONTENT;
    this.id = this.generateId();
  }
  
  abstract create(): void;
  
  destroy(): void {
    this.onBeforeDestroy();
    this.container?.destroy();
    this.onAfterDestroy();
  }
  
  show(animate: boolean = true): Promise<void> {
    if (this.isVisible) return Promise.resolve();
    
    this.isVisible = true;
    this.container?.setVisible(true);
    
    if (animate) {
      return this.animateIn();
    }
    return Promise.resolve();
  }
  
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
        duration: 250,
        ease: 'Power2',
        onComplete: () => resolve(),
      });
    });
  }
  
  protected animateOut(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.container) {
        resolve();
        return;
      }
      
      this.scene.tweens.add({
        targets: this.container,
        alpha: 0,
        duration: 250,
        ease: 'Power2',
        onComplete: () => resolve(),
      });
    });
  }
  
  protected onBeforeDestroy(): void {}
  protected onAfterDestroy(): void {}
  
  private generateId(): string {
    return `${this.constructor.name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
