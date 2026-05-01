/**
 * CommandPanel V2 - 重构版本
 *
 * 引入状态机的响应式命令面板
 * - 自动推导状态 (empty / single_agent / multi_agent / zone)
 * - 增量渲染，无完全销毁重建
 * - 过渡动画支持
 * - Loading 状态支持
 * V2升级: glassmorphism背景、按钮hover 3D tilt效果、选中发光
 */

import Phaser from 'phaser';

import { EnhancedUIComponent } from '@/stratix-core/ui/components/base/EnhancedUIComponent';

import { ReactiveToken } from '@/stratix-core/ui/foundation/theme/ReactiveToken';

import { isReducedMotion } from '../../themes/ThemeColors';

import { HUD_LAYOUT } from './layout/HUDLayout';
import { CommandButtonFactory } from './command-panel/CommandButtonFactory';
import { AgentDetailRenderer } from './command-panel/AgentDetailRenderer';
import { EmptyStateRenderer } from './command-panel/EmptyStateRenderer';
import { GradientHelper, hexToNumber } from './command-panel/GradientHelper';
import { MultiAgentRenderer } from './command-panel/MultiAgentRenderer';
import { ToastManager } from './ToastManager';
import { ZoneDetailRenderer } from './command-panel/ZoneDetailRenderer';

import type {
  AgentInfo,
  CommandPanelCallbacks,
  PanelData,
  PanelState,
  Skill,
  UnitInfo,
  ZoneInfo,
} from './command-panel/types';

export type { AgentInfo, CommandPanelCallbacks, PanelData, PanelState, Skill, UnitInfo, ZoneInfo };

export class CommandPanelV2 extends EnhancedUIComponent {
  private onSkillSelect: (skill: Skill) => void;
  private onCommandExecute: (command: string) => void;
  private callbacks: CommandPanelCallbacks;

  private panelState: PanelState = 'empty';
  private data: PanelData = {
    agents: [],
    zone: null,
    skills: [],
    isLoading: false,
  };

  private tabContainer: Phaser.GameObjects.Container | null = null;
  private contentContainer: Phaser.GameObjects.Container | null = null;
  private actionButtonContainer: Phaser.GameObjects.Container | null = null;
  private currentTab: 'detail' | 'skills' = 'detail';

  private tabIndicator: Phaser.GameObjects.Graphics | null = null;
  private tabPositions: number[] = [];
  private contentTweens: Phaser.Tweens.Tween[] = [];
  private gradientHelper: GradientHelper;
  private toastManager?: ToastManager;

  private renderers: Record<PanelState, import('./command-panel/IStateRenderer').IStateRenderer>;
  private buttonFactory: CommandButtonFactory;

  private backgroundColor: ReactiveToken<string>;
  private backgroundSecondaryColor: ReactiveToken<string>;
  private backgroundTertiaryColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private textSecondaryColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  private accentColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  private warningColor: ReactiveToken<string>;
  private dangerColor: ReactiveToken<string>;
  private primaryColor: ReactiveToken<string>;

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
    },
    toastManager?: ToastManager
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
    this.successColor = this.useToken('colors.semantic.success');
    this.warningColor = this.useToken('colors.semantic.warning');
    this.dangerColor = this.useToken('colors.semantic.danger');
    this.primaryColor = this.useToken('colors.accent');

    this.toastManager = toastManager;
    this.buttonFactory = new CommandButtonFactory(scene, this.theme.typography.fontFamily.sans);
    this.gradientHelper = new GradientHelper(scene, this.id);

    const renderContext = this.buildRenderContext();
    this.renderers = {
      empty: new EmptyStateRenderer(renderContext),
      single_agent: new AgentDetailRenderer(renderContext),
      multi_agent: new MultiAgentRenderer(renderContext, callbacks),
      zone: new ZoneDetailRenderer(renderContext),
    };
  }

  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);

    this.gradientHelper.init(
      this.accentColor.get(),
      this.successColor.get(),
      this.backgroundColor.get()
    );

    this.createBackground();
    this.createTabBar();
    this.createContentContainer();
    this.createActionButtonContainer();

    this.render();
    this.onCreate();

    if (!isReducedMotion()) {
      const targetY = this.config.y ?? 0;
      this.container.setY(targetY + HUD_LAYOUT.commandPanel.slideInOffset);
      this.container.setAlpha(0);
      this.scene.tweens.add({
        targets: this.container,
        y: targetY,
        alpha: 1,
        duration: 300,
        ease: 'Back.easeOut',
      });
    }
  }

  private createBackground(): void {
    const bg = this.scene.add.graphics();
    const bgColor = hexToNumber(this.backgroundColor.get());
    const borderClr = hexToNumber(this.borderColor.get());
    const primaryColor = hexToNumber(this.primaryColor.get());
    const w = this.config.width || 500;
    const h = this.config.height || HUD_LAYOUT.commandPanel.height;

    // Three-layer background: Tab area (darker), Content area (medium), Action area (lighter)
    const tabHeight = 48;
    const contentHeight = h - tabHeight - HUD_LAYOUT.commandPanel.actionButtonHeight - 8;
    const actionHeight = HUD_LAYOUT.commandPanel.actionButtonHeight;

    // Tab area background (darkest)
    bg.fillStyle(bgColor, 0.5);
    bg.fillRoundedRect(0, 0, w, tabHeight, { tl: 8, tr: 8, bl: 0, br: 0 });

    // Content area background (medium)
    bg.fillStyle(bgColor, 0.7);
    bg.fillRect(0, tabHeight, w, contentHeight);

    // Action button area background (lightest)
    bg.fillStyle(bgColor, 0.8);
    bg.fillRoundedRect(0, tabHeight + contentHeight, w, actionHeight, { tl: 0, tr: 0, bl: 8, br: 8 });

    // Top highlight line
    bg.lineStyle(1, primaryColor, 0.3);
    bg.lineBetween(8, 0, w - 8, 0);

    // Divider line: Tab area vs Content area
    bg.lineStyle(1, borderClr, 0.15);
    bg.lineBetween(12, tabHeight, w - 12, tabHeight);

    // Divider line: Content area vs Action button area
    bg.lineBetween(12, tabHeight + contentHeight, w - 12, tabHeight + contentHeight);

    // Outer border
    bg.lineStyle(1, borderClr, 0.25);
    bg.strokeRoundedRect(0, 0, w, h, 8);

    (this.container as Phaser.GameObjects.Container).add(bg);
  }

  private createTabBar(): void {
    this.tabContainer = this.scene.add.container(0, 0);
    (this.container as Phaser.GameObjects.Container).add(this.tabContainer);
  }

  private createContentContainer(): void {
    this.contentContainer = this.scene.add.container(HUD_LAYOUT.commandPanel.contentPadding, 48);
    (this.container as Phaser.GameObjects.Container).add(this.contentContainer);
  }

  private createActionButtonContainer(): void {
    this.actionButtonContainer = this.scene.add.container(HUD_LAYOUT.commandPanel.contentPadding, (this.config.height || HUD_LAYOUT.commandPanel.height) - (HUD_LAYOUT.commandPanel.actionButtonHeight + HUD_LAYOUT.commandPanel.contentPadding));
    (this.container as Phaser.GameObjects.Container).add(this.actionButtonContainer);
  }

  public updatePanelData(data: Partial<PanelData>): void {
    const prevState = this.panelState;

    if (data.agents !== undefined) this.data.agents = data.agents;
    if (data.zone !== undefined) this.data.zone = data.zone;
    if (data.skills !== undefined) this.data.skills = data.skills;
    if (data.isLoading !== undefined) this.data.isLoading = data.isLoading;

    this.panelState = this.deriveState();

    if (prevState !== this.panelState) {
      this.renderWithTransition();
    } else {
      this.render();
    }
  }

  public updateAgentInfo(agent: AgentInfo | null): void {
    this.updatePanelData({
      agents: agent ? [agent] : [],
      zone: null,
    });
  }

  public updateSelectedAgents(agents: AgentInfo[]): void {
    this.updatePanelData({
      agents,
      zone: null,
    });
  }

  public updateZoneInfo(zone: ZoneInfo | null): void {
    this.updatePanelData({
      agents: [],
      zone,
    });
  }

  public setSkills(skills: Skill[]): void { this.updatePanelData({ skills }); }
  public setLoading(loading: boolean): void { this.updatePanelData({ isLoading: loading }); }
  public showNotification(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    this.toastManager?.show(message, type);
  }

  private deriveState(): PanelState {
    if (this.data.agents.length === 0 && !this.data.zone) return 'empty';
    if (this.data.zone && this.data.agents.length === 0) return 'zone';
    if (this.data.agents.length === 1) return 'single_agent';
    return 'multi_agent';
  }

  private render(): void {
    this.renderTabs();
    this.renderContent();
    this.renderActionButtons();
  }

  private renderWithTransition(): void {
    if (this.contentContainer) {
      if (!isReducedMotion()) {
        const oldY = this.contentContainer.y;
        // Fade out old content while sliding down 8px
        this.scene.tweens.add({
          targets: this.contentContainer,
          alpha: 0,
          y: oldY + 8,
          duration: 150,
          ease: 'Sine.easeIn',
          onComplete: () => {
            this.contentContainer!.y = oldY;
            this.render();
            // New content starts 8px below, slide in while fading in
            this.contentContainer!.setAlpha(0);
            this.contentContainer!.setY(oldY + 8);
            this.scene.tweens.add({
              targets: this.contentContainer,
              alpha: 1,
              y: oldY,
              duration: 150,
              ease: 'Sine.easeOut',
            });
          },
        });
      } else {
        this.render();
      }
    } else {
      this.render();
    }
  }

  private renderTabs(): void {
    if (!this.tabContainer) return;
    this.tabContainer.removeAll(true);

    const tabWidth = HUD_LAYOUT.commandPanel.tabWidth;
    const tabHeight = HUD_LAYOUT.commandPanel.tabHeight;
    const tabSpacing = HUD_LAYOUT.commandPanel.tabSpacing;

    const tabs: { key: 'detail' | 'skills'; label: string }[] = [
      { key: 'detail', label: '详情' },
      { key: 'skills', label: '技能' },
    ];

    this.tabPositions = [];

    tabs.forEach((tab, index) => {
      const x = HUD_LAYOUT.commandPanel.tabPaddingX + index * (tabWidth + tabSpacing);
      this.tabPositions.push(x);
      const isActive = this.currentTab === tab.key;

      const tabBg = this.scene.add.graphics();
      if (isActive) {
        tabBg.fillStyle(hexToNumber(this.backgroundTertiaryColor.get()), 1);
      } else {
        tabBg.fillStyle(hexToNumber(this.backgroundSecondaryColor.get()), 0.5);
      }
      tabBg.fillRoundedRect(x, 8, tabWidth, tabHeight, { tl: 4, tr: 4, bl: 0, br: 0 });

      if (isActive) {
        const primaryColor = hexToNumber(this.primaryColor.get());
        tabBg.lineStyle(1, primaryColor, 0.5);
        tabBg.lineBetween(x, 8, x + tabWidth, 8);
      }

      const tabHitArea = this.scene.add.rectangle(x, 8, tabWidth, tabHeight, 0x000000, 0);
      tabHitArea.setOrigin(0, 0);
      tabHitArea.setInteractive({ useHandCursor: true });

      const tabText = this.scene.add.text(x + tabWidth / 2, 8 + tabHeight / 2, tab.label, {
        fontFamily: this.theme.typography.fontFamily.sans,
        fontSize: '13px',
        fontStyle: isActive ? 'bold' : 'normal',
        color: isActive ? this.textPrimaryColor.get() : this.textMutedColor.get(),
      });
      tabText.setOrigin(0.5);

      tabHitArea.on('pointerdown', () => this.switchTab(tab.key));
      tabHitArea.on('pointerover', () => {
        if (!isActive) {
          tabBg.clear();
          tabBg.fillStyle(hexToNumber(this.backgroundTertiaryColor.get()), 0.7);
          tabBg.fillRoundedRect(x, 8, tabWidth, tabHeight, { tl: 4, tr: 4, bl: 0, br: 0 });
          const glowColor = hexToNumber(this.primaryColor.get());
          tabBg.lineStyle(1, glowColor, 0.3);
          tabBg.lineBetween(x, 8, x + tabWidth, 8);
        }
      });
      tabHitArea.on('pointerout', () => {
        if (!isActive) {
          tabBg.clear();
          tabBg.fillStyle(hexToNumber(this.backgroundSecondaryColor.get()), 0.5);
          tabBg.fillRoundedRect(x, 8, tabWidth, tabHeight, { tl: 4, tr: 4, bl: 0, br: 0 });
        }
      });

      this.tabContainer?.add([tabBg, tabHitArea, tabText]);
    });

    const activeIndex = this.currentTab === 'detail' ? 0 : 1;
    const indicatorX = this.tabPositions[activeIndex] ?? HUD_LAYOUT.commandPanel.tabPaddingX;
    const indicatorY = 8 + tabHeight - 2;
    if (!this.tabIndicator) {
      this.tabIndicator = this.scene.add.graphics();
      (this.container as Phaser.GameObjects.Container).add(this.tabIndicator);
    }
    this.tabIndicator.clear();
    const indicatorColor = hexToNumber(this.accentColor.get());
    this.tabIndicator.fillStyle(indicatorColor, 1);
    this.tabIndicator.fillRoundedRect(0, indicatorY, tabWidth, 3, 1.5);
    this.tabIndicator.setPosition(indicatorX, 0);
  }

  private renderContent(): void {
    if (!this.contentContainer) return;
    this.contentTweens.forEach(t => {
      if (t.isPlaying()) t.stop();
    });
    this.contentTweens = [];
    this.contentContainer.removeAll(true);
    this.contentContainer.alpha = 1;

    const contentWidth = (this.config.width || 500) - HUD_LAYOUT.commandPanel.contentPadding * 2;
    const renderer = this.renderers[this.panelState];
    if (renderer) {
      const newTweens = renderer.render(this.contentContainer, this.data, contentWidth);
      this.contentTweens.push(...newTweens);
    }
  }

  private renderActionButtons(): void {
    if (!this.actionButtonContainer) return;
    this.actionButtonContainer.removeAll(true);

    const isMultiSelect = this.panelState === 'multi_agent';
    const buttonWidth = HUD_LAYOUT.commandPanel.actionButtonWidth;
    const buttonHeight = HUD_LAYOUT.commandPanel.actionButtonHeight;
    const buttonSpacing = HUD_LAYOUT.commandPanel.actionButtonSpacing;

    let buttons: { key: string; label: string; icon: string; enabled: boolean }[];

    if (isMultiSelect) {
      buttons = [
        { key: 'chat', label: '群聊', icon: '💬', enabled: !this.data.isLoading },
        { key: 'task', label: '任务', icon: '📋', enabled: !this.data.isLoading },
        { key: 'stop', label: '停止', icon: '⏹️', enabled: !this.data.isLoading },
      ];
    } else {
      buttons = [
        { key: 'chat', label: '聊天', icon: '💬', enabled: !this.data.isLoading && this.panelState !== 'zone' },
        { key: 'config', label: '配置', icon: '⚙️', enabled: !this.data.isLoading && this.panelState === 'single_agent' },
        { key: 'task', label: '任务', icon: '📋', enabled: !this.data.isLoading },
        { key: 'stop', label: '停止', icon: '⏹️', enabled: !this.data.isLoading },
      ];
    }

    const totalWidth = buttons.length * buttonWidth + (buttons.length - 1) * buttonSpacing;
    const startX = ((this.config.width || 500) - HUD_LAYOUT.commandPanel.contentPadding * 2 - totalWidth) / 2;

    const btnColors = {
      baseFill: hexToNumber(this.backgroundTertiaryColor.get()),
      border: hexToNumber(this.borderColor.get()),
      label: hexToNumber(this.textPrimaryColor.get()),
      glow: hexToNumber(this.primaryColor.get()),
    };

    buttons.forEach((btn, index) => {
      const x = startX + index * (buttonWidth + buttonSpacing);
      const button = this.buttonFactory.createActionButton(
        x, 0, buttonWidth, buttonHeight, btn, btnColors, this.callbacks,
        () => this.data.agents.map(a => a.agentId),
        () => (this.data.agents.length === 1 ? this.data.agents[0].agentId : null)
      );
      this.actionButtonContainer?.add(button);
    });
  }

  private switchTab(tab: 'detail' | 'skills'): void {
    if (this.currentTab === tab) return;

    const oldX = this.tabIndicator?.x ?? 0;
    this.currentTab = tab;
    this.renderTabs();

    const activeIndex = this.currentTab === 'detail' ? 0 : 1;
    const newX = this.tabPositions[activeIndex] ?? oldX;

    if (this.tabIndicator) {
      this.tabIndicator.x = oldX;
      this.scene.tweens.add({
        targets: this.tabIndicator,
        x: newX,
        duration: 200,
        ease: 'Cubic.easeOut',
      });
    }

    this.renderContent();
  }

  protected updateThemeStyles(): void {
    this.gradientHelper.cleanup();
    this.tabIndicator = null;
    this.tabPositions = [];

    (this.container as Phaser.GameObjects.Container)?.removeAll(true);
    this.createBackground();
    this.createTabBar();
    this.createContentContainer();
    this.createActionButtonContainer();

    this.gradientHelper.init(
      this.accentColor.get(),
      this.successColor.get(),
      this.backgroundColor.get()
    );
    this.render();
  }

  private buildRenderContext(): import('./command-panel/types').RenderContext {
    const t = (token: ReactiveToken<string>) => () => token.get();
    return {
      scene: this.scene,
      fontFamily: this.theme.typography.fontFamily.sans,
      getBackgroundColor: t(this.backgroundColor),
      getBackgroundSecondaryColor: t(this.backgroundSecondaryColor),
      getBackgroundTertiaryColor: t(this.backgroundTertiaryColor),
      getTextPrimaryColor: t(this.textPrimaryColor),
      getTextSecondaryColor: t(this.textSecondaryColor),
      getTextMutedColor: t(this.textMutedColor),
      getBorderColor: t(this.borderColor),
      getAccentColor: t(this.accentColor),
      getPrimaryColor: t(this.primaryColor),
      getSuccessColor: t(this.successColor),
      getWarningColor: t(this.warningColor),
      getDangerColor: t(this.dangerColor),
      getProgressGradKey: () => this.gradientHelper.progressGradKey,
      getEmptyGradKey: () => this.gradientHelper.emptyGradKey,
      getContentHeight: () => (this.config.height || HUD_LAYOUT.commandPanel.height) - 60,
      hexToNumber,
    };
  }

  destroy(): void {
    this.contentTweens.forEach(t => {
      if (t.isPlaying()) t.stop();
    });
    this.contentTweens = [];

    Object.values(this.renderers).forEach(r => r.destroy());
    this.gradientHelper.cleanup();
    this.tabIndicator = null;
    this.tabContainer?.destroy();
    this.contentContainer?.destroy();
    this.actionButtonContainer?.destroy();
    super.destroy();
  }
}
