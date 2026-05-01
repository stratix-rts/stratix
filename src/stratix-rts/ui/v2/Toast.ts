/**
 * Toast Notification Component
 *
 * 赛博朋克×奇幻风格 HUD Toast
 * - 玻璃背景 + 类型色发光边框
 * - 程序化状态图标（无 emoji）
 * - 从右侧滑入 → 停留 → 淡出滑出
 * - 自动销毁
 */

import Phaser from 'phaser';

import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import { ComponentState } from '@/stratix-core/ui/core/types/component.types';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

import { isReducedMotion } from '../../themes/ThemeColors';
import { hexToNumber } from './command-panel/GradientHelper';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastConfig {
  message: string;
  type: ToastType;
  duration?: number;
  onClose?: (toast: Toast) => void;
}

export class Toast extends EnhancedUIComponent {
  private bgGraphics: Phaser.GameObjects.Graphics | null = null;
  private leftBar: Phaser.GameObjects.Graphics | null = null;
  private iconGraphics: Phaser.GameObjects.Graphics | null = null;
  private textObj: Phaser.GameObjects.Text | null = null;
  private closeBtn: Phaser.GameObjects.Container | null = null;

  private message: string;
  private toastType: ToastType;
  private duration: number;
  private onCloseCallback: ((toast: Toast) => void) | null = null;
  private autoCloseTimer: Phaser.Time.TimerEvent | null = null;
  private slideTween: Phaser.Tweens.Tween | null = null;
  private fadeTween: Phaser.Tweens.Tween | null = null;
  private isClosing = false;
  private _calculatedHeight = Toast.MIN_HEIGHT;

  // Reactive tokens
  private typeColor: ReactiveToken<string>;
  private glassBg: ReactiveToken<string>;
  private glassBorder: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;

  // Layout constants
  static readonly WIDTH = 280;
  static readonly MIN_HEIGHT = 40;
  static readonly BORDER_RADIUS = 6;
  static readonly LEFT_BAR_WIDTH = 3;
  static readonly ICON_SIZE = 16;
  static readonly PADDING = 12;
  static readonly ICON_GAP = 8;
  static readonly CLOSE_BTN_SIZE = 20;

  constructor(scene: Phaser.Scene, config: UIComponentConfig, toastConfig: ToastConfig) {
    super(scene, {
      ...config,
      depth: config.depth ?? 2000,
      reactiveTheme: true,
    });

    this.message = toastConfig.message;
    this.toastType = toastConfig.type;
    this.duration = toastConfig.duration ?? 3000;
    this.onCloseCallback = toastConfig.onClose ?? null;

    this.typeColor = this.useToken(this.getColorPathForType(this.toastType));
    this.glassBg = this.useToken('semantic.glass.background');
    this.glassBorder = this.useToken('semantic.glass.border');
    this.textPrimaryColor = this.useToken('colors.text.primary');
  }

  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(this.config.depth ?? 2000);
    this.container.setAlpha(0);

    // Measure text to compute adaptive height
    const textStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: this.theme.typography.fontFamily.sans,
      fontSize: '14px',
      color: this.textPrimaryColor.get(),
      wordWrap: {
        width:
          Toast.WIDTH -
          Toast.LEFT_BAR_WIDTH -
          Toast.PADDING * 2 -
          Toast.ICON_SIZE -
          Toast.ICON_GAP -
          Toast.CLOSE_BTN_SIZE,
      },
    };
    const tempText = this.scene.add.text(0, 0, this.message, textStyle);
    const lineHeight = 16;
    const textHeight = Math.min(tempText.height, lineHeight * 2);
    tempText.destroy();

    this._calculatedHeight = Math.max(Toast.MIN_HEIGHT, textHeight + Toast.PADDING * 2);
    const w = Toast.WIDTH;
    const h = this._calculatedHeight;

    // Background (glass)
    this.bgGraphics = this.scene.add.graphics();
    this.drawBackground(w, h);
    this.container.add(this.bgGraphics);

    // Left colored bar
    this.leftBar = this.scene.add.graphics();
    this.drawLeftBar(h);
    this.container.add(this.leftBar);

    // Icon
    this.iconGraphics = this.scene.add.graphics();
    this.drawIcon();
    this.container.add(this.iconGraphics);

    // Text
    const textX = Toast.LEFT_BAR_WIDTH + Toast.PADDING + Toast.ICON_SIZE + Toast.ICON_GAP;
    this.textObj = this.scene.add.text(textX, h / 2, this.message, {
      ...textStyle,
    });
    this.textObj.setOrigin(0, 0.5);
    this.container.add(this.textObj);

    // Close button
    this.createCloseButton(w, h);

    // Start auto-close
    this.startAutoCloseTimer();

    this.onCreate();
  }

  getCalculatedHeight(): number {
    return this._calculatedHeight;
  }

  show(animate = true): Promise<void> {
    if (this.isVisible) return Promise.resolve();
    this.isVisible = true;
    this.container?.setVisible(true);

    if (animate && !isReducedMotion()) {
      return this.animateIn();
    }
    if (this.container) {
      this.container.setAlpha(1);
      this.container.setX(this.config.x ?? 0);
    }
    return Promise.resolve();
  }

  hide(animate = true): Promise<void> {
    if (!this.isVisible) return Promise.resolve();

    if (animate && !isReducedMotion()) {
      return this.animateOut().then(() => {
        this.isVisible = false;
        this.container?.setVisible(false);
      });
    }
    this.isVisible = false;
    this.container?.setVisible(false);
    return Promise.resolve();
  }

  dismiss(animate = true): void {
    if (this.isClosing) return;
    this.isClosing = true;
    this.stopAutoCloseTimer();

    this.hide(animate).then(() => {
      this.onCloseCallback?.(this);
      // If no callback (orphaned toast), self-destruct
      if (!this.onCloseCallback) {
        this.destroy();
      }
    });
  }

  // ============ Drawing ============

  private drawBackground(w: number, h: number): void {
    if (!this.bgGraphics) return;
    const bgColor = hexToNumber(this.glassBg.get());
    const borderColor = hexToNumber(this.glassBorder.get());
    const typeColorNum = hexToNumber(this.typeColor.get());

    this.bgGraphics.clear();

    // Glass fill
    this.bgGraphics.fillStyle(bgColor, 0.82);
    this.bgGraphics.fillRoundedRect(0, 0, w, h, Toast.BORDER_RADIUS);

    // Outer glow with type color
    this.bgGraphics.lineStyle(1, typeColorNum, 0.25);
    this.bgGraphics.strokeRoundedRect(-1, -1, w + 2, h + 2, Toast.BORDER_RADIUS + 1);

    // Inner border
    this.bgGraphics.lineStyle(1, borderColor, 0.45);
    this.bgGraphics.strokeRoundedRect(0, 0, w, h, Toast.BORDER_RADIUS);
  }

  private drawLeftBar(h: number): void {
    if (!this.leftBar) return;
    const typeColorNum = hexToNumber(this.typeColor.get());
    const r = Toast.BORDER_RADIUS;

    this.leftBar.clear();
    this.leftBar.fillStyle(typeColorNum, 1);
    // Draw rounded rect on left side only
    this.leftBar.fillRoundedRect(0, 0, Toast.LEFT_BAR_WIDTH, h, {
      tl: r,
      tr: 0,
      bl: r,
      br: 0,
    });
  }

  private drawIcon(): void {
    if (!this.iconGraphics) return;
    const typeColorNum = hexToNumber(this.typeColor.get());
    const cx = Toast.LEFT_BAR_WIDTH + Toast.PADDING + Toast.ICON_SIZE / 2;
    const cy = this._calculatedHeight / 2;

    this.iconGraphics.clear();

    switch (this.toastType) {
      case 'info':
        this.drawInfoIcon(cx, cy, typeColorNum);
        break;
      case 'success':
        this.drawSuccessIcon(cx, cy, typeColorNum);
        break;
      case 'warning':
        this.drawWarningIcon(cx, cy, typeColorNum);
        break;
      case 'error':
        this.drawErrorIcon(cx, cy, typeColorNum);
        break;
    }
  }

  private drawInfoIcon(cx: number, cy: number, color: number): void {
    const r = 5;
    this.iconGraphics!.lineStyle(1.5, color, 1);
    this.iconGraphics!.strokeCircle(cx, cy, r);
    this.iconGraphics!.fillStyle(color, 1);
    this.iconGraphics!.fillCircle(cx, cy - 2, 1);
    this.iconGraphics!.lineStyle(1.5, color, 1);
    this.iconGraphics!.lineBetween(cx, cy, cx, cy + 3);
  }

  private drawSuccessIcon(cx: number, cy: number, color: number): void {
    this.iconGraphics!.lineStyle(2, color, 1);
    this.iconGraphics!.beginPath();
    this.iconGraphics!.moveTo(cx - 4, cy);
    this.iconGraphics!.lineTo(cx - 1, cy + 3);
    this.iconGraphics!.lineTo(cx + 4, cy - 3);
    this.iconGraphics!.strokePath();
  }

  private drawWarningIcon(cx: number, cy: number, color: number): void {
    const s = 5;
    const points = [
      { x: cx, y: cy - s - 1 },
      { x: cx + s + 2, y: cy + s - 1 },
      { x: cx - s - 2, y: cy + s - 1 },
    ];
    this.iconGraphics!.lineStyle(1.5, color, 1);
    this.iconGraphics!.beginPath();
    points.forEach((p, i) => {
      if (i === 0) this.iconGraphics!.moveTo(p.x, p.y);
      else this.iconGraphics!.lineTo(p.x, p.y);
    });
    this.iconGraphics!.closePath();
    this.iconGraphics!.strokePath();

    // Exclamation dot
    this.iconGraphics!.fillStyle(color, 1);
    this.iconGraphics!.fillCircle(cx, cy + 1, 1);
    this.iconGraphics!.lineBetween(cx, cy - 2, cx, cy - 1);
  }

  private drawErrorIcon(cx: number, cy: number, color: number): void {
    const s = 4;
    this.iconGraphics!.lineStyle(2, color, 1);
    this.iconGraphics!.lineBetween(cx - s, cy - s, cx + s, cy + s);
    this.iconGraphics!.lineBetween(cx + s, cy - s, cx - s, cy + s);
  }

  private createCloseButton(w: number, h: number): void {
    const size = Toast.CLOSE_BTN_SIZE;
    const bx = w - size - 4;
    const by = (h - size) / 2;

    this.closeBtn = this.scene.add.container(bx, by);

    const hitArea = this.scene.add.rectangle(size / 2, size / 2, size, size, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });

    const xGraphics = this.scene.add.graphics();
    const color = hexToNumber(this.textPrimaryColor.get());
    xGraphics.lineStyle(1.5, color, 0.6);
    const m = 6;
    xGraphics.lineBetween(m, m, size - m, size - m);
    xGraphics.lineBetween(size - m, m, m, size - m);

    hitArea.on('pointerover', () => {
      xGraphics.clear();
      const hoverColor = hexToNumber(this.typeColor.get());
      xGraphics.lineStyle(1.5, hoverColor, 1);
      xGraphics.lineBetween(m, m, size - m, size - m);
      xGraphics.lineBetween(size - m, m, m, size - m);
    });

    hitArea.on('pointerout', () => {
      xGraphics.clear();
      xGraphics.lineStyle(1.5, color, 0.6);
      xGraphics.lineBetween(m, m, size - m, size - m);
      xGraphics.lineBetween(size - m, m, m, size - m);
    });

    hitArea.on('pointerdown', () => this.dismiss(true));

    this.closeBtn.add([hitArea, xGraphics]);
    (this.container as Phaser.GameObjects.Container).add(this.closeBtn);
  }

  // ============ Animation ============

  protected animateIn(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.container) {
        resolve();
        return;
      }
      const targetX = this.config.x ?? 0;
      this.container.setX(targetX + 60);
      this.container.setAlpha(0);

      this.slideTween = this.scene.tweens.add({
        targets: this.container,
        x: targetX,
        alpha: 1,
        duration: 350,
        ease: 'Cubic.easeOut',
        onComplete: () => {
          this.slideTween = null;
          resolve();
        },
      });
    });
  }

  protected animateOut(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.container) {
        resolve();
        return;
      }
      const targetX = (this.config.x ?? 0) + 60;

      this.fadeTween = this.scene.tweens.add({
        targets: this.container,
        x: targetX,
        alpha: 0,
        duration: 250,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          this.fadeTween = null;
          resolve();
        },
      });
    });
  }

  // ============ Timer ============

  private startAutoCloseTimer(): void {
    if (this.duration <= 0) return;
    this.autoCloseTimer = this.scene.time.delayedCall(this.duration, () => {
      this.dismiss(true);
    });
  }

  private stopAutoCloseTimer(): void {
    if (this.autoCloseTimer) {
      this.autoCloseTimer.remove();
      this.autoCloseTimer = null;
    }
  }

  // ============ Helpers ============

  private getColorPathForType(type: ToastType): string {
    switch (type) {
      case 'info':
        return 'colors.accent';
      case 'success':
        return 'colors.semantic.success';
      case 'warning':
        return 'colors.semantic.warning';
      case 'error':
        return 'colors.semantic.danger';
    }
  }

  // ============ Lifecycle ============

  destroy(): void {
    if (this.state === ComponentState.DESTROYED) return;
    this.isClosing = true;
    this.stopAutoCloseTimer();

    if (this.slideTween) {
      this.slideTween.stop();
      this.slideTween = null;
    }
    if (this.fadeTween) {
      this.fadeTween.stop();
      this.fadeTween = null;
    }

    this.bgGraphics?.destroy();
    this.leftBar?.destroy();
    this.iconGraphics?.destroy();
    this.textObj?.destroy();
    this.closeBtn?.destroy();

    super.destroy();
  }
}
