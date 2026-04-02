/**
 * DOM Component Base Class
 * 
 * For form elements, lists, complex layouts
 * Uses Phaser DOMElement for native HTML rendering
 * 
 * 自动集成点击穿透防护
 */

import Phaser from 'phaser';

import { DOMContainer } from './DOMContainer';
import { UIComponentBase } from './UIComponent.base';
import type { DOMComponentConfig } from './types';

import { Depth } from '@/design-system/tokens/depth';

export abstract class DOMComponentBase extends UIComponentBase {
  protected domContainer: DOMContainer | null = null;
  protected config: DOMComponentConfig = undefined as any;
  
  constructor(scene: Phaser.Scene, config: DOMComponentConfig) {
    super(scene, config);
    this.config = config;
    this.depthLayer = config.depth ?? Depth.UI_MODAL_CONTENT;
  }
  
  create(): void {
    const html = this.generateHTML();
    const styles = this.generateStyles();
    
    this.domContainer = new DOMContainer(this.scene, {
      x: this.config.x || 0,
      y: this.config.y || 0,
      width: this.config.width,
      height: this.config.height,
      html: html + (styles ? `<style>${styles}</style>` : ''),
      depth: this.depthLayer
    });
    
    this.domContainer.open();
    
    this.setupEventListeners();
    this.onMounted();
  }
  
  protected abstract generateHTML(): string;
  protected generateStyles(): string { return ''; }
  protected setupEventListeners(): void {}
  protected onMounted(): void {}
  
  protected getNode(): HTMLElement | null {
    return this.domContainer?.getNode() || null;
  }
  
  protected getElement(selector: string): HTMLElement | null {
    const node = this.getNode();
    return node?.querySelector(selector) || null;
  }
  
  protected addDelegateEvent(
    eventType: string,
    selector: string,
    handler: (event: Event, element: Element) => void
  ): void {
    const node = this.getNode();
    if (!node) return;
    
    node.addEventListener(eventType, (event) => {
      const target = (event.target as Element).closest(selector);
      if (target && node.contains(target)) {
        handler(event, target);
      }
    });
  }
  
  destroy(): void {
    this.domContainer?.destroy();
    this.domContainer = null;
    super.destroy();
  }
}
