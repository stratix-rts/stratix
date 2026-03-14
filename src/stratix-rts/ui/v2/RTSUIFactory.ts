/**
 * RTS UI Factory - UI组件统一工厂
 * 
 * 创建和管理所有RTS UI组件
 * 使用V2响应式版本
 */

import Phaser from 'phaser';
import { TopBarV2, TopBarStats } from './TopBarV2';
import { MinimapV2 } from './MinimapV2';
import { CommandPanelV2, UnitInfo, Skill, AgentInfo, ZoneInfo, CommandPanelCallbacks } from './CommandPanelV2';

export interface RTSUIComponents {
  topBar: TopBarV2;
  minimap: MinimapV2;
  commandPanel: CommandPanelV2;
}

export interface RTSUIConfig {
  screenWidth: number;
  screenHeight: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  getStats: () => TopBarStats;
  getAgentSprites: () => Map<string, any>;
  getTaskZones: () => Map<string, any>;
  getSelectedZoneIds: () => Set<string>;
  getSelectedAgent: () => any | null;
  getSelectedZone: () => any | null;
  onSkillSelect: (skill: Skill) => void;
  onCommandExecute: (command: string) => void;
  onChatClick?: (agentIds: string[]) => void;
  onConfigClick?: (agentId: string) => void;
  onTaskClick?: (agentIds: string[]) => void;
  onStopClick?: (agentIds: string[]) => void;
  onAgentDeselect?: (agentId: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
  statsCollector?: any;
}

export class RTSUIFactory {
  private scene: Phaser.Scene;
  private components: RTSUIComponents | null = null;
  private config: RTSUIConfig;
  
  constructor(scene: Phaser.Scene, config: RTSUIConfig) {
    this.scene = scene;
    this.config = config;
  }
  
  createAll(): RTSUIComponents {
    const topBar = this.createTopBar();
    const minimap = this.createMinimap();
    const commandPanel = this.createCommandPanel();
    
    this.components = {
      topBar,
      minimap,
      commandPanel,
    };
    
    this.mountAll();
    
    return this.components;
  }
  
  private createTopBar(): TopBarV2 {
    const topBar = new TopBarV2(
      this.scene,
      0,
      0,
      this.config.screenWidth,
      this.config.getStats,
      this.config.statsCollector
    );
    topBar.create();
    return topBar;
  }
  
  private createMinimap(): MinimapV2 {
    const minimap = new MinimapV2(
      this.scene,
      this.config.screenWidth - 220,
      this.config.screenHeight - 140,
      this.config.camera,
      this.config.getAgentSprites,
      this.config.getTaskZones,
      this.config.getSelectedZoneIds
    );
    minimap.create();
    return minimap;
  }
  
  private createCommandPanel(): CommandPanelV2 {
    const callbacks: CommandPanelCallbacks = {
      onChatClick: this.config.onChatClick || (() => {}),
      onConfigClick: this.config.onConfigClick || (() => {}),
      onTaskClick: this.config.onTaskClick || (() => {}),
      onStopClick: this.config.onStopClick || (() => {}),
      onAgentDeselect: (this.config as any).onAgentDeselect || (() => {}),
      onSelectAll: (this.config as any).onSelectAll || (() => {}),
      onDeselectAll: (this.config as any).onDeselectAll || (() => {}),
    };
    
    const commandPanel = new CommandPanelV2(
      this.scene,
      0,
      this.config.screenHeight - 200,
      this.config.screenWidth - 220,
      180,
      this.config.onSkillSelect,
      this.config.onCommandExecute,
      callbacks
    );
    commandPanel.create();
    return commandPanel;
  }
  
  private mountAll(): void {
    if (!this.components) return;
    
    this.components.topBar.mount();
    this.components.minimap.mount();
    this.components.commandPanel.mount();
  }
  
  getComponents(): RTSUIComponents | null {
    return this.components;
  }
  
  resize(width: number, height: number): void {
    if (!this.components) return;
    
    this.components.topBar.resize(width);
    this.components.minimap.resize(200, 120);
    
    this.components.commandPanel.getConfig().width = width - 220;
    this.components.commandPanel.getConfig().y = height - 200;
  }
  
  destroy(): void {
    if (!this.components) return;
    
    this.components.topBar.destroy();
    this.components.minimap.destroy();
    this.components.commandPanel.destroy();
    
    this.components = null;
  }
}

export type { AgentInfo, ZoneInfo } from './CommandPanelV2';
