/**
 * DOM Component Base Class
 * 
 * For form elements, lists, complex layouts
 * Uses Phaser DOMElement for native HTML rendering
 */

import Phaser from 'phaser';
import { UIComponentBase } from './UIComponent.base';
import type { DOMComponentConfig } from './types';
import { Depth } from '@/design-system/tokens/depth';

export abstract class DOMComponentBase extends UIComponentBase {
  protected container: Phaser.GameObjects.DOMElement;
  protected config: DOMComponentConfig;
  
  constructor(scene: Phaser.Scene, config: DOMComponentConfig) {
    super(scene, config);
    this.config = config;
    this.depthLayer = config.depth ?? Depth.UI_MODAL_CONTENT;
  }
  
  create(): void {
    const html = this.generateHTML();
    const styles = this.generateStyles();
    
    this.container = this.scene.add.dom(
      this.config.x || 0,
      this.config.y || 0
    ).createFromHTML(html).setOrigin(0, 0);
    
    this.container.setDepth(this.depthLayer);
    
    if (styles) {
      this.applyStyles(styles);
    }
    
    this.setupEventListeners();
    this.onMounted();
  }
  
  protected abstract generateHTML(): string;
  protected generateStyles(): string { return ''; }
  protected setupEventListeners(): void {}
  protected onMounted(): void {}
  
  protected applyStyles(css: string): void {
    const node = this.container.node as HTMLElement;
    node.style.cssText += css;
  }
  
  protected getElement(selector: string): HTMLElement | null {
    const node = this.container.node as HTMLElement;
    return node.querySelector(selector);
  }
  
  protected addDelegateEvent(
    eventType: string,
    selector: string,
    handler: (event: Event, element: Element) => void
  ): void {
    const node = this.container.node as HTMLElement;
    
    node.addEventListener(eventType, (event) => {
      const target = (event.target as Element).closest(selector);
      if (target && node.contains(target)) {
        handler(event, target);
      }
    });
  }
}
