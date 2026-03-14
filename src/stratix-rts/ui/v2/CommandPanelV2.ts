/**
 * CommandPanel V2 - 响应式版本
 * 
 * 集成详情和技能面板的Tab切换界面
 * 使用EnhancedUIComponent和响应式Token
 */

import Phaser from 'phaser';
import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';
import type { UIComponentConfig } from '@/stratix-core/ui/core/types/component.types';
import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

export interface UnitInfo {
  name: string;
  type: string;
  status: string;
  thumbnail?: string;
  health?: number;
  maxHealth?: number;
  currentTask?: string;
  taskProgress?: number;
  skills?: Record<string, number>;
}

export interface ZoneInfo {
  zoneId: string;
  name: string;
  status: string;
  agentCount: number;
}

export interface AgentInfo {
  agentId: string;
  name: string;
  type: string;
  status: string;
  position: { x: number; y: number };
  currentTask?: string;
  taskProgress?: number;
  skills?: Record<string, number>;
}

export interface CommandPanelCallbacks {
  onChatClick: (agentIds: string[]) => void;
  onConfigClick: (agentId: string) => void;
  onTaskClick: (agentIds: string[]) => void;
  onStopClick: (agentIds: string[]) => void;
  onAgentDeselect?: (agentId: string) => void;
  onSelectAll?: () => void;
  onDeselectAll?: () => void;
}

export interface Skill {
  skillId: string;
  name: string;
  description: string;
  icon?: string;
  hotkey?: string;
}

type TabType = 'detail' | 'skills';
type SelectionType = 'none' | 'agent' | 'zone';

export class CommandPanelV2 extends EnhancedUIComponent {
  private tabContainer: Phaser.GameObjects.Container | null = null;
  private contentContainer: Phaser.GameObjects.Container | null = null;
  private actionButtonContainer: Phaser.GameObjects.Container | null = null;
  private currentTab: TabType = 'detail';
  private currentSelectionType: SelectionType = 'none';
  private currentAgent: AgentInfo | null = null;
  private currentAgents: AgentInfo[] = [];
  private currentZone: ZoneInfo | null = null;
  private currentSkills: Skill[] = [];
  private onSkillSelect: (skill: Skill) => void;
  private onCommandExecute: (command: string) => void;
  private callbacks: CommandPanelCallbacks;
  
  private backgroundColor: ReactiveToken<string>;
  private backgroundSecondaryColor: ReactiveToken<string>;
  private backgroundTertiaryColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private textSecondaryColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  private accentColor: ReactiveToken<string>;
  private infoColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private dangerColor: ReactiveToken<string>;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    onSkillSelect: (skill: Skill) => void,
    onCommandExecute: (command: string) => void,
    callbacks: CommandPanelCallbacks = {
      onChatClick: () => {},
      onConfigClick: () => {},
      onTaskClick: () => {},
      onStopClick: () => {},
    }
  ) {
    super(scene, {
      x,
      y,
      width,
      height,
      reactiveTheme: true,
    });
    
    this.onSkillSelect = onSkillSelect;
    this.onCommandExecute = onCommandExecute;
    this.callbacks = callbacks;
    
    this.backgroundColor = this.useToken('colors.background.primary');
    this.backgroundSecondaryColor = this.useToken('colors.background.secondary');
    this.backgroundTertiaryColor = this.useToken('colors.background.tertiary');
    this.textPrimaryColor = this.useToken('colors.text.primary');
    this.textSecondaryColor = this.useToken('colors.text.secondary');
    this.textMutedColor = this.useToken('colors.text.muted');
    this.borderColor = this.useToken('colors.border.default');
    this.accentColor = this.useToken('colors.accent');
    this.infoColor = this.useToken('colors.semantic.info');
    this.successColor = this.useToken('colors.semantic.success');
    this.warningColor = this.useToken('colors.warning');
    this.dangerColor = this.useToken('colors.semantic.danger');
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);
    
    this.createBackground();
    this.createContentContainer();
    this.createActionButtonContainer();
    this.showEmptyState();
    
    this.onCreate();
  }
  
  private createBackground(): void {
    const bg = this.scene.add.graphics();
    const bgColor = this.hexToNumber(this.backgroundColor.get());
    bg.fillStyle(bgColor, 0.95);
    bg.fillRoundedRect(0, 0, this.config.width || 500, this.config.height || 180, 8);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
    bg.strokeRoundedRect(0, 0, this.config.width || 500, this.config.height || 180, 8);
    (this.container as Phaser.GameObjects.Container).add(bg);
  }
  
  private createTabBar(): void {
    this.tabContainer = this.scene.add.container(0, 0);
    (this.container as Phaser.GameObjects.Container).add(this.tabContainer);
    
    this.renderTabs();
  }
  
  private renderTabs(): void {
    this.tabContainer?.removeAll(true);
    
    const tabWidth = 80;
    const tabHeight = 32;
    const tabSpacing = 4;
    
    const tabs: { key: TabType; label: string }[] = [
      { key: 'detail', label: '详情' },
      { key: 'skills', label: '技能' },
    ];
    
    tabs.forEach((tab, index) => {
      const x = 12 + index * (tabWidth + tabSpacing);
      const isActive = this.currentTab === tab.key;
      
      const tabBg = this.scene.add.graphics();
      if (isActive) {
        tabBg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
      } else {
        tabBg.fillStyle(this.hexToNumber(this.backgroundSecondaryColor.get()), 0.5);
      }
      tabBg.fillRoundedRect(x, 8, tabWidth, tabHeight, { tl: 4, tr: 4, bl: 0, br: 0 });
      
      const tabHitArea = this.scene.add.rectangle(x, 8, tabWidth, tabHeight, 0x000000, 0);
      tabHitArea.setOrigin(0, 0);
      tabHitArea.setInteractive({ useHandCursor: true });
      
      const tabText = this.createText(x + tabWidth / 2, 8 + tabHeight / 2, tab.label, {
        fontSize: '13px',
        fontStyle: isActive ? 'bold' : 'normal',
        color: isActive ? this.textPrimaryColor.get() : this.textMutedColor.get(),
      });
      tabText.setOrigin(0.5);
      
      tabHitArea.on('pointerdown', () => {
        this.switchTab(tab.key);
      });
      
      tabHitArea.on('pointerover', () => {
        if (!isActive) {
          tabBg.clear();
          tabBg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 0.7);
          tabBg.fillRoundedRect(x, 8, tabWidth, tabHeight, { tl: 4, tr: 4, bl: 0, br: 0 });
        }
      });
      
      tabHitArea.on('pointerout', () => {
        if (!isActive) {
          tabBg.clear();
          tabBg.fillStyle(this.hexToNumber(this.backgroundSecondaryColor.get()), 0.5);
          tabBg.fillRoundedRect(x, 8, tabWidth, tabHeight, { tl: 4, tr: 4, bl: 0, br: 0 });
        }
      });
      
      this.tabContainer?.add([tabBg, tabHitArea, tabText]);
    });
  }
  
  private createContentContainer(): void {
    this.contentContainer = this.scene.add.container(12, 48);
    (this.container as Phaser.GameObjects.Container).add(this.contentContainer);
  }
  
  private createActionButtonContainer(): void {
    this.actionButtonContainer = this.scene.add.container(12, (this.config.height || 180) - 40);
    (this.container as Phaser.GameObjects.Container).add(this.actionButtonContainer);
    this.renderActionButtons();
  }
  
  private renderActionButtons(): void {
    this.actionButtonContainer?.removeAll(true);
    
    const isMultiSelect = this.currentAgents.length > 1;
    const buttonWidth = 70;
    const buttonHeight = 28;
    const buttonSpacing = 8;
    
    let buttons: { key: string; label: string; icon: string; enabled: boolean }[];
    
    if (isMultiSelect) {
      buttons = [
        { key: 'chat', label: '群聊', icon: '💬', enabled: true },
        { key: 'task', label: '任务', icon: '📋', enabled: true },
        { key: 'stop', label: '停止', icon: '⏹️', enabled: true },
      ];
    } else {
      buttons = [
        { key: 'chat', label: '聊天', icon: '💬', enabled: true },
        { key: 'config', label: '配置', icon: '⚙️', enabled: true },
        { key: 'task', label: '任务', icon: '📋', enabled: true },
        { key: 'stop', label: '停止', icon: '⏹️', enabled: true },
      ];
    }
    
    const totalWidth = buttons.length * buttonWidth + (buttons.length - 1) * buttonSpacing;
    const startX = ((this.config.width || 500) - 24 - totalWidth) / 2;
    
    buttons.forEach((btn, index) => {
      const x = startX + index * (buttonWidth + buttonSpacing);
      const button = this.createActionButton(x, 0, buttonWidth, buttonHeight, btn);
      this.actionButtonContainer?.add(button);
    });
  }
  
  private createActionButton(
    x: number,
    y: number,
    width: number,
    height: number,
    btn: { key: string; label: string; icon: string; enabled: boolean }
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
    bg.fillRoundedRect(0, 0, width, height, 4);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
    bg.strokeRoundedRect(0, 0, width, height, 4);
    container.add(bg);
    
    const hitArea = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    container.add(hitArea);
    
    const iconText = this.scene.add.text(8, height / 2, btn.icon, {
      fontSize: '12px',
    });
    iconText.setOrigin(0, 0.5);
    container.add(iconText);
    
    const labelText = this.createText(24, height / 2, btn.label, {
      fontSize: '11px',
      color: this.textPrimaryColor.get(),
    });
    labelText.setOrigin(0, 0.5);
    container.add(labelText);
    
    hitArea.on('pointerdown', () => {
      if (!btn.enabled) return;
      
      const agentIds = this.currentAgents.map(a => a.agentId);
      const singleAgentId = this.currentAgent?.agentId;
      
      switch (btn.key) {
        case 'chat':
          this.callbacks.onChatClick(agentIds);
          break;
        case 'config':
          if (singleAgentId) {
            this.callbacks.onConfigClick(singleAgentId);
          }
          break;
        case 'task':
          this.callbacks.onTaskClick(agentIds);
          break;
        case 'stop':
          this.callbacks.onStopClick(agentIds);
          break;
      }
    });
    
    hitArea.on('pointerover', () => {
      if (!btn.enabled) return;
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.accentColor.get()), 0.3);
      bg.fillRoundedRect(0, 0, width, height, 4);
      bg.lineStyle(1, this.hexToNumber(this.accentColor.get()), 0.6);
      bg.strokeRoundedRect(0, 0, width, height, 4);
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
      bg.fillRoundedRect(0, 0, width, height, 4);
      bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
      bg.strokeRoundedRect(0, 0, width, height, 4);
    });
    
    return container;
  }
  
  private switchTab(tab: TabType): void {
    if (this.currentTab === tab) return;
    
    this.currentTab = tab;
    this.renderTabs();
    this.renderContent();
  }
  
  private renderContent(): void {
    this.contentContainer?.removeAll(true);
    
    if (this.currentSelectionType === 'none') {
      this.showEmptyState();
      return;
    }
    
    if (this.currentSelectionType === 'agent') {
      if (this.currentAgents.length > 1) {
        this.renderMultiAgentDetail();
      } else if (this.currentAgent) {
        this.renderAgentDetail(this.currentAgent);
      }
    } else if (this.currentSelectionType === 'zone' && this.currentZone) {
      this.renderZoneDetail(this.currentZone);
    }
  }
  
  private renderDetailContent(): void {
    if (this.currentSelectionType === 'none') {
      this.showEmptyState();
      return;
    }
    
    if (this.currentSelectionType === 'agent') {
      if (this.currentAgents.length > 1) {
        this.renderMultiAgentDetail();
      } else if (this.currentAgent) {
        this.renderAgentDetail(this.currentAgent);
      }
    } else if (this.currentSelectionType === 'zone' && this.currentZone) {
      this.renderZoneDetail(this.currentZone);
    }
  }
  
  private renderMultiAgentDetail(): void {
    const contentWidth = (this.config.width || 500) - 24;
    let yOffset = 0;
    
    const headerText = this.createText(0, yOffset, '选中头像列表', {
      fontSize: '12px',
      fontStyle: 'bold',
      color: this.textSecondaryColor.get(),
    });
    this.contentContainer?.add(headerText);
    yOffset += 20;
    
    const avatarSize = 40;
    const avatarSpacing = 8;
    const avatarsPerRow = Math.floor((contentWidth + avatarSpacing) / (avatarSize + avatarSpacing));
    const maxVisibleAvatars = avatarsPerRow * 2;
    const displayAgents = this.currentAgents.slice(0, maxVisibleAvatars);
    
    displayAgents.forEach((agent, index) => {
      const row = Math.floor(index / avatarsPerRow);
      const col = index % avatarsPerRow;
      const x = col * (avatarSize + avatarSpacing);
      const y = yOffset + row * (avatarSize + avatarSpacing);
      
      const avatarContainer = this.createAvatarItem(x, y, avatarSize, agent);
      this.contentContainer?.add(avatarContainer);
    });
    
    yOffset += Math.ceil(displayAgents.length / avatarsPerRow) * (avatarSize + avatarSpacing);
    
    if (this.currentAgents.length > maxVisibleAvatars) {
      const moreText = this.createText(0, yOffset, `+${this.currentAgents.length - maxVisibleAvatars} 个`, {
        fontSize: '11px',
        color: this.textMutedColor.get(),
      });
      this.contentContainer?.add(moreText);
      yOffset += 20;
    }
    
    yOffset += 8;
    
    const countText = this.createText(0, yOffset, `已选择 ${this.currentAgents.length} 个 Agent`, {
      fontSize: '12px',
      fontStyle: 'bold',
      color: this.textPrimaryColor.get(),
    });
    this.contentContainer?.add(countText);
    yOffset += 24;
    
    const buttonWidth = 60;
    const buttonHeight = 24;
    const buttonSpacing = 8;
    
    const selectAllBtn = this.createSmallButton(0, yOffset, buttonWidth, buttonHeight, '全选', () => {
      this.callbacks.onSelectAll?.();
    });
    this.contentContainer?.add(selectAllBtn);
    
    const deselectAllBtn = this.createSmallButton(buttonWidth + buttonSpacing, yOffset, buttonWidth, buttonHeight, '取消', () => {
      this.callbacks.onDeselectAll?.();
    });
    this.contentContainer?.add(deselectAllBtn);
  }
  
  private createAvatarItem(x: number, y: number, size: number, agent: AgentInfo): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
    bg.fillRoundedRect(0, 0, size, size, 6);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
    bg.strokeRoundedRect(0, 0, size, size, 6);
    container.add(bg);
    
    const icon = this.scene.add.text(size / 2, size / 2, '👤', {
      fontSize: `${size * 0.5}px`,
    });
    icon.setOrigin(0.5);
    container.add(icon);
    
    const statusDot = this.scene.add.graphics();
    const statusColor = this.getStatusColor(agent.status);
    statusDot.fillStyle(this.hexToNumber(statusColor), 1);
    statusDot.fillCircle(size - 6, size - 6, 5);
    container.add(statusDot);
    
    const hitArea = this.scene.add.rectangle(size / 2, size / 2, size, size, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    container.add(hitArea);
    
    hitArea.on('pointerdown', () => {
      this.callbacks.onAgentDeselect?.(agent.agentId);
    });
    
    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.dangerColor.get()), 0.3);
      bg.fillRoundedRect(0, 0, size, size, 6);
      bg.lineStyle(1, this.hexToNumber(this.dangerColor.get()), 0.6);
      bg.strokeRoundedRect(0, 0, size, size, 6);
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
      bg.fillRoundedRect(0, 0, size, size, 6);
      bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
      bg.strokeRoundedRect(0, 0, size, size, 6);
    });
    
    return container;
  }
  
  private createSmallButton(x: number, y: number, width: number, height: number, label: string, onClick: () => void): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(this.hexToNumber(this.backgroundSecondaryColor.get()), 1);
    bg.fillRoundedRect(0, 0, width, height, 4);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
    bg.strokeRoundedRect(0, 0, width, height, 4);
    container.add(bg);
    
    const hitArea = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    container.add(hitArea);
    
    const labelText = this.createText(width / 2, height / 2, label, {
      fontSize: '11px',
      color: this.textPrimaryColor.get(),
    });
    labelText.setOrigin(0.5);
    container.add(labelText);
    
    hitArea.on('pointerdown', onClick);
    
    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.accentColor.get()), 0.3);
      bg.fillRoundedRect(0, 0, width, height, 4);
      bg.lineStyle(1, this.hexToNumber(this.accentColor.get()), 0.6);
      bg.strokeRoundedRect(0, 0, width, height, 4);
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.backgroundSecondaryColor.get()), 1);
      bg.fillRoundedRect(0, 0, width, height, 4);
      bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
      bg.strokeRoundedRect(0, 0, width, height, 4);
    });
    
    return container;
  }
  
  private renderAgentDetail(agent: AgentInfo): void {
    const contentWidth = (this.config.width || 500) - 24;
    let yOffset = 0;
    
    const avatarBg = this.scene.add.graphics();
    avatarBg.fillStyle(0x2a2a4e, 1);
    avatarBg.fillRoundedRect(0, yOffset, 60, 60, 8);
    avatarBg.lineStyle(2, this.hexToNumber(this.borderColor.get()), 0.5);
    avatarBg.strokeRoundedRect(0, yOffset, 60, 60, 8);
    this.contentContainer?.add(avatarBg);
    
    const typeIcon = this.scene.add.text(30, yOffset + 30, '👤', {
      fontSize: '28px',
    });
    typeIcon.setOrigin(0.5);
    this.contentContainer?.add(typeIcon);
    
    const nameText = this.createText(72, yOffset + 8, agent.name, {
      fontSize: '16px',
      fontStyle: 'bold',
    });
    this.contentContainer?.add(nameText);
    
    const typeText = this.createText(72, yOffset + 30, `类型: ${agent.type}`, {
      fontSize: '12px',
      color: this.textSecondaryColor.get(),
    });
    this.contentContainer?.add(typeText);
    
    const statusColor = this.getStatusColor(agent.status);
    const statusDot = this.scene.add.graphics();
    statusDot.fillStyle(this.hexToNumber(statusColor), 1);
    statusDot.fillCircle(78, yOffset + 54, 5);
    this.contentContainer?.add(statusDot);
    
    const statusText = this.createText(90, yOffset + 48, this.getStatusText(agent.status), {
      fontSize: '12px',
      color: statusColor,
    });
    this.contentContainer?.add(statusText);
    
    yOffset += 75;
    
    if (agent.currentTask) {
      const taskLabel = this.createText(0, yOffset, '当前任务', {
        fontSize: '12px',
        fontStyle: 'bold',
        color: this.textSecondaryColor.get(),
      });
      this.contentContainer?.add(taskLabel);
      yOffset += 18;
      
      const taskText = this.createText(0, yOffset, agent.currentTask, {
        fontSize: '11px',
        color: this.textMutedColor.get(),
        wordWrap: { width: contentWidth },
      });
      this.contentContainer?.add(taskText);
      yOffset += 20;
      
      if (agent.taskProgress !== undefined) {
        this.renderProgressBar(0, yOffset, contentWidth, agent.taskProgress);
        yOffset += 25;
      }
    }
    
    if (agent.skills && Object.keys(agent.skills).length > 0) {
      const skillsLabel = this.createText(0, yOffset, '技能', {
        fontSize: '12px',
        fontStyle: 'bold',
        color: this.textSecondaryColor.get(),
      });
      this.contentContainer?.add(skillsLabel);
      yOffset += 18;
      
      const skillEntries = Object.entries(agent.skills).slice(0, 4);
      const skillWidth = (contentWidth - (skillEntries.length - 1) * 8) / skillEntries.length;
      
      skillEntries.forEach(([skillName, level], index) => {
        const x = index * (skillWidth + 8);
        const skillBg = this.scene.add.graphics();
        skillBg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
        skillBg.fillRoundedRect(x, yOffset, skillWidth, 24, 4);
        this.contentContainer?.add(skillBg);
        
        const skillText = this.createText(x + 8, yOffset + 6, `${skillName}`, {
          fontSize: '10px',
          color: this.textSecondaryColor.get(),
        });
        this.contentContainer?.add(skillText);
        
        const levelText = this.createText(x + skillWidth - 8, yOffset + 6, `Lv.${level}`, {
          fontSize: '10px',
          fontStyle: 'bold',
          color: this.accentColor.get(),
        });
        levelText.setOrigin(1, 0);
        this.contentContainer?.add(levelText);
      });
    }
  }
  
  private renderZoneDetail(zone: ZoneInfo): void {
    const contentWidth = (this.config.width || 500) - 24;
    let yOffset = 0;
    
    const zoneIconBg = this.scene.add.graphics();
    zoneIconBg.fillStyle(this.hexToNumber(this.accentColor.get()), 0.2);
    zoneIconBg.fillRoundedRect(0, yOffset, 60, 60, 8);
    zoneIconBg.lineStyle(2, this.hexToNumber(this.accentColor.get()), 0.5);
    zoneIconBg.strokeRoundedRect(0, yOffset, 60, 60, 8);
    this.contentContainer?.add(zoneIconBg);
    
    const zoneIcon = this.scene.add.text(30, yOffset + 30, '📦', {
      fontSize: '28px',
    });
    zoneIcon.setOrigin(0.5);
    this.contentContainer?.add(zoneIcon);
    
    const nameText = this.createText(72, yOffset + 8, zone.name, {
      fontSize: '16px',
      fontStyle: 'bold',
    });
    this.contentContainer?.add(nameText);
    
    const statusColor = this.getZoneStatusColor(zone.status);
    const statusText = this.createText(72, yOffset + 30, `状态: ${this.getZoneStatusText(zone.status)}`, {
      fontSize: '12px',
      color: statusColor,
    });
    this.contentContainer?.add(statusText);
    
    const agentsText = this.createText(72, yOffset + 48, `代理数量: ${zone.agentCount}`, {
      fontSize: '12px',
      color: this.textSecondaryColor.get(),
    });
    this.contentContainer?.add(agentsText);
  }
  
  private renderProgressBar(x: number, y: number, width: number, progress: number): void {
    const barHeight = 6;
    
    const progressBg = this.scene.add.graphics();
    progressBg.fillStyle(this.hexToNumber(this.borderColor.get()), 1);
    progressBg.fillRoundedRect(x, y, width, barHeight, 3);
    this.contentContainer?.add(progressBg);
    
    const progressFill = this.scene.add.graphics();
    progressFill.fillStyle(this.hexToNumber(this.successColor.get()), 1);
    progressFill.fillRoundedRect(x, y, width * Math.min(progress, 100) / 100, barHeight, 3);
    this.contentContainer?.add(progressFill);
    
    const progressText = this.createText(x + width + 8, y - 2, `${Math.round(progress)}%`, {
      fontSize: '11px',
      color: this.textSecondaryColor.get(),
    });
    this.contentContainer?.add(progressText);
  }
  
  private renderSkillsContent(): void {
    if (this.currentSkills.length === 0) {
      const emptyText = this.createText(
        ((this.config.width || 500) - 24) / 2,
        40,
        '无可用技能',
        {
          fontSize: '14px',
          color: this.textMutedColor.get(),
        }
      );
      emptyText.setOrigin(0.5);
      this.contentContainer?.add(emptyText);
      return;
    }
    
    const contentWidth = (this.config.width || 500) - 24;
    const buttonWidth = 72;
    const buttonHeight = 72;
    const spacing = 8;
    const buttonsPerRow = Math.floor((contentWidth + spacing) / (buttonWidth + spacing));
    
    this.currentSkills.forEach((skill, index) => {
      const row = Math.floor(index / buttonsPerRow);
      const col = index % buttonsPerRow;
      const x = col * (buttonWidth + spacing);
      const y = row * (buttonHeight + spacing);
      
      const button = this.createSkillButton(x, y, buttonWidth, buttonHeight, skill);
      this.contentContainer?.add(button);
    });
  }
  
  private createSkillButton(
    x: number,
    y: number,
    width: number,
    height: number,
    skill: Skill
  ): Phaser.GameObjects.Container {
    const container = this.scene.add.container(x, y);
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
    bg.fillRoundedRect(0, 0, width, height, 6);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
    bg.strokeRoundedRect(0, 0, width, height, 6);
    container.add(bg);
    
    const hitArea = this.scene.add.rectangle(width / 2, height / 2, width, height, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    container.add(hitArea);
    
    const nameText = this.createText(width / 2, height / 2 - 8, skill.name, {
      fontSize: '11px',
      wordWrap: { width: width - 8 },
      align: 'center',
    });
    nameText.setOrigin(0.5);
    container.add(nameText);
    
    if (skill.hotkey) {
      const hotkeyBg = this.scene.add.graphics();
      hotkeyBg.fillStyle(this.hexToNumber(this.infoColor.get()), 0.2);
      hotkeyBg.fillRoundedRect(width - 22, 4, 18, 16, 3);
      container.add(hotkeyBg);
      
      const hotkeyText = this.createText(width - 13, 12, skill.hotkey, {
        fontSize: '10px',
        fontStyle: 'bold',
        color: this.infoColor.get(),
      });
      hotkeyText.setOrigin(0.5);
      container.add(hotkeyText);
    }
    
    hitArea.on('pointerdown', () => {
      this.onSkillSelect(skill);
    });
    
    hitArea.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.accentColor.get()), 0.3);
      bg.fillRoundedRect(0, 0, width, height, 6);
      bg.lineStyle(1, this.hexToNumber(this.accentColor.get()), 0.6);
      bg.strokeRoundedRect(0, 0, width, height, 6);
    });
    
    hitArea.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
      bg.fillRoundedRect(0, 0, width, height, 6);
      bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
      bg.strokeRoundedRect(0, 0, width, height, 6);
    });
    
    return container;
  }
  
  private showEmptyState(): void {
    const contentWidth = (this.config.width || 500) - 24;
    const contentHeight = (this.config.height || 180) - 60;
    
    const emptyIcon = this.scene.add.text(contentWidth / 2, contentHeight / 2 - 20, '📋', {
      fontSize: '32px',
    });
    emptyIcon.setOrigin(0.5);
    this.contentContainer?.add(emptyIcon);
    
    const emptyText = this.createText(contentWidth / 2, contentHeight / 2 + 20, '未选中任何对象', {
      fontSize: '14px',
      color: this.textMutedColor.get(),
    });
    emptyText.setOrigin(0.5);
    this.contentContainer?.add(emptyText);
  }
  
  public updateAgentInfo(agent: AgentInfo | null): void {
    const isChanged = this.currentAgent?.agentId !== agent?.agentId;
    if (!isChanged && this.currentSelectionType === (agent ? 'agent' : 'none')) {
      return;
    }
    
    this.currentSelectionType = agent ? 'agent' : 'none';
    this.currentAgent = agent;
    this.currentAgents = agent ? [agent] : [];
    
    if (this.currentTab !== 'detail') {
      this.currentTab = 'detail';
      this.renderTabs();
    }
    this.renderContent();
    this.renderActionButtons();
  }
  
  public updateSelectedAgents(agents: AgentInfo[]): void {
    this.currentAgents = agents;
    this.currentAgent = agents.length === 1 ? agents[0] : null;
    this.currentSelectionType = agents.length > 0 ? 'agent' : 'none';
    
    if (this.currentTab !== 'detail') {
      this.currentTab = 'detail';
      this.renderTabs();
    }
    this.renderContent();
    this.renderActionButtons();
  }
  
  public updateZoneInfo(zone: ZoneInfo | null): void {
    const isChanged = this.currentZone?.zoneId !== zone?.zoneId;
    if (!isChanged && this.currentSelectionType === (zone ? 'zone' : 'none')) {
      return;
    }
    
    this.currentSelectionType = zone ? 'zone' : 'none';
    this.currentZone = zone;
    this.currentAgents = [];
    this.currentAgent = null;
    
    if (this.currentTab !== 'detail') {
      this.currentTab = 'detail';
      this.renderTabs();
    }
    this.renderContent();
    this.renderActionButtons();
  }
  
  public setSkills(skills: Skill[]): void {
    this.currentSkills = skills;
    
    if (this.currentTab === 'skills') {
      this.renderContent();
    }
  }
  
  public setUnit(unit: UnitInfo): void {
    this.currentSelectionType = 'agent';
    this.currentAgent = {
      agentId: '',
      name: unit.name,
      type: unit.type,
      status: unit.status,
      position: { x: 0, y: 0 },
      currentTask: unit.currentTask,
      taskProgress: unit.taskProgress,
      skills: unit.skills,
    };
    
    if (this.currentTab === 'detail') {
      this.renderContent();
    }
  }
  
  private getStatusColor(status: string): string {
    const colors: Record<string, string> = {
      online: this.successColor.get(),
      offline: this.textMutedColor.get(),
      busy: this.warningColor.get(),
      error: this.dangerColor.get(),
    };
    return colors[status] || this.textMutedColor.get();
  }
  
  private getStatusText(status: string): string {
    const texts: Record<string, string> = {
      online: '在线',
      offline: '离线',
      busy: '忙碌',
      error: '错误',
    };
    return texts[status] || '未知';
  }
  
  private getZoneStatusColor(status: string): string {
    const colors: Record<string, string> = {
      idle: this.textMutedColor.get(),
      busy: this.warningColor.get(),
      active: this.successColor.get(),
      error: this.dangerColor.get(),
    };
    return colors[status] || this.textMutedColor.get();
  }
  
  private getZoneStatusText(status: string): string {
    const texts: Record<string, string> = {
      idle: '空闲',
      busy: '忙碌',
      active: '活跃',
      error: '错误',
    };
    return texts[status] || '未知';
  }
  
  protected updateThemeStyles(): void {
    (this.container as Phaser.GameObjects.Container)?.removeAll(true);
    this.createBackground();
    this.createContentContainer();
    this.createActionButtonContainer();
    this.renderContent();
  }
  
  private createText(
    x: number,
    y: number,
    text: string,
    style: Phaser.Types.GameObjects.Text.TextStyle
  ): Phaser.GameObjects.Text {
    return this.scene.add.text(x, y, text, {
      fontFamily: this.theme.typography.fontFamily.sans,
      color: this.textPrimaryColor.get(),
      ...style,
    });
  }
  
  private hexToNumber(hex: string): number {
    if (!hex || typeof hex !== 'string') return 0xffffff;
    return parseInt(hex.slice(1), 16);
  }
  
  destroy(): void {
    this.tabContainer?.destroy();
    this.contentContainer?.destroy();
    this.actionButtonContainer?.destroy();
    super.destroy();
  }
}
