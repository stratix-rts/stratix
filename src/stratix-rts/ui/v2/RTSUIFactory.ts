/**
 * RTS UI Factory - UI组件统一工厂
 * 
 * 创建和管理所有RTS UI组件
 * 使用V2响应式版本
 */

import Phaser from 'phaser';
import { TopBarV2, TopBarStats } from './TopBarV2';
import { MinimapV2 } from './MinimapV2';
import { DetailPanelV2 } from './DetailPanelV2';
import { CommandPanelV2, UnitInfo, Skill } from './CommandPanelV2';

export interface RTSUIComponents {
  topBar: TopBarV2;
  minimap: MinimapV2;
  detailPanel: DetailPanelV2;
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
    const detailPanel = this.createDetailPanel();
    const commandPanel = this.createCommandPanel();
    
    this.components = {
      topBar,
      minimap,
      detailPanel,
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
      this.config.getStats
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
  
  private createDetailPanel(): DetailPanelV2 {
    const detailPanel = new DetailPanelV2(
      this.scene,
      0,
      50,
      300,
      this.config.screenHeight - 240,
      this.config.getSelectedAgent,
      this.config.getSelectedZone
    );
    detailPanel.create();
    return detailPanel;
  }
  
  private createCommandPanel(): CommandPanelV2 {
    const commandPanel = new CommandPanelV2(
      this.scene,
      320,
      this.config.screenHeight - 200,
      this.config.screenWidth - 540,
      180,
      this.config.onSkillSelect,
      this.config.onCommandExecute
    );
    commandPanel.create();
    return commandPanel;
  }
  
  private mountAll(): void {
    if (!this.components) return;
    
    this.components.topBar.mount();
    this.components.minimap.mount();
    this.components.detailPanel.mount();
    this.components.commandPanel.mount();
  }
  
  getComponents(): RTSUIComponents | null {
    return this.components;
  }
  
  resize(width: number, height: number): void {
    if (!this.components) return;
    
    this.components.topBar.resize(width);
    this.components.minimap.resize(200, 120);
    
    this.components.detailPanel.getConfig().height = height - 240;
    
    this.components.commandPanel.getConfig().width = width - 540;
    this.components.commandPanel.getConfig().y = height - 200;
  }
  
  destroy(): void {
    if (!this.components) return;
    
    this.components.topBar.destroy();
    this.components.minimap.destroy();
    this.components.detailPanel.destroy();
    this.components.commandPanel.destroy();
    
    this.components = null;
  }
}