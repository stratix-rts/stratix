/**
 * ParticleEffects - Lightweight particle effect system for agent status changes.
 *
 * Uses tween-based circle particles (Phaser 3 built-in particle emitter can be swapped in later).
 * Singleton class, lazy-initialized with the scene.
 * V2: Theme-aware colors, new animations (zone expand/shrink, agent ripple, confetti).
 */

import Phaser from 'phaser';

import { getDSColor, isReducedMotion } from '../themes/ThemeColors';

export type ParticleEmitter = Phaser.Tweens.Tween[];

interface ParticleOptions {
  x: number;
  y: number;
  color?: number;
  count?: number;
  radius?: number;
  duration?: number;
  speed?: number;
}

function tintToNumber(color: string): number {
  const hex = color.replace('#', '');
  if (!/^[0-9A-Fa-f]{6}$/.test(hex)) {
    return 0x00ffff; // fallback
  }
  return parseInt(hex, 16);
}

/** Get theme-aware default particle colors */
function getDefaultParticleColors() {
  return {
    spawn: getDSColor('color-primary'),
    levelUp: getDSColor('status-success'),
    error: getDSColor('status-danger'),
    idle: getDSColor('text-muted'),
    taskExecution: getDSColor('status-success'),
    statusChange: 0xffffff,
    confetti: [getDSColor('color-primary'), getDSColor('status-success'), getDSColor('status-warning'), getDSColor('accent')],
    ripple: getDSColor('color-primary'),
  };
}

export class ParticleEffects {
  private static instance: ParticleEffects | null = null;
  private scene: Phaser.Scene | null = null;
  private particleGraphics: Phaser.GameObjects.Graphics | null = null;
  private particleTextureGenerated: boolean = false;

  private constructor() {}

  static getInstance(): ParticleEffects {
    if (!ParticleEffects.instance) {
      ParticleEffects.instance = new ParticleEffects();
    }
    return ParticleEffects.instance;
  }

  private ensureScene(scene: Phaser.Scene): void {
    if (!this.scene) {
      this.scene = scene;
      this.particleGraphics = scene.add.graphics();
      this.particleGraphics.setDepth(900);
      this.generateParticleTexture(scene);
    } else if (this.scene !== scene) {
      // Destroy old graphics when scene changes to prevent memory leak
      if (this.particleGraphics && this.particleGraphics.active) {
        this.particleGraphics.destroy();
      }
      this.scene = scene;
      this.particleGraphics = scene.add.graphics();
      this.particleGraphics.setDepth(900);
    }
  }

  destroy(): void {
    if (this.particleGraphics && this.particleGraphics.active) {
      this.particleGraphics.destroy();
    }
    this.scene = null;
    this.particleGraphics = null;
    this.particleTextureGenerated = false;
    ParticleEffects.instance = null;
  }

  private generateParticleTexture(scene: Phaser.Scene): void {
    if (this.particleTextureGenerated) return;
    const graphics = scene.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff, 1);
    graphics.fillCircle(8, 8, 8);
    graphics.generateTexture('particle', 16, 16);
    graphics.destroy();
    this.particleTextureGenerated = true;
  }

  /**
   * spawnBurst - particles burst outward when an agent spawns.
   * Returns tweens so caller can stop/destroy.
   */
  spawnBurst(scene: Phaser.Scene, x: number, y: number, color?: string): ParticleEmitter {
    this.ensureScene(scene);
    const colors = getDefaultParticleColors();
    const c = color ? tintToNumber(color) : colors.spawn;
    const tweens: Phaser.Tweens.Tween[] = [];
    const count = 12;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const distance = 60 + Math.random() * 40;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance;
      const size = 3 + Math.random() * 4;

      const circle = this.scene!.add.graphics();
      circle.fillStyle(c, 1);
      circle.fillCircle(0, 0, size);
      circle.setPosition(x, y);
      circle.setDepth(901);

      const tween = this.scene!.tweens.add({
        targets: circle,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 0.1,
        scaleY: 0.1,
        duration: 500 + Math.random() * 200,
        ease: 'Power2.easeOut',
        onComplete: () => {
          circle.destroy();
        },
      });
      tweens.push(tween);
    }

    return tweens;
  }

  /**
   * levelUp - golden sparkles burst upward when an agent completes a task.
   * Returns tweens so caller can stop/destroy.
   */
  levelUp(scene: Phaser.Scene, x: number, y: number): ParticleEmitter {
    this.ensureScene(scene);
    const colors = getDefaultParticleColors();
    const tweens: Phaser.Tweens.Tween[] = [];
    const count = 16;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const distance = 40 + Math.random() * 60;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance - 30 - Math.random() * 40;
      const size = 2 + Math.random() * 3;
      const delay = Math.random() * 200;

      const circle = this.scene!.add.graphics();
      circle.fillStyle(colors.levelUp, 1);
      circle.fillCircle(0, 0, size);
      circle.setPosition(x, y);
      circle.setDepth(901);

      const tween = this.scene!.tweens.add({
        targets: circle,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: 600 + Math.random() * 300,
        delay,
        ease: 'Power2.easeOut',
        onComplete: () => {
          circle.destroy();
        },
      });
      tweens.push(tween);
    }

    return tweens;
  }

  /**
   * errorFlash - red particles that flash and fade quickly when an agent errors.
   * Returns tweens so caller can stop/destroy.
   */
  errorFlash(scene: Phaser.Scene, x: number, y: number): ParticleEmitter {
    this.ensureScene(scene);
    const colors = getDefaultParticleColors();
    const tweens: Phaser.Tweens.Tween[] = [];
    const count = 8;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const distance = 20 + Math.random() * 30;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance;
      const size = 4 + Math.random() * 4;
      const delay = Math.random() * 100;

      const circle = this.scene!.add.graphics();
      circle.fillStyle(colors.error, 0.9);
      circle.fillCircle(0, 0, size);
      circle.setPosition(x, y);
      circle.setDepth(901);

      const tween = this.scene!.tweens.add({
        targets: circle,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 0.05,
        scaleY: 0.05,
        duration: 300 + Math.random() * 150,
        delay,
        ease: 'Power2.easeIn',
        onComplete: () => {
          circle.destroy();
        },
      });
      tweens.push(tween);
    }

    return tweens;
  }

  /**
   * idlePulse - gentle floating particles around an idle agent.
   * Returns tweens that can be stopped via stopEmitters().
   * Note: idlePulse tweens self-restart; stopEmitters() destroys the circles.
   */
  idlePulse(scene: Phaser.Scene, x: number, y: number, color?: string): ParticleEmitter {
    this.ensureScene(scene);
    const colors = getDefaultParticleColors();
    const c = color ? tintToNumber(color) : colors.idle;
    const tweens: Phaser.Tweens.Tween[] = [];
    const circles: Phaser.GameObjects.Graphics[] = [];
    const delayedCalls: Phaser.Time.TimerEvent[] = [];
    const count = 5;

    for (let i = 0; i < count; i++) {
      const offsetX = (Math.random() - 0.5) * 50;
      const offsetY = (Math.random() - 0.5) * 50;
      const floatY = -10 - Math.random() * 15;
      const size = 2 + Math.random() * 2;
      const delay = i * 200;
      const duration = 1000 + Math.random() * 500;

      const circle = this.scene!.add.graphics();
      circle.fillStyle(c, 0.6);
      circle.fillCircle(0, 0, size);
      circle.setPosition(x + offsetX, y + offsetY);
      circle.setDepth(901);
      circles.push(circle);

      const createPulse = (): void => {
        circle.setPosition(x + offsetX, y + offsetY);
        circle.setAlpha(0.6);
        const t = this.scene!.tweens.add({
          targets: circle,
          y: circle.y + floatY,
          alpha: 0,
          duration,
          ease: 'Power2.easeOut',
          onComplete: () => createPulse(),
        });
        tweens.push(t);
      };

      delayedCalls.push(this.scene!.time.delayedCall(delay, createPulse));
    }

    // Augment tweens with circles so stopEmitters can clean them up
    (tweens as any).__circles = circles;
    (tweens as any).__delayedCalls = delayedCalls;
    return tweens;
  }

  /**
   * Stop all active tweens from a previous call.
   */
  stopEmitters(emitters: ParticleEmitter): void {
    // For idlePulse/taskExecution, also destroy the circles
    const circles = (emitters as any).__circles as Phaser.GameObjects.Graphics[] | undefined;
    if (circles) {
      circles.forEach(c => c.destroy());
    }
    // Cancel pending delayedCalls to prevent createPulse from firing after circles destroyed
    const delayedCalls = (emitters as any).__delayedCalls as Phaser.Time.TimerEvent[] | undefined;
    if (delayedCalls) {
      delayedCalls.forEach(dc => dc.remove());
    }
    emitters.forEach(tween => {
      tween.stop();
    });
  }

  /**
   * taskExecution - energy particles that continuously emit while an agent is working on a task.
   * Returns tweens that self-restart until stopped via stopEmitters().
   */
  taskExecution(scene: Phaser.Scene, x: number, y: number, color?: string): ParticleEmitter {
    this.ensureScene(scene);
    const colors = getDefaultParticleColors();
    const c = color ? tintToNumber(color) : colors.taskExecution;
    const tweens: Phaser.Tweens.Tween[] = [];
    const circles: Phaser.GameObjects.Graphics[] = [];
    const delayedCalls: Phaser.Time.TimerEvent[] = [];
    const count = 8;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const radius = 30 + Math.random() * 20;
      const offsetX = Math.cos(angle) * radius;
      const offsetY = Math.sin(angle) * radius;
      const size = 3 + Math.random() * 3;
      const delay = i * 150;
      const duration = 600 + Math.random() * 400;

      const circle = this.scene!.add.graphics();
      circle.fillStyle(c, 0.8);
      circle.fillCircle(0, 0, size);
      circle.setPosition(x + offsetX, y + offsetY);
      circle.setDepth(901);
      circles.push(circle);

      const createPulse = (): void => {
        circle.setPosition(x + offsetX, y + offsetY);
        circle.setAlpha(0.8);
        const t = this.scene!.tweens.add({
          targets: circle,
          y: circle.y - 20 - Math.random() * 20,
          x: circle.x + (Math.random() - 0.5) * 10,
          alpha: 0,
          duration,
          ease: 'Power2.easeOut',
          onComplete: () => createPulse(),
        });
        tweens.push(t);
      };

      delayedCalls.push(this.scene!.time.delayedCall(delay, createPulse));
    }

    (tweens as any).__circles = circles;
    (tweens as any).__delayedCalls = delayedCalls;
    return tweens;
  }

  /**
   * statusChange - particles burst when agent status changes (e.g., online->busy, busy->online).
   * Color indicates the new status.
   */
  statusChange(scene: Phaser.Scene, x: number, y: number, status: 'online' | 'busy' | 'offline' | 'error'): ParticleEmitter {
    this.ensureScene(scene);
    const colors = getDefaultParticleColors();
    const statusColorMap: Record<string, number> = {
      online: colors.spawn,
      busy: colors.taskExecution,
      offline: colors.idle,
      error: colors.error,
    };
    const c = statusColorMap[status] ?? colors.statusChange;
    const tweens: Phaser.Tweens.Tween[] = [];
    const count = 12;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const distance = 40 + Math.random() * 30;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance;
      const size = 2 + Math.random() * 3;

      const circle = this.scene!.add.graphics();
      circle.fillStyle(c, 1);
      circle.fillCircle(0, 0, size);
      circle.setPosition(x, y);
      circle.setDepth(901);

      const tween = this.scene!.tweens.add({
        targets: circle,
        x: targetX,
        y: targetY,
        alpha: 0,
        scaleX: 0.2,
        scaleY: 0.2,
        duration: 400 + Math.random() * 200,
        ease: 'Power2.easeOut',
        onComplete: () => {
          circle.destroy();
        },
      });
      tweens.push(tween);
    }

    return tweens;
  }

  // ========================================================================
  // New V2 Effects
  // ========================================================================

  /**
   * zoneCreateExpand - expanding ring animation when a zone is created
   */
  zoneCreateExpand(scene: Phaser.Scene, x: number, y: number, width: number, height: number, color?: number): ParticleEmitter {
    this.ensureScene(scene);
    if (isReducedMotion()) return [];

    const c = color ?? getDSColor('color-primary');
    const tweens: Phaser.Tweens.Tween[] = [];
    const graphics = scene.add.graphics();
    graphics.setDepth(902);

    const halfW = width / 2;
    const halfH = height / 2;
    const expandData = { sx: 0, sy: 0, alpha: 0.8 };

    const tween = scene.tweens.add({
      targets: expandData,
      sx: 1,
      sy: 1,
      alpha: 0,
      duration: 500,
      ease: 'Back.easeOut',
      onUpdate: () => {
        graphics.clear();
        graphics.lineStyle(2, c, expandData.alpha);
        graphics.strokeRect(
          x - halfW * expandData.sx,
          y - halfH * expandData.sy,
          width * expandData.sx,
          height * expandData.sy
        );
        graphics.fillStyle(c, expandData.alpha * 0.1);
        graphics.fillRect(
          x - halfW * expandData.sx,
          y - halfH * expandData.sy,
          width * expandData.sx,
          height * expandData.sy
        );
      },
      onComplete: () => {
        graphics.destroy();
      }
    });
    tweens.push(tween);
    return tweens;
  }

  /**
   * zoneDeleteShrink - shrinking animation when a zone is deleted
   */
  zoneDeleteShrink(scene: Phaser.Scene, x: number, y: number, width: number, height: number, color?: number): ParticleEmitter {
    this.ensureScene(scene);
    if (isReducedMotion()) return [];

    const c = color ?? getDSColor('status-danger');
    const tweens: Phaser.Tweens.Tween[] = [];
    const graphics = scene.add.graphics();
    graphics.setDepth(902);

    const halfW = width / 2;
    const halfH = height / 2;
    const shrinkData = { sx: 1, sy: 1, alpha: 0.6 };

    const tween = scene.tweens.add({
      targets: shrinkData,
      sx: 0,
      sy: 0,
      alpha: 0,
      duration: 400,
      ease: 'Power2.easeIn',
      onUpdate: () => {
        graphics.clear();
        graphics.lineStyle(2, c, shrinkData.alpha);
        graphics.strokeRect(
          x - halfW * shrinkData.sx,
          y - halfH * shrinkData.sy,
          width * shrinkData.sx,
          height * shrinkData.sy
        );
      },
      onComplete: () => {
        graphics.destroy();
      }
    });
    tweens.push(tween);
    return tweens;
  }

  /**
   * agentArrivalRipple - ripple effect when an agent arrives at a destination
   */
  agentArrivalRipple(scene: Phaser.Scene, x: number, y: number, color?: number): ParticleEmitter {
    this.ensureScene(scene);
    if (isReducedMotion()) return [];

    const c = color ?? getDSColor('color-primary');
    const tweens: Phaser.Tweens.Tween[] = [];
    const graphics = scene.add.graphics();
    graphics.setDepth(902);

    const rippleData = { radius: 10, alpha: 0.7 };
    const tween = scene.tweens.add({
      targets: rippleData,
      radius: 50,
      alpha: 0,
      duration: 600,
      ease: 'Power2.easeOut',
      onUpdate: () => {
        graphics.clear();
        graphics.lineStyle(2, c, rippleData.alpha);
        graphics.strokeCircle(x, y, rippleData.radius);
        graphics.fillStyle(c, rippleData.alpha * 0.1);
        graphics.fillCircle(x, y, rippleData.radius);
      },
      onComplete: () => {
        graphics.destroy();
      }
    });
    tweens.push(tween);
    return tweens;
  }

  /**
   * taskCompleteConfetti - confetti burst for task completion
   */
  taskCompleteConfetti(scene: Phaser.Scene, x: number, y: number): ParticleEmitter {
    this.ensureScene(scene);
    if (isReducedMotion()) return [];

    const colors = getDefaultParticleColors();
    const confettiColors = colors.confetti;
    const tweens: Phaser.Tweens.Tween[] = [];
    const count = 20;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
      const distance = 50 + Math.random() * 80;
      const targetX = x + Math.cos(angle) * distance;
      const targetY = y + Math.sin(angle) * distance - Math.random() * 40;
      const color = confettiColors[i % confettiColors.length];
      const sizeW = 4 + Math.random() * 4;
      const sizeH = 2 + Math.random() * 3;

      const rect = scene.add.graphics();
      rect.fillStyle(color, 1);
      rect.fillRect(-sizeW / 2, -sizeH / 2, sizeW, sizeH);
      rect.setPosition(x, y);
      rect.setDepth(901);
      rect.setRotation(Math.random() * Math.PI);

      const tween = scene.tweens.add({
        targets: rect,
        x: targetX,
        y: targetY,
        alpha: 0,
        rotation: rect.rotation + Math.PI * 2,
        duration: 700 + Math.random() * 400,
        ease: 'Power2.easeOut',
        onComplete: () => {
          rect.destroy();
        },
      });
      tweens.push(tween);
    }

    return tweens;
  }
}
