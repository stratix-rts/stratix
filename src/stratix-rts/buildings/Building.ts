/**
 * Building - 建筑
 * Zone 的视觉表现，包含外壳、屋顶、格子间和标签
 */

import Phaser from 'phaser';

import { BuildingConfig, BUILDING_COLORS, BUILDING_NAMES, BuildingType } from './types/BuildingType';
import { BuildingState } from './types/BuildingState';
import { Room, ROOM_SIZE, RoomConfig } from './Room';
import {
  registerBuildingTextures,
  getBuildingTextureKey,
  TEXTURE_SIZE,
} from './BuildingTextureGenerator';

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

  private foundationTileSprite: Phaser.GameObjects.TileSprite;
  private shellGraphics: Phaser.GameObjects.Graphics;
  private roomsContainer: Phaser.GameObjects.Container;
  private buildingShell: Phaser.GameObjects.Container;
  private nameLabel: Phaser.GameObjects.Text;
  private statusLabel: Phaser.GameObjects.Text;
  private progressBar: Phaser.GameObjects.Graphics;

  private wallTileSprite: Phaser.GameObjects.TileSprite;
  private roofTileSprite: Phaser.GameObjects.TileSprite;
  private detailGraphics: Phaser.GameObjects.Graphics;
  private hoverGlow: Phaser.GameObjects.Graphics;
  private textureSeed: string;

  private rooms: Room[] = [];
  private _buildingState: BuildingState = 'empty';
  private isInteriorVisible = false;
  private roofTween: Phaser.Tweens.Tween | null = null;
  private growTween: Phaser.Tweens.Tween | null = null;
  private isLit = false;

  constructor(scene: Phaser.Scene, config: BuildingConfig) {
    super(scene, config.x, config.y);
    this.buildingType = config.buildingType;
    this.buildingWidth = config.width;
    this.buildingHeight = config.height;
    this.textureSeed = `${config.buildingType}-${Math.round(config.x)}-${Math.round(config.y)}`;

    // 注册建筑纹理
    registerBuildingTextures(scene, this.buildingType, this.textureSeed, TEXTURE_SIZE);

    // 纹理精灵
    this.foundationTileSprite = scene.add.tileSprite(
      0,
      0,
      config.width,
      config.height,
      getBuildingTextureKey(this.buildingType, 'foundation', 'dim')
    );

    this.wallTileSprite = scene.add.tileSprite(
      0,
      0,
      config.width,
      config.height,
      getBuildingTextureKey(this.buildingType, 'wall', 'dim')
    );

    this.roofTileSprite = scene.add.tileSprite(
      0,
      0,
      config.width,
      config.height,
      getBuildingTextureKey(this.buildingType, 'roof', 'dim')
    );

    this.roomsContainer = scene.add.container(0, 0);
    this.buildingShell = scene.add.container(0, 0);
    this.shellGraphics = scene.add.graphics();
    this.detailGraphics = scene.add.graphics();
    this.hoverGlow = scene.add.graphics();

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
    this.buildingShell.add([this.wallTileSprite, this.roofTileSprite, this.detailGraphics, this.shellGraphics]);
    this.add([
      this.foundationTileSprite, // Depth 1: 地基
      this.roomsContainer,       // Depth 2-3: 格子间 + Agent
      this.buildingShell,        // Depth 4: 外墙 + 屋顶 + 装饰
      this.nameLabel,
      this.statusLabel,
      this.progressBar,
      this.hoverGlow,
    ]);

    this.setDepth(1);

    // 交互：悬停
    this.setInteractive(
      new Phaser.Geom.Rectangle(-config.width / 2, -config.height / 2, config.width, config.height),
      Phaser.Geom.Rectangle.Contains
    );
    this.on('pointerover', this.onPointerOver, this);
    this.on('pointerout', this.onPointerOut, this);

    // 初始渲染
    this.renderFoundation();
    this.renderShell();
    this.updateLabel();

    // 默认隐藏内部
    this.roomsContainer.setVisible(false);
    this.isInteriorVisible = false;
  }

  /** 悬停进入 */
  private onPointerOver(): void {
    this.hoverGlow.clear();
    this.hoverGlow.lineStyle(2, 0xfbbf24, 0.6);
    this.hoverGlow.strokeRect(
      -this.buildingWidth / 2 - 2,
      -this.buildingHeight / 2 - 2,
      this.buildingWidth + 4,
      this.buildingHeight + 4
    );
    this.setAlpha(0.95);
  }

  /** 悬停离开 */
  private onPointerOut(): void {
    this.hoverGlow.clear();
    this.setAlpha(1);
  }

  /** 显示内部（选中态） */
  public showInterior(): void {
    this.isInteriorVisible = true;
    this.roomsContainer.setVisible(true);
    if (this.roofTween) {
      this.scene.tweens.remove(this.roofTween);
      this.roofTween = null;
    }
    this.buildingShell.setAlpha(0);
    this.roofTween = this.scene.tweens.add({
      targets: this.buildingShell,
      alpha: 0,
      duration: 200,
    });
  }

  /** 隐藏内部（默认态） */
  public hideInterior(): void {
    this.isInteriorVisible = false;
    this.roomsContainer.setVisible(false);
    if (this.roofTween) {
      this.scene.tweens.remove(this.roofTween);
      this.roofTween = null;
    }
    this.buildingShell.setAlpha(1);
    this.roofTween = this.scene.tweens.add({
      targets: this.buildingShell,
      alpha: 1,
      duration: 200,
    });
  }

  /** 生长入场动画 */
  public growIn(): void {
    if (this.growTween) {
      this.scene.tweens.remove(this.growTween);
      this.growTween = null;
    }
    this.setScale(0, 0);
    this.growTween = this.scene.tweens.add({
      targets: this,
      scaleX: 1,
      scaleY: 1,
      duration: 400,
      ease: 'Back.easeOut',
    });
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
    if (this.buildingWidth === width && this.buildingHeight === height) return;
    this.buildingWidth = width;
    this.buildingHeight = height;

    // 记录当前已分配的 Agent
    const assignedAgents = this.rooms
      .filter(r => r.getConfig().state === 'occupied')
      .map(r => r.getConfig().agentId)
      .filter((id): id is string => id !== null && id !== undefined);

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

    // 重新分配之前已占用的 Agent（直接操作避免重复触发 Building 级重渲染）
    for (const agentId of assignedAgents) {
      const emptyRoom = this.rooms.find(r => r.getConfig().state === 'empty');
      if (emptyRoom) {
        emptyRoom.assignAgent(agentId);
      }
    }

    // 重新渲染
    this.renderFoundation();
    this.renderShell();
    this.updateState();
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

    // 根据进度选择颜色
    const clampedPercent = Math.max(0, Math.min(percent, 1));
    let fillColor: number;
    if (clampedPercent < 0.3) {
      fillColor = 0xef4444; // 红色
    } else if (clampedPercent <= 0.7) {
      fillColor = 0xf59e0b; // 黄色
    } else {
      fillColor = 0x10b981; // 绿色
    }

    // 进度填充
    const fillWidth = barWidth * clampedPercent;
    if (fillWidth > 0) {
      this.progressBar.fillStyle(fillColor, 1);
      this.progressBar.fillRect(barX, barY, fillWidth, 4);

      // 发光圆点
      this.progressBar.fillStyle(fillColor, 0.8);
      this.progressBar.fillCircle(barX + fillWidth, barY + 2, 3);
    }
  }

  /** 计算格子间网格布局 */
  private calculateGridLayout(width: number, height: number, targetRooms: number): GridLayout {
    // 计算可用空间（留 padding）
    const padding = 8;
    const availW = Math.max(width - padding * 2, 1);
    const availH = Math.max(height - padding * 2, 1);

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

    // 兜底：如果没有任何配置满足约束，用最宽松的 1x1 布局
    if (bestScore === Infinity) {
      bestCols = 1;
      bestRows = 1;
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
          width: Math.max(cellWidth - 4, 1),
          height: Math.max(cellHeight - 4, 1),
          state: 'empty',
        });
      }
    }

    return { cols: bestCols, rows: bestRows, cellWidth, cellHeight, rooms };
  }

  /** 渲染地基 */
  private renderFoundation(): void {
    if (this.buildingWidth <= 0 || this.buildingHeight <= 0) return;
    const key = getBuildingTextureKey(this.buildingType, 'foundation', this.isLit ? 'lit' : 'dim');
    this.foundationTileSprite.setTexture(key);
    this.foundationTileSprite.setSize(this.buildingWidth, this.buildingHeight);
  }

  /** 渲染外壳（屋顶 + 墙壁） */
  private renderShell(): void {
    if (this.buildingWidth <= 0 || this.buildingHeight <= 0) return;
    this.shellGraphics.clear();

    const wallKey = getBuildingTextureKey(this.buildingType, 'wall', this.isLit ? 'lit' : 'dim');
    const roofKey = getBuildingTextureKey(this.buildingType, 'roof', this.isLit ? 'lit' : 'dim');

    this.wallTileSprite.setTexture(wallKey);
    this.wallTileSprite.setSize(this.buildingWidth, this.buildingHeight);

    this.roofTileSprite.setTexture(roofKey);
    this.roofTileSprite.setSize(this.buildingWidth, this.buildingHeight);

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

    // 建筑装饰细节
    this.renderDetails();
  }

  /** 渲染建筑类型专属装饰细节 */
  private renderDetails(): void {
    this.detailGraphics.clear();
    const w = this.buildingWidth;
    const h = this.buildingHeight;
    const halfW = w / 2;
    const halfH = h / 2;

    switch (this.buildingType) {
      case BuildingType.DataCenter: {
        // 服务器机架竖线
        this.detailGraphics.lineStyle(1, 0xffffff, 0.12);
        const rackCount = Math.max(2, Math.floor(w / 32));
        for (let i = 1; i <= rackCount; i++) {
          const x = -halfW + (w * i) / (rackCount + 1);
          this.detailGraphics.beginPath();
          this.detailGraphics.moveTo(x, -halfH + 6);
          this.detailGraphics.lineTo(x, halfH - 12);
          this.detailGraphics.strokePath();
        }
        break;
      }
      case BuildingType.Workshop: {
        // 烟囱（小矩形在顶部右侧）
        const chimW = Math.min(12, w * 0.1);
        const chimH = Math.min(14, h * 0.15);
        this.detailGraphics.fillStyle(0x2d3748, 0.7);
        this.detailGraphics.fillRect(halfW - chimW - 10, -halfH - chimH + 6, chimW, chimH);
        break;
      }
      case BuildingType.Studio: {
        // 大窗户框架
        const winW = Math.min(32, w * 0.3);
        const winH = Math.min(24, h * 0.22);
        const winY = -halfH + 10;
        this.detailGraphics.lineStyle(2, 0x2d3748, 0.45);
        this.detailGraphics.strokeRect(-winW / 2, winY, winW, winH);
        // 十字分隔
        this.detailGraphics.beginPath();
        this.detailGraphics.moveTo(0, winY);
        this.detailGraphics.lineTo(0, winY + winH);
        this.detailGraphics.moveTo(-winW / 2, winY + winH / 2);
        this.detailGraphics.lineTo(winW / 2, winY + winH / 2);
        this.detailGraphics.strokePath();
        break;
      }
      case BuildingType.Library: {
        // 书架横线
        this.detailGraphics.lineStyle(1, 0x3d2614, 0.3);
        const shelfCount = Math.max(2, Math.floor(h / 30));
        for (let i = 1; i <= shelfCount; i++) {
          const y = -halfH + (h * i) / (shelfCount + 1);
          this.detailGraphics.beginPath();
          this.detailGraphics.moveTo(-halfW + 6, y);
          this.detailGraphics.lineTo(halfW - 6, y);
          this.detailGraphics.strokePath();
        }
        break;
      }
      case BuildingType.Command: {
        // 天线线条
        this.detailGraphics.lineStyle(1, 0xe2e8f0, 0.35);
        const cx = 0;
        const cy = -halfH + 12;
        this.detailGraphics.beginPath();
        this.detailGraphics.moveTo(cx, cy);
        this.detailGraphics.lineTo(cx, cy - 12);
        this.detailGraphics.strokePath();
        // 小圆盘
        this.detailGraphics.fillStyle(0xe2e8f0, 0.45);
        this.detailGraphics.fillCircle(cx, cy - 12, 3);
        break;
      }
    }
  }

  /** 设置亮灯/暗灯 */
  public setLit(lit: boolean): void {
    if (this.isLit === lit) return;
    this.isLit = lit;
    this.renderFoundation();
    this.renderShell();
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

    this.setLit(occupied > 0);
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
    if (this.roofTween) {
      this.scene.tweens.remove(this.roofTween);
      this.roofTween = null;
    }
    if (this.growTween) {
      this.scene.tweens.remove(this.growTween);
      this.growTween = null;
    }
    // roomsContainer.destroy() 会销毁所有 Room 子对象
    // buildingShell.destroy() 会销毁 wallTileSprite、roofTileSprite、detailGraphics、shellGraphics
    this.rooms = [];
    this.roomsContainer?.destroy();
    this.buildingShell?.destroy();
    this.foundationTileSprite?.destroy();
    this.hoverGlow?.destroy();
    this.nameLabel?.destroy();
    this.statusLabel?.destroy();
    this.progressBar?.destroy();
    super.destroy(fromScene);
  }
}
