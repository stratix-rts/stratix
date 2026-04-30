/**
 * Building - 建筑
 * Zone 的视觉表现，包含外壳、屋顶、格子间和标签
 */

import Phaser from 'phaser';

import { BuildingConfig, BUILDING_COLORS, BUILDING_NAMES, BuildingType } from './types/BuildingType';
import { BuildingState } from './types/BuildingState';
import { Room, ROOM_SIZE, RoomConfig } from './Room';

/** 格子间布局计算结果 */
interface GridLayout {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  rooms: RoomConfig[];
}

export class Building extends Phaser.GameObjects.Container {
  public readonly buildingType: BuildingType;
  private buildingWidth: number;
  private buildingHeight: number;

  private foundationGraphics: Phaser.GameObjects.Graphics;
  private shellGraphics: Phaser.GameObjects.Graphics;
  private roomsContainer: Phaser.GameObjects.Container;
  private buildingShell: Phaser.GameObjects.Container;
  private nameLabel: Phaser.GameObjects.Text;
  private statusLabel: Phaser.GameObjects.Text;
  private progressBar: Phaser.GameObjects.Graphics;

  private rooms: Room[] = [];
  private _buildingState: BuildingState = 'empty';
  private isInteriorVisible = false;

  constructor(scene: Phaser.Scene, config: BuildingConfig) {
    super(scene, config.x, config.y);
    this.buildingType = config.buildingType;
    this.buildingWidth = config.width;
    this.buildingHeight = config.height;

    // 初始化容器
    this.foundationGraphics = scene.add.graphics();
    this.roomsContainer = scene.add.container(0, 0);
    this.buildingShell = scene.add.container(0, 0);
    this.shellGraphics = scene.add.graphics();

    // 标签
    this.nameLabel = scene.add.text(0, -this.buildingHeight / 2 - 20, '', {
      fontSize: '14px',
      color: '#ffffff',
      fontStyle: 'bold',
      backgroundColor: '#000000aa',
      padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(5);

    this.statusLabel = scene.add.text(0, -this.buildingHeight / 2 - 6, '', {
      fontSize: '11px',
      color: '#d1d5db',
      backgroundColor: '#000000aa',
      padding: { x: 3, y: 1 },
    }).setOrigin(0.5).setDepth(5);

    this.progressBar = scene.add.graphics();
    this.progressBar.setDepth(5);

    // 组装层级
    this.buildingShell.add(this.shellGraphics);
    this.add([
      this.foundationGraphics,   // Depth 1: 地基
      this.roomsContainer,       // Depth 2-3: 格子间 + Agent
      this.buildingShell,        // Depth 4: 外墙 + 屋顶
      this.nameLabel,
      this.statusLabel,
      this.progressBar,
    ]);

    this.setDepth(1);

    // 初始渲染
    this.renderFoundation();
    this.renderShell();
    this.updateLabel();

    // 默认隐藏内部
    this.roomsContainer.setVisible(false);
    this.isInteriorVisible = false;
  }

  /** 显示内部（选中态） */
  public showInterior(): void {
    this.isInteriorVisible = true;
    this.roomsContainer.setVisible(true);
    this.buildingShell.setAlpha(0);
  }

  /** 隐藏内部（默认态） */
  public hideInterior(): void {
    this.isInteriorVisible = false;
    this.roomsContainer.setVisible(false);
    this.buildingShell.setAlpha(1);
  }

  /** 分配 Agent 到空格子间 */
  public assignAgent(agentId: string): boolean {
    const emptyRoom = this.rooms.find(r => r.getConfig().state === 'empty');
    if (!emptyRoom) {
      console.warn('[Building] No available room for agent:', agentId);
      return false;
    }

    emptyRoom.assignAgent(agentId);
    this.updateState();
    this.updateLabel();
    return true;
  }

  /** 取消分配 Agent */
  public unassignAgent(agentId: string): void {
    const room = this.rooms.find(r => r.getConfig().agentId === agentId);
    if (room) {
      room.unassignAgent();
      this.updateState();
      this.updateLabel();
    }
  }

  /** 重新计算格子间布局（Zone resize 时调用） */
  public updateLayout(width: number, height: number, agentCount: number): void {
    this.buildingWidth = width;
    this.buildingHeight = height;

    // 清除旧格子间
    this.roomsContainer.removeAll(true);
    this.rooms = [];

    // 重新计算布局
    const layout = this.calculateGridLayout(width, height, Math.max(agentCount + 2, 4));
    for (const roomConfig of layout.rooms) {
      const room = new Room(this.scene, roomConfig);
      this.rooms.push(room);
      this.roomsContainer.add(room);
    }

    // 重新渲染
    this.renderFoundation();
    this.renderShell();
    this.updateLabel();
  }

  /** 获取格子间列表 */
  public getRooms(): Room[] {
    return [...this.rooms];
  }

  /** 获取建筑状态 */
  public getState(): BuildingState {
    return this._buildingState;
  }

  /** 获取已占用的 Agent 数量 */
  public getOccupiedCount(): number {
    return this.rooms.filter(r => r.getConfig().state === 'occupied').length;
  }

  /** 更新进度条 */
  public updateProgress(percent: number): void {
    this.progressBar.clear();
    const barWidth = Math.min(this.buildingWidth - 20, 80);
    const barX = -barWidth / 2;
    const barY = this.buildingHeight / 2 + 4;

    // 背景
    this.progressBar.fillStyle(0x374151, 1);
    this.progressBar.fillRect(barX, barY, barWidth, 4);

    // 进度
    this.progressBar.fillStyle(0x10b981, 1);
    this.progressBar.fillRect(barX, barY, barWidth * Math.min(percent, 1), 4);
  }

  /** 计算格子间网格布局 */
  private calculateGridLayout(width: number, height: number, targetRooms: number): GridLayout {
    // 计算可用空间（留 padding）
    const padding = 8;
    const availW = width - padding * 2;
    const availH = height - padding * 2;

    // 计算最佳的列数和行数
    let bestCols = 1;
    let bestRows = 1;
    let bestScore = Infinity;

    for (let cols = 1; cols <= targetRooms; cols++) {
      const rows = Math.ceil(targetRooms / cols);
      const cellW = availW / cols;
      const cellH = availH / rows;

      // 格子间尺寸约束
      if (cellW < ROOM_SIZE.MIN || cellH < ROOM_SIZE.MIN) continue;
      if (cellW > ROOM_SIZE.MAX && cellH > ROOM_SIZE.MAX) continue;

      // 评分：越接近正方形越好
      const ratio = cellW / cellH;
      const score = Math.abs(ratio - 1) + (cols * rows - targetRooms) * 0.1;

      if (score < bestScore) {
        bestScore = score;
        bestCols = cols;
        bestRows = rows;
      }
    }

    const cellWidth = availW / bestCols;
    const cellHeight = availH / bestRows;

    // 生成格子间配置
    const rooms: RoomConfig[] = [];
    for (let row = 0; row < bestRows; row++) {
      for (let col = 0; col < bestCols; col++) {
        rooms.push({
          roomId: `room_${row}_${col}`,
          x: -availW / 2 + cellWidth / 2 + col * cellWidth,
          y: -availH / 2 + cellHeight / 2 + row * cellHeight,
          width: cellWidth - 4,
          height: cellHeight - 4,
          state: 'empty',
        });
      }
    }

    return { cols: bestCols, rows: bestRows, cellWidth, cellHeight, rooms };
  }

  /** 渲染地基 */
  private renderFoundation(): void {
    this.foundationGraphics.clear();
    this.foundationGraphics.fillStyle(0x1f2937, 0.6);
    this.foundationGraphics.fillRect(
      -this.buildingWidth / 2,
      -this.buildingHeight / 2,
      this.buildingWidth,
      this.buildingHeight
    );
  }

  /** 渲染外壳（屋顶 + 墙壁） */
  private renderShell(): void {
    this.shellGraphics.clear();
    const color = BUILDING_COLORS[this.buildingType];

    // 填充
    this.shellGraphics.fillStyle(color, 0.85);
    this.shellGraphics.fillRect(
      -this.buildingWidth / 2,
      -this.buildingHeight / 2,
      this.buildingWidth,
      this.buildingHeight
    );

    // 边框
    this.shellGraphics.lineStyle(2, 0x000000, 0.4);
    this.shellGraphics.strokeRect(
      -this.buildingWidth / 2,
      -this.buildingHeight / 2,
      this.buildingWidth,
      this.buildingHeight
    );

    // 入口标记（底部中间）
    const doorWidth = Math.min(20, this.buildingWidth * 0.2);
    this.shellGraphics.fillStyle(0x92400e, 1);
    this.shellGraphics.fillRect(
      -doorWidth / 2,
      this.buildingHeight / 2 - 6,
      doorWidth,
      6
    );
  }

  /** 更新建筑状态 */
  private updateState(): void {
    const occupied = this.getOccupiedCount();
    const total = this.rooms.length;

    if (occupied === 0) {
      this._buildingState = 'empty';
    } else if (occupied === total) {
      this._buildingState = 'full';
    } else if (occupied > total * 0.7) {
      this._buildingState = 'busy';
    } else {
      this._buildingState = 'active';
    }
  }

  /** 更新标签 */
  private updateLabel(): void {
    const name = BUILDING_NAMES[this.buildingType];
    const occupied = this.getOccupiedCount();
    const total = this.rooms.length;

    this.nameLabel.setText(name);
    this.statusLabel.setText(`👥 ${occupied}/${total}`);

    // 状态颜色
    if (this._buildingState === 'empty') {
      this.statusLabel.setColor('#9ca3af');
    } else if (this._buildingState === 'full') {
      this.statusLabel.setColor('#f59e0b');
    } else {
      this.statusLabel.setColor('#22c55e');
    }
  }

  destroy(fromScene?: boolean): void {
    this.roomsContainer?.destroy();
    this.buildingShell?.destroy();
    this.foundationGraphics?.destroy();
    this.nameLabel?.destroy();
    this.statusLabel?.destroy();
    this.progressBar?.destroy();
    super.destroy(fromScene);
  }
}
