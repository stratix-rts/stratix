/**
 * Room - 格子间
 * 每个 Agent 一个工位，格子间大小自适应 Zone 尺寸
 */

import Phaser from 'phaser';

import { RoomState } from './types/BuildingState';

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
  private agentLabel: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, config: RoomConfig) {
    super(scene, config.x, config.y);
    this.config = config;
    this.roomGraphics = scene.add.graphics();
    this.add(this.roomGraphics);
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
    this.render();
  }

  /** 获取格子间配置 */
  public getConfig(): RoomConfig {
    return { ...this.config };
  }

  /** 更新格子间位置和大小（resize 时调用） */
  public updateLayout(x: number, y: number, width: number, height: number): void {
    this.config.x = x;
    this.config.y = y;
    this.config.width = width;
    this.config.height = height;
    this.setPosition(x, y);
    this.render();
  }

  /** 渲染格子间 */
  private render(): void {
    this.roomGraphics.clear();

    const w = this.config.width;
    const h = this.config.height;

    // 填充颜色：占用=绿色，空闲=灰色
    const fillColor = this.config.state === 'occupied' ? 0x22c55e : 0x4b5563;
    const fillAlpha = this.config.state === 'occupied' ? 0.8 : 0.5;

    this.roomGraphics.fillStyle(fillColor, fillAlpha);
    this.roomGraphics.fillRect(-w / 2, -h / 2, w, h);

    // 边框
    this.roomGraphics.lineStyle(1, 0x000000, 0.3);
    this.roomGraphics.strokeRect(-w / 2, -h / 2, w, h);

    // 更新 Agent 标签
    if (this.agentLabel) {
      this.agentLabel.destroy();
      this.agentLabel = null;
    }

    if (this.config.agentId) {
      this.agentLabel = this.scene.add.text(0, 0, this.config.agentId.slice(0, 4), {
        fontSize: '10px',
        color: '#ffffff',
      }).setOrigin(0.5);
      this.add(this.agentLabel);
    }
  }

  destroy(fromScene?: boolean): void {
    // 子对象（roomGraphics, agentLabel）由 Container.destroy() 自动销毁
    this.agentLabel = null;
    super.destroy(fromScene);
  }
}
