/**
 * DOM Container - 通用 DOM 弹窗容器
 * 
 * 统一解决 DOM 弹窗点击穿透问题
 * 所有需要覆盖在 Phaser 场景之上的 DOM 元素都应该使用此容器
 * 
 * 使用方法:
 * ```typescript
 * const container = new DOMContainer(scene, {
 *   x: 100,
 *   y: 100,
 *   html: '<div>...</div>',
 *   onClickOutside: () => container.close() // 可选：点击外部关闭
 * });
 * container.open();
 * ```
 */

import Phaser from 'phaser';

import { Depth } from '@/design-system/tokens/depth';

import { domOverlayManager } from './DOMOverlayManager';


export interface DOMContainerConfig {
  x: number;
  y: number;
  width?: number;
  height?: number;
  html: string;
  depth?: number;
  /** 点击外部时触发，如果不设置则只阻止穿透不关闭 */
  onClickOutside?: () => void;
  /** 关闭后的回调 */
  onClose?: () => void;
}

export class DOMContainer {
  private scene: Phaser.Scene;
  private config: DOMContainerConfig;
  private domElement: Phaser.GameObjects.DOMElement | null = null;
  private protectId: string | null = null;
  private isOpen = false;

  constructor(scene: Phaser.Scene, config: DOMContainerConfig) {
    this.scene = scene;
    this.config = config;
  }

  /**
   * 打开弹窗
   */
  open(): Phaser.GameObjects.DOMElement {
    if (this.isOpen) {
      return this.domElement!;
    }

    this.isOpen = true;

    // 创建 DOM 元素
    this.domElement = this.scene.add.dom(
      this.config.x,
      this.config.y
    ).createFromHTML(this.config.html).setOrigin(0, 0);

    this.domElement.setDepth(this.config.depth ?? Depth.UI_MODAL_CONTENT);

    // 启用点击防护 - 阻止弹窗内点击冒泡到 Phaser Canvas
    if (this.domElement.node) {
      this.protectId = domOverlayManager.protectElement(
        this.domElement.node as HTMLElement
      );
    }

    return this.domElement;
  }

  /**
   * 关闭弹窗
   */
  close(): void {
    if (!this.isOpen) return;

    this.isOpen = false;

    // 移除点击防护
    if (this.protectId) {
      domOverlayManager.unprotectElement(this.protectId);
      this.protectId = null;
    }

    // 销毁 DOM 元素
    this.domElement?.destroy();
    this.domElement = null;

    // 触发关闭回调
    this.config.onClose?.();
  }

  /**
   * 获取 DOM 元素
   */
  getElement(): Phaser.GameObjects.DOMElement | null {
    return this.domElement;
  }

  /**
   * 获取内部 HTMLElement
   */
  getNode(): HTMLElement | null {
    return this.domElement?.node as HTMLElement | null;
  }

  /**
   * 设置可见性
   */
  setVisible(visible: boolean): void {
    this.domElement?.setVisible(visible);
  }

  /**
   * 是否已打开
   */
  isOpened(): boolean {
    return this.isOpen;
  }

  /**
   * 销毁
   */
  destroy(): void {
    this.close();
  }
}

/**
 * DOM Container 工厂函数 - 快速创建
 */
export function createDOMContainer(
  scene: Phaser.Scene,
  config: DOMContainerConfig
): DOMContainer {
  return new DOMContainer(scene, config);
}

export default DOMContainer;
