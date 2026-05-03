import Phaser from 'phaser';

export enum AgentWorkState {
  Working = 'working',
  Idle = 'idle',
  Waiting = 'waiting',
  Error = 'error',
}

interface SparkParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  radius: number;
}

export class AgentStateAnimator {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private fxGraphics: Phaser.GameObjects.Graphics;
  private tween: Phaser.Tweens.Tween | null = null;
  private fxTween: Phaser.Tweens.Tween | null = null;
  private currentState: AgentWorkState = AgentWorkState.Idle;
  private themeColor: number = 0xffffff;
  private sparkTimer: Phaser.Time.TimerEvent | null = null;
  private particles: SparkParticle[] = [];
  private readonly maxParticles = 4;

  constructor(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics) {
    this.scene = scene;
    this.graphics = graphics;
    this.fxGraphics = scene.add.graphics();

    const parent = graphics.parentContainer;
    if (parent) {
      parent.add(this.fxGraphics);
      this.fxGraphics.setDepth(3);
    }
  }

  public setThemeColor(color: number): void {
    this.themeColor = color;
  }

  public setState(state: AgentWorkState): void {
    if (this.currentState === state) return;
    this.stop();
    this.currentState = state;
    this.apply();
  }

  public getState(): AgentWorkState {
    return this.currentState;
  }

  public destroy(): void {
    this.stop();
    this.fxGraphics?.destroy();
  }

  private apply(): void {
    switch (this.currentState) {
      case AgentWorkState.Working:
        this.startWorkingFx();
        break;
      case AgentWorkState.Waiting:
        this.startWaitingFx();
        break;
      case AgentWorkState.Error:
        this.startErrorFx();
        break;
      case AgentWorkState.Idle:
      default:
        this.startIdleFx();
        break;
    }
  }

  /** Working：主图形 alpha 脉冲 + 上方小火花粒子 */
  private startWorkingFx(): void {
    // Alpha 脉冲
    const pulseData = { alpha: 0.6 };
    this.tween = this.scene.tweens.add({
      targets: pulseData,
      alpha: 1.0,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.graphics.setAlpha(pulseData.alpha);
      },
    });

    // 火花粒子定时生成
    this.sparkTimer = this.scene.time.addEvent({
      delay: 180,
      repeat: -1,
      callback: () => {
        if (this.particles.length >= this.maxParticles) return;
        this.particles.push({
          x: (Math.random() - 0.5) * 16,
          y: -6,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -0.6 - Math.random() * 1.0,
          life: 25 + Math.floor(Math.random() * 20),
          maxLife: 45,
          radius: 1.2 + Math.random() * 1.3,
        });
      },
    });

    // 粒子更新循环
    const tickData = { t: 0 };
    this.fxTween = this.scene.tweens.add({
      targets: tickData,
      t: 1,
      duration: 50,
      repeat: -1,
      onUpdate: () => {
        this.fxGraphics.clear();
        const color = this.themeColor !== 0xffffff ? this.themeColor : 0xffd700;

        for (let i = this.particles.length - 1; i >= 0; i--) {
          const p = this.particles[i];
          p.x += p.vx;
          p.y += p.vy;
          p.life--;

          if (p.life <= 0) {
            this.particles.splice(i, 1);
            continue;
          }

          const alpha = (p.life / p.maxLife) * 0.9;
          this.fxGraphics.fillStyle(color, alpha);
          this.fxGraphics.fillCircle(p.x, p.y - 6, Math.max(p.radius, 0.5));
        }
      },
    });
  }

  /** Waiting：琥珀色呼吸光晕 */
  private startWaitingFx(): void {
    const data = { alpha: 0.25, scale: 0.85 };
    this.tween = this.scene.tweens.add({
      targets: data,
      alpha: 0.7,
      scale: 1.15,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.graphics.setAlpha(data.alpha);
        this.fxGraphics.clear();
        const color = this.themeColor !== 0xffffff ? this.themeColor : 0xf59e0b;
        this.fxGraphics.fillStyle(color, data.alpha * 0.18);
        this.fxGraphics.fillCircle(0, -2, 10 * data.scale);
        this.fxGraphics.lineStyle(1.5, color, data.alpha * 0.45);
        this.fxGraphics.strokeCircle(0, -2, 10 * data.scale);
      },
    });
  }

  /** Error：红色闪烁 + 警告光圈 */
  private startErrorFx(): void {
    const data = { phase: 0 };
    this.tween = this.scene.tweens.add({
      targets: data,
      phase: 1,
      duration: 600,
      repeat: -1,
      onUpdate: () => {
        this.graphics.setAlpha(0.5 + Math.sin(data.phase * Math.PI * 4) * 0.5);
        this.fxGraphics.clear();

        const ringAlpha = 0.25 + Math.sin(data.phase * Math.PI * 4) * 0.25;
        const ringRadius = 12 + Math.sin(data.phase * Math.PI * 2) * 3;

        // 警告环
        this.fxGraphics.lineStyle(2, 0xff0000, ringAlpha);
        this.fxGraphics.strokeCircle(0, -2, ringRadius);

        // 内部闪烁点
        if (Math.sin(data.phase * Math.PI * 4) > 0) {
          this.fxGraphics.fillStyle(0xff0000, 0.55);
          this.fxGraphics.fillCircle(0, -2, 3.5);
        }
      },
    });
  }

  /** Idle：柔和呼吸光 */
  private startIdleFx(): void {
    const data = { alpha: 0.15, scale: 0.8 };
    this.tween = this.scene.tweens.add({
      targets: data,
      alpha: 0.4,
      scale: 1.2,
      duration: 1800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.graphics.setAlpha(1);
        this.fxGraphics.clear();
        const color = this.themeColor !== 0xffffff ? this.themeColor : 0xa0c4ff;
        this.fxGraphics.fillStyle(color, data.alpha * 0.25);
        this.fxGraphics.fillCircle(0, -2, 9 * data.scale);
        this.fxGraphics.lineStyle(1, color, data.alpha * 0.6);
        this.fxGraphics.strokeCircle(0, -2, 9 * data.scale);
      },
    });
  }

  private stop(): void {
    if (this.tween) {
      this.scene.tweens.remove(this.tween);
      this.tween = null;
    }
    if (this.fxTween) {
      this.scene.tweens.remove(this.fxTween);
      this.fxTween = null;
    }
    if (this.sparkTimer) {
      this.sparkTimer.remove();
      this.sparkTimer = null;
    }
    this.particles = [];
    this.fxGraphics.clear();
    this.graphics.setAlpha(1);
  }
}
