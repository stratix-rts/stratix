/**
 * Room - 格子间
 * 每个 Agent 一个工位，格子间大小自适应 Zone 尺寸
 */

import Phaser from 'phaser';

import { RoomState } from './types/BuildingState';
import { AgentStateAnimator, AgentWorkState } from './AgentStateAnimator';

export interface RoomConfig {
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  state: RoomState;
  agentId?: string;
}

/** 格子间尺寸约束 */
export const ROOM_SIZE = {
  MIN: 48,
  MAX: 96,
} as const;

export class Room extends Phaser.GameObjects.Container {
  private config: RoomConfig;
  private roomGraphics: Phaser.GameObjects.Graphics;
  private agentCircle: Phaser.GameObjects.Graphics;
  private agentLabel: Phaser.GameObjects.Text;
  private animator: AgentStateAnimator;
  private agentTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, config: RoomConfig) {
    super(scene, config.x, config.y);
    this.config = config;
    this.roomGraphics = scene.add.graphics();
    this.agentCircle = scene.add.graphics();
    this.add(this.roomGraphics);
    this.add(this.agentCircle);

    // 预创建 Agent 标签
    this.agentLabel = this.scene.add.text(0, 0, '', {
      fontSize: '9px',
      color: '#ffffff',
    }).setOrigin(0.5).setVisible(false);
    this.add(this.agentLabel);

    this.animator = new AgentStateAnimator(scene, this.roomGraphics);
    this.render();
  }

  /** 分配 Agent 到此格子间 */
  public assignAgent(agentId: string): void {
    this.config.agentId = agentId;
    this.config.state = 'occupied';
    this.render();
  }

  /** 清空此格子间 */
  public unassignAgent(): void {
    this.config.agentId = undefined;
    this.config.state = 'empty';
    this.stopAgentTween();
    this.render();
  }

  /** 设置 Agent 工作状态 */
  public setAgentState(state: AgentWorkState): void {
    this.animator.setState(state);
    this.updateAgentCircle(state);
    if (state === AgentWorkState.Error) {
      this.render();
    }
  }

  /** 获取格子间配置 */
  public getConfig(): RoomConfig {
    return { ...this.config };
  }

  /** 更新格子间位置和大小（resize 时调用） */
  public updateLayout(x: number, y: number, width: number, height: number): void {
    this.config.x = x;
    this.config.y = y;
    this.config.width = Math.max(width, 0);
    this.config.height = Math.max(height, 0);
    this.setPosition(x, y);
    this.render();
  }

  /** 更新 Agent 圆圈视觉 */
  private updateAgentCircle(state: AgentWorkState): void {
    this.stopAgentTween();

    if (!this.config.agentId) return;

    switch (state) {
      case AgentWorkState.Working:
        this.startAgentPulse();
        break;
      case AgentWorkState.Waiting:
        this.startAgentFlash();
        break;
      case AgentWorkState.Error:
        this.drawAgentCircle(0xef4444);
        break;
      case AgentWorkState.Idle:
      default:
        this.drawAgentCircle(0x9ca3af);
        break;
    }
  }

  /** 绘制 Agent 圆圈 */
  private drawAgentCircle(color: number, alpha = 1): void {
    this.agentCircle.clear();
    const radius = Math.min(this.config.width, this.config.height) * 0.2;
    if (radius <= 0) return;

    this.agentCircle.fillStyle(color, alpha);
    this.agentCircle.fillCircle(0, -2, radius);
    this.agentCircle.lineStyle(1, 0xffffff, alpha * 0.5);
    this.agentCircle.strokeCircle(0, -2, radius);
  }

  /** 启动工作脉冲动画 */
  private startAgentPulse(): void {
    const data = { alpha: 0.5, scale: 0.9 };
    this.agentTween = this.scene.tweens.add({
      targets: data,
      alpha: 1,
      scale: 1.1,
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.agentCircle.clear();
        const baseRadius = Math.min(this.config.width, this.config.height) * 0.2;
        const radius = baseRadius * data.scale;
        if (radius > 0) {
          this.agentCircle.fillStyle(0x22c55e, data.alpha);
          this.agentCircle.fillCircle(0, -2, radius);
          this.agentCircle.lineStyle(1, 0xffffff, data.alpha * 0.5);
          this.agentCircle.strokeCircle(0, -2, radius);
        }
      },
    });
  }

  /** 启动等待闪烁动画 */
  private startAgentFlash(): void {
    const data = { alpha: 0.4 };
    this.agentTween = this.scene.tweens.add({
      targets: data,
      alpha: 1,
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
      onUpdate: () => {
        this.drawAgentCircle(0xeab308, data.alpha);
      },
    });
  }

  /** 停止 Agent 动画 */
  private stopAgentTween(): void {
    if (this.agentTween) {
      this.agentTween.stop();
      this.agentTween = null;
    }
    this.agentCircle.clear();
  }

  /** 渲染格子间 */
  private render(): void {
    this.roomGraphics.clear();

    const w = this.config.width;
    const h = this.config.height;

    // 跳过零或负尺寸绘制
    if (w <= 0 || h <= 0) {
      this.agentLabel.setVisible(false);
      return;
    }

    // 地板纹理
    if (this.config.state === 'empty') {
      this.drawFloorPattern(w, h, 0x9ca3af, 0.15);
    } else {
      this.drawFloorPattern(w, h, 0x6b7280, 0.1);
    }

    // 更柔和的边框（双线框）
    this.roomGraphics.lineStyle(1, 0x6b7280, 0.3);
    this.roomGraphics.strokeRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2);
    this.roomGraphics.lineStyle(1, 0x9ca3af, 0.2);
    this.roomGraphics.strokeRect(-w / 2, -h / 2, w, h);

    // 更新 Agent 标签和圆圈
    if (this.config.agentId) {
      this.agentLabel.setText(this.config.agentId.slice(0, 4)).setVisible(true);
      this.agentLabel.setY(h / 2 - 10);

      const state = this.animator.getState();
      // 静态状态在 render 中直接绘制；动态状态由 tween 接管
      if (state === AgentWorkState.Idle) {
        this.drawAgentCircle(0x9ca3af);
      } else if (state === AgentWorkState.Error) {
        this.drawAgentCircle(0xef4444);
      }
      // Working / Waiting 的 tween 会在 setAgentState 时启动，
      // 如果当前没有 tween 且状态是动态的，补启动一次
      if (
        (state === AgentWorkState.Working || state === AgentWorkState.Waiting) &&
        !this.agentTween
      ) {
        this.updateAgentCircle(state);
      }
    } else {
      this.agentLabel.setVisible(false);
      this.stopAgentTween();
    }
  }

  /** 绘制地板图案 */
  private drawFloorPattern(w: number, h: number, color: number, alpha: number): void {
    // 底色
    this.roomGraphics.fillStyle(0x374151, alpha * 0.3);
    this.roomGraphics.fillRect(-w / 2, -h / 2, w, h);

    // 网格线
    this.roomGraphics.lineStyle(1, color, alpha * 0.4);
    const gridSize = 8;
    const startX = Math.ceil(-w / 2 / gridSize) * gridSize;
    const startY = Math.ceil(-h / 2 / gridSize) * gridSize;

    for (let x = startX; x < w / 2; x += gridSize) {
      this.roomGraphics.beginPath();
      this.roomGraphics.moveTo(x, -h / 2);
      this.roomGraphics.lineTo(x, h / 2);
      this.roomGraphics.strokePath();
    }
    for (let y = startY; y < h / 2; y += gridSize) {
      this.roomGraphics.beginPath();
      this.roomGraphics.moveTo(-w / 2, y);
      this.roomGraphics.lineTo(w / 2, y);
      this.roomGraphics.strokePath();
    }
  }

  destroy(fromScene?: boolean): void {
    this.stopAgentTween();
    this.animator?.destroy();
    super.destroy(fromScene);
  }
}
