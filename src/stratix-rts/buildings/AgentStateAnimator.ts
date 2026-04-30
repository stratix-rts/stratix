import Phaser from 'phaser';

export enum AgentWorkState {
  Working = 'working',
  Idle = 'idle',
  Waiting = 'waiting',
  Error = 'error',
}

export class AgentStateAnimator {
  private scene: Phaser.Scene;
  private graphics: Phaser.GameObjects.Graphics;
  private tween: Phaser.Tweens.Tween | null = null;
  private currentState: AgentWorkState = AgentWorkState.Idle;

  constructor(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics) {
    this.scene = scene;
    this.graphics = graphics;
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
  }

  private apply(): void {
    switch (this.currentState) {
      case AgentWorkState.Working:
        this.startWorkingPulse();
        break;
      case AgentWorkState.Waiting:
        this.startWaitingFlash();
        break;
      case AgentWorkState.Error:
        // error 不需要动画，Room.render 会处理红色
        break;
      case AgentWorkState.Idle:
      default:
        // idle 无动画
        break;
    }
  }

  private startWorkingPulse(): void {
    const data = { alpha: 0.6 };
    this.tween = this.scene.tweens.add({
      targets: data,
      alpha: 1.0,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.graphics.setAlpha(data.alpha);
      },
    });
  }

  private startWaitingFlash(): void {
    const data = { alpha: 0.3 };
    this.tween = this.scene.tweens.add({
      targets: data,
      alpha: 0.8,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.graphics.setAlpha(data.alpha);
      },
    });
  }

  private stop(): void {
    if (this.tween) {
      this.tween.stop();
      this.tween = null;
    }
    this.graphics.setAlpha(1);
  }
}
