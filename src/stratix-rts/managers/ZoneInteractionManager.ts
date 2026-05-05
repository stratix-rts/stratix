import Phaser from 'phaser';

import { ZoneInfo } from '../../stratix-core/stratix-protocol';
import { ZoneManagerIntegration } from '../../stratix-project/ZoneManagerIntegration';
import { MAP_WIDTH, MAP_HEIGHT } from '../constants';
import { rtsEventBus } from '../events/core/RTSEventBus';
import { DataFlowAnimation } from '../effects/DataFlowAnimation';
import { AgentSprite } from '../sprites/AgentSprite';
import { MovementSystem } from '../systems/MovementSystem';
import { InputHandler, InputMode } from '../utils/InputHandler';
import { BaseZone } from '../zones/BaseZone';
import { TaskZone, TaskZoneConfig } from '../zones/TaskZone';
import { TaskZonePreview } from '../zones/TaskZonePreview';
import { UnifiedZoneManager } from '../zones/UnifiedZoneManager';

export interface ZoneInteractionManagerDeps {
  taskZonePreview: TaskZonePreview;
  getAgentSprites: () => Map<string, AgentSprite>;
  projectManagerIntegration: ZoneManagerIntegration;
  agentZoneTracking: Map<string, string>;
  movementSystem: MovementSystem;
  dataFlowAnimation: DataFlowAnimation | null;
  inputHandler: InputHandler;
  clearAgentSelection: () => void;
  emitSelectionChanged: () => void;
}

export class ZoneInteractionManager {
  selectedZoneIds: Set<string> = new Set();
  private isZoneDrawingMode: boolean = false;
  private zoneDragAgentOffsets: Map<string, Map<string, { offsetX: number; offsetY: number }>> = new Map();
  private zoneResizeAgentPositions: Map<string, Map<string, { ratioX: number; ratioY: number }>> = new Map();

  constructor(
    private scene: Phaser.Scene,
    private unifiedZoneManager: UnifiedZoneManager,
    private deps: ZoneInteractionManagerDeps
  ) {}

  // ==================== Zone Drawing ====================

  handleZoneDrawStart(x: number, y: number): void {
    this.deps.taskZonePreview.start(x, y);
  }

  handleZoneDrawUpdate(x: number, y: number): void {
    this.deps.taskZonePreview.update(x, y);
  }

  async handleZoneDrawEnd(): Promise<Phaser.Geom.Rectangle | null> {
    if (this.deps.taskZonePreview.isOverlapping()) {
      this.deps.taskZonePreview.cancel();
      console.log('[StratixRTS] Cannot create zone: overlaps existing zone');
      return null;
    }

    const bounds = this.deps.taskZonePreview.end();
    console.log('[StratixRTS] handleZoneDrawEnd called, bounds:', bounds);
    if (bounds && bounds.width >= 20 && bounds.height >= 20) {
      try {
        console.log('[StratixRTS] Calling createProjectWithBounds...');
        const project = await this.deps.projectManagerIntegration.createProjectWithBounds(bounds);
        console.log('[StratixRTS] createProjectWithBounds returned:', project);
        if (project) {
          console.log('[StratixRTS] Emitting game:ui:project_created event');
          rtsEventBus.emit('game:ui:project_created' as any, {
            project,
            needsConfig: true
          });
          console.log('[StratixRTS] Event emitted');
        } else {
          console.log('[StratixRTS] createProjectWithBounds returned null, creating local TaskZone');
          this.createTaskZone(bounds);
        }
      } catch (error: unknown) {
        console.error('[StratixRTS] Failed to create project zone via API:', error);
        // API 调用失败时，创建本地 TaskZone 作为降级
        this.createTaskZone(bounds);
      }
    }
    return bounds;
  }

  handleZoneDrawCancel(): void {
    this.deps.taskZonePreview.cancel();
  }

  createTaskZone(bounds: Phaser.Geom.Rectangle): string {
    const zoneId = `zone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let zoneX = bounds.x + bounds.width / 2;
    let zoneY = bounds.y + bounds.height / 2;

    const clamped = this.clampToMapBounds(zoneX, zoneY, bounds.width, bounds.height);
    zoneX = clamped.x;
    zoneY = clamped.y;

    const config: TaskZoneConfig = {
      id: zoneId,
      x: zoneX,
      y: zoneY,
      width: bounds.width,
      height: bounds.height,
      name: `Task Zone ${this.unifiedZoneManager.getAllZones().size + 1}`
    };

    const taskZone = new TaskZone(this.scene, config);
    this.scene.add.existing(taskZone);
    this.unifiedZoneManager.register(taskZone);

    taskZone.setInteractive();
    taskZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown() && !this.isZoneDrawingMode) {
        this.selectZone(zoneId);
      }
    });

    console.log('[StratixRTS] Task zone created:', zoneId);
    return zoneId;
  }

  // ==================== Zone Selection ====================

  selectZone(zoneId: string): void {
    this.deps.clearAgentSelection();
    this.clearZoneSelection();
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.setHighlight(true);
      this.selectedZoneIds.add(zoneId);
      this.deps.emitSelectionChanged();
      // 暴露选中状态用于 E2E 测试
      (window as unknown as Record<string, unknown>).__SELECTED_ZONE_ID__ = zoneId;
    }
  }

  deselectZone(zoneId: string): void {
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.setHighlight(false);
      this.selectedZoneIds.delete(zoneId);
      this.deps.emitSelectionChanged();
    }
  }

  clearZoneSelection(): void {
    this.selectedZoneIds.forEach(zoneId => {
      const zone = this.unifiedZoneManager.getZone(zoneId);
      if (zone) {
        zone.setHighlight(false);
      }
    });
    this.selectedZoneIds.clear();
    this.deps.emitSelectionChanged();
  }

  getSelectedZoneIds(): Set<string> {
    return this.selectedZoneIds;
  }

  getSelectedZone(): TaskZone | undefined {
    const zoneIds = Array.from(this.selectedZoneIds);
    const zone = zoneIds.length > 0 ? this.unifiedZoneManager.getZone(zoneIds[0]) : undefined;
    return zone instanceof TaskZone ? zone : undefined;
  }

  // ==================== Zone Deletion ====================

  deleteZone(zoneId: string): void {
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.destroy();
      this.unifiedZoneManager.unregister(zoneId);
      this.selectedZoneIds.delete(zoneId);
    }
  }

  handleDeleteSelectedZones(): void {
    if (this.selectedZoneIds.size === 0) return;

    const zoneIdsToDelete = Array.from(this.selectedZoneIds);
    rtsEventBus.emit('vue:game:confirm_delete_zones' as any, {
      zoneIds: zoneIdsToDelete
    });
  }

  handleZoneDeleteConfirmed(zoneIds: string[]): void {
    zoneIds.forEach(zoneId => {
      const zone = this.unifiedZoneManager.getZone(zoneId);
      if (zone) {
        rtsEventBus.emit('zone:deleted' as any, {
          zoneId: zoneId,
          zoneConfig: zone.getBounds()
        });
        zone.destroy();
        this.unifiedZoneManager.unregister(zoneId);
      }
    });
    this.selectedZoneIds.delete(zoneIds[0]);
    console.log('[StratixRTS] Deleted', zoneIds.length, 'task zones');
  }

  // ==================== Zone Drag ====================

  handleZoneDragStart(zoneId: string, worldX: number, worldY: number): void {
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.startDrag(worldX, worldY);

      const agentsInZone = this.getAgentsInZone(zone);
      const offsets = new Map<string, { offsetX: number; offsetY: number }>();
      const bounds = zone.getBounds();

      agentsInZone.forEach((sprite, agentId) => {
        offsets.set(agentId, {
          offsetX: sprite.x - bounds.x,
          offsetY: sprite.y - bounds.y
        });
      });

      this.zoneDragAgentOffsets.set(zoneId, offsets);
    }
  }

  handleZoneDragUpdate(worldX: number, worldY: number): void {
    this.unifiedZoneManager.getAllZones().forEach(zone => {
      if (zone.isZoneDragging()) {
        zone.updateDrag(worldX, worldY);

        const bounds = zone.getBounds();
        const hasOverlap = this.checkZoneOverlap(bounds, zone.getZoneId());
        zone.setWarning(hasOverlap);

        const boundaryInfo = this.checkZoneNearBoundary(bounds);
        zone.setBoundaryWarning(boundaryInfo.nearBoundary, boundaryInfo.edge);

        const offsets = this.zoneDragAgentOffsets.get(zone.getZoneId());
        if (offsets) {
          offsets.forEach((offset, agentId) => {
            const sprite = this.deps.getAgentSprites().get(agentId);
            if (sprite) {
              sprite.x = bounds.x + offset.offsetX;
              sprite.y = bounds.y + offset.offsetY;
            }
          });
        }
      }
    });
  }

  handleZoneDragEnd(): void {
    this.unifiedZoneManager.getAllZones().forEach(zone => {
      if (zone.isZoneDragging()) {
        zone.endDrag();

        const bounds = zone.getBounds();
        if (this.checkZoneOverlap(bounds, zone.getZoneId())) {
          this.findNonOverlappingPosition(zone);
        }

        const offsets = this.zoneDragAgentOffsets.get(zone.getZoneId());
        if (offsets) {
          const finalBounds = zone.getBounds();
          offsets.forEach((offset, agentId) => {
            const sprite = this.deps.getAgentSprites().get(agentId);
            if (sprite) {
              sprite.x = finalBounds.x + offset.offsetX;
              sprite.y = finalBounds.y + offset.offsetY;
            }
          });
        }

        const finalBounds = zone.getBounds();
        rtsEventBus.emit('zone:moved' as any, {
          zoneId: zone.getZoneId(),
          position: { x: zone.x, y: zone.y },
          bounds: finalBounds,
        });

        zone.setWarning(false);
        zone.setBoundaryWarning(false, null);
        zone.animateDrop();

        this.zoneDragAgentOffsets.delete(zone.getZoneId());
      }
    });
    this.syncZonePositionsToDataFlow();
  }

  // ==================== Zone Resize ====================

  handleZoneResizeStart(zoneId: string, corner: string, worldX: number, worldY: number): void {
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.startResize(corner as any, worldX, worldY);

      const agentsInZone = this.getAgentsInZone(zone);
      const positions = new Map<string, { ratioX: number; ratioY: number }>();
      const bounds = zone.getBounds();

      agentsInZone.forEach((sprite, agentId) => {
        positions.set(agentId, {
          ratioX: (sprite.x - bounds.x) / bounds.width,
          ratioY: (sprite.y - bounds.y) / bounds.height
        });
      });

      this.zoneResizeAgentPositions.set(zoneId, positions);
    }
  }

  handleZoneResizeUpdate(worldX: number, worldY: number): void {
    this.unifiedZoneManager.getAllZones().forEach(zone => {
      if (zone.isZoneResizing()) {
        zone.updateResize(worldX, worldY);

        const bounds = zone.getBounds();
        const hasOverlap = this.checkZoneOverlap(bounds, zone.getZoneId());
        zone.setWarning(hasOverlap);

        const positions = this.zoneResizeAgentPositions.get(zone.getZoneId());
        if (positions) {
          positions.forEach((pos, agentId) => {
            const sprite = this.deps.getAgentSprites().get(agentId);
            if (sprite) {
              sprite.x = bounds.x + bounds.width * pos.ratioX;
              sprite.y = bounds.y + bounds.height * pos.ratioY;
            }
          });
        }
      }
    });
  }

  handleZoneResizeEnd(): void {
    this.unifiedZoneManager.getAllZones().forEach(zone => {
      if (zone.isZoneResizing()) {
        zone.endResize();

        const bounds = zone.getBounds();
        if (this.checkZoneOverlap(bounds, zone.getZoneId())) {
          this.revertZoneToNonOverlappingSize(zone);
        }

        const finalBounds = zone.getBounds();
        rtsEventBus.emit('zone:resized' as any, {
          zoneId: zone.getZoneId(),
          position: { x: zone.x, y: zone.y },
          size: { width: finalBounds.width, height: finalBounds.height },
          bounds: finalBounds,
        });

        zone.setWarning(false);

        this.zoneResizeAgentPositions.delete(zone.getZoneId());
      }
    });
  }

  revertZoneToNonOverlappingSize(zone: BaseZone): void {
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

  // ==================== Zone Queries ====================

  getTaskZones(): Map<string, TaskZone> {
    return this.unifiedZoneManager.getTaskZones();
  }

  getTaskZoneAtPoint(worldX: number, worldY: number): string | null {
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      if (zone.containsPoint(worldX, worldY)) {
        return zoneId;
      }
    }
    return null;
  }

  getZoneList(): ZoneInfo[] {
    const zones: ZoneInfo[] = [];

    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      const zoneName = (zone as unknown as { zoneName?: string; name?: string }).zoneName || (zone as unknown as { zoneName?: string; name?: string }).name || zoneId;

      let agentCount = 0;
      this.deps.getAgentSprites().forEach((sprite) => {
        if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
          agentCount++;
        }
      });

      zones.push({
        zoneId,
        name: zoneName,
        x: zone.x,
        y: zone.y,
        width: bounds.width,
        height: bounds.height,
        agentCount,
        status: (zone as unknown as { zoneStatus?: string }).zoneStatus || 'idle'
      });
    }

    return zones;
  }

  getAgentsInZone(zone: BaseZone): Map<string, AgentSprite> {
    const result = new Map<string, AgentSprite>();
    const bounds = zone.getBounds();

    this.deps.getAgentSprites().forEach((sprite, agentId) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        result.set(agentId, sprite);
      }
    });

    return result;
  }

  // ==================== Zone Overlap/Positioning ====================

  checkZoneOverlap(rect: Phaser.Geom.Rectangle, excludeZoneId?: string): boolean {
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      if (excludeZoneId && zoneId === excludeZoneId) continue;
      if (zone.overlapsRect(rect)) {
        return true;
      }
    }
    return false;
  }

  isZoneWithinBounds(x: number, y: number, width: number, height: number): boolean {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return x - halfWidth >= 0 &&
           x + halfWidth <= MAP_WIDTH &&
           y - halfHeight >= 0 &&
           y + halfHeight <= MAP_HEIGHT;
  }

  checkZoneNearBoundary(bounds: Phaser.Geom.Rectangle): { nearBoundary: boolean; edge: 'left' | 'right' | 'top' | 'bottom' | null } {
    const boundaryThreshold = 30;

    if (bounds.x < boundaryThreshold) {
      return { nearBoundary: true, edge: 'left' };
    }
    if (bounds.x + bounds.width > MAP_WIDTH - boundaryThreshold) {
      return { nearBoundary: true, edge: 'right' };
    }
    if (bounds.y < boundaryThreshold) {
      return { nearBoundary: true, edge: 'top' };
    }
    if (bounds.y + bounds.height > MAP_HEIGHT - boundaryThreshold) {
      return { nearBoundary: true, edge: 'bottom' };
    }

    return { nearBoundary: false, edge: null };
  }

  findNonOverlappingPosition(zone: BaseZone): void {
    const bounds = zone.getBounds();
    const zoneId = zone.getZoneId();

    const overlappingZones: BaseZone[] = [];
    for (const [id, otherZone] of this.unifiedZoneManager.getAllZones()) {
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

      if (!this.isZoneWithinBounds(testX, testY, bounds.width, bounds.height)) {
        continue;
      }

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

        if (!this.isZoneWithinBounds(testX, testY, bounds.width, bounds.height)) {
          continue;
        }

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

      if (!this.isZoneWithinBounds(testX, testY, bounds.width, bounds.height)) {
        continue;
      }

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

  clampToMapBounds(x: number, y: number, width: number, height: number): { x: number; y: number } {
    const halfWidth = width / 2;
    const halfHeight = height / 2;

    let clampedX = x;
    let clampedY = y;

    if (x - halfWidth < 0) {
      clampedX = halfWidth;
    } else if (x + halfWidth > MAP_WIDTH) {
      clampedX = MAP_WIDTH - halfWidth;
    }

    if (y - halfHeight < 0) {
      clampedY = halfHeight;
    } else if (y + halfHeight > MAP_HEIGHT) {
      clampedY = MAP_HEIGHT - halfHeight;
    }

    return { x: clampedX, y: clampedY };
  }

  clampAllZonesToBounds(): void {
    for (const [id, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      const clamped = this.clampToMapBounds(bounds.x, bounds.y, bounds.width, bounds.height);
      if (clamped.x !== bounds.x || clamped.y !== bounds.y) {
        zone.x = clamped.x;
        zone.y = clamped.y;
        console.log(`[StratixRTS] Zone ${id} clamped to bounds: (${clamped.x}, ${clamped.y})`);
      }
    }
  }

  // ==================== Zone Mode ====================

  enterZoneDrawingMode(): void {
    this.deps.inputHandler.setMode('zoneDrawing');
  }

  exitZoneDrawingMode(): void {
    this.deps.inputHandler.setMode('normal');
  }

  isInZoneDrawingMode(): boolean {
    return this.isZoneDrawingMode;
  }

  handleModeChange(mode: InputMode): void {
    this.isZoneDrawingMode = mode === 'zoneDrawing';
    console.log('[StratixRTS] Mode changed to:', mode);
  }

  // ==================== Agent-Zone Operations ====================

  async moveTo(agentId: string, zoneId: string): Promise<void> {
    const sprite = this.deps.getAgentSprites().get(agentId);
    if (!sprite) {
      console.warn(`[StratixRTS] Agent ${agentId} not found for moveTo`);
      return;
    }

    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (!zone) {
      console.warn(`[StratixRTS] Zone ${zoneId} not found for moveTo`);
      return;
    }

    const bounds = zone.getBounds();
    const targetX = bounds.x + bounds.width / 2;
    const targetY = bounds.y + bounds.height / 2;

    console.log(`[StratixRTS] Moving agent ${agentId} to zone ${zoneId} at (${targetX}, ${targetY})`);

    // Use movement system to move the agent
    this.deps.movementSystem.moveTo(agentId, targetX, targetY);

    // Update tracking
    this.deps.agentZoneTracking.set(agentId, zoneId);

    // Notify backend about zone entry
    try {
      const projectClient = this.deps.projectManagerIntegration.getProjectClient();
      await projectClient.addZoneMember(zoneId, agentId);
      console.log(`[StratixRTS] Agent ${agentId} entered zone ${zoneId} (backend notified)`);
    } catch (error: unknown) {
      console.error(`[StratixRTS] Failed to notify backend about zone entry:`, error);
    }
  }

  async leaveCurrentZone(agentId: string): Promise<void> {
    const sprite = this.deps.getAgentSprites().get(agentId);
    if (!sprite) {
      console.warn(`[StratixRTS] Agent ${agentId} not found for leaveCurrentZone`);
      return;
    }

    const currentZoneId = this.deps.agentZoneTracking.get(agentId);
    if (!currentZoneId) {
      console.log(`[StratixRTS] Agent ${agentId} is not in any zone`);
      return;
    }

    console.log(`[StratixRTS] Agent ${agentId} leaving zone ${currentZoneId}`);

    // Move agent to a random position outside any zone
    const margin = 50;
    let targetX: number, targetY: number;
    let attempts = 0;
    const maxAttempts = 20;

    do {
      targetX = Phaser.Math.Between(margin, MAP_WIDTH - margin);
      targetY = Phaser.Math.Between(margin, MAP_HEIGHT - margin);
      attempts++;
    } while (this.isPositionInAnyZone(targetX, targetY) && attempts < maxAttempts);

    // Fallback: use corner positions as safe spots
    if (attempts >= maxAttempts) {
      const safeSpots = [
        { x: margin, y: margin },
        { x: margin, y: MAP_HEIGHT - margin },
        { x: MAP_WIDTH - margin, y: margin },
        { x: MAP_WIDTH - margin, y: MAP_HEIGHT - margin },
      ];
      const safeSpot = Phaser.Utils.Array.GetRandom(safeSpots);
      targetX = safeSpot.x;
      targetY = safeSpot.y;
    }

    // Notify backend about zone leave BEFORE movement
    try {
      const projectClient = this.deps.projectManagerIntegration.getProjectClient();
      await projectClient.removeZoneMember(currentZoneId, agentId);
      console.log(`[StratixRTS] Agent ${agentId} left zone ${currentZoneId} (backend notified)`);
    } catch (error: unknown) {
      console.error(`[StratixRTS] Failed to notify backend about zone leave:`, error);
    }

    // Use movement system to move the agent
    this.deps.movementSystem.moveTo(agentId, targetX, targetY);

    // Clear tracking AFTER notifying backend
    this.deps.agentZoneTracking.delete(agentId);
  }

  getCurrentZone(agentId: string): string | null {
    return this.deps.agentZoneTracking.get(agentId) || null;
  }

  isPositionInAnyZone(x: number, y: number): boolean {
    for (const [_zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      if (Phaser.Geom.Rectangle.Contains(bounds, x, y)) {
        return true;
      }
    }
    return false;
  }

  syncZonePositionsToDataFlow(): void {
    if (!this.deps.dataFlowAnimation) return;
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      this.deps.dataFlowAnimation.setZonePosition(zoneId, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }
  }

  // ==================== Zone Click ====================

  handleZoneClick(zoneId: string): void {
    this.selectZone(zoneId);
  }

  handleZoneDoubleClick(zoneId: string): void {
    console.log('[StratixRTS] Zone double-clicked:', zoneId);
    this.scene.events.emit('zone:double-click', zoneId);
  }
}
