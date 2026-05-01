/**
 * RTS UI Factory - UI组件统一工厂
 * 
 * 创建和管理所有RTS UI组件
 * 使用V2响应式版本
 */

import Phaser from 'phaser';

import { CommandPanelV2, Skill, CommandPanelCallbacks } from './CommandPanelV2';
import { HUD_LAYOUT } from './layout/HUDLayout';
import { MinimapV2 } from './MinimapV2';
import { TopBarV2, TopBarStats } from './TopBarV2';
import { ReplayControls } from './ReplayControls';
import { ToastManager } from './ToastManager';
import type { RecordingSession } from '../../events/replay';

export interface RTSUIComponents {
  topBar: TopBarV2;
  minimap: MinimapV2;
  commandPanel: CommandPanelV2;
  replayControls: ReplayControls;
  toastManager: ToastManager;
}

export interface RTSUIConfig {
  screenWidth: number;
  screenHeight: number;
  camera: Phaser.Cameras.Scene2D.Camera;
  getStats: () => TopBarStats;
  getAgentSprites: () => Map<string, any>;
  getTaskZones: () => Map<string, any>;
  getSelectedZoneIds: () => Set<string>;
  getSelectedAgentIds?: () => Set<string>;
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
  replayControls?: {
    onRecordingStarted?: () => void;
    onRecordingStopped?: (session: RecordingSession) => void;
    onPlaybackStarted?: () => void;
    onPlaybackPaused?: () => void;
    onPlaybackEnded?: () => void;
  };
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
    const toastManager = this.createToastManager();
    const commandPanel = this.createCommandPanel(toastManager);
    const replayControls = this.createReplayControls();
    
    this.components = {
      topBar,
      minimap,
      commandPanel,
      replayControls,
      toastManager,
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
      this.config.screenWidth - HUD_LAYOUT.minimapRightMargin,
      this.config.screenHeight - HUD_LAYOUT.minimapBottomMargin,
      this.config.camera,
      this.config.getAgentSprites,
      this.config.getTaskZones,
      this.config.getSelectedZoneIds,
      this.config.getSelectedAgentIds
    );
    minimap.create();
    return minimap;
  }
  
  private createToastManager(): ToastManager {
    const toastManager = new ToastManager(this.scene);
    return toastManager;
  }
  
  private createCommandPanel(toastManager: ToastManager): CommandPanelV2 {
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
      this.config.screenHeight - HUD_LAYOUT.commandPanelBottomMargin,
      this.config.screenWidth - HUD_LAYOUT.minimapRightMargin,
      HUD_LAYOUT.commandPanel.height,
      this.config.onSkillSelect,
      this.config.onCommandExecute,
      callbacks,
      toastManager
    );
    commandPanel.create();
    return commandPanel;
  }
  
  private createReplayControls(): ReplayControls {
    const replayConfig = this.config.replayControls || {};
    const width = this.config.screenWidth * 0.4;
    const replayControls = new ReplayControls(this.scene, {
      x: 0,
      y: 48,
      width,
      onRecordingStarted: replayConfig.onRecordingStarted,
      onRecordingStopped: replayConfig.onRecordingStopped,
      onPlaybackStarted: replayConfig.onPlaybackStarted,
      onPlaybackPaused: replayConfig.onPlaybackPaused,
      onPlaybackEnded: replayConfig.onPlaybackEnded,
    });
    replayControls.create();
    return replayControls;
  }
  
  private mountAll(): void {
    if (!this.components) return;
    
    this.components.topBar.mount();
    this.components.minimap.mount();
    this.components.commandPanel.mount();
    this.components.replayControls.mount();
    // ToastManager 不需要 mount，Toast 实例会自行 mount
  }
  
  getComponents(): RTSUIComponents | null {
    return this.components;
  }
  
  resize(width: number, height: number): void {
    if (!this.components) return;
    
    this.components.topBar.resize(width);
    this.components.minimap.resize(HUD_LAYOUT.minimap.width, HUD_LAYOUT.minimap.height);
    this.components.replayControls.resize(width * 0.4);
    this.components.toastManager.resize(width);
    
    this.components.commandPanel.getConfig().width = width - HUD_LAYOUT.minimapRightMargin;
    this.components.commandPanel.getConfig().y = height - HUD_LAYOUT.commandPanelBottomMargin;
  }
  
  destroy(): void {
    if (!this.components) return;
    
    this.components.topBar.destroy();
    this.components.minimap.destroy();
    this.components.commandPanel.destroy();
    this.components.replayControls.destroy();
    this.components.toastManager.destroy();
    
    this.components = null;
  }
}

export type { AgentInfo, ZoneInfo } from './CommandPanelV2';
