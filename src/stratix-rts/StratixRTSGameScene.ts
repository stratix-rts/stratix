import Phaser from 'phaser';

import { getToken, getCurrentTheme } from '@/design-system/config';

import { StratixAgentConfig, ZoneInfo } from '../stratix-core/stratix-protocol';
import { ProjectManagerIntegration } from '../stratix-project/ProjectManagerIntegration';

import { StratixRTSEventManager } from './StratixRTSEventManager';
import { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM } from './constants';
import { StatsCollector } from './debug/StatsCollector';
import { DataFlowAnimation } from './effects/DataFlowAnimation';
import { rtsEventBus } from './events/core/RTSEventBus';
import type { TopBarStats, ViewportState } from './events/types/RTSEventTypes';
import { RTSStateBridge } from './state/RTSStateBridge';
import RTSCharacterRenderer from './services/RTSCharacterRenderer';
import { AgentSprite, AgentStatus, CommandStatus } from './sprites/AgentSprite';
import { CommandType } from './systems/CommandSystem';
import { ControlGroupSystem } from './systems/ControlGroupSystem';
import { MovementSystem } from './systems/MovementSystem';
import { SelectBox } from './ui/SelectBox';

import { InputHandler, InputCallbacks } from './utils/InputHandler';
import { TaskZone } from './zones/TaskZone';
import { TaskZonePreview } from './zones/TaskZonePreview';
import { UnifiedZoneManager } from './zones/UnifiedZoneManager';
import { ThemeManager, ThemeName } from './themes/ThemeManager';
import { GroundDecorationSystem } from './ground/GroundDecorationSystem';
import { ThemeSelectorUI } from './ui/ThemeSelectorUI';
import { AgentManager } from './managers/AgentManager';
import { ZoneInteractionManager } from './managers/ZoneInteractionManager';
import { RenderModeSystem } from './systems/RenderModeSystem';


export { MAP_WIDTH, MAP_HEIGHT, TILE_SIZE, DEFAULT_ZOOM, MIN_ZOOM, MAX_ZOOM, BG_COLOR } from './constants';

export default class StratixRTSGameScene extends Phaser.Scene {
  private eventManager: StratixRTSEventManager;
  private inputHandler: InputHandler;
  private selectBox: SelectBox;
  private taskZonePreview: TaskZonePreview;

  private controlGroupSystem: ControlGroupSystem;
  private movementSystem: MovementSystem;
  private statsCollector: StatsCollector;
  private agentManager: AgentManager;
  private previewSelection: Set<string> = new Set();
  unifiedZoneManager: UnifiedZoneManager;
  private projectManagerIntegration: ProjectManagerIntegration;
  private zoneInteractionManager: ZoneInteractionManager;

  private characterRenderer: RTSCharacterRenderer;
  private eventUnsubscribers: (() => void)[] = [];
  private agentZoneTracking: Map<string, string> = new Map();
  private projectZoneCheckTimer: NodeJS.Timeout | null = null;
  private dataFlowAnimation: DataFlowAnimation;
  private zonePulseGraphics: Phaser.GameObjects.Graphics;
  private stateBridge: RTSStateBridge;
  private themeManager: ThemeManager;
  private groundDecorationSystem: GroundDecorationSystem;
  private themeSelectorUI: ThemeSelectorUI;
  private renderModeSystem: RenderModeSystem;

  // Backward compatibility fields
  get agentSprites(): Map<string, AgentSprite> {
    return this.agentManager.agentSprites;
  }

  get selectedAgentIds(): Set<string> {
    return this.agentManager.selectedAgentIds;
  }

  get selectedZoneIds(): Set<string> {
    return this.zoneInteractionManager.selectedZoneIds;
  }

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
    this.stateBridge = new RTSStateBridge();

    // Create managers after all dependencies are ready
    this.agentManager = new AgentManager(this, this.movementSystem, {
      stateBridge: this.stateBridge,
      characterRenderer: this.characterRenderer,
      projectManagerIntegration: this.projectManagerIntegration,
      agentZoneTracking: this.agentZoneTracking,
      getSelectedZoneIds: () => this.zoneInteractionManager.selectedZoneIds,
      getUnifiedZoneManager: () => this.unifiedZoneManager,
      clearZoneSelection: () => this.zoneInteractionManager.clearZoneSelection(),
    });

    this.movementSystem.setOnMovementComplete((agentId, x, y) => {
      this.agentManager.saveAgentPosition(agentId, x, y);
    });

    this.zoneInteractionManager = new ZoneInteractionManager(this, this.unifiedZoneManager, {
      taskZonePreview: this.taskZonePreview,
      getAgentSprites: () => this.agentManager.agentSprites,
      projectManagerIntegration: this.projectManagerIntegration,
      agentZoneTracking: this.agentZoneTracking,
      movementSystem: this.movementSystem,
      dataFlowAnimation: this.dataFlowAnimation,
      inputHandler: this.inputHandler,
      clearAgentSelection: () => this.agentManager.clearSelection(),
      emitSelectionChanged: () => this.agentManager.emitSelectionChanged(),
    });

    this.renderModeSystem = new RenderModeSystem();
    this.initInputHandler();
    this.initEventManager();
    this.initEventBusListeners();

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
    this.movementSystem?.update(_delta, this.agentManager.agentSprites);
    this.dataFlowAnimation?.update(_delta);
    this.dataFlowAnimation?.drawZonePulses(this.zonePulseGraphics);

    // Render mode LOD system: auto-switch agents to thumbnail mode in dense viewports
    this.renderModeSystem?.update(this.agentManager.agentSprites, this.cameras.main, _time);

    // Update agent positions for beam effects (only for agents in viewport)
    const camera = this.cameras.main;
    const buffer = 200;
    this.agentManager.agentSprites.forEach((sprite, agentId) => {
      const inViewport = sprite.x >= camera.scrollX - buffer &&
        sprite.x <= camera.scrollX + camera.width + buffer &&
        sprite.y >= camera.scrollY - buffer &&
        sprite.y <= camera.scrollY + camera.height + buffer;
      if (inViewport) {
        this.dataFlowAnimation?.setAgentPosition(agentId, sprite.x, sprite.y);
      }
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
    this.controlGroupSystem = new ControlGroupSystem();
    this.movementSystem = new MovementSystem();
    this.statsCollector = new StatsCollector();
  }

  private initSelectBox(): void {
    this.selectBox = new SelectBox(this);
  }

  private initTaskZonePreview(): void {
    this.taskZonePreview = new TaskZonePreview(this);
    this.taskZonePreview.setOverlapCheck((rect) => this.zoneInteractionManager.checkZoneOverlap(rect));
  }

  private initInputHandler(): void {
    const callbacks: InputCallbacks = {
      onSelect: (agentIds: string[], shiftKey: boolean) => this.agentManager.handleSelect(agentIds, shiftKey),
      onDeselect: () => this.agentManager.clearSelection(),
      onBoxSelect: (bounds: Phaser.Geom.Rectangle, shiftKey: boolean) => this.agentManager.handleBoxSelect(bounds, shiftKey),
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
      onSpriteDragStart: (agentId, x, y) => this.agentManager.handleSpriteDragStart(agentId, x, y),
      onSpriteDragUpdate: (x, y) => this.agentManager.handleSpriteDragUpdate(x, y),
      onSpriteDragEnd: () => this.agentManager.handleSpriteDragEnd(),
      onZoneDrawStart: (x, y) => this.zoneInteractionManager.handleZoneDrawStart(x, y),
      onZoneDrawUpdate: (x, y) => this.zoneInteractionManager.handleZoneDrawUpdate(x, y),
      onZoneDrawEnd: () => this.zoneInteractionManager.handleZoneDrawEnd(),
      onZoneDrawCancel: () => this.zoneInteractionManager.handleZoneDrawCancel(),
      onModeChange: (mode) => this.zoneInteractionManager.handleModeChange(mode),
      onSelectAllSameType: (agentId) => this.agentManager.handleSelectAllSameType(agentId),
      onCreateControlGroup: (groupId) => this.handleCreateControlGroup(groupId),
      onSelectControlGroup: (groupId, centerCamera) => this.handleSelectControlGroup(groupId, centerCamera),
      onSelectAllAgents: () => this.agentManager.handleSelectAllAgents(),
      onCenterView: () => this.handleCenterView(),
      onSaveState: () => this.handleSaveState(),
      onStopCommand: () => this.handleStopCommand(),
      onPatrolCommand: (x, y) => this.handlePatrolCommand(x, y),
      onZoneDragStart: (zoneId, x, y) => this.zoneInteractionManager.handleZoneDragStart(zoneId, x, y),
      onZoneDragUpdate: (x, y) => this.zoneInteractionManager.handleZoneDragUpdate(x, y),
      onZoneDragEnd: () => this.zoneInteractionManager.handleZoneDragEnd(),
      onZoneResizeStart: (zoneId, corner, x, y) => this.zoneInteractionManager.handleZoneResizeStart(zoneId, corner, x, y),
      onZoneResizeUpdate: (x, y) => this.zoneInteractionManager.handleZoneResizeUpdate(x, y),
      onZoneResizeEnd: () => this.zoneInteractionManager.handleZoneResizeEnd(),
      onCheckZoneOverlap: (rect, excludeZoneId) => this.zoneInteractionManager.checkZoneOverlap(rect, excludeZoneId),
      onZoneClick: (zoneId) => this.zoneInteractionManager.handleZoneClick(zoneId),
      onZoneDoubleClick: (zoneId) => this.zoneInteractionManager.handleZoneDoubleClick(zoneId),
      onDeleteSelectedZones: () => this.zoneInteractionManager.handleDeleteSelectedZones(),
      getTaskZoneAtPoint: (worldX, worldY) => this.zoneInteractionManager.getTaskZoneAtPoint(worldX, worldY),
      onZoom: (zoom) => console.log('[StratixRTS] Zoom:', zoom.toFixed(2))
    };

    this.inputHandler = new InputHandler(this, callbacks);
  }

  private updateSelectionPreview(): void {
    const bounds = this.selectBox.getCurrentBounds();
    if (!bounds) return;

    const newPreviewIds = new Set<string>();
    
    this.agentManager.agentSprites.forEach((sprite, agentId) => {
      if (Phaser.Geom.Rectangle.Contains(bounds, sprite.x, sprite.y)) {
        newPreviewIds.add(agentId);
      }
    });

    this.previewSelection.forEach(agentId => {
      if (!newPreviewIds.has(agentId)) {
        const sprite = this.agentManager.agentSprites.get(agentId);
        if (sprite && !this.agentManager.selectedAgentIds.has(agentId)) {
          sprite.setHighlight(false);
        }
      }
    });

    newPreviewIds.forEach(agentId => {
      if (!this.previewSelection.has(agentId)) {
        const sprite = this.agentManager.agentSprites.get(agentId);
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
    this.events.on('stratix:zone-created', this.onZoneCreated, this);
    this.events.on('stratix:zone-updated', this.onZoneUpdated, this);
    this.events.on('stratix:zone-deleted', this.onZoneDeleted, this);
    this.events.on('stratix:zone-member-joined', this.onZoneMemberJoined, this);
    this.events.on('stratix:zone-member-left', this.onZoneMemberLeft, this);
  }

  private initEventBusListeners(): void {
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:create_agent', async (data: any) => {
        await this.agentManager.addAgentSprite(data.config);
      })
    );
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:select_agents', (data: any) => {
        if (data.addToSelection) {
          data.agentIds.forEach((id: string) => this.agentManager.selectAgent(id));
        } else {
          this.agentManager.clearSelection();
          data.agentIds.forEach((id: string) => this.agentManager.selectAgent(id));
        }
      })
    );
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:deselect_all', () => {
        this.agentManager.clearSelection();
      })
    );
    
    this.eventUnsubscribers.push(
      rtsEventBus.on('vue:game:zone_delete_confirmed', (data: any) => {
        this.zoneInteractionManager.handleZoneDeleteConfirmed(data.zoneIds);
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
      this.zoneInteractionManager.clampAllZonesToBounds();
      this.zoneInteractionManager.syncZonePositionsToDataFlow();
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

  private async checkAgentsInProjectZones(): Promise<void> {
    const projectZones = this.projectManagerIntegration.getAllProjectZones();
    const projectClient = this.projectManagerIntegration.getProjectClient();

    for (const [agentId, sprite] of this.agentManager.agentSprites) {
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

  private emitStats(): void {
    rtsEventBus.emit('scene:ui:update_stats', this.getTopBarStats() as any);
  }

  private getTopBarStats(): TopBarStats {
    let onlineCount = 0;
    let busyCount = 0;
    
    this.agentManager.agentSprites.forEach((sprite) => {
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
      totalAgents: this.agentManager.agentSprites.size,
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

  private handleCreateControlGroup(groupId: number): void {
    if (this.agentManager.selectedAgentIds.size === 0) return;
    this.controlGroupSystem.createGroup(groupId, Array.from(this.agentManager.selectedAgentIds));
    console.log('[StratixRTS] Control group', groupId, 'created with', this.agentManager.selectedAgentIds.size, 'units');
  }

  private handleSelectControlGroup(groupId: number, centerCamera: boolean): void {
    const agentIds = this.controlGroupSystem.getGroupAgentIds(groupId);
    if (agentIds.length === 0) return;

    this.agentManager.clearSelection();
    agentIds.forEach(id => {
      this.agentManager.selectAgent(id);
    });

    if (centerCamera && agentIds.length > 0) {
      const firstSprite = this.agentManager.agentSprites.get(agentIds[0]);
      if (firstSprite) {
        this.cameras.main.centerOn(firstSprite.x, firstSprite.y);
      }
    }
  }

  private handleCommandMode(commandType: CommandType): void {
    console.log('[StratixRTS] Command mode:', commandType);
  }

  private handleCancelCommandMode(): void {
    console.log('[StratixRTS] Command mode cancelled');
  }

  private handleStopCommand(): void {
    if (this.agentManager.selectedAgentIds.size === 0) return;
    console.log('[StratixRTS] Stop command for', this.agentManager.selectedAgentIds.size, 'units');
  }

  private handleCenterView(): void {
    if (this.agentManager.selectedAgentIds.size === 0) {
      this.cameras.main.scrollX = 0;
      this.cameras.main.scrollY = 0;
      console.log('[StratixRTS] Centered on origin');
      return;
    }
    let sumX = 0, sumY = 0, count = 0;
    this.agentManager.selectedAgentIds.forEach(id => {
      const sprite = this.agentManager.agentSprites.get(id);
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
    if (this.agentManager.selectedAgentIds.size === 0) return;
    console.log('[StratixRTS] Patrol command to:', x, y);
  }

  private handleCommand(target: { x: number; y: number }, commandType?: CommandType): void {
    if (this.agentManager.selectedAgentIds.size === 0) return;
    
    const actualCommandType = commandType || 'move';
    console.log('[StratixRTS] Command:', actualCommandType, 'to:', target, 'agents:', Array.from(this.agentManager.selectedAgentIds));
    
    if (actualCommandType === 'move') {
      this.agentManager.selectedAgentIds.forEach(agentId => {
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
    this.agentManager.addAgentSprite(config).catch(err => {
      console.error('[StratixRTS] Failed to create agent sprite:', err);
    });
  }

  private onUpdateAgentStatus(data: { agentId: string; status: AgentStatus }): void {
    const sprite = this.agentManager.agentSprites.get(data.agentId);
    if (sprite) {
      sprite.setAgentStatus(data.status);
      this.stateBridge.updateAgentStatus(data.agentId, data.status);
    }
  }

  private onUpdateCommandStatus(data: { agentId: string; commandStatus: CommandStatus }): void {
    const sprite = this.agentManager.agentSprites.get(data.agentId);
    if (sprite) {
      sprite.setCommandStatus(data.commandStatus);
    }
  }

  private onZoneCreated(data: { zoneId: string; projectId?: string; title?: string; prompt?: string }): void {
    console.log(`[StratixRTS] Zone ${data.zoneId} created with title: ${data.title || 'Untitled'}`);
  }

  private onZoneUpdated(data: { zoneId: string; title?: string; prompt?: string }): void {
    if (data.title !== undefined) {
      this.projectManagerIntegration.updateProjectZoneTitle(data.zoneId, data.title);
      console.log(`[StratixRTS] Zone ${data.zoneId} title updated to: ${data.title}`);
    }
  }

  private async onZoneDeleted(data: { zoneId: string }): Promise<void> {
    this.projectManagerIntegration.removeProjectZone(data.zoneId);
    console.log(`[StratixRTS] Zone ${data.zoneId} removed (soft deleted)`);

    const agentsToRelease: string[] = [];
    for (const [agentId, zoneId] of this.agentZoneTracking.entries()) {
      if (zoneId === data.zoneId) {
        agentsToRelease.push(agentId);
        this.agentZoneTracking.delete(agentId);
        console.log(`[StratixRTS] Agent ${agentId} tracking removed (zone ${data.zoneId} deleted)`);
      }
    }

    if (agentsToRelease.length > 0) {
      const projectClient = this.projectManagerIntegration.getProjectClient();
      for (const agentId of agentsToRelease) {
        try {
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

    if (previousZoneId && previousZoneId !== zoneId && this.dataFlowAnimation) {
      this.dataFlowAnimation.startFlow(previousZoneId, zoneId);
    }

    this.agentZoneTracking.set(agentId, zoneId);
    this.stateBridge.agentEnterZone(agentId, zoneId);
    console.log(`[StratixRTS] Agent ${agentId} joined zone ${zoneId}`);

    const sprite = this.agentManager.agentSprites.get(agentId);
    const zone = this.unifiedZoneManager.getZone(zoneId);
    if (sprite && zone) {
      const bounds = zone.getBounds();
      const zoneX = bounds.x + bounds.width / 2;
      const zoneY = bounds.y + bounds.height / 2;
      this.movementSystem.moveTo(agentId, zoneX, zoneY);
      sprite.setZoneBadge(zoneId, zoneId.substring(0, 8));
      console.log(`[StratixRTS] Agent ${agentId} animating to zone ${zoneId} at (${zoneX}, ${zoneY})`);
    }

    rtsEventBus.emit('zone:member-joined' as any, { zoneId, agentId });
  }

  private onZoneMemberLeft(data: { zoneId: string; agentId: string }): void {
    const { zoneId, agentId } = data;
    this.agentZoneTracking.delete(agentId);
    this.stateBridge.agentLeaveZone(agentId);
    console.log(`[StratixRTS] Agent ${agentId} left zone ${zoneId}`);

    const sprite = this.agentManager.agentSprites.get(agentId);
    if (sprite) {
      sprite.clearZoneBadge();
    }

    rtsEventBus.emit('zone:member-left' as any, { zoneId, agentId });
  }

  // ==================== Public API Delegates ====================

  public async addAgentSprite(config: StratixAgentConfig): Promise<AgentSprite> {
    return this.agentManager.addAgentSprite(config);
  }

  public removeAgent(agentId: string): void {
    this.agentManager.removeAgent(agentId);
  }

  public getAgentSprites(): Map<string, AgentSprite> {
    return this.agentManager.getAgentSprites();
  }

  public updateAgentPosition(agentId: string, position: { x: number; y: number }): void {
    this.agentManager.updateAgentPosition(agentId, position);
  }

  public getSelectedAgentIds(): Set<string> {
    return this.agentManager.getSelectedAgentIds();
  }

  public getSelectedAgent(): AgentSprite | undefined {
    return this.agentManager.getSelectedAgent();
  }

  public selectAgent(agentId: string): void {
    this.agentManager.selectAgent(agentId);
  }

  public deselectAgent(agentId: string): void {
    this.agentManager.deselectAgent(agentId);
  }

  public clearSelection(): void {
    this.agentManager.clearSelection();
  }

  public selectZone(zoneId: string): void {
    this.zoneInteractionManager.selectZone(zoneId);
  }

  public deselectZone(zoneId: string): void {
    this.zoneInteractionManager.deselectZone(zoneId);
  }

  public clearZoneSelection(): void {
    this.zoneInteractionManager.clearZoneSelection();
  }

  public deleteZone(zoneId: string): void {
    this.zoneInteractionManager.deleteZone(zoneId);
  }

  public getTaskZones(): Map<string, TaskZone> {
    return this.zoneInteractionManager.getTaskZones();
  }

  public getSelectedZoneIds(): Set<string> {
    return this.zoneInteractionManager.getSelectedZoneIds();
  }

  public getSelectedZone(): TaskZone | undefined {
    return this.zoneInteractionManager.getSelectedZone();
  }

  public enterZoneDrawingMode(): void {
    this.zoneInteractionManager.enterZoneDrawingMode();
  }

  public exitZoneDrawingMode(): void {
    this.zoneInteractionManager.exitZoneDrawingMode();
  }

  public isInZoneDrawingMode(): boolean {
    return this.zoneInteractionManager.isInZoneDrawingMode();
  }

  public getZoneList(): ZoneInfo[] {
    return this.zoneInteractionManager.getZoneList();
  }

  public async moveTo(agentId: string, zoneId: string): Promise<void> {
    return this.zoneInteractionManager.moveTo(agentId, zoneId);
  }

  public async leaveCurrentZone(agentId: string): Promise<void> {
    return this.zoneInteractionManager.leaveCurrentZone(agentId);
  }

  public getCurrentZone(agentId: string): string | null {
    return this.zoneInteractionManager.getCurrentZone(agentId);
  }

  public getEventManager(): StratixRTSEventManager {
    return this.eventManager;
  }

  public getStatsCollector(): StatsCollector {
    return this.statsCollector;
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

  // ==================== Theme API ====================

  public getThemeManager(): ThemeManager {
    return this.themeManager;
  }

  public getGroundDecorationSystem(): GroundDecorationSystem {
    return this.groundDecorationSystem;
  }

  public async setTheme(theme: ThemeName): Promise<void> {
    console.log(`[StratixRTS] Switching theme to: ${theme}`);
    await this.themeManager.setTheme(theme);
    this.themeSelectorUI?.setTheme(theme);
    rtsEventBus.emit('game:theme:changed' as any, { theme });
  }

  public getCurrentTheme(): ThemeName {
    return this.themeManager.getCurrentTheme();
  }
}
