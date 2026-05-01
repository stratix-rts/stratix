/**
 * ToastManager - Toast 通知管理器
 *
 * - 单例模式（由 RTSUIFactory 创建并绑定到 Scene）
 * - 右上角堆叠，最大 5 个
 * - 超出时移除最早的
 * - 支持动态重排
 */

import Phaser from 'phaser';

import { ComponentState } from '@/stratix-core/ui/core/types/component.types';
import { Toast, ToastType } from './Toast';
import { HUD_LAYOUT } from './layout/HUDLayout';

export class ToastManager {
  private scene: Phaser.Scene;
  private toasts: Toast[] = [];
  private maxToasts = 5;
  private toastWidth = Toast.WIDTH;
  private rightMargin = 16;
  private topOffset = HUD_LAYOUT.topBar.height + 8;
  private gap = 8;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * 显示一条 Toast 通知
   * @param message 消息文本
   * @param type 类型: info | success | warning | error
   * @param duration 停留时长(ms)，默认 3000
   */
  show(message: string, type: ToastType = 'info', duration?: number): Toast {
    // 超出最大数量时移除最早的
    if (this.toasts.length >= this.maxToasts) {
      const oldest = this.toasts.shift();
      if (oldest) {
        oldest.destroy();
      }
    }

    const x = this.getToastX();
    const y = this.calculateY(this.toasts.length);

    const toast = new Toast(
      this.scene,
      { x, y, width: this.toastWidth, height: Toast.MIN_HEIGHT },
      {
        message,
        type,
        duration,
        onClose: (t) => this.handleToastClose(t),
      }
    );

    toast.create();
    toast.mount();
    this.toasts.push(toast);
    toast.show(true);

    return toast;
  }

  /**
   * 隐藏指定 Toast
   */
  hide(toast: Toast): void {
    toast.dismiss(true);
  }

  /**
   * 清除所有 Toast
   */
  clear(): void {
    this.toasts.forEach((t) => t.destroy());
    this.toasts = [];
  }

  /**
   * 响应窗口 resize，重新定位所有 Toast
   */
  resize(screenWidth: number): void {
    const newX = screenWidth - this.toastWidth - this.rightMargin;
    this.toasts.forEach((toast, index) => {
      const targetY = this.calculateY(index);
      const container = toast.getContainer();
      if (container) {
        // Update config so future animations use correct base x
        toast.getConfig().x = newX;
        this.scene.tweens.add({
          targets: container,
          x: newX,
          y: targetY,
          duration: 200,
          ease: 'Cubic.easeOut',
        });
      }
    });
  }

  destroy(): void {
    this.clear();
  }

  // ============ Private ============

  private getToastX(): number {
    return this.scene.scale.width - this.toastWidth - this.rightMargin;
  }

  private calculateY(index: number): number {
    let y = this.topOffset;
    for (let i = 0; i < index; i++) {
      y += (this.toasts[i]?.getCalculatedHeight() ?? Toast.MIN_HEIGHT) + this.gap;
    }
    return y;
  }

  private handleToastClose(toast: Toast): void {
    const index = this.toasts.indexOf(toast);
    if (index === -1) return;

    if (toast.getState() !== ComponentState.DESTROYED) {
      toast.destroy();
    }

    this.toasts.splice(index, 1);
    this.repositionToasts(index);
  }

  private repositionToasts(startIndex: number): void {
    for (let i = startIndex; i < this.toasts.length; i++) {
      const toast = this.toasts[i];
      const targetY = this.calculateY(i);
      const container = toast.getContainer();
      if (container) {
        this.scene.tweens.add({
          targets: container,
          y: targetY,
          duration: 250,
          ease: 'Cubic.easeOut',
        });
      }
    }
  }
}
