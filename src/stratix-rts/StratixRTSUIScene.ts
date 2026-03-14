import Phaser from 'phaser';
import { RTSUIFactory, type RTSUIComponents, type TopBarStats } from './ui/v2';
import { rtsEventBus } from './events/core/RTSEventBus';
import type {
  SceneToUIEvents,
  UIToGameEvents,
  GameToVueEvents,
  TopBarStats as EventTopBarStats,
  AgentInfo,
  ZoneInfo,
} from './events/types/RTSEventTypes';
import type { Skill } from './ui/v2/CommandPanelV2';
import { HelpPanel } from './ui/HelpPanel';

export default class StratixRTSUIScene extends Phaser.Scene {
  private uiFactory: RTSUIFactory | null = null;
  private uiComponents: RTSUIComponents | null = null;
  private helpPanel: HelpPanel | null = null;
  private currentStats: TopBarStats = {
    totalAgents: 0,
    onlineAgents: 0,
    busyAgents: 0,
    totalZones: 0,
    overallProgress: 0,
  };
  private selectedAgentIds: string[] = [];
  private selectedZoneIds: string[] = [];
  private selectedAgentInfo: AgentInfo | null = null;
  private selectedZoneInfo: ZoneInfo | null = null;
  private eventUnsubscribers: (() => void)[] = [];
  private isUIInitialized: boolean = false;

  constructor() {
    super({ key: 'StratixRTSUIScene' });
  }

  create(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.cameras.main.setScroll(0, 0);
    
    rtsEventBus.registerScene('ui', this);

    const gameScene = rtsEventBus.getScene('game');
    if (gameScene) {
      this.initUI(width, height);
    } else {
      rtsEventBus.once('scene:ui:game_ready', () => {
        if (!this.isUIInitialized) {
          this.initUI(width, height);
        }
      });
    }
    
    this.setupEventListeners();
  }

  private initUI(width: number, height: number): void {
    if (this.isUIInitialized) return;
    
    const gameScene = rtsEventBus.getScene('game') as Phaser.Scene & {
      getAgentSprites: () => Map<string, unknown>;
      getTaskZones: () => Map<string, unknown>;
      getSelectedZoneIds: () => Set<string>;
      getSelectedAgent: () => unknown;
      getSelectedZone: () => unknown;
      getStatsCollector: () => any;
      cameras: { main: Phaser.Cameras.Scene2D.Camera };
    };

    if (!gameScene) {
      console.warn('[UIScene] GameScene not available');
      return;
    }

    this.uiFactory = new RTSUIFactory(this, {
      screenWidth: width,
      screenHeight: height,
      camera: gameScene.cameras.main,
      getStats: () => this.currentStats,
      getAgentSprites: () => gameScene.getAgentSprites(),
      getTaskZones: () => gameScene.getTaskZones(),
      getSelectedZoneIds: () => gameScene.getSelectedZoneIds(),
      getSelectedAgent: () => gameScene.getSelectedAgent(),
      getSelectedZone: () => gameScene.getSelectedZone(),
      onSkillSelect: (skill: Skill) => this.handleSkillSelect(skill),
      onCommandExecute: (command: string) => this.handleCommandExecute(command),
      onChatClick: (agentIds: string[]) => this.handleChatClick(agentIds),
      onConfigClick: (agentId: string) => this.handleConfigClick(agentId),
      onTaskClick: (agentIds: string[]) => this.handleTaskClick(agentIds),
      onStopClick: (agentIds: string[]) => this.handleStopClick(agentIds),
      onAgentDeselect: (agentId: string) => this.handleAgentDeselect(agentId),
      onSelectAll: () => this.handleSelectAll(),
      onDeselectAll: () => this.handleDeselectAll(),
      statsCollector: gameScene.getStatsCollector(),
    });

    this.uiComponents = this.uiFactory.createAll();
    
    this.helpPanel = new HelpPanel({
      width: 600,
      maxHeight: 500,
      position: 'center',
      showSearch: true,
      showCategories: true,
    });
    this.helpPanel.mount(document.body);
    
    this.isUIInitialized = true;
  }

  private setupEventListeners(): void {
    this.eventUnsubscribers.push(
      rtsEventBus.on('scene:ui:update_stats', (data) => {
        this.currentStats = data as TopBarStats;
        if (this.uiComponents?.topBar) {
          (this.uiComponents.topBar as any).updateStats?.(data);
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('scene:ui:update_selection', (data) => {
        this.selectedAgentIds = data.selectedAgentIds;
        this.selectedZoneIds = data.selectedZoneIds;
        
        if (this.uiComponents?.commandPanel) {
          if (this.selectedAgentIds.length > 1) {
            const agentsInfo: any[] = [];
            this.selectedAgentIds.forEach(agentId => {
              const agent = this.getAgentInfoById(agentId);
              if (agent) {
                agentsInfo.push(agent);
              }
            });
            if (agentsInfo.length > 0) {
              this.uiComponents.commandPanel.updateSelectedAgents(agentsInfo);
            }
          } else if (this.selectedAgentIds.length === 1) {
            const agent = this.getAgentInfoById(this.selectedAgentIds[0]);
            if (agent) {
              this.uiComponents.commandPanel.updateAgentInfo(agent);
            }
          } else {
            this.uiComponents.commandPanel.updateAgentInfo(null);
          }
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('scene:ui:agent_info', (data) => {
        this.selectedAgentInfo = data;
        if (this.uiComponents?.commandPanel) {
          this.uiComponents.commandPanel.updateAgentInfo(data);
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('scene:ui:zone_info', (data) => {
        this.selectedZoneInfo = data;
        if (this.uiComponents?.commandPanel) {
          this.uiComponents.commandPanel.updateZoneInfo(data);
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('scene:ui:zone_info', (data) => {
        this.selectedZoneInfo = data;
        if (this.uiComponents?.commandPanel) {
          this.uiComponents.commandPanel.updateZoneInfo(data);
        }
      })
    );

    this.eventUnsubscribers.push(
      rtsEventBus.on('scene:ui:viewport_change', (data) => {
        if (this.uiComponents?.minimap) {
          (this.uiComponents.minimap as any).updateViewport?.(data);
        }
      })
    );
  }

  private handleSkillSelect(skill: Skill): void {
    rtsEventBus.emit('vue:game:skill_select' as any, { skill });
    rtsEventBus.emit('game:vue:skill_selected' as any, { skill });
  }

  private handleCommandExecute(command: string): void {
    if (this.selectedAgentIds.length === 0) return;

    const validCommands: Array<'move' | 'patrol' | 'stop' | 'hold' | 'return'> = 
      ['move', 'patrol', 'stop', 'hold', 'return'];
    
    if (validCommands.includes(command as typeof validCommands[number])) {
      rtsEventBus.emit('vue:game:command' as any, {
        command: command as typeof validCommands[number],
        agentIds: this.selectedAgentIds,
      });
    }
  }

  private handleChatClick(agentIds: string[]): void {
    rtsEventBus.emit('vue:ui:chat_click' as any, { agentIds });
    rtsEventBus.emit('game:ui:chat_click' as any, { agentIds });
  }

  private handleConfigClick(agentId: string): void {
    rtsEventBus.emit('vue:ui:config_click' as any, { agentId });
    rtsEventBus.emit('game:ui:config_click' as any, { agentId });
  }

  private handleTaskClick(agentIds: string[]): void {
    rtsEventBus.emit('vue:ui:task_click' as any, { agentIds });
    rtsEventBus.emit('game:ui:task_click' as any, { agentIds });
  }

  private handleStopClick(agentIds: string[]): void {
    rtsEventBus.emit('vue:game:stop_agents' as any, { agentIds });
    rtsEventBus.emit('game:vue:stop_agents' as any, { agentIds });
  }

  private handleAgentDeselect(agentId: string): void {
    rtsEventBus.emit('vue:game:deselect_agent' as any, { agentId });
    rtsEventBus.emit('game:vue:deselect_agent' as any, { agentId });
  }

  private handleSelectAll(): void {
    const gameScene = rtsEventBus.getScene('game') as any;
    if (gameScene) {
      const agentSprites = gameScene.getAgentSprites();
      const allAgentIds = Array.from(agentSprites.keys());
      rtsEventBus.emit('vue:game:select_agents' as any, { agentIds: allAgentIds });
    }
  }

  private handleDeselectAll(): void {
    rtsEventBus.emit('vue:game:deselect_all' as any, {});
    rtsEventBus.emit('game:vue:deselect_all' as any, {});
  }

  private getAgentInfoById(agentId: string): any {
    const gameScene = rtsEventBus.getScene('game') as any;
    if (!gameScene) return null;
    
    const agentSprites = gameScene.getAgentSprites();
    const agentSprite = agentSprites.get(agentId);
    
    if (agentSprite) {
      return {
        agentId: agentId,
        name: agentSprite.agentName || agentId,
        type: agentSprite.agentType || 'Unknown',
        status: agentSprite.agentStatus || 'offline',
        position: { x: agentSprite.x || 0, y: agentSprite.y || 0 },
      };
    }
    
    return null;
  }

  resize(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
    
    if (this.uiFactory) {
      this.uiFactory.resize(width, height);
    }

    const uiCamera = this.cameras.getCamera('ui');
    if (uiCamera) {
      uiCamera.setSize(width, height);
    }
  }

  update(_time: number, _delta: number): void {
    if (this.uiComponents?.topBar) {
      (this.uiComponents.topBar as any).update?.(_delta);
    }
  }

  shutdown(): void {
    this.eventUnsubscribers.forEach((unsub) => unsub());
    this.eventUnsubscribers = [];

    if (this.helpPanel) {
      this.helpPanel.destroy();
      this.helpPanel = null;
    }

    if (this.uiFactory) {
      this.uiFactory.destroy();
      this.uiFactory = null;
      this.uiComponents = null;
    }
  }
}
