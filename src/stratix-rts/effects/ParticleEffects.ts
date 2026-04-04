/**
 * ParticleEffects - Lightweight particle effect system for agent status changes.
 *
 * Uses tween-based circle particles (Phaser 3 built-in particle emitter can be swapped in later).
 * Singleton class, lazy-initialized with the scene.
 */

import Phaser from 'phaser';

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

const DEFAULT_PARTICLE_COLORS = {
  spawn: 0x00ffff,
  levelUp: 0xffd700,
  error: 0xff3333,
  idle: 0x88aaff,
  taskExecution: 0x00ff88,
  statusChange: 0xffffff,
};

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
      this.scene = scene;
      if (!this.particleGraphics || !this.particleGraphics.active) {
        this.particleGraphics = scene.add.graphics();
        this.particleGraphics.setDepth(900);
      }
    }
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
    const c = color ? tintToNumber(color) : DEFAULT_PARTICLE_COLORS.spawn;
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
      circle.fillStyle(DEFAULT_PARTICLE_COLORS.levelUp, 1);
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
      circle.fillStyle(DEFAULT_PARTICLE_COLORS.error, 0.9);
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
    const c = color ? tintToNumber(color) : DEFAULT_PARTICLE_COLORS.idle;
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
    const c = color ? tintToNumber(color) : DEFAULT_PARTICLE_COLORS.taskExecution;
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
    const statusColorMap: Record<string, number> = {
      online: DEFAULT_PARTICLE_COLORS.spawn,
      busy: DEFAULT_PARTICLE_COLORS.taskExecution,
      offline: DEFAULT_PARTICLE_COLORS.idle,
      error: DEFAULT_PARTICLE_COLORS.error,
    };
    const c = statusColorMap[status] ?? DEFAULT_PARTICLE_COLORS.statusChange;
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
}
