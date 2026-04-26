import Phaser from 'phaser';

import { getToken, getCurrentTheme } from '@/design-system/config';

import { StratixAgentConfig, ZoneInfo } from '../stratix-core/stratix-protocol';
import { ProjectClient } from '../stratix-project/ProjectClient';
import { ProjectManagerIntegration } from '../stratix-project/ProjectManagerIntegrationHTTP';

import { StratixRTSEventManager } from './StratixRTSEventManager';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM } from './constants';
import { StatsCollector } from './debug/StatsCollector';
import { DataFlowAnimation } from './effects/DataFlowAnimation';
import { rtsEventBus } from './events/core/RTSEventBus';
import type { TopBarStats, AgentInfo, ViewportState } from './events/types/RTSEventTypes';
import { RTSStateBridge } from './state/RTSStateBridge';
import RTSCharacterRenderer, { TextureLoadResult } from './services/RTSCharacterRenderer';
import { AgentSprite, AgentStatus, CommandStatus } from './sprites/AgentSprite';
import { CommandSystem, Command, CommandType } from './systems/CommandSystem';
import { ControlGroupSystem } from './systems/ControlGroupSystem';
import { MovementSystem } from './systems/MovementSystem';
import { SelectBox } from './ui/SelectBox';
import type { Skill } from './ui/v2/CommandPanelV2';
import { InputHandler, InputCallbacks, InputMode } from './utils/InputHandler';
import { BaseZone } from './zones/BaseZone';
import { TaskZone, TaskZoneConfig } from './zones/TaskZone';
import { TaskZonePreview } from './zones/TaskZonePreview';
import { UnifiedZoneManager } from './zones/UnifiedZoneManager';
import { ThemeManager, ThemeName } from './themes/ThemeManager';
import { GroundDecorationSystem } from './ground/GroundDecorationSystem';
import { ThemeSelectorUI } from './ui/ThemeSelectorUI';


export { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, BG_COLOR } from './constants';

export default class StratixRTSGameScene extends Phaser.Scene {
  private eventManager: StratixRTSEventManager;
  private inputHandler: InputHandler;
  private selectBox: SelectBox;
  private taskZonePreview: TaskZonePreview;
  private commandSystem: CommandSystem;
  private controlGroupSystem: ControlGroupSystem;
  private movementSystem: MovementSystem;
  private statsCollector: StatsCollector;
  private agentSprites: Map<string, AgentSprite> = new Map();
  private selectedAgentIds: Set<string> = new Set();
  private previewSelection: Set<string> = new Set();
  private unifiedZoneManager: UnifiedZoneManager;
  private projectManagerIntegration: ProjectManagerIntegration;
  private selectedZoneIds: Set<string> = new Set();
  private isZoneDrawingMode: boolean = false;
  private currentCommandType: CommandType | null = null;
  private characterRenderer: RTSCharacterRenderer;
  private eventUnsubscribers: (() => void)[] = [];
  private zoneDragAgentOffsets: Map<string, Map<string, { offsetX: number; offsetY: number }>> = new Map();
  private zoneResizeAgentPositions: Map<string, Map<string, { ratioX: number; ratioY: number }>> = new Map();
  private agentZoneTracking: Map<string, string> = new Map();
  private projectZoneCheckTimer: NodeJS.Timeout | null = null;
  private dataFlowAnimation: DataFlowAnimation;
  private zonePulseGraphics: Phaser.GameObjects.Graphics;
  private stateBridge: RTSStateBridge;
  private themeManager: ThemeManager;
  private groundDecorationSystem: GroundDecorationSystem;
  private themeSelectorUI: ThemeSelectorUI;

  constructor() {
    super({ key: 'StratixRTSGameScene' });
  }

  preload(): void {
    console.log('[StratixRTS] preload() called');
    // 生成占位符纹理
    this.generatePlaceholderTextures();

    // 预加载默认主题（fantasy）的装饰纹理
    this.preloadThemeTextures('fantasy');
  }

  /**
   * 预加载主题纹理
   */
  private preloadThemeTextures(theme: ThemeName): void {
    const basePath = `rts-textures/${theme}`;
    const textures = [
      'ground_base', 'ground_dark', 'ground_light',
      'grass_tuft', 'rock_small', 'rock_large',
      'flower', 'tree', 'water', 'cloud'
    ];

    console.log('[StratixRTS] Loading theme textures:', theme);
    for (const tex of textures) {
      const key = `${theme}_${tex}`;
      const path = `${basePath}/${tex}.png`;
      console.log('[StratixRTS] Loading:', key, 'from', path);
      this.load.image(key, path);
    }
  }

  private generatePlaceholderTextures(): void {
    // 获取主题颜色并转换为 Phaser 数字格式
    const hexToNumber = (hex: string) => parseInt(hex.replace('#', ''), 16);
    const bgColor = hexToNumber(getToken('colors.background.base'));
    const borderColor = hexToNumber(getToken('colors.border.default'));
    const starColor = hexToNumber(getToken('colors.text.muted'));
    
    const tileGraphics = this.make.graphics();
    tileGraphics.fillStyle(bgColor, 1);
    tileGraphics.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    tileGraphics.lineStyle(1, borderColor, 0.3);
    tileGraphics.strokeRect(0, 0, TILE_SIZE, TILE_SIZE);
    for (let i = 0; i < 3; i++) {
      const starX = Phaser.Math.Between(2, TILE_SIZE - 2);
      const starY = Phaser.Math.Between(2, TILE_SIZE - 2);
      tileGraphics.fillStyle(starColor, Phaser.Math.FloatBetween(0.2, 0.5));
      tileGraphics.fillCircle(starX, starY, 1);
    }
    tileGraphics.generateTexture('stratix-tile', TILE_SIZE, TILE_SIZE);
    tileGraphics.destroy();

    this.generateOrbTexture();
  }

  private generateOrbTexture(): void {
    const theme = getCurrentTheme();
    const primary = theme.colors.brand.primary;
    const secondary = theme.colors.brand.secondary;
    
    const primaryColor = parseInt(primary.replace('#', ''), 16);
    const secondaryColor = parseInt(secondary.replace('#', ''), 16);
    
    const graphics = this.make.graphics();
    const size = 64;
    const center = size / 2;
    
    for (let i = 5; i >= 0; i--) {
      const alpha = 0.1 + (5 - i) * 0.05;
      const radius = center - i * 4;
      graphics.fillStyle(primaryColor, alpha);
      graphics.fillCircle(center, center, radius);
    }
    
    graphics.fillStyle(secondaryColor, 1);
    graphics.fillCircle(center, center, 14);
    
    graphics.fillStyle(0xffffff, 0.7);
    graphics.fillCircle(center - 5, center - 5, 5);
    
    graphics.generateTexture('stratix-agent', size, size);
    graphics.destroy();
  }

  create(): void {
    rtsEventBus.registerScene('game', this);
    
    this.characterRenderer = new RTSCharacterRenderer(this);
    this.initStratixMap();
    this.initCamera();
    this.initSystems();
    this.unifiedZoneManager = new UnifiedZoneManager(this);
    this.dataFlowAnimation = new DataFlowAnimation(this);
    this.zonePulseGraphics = this.add.graphics();
    this.zonePulseGraphics.setDepth(54);
    this.initProjectManager();
    this.initSelectBox();
    this.initTaskZonePreview();
    this.initInputHandler();
    this.initEventManager();
    this.initEventBusListeners();
    this.stateBridge = new RTSStateBridge();

    // 初始化主题和地面装饰系统
    this.themeManager = new ThemeManager(this);
    this.groundDecorationSystem = new GroundDecorationSystem(this, this.themeManager, {
      density: 0.06,
      randomDecorations: true,
    });
    this.groundDecorationSystem.initialize().catch(err => {
      console.warn('[StratixRTS] Ground decoration system init failed:', err);
    });

    // 创建主题选择器 UI
    console.log('[StratixRTS] Creating ThemeSelectorUI at (10, 50)');
    this.themeSelectorUI = new ThemeSelectorUI(
      this,
      10,
      50,
      {
        onThemeSelect: async (theme) => {
          console.log(`[StratixRTS] Theme selected: ${theme}`);
          await this.setTheme(theme);
        },
      }
    );

    rtsEventBus.emit('scene:ui:game_ready', {
      width: this.cameras.main.width,
      height: this.cameras.main.height,
    } as any);

    // 暴露到 window 用于 Playwright E2E 测试
    (window as any).__rtsGameScene__ = this;
  }

  update(_time: number, _delta: number): void {
    this.inputHandler?.update();
    this.movementSystem?.update(_delta, this.agentSprites);
    this.dataFlowAnimation?.update(_delta);
    this.dataFlowAnimation?.drawZonePulses(this.zonePulseGraphics);
    // Update agent positions for beam effects
    this.agentSprites.forEach((sprite, agentId) => {
      this.dataFlowAnimation?.setAgentPosition(agentId, sprite.x, sprite.y);
    });
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
    this.movementSystem = new MovementSystem();
    this.movementSystem.setOnMovementComplete((agentId, x, y) => {
      this.saveAgentPosition(agentId, x, y);
    });
    this.statsCollector = new StatsCollector();
  }

  private async saveAgentPosition(agentId: string, x: number, y: number): Promise<void> {
    try {
      await fetch('/api/stratix/config/agent/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, position: { x, y } })
      });
      console.log(`[StratixRTS] Saved agent position: ${agentId}`, { x, y });
    } catch (e) {
      console.warn(`[StratixRTS] Failed to save agent position: ${agentId}`, e);
    }
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
      onSelectAllAgents: () => this.handleSelectAllAgents(),
      onCenterView: () => this.handleCenterView(),
      onSaveState: () => this.handleSaveState(),
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
    this.events.on('stratix:zone-updated', this.onZoneUpdated, this);
    this.events.on('stratix:zone-deleted', this.onZoneDeleted, this);
    this.events.on('stratix:zone-member-joined', this.onZoneMemberJoined, this);
    this.events.on('stratix:zone-member-left', this.onZoneMemberLeft, this);
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
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:zone_delete_confirmed', (data: any) => {
        this.handleZoneDeleteConfirmed(data.zoneIds);
      })
    );
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:modal:state_changed' as any, (data: any) => {
        if (this.inputHandler) {
          if (data.hasOpenModal) {
            this.inputHandler.disable();
          } else {
            this.inputHandler.enable();
          }
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:command' as any, (data: any) => {
        console.log('[StratixRTS] Received command from UI:', data);
        if (data.command && data.agentIds) {
          this.handleCommandFromUI(data.command, data.agentIds);
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:skill_select' as any, (data: any) => {
        console.log('[StratixRTS] Received skill select from UI:', data);
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


  private initProjectManager(): void {
    this.projectManagerIntegration = new ProjectManagerIntegration(
      this,
      this.unifiedZoneManager,
      {
        autoLoad: true
      }
    );
    
    console.log('[StratixRTS] ProjectManager initialized');
    
    this.projectManagerIntegration.onLoaded(() => {
      console.log('[StratixRTS] Projects loaded, checking zone bounds...');
      this.clampAllZonesToBounds();
      this.syncZonePositionsToDataFlow();
      this.startProjectZoneAgentTracking();
    });
  }

  private startProjectZoneAgentTracking(): void {
    if (this.projectZoneCheckTimer) {
      clearInterval(this.projectZoneCheckTimer);
    }
    
    this.projectZoneCheckTimer = setInterval(() => {
      this.checkAgentsInProjectZones();
    }, 2000);
    
    console.log('[StratixRTS] Project zone agent tracking started');
  }

  private getZoneIdAtPosition(x: number, y: number): string | null {
    const projectZones = this.projectManagerIntegration.getAllProjectZones();
    for (const [zoneId, zone] of projectZones) {
      const bounds = zone.getBounds();
      if (Phaser.Geom.Rectangle.Contains(bounds, x, y)) {
        return zoneId;
      }
    }
    return null;
  }

  private async checkAgentsInProjectZones(): Promise<void> {
    const projectZones = this.projectManagerIntegration.getAllProjectZones();
    const projectClient = this.projectManagerIntegration.getProjectClient();

    for (const [agentId, sprite] of this.agentSprites) {
      let currentProjectZoneId: string | null = null;

      for (const [zoneId, zone] of projectZones) {
        const bounds = zone.getBounds();
        const contains = Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y);
        if (contains) {
          currentProjectZoneId = zoneId;
          break;
        }
      }

      const previousZoneId = this.agentZoneTracking.get(agentId);

      // Use same API as moveTo()/leaveCurrentZone() for consistency
      if (currentProjectZoneId && currentProjectZoneId !== previousZoneId) {
        try {
          await projectClient.addZoneMember(currentProjectZoneId, agentId);
          this.agentZoneTracking.set(agentId, currentProjectZoneId);
        } catch (error) {
          console.error(`[StratixRTS] Failed to register agent ${agentId} in zone ${currentProjectZoneId}:`, error);
        }
      } else if (!currentProjectZoneId && previousZoneId) {
        try {
          await projectClient.removeZoneMember(previousZoneId, agentId);
          this.agentZoneTracking.delete(agentId);
        } catch (error) {
          console.error(`[StratixRTS] Failed to unregister agent ${agentId} from zone ${previousZoneId}:`, error);
        }
      }
    }
  }

  private clampAllZonesToBounds(): void {
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

  private syncZonePositionsToDataFlow(): void {
    if (!this.dataFlowAnimation) return;
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      this.dataFlowAnimation.setZonePosition(zoneId, bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }
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
    const taskZones = this.unifiedZoneManager.getTaskZones();
    taskZones.forEach((zone: TaskZone) => {
      totalProgress += zone.getTaskProgress();
    });
    if (taskZones.size > 0) {
      totalProgress /= taskZones.size;
    }
    
    const allZones = this.unifiedZoneManager.getAllZones();
    return {
      totalAgents: this.agentSprites.size,
      onlineAgents: onlineCount,
      busyAgents: busyCount,
      totalZones: allZones.size,
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
      this.clearZoneSelection();
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

  private handleBoxSelect(bounds: Phaser.Geom.Rectangle, shiftKey: boolean): void {
    if (!shiftKey) {
      this.clearSelection();
      this.clearZoneSelection();
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

  private handleSelectAllSameType(agentId: string): void {
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
      this.selectAgent(id);
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

  private handleSelectAllAgents(): void {
    this.clearSelection();
    this.agentSprites.forEach((sprite, agentId) => {
      this.selectAgent(agentId);
    });
    console.log('[StratixRTS] Selected all agents:', this.agentSprites.size);
  }

  private handleCenterView(): void {
    if (this.selectedAgentIds.size === 0) {
      this.cameras.main.scrollX = 0;
      this.cameras.main.scrollY = 0;
      console.log('[StratixRTS] Centered on origin');
      return;
    }
    let sumX = 0, sumY = 0, count = 0;
    this.selectedAgentIds.forEach(id => {
      const sprite = this.agentSprites.get(id);
      if (sprite) {
        sumX += sprite.x;
        sumY += sprite.y;
        count++;
      }
    });
    if (count > 0) {
      this.cameras.main.scrollX = sumX / count - this.cameras.main.width / 2;
      this.cameras.main.scrollY = sumY / count - this.cameras.main.height / 2;
      console.log('[StratixRTS] Centered on selection');
    }
  }

  private handleSaveState(): void {
    console.log('[StratixRTS] Saving state...');
    rtsEventBus.emit('game:vue:save_state' as any, {});
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

  private async handleSpriteDragEnd(): Promise<void> {
    const projectClient = this.projectManagerIntegration.getProjectClient();

    for (const id of this.selectedAgentIds) {
      const sprite = this.agentSprites.get(id);
      if (!sprite) continue;

      sprite.endDrag();

      // Immediately check if agent was dropped over a zone
      const zoneId = this.getZoneIdAtPosition(sprite.x, sprite.y);
      const previousZoneId = this.agentZoneTracking.get(id);

      if (zoneId && zoneId !== previousZoneId) {
        try {
          await projectClient.addZoneMember(zoneId, id);
          this.agentZoneTracking.set(id, zoneId);
          console.log(`[StratixRTS] Agent ${id} immediately registered in zone ${zoneId} on drag end`);
        } catch (error) {
          console.error(`[StratixRTS] Failed to register agent ${id} in zone ${zoneId}:`, error);
        }
      } else if (!zoneId && previousZoneId) {
        // Agent was dragged out of a zone
        try {
          await projectClient.removeZoneMember(previousZoneId, id);
          this.agentZoneTracking.delete(id);
          console.log(`[StratixRTS] Agent ${id} removed from zone ${previousZoneId} on drag end`);
        } catch (error) {
          console.error(`[StratixRTS] Failed to remove agent ${id} from zone ${previousZoneId}:`, error);
        }
      }
    }
  }

  private handleZoneDrawStart(x: number, y: number): void {
    this.taskZonePreview.start(x, y);
  }

  private handleZoneDrawUpdate(x: number, y: number): void {
    this.taskZonePreview.update(x, y);
  }

  private async handleZoneDrawEnd(): Promise<Phaser.Geom.Rectangle | null> {
    if (this.taskZonePreview.isOverlapping()) {
      this.taskZonePreview.cancel();
      console.log('[StratixRTS] Cannot create zone: overlaps existing zone');
      return null;
    }

    const bounds = this.taskZonePreview.end();
    console.log('[StratixRTS] handleZoneDrawEnd called, bounds:', bounds);
    if (bounds && bounds.width >= 20 && bounds.height >= 20) {
      try {
        console.log('[StratixRTS] Calling createProjectWithBounds...');
        const project = await this.projectManagerIntegration.createProjectWithBounds(bounds);
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
      } catch (error) {
        console.error('[StratixRTS] Failed to create project zone via API:', error);
        // API 调用失败时，创建本地 TaskZone 作为降级
        this.createTaskZone(bounds);
      }
    }
    return bounds;
  }

  private handleZoneDrawCancel(): void {
    this.taskZonePreview.cancel();
  }

  private checkZoneOverlap(rect: Phaser.Geom.Rectangle, excludeZoneId?: string): boolean {
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      if (excludeZoneId && zoneId === excludeZoneId) continue;
      if (zone.overlapsRect(rect)) {
        return true;
      }
    }
    return false;
  }

  private handleZoneDragStart(zoneId: string, worldX: number, worldY: number): void {
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

  private handleZoneDragUpdate(worldX: number, worldY: number): void {
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
            const sprite = this.agentSprites.get(agentId);
            if (sprite) {
              sprite.x = bounds.x + offset.offsetX;
              sprite.y = bounds.y + offset.offsetY;
            }
          });
        }
      }
    });
  }

  private handleZoneDragEnd(): void {
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
            const sprite = this.agentSprites.get(agentId);
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

  private getAgentsInZone(zone: BaseZone): Map<string, AgentSprite> {
    const result = new Map<string, AgentSprite>();
    const bounds = zone.getBounds();
    
    this.agentSprites.forEach((sprite, agentId) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        result.set(agentId, sprite);
      }
    });
    
    return result;
  }

  private isZoneWithinBounds(x: number, y: number, width: number, height: number): boolean {
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return x - halfWidth >= 0 &&
           x + halfWidth <= MAP_WIDTH &&
           y - halfHeight >= 0 &&
           y + halfHeight <= MAP_HEIGHT;
  }

  private checkZoneNearBoundary(bounds: Phaser.Geom.Rectangle): { nearBoundary: boolean; edge: 'left' | 'right' | 'top' | 'bottom' | null } {
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

  private findNonOverlappingPosition(zone: BaseZone): void {
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

  private handleZoneResizeStart(zoneId: string, corner: string, worldX: number, worldY: number): void {
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

  private handleZoneResizeUpdate(worldX: number, worldY: number): void {
    this.unifiedZoneManager.getAllZones().forEach(zone => {
      if (zone.isZoneResizing()) {
        zone.updateResize(worldX, worldY);
        
        const bounds = zone.getBounds();
        const hasOverlap = this.checkZoneOverlap(bounds, zone.getZoneId());
        zone.setWarning(hasOverlap);
        
        const positions = this.zoneResizeAgentPositions.get(zone.getZoneId());
        if (positions) {
          positions.forEach((pos, agentId) => {
            const sprite = this.agentSprites.get(agentId);
            if (sprite) {
              sprite.x = bounds.x + bounds.width * pos.ratioX;
              sprite.y = bounds.y + bounds.height * pos.ratioY;
            }
          });
        }
      }
    });
  }

  private handleZoneResizeEnd(): void {
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

  private revertZoneToNonOverlappingSize(zone: BaseZone): void {
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
    
    const zoneIdsToDelete = Array.from(this.selectedZoneIds);
    rtsEventBus.emit('vue:game:confirm_delete_zones' as any, {
      zoneIds: zoneIdsToDelete
    });
  }
  
  private handleZoneDeleteConfirmed(zoneIds: string[]): void {
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

  private getTaskZoneAtPoint(worldX: number, worldY: number): string | null {
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
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

  private clampToMapBounds(x: number, y: number, width: number, height: number): { x: number; y: number } {
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

  private createTaskZone(bounds: Phaser.Geom.Rectangle): string {
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

    const taskZone = new TaskZone(this, config);
    this.add.existing(taskZone);
    this.unifiedZoneManager.register(taskZone);

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
    this.clearSelection();
    this.clearZoneSelection();
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.setHighlight(true);
      this.selectedZoneIds.add(zoneId);
      this.emitSelectionChanged();
      // 暴露选中状态用于 E2E 测试
      (window as any).__SELECTED_ZONE_ID__ = zoneId;
    }
  }

  public deselectZone(zoneId: string): void {
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.setHighlight(false);
      this.selectedZoneIds.delete(zoneId);
      this.emitSelectionChanged();
    }
  }

  public clearZoneSelection(): void {
    this.selectedZoneIds.forEach(zoneId => {
      const zone = this.unifiedZoneManager.getZone(zoneId);
      if (zone) {
        zone.setHighlight(false);
      }
    });
    this.selectedZoneIds.clear();
    this.emitSelectionChanged();
  }

  public deleteZone(zoneId: string): void {
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (zone) {
      zone.destroy();
      this.unifiedZoneManager.unregister(zoneId);
      this.selectedZoneIds.delete(zoneId);
    }
  }

  public getTaskZones(): Map<string, TaskZone> {
    return this.unifiedZoneManager.getTaskZones();
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
    
    if (actualCommandType === 'move') {
      this.selectedAgentIds.forEach(agentId => {
        this.movementSystem.moveTo(agentId, target.x, target.y);
      });
    }
  }

  private handleCommandFromUI(command: string, agentIds: string[]): void {
    console.log('[StratixRTS] Handle command from UI:', command, 'agents:', agentIds);
    
    switch (command) {
      case 'stop':
        agentIds.forEach(agentId => {
          this.movementSystem.stop(agentId);
        });
        break;
      case 'hold':
        console.log('[StratixRTS] Hold command not implemented yet');
        break;
      case 'return':
        console.log('[StratixRTS] Return command not implemented yet');
        break;
      default:
        console.log('[StratixRTS] Unknown command:', command);
    }
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
      this.stateBridge.updateAgentStatus(data.agentId, data.status);
    }
  }

  private onUpdateCommandStatus(data: { agentId: string; commandStatus: CommandStatus }): void {
    const sprite = this.agentSprites.get(data.agentId);
    if (sprite) {
      sprite.setCommandStatus(data.commandStatus);
    }
  }

  private onZoneUpdated(data: { zoneId: string; title?: string; prompt?: string }): void {
    if (data.title !== undefined) {
      this.projectManagerIntegration.updateProjectZoneTitle(data.zoneId, data.title);
      console.log(`[StratixRTS] Zone ${data.zoneId} title updated to: ${data.title}`);
    }
  }

  private async onZoneDeleted(data: { zoneId: string }): Promise<void> {
    // When a zone is soft-deleted, fully remove it from the RTS view
    // Note: We use removeProjectZone which calls destroy() and unregister()
    // This is the same as when a project is deleted via ProjectManagerIntegration
    this.projectManagerIntegration.removeProjectZone(data.zoneId);
    console.log(`[StratixRTS] Zone ${data.zoneId} removed (soft deleted)`);

    // Clean up agentZoneTracking for agents that were in this zone
    const agentsToRelease: string[] = [];
    for (const [agentId, zoneId] of this.agentZoneTracking.entries()) {
      if (zoneId === data.zoneId) {
        agentsToRelease.push(agentId);
        this.agentZoneTracking.delete(agentId);
        console.log(`[StratixRTS] Agent ${agentId} tracking removed (zone ${data.zoneId} deleted)`);
      }
    }

    // Notify backend that agents have left the deleted zone
    if (agentsToRelease.length > 0) {
      const projectClient = this.projectManagerIntegration.getProjectClient();
      for (const agentId of agentsToRelease) {
        try {
          // Agent is now effectively in no zone - backend should mark them as idle
          await projectClient.agentLeaveProject(data.zoneId, agentId);
          console.log(`[StratixRTS] Backend notified: Agent ${agentId} left deleted zone ${data.zoneId}`);
        } catch (error) {
          console.error(`[StratixRTS] Failed to notify backend for agent ${agentId} leaving zone:`, error);
        }
      }
    }
  }

  private onZoneMemberJoined(data: { zoneId: string; agentId: string }): void {
    const { zoneId, agentId } = data;
    const previousZoneId = this.agentZoneTracking.get(agentId);

    // Start data flow animation if agent is moving between zones
    if (previousZoneId && previousZoneId !== zoneId && this.dataFlowAnimation) {
      this.dataFlowAnimation.startFlow(previousZoneId, zoneId);
    }

    // Update agent zone tracking
    this.agentZoneTracking.set(agentId, zoneId);
    this.stateBridge.agentEnterZone(agentId, zoneId);
    console.log(`[StratixRTS] Agent ${agentId} joined zone ${zoneId}`);

    // Animate agent sprite moving to zone position
    const sprite = this.agentSprites.get(agentId);
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (sprite && zone) {
      const bounds = zone.getBounds();
      const zoneX = bounds.x + bounds.width / 2;
      const zoneY = bounds.y + bounds.height / 2;
      // Use movement system for smooth animation
      this.movementSystem.moveTo(agentId, zoneX, zoneY);

      // Show zone badge on agent sprite
      // Use zone ID as fallback - could be enhanced to get zone title from ProjectZone
      sprite.setZoneBadge(zoneId, zoneId.substring(0, 8));

      console.log(`[StratixRTS] Agent ${agentId} animating to zone ${zoneId} at (${zoneX}, ${zoneY})`);
    }

    // Notify zone that member joined (for visual refresh if needed)
    rtsEventBus.emit('zone:member-joined' as any, { zoneId, agentId });
  }

  private onZoneMemberLeft(data: { zoneId: string; agentId: string }): void {
    const { zoneId, agentId } = data;
    // Remove from tracking
    this.agentZoneTracking.delete(agentId);
    this.stateBridge.agentLeaveZone(agentId);
    console.log(`[StratixRTS] Agent ${agentId} left zone ${zoneId}`);

    // Clear zone badge from agent sprite
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      sprite.clearZoneBadge();
    }

    // Notify zone that member left (for visual refresh if needed)
    rtsEventBus.emit('zone:member-left' as any, { zoneId, agentId });
  }

  public async addAgentSprite(config: StratixAgentConfig): Promise<AgentSprite> {
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
      
      this.characterRenderer.loadCharacterTexture(
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
    
    const sprite = new AgentSprite(this, x!, y!, config, textureKey!, isPlaceholder);
    this.add.existing(sprite);
    this.agentSprites.set(config.agentId, sprite);
    this.stateBridge.registerAgent(config.agentId, config.name, {});

    if (needsSavePosition) {
      this.saveAgentPositionAsync(config.agentId, config, { x: x!, y: y! });
    }
    
    return sprite;
  }
  
  private async saveAgentPositionAsync(agentId: string, config: StratixAgentConfig, position: { x: number; y: number }): Promise<void> {
    try {
      await fetch('/api/stratix/config/agent/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...config, position })
      });
      console.log(`[StratixRTS] Saved initial position for agent ${agentId}:`, position);
    } catch (e) {
      console.warn(`[StratixRTS] Failed to save initial position for agent ${agentId}:`, e);
    }
  }

  public removeAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.stateBridge.unregisterAgent(agentId);
      sprite.destroy();
      this.agentSprites.delete(agentId);
      this.selectedAgentIds.delete(agentId);
      this.emitSelectionChanged();
    }
  }

  public getAgentSprites(): Map<string, AgentSprite> {
    return this.agentSprites;
  }

  public updateAgentPosition(agentId: string, position: { x: number; y: number }): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      sprite.x = position.x;
      sprite.y = position.y;
    }
  }

  public getSelectedAgentIds(): Set<string> {
    return this.selectedAgentIds;
  }

  public getEventManager(): StratixRTSEventManager {
    return this.eventManager;
  }

  public getStatsCollector(): StatsCollector {
    return this.statsCollector;
  }

  public getSelectedAgent(): AgentSprite | undefined {
    const agentIds = Array.from(this.selectedAgentIds);
    return agentIds.length > 0 ? this.agentSprites.get(agentIds[0]) : undefined;
  }

  public getSelectedZone(): TaskZone | undefined {
    const zoneIds = Array.from(this.selectedZoneIds);
    const zone = zoneIds.length > 0 ? this.unifiedZoneManager.getZone(zoneIds[0]) : undefined;
    return zone instanceof TaskZone ? zone : undefined;
  }

  public selectAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.selectedAgentIds.add(agentId);
      sprite.setHighlight(true);
      sprite.setData('isSelected', true);
      this.emitSelectionChanged();
    }
  }

  public deselectAgent(agentId: string): void {
    const sprite = this.agentSprites.get(agentId);
    if (sprite) {
      this.selectedAgentIds.delete(agentId);
      sprite.setHighlight(false);
      sprite.setData('isSelected', false);
      this.emitSelectionChanged();
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
    this.emitSelectionChanged();
  }

  private emitSelectionChanged(): void {
    const selectedAgentIds = Array.from(this.selectedAgentIds);
    const selectedZoneIds = Array.from(this.selectedZoneIds);

    this.stateBridge.syncSelection(
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
      const zone = this.unifiedZoneManager.getZone(selectedZoneIds[0]);
      if (zone) {
        rtsEventBus.emit('scene:ui:zone_info' as any, {
          zoneId: zone.getZoneId(),
          name: (zone as any).zoneName || zone.getZoneId(),
          status: 'idle',
          agentCount: 0,
        });
      }
    }
  }

  shutdown(): void {
    if (this.projectZoneCheckTimer) {
      clearInterval(this.projectZoneCheckTimer);
      this.projectZoneCheckTimer = null;
    }

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

    this.dataFlowAnimation?.destroy();
    this.unifiedZoneManager.getAllZones().forEach(zone => zone.destroy());
    this.unifiedZoneManager.destroy();
  }

  public resize(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
  }

  // ==================== RTS Move API ====================

  /**
   * 获取所有 Zone 列表
   * @returns ZoneInfo 数组
   */
  public getZoneList(): ZoneInfo[] {
    const zones: ZoneInfo[] = [];

    // Get zones from unifiedZoneManager (includes TaskZones and ProjectZones)
    for (const [zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      const zoneName = (zone as any).zoneName || (zone as any).name || zoneId;

      // Count agents in this zone
      let agentCount = 0;
      this.agentSprites.forEach((sprite) => {
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
        status: (zone as any).zoneStatus || 'idle'
      });
    }

    return zones;
  }

  /**
   * 将 Agent 移动到指定 Zone
   * @param agentId Agent ID
   * @param zoneId 目标 Zone ID
   */
  public async moveTo(agentId: string, zoneId: string): Promise<void> {
    const sprite = this.agentSprites.get(agentId);
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
    this.movementSystem.moveTo(agentId, targetX, targetY);

    // Update tracking
    this.agentZoneTracking.set(agentId, zoneId);

    // Notify backend about zone entry (uses zone-level API to trigger gatewayEventBus event)
    try {
      const projectClient = this.projectManagerIntegration.getProjectClient();
      await projectClient.addZoneMember(zoneId, agentId);
      console.log(`[StratixRTS] Agent ${agentId} entered zone ${zoneId} (backend notified)`);
    } catch (error) {
      console.error(`[StratixRTS] Failed to notify backend about zone entry:`, error);
    }
  }

  /**
   * 让 Agent 离开当前 Zone
   * @param agentId Agent ID
   */
  public async leaveCurrentZone(agentId: string): Promise<void> {
    const sprite = this.agentSprites.get(agentId);
    if (!sprite) {
      console.warn(`[StratixRTS] Agent ${agentId} not found for leaveCurrentZone`);
      return;
    }

    const currentZoneId = this.agentZoneTracking.get(agentId);
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

    // Fallback: use corner positions as safe spots (guaranteed outside zones if zones don't cover corners)
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

    // Notify backend about zone leave BEFORE movement (to avoid race condition)
    try {
      const projectClient = this.projectManagerIntegration.getProjectClient();
      await projectClient.removeZoneMember(currentZoneId, agentId);
      console.log(`[StratixRTS] Agent ${agentId} left zone ${currentZoneId} (backend notified)`);
    } catch (error) {
      console.error(`[StratixRTS] Failed to notify backend about zone leave:`, error);
    }

    // Use movement system to move the agent
    this.movementSystem.moveTo(agentId, targetX, targetY);

    // Clear tracking AFTER notifying backend
    this.agentZoneTracking.delete(agentId);
  }

  /**
   * 获取 Agent 当前所在的 Zone
   * @param agentId Agent ID
   * @returns Zone ID 或 null（如果不在任何 Zone 中）
   */
  public getCurrentZone(agentId: string): string | null {
    return this.agentZoneTracking.get(agentId) || null;
  }

  /**
   * 检查指定位置是否在任何 Zone 内
   */
  private isPositionInAnyZone(x: number, y: number): boolean {
    for (const [_zoneId, zone] of this.unifiedZoneManager.getAllZones()) {
      const bounds = zone.getBounds();
      if (Phaser.Geom.Rectangle.Contains(bounds, x, y)) {
        return true;
      }
    }
    return false;
  }

  // ==================== Theme API ====================

  /**
   * 获取主题管理器
   */
  public getThemeManager(): ThemeManager {
    return this.themeManager;
  }

  /**
   * 获取地面装饰系统
   */
  public getGroundDecorationSystem(): GroundDecorationSystem {
    return this.groundDecorationSystem;
  }

  /**
   * 切换主题皮肤
   * @param theme 主题名称 ('fantasy' | 'cartoon' | 'cyberpunk' | 'nature')
   */
  public async setTheme(theme: ThemeName): Promise<void> {
    console.log(`[StratixRTS] Switching theme to: ${theme}`);
    await this.themeManager.setTheme(theme);
    this.themeSelectorUI?.setTheme(theme);
    rtsEventBus.emit('game:theme:changed' as any, { theme });
  }

  /**
   * 获取当前主题
   */
  public getCurrentTheme(): ThemeName {
    return this.themeManager.getCurrentTheme();
  }
}
