import Phaser from 'phaser';
import { StratixAgentConfig } from '../stratix-core/stratix-protocol';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM } from './constants';
import { AgentSprite, AgentStatus, CommandStatus } from './sprites/AgentSprite';
import { StratixRTSEventManager } from './StratixRTSEventManager';
import { InputHandler, InputCallbacks, InputMode } from './utils/InputHandler';
import { SelectBox } from './ui/SelectBox';
import { TaskZone, TaskZoneConfig } from './zones/TaskZone';
import { TaskZonePreview } from './zones/TaskZonePreview';
import { CommandSystem, Command, CommandType } from './systems/CommandSystem';
import { ControlGroupSystem } from './systems/ControlGroupSystem';
import RTSCharacterRenderer, { TextureLoadResult } from './services/RTSCharacterRenderer';
import { rtsEventBus } from './events/core/RTSEventBus';
import type { TopBarStats, AgentInfo, ViewportState } from './events/types/RTSEventTypes';
import type { Skill } from './ui/v2/CommandPanelV2';

export { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, BG_COLOR } from './constants';

export default class StratixRTSGameScene extends Phaser.Scene {
  private eventManager: StratixRTSEventManager;
  private inputHandler: InputHandler;
  private selectBox: SelectBox;
  private taskZonePreview: TaskZonePreview;
  private commandSystem: CommandSystem;
  private controlGroupSystem: ControlGroupSystem;
  private agentSprites: Map<string, AgentSprite> = new Map();
  private selectedAgentIds: Set<string> = new Set();
  private previewSelection: Set<string> = new Set();
  private taskZones: Map<string, TaskZone> = new Map();
  private selectedZoneIds: Set<string> = new Set();
  private isZoneDrawingMode: boolean = false;
  private currentCommandType: CommandType | null = null;
  private characterRenderer: RTSCharacterRenderer;
  private eventUnsubscribers: (() => void)[] = [];

  constructor() {
    super({ key: 'StratixRTSGameScene' });
  }

  preload(): void {
    this.generatePlaceholderTextures();
  }

  private generatePlaceholderTextures(): void {
    const tileGraphics = this.make.graphics();
    tileGraphics.fillStyle(0x1a1a2e, 1);
    tileGraphics.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    tileGraphics.lineStyle(1, 0x2a2a4e, 0.3);
    tileGraphics.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 3; i++) {
      const starX = Phaser.Math.Between(2, TILE_SIZE - 2);
      const starY = Phaser.Math.Between(2, TILE_SIZE - 2);
      tileGraphics.fillStyle(0xffffff, Phaser.Math.FloatBetween(0.2, 0.5));
      tileGraphics.fillCircle(starX, starY, 1);
    }
    tileGraphics.generateTexture('stratix-tile', TILE_SIZE, TILE_SIZE);
    tileGraphics.destroy();

    const agentGraphics = this.make.graphics();
    agentGraphics.fillStyle(0x00ff00, 1);
    agentGraphics.fillCircle(16, 16, 12);
    agentGraphics.fillStyle(0xffffff, 1);
    agentGraphics.fillCircle(12, 12, 3);
    agentGraphics.fillCircle(20, 12, 3);
    agentGraphics.lineStyle(2, 0x00aa00, 1);
    agentGraphics.beginPath();
    agentGraphics.arc(16, 18, 5, 0, Math.PI);
    agentGraphics.strokePath();
    agentGraphics.generateTexture('stratix-agent', 32, 32);
    agentGraphics.destroy();
  }

  create(): void {
    rtsEventBus.registerScene('game', this);
    
    this.characterRenderer = new RTSCharacterRenderer(this);
    this.initStratixMap();
    this.initCamera();
    this.initSystems();
    this.initSelectBox();
    this.initTaskZonePreview();
    this.initInputHandler();
    this.initEventManager();
    this.initEventBusListeners();
    
    rtsEventBus.emit('scene:ui:game_ready', {
      width: this.cameras.main.width,
      height: this.cameras.main.height,
    } as any);
  }

  update(_time: number, _delta: number): void {
    this.inputHandler?.update();
  }

  private initStratixMap(): void {
    this.add.tileSprite(
      MAP_WIDTH / 2,
      MAP_HEIGHT / 2,
      MAP_WIDTH,
      MAP_HEIGHT,
      'stratix-tile'
    );
  }

  private initCamera(): void {
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setZoom(DEFAULT_ZOOM);
  }

  private initSystems(): void {
    this.commandSystem = new CommandSystem();
    this.controlGroupSystem = new ControlGroupSystem();
  }

  private initSelectBox(): void {
    this.selectBox = new SelectBox(this);
  }

  private initTaskZonePreview(): void {
    this.taskZonePreview = new TaskZonePreview(this);
    this.taskZonePreview.setOverlapCheck((rect) => this.checkZoneOverlap(rect));
  }

  private initInputHandler(): void {
    const callbacks: InputCallbacks = {
      onSelect: (agentIds: string[], shiftKey: boolean) => this.handleSelect(agentIds, shiftKey),
      onDeselect: () => this.clearSelection(),
      onBoxSelect: (bounds: Phaser.Geom.Rectangle, shiftKey: boolean) => this.handleBoxSelect(bounds, shiftKey),
      onCommand: (target, commandType) => this.handleCommand(target, commandType),
      onCommandMode: (commandType) => this.handleCommandMode(commandType),
      onCancelCommandMode: () => this.handleCancelCommandMode(),
      onDragStart: (x, y) => {
        this.selectBox.start(x, y);
        this.previewSelection.clear();
      },
      onDragUpdate: (x, y) => {
        this.selectBox.update(x, y);
        this.updateSelectionPreview();
      },
      onDragEnd: () => {
        const bounds = this.selectBox.end();
        this.previewSelection.clear();
        return bounds;
      },
      onSpriteDragStart: (agentId, x, y) => this.handleSpriteDragStart(agentId, x, y),
      onSpriteDragUpdate: (x, y) => this.handleSpriteDragUpdate(x, y),
      onSpriteDragEnd: () => this.handleSpriteDragEnd(),
      onZoneDrawStart: (x, y) => this.handleZoneDrawStart(x, y),
      onZoneDrawUpdate: (x, y) => this.handleZoneDrawUpdate(x, y),
      onZoneDrawEnd: () => this.handleZoneDrawEnd(),
      onZoneDrawCancel: () => this.handleZoneDrawCancel(),
      onModeChange: (mode) => this.handleModeChange(mode),
      onSelectAllSameType: (agentId) => this.handleSelectAllSameType(agentId),
      onCreateControlGroup: (groupId) => this.handleCreateControlGroup(groupId),
      onSelectControlGroup: (groupId, centerCamera) => this.handleSelectControlGroup(groupId, centerCamera),
      onStopCommand: () => this.handleStopCommand(),
      onPatrolCommand: (x, y) => this.handlePatrolCommand(x, y),
      onZoneDragStart: (zoneId, x, y) => this.handleZoneDragStart(zoneId, x, y),
      onZoneDragUpdate: (x, y) => this.handleZoneDragUpdate(x, y),
      onZoneDragEnd: () => this.handleZoneDragEnd(),
      onZoneResizeStart: (zoneId, corner, x, y) => this.handleZoneResizeStart(zoneId, corner, x, y),
      onZoneResizeUpdate: (x, y) => this.handleZoneResizeUpdate(x, y),
      onZoneResizeEnd: () => this.handleZoneResizeEnd(),
      onCheckZoneOverlap: (rect, excludeZoneId) => this.checkZoneOverlap(rect, excludeZoneId),
      onZoneClick: (zoneId) => this.handleZoneClick(zoneId),
      onZoneDoubleClick: (zoneId) => this.handleZoneDoubleClick(zoneId),
      onDeleteSelectedZones: () => this.handleDeleteSelectedZones(),
      getTaskZoneAtPoint: (worldX, worldY) => this.getTaskZoneAtPoint(worldX, worldY),
      onZoom: (zoom) => console.log('[StratixRTS] Zoom:', zoom.toFixed(2))
    };

    this.inputHandler = new InputHandler(this, callbacks);
  }

  private updateSelectionPreview(): void {
    const bounds = this.selectBox.getCurrentBounds();
    if (!bounds) return;

    const newPreviewIds = new Set<string>();
    
    this.agentSprites.forEach((sprite, agentId) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        newPreviewIds.add(agentId);
      }
    });

    this.previewSelection.forEach(agentId => {
      if (!newPreviewIds.has(agentId)) {
        const sprite = this.agentSprites.get(agentId);
        if (sprite && !this.selectedAgentIds.has(agentId)) {
          sprite.setHighlight(false);
        }
      }
    });

    newPreviewIds.forEach(agentId => {
      if (!this.previewSelection.has(agentId)) {
        const sprite = this.agentSprites.get(agentId);
        if (sprite) {
          sprite.setHighlight(true);
        }
      }
    });

    this.previewSelection = newPreviewIds;
  }

  private initEventManager(): void {
    this.eventManager = new StratixRTSEventManager(this);
    this.eventManager.subscribeAll();

    this.events.on('stratix:create-agent', this.onCreateAgent, this);
    this.events.on('stratix:update-agent-status', this.onUpdateAgentStatus, this);
    this.events.on('stratix:update-command-status', this.onUpdateCommandStatus, this);
  }

  private initEventBusListeners(): void {
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:create_agent', async (data: any) => {
        await this.addAgentSprite(data.config);
      })
    );
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:select_agents', (data: any) => {
        if (data.addToSelection) {
          data.agentIds.forEach((id: string) => this.selectAgent(id));
        } else {
          this.clearSelection();
          data.agentIds.forEach((id: string) => this.selectAgent(id));
        }
      })
    );
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:deselect_all', () => {
        this.clearSelection();
      })
    );
    
    rtsEventBus.respond('request:get_stats', () => this.getTopBarStats());
    rtsEventBus.respond('request:get_camera_state', () => this.getCameraState());
    
    rtsEventBus.emit('game:vue:game_ready', {
      width: this.cameras.main.width,
      height: this.cameras.main.height,
    } as any);
    
    this.time.addEvent({
      delay: 100,
      callback: () => this.emitStats(),
      loop: true,
    });
  }

  private emitStats(): void {
    rtsEventBus.emit('scene:ui:update_stats', this.getTopBarStats() as any);
  }

  private getTopBarStats(): TopBarStats {
    let onlineCount = 0;
    let busyCount = 0;
    
    this.agentSprites.forEach((sprite) => {
      const status = sprite.getCurrentStatus();
      if (status === 'online') onlineCount++;
      else if (status === 'busy') busyCount++;
    });
    
    let totalProgress = 0;
    this.taskZones.forEach((zone) => {
      totalProgress += zone.getTaskProgress();
    });
    if (this.taskZones.size > 0) {
      totalProgress /= this.taskZones.size;
    }
    
    return {
      totalAgents: this.agentSprites.size,
      onlineAgents: onlineCount,
      busyAgents: busyCount,
      totalZones: this.taskZones.size,
      overallProgress: totalProgress,
    };
  }

  private getCameraState(): ViewportState {
    const camera = this.cameras.main;
    return {
      scrollX: camera.scrollX,
      scrollY: camera.scrollY,
      zoom: camera.zoom,
      width: camera.width,
      height: camera.height,
    };
  }

  private handleSelect(agentIds: string[], shiftKey: boolean = false): void {
    if (!shiftKey) {
      this.clearSelection();
    }
    
    agentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        if (shiftKey && this.selectedAgentIds.has(id)) {
          this.deselectAgent(id);
        } else {
          sprite.setHighlight(true);
          sprite.setData('isSelected', true);
          this.selectedAgentIds.add(id);
        }
      }
    });
  }

  private handleBoxSelect(bounds: Phaser.Geom.Rectangle, shiftKey: boolean): void {
    if (!shiftKey) {
      this.clearSelection();
    }
    
    this.agentSprites.forEach((sprite, agentId) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        if (shiftKey && this.selectedAgentIds.has(agentId)) {
          this.deselectAgent(agentId);
        } else {
          sprite.setHighlight(true);
          sprite.setData('isSelected', true);
          this.selectedAgentIds.add(agentId);
        }
      }
    });
  }

  private handleSelectAllSameType(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;

    const agentType = sprite.getAgentType();
    this.clearSelection();

    this.agentSprites.forEach((sprite, id) => {
      if (sprite.getAgentType() === agentType) {
        sprite.setHighlight(true);
        sprite.setData('isSelected', true);
        this.selectedAgentIds.add(id);
      }
    });
  }

  private handleCreateControlGroup(groupId: number): void {
    if (this.selectedAgentIds.size === 0) return;
    this.controlGroupSystem.createGroup(groupId, Array.from(this.selectedAgentIds));
    console.log('[StratixRTS] Control group', groupId, 'created with', this.selectedAgentIds.size, 'units');
  }

  private handleSelectControlGroup(groupId: number, centerCamera: boolean): void {
    const agentIds = this.controlGroupSystem.getGroupAgentIds(groupId);
    if (agentIds.length === 0) return;

    this.clearSelection();
    agentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sprite.setHighlight(true);
        sprite.setData('isSelected', true);
        this.selectedAgentIds.add(id);
      }
    });

    if (centerCamera && agentIds.length > 0) {
      const firstSprite = this.agentSprites.get(agentIds[0]);
      if (firstSprite) {
        this.cameras.main.centerOn(firstSprite.x, firstSprite.y);
      }
    }
  }

  private handleCommandMode(commandType: CommandType): void {
    this.currentCommandType = commandType;
    console.log('[StratixRTS] Command mode:', commandType);
  }

  private handleCancelCommandMode(): void {
    this.currentCommandType = null;
    console.log('[StratixRTS] Command mode cancelled');
  }

  private handleStopCommand(): void {
    if (this.selectedAgentIds.size === 0) return;
    console.log('[StratixRTS] Stop command for', this.selectedAgentIds.size, 'units');
  }

  private handlePatrolCommand(x: number, y: number): void {
    if (this.selectedAgentIds.size === 0) return;
    console.log('[StratixRTS] Patrol command to:', x, y);
  }

  private handleSpriteDragStart(_agentId: string, worldX: number, worldY: number): void {
    this.selectedAgentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sprite.startDrag(worldX, worldY);
      }
    });
  }

  private handleSpriteDragUpdate(worldX: number, worldY: number): void {
    this.selectedAgentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sprite.updateDrag(worldX, worldY);
      }
    });
  }

  private handleSpriteDragEnd(): void {
    this.selectedAgentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sprite.endDrag();
      }
    });
  }

  private handleZoneDrawStart(x: number, y: number): void {
    this.taskZonePreview.start(x, y);
  }

  private handleZoneDrawUpdate(x: number, y: number): void {
    this.taskZonePreview.update(x, y);
  }

  private handleZoneDrawEnd(): Phaser.Geom.Rectangle | null {
    if (this.taskZonePreview.isOverlapping()) {
      this.taskZonePreview.cancel();
      console.log('[StratixRTS] Cannot create zone: overlaps existing zone');
      return null;
    }

    const bounds = this.taskZonePreview.end();
    if (bounds && bounds.width >= 20 && bounds.height >= 20) {
      this.createTaskZone(bounds);
    }
    return bounds;
  }

  private handleZoneDrawCancel(): void {
    this.taskZonePreview.cancel();
  }

  private checkZoneOverlap(rect: Phaser.Geom.Rectangle, excludeZoneId?: string): boolean {
    for (const [zoneId, zone] of this.taskZones) {
      if (excludeZoneId && zoneId === excludeZoneId) continue;
      if (zone.overlapsRect(rect)) {
        return true;
      }
    }
    return false;
  }

  private handleZoneDragStart(zoneId: string, worldX: number, worldY: number): void {
    const zone = this.taskZones.get(zoneId);
    if (zone) {
      zone.startDrag(worldX, worldY);
    }
  }

  private handleZoneDragUpdate(worldX: number, worldY: number): void {
    this.taskZones.forEach(zone => {
      if (zone.isZoneDragging()) {
        zone.updateDrag(worldX, worldY);
        
        const bounds = zone.getBounds();
        const hasOverlap = this.checkZoneOverlap(bounds, zone.getZoneId());
        zone.setWarning(hasOverlap);
      }
    });
  }

  private handleZoneDragEnd(): void {
    this.taskZones.forEach(zone => {
      if (zone.isZoneDragging()) {
        zone.endDrag();
        
        const bounds = zone.getBounds();
        if (this.checkZoneOverlap(bounds, zone.getZoneId())) {
          this.findNonOverlappingPosition(zone);
        }
        zone.setWarning(false);
      }
    });
  }

  private findNonOverlappingPosition(zone: TaskZone): void {
    const bounds = zone.getBounds();
    const zoneId = zone.getZoneId();
    
    const overlappingZones: TaskZone[] = [];
    for (const [id, otherZone] of this.taskZones) {
      if (id !== zoneId && otherZone.overlapsZone(zone)) {
        overlappingZones.push(otherZone);
      }
    }

    if (overlappingZones.length === 0) return;

    const firstOverlap = overlappingZones[0];
    const overlapBounds = firstOverlap.getBounds();

    const overlapLeft = Math.max(0, bounds.right - overlapBounds.left);
    const overlapRight = Math.max(0, overlapBounds.right - bounds.left);
    const overlapTop = Math.max(0, bounds.bottom - overlapBounds.top);
    const overlapBottom = Math.max(0, overlapBounds.bottom - bounds.top);

    const directions: { dx: number; dy: number; score: number }[] = [];

    if (overlapBottom > 0) {
      directions.push({ dx: 0, dy: overlapBottom + 5, score: overlapBottom });
    }
    if (overlapTop > 0) {
      directions.push({ dx: 0, dy: -(overlapTop + 5), score: overlapTop });
    }
    if (overlapRight > 0) {
      directions.push({ dx: overlapRight + 5, dy: 0, score: overlapRight });
    }
    if (overlapLeft > 0) {
      directions.push({ dx: -(overlapLeft + 5), dy: 0, score: overlapLeft });
    }

    directions.sort((a, b) => b.score - a.score);

    for (const dir of directions) {
      const testX = zone.x + dir.dx;
      const testY = zone.y + dir.dy;
      
      const testBounds = new Phaser.Geom.Rectangle(
        testX - bounds.width / 2,
        testY - bounds.height / 2,
        bounds.width,
        bounds.height
      );

      if (!this.checkZoneOverlap(testBounds, zoneId)) {
        zone.x = testX;
        zone.y = testY;
        console.log('[StratixRTS] Zone auto-moved to avoid overlap:', dir.dx !== 0 ? (dir.dx > 0 ? 'right' : 'left') : (dir.dy > 0 ? 'down' : 'up'));
        return;
      }
    }

    for (const dir of directions) {
      for (let scale = 2; scale <= 10; scale++) {
        const testX = zone.x + dir.dx * scale;
        const testY = zone.y + dir.dy * scale;
        
        const testBounds = new Phaser.Geom.Rectangle(
          testX - bounds.width / 2,
          testY - bounds.height / 2,
          bounds.width,
          bounds.height
        );

        if (!this.checkZoneOverlap(testBounds, zoneId)) {
          zone.x = testX;
          zone.y = testY;
          console.log('[StratixRTS] Zone auto-moved to avoid overlap (extended)');
          return;
        }
      }
    }

    const fallbackDirections = [
      { dx: 0, dy: bounds.height + 20 },
      { dx: 0, dy: -(bounds.height + 20) },
      { dx: bounds.width + 20, dy: 0 },
      { dx: -(bounds.width + 20), dy: 0 },
    ];

    for (const dir of fallbackDirections) {
      const testX = zone.x + dir.dx;
      const testY = zone.y + dir.dy;
      
      const testBounds = new Phaser.Geom.Rectangle(
        testX - bounds.width / 2,
        testY - bounds.height / 2,
        bounds.width,
        bounds.height
      );

      if (!this.checkZoneOverlap(testBounds, zoneId)) {
        zone.x = testX;
        zone.y = testY;
        console.log('[StratixRTS] Zone auto-moved to avoid overlap (fallback)');
        return;
      }
    }
  }

  private handleZoneResizeStart(zoneId: string, corner: string, worldX: number, worldY: number): void {
    const zone = this.taskZones.get(zoneId);
    if (zone) {
      zone.startResize(corner as any, worldX, worldY);
    }
  }

  private handleZoneResizeUpdate(worldX: number, worldY: number): void {
    this.taskZones.forEach(zone => {
      if (zone.isZoneResizing()) {
        zone.updateResize(worldX, worldY);
        
        const bounds = zone.getBounds();
        const hasOverlap = this.checkZoneOverlap(bounds, zone.getZoneId());
        zone.setWarning(hasOverlap);
      }
    });
  }

  private handleZoneResizeEnd(): void {
    this.taskZones.forEach(zone => {
      if (zone.isZoneResizing()) {
        zone.endResize();
        
        const bounds = zone.getBounds();
        if (this.checkZoneOverlap(bounds, zone.getZoneId())) {
          this.revertZoneToNonOverlappingSize(zone);
        }
        zone.setWarning(false);
      }
    });
  }

  private revertZoneToNonOverlappingSize(zone: TaskZone): void {
    const currentWidth = zone.getBounds().width;
    const currentHeight = zone.getBounds().height;
    const originalX = zone.x;
    const originalY = zone.y;
    
    this.findNonOverlappingPosition(zone);
    
    const newBounds = zone.getBounds();
    if (!this.checkZoneOverlap(newBounds, zone.getZoneId())) {
      return;
    }
    
    zone.x = originalX;
    zone.y = originalY;
    
    const shrinkSteps = [0.9, 0.8, 0.7, 0.6, 0.5];
    
    for (const scale of shrinkSteps) {
      const newWidth = Math.max(40, currentWidth * scale);
      const newHeight = Math.max(40, currentHeight * scale);
      
      zone.resize(newWidth, newHeight);
      
      const resizedBounds = zone.getBounds();
      if (!this.checkZoneOverlap(resizedBounds, zone.getZoneId())) {
        console.log('[StratixRTS] Zone auto-resized to avoid overlap');
        return;
      }
    }
    
    zone.x = originalX;
    zone.y = originalY;
    zone.resize(currentWidth, currentHeight);
    console.log('[StratixRTS] Could not find non-overlapping position for zone');
  }

  private handleZoneClick(zoneId: string): void {
    this.selectZone(zoneId);
  }

  private handleZoneDoubleClick(zoneId: string): void {
    console.log('[StratixRTS] Zone double-clicked:', zoneId);
    this.events.emit('zone:double-click', zoneId);
  }

  private handleDeleteSelectedZones(): void {
    if (this.selectedZoneIds.size === 0) return;
    
    const zoneCount = this.selectedZoneIds.size;
    const confirmed = confirm(`确定要删除 ${zoneCount} 个任务区吗？`);
    
    if (confirmed) {
      const zoneIdsToDelete = Array.from(this.selectedZoneIds);
      zoneIdsToDelete.forEach(zoneId => {
        const zone = this.taskZones.get(zoneId);
        if (zone) {
          zone.destroy();
          this.taskZones.delete(zoneId);
        }
      });
      this.selectedZoneIds.clear();
      console.log('[StratixRTS] Deleted', zoneCount, 'task zones');
    }
  }

  private getTaskZoneAtPoint(worldX: number, worldY: number): string | null {
    for (const [zoneId, zone] of this.taskZones) {
      if (zone.containsPoint(worldX, worldY)) {
        return zoneId;
      }
    }
    return null;
  }

  private handleModeChange(mode: InputMode): void {
    this.isZoneDrawingMode = mode === 'zoneDrawing';
    console.log('[StratixRTS] Mode changed to:', mode);
  }

  private createTaskZone(bounds: Phaser.Geom.Rectangle): string {
    const zoneId = `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    const config: TaskZoneConfig = {
      id: zoneId,
      x: bounds.x + bounds.width / 2,
      y: bounds.y + bounds.height / 2,
      width: bounds.width,
      height: bounds.height,
      name: `Task Zone ${this.taskZones.size + 1}`
    };

    const taskZone = new TaskZone(this, config);
    this.add.existing(taskZone);
    this.taskZones.set(zoneId, taskZone);

    taskZone.setInteractive();
    taskZone.on('pointerdown', () => {
      if (!this.isZoneDrawingMode) {
        this.selectZone(zoneId);
      }
    });

    console.log('[StratixRTS] Task zone created:', zoneId);
    return zoneId;
  }

  public selectZone(zoneId: string): void {
    this.clearZoneSelection();
    const zone = this.taskZones.get(zoneId);
    if (zone) {
      zone.setHighlight(true);
      this.selectedZoneIds.add(zoneId);
    }
  }

  public deselectZone(zoneId: string): void {
    const zone = this.taskZones.get(zoneId);
    if (zone) {
      zone.setHighlight(false);
      this.selectedZoneIds.delete(zoneId);
    }
  }

  public clearZoneSelection(): void {
    this.selectedZoneIds.forEach(zoneId => {
      const zone = this.taskZones.get(zoneId);
      if (zone) {
        zone.setHighlight(false);
      }
    });
    this.selectedZoneIds.clear();
  }

  public deleteZone(zoneId: string): void {
    const zone = this.taskZones.get(zoneId);
    if (zone) {
      zone.destroy();
      this.taskZones.delete(zoneId);
      this.selectedZoneIds.delete(zoneId);
    }
  }

  public getTaskZones(): Map<string, TaskZone> {
    return this.taskZones;
  }

  public getSelectedZoneIds(): Set<string> {
    return this.selectedZoneIds;
  }

  public enterZoneDrawingMode(): void {
    this.inputHandler.setMode('zoneDrawing');
  }

  public exitZoneDrawingMode(): void {
    this.inputHandler.setMode('normal');
  }

  public isInZoneDrawingMode(): boolean {
    return this.isZoneDrawingMode;
  }

  private handleCommand(target: { x: number; y: number }, commandType?: CommandType): void {
    if (this.selectedAgentIds.size === 0) return;
    
    const actualCommandType = commandType || 'move';
    console.log('[StratixRTS] Command:', actualCommandType, 'to:', target, 'agents:', Array.from(this.selectedAgentIds));
  }

  private onCreateAgent(config: StratixAgentConfig): void {
    this.addAgentSprite(config).catch(err => {
      console.error('[StratixRTS] Failed to create agent sprite:', err);
    });
  }

  private onUpdateAgentStatus(data: { agentId: string; status: AgentStatus }): void {
    const sprite = this.agentSprites.get(data.agentId);
    if (sprite) {
      sprite.setAgentStatus(data.status);
    }
  }

  private onUpdateCommandStatus(data: { agentId: string; commandStatus: CommandStatus }): void {
    const sprite = this.agentSprites.get(data.agentId);
    if (sprite) {
      sprite.setCommandStatus(data.commandStatus);
    }
  }

  public async addAgentSprite(config: StratixAgentConfig): Promise<AgentSprite> {
    const x = Phaser.Math.Between(100, MAP_WIDTH - 100);
    const y = Phaser.Math.Between(100, MAP_HEIGHT - 100);
    
    let textureKey: string | undefined;
    let isPlaceholder = false;
    
    if (config.type === 'custom' && config.character) {
      const result = await this.characterRenderer.loadCharacterTexture(
        config,
        (characterId, newTextureKey) => {
          const sprite = this.agentSprites.get(config.agentId);
          if (sprite && sprite.getCharacterId() === characterId) {
            sprite.replaceTexture(newTextureKey);
          }
        }
      );
      
      if (result.type === 'ready') {
        textureKey = result.textureKey;
      } else if (result.type === 'placeholder') {
        textureKey = result.textureKey;
        isPlaceholder = true;
      } else {
        textureKey = result.textureKey;
      }
    }
    
    const agentSprite = new AgentSprite(this, x, y, config, textureKey, isPlaceholder);
    this.add.existing(agentSprite);
    
    this.agentSprites.set(config.agentId, agentSprite);
    
    return agentSprite;
  }

  public getAgentSprites(): Map<string, AgentSprite> {
    return this.agentSprites;
  }

  public getSelectedAgentIds(): Set<string> {
    return this.selectedAgentIds;
  }

  public getEventManager(): StratixRTSEventManager {
    return this.eventManager;
  }

  public selectAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.selectedAgentIds.add(agentId);
      sprite.setHighlight(true);
      sprite.setData('isSelected', true);
    }
  }

  public deselectAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.selectedAgentIds.delete(agentId);
      sprite.setHighlight(false);
      sprite.setData('isSelected', false);
    }
  }

  public clearSelection(): void {
    this.selectedAgentIds.forEach(agentId => {
      const sprite = this.agentSprites.get(agentId);
      if (sprite) {
        sprite.setHighlight(false);
        sprite.setData('isSelected', false);
      }
    });
    this.selectedAgentIds.clear();
  }

  shutdown(): void {
    this.inputHandler?.destroy();
    this.selectBox?.destroy();
    this.taskZonePreview?.destroy();
    this.eventManager?.unsubscribeAll();
    this.events.off('stratix:create-agent');
    this.events.off('stratix:update-agent-status');
    this.events.off('stratix:update-command-status');
    
    this.eventUnsubscribers.forEach(unsub => unsub());
    this.eventUnsubscribers = [];
    rtsEventBus.unregisterScene('game');
    
    this.taskZones.forEach(zone => zone.destroy());
    this.taskZones.clear();
  }

  public resize(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
  }
}
