import Phaser from 'phaser';

import { StratixAgentConfig } from '../../stratix-core/stratix-protocol';
import { ProjectManagerIntegration } from '../../stratix-project/ZoneManagerIntegration';
import { MAP_WIDTH, MAP_HEIGHT } from '../constants';
import { rtsEventBus } from '../events/core/RTSEventBus';
import { RTSStateBridge } from '../state/RTSStateBridge';
import RTSCharacterRenderer from '../services/RTSCharacterRenderer';
import { AgentSprite } from '../sprites/AgentSprite';
import { MovementSystem } from '../systems/MovementSystem';
import { UnifiedZoneManager } from '../zones/UnifiedZoneManager';
import { TaskZone } from '../zones/TaskZone';

export interface AgentManagerDeps {
  stateBridge: RTSStateBridge;
  characterRenderer: RTSCharacterRenderer;
  projectManagerIntegration: ProjectManagerIntegration;
  agentZoneTracking: Map<string, string>;
  getSelectedZoneIds: () => Set<string>;
  getUnifiedZoneManager: () => UnifiedZoneManager;
  clearZoneSelection: () => void;
}

export class AgentManager {
  agentSprites: Map<string, AgentSprite> = new Map();
  selectedAgentIds: Set<string> = new Set();

  constructor(
    private scene: Phaser.Scene,
    movementSystem: MovementSystem,
    private deps: AgentManagerDeps
  ) {}

  // ==================== Agent Creation ====================

  async addAgentSprite(config: StratixAgentConfig): Promise<AgentSprite> {
    const existingSprite = this.agentSprites.get(config.agentId);
    if (existingSprite) {
      console.warn(`[StratixRTS] Agent ${config.agentId} already exists, replacing`);
      existingSprite.destroy();
    }

    let x = config.position?.x;
    let y = config.position?.y;
    let needsSavePosition = false;

    if (x === undefined || y === undefined) {
      x = Phaser.Math.Between(100, MAP_WIDTH - 100);
      y = Phaser.Math.Between(100, MAP_HEIGHT - 100);
      needsSavePosition = true;
    }

    let textureKey: string | undefined;
    let isPlaceholder = false;

    if (config.profile) {
      isPlaceholder = true;

      this.deps.characterRenderer.loadCharacterTexture(
        config,
        (characterId, newTextureKey) => {
          const sprite = this.agentSprites.get(config.agentId);
          if (sprite && sprite.getCharacterId() === characterId) {
            sprite.replaceTexture(newTextureKey);
          }
        }
      ).then(result => {
        if (result.type === 'ready' && result.textureKey !== 'stratix-agent') {
          const sprite = this.agentSprites.get(config.agentId);
          if (sprite) {
            sprite.replaceTexture(result.textureKey);
          }
        }
      });

      textureKey = 'stratix-agent';
    } else {
      textureKey = 'stratix-agent';
    }

    const sprite = new AgentSprite(this.scene, x!, y!, config, textureKey!, isPlaceholder);
    this.scene.add.existing(sprite);
    this.agentSprites.set(config.agentId, sprite);
    this.deps.stateBridge.registerAgent(config.agentId, config.name, {});

    if (needsSavePosition) {
      this.saveAgentPositionAsync(config.agentId, config, { x: x!, y: y! });
    }

    return sprite;
  }

  async saveAgentPosition(agentId: string, x: number, y: number): Promise<void> {
    try {
      await fetch('/api/stratix/config/agent/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, position: { x, y } })
      });
      console.log(`[StratixRTS] Saved agent position: ${agentId}`, { x, y });
    } catch (e: unknown) {
      console.warn(`[StratixRTS] Failed to save agent position: ${agentId}`, e);
    }
  }

  private async saveAgentPositionAsync(agentId: string, config: StratixAgentConfig, position: { x: number; y: number }): Promise<void> {
    try {
      await fetch('/api/stratix/config/agent/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, position })
      });
      console.log(`[StratixRTS] Saved initial position for agent ${agentId}:`, position);
    } catch (e: unknown) {
      console.warn(`[StratixRTS] Failed to save initial position for agent ${agentId}:`, e);
    }
  }

  // ==================== Agent Removal ====================

  removeAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.deps.stateBridge.unregisterAgent(agentId);
      sprite.destroy();
      this.agentSprites.delete(agentId);
      this.selectedAgentIds.delete(agentId);
      this.emitSelectionChanged();
    }
  }

  // ==================== Agent Queries ====================

  getAgentSprites(): Map<string, AgentSprite> {
    return this.agentSprites;
  }

  getSelectedAgentIds(): Set<string> {
    return this.selectedAgentIds;
  }

  getSelectedAgent(): AgentSprite | undefined {
    const agentIds = Array.from(this.selectedAgentIds);
    return agentIds.length > 0 ? this.agentSprites.get(agentIds[0]) : undefined;
  }

  updateAgentPosition(agentId: string, position: { x: number; y: number }): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      sprite.x = position.x;
      sprite.y = position.y;
    }
  }

  // ==================== Agent Selection ====================

  selectAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.selectedAgentIds.add(agentId);
      sprite.setHighlight(true);
      sprite.setData('isSelected', true);
      this.emitSelectionChanged();
    }
  }

  deselectAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.selectedAgentIds.delete(agentId);
      sprite.setHighlight(false);
      sprite.setData('isSelected', false);
      this.emitSelectionChanged();
    }
  }

  clearSelection(): void {
    this.selectedAgentIds.forEach(agentId => {
      const sprite = this.agentSprites.get(agentId);
      if (sprite) {
        sprite.setHighlight(false);
        sprite.setData('isSelected', false);
      }
    });
    this.selectedAgentIds.clear();
    this.emitSelectionChanged();
  }

  emitSelectionChanged(): void {
    const selectedAgentIds = Array.from(this.selectedAgentIds);
    const selectedZoneIds = Array.from(this.deps.getSelectedZoneIds());

    this.deps.stateBridge.syncSelection(
      selectedAgentIds,
      selectedZoneIds[0] ?? null
    );

    rtsEventBus.emit('scene:ui:update_selection' as any, {
      selectedAgentIds,
      selectedZoneIds,
    });

    if (selectedAgentIds.length > 0) {
      const sprite = this.agentSprites.get(selectedAgentIds[0]);
      if (sprite) {
        rtsEventBus.emit('scene:ui:agent_info' as any, {
          agentId: sprite.getAgentId(),
          name: sprite.name || sprite.getAgentId(),
          type: sprite.getAgentType(),
          status: 'idle',
          position: { x: sprite.x, y: sprite.y },
        });
      }
    }

    if (selectedZoneIds.length > 0) {
      const zone = this.deps.getUnifiedZoneManager().getZone(selectedZoneIds[0]);
      if (zone) {
        rtsEventBus.emit('scene:ui:zone_info' as any, {
          zoneId: zone.getZoneId(),
          name: (zone as unknown as { zoneName?: string }).zoneName || zone.getZoneId(),
          status: 'idle',
          agentCount: 0,
        });
      }
    }
  }

  // ==================== Selection Handlers ====================

  handleSelect(agentIds: string[], shiftKey: boolean = false): void {
    if (!shiftKey) {
      this.clearSelection();
      this.deps.clearZoneSelection();
    }

    agentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        if (shiftKey && this.selectedAgentIds.has(id)) {
          this.deselectAgent(id);
        } else {
          this.selectAgent(id);
        }
      }
    });
  }

  handleBoxSelect(bounds: Phaser.Geom.Rectangle, shiftKey: boolean): void {
    if (!shiftKey) {
      this.clearSelection();
      this.deps.clearZoneSelection();
    }

    this.agentSprites.forEach((sprite, agentId) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        if (shiftKey && this.selectedAgentIds.has(agentId)) {
          this.deselectAgent(agentId);
        } else {
          this.selectAgent(agentId);
        }
      }
    });
  }

  handleSelectAllSameType(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) return;

    const agentType = sprite.getAgentType();
    this.clearSelection();

    this.agentSprites.forEach((sprite, id) => {
      if (sprite.getAgentType() === agentType) {
        this.selectAgent(id);
      }
    });
  }

  handleSelectAllAgents(): void {
    this.clearSelection();
    this.agentSprites.forEach((sprite, agentId) => {
      this.selectAgent(agentId);
    });
    console.log('[StratixRTS] Selected all agents:', this.agentSprites.size);
  }

  // ==================== Agent Movement/Drag ====================

  handleSpriteDragStart(_agentId: string, worldX: number, worldY: number): void {
    this.selectedAgentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sprite.startDrag(worldX, worldY);
      }
    });
  }

  handleSpriteDragUpdate(worldX: number, worldY: number): void {
    this.selectedAgentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sprite.updateDrag(worldX, worldY);
      }
    });
  }

  async handleSpriteDragEnd(): Promise<void> {
    const projectClient = this.deps.projectManagerIntegration.getProjectClient();

    for (const id of this.selectedAgentIds) {
      const sprite = this.agentSprites.get(id);
      if (!sprite) continue;

      sprite.endDrag();

      // Immediately check if agent was dropped over a zone
      const zoneId = this.getZoneIdAtPosition(sprite.x, sprite.y);
      const previousZoneId = this.deps.agentZoneTracking.get(id);

      if (zoneId && zoneId !== previousZoneId) {
        try {
          await projectClient.addZoneMember(zoneId, id);
          this.deps.agentZoneTracking.set(id, zoneId);
          // 将 Agent 分配到建筑的格子间
          const zone = this.deps.getUnifiedZoneManager()?.getZone(zoneId);
          if (zone && 'getBuilding' in zone) {
            const building = (zone as TaskZone).getBuilding();
            if (building) {
              building.assignAgent(id);
              sprite.setVisible(false); // Agent 在格子间内，隐藏自由 sprite
            }
          }
          console.log(`[StratixRTS] Agent ${id} immediately registered in zone ${zoneId} on drag end`);
        } catch (error: unknown) {
          console.error(`[StratixRTS] Failed to register agent ${id} in zone ${zoneId}:`, error);
        }
      } else if (!zoneId && previousZoneId) {
        // Agent was dragged out of a zone
        try {
          // 从建筑的格子间移出
          const prevZone = this.deps.getUnifiedZoneManager()?.getZone(previousZoneId);
          if (prevZone && 'getBuilding' in prevZone) {
            const building = (prevZone as TaskZone).getBuilding();
            if (building) {
              building.unassignAgent(id);
              sprite.setVisible(true); // Agent 离开建筑，恢复自由 sprite
            }
          }
          await projectClient.removeZoneMember(previousZoneId, id);
          this.deps.agentZoneTracking.delete(id);
          console.log(`[StratixRTS] Agent ${id} removed from zone ${previousZoneId} on drag end`);
        } catch (error: unknown) {
          console.error(`[StratixRTS] Failed to remove agent ${id} from zone ${previousZoneId}:`, error);
        }
      }
    }
  }

  private getZoneIdAtPosition(x: number, y: number): string | null {
    const projectZones = this.deps.projectManagerIntegration.getAllProjectZones();
    for (const [zoneId, zone] of projectZones) {
      const bounds = zone.getBounds();
      if (Phaser.Geom.Rectangle.Contains(bounds, x, y)) {
        return zoneId;
      }
    }
    return null;
  }
}
