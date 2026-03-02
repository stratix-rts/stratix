import Phaser from 'phaser';

export type TaskZoneStatus = 'idle' | 'active' | 'busy' | 'error';
export type TaskZoneType = 'code' | 'analysis' | 'writing' | 'general';

export interface TaskZoneConfig {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  taskType?: TaskZoneType;
}

export type CornerPosition = 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft';

const TASK_ZONE_COLORS = {
  fence: 0xff6600,
  fill: 0xff6600,
  corner: 0xffaa00,
  selected: 0x00ff00,
  warning: 0xff0000,
  handle: 0xffff00,
  status: {
    idle: 0x888888,
    active: 0x00ff88,
    busy: 0xffff00,
    error: 0xff4444
  },
  type: {
    code: 0x9B59B6,
    analysis: 0xE67E22,
    writing: 0x4A90E2,
    general: 0x00ffff
  }
};

const TASK_ZONE_TYPE_ICONS: Record<TaskZoneType, string> = {
  code: '</>',
  analysis: '📊',
  writing: '✍️',
  general: '◆'
};

export class TaskZone extends Phaser.GameObjects.Container {
  private zoneId: string;
  private zoneName: string;
  private zoneType: TaskZoneType;
  private zoneStatus: TaskZoneStatus = 'idle';
  private assignedAgentCount: number = 0;
  private queuedAgentCount: number = 0;
  private taskProgress: number = 0;
  private activeTaskName: string = '';
  private graphics: Phaser.GameObjects.Graphics;
  private fillGraphics: Phaser.GameObjects.Graphics;
  private cornerHandles: Map<CornerPosition, Phaser.GameObjects.Arc> = new Map();
  private zoneWidth: number;
  private zoneHeight: number;
  private isSelected: boolean = false;
  private isWarning: boolean = false;
  private fencePosts: Phaser.GameObjects.Arc[] = [];
  private centerHandle: Phaser.GameObjects.Container | null = null;
  private isDragging: boolean = false;
  private isResizing: boolean = false;
  private resizingCorner: CornerPosition | null = null;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private resizeStartState: {
    zoneX: number;
    zoneY: number;
    zoneWidth: number;
    zoneHeight: number;
    pointerX: number;
    pointerY: number;
  } | null = null;
  private statusIndicator: Phaser.GameObjects.Graphics | null = null;
  private typeIcon: Phaser.GameObjects.Text | null = null;
  private queueText: Phaser.GameObjects.Text | null = null;
  private progressBar: Phaser.GameObjects.Graphics | null = null;
  private progressText: Phaser.GameObjects.Text | null = null;
  private statusPulse: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, config: TaskZoneConfig) {
    super(scene, config.x, config.y);

    this.zoneId = config.id;
    this.zoneName = config.name || `Zone-${config.id.slice(0, 4)}`;
    this.zoneType = config.taskType || 'general';
    this.zoneWidth = config.width;
    this.zoneHeight = config.height;

    this.fillGraphics = scene.add.graphics();
    this.add(this.fillGraphics);

    this.graphics = scene.add.graphics();
    this.add(this.graphics);

    this.createFence();
    this.drawFill();
    this.createCornerHandles();
    this.createCenterHandle();
    this.createStatusIndicator();
    this.createTypeIcon();
    this.createQueueDisplay();
    this.createProgressBar();

    this.setSize(this.zoneWidth, this.zoneHeight);
    this.setInteractive(
      new Phaser.Geom.Rectangle(-this.zoneWidth / 2, -this.zoneHeight / 2, this.zoneWidth, this.zoneHeight),
      Phaser.Geom.Rectangle.Contains
    );
    this.setData('zoneId', this.zoneId);
    this.setData('isTaskZone', true);
  }

  private createFence(): void {
    const postSpacing = 20;
    const postRadius = 2;
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    this.graphics.lineStyle(3, TASK_ZONE_COLORS.fence, 0.9);
    this.graphics.strokeRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    const sides = [
      { start: { x: -halfW, y: -halfH }, end: { x: halfW, y: -halfH } },
      { start: { x: halfW, y: -halfH }, end: { x: halfW, y: halfH } },
      { start: { x: halfW, y: halfH }, end: { x: -halfW, y: halfH } },
      { start: { x: -halfW, y: halfH }, end: { x: -halfW, y: -halfH } }
    ];

    sides.forEach(side => {
      const dx = side.end.x - side.start.x;
      const dy = side.end.y - side.start.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const steps = Math.floor(length / postSpacing);

      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const px = side.start.x + dx * t;
        const py = side.start.y + dy * t;

        const post = this.scene.add.arc(px, py, postRadius, 0, 360, false, TASK_ZONE_COLORS.fence);
        post.setAlpha(0.8);
        this.add(post);
        this.fencePosts.push(post);
      }
    });
  }

  private drawFill(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    this.fillGraphics.clear();
    this.fillGraphics.fillStyle(TASK_ZONE_COLORS.fill, 0.1);
    this.fillGraphics.fillRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    this.fillGraphics.lineStyle(1, TASK_ZONE_COLORS.fill, 0.1);
    for (let i = -halfW; i < halfW; i += 10) {
      this.fillGraphics.lineBetween(i, -halfH, i, halfH);
    }
    for (let i = -halfH; i < halfH; i += 10) {
      this.fillGraphics.lineBetween(-halfW, i, halfW, i);
    }
  }

  private createCornerHandles(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    
    const corners: { position: CornerPosition; x: number; y: number }[] = [
      { position: 'topLeft', x: -halfW, y: -halfH },
      { position: 'topRight', x: halfW, y: -halfH },
      { position: 'bottomRight', x: halfW, y: halfH },
      { position: 'bottomLeft', x: -halfW, y: halfH }
    ];

    corners.forEach(({ position, x, y }) => {
      const handle = this.scene.add.arc(x, y, 8, 0, 360, false, TASK_ZONE_COLORS.corner);
      handle.setAlpha(0.9);
      handle.setDepth(1001);
      handle.setInteractive(
        new Phaser.Geom.Rectangle(-20, -20, 40, 40),
        Phaser.Geom.Rectangle.Contains
      );
      handle.setData('isCornerHandle', true);
      handle.setData('cornerPosition', position);
      handle.setData('zoneId', this.zoneId);
      handle.setVisible(false);
      
      handle.on('pointerover', () => {
        if (this.isSelected) {
          handle.setFillStyle(TASK_ZONE_COLORS.handle);
          handle.setRadius(10);
        }
      });
      
      handle.on('pointerout', () => {
        if (this.isSelected && !this.isResizing) {
          handle.setFillStyle(this.isWarning ? TASK_ZONE_COLORS.warning : TASK_ZONE_COLORS.corner);
          handle.setRadius(8);
        }
      });
      
      this.add(handle);
      this.cornerHandles.set(position, handle);
    });
  }

  private createCenterHandle(): void {
    this.centerHandle = this.scene.add.container(0, 0);

    const bgCircle = this.scene.add.arc(0, 0, 10, 0, 360, false, TASK_ZONE_COLORS.fence);
    bgCircle.setAlpha(0.6);
    this.centerHandle.add(bgCircle);

    const innerCircle = this.scene.add.arc(0, 0, 4, 0, 360, false, 0xffffff);
    innerCircle.setAlpha(0.9);
    this.centerHandle.add(innerCircle);

    const arrows = this.scene.add.graphics();
    arrows.lineStyle(2, TASK_ZONE_COLORS.fence, 0.7);
    arrows.lineBetween(0, -14, 0, -18);
    arrows.lineBetween(0, 14, 0, 18);
    arrows.lineBetween(-14, 0, -18, 0);
    arrows.lineBetween(14, 0, 18, 0);
    this.centerHandle.add(arrows);

    this.centerHandle.setSize(24, 24);
    this.centerHandle.setInteractive({ useHandCursor: true });
    this.centerHandle.setVisible(false);
    
    this.centerHandle.setData('isCenterHandle', true);
    this.centerHandle.setData('zoneId', this.zoneId);

    this.add(this.centerHandle);
  }

  private createStatusIndicator(): void {
    this.statusIndicator = this.scene.add.graphics();
    this.statusIndicator.setDepth(1002);
    this.add(this.statusIndicator);
    this.updateStatusIndicator();
  }

  private createTypeIcon(): void {
    const halfH = this.zoneHeight / 2;
    this.typeIcon = this.scene.add.text(-this.zoneWidth / 2 + 8, -halfH - 20, TASK_ZONE_TYPE_ICONS[this.zoneType], {
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif'
    });
    this.typeIcon.setDepth(1002);
    this.add(this.typeIcon);
  }

  private createQueueDisplay(): void {
    const halfW = this.zoneWidth / 2;
    this.queueText = this.scene.add.text(halfW - 8, -this.zoneHeight / 2 - 20, '', {
      fontSize: '11px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff',
      backgroundColor: '#000000',
      padding: { x: 4, y: 2 }
    });
    this.queueText.setOrigin(1, 0);
    this.queueText.setDepth(1002);
    this.add(this.queueText);
  }

  private createProgressBar(): void {
    this.progressBar = this.scene.add.graphics();
    this.progressBar.setDepth(1002);
    this.add(this.progressBar);

    this.progressText = this.scene.add.text(0, 0, '', {
      fontSize: '10px',
      fontFamily: 'Arial, sans-serif',
      color: '#ffffff'
    });
    this.progressText.setOrigin(0.5);
    this.progressText.setDepth(1003);
    this.progressText.setVisible(false);
    this.add(this.progressText);
  }

  private updateStatusIndicator(): void {
    if (!this.statusIndicator) return;

    this.statusIndicator.clear();
    const statusColor = TASK_ZONE_COLORS.status[this.zoneStatus];
    const halfH = this.zoneHeight / 2;

    this.statusIndicator.fillStyle(statusColor, 1);
    this.statusIndicator.fillCircle(-this.zoneWidth / 2 + 24, -halfH - 12, 5);

    if (this.zoneStatus === 'busy' && !this.statusPulse) {
      this.statusPulse = this.scene.tweens.add({
        targets: this.statusIndicator,
        alpha: { from: 1, to: 0.5 },
        duration: 500,
        yoyo: true,
        repeat: -1
      });
    } else if (this.zoneStatus !== 'busy' && this.statusPulse) {
      this.statusPulse.stop();
      this.statusPulse = null;
      this.statusIndicator.setAlpha(1);
    }
  }

  private updateQueueDisplay(): void {
    if (!this.queueText) return;

    if (this.queuedAgentCount > 0) {
      this.queueText.setText(`⏳ ${this.queuedAgentCount}`);
      this.queueText.setVisible(true);
    } else {
      this.queueText.setVisible(false);
    }
  }

  private updateProgressBar(): void {
    if (!this.progressBar || !this.progressText) return;

    this.progressBar.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    const barWidth = Math.min(this.zoneWidth - 20, 100);
    const barHeight = 6;
    const barX = -barWidth / 2;
    const barY = halfH + 8;

    if (this.taskProgress > 0 && this.taskProgress < 100) {
      this.progressBar.fillStyle(0x333333, 0.8);
      this.progressBar.fillRoundedRect(barX, barY, barWidth, barHeight, 3);

      const fillWidth = Math.floor((this.taskProgress / 100) * barWidth);
      if (fillWidth > 0) {
        const fillColor = TASK_ZONE_COLORS.type[this.zoneType];
        this.progressBar.fillStyle(fillColor, 1);
        this.progressBar.fillRoundedRect(barX, barY, fillWidth, barHeight, 3);
      }

      this.progressText.setText(`${Math.floor(this.taskProgress)}%`);
      this.progressText.setPosition(0, barY + barHeight + 2);
      this.progressText.setVisible(true);
    } else {
      this.progressText.setVisible(false);
    }
  }

  public setZoneStatus(status: TaskZoneStatus): void {
    this.zoneStatus = status;
    this.updateStatusIndicator();
    this.redraw();
  }

  public getZoneStatus(): TaskZoneStatus {
    return this.zoneStatus;
  }

  public setZoneType(type: TaskZoneType): void {
    this.zoneType = type;
    if (this.typeIcon) {
      this.typeIcon.setText(TASK_ZONE_TYPE_ICONS[type]);
    }
    this.updateProgressBar();
  }

  public getZoneType(): TaskZoneType {
    return this.zoneType;
  }

  public setAssignedAgents(count: number): void {
    this.assignedAgentCount = count;
    if (count > 0 && this.zoneStatus === 'idle') {
      this.setZoneStatus('active');
    } else if (count === 0 && this.zoneStatus === 'active') {
      this.setZoneStatus('idle');
    }
  }

  public getAssignedAgents(): number {
    return this.assignedAgentCount;
  }

  public setQueuedAgents(count: number): void {
    this.queuedAgentCount = count;
    this.updateQueueDisplay();
  }

  public getQueuedAgents(): number {
    return this.queuedAgentCount;
  }

  public setTaskProgress(progress: number): void {
    this.taskProgress = Math.max(0, Math.min(100, progress));
    this.updateProgressBar();

    if (progress > 0 && progress < 100) {
      this.setZoneStatus('busy');
    }
  }

  public getTaskProgress(): number {
    return this.taskProgress;
  }

  public setActiveTaskName(name: string): void {
    this.activeTaskName = name;
  }

  public getActiveTaskName(): string {
    return this.activeTaskName;
  }

  public setHighlight(selected: boolean): void {
    this.isSelected = selected;
    this.redraw();
  }

  public setWarning(warning: boolean): void {
    this.isWarning = warning;
    this.redraw();
  }

  private redraw(): void {
    const color = this.isWarning ? TASK_ZONE_COLORS.warning 
                 : this.isSelected ? TASK_ZONE_COLORS.selected 
                 : TASK_ZONE_COLORS.fence;
    
    this.graphics.clear();
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    this.graphics.lineStyle(this.isSelected ? 4 : 3, color, this.isSelected ? 1 : 0.9);
    this.graphics.strokeRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);

    if (this.isSelected) {
      this.graphics.fillStyle(color, this.isWarning ? 0.25 : 0.15);
      this.graphics.fillRect(-halfW, -halfH, this.zoneWidth, this.zoneHeight);
    }

    this.fencePosts.forEach(post => {
      post.setFillStyle(color);
    });

    this.cornerHandles.forEach((handle) => {
      handle.setVisible(this.isSelected);
      handle.setFillStyle(this.isWarning ? TASK_ZONE_COLORS.warning : TASK_ZONE_COLORS.corner);
      handle.setRadius(8);
    });

    if (this.centerHandle) {
      this.centerHandle.setVisible(this.isSelected);
      
      const children = this.centerHandle.getAll();
      if (children[0] && children[0] instanceof Phaser.GameObjects.Arc) {
        children[0].setFillStyle(this.isWarning ? TASK_ZONE_COLORS.warning : color);
      }
    }
  }

  public getZoneId(): string {
    return this.zoneId;
  }

  public getZoneName(): string {
    return this.zoneName;
  }

  public getBounds(): Phaser.Geom.Rectangle {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    return new Phaser.Geom.Rectangle(
      this.x - halfW,
      this.y - halfH,
      this.zoneWidth,
      this.zoneHeight
    );
  }

  public containsPoint(worldX: number, worldY: number): boolean {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    return (
      worldX >= this.x - halfW &&
      worldX <= this.x + halfW &&
      worldY >= this.y - halfH &&
      worldY <= this.y + halfH
    );
  }

  public overlapsRect(rect: Phaser.Geom.Rectangle): boolean {
    const bounds = this.getBounds();
    return Phaser.Geom.Rectangle.Overlaps(bounds, rect);
  }

  public overlapsZone(other: TaskZone): boolean {
    const bounds1 = this.getBounds();
    const bounds2 = other.getBounds();
    return Phaser.Geom.Rectangle.Overlaps(bounds1, bounds2);
  }

  public startDrag(worldX: number, worldY: number): void {
    this.isDragging = true;
    this.dragOffset.x = this.x - worldX;
    this.dragOffset.y = this.y - worldY;
  }

  public updateDrag(worldX: number, worldY: number): void {
    if (!this.isDragging) return;
    this.x = worldX + this.dragOffset.x;
    this.y = worldY + this.dragOffset.y;
  }

  public endDrag(): void {
    this.isDragging = false;
  }

  public isZoneDragging(): boolean {
    return this.isDragging;
  }

  public startResize(corner: CornerPosition, worldX: number, worldY: number): void {
    this.isResizing = true;
    this.resizingCorner = corner;
    this.resizeStartState = {
      zoneX: this.x,
      zoneY: this.y,
      zoneWidth: this.zoneWidth,
      zoneHeight: this.zoneHeight,
      pointerX: worldX,
      pointerY: worldY
    };
  }

  public updateResize(worldX: number, worldY: number): void {
    if (!this.isResizing || !this.resizeStartState) return;

    const start = this.resizeStartState;
    const deltaX = worldX - start.pointerX;
    const deltaY = worldY - start.pointerY;

    const minSize = 40;
    let newWidth = start.zoneWidth;
    let newHeight = start.zoneHeight;
    let newCenterX = start.zoneX;
    let newCenterY = start.zoneY;

    const halfOldW = start.zoneWidth / 2;
    const halfOldH = start.zoneHeight / 2;

    const oldLeft = start.zoneX - halfOldW;
    const oldRight = start.zoneX + halfOldW;
    const oldTop = start.zoneY - halfOldH;
    const oldBottom = start.zoneY + halfOldH;

    switch (this.resizingCorner) {
      case 'topLeft':
        newWidth = Math.max(minSize, start.zoneWidth - deltaX);
        newHeight = Math.max(minSize, start.zoneHeight - deltaY);
        newCenterX = oldRight - newWidth / 2;
        newCenterY = oldBottom - newHeight / 2;
        break;
      case 'topRight':
        newWidth = Math.max(minSize, start.zoneWidth + deltaX);
        newHeight = Math.max(minSize, start.zoneHeight - deltaY);
        newCenterX = oldLeft + newWidth / 2;
        newCenterY = oldBottom - newHeight / 2;
        break;
      case 'bottomRight':
        newWidth = Math.max(minSize, start.zoneWidth + deltaX);
        newHeight = Math.max(minSize, start.zoneHeight + deltaY);
        newCenterX = oldLeft + newWidth / 2;
        newCenterY = oldTop + newHeight / 2;
        break;
      case 'bottomLeft':
        newWidth = Math.max(minSize, start.zoneWidth - deltaX);
        newHeight = Math.max(minSize, start.zoneHeight + deltaY);
        newCenterX = oldRight - newWidth / 2;
        newCenterY = oldTop + newHeight / 2;
        break;
    }

    this.x = newCenterX;
    this.y = newCenterY;
    this.applyNewSize(newWidth, newHeight);
  }

  private applyNewSize(newWidth: number, newHeight: number): void {
    this.zoneWidth = newWidth;
    this.zoneHeight = newHeight;

    this.fencePosts.forEach(post => post.destroy());
    this.fencePosts = [];

    this.graphics.clear();
    this.fillGraphics.clear();
    
    this.createFence();
    this.drawFill();
    
    this.updateCornerHandlePositions();
    this.updateUIPositions();
    this.redraw();

    this.setSize(this.zoneWidth, this.zoneHeight);
    if (this.input?.hitArea instanceof Phaser.Geom.Rectangle) {
      this.input.hitArea.setSize(this.zoneWidth, this.zoneHeight);
      this.input.hitArea.setPosition(-this.zoneWidth / 2, -this.zoneHeight / 2);
    }
  }

  private updateUIPositions(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;

    if (this.typeIcon) {
      this.typeIcon.setPosition(-halfW + 8, -halfH - 20);
    }

    if (this.queueText) {
      this.queueText.setPosition(halfW - 8, -halfH - 20);
    }

    this.updateProgressBar();
  }

  private updateCornerHandlePositions(): void {
    const halfW = this.zoneWidth / 2;
    const halfH = this.zoneHeight / 2;
    
    const positions: { position: CornerPosition; x: number; y: number }[] = [
      { position: 'topLeft', x: -halfW, y: -halfH },
      { position: 'topRight', x: halfW, y: -halfH },
      { position: 'bottomRight', x: halfW, y: halfH },
      { position: 'bottomLeft', x: -halfW, y: halfH }
    ];

    positions.forEach(({ position, x, y }) => {
      const handle = this.cornerHandles.get(position);
      if (handle) {
        handle.setPosition(x, y);
      }
    });
  }

  public endResize(): void {
    this.isResizing = false;
    this.resizingCorner = null;
    this.resizeStartState = null;
    
    this.cornerHandles.forEach(handle => {
      handle.setFillStyle(this.isWarning ? TASK_ZONE_COLORS.warning : TASK_ZONE_COLORS.corner);
      handle.setRadius(6);
    });
  }

  public isZoneResizing(): boolean {
    return this.isResizing;
  }

  public getResizingCorner(): CornerPosition | null {
    return this.resizingCorner;
  }

  public getCenterHandle(): Phaser.GameObjects.Container | null {
    return this.centerHandle;
  }

  public getCornerHandle(position: CornerPosition): Phaser.GameObjects.Arc | undefined {
    return this.cornerHandles.get(position);
  }

  public getAllCornerHandles(): Map<CornerPosition, Phaser.GameObjects.Arc> {
    return this.cornerHandles;
  }

  public resize(zoneWidth: number, zoneHeight: number): void {
    this.applyNewSize(zoneWidth, zoneHeight);
  }

  public isWarningState(): boolean {
    return this.isWarning;
  }

  public destroy(): void {
    this.fencePosts.forEach(post => post.destroy());
    this.fencePosts = [];
    this.cornerHandles.forEach(handle => handle.destroy());
    this.cornerHandles.clear();
    if (this.centerHandle) {
      this.centerHandle.destroy();
      this.centerHandle = null;
    }
    if (this.statusIndicator) {
      this.statusIndicator.destroy();
      this.statusIndicator = null;
    }
    if (this.typeIcon) {
      this.typeIcon.destroy();
      this.typeIcon = null;
    }
    if (this.queueText) {
      this.queueText.destroy();
      this.queueText = null;
    }
    if (this.progressBar) {
      this.progressBar.destroy();
      this.progressBar = null;
    }
    if (this.progressText) {
      this.progressText.destroy();
      this.progressText = null;
    }
    if (this.statusPulse) {
      this.statusPulse.stop();
      this.statusPulse = null;
    }
    super.destroy();
  }
}
