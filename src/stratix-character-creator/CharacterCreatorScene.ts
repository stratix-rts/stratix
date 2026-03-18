/**
 * CharacterCreatorScene - Phaser 场景
 * 角色生成器模块入口场景，整合所有 UI 组件
 * 
 * Layout Design (Cyberpunk Editor Style):
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  HEADER: 角色创建器                           [体型选择] [操作按钮] │
 * ├──────────────┬─────────────────────────────────┬─────────────────┤
 * │              │                                 │                 │
 * │   PREVIEW    │                                 │   SAVED         │
 * │   PANEL      │      PART SELECTOR              │   CHARACTERS    │
 * │   (280px)    │      (Main Work Area)           │    (280px)      │
 * │              │                                 │                 │
 * │  - 动画控制   │                                 │                 │
 * │  - 缩放控制   │                                 │                 │
 * │  - 属性显示   │                                 │                 │
 * │              │                                 │                 │
 * └──────────────┴─────────────────────────────────┴─────────────────┘
 */

import Phaser from 'phaser';
import { characterComposer } from './core/CharacterComposer';
import { characterStorage } from './core/CharacterStorage';
import { partRegistry } from './core/PartRegistry';
import { characterCreatorEvents } from './core/EventEmitter';
import { SkillTree } from './core/SkillTree';
import { EVENTS, DEFAULT_BODY_TYPE, FRAME_SIZE, SHEET_WIDTH, SHEET_HEIGHT, BODY_TYPES } from './constants';
import { SKILL_TREE_CONFIG } from './config/skillTreeConfig';
import { PartSelector, CharacterPreview, CharacterList, OpenClawConnectionPanel, AgentChatPanel, BackendSelector } from './ui';
import type { SavedCharacter, PartSelection, PartMetadata, BodyType, AnimationName, CreatorStep } from './types';
import { unifiedOpenClawConnectionManager } from '@/stratix-core/UnifiedOpenClawConnectionManager';
import { textureManager } from '@/stratix-core/services';
import { getToken, getCurrentTheme } from '@/design-system/config';

// 辅助函数：将十六进制颜色字符串转换为 Phaser 数字格式
function hexToNumber(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

// 辅助函数：将颜色值转换为 CSS 字符串格式
function toCssColor(color: string | number): string {
  if (typeof color === 'string') return color;
  return '#' + color.toString(16).padStart(6, '0');
}

// 动态获取主题的 THEME 函数
function THEME() {
  const theme = getCurrentTheme();
  const colors = theme.colors;
  
  return {
    // 数字格式（用于 Phaser）
    bg: hexToNumber(colors.background.base),
    panelBg: hexToNumber(colors.background.elevated),
    panelBorder: hexToNumber(colors.border.default),
    panelBorderCss: colors.border.default,
    accent: hexToNumber(colors.brand.primary),
    accentCss: colors.brand.primary,
    accentSecondary: hexToNumber(colors.brand.secondary),
    success: hexToNumber(colors.status.success),
    text: colors.text.primary,
    textMuted: colors.text.muted,
    textSecondary: colors.text.secondary,
    headerHeight: 56,
    leftPanelWidth: 280,
    rightPanelWidth: 280
  };
}

export interface CharacterCreatorSceneData {
  targetCharacterId?: string;
  onCharacterCreated?: (character: SavedCharacter) => void;
  onCharacterUpdated?: (character: SavedCharacter) => void;
  onCharacterDeleted?: (characterId: string) => void;
}

export class CharacterCreatorScene extends Phaser.Scene {
  private currentCharacter: SavedCharacter | null = null;
  private currentStep: CreatorStep = 'appearance';
  private partSelector: PartSelector | null = null;
  private openClawConnectionPanel: OpenClawConnectionPanel | null = null;
  private agentChatPanel: AgentChatPanel | null = null;
  private backendSelector: BackendSelector | null = null;
  private selectedBackendType: 'openclaw' | 'direct' | 'stratix' = 'direct';
  private selectedBackendConfig: any = null;
  private characterPreview: CharacterPreview | null = null;
  private characterList: CharacterList | null = null;
  private skillTree: SkillTree | null = null;
  private mainPanelContainer: Phaser.GameObjects.Container | null = null;
  private stepIndicators: Phaser.GameObjects.Text[] = [];

  private previewTextureKey: string = '';
  private isDirty = false;

  private uiElements: {
    header?: Phaser.GameObjects.Container;
    leftPanel?: Phaser.GameObjects.Container;
    rightPanel?: Phaser.GameObjects.Container;
    bodyTypeButtons?: Phaser.GameObjects.Text[];
    previewSprite?: Phaser.GameObjects.Sprite;
    animLabel?: Phaser.GameObjects.Text;
    scaleLabel?: Phaser.GameObjects.Text;
    attrLabel?: Phaser.GameObjects.Text;
    nameInput?: Phaser.GameObjects.DOMElement;
    creditsContainer?: Phaser.GameObjects.Container;
    creditsAvailableHeight?: number;
  } = {};

  private callbacks: {
    onCharacterCreated?: (character: SavedCharacter) => void;
    onCharacterUpdated?: (character: SavedCharacter) => void;
    onCharacterDeleted?: (characterId: string) => void;
  } = {};

  private eventUnsubscribers: Array<() => void> = [];

  constructor() {
    super({ key: 'CharacterCreatorScene' });
  }

  init(data?: CharacterCreatorSceneData): void {
    this.callbacks = {
      onCharacterCreated: data?.onCharacterCreated,
      onCharacterUpdated: data?.onCharacterUpdated,
      onCharacterDeleted: data?.onCharacterDeleted
    };
    this.previewTextureKey = `char_preview_${Date.now()}`;
    this.isDirty = false;
  }

  async preload(): Promise<void> {
    this.createLoadingUI();
    await partRegistry.loadMetadata();
    await characterStorage.init();
  }

  async create(data?: CharacterCreatorSceneData): Promise<void> {
    const { width, height } = this.cameras.main;

    this.createBackground(width, height);

    if (data?.targetCharacterId) {
      this.currentCharacter = await characterStorage.load(data.targetCharacterId);
    }

    if (!this.currentCharacter) {
      this.currentCharacter = characterStorage.createNew(DEFAULT_BODY_TYPE);
      await this.initializeDefaultParts();
    }

    this.skillTree = new SkillTree(SKILL_TREE_CONFIG);
    if (this.currentCharacter.skillTree) {
      this.skillTree.setState(this.currentCharacter.skillTree);
    }

    this.createHeader(width);
    this.createLeftPanel(width, height);
    this.createMainPanel(width, height);
    this.createRightPanel(width, height);

    this.setupEventBus();

    if (!data?.targetCharacterId) {
      await this.randomizeCharacter('minimal');
    } else {
      await this.updatePreview();
    }
  }

  private createLoadingUI(): void {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const progressBar = this.add.rectangle(width / 2, height / 2, 0, 4, THEME().accent);
    const loadingText = this.add.text(width / 2, height / 2 - 30, 'INITIALIZING', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: THEME().accent
    }).setOrigin(0.5);

    let progress = 0;
    const progressTimer = this.time.addEvent({
      delay: 80,
      callback: () => {
        progress += 0.12;
        progressBar.width = 300 * Math.min(progress, 1);
        if (progress >= 1) {
          progressTimer.destroy();
        }
      },
      repeat: 9
    });

    this.load.once('complete', () => {
      progressTimer.destroy();
      progressBar.destroy();
      loadingText.destroy();
    });
  }

  private createBackground(width: number, height: number): void {
    this.add.rectangle(width / 2, height / 2, width, height, THEME().bg);

    const grid = this.add.graphics();
    grid.lineStyle(1, THEME().panelBorder, 0.5);
    for (let x = 0; x <= width; x += 40) {
      grid.moveTo(x, 0);
      grid.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += 40) {
      grid.moveTo(0, y);
      grid.lineTo(width, y);
    }
    grid.strokePath();
  }

  private createHeader(width: number): void {
    const header = this.add.container(0, 0);

    const headerBg = this.add.graphics();
    headerBg.fillStyle(THEME().panelBg, 1);
    headerBg.fillRect(0, 0, width, THEME().headerHeight);
    headerBg.lineStyle(1, THEME().panelBorder, 1);
    headerBg.lineBetween(0, THEME().headerHeight, width, THEME().headerHeight);
    header.add(headerBg);

    const title = this.add.text(24, THEME().headerHeight / 2, '角色创建器 CHARACTER CREATOR', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: THEME().accent,
      fontStyle: 'bold'
    }).setOrigin(0, 0.5);
    header.add(title);

    const glow = this.add.text(24, THEME().headerHeight / 2, '角色创建器 CHARACTER CREATOR', {
      fontSize: '14px',
      fontFamily: 'monospace',
      color: THEME().accent,
      fontStyle: 'bold'
    }).setOrigin(0, 0.5).setAlpha(0.3);
    header.add(glow);

    this.createStepIndicator(header, width);
    this.createActionButtons(header, width);

    this.uiElements.header = header;
  }

  private createStepIndicator(header: Phaser.GameObjects.Container, width: number): void {
    const steps: { key: CreatorStep; label: string; labelCn: string }[] = [
      { key: 'appearance', label: 'APPEARANCE', labelCn: '外观' },
      { key: 'openclaw', label: 'SERVICE', labelCn: '服务' },
      { key: 'agent', label: 'AGENT', labelCn: 'AI' }
    ];

    const startX = width * 0.3;
    const y = THEME().headerHeight / 2;

    steps.forEach((step, index) => {
      const isActive = this.currentStep === step.key;
      const btnX = startX + index * 100;

      const btn = this.add.text(btnX, y, `${index + 1}. ${step.labelCn}`, {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: isActive ? THEME().accent : THEME().textMuted,
        backgroundColor: isActive ? 'rgba(0,0,0,0.1)' : 'transparent',
        padding: { x: 10, y: 5 }
      }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => {
        if (this.currentStep !== step.key) {
          btn.setColor(THEME().text);
        }
      });

      btn.on('pointerout', () => {
        if (this.currentStep !== step.key) {
          btn.setColor(THEME().textMuted);
        }
      });

      btn.on('pointerdown', () => {
        if (this.currentStep !== step.key) {
          if (step.key === 'appearance' || 
              (step.key === 'openclaw') ||
              (step.key === 'agent' && unifiedOpenClawConnectionManager.isConnected())) {
            this.setStep(step.key);
          } else {
            this.showMessage('请先完成上一步 Complete previous step first', 'error');
          }
        }
      });

      header.add(btn);
      this.stepIndicators.push(btn);
    });
  }

  private setStep(step: CreatorStep): void {
    this.currentStep = step;
    this.updateStepIndicators();
    this.rebuildMainPanel();
    
    if (step === 'appearance') {
      this.uiElements.leftPanel?.setVisible(true);
      this.uiElements.rightPanel?.setVisible(true);
    } else {
      this.uiElements.leftPanel?.setVisible(false);
      this.uiElements.rightPanel?.setVisible(false);
    }
  }

  private updateStepIndicators(): void {
    const steps: CreatorStep[] = ['appearance', 'openclaw', 'agent'];
    this.stepIndicators.forEach((btn, index) => {
      const isActive = this.currentStep === steps[index];
      btn.setColor(isActive ? THEME().accent : THEME().textMuted);
      btn.setBackgroundColor(isActive ? 'rgba(0,0,0,0.1)' : 'transparent');
    });
  }

  private createActionButtons(header: Phaser.GameObjects.Container, width: number): void {
    const buttons = [
      { label: '随机 RANDOM', action: () => this.randomizeCharacter('normal'), color: THEME().accentSecondary },
      { label: '保存 SAVE', action: () => this.saveCharacter(), color: THEME().accent },
    ];

    let btnX = width - 24;
    const y = THEME().headerHeight / 2;

    buttons.reverse().forEach(({ label, action, color }) => {
      const btn = this.add.text(btnX, y, label, {
        fontSize: '12px',
        fontFamily: 'monospace',
        color: THEME().textMuted,
        padding: { x: 12, y: 6 }
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor(color));
      btn.on('pointerout', () => btn.setColor(THEME().textMuted));
      btn.on('pointerdown', action);

      header.add(btn);
      btnX -= btn.width + 16;
    });
  }

  private createLeftPanel(width: number, height: number): void {
    const panelX = 0;
    const panelY = THEME().headerHeight;
    const panelW = THEME().leftPanelWidth;
    const panelH = height - THEME().headerHeight;

    const panel = this.add.container(panelX, panelY);

    const bg = this.add.graphics();
    bg.fillStyle(THEME().panelBg, 1);
    bg.fillRect(0, 0, panelW, panelH);
    bg.lineStyle(1, THEME().panelBorder, 1);
    bg.lineBetween(panelW, 0, panelW, panelH);
    panel.add(bg);

    this.createPreviewSection(panel, panelW);
    this.createNameInput(panel, panelW);
    this.createControlsSection(panel, panelW, panelH);
    this.createCreditsSection(panel, panelW, panelH);
    this.createJsonEditorSection(panel, panelW, panelH);

    this.uiElements.leftPanel = panel;
  }

  private createCheckerboardTexture(width: number, height: number): string {
    const key = `checkerboard_bg_${width}_${height}`;
    if (this.textures.exists(key)) return key;

    const size = 8;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;

    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        const isLight = ((x / size) + (y / size)) % 2 === 0;
        ctx.fillStyle = isLight ? THEME().text : THEME().textSecondary;
        ctx.fillRect(x, y, size, size);
      }
    }

    this.textures.addCanvas(key, canvas);
    return key;
  }

  private createPreviewSection(panel: Phaser.GameObjects.Container, panelW: number): void {
    const previewY = 20;
    const previewSize = panelW - 40;
    const x = 20;

    const checkerboard = this.createCheckerboardTexture(previewSize, previewSize);
    const previewBg = this.add.image(x, previewY, checkerboard).setOrigin(0, 0);
    panel.add(previewBg);

    const border = this.add.graphics();
    border.lineStyle(1, THEME().panelBorder, 1);
    border.strokeRoundedRect(x, previewY, previewSize, previewSize, 8);
    panel.add(border);

    const cornerSize = 12;
    const corners = this.add.graphics();
    corners.lineStyle(2, THEME().accent, 1);
    [20, 20 + previewSize - cornerSize].forEach(x => {
      [previewY, previewY + previewSize - cornerSize].forEach(y => {
        corners.strokeRect(x, y, cornerSize, cornerSize);
      });
    });
    panel.add(corners);

    this.characterPreview = new CharacterPreview(this, {
      x: 20 + previewSize / 2,
      y: previewY + previewSize / 2,
      size: previewSize - 20,
      scale: 2
    });
    panel.add(this.characterPreview.getContainer());
  }

  private createNameInput(panel: Phaser.GameObjects.Container, panelW: number): void {
    const y = 20 + (panelW - 40) + 16;

    const html = `
      <input type="text" value="${this.currentCharacter?.name ?? '新角色 New Character'}" 
        style="
          width: ${panelW - 48}px;
          padding: 10px 14px;
          background: var(--ds-bg-primary);
          border: 1px solid var(--ds-border);
          border-radius: 6px;
          color: var(--ds-text-primary);
          font-size: 14px;
          font-family: monospace;
          outline: none;
          transition: border-color 0.2s;
        " 
        placeholder="输入角色名称 Enter name..."
        onfocus="this.style.borderColor='${THEME().accentCss}'"
        onblur="this.style.borderColor='${THEME().panelBorderCss}'"
      />
    `;

    this.uiElements.nameInput = this.add.dom(24, y).createFromHTML(html).setOrigin(0, 0);
    panel.add(this.uiElements.nameInput);

    const input = this.uiElements.nameInput.node?.querySelector('input') as HTMLInputElement;
    input?.addEventListener('input', (e) => {
      if (this.currentCharacter) {
        this.currentCharacter.name = (e.target as HTMLInputElement).value;
        this.isDirty = true;
      }
    });
  }

  private createControlsSection(panel: Phaser.GameObjects.Container, panelW: number, panelH: number): void {
    const y = 20 + (panelW - 40) + 70;

    const animLabel = this.add.text(24, y, '动画 ANIMATION', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: THEME().textMuted
    });
    panel.add(animLabel);

    const anims = ['idle', 'walk', 'run', 'slash'];
    const animLabels: Record<string, string> = { idle: '待机', walk: '行走', run: '奔跑', slash: '攻击' };

    anims.forEach((anim, i) => {
      const isActive = anim === 'idle';
      const btn = this.add.text(24 + i * 58, y + 20, animLabels[anim], {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: isActive ? THEME().accent : THEME().textMuted,
        backgroundColor: isActive ? 'rgba(0,0,0,0.1)' : 'transparent',
        padding: { x: 10, y: 5 }
      }).setOrigin(0, 0).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        panel.each((child: any) => {
          if (child.getData?.('animBtn')) {
            child.setColor(THEME().textMuted);
            child.setBackgroundColor('transparent');
          }
        });
        btn.setColor(THEME().accent);
        btn.setBackgroundColor('rgba(0,0,0,0.1)');
        this.setAnimation(anim as AnimationName);
      });
      btn.setData('animBtn', true);
      panel.add(btn);
    });

    const dirLabel = this.add.text(24, y + 55, '方向 DIRECTION', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: THEME().textMuted
    });
    panel.add(dirLabel);

    const dirs = ['↓', '←', '↑', '→'];
    const dirValues = [2, 1, 0, 3];  // 与 LPC 行号一致: 下=2, 左=1, 上=0, 右=3
    dirs.forEach((dir, i) => {
      const isActive = i === 0;
      const btn = this.add.text(24 + i * 50, y + 75, dir, {
        fontSize: '14px',
        fontFamily: 'monospace',
        color: isActive ? THEME().accent : THEME().textMuted,
        backgroundColor: isActive ? 'rgba(0,0,0,0.1)' : 'transparent',
        padding: { x: 10, y: 5 }
      }).setOrigin(0, 0).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        panel.each((child: any) => {
          if (child.getData?.('dirBtn')) {
            child.setColor(THEME().textMuted);
            child.setBackgroundColor('transparent');
          }
        });
        btn.setColor(THEME().accent);
        btn.setBackgroundColor('rgba(0,0,0,0.1)');
        this.setDirection(dirValues[i]);
      });
      btn.setData('dirBtn', true);
      panel.add(btn);
    });

    const scaleLabel = this.add.text(24, y + 110, '缩放 SCALE', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: THEME().textMuted
    });
    panel.add(scaleLabel);

    const scales = ['1x', '2x', '3x', '4x'];
    scales.forEach((scale, i) => {
      const isActive = scale === '2x';
      const btn = this.add.text(24 + i * 50, y + 130, scale, {
        fontSize: '11px',
        fontFamily: 'monospace',
        color: isActive ? THEME().accent : THEME().textMuted,
        backgroundColor: isActive ? 'rgba(0,0,0,0.1)' : 'transparent',
        padding: { x: 10, y: 5 }
      }).setOrigin(0, 0).setInteractive({ useHandCursor: true });

      btn.on('pointerdown', () => {
        panel.each((child: any) => {
          if (child.getData?.('scaleBtn')) {
            child.setColor(THEME().textMuted);
            child.setBackgroundColor('transparent');
          }
        });
        btn.setColor(THEME().accent);
        btn.setBackgroundColor('rgba(0,0,0,0.1)');
        const scaleVal = parseFloat(scale);
        this.setScale(scaleVal);
      });
      btn.setData('scaleBtn', true);
      panel.add(btn);
    });
  }

  private createCreditsSection(panel: Phaser.GameObjects.Container, panelW: number, panelH: number): void {
    const controlsY = 20 + (panelW - 40) + 70;
    const startY = controlsY + 160;
    const jsonEditorY = panelH - 100;
    const availableHeight = jsonEditorY - startY - 50;

    if (availableHeight < 40) {
      return;
    }

    const divider = this.add.graphics();
    divider.lineStyle(1, THEME().panelBorder, 0.5);
    divider.lineBetween(24, startY, panelW - 24, startY);
    panel.add(divider);

    const label = this.add.text(24, startY + 12, '致谢 CREDITS', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: THEME().textMuted
    });
    panel.add(label);

    const creditsContainer = this.add.container(24, startY + 30);
    panel.add(creditsContainer);
    this.uiElements.creditsContainer = creditsContainer;
    this.uiElements.creditsAvailableHeight = availableHeight;
  }

  private updateCreditsDisplay(): void {
    if (!this.currentCharacter || !this.uiElements.creditsContainer) return;

    const container = this.uiElements.creditsContainer as Phaser.GameObjects.Container;
    container.removeAll(true);

    const availableHeight = this.uiElements.creditsAvailableHeight || 80;
    const lineHeight = 12;
    const maxLines = Math.max(1, Math.floor((availableHeight - 20) / lineHeight));
    const maxAuthors = maxLines * 2;

    const allAuthors = new Set<string>();
    const allLicenses = new Set<string>();

    for (const [, selection] of Object.entries(this.currentCharacter.parts)) {
      const meta = partRegistry.getPart(selection.itemId);
      if (!meta?.credits) continue;

      for (const credit of meta.credits) {
        credit.authors.forEach(author => allAuthors.add(author));
        credit.licenses.forEach(license => allLicenses.add(license));
      }
    }

    const authorsArray = Array.from(allAuthors);
    const licensesArray = Array.from(allLicenses);
    const displayAuthors = authorsArray.slice(0, maxAuthors);
    const maxLineLength = 28;

    const lines: string[] = [];
    let currentLine = '';

    displayAuthors.forEach((author) => {
      const shortName = author.length > maxLineLength 
        ? author.substring(0, maxLineLength - 3) + '...' 
        : author;

      if (currentLine.length === 0) {
        currentLine = shortName;
      } else if (currentLine.length + shortName.length + 2 <= maxLineLength) {
        currentLine += ', ' + shortName;
      } else {
        lines.push(currentLine);
        currentLine = shortName;
      }
    });
    if (currentLine.length > 0) {
      lines.push(currentLine);
    }

    const displayLines = lines.slice(0, maxLines);

    let yOffset = 0;

    displayLines.forEach(line => {
      const text = this.add.text(0, yOffset, line, {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: THEME().textMuted
      });
      container.add(text);
      yOffset += lineHeight;
    });

    const totalAuthors = authorsArray.length;
    const hasMore = totalAuthors > maxAuthors || lines.length > maxLines;
    
    if (hasMore) {
      const remaining = totalAuthors > maxAuthors ? `+${totalAuthors - maxAuthors} more` : 'view all';
      const moreText = this.add.text(0, yOffset, remaining, {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: THEME().accentCss
      }).setInteractive({ useHandCursor: true });
      
      moreText.on('pointerover', () => moreText.setColor(THEME().accentCss));
      moreText.on('pointerout', () => moreText.setColor(THEME().accentCss));
      moreText.on('pointerdown', () => this.openCreditsModal(authorsArray, licensesArray));
      container.add(moreText);
    }

    if (allLicenses.size > 0) {
      const licenseY = yOffset + (hasMore ? lineHeight + 4 : 4);
      const licensesStr = Array.from(allLicenses).slice(0, 3).join(', ');
      const licenseText = this.add.text(0, licenseY, `License: ${licensesStr}`, {
        fontSize: '8px',
        fontFamily: 'monospace',
        color: THEME().textMuted
      });
      container.add(licenseText);
    }

    if (allAuthors.size === 0) {
      const noCredits = this.add.text(0, 0, 'No credits available', {
        fontSize: '9px',
        fontFamily: 'monospace',
        color: THEME().textMuted
      });
      container.add(noCredits);
    }
  }

  private openCreditsModal(authors: string[], licenses: string[]): void {
    const { width, height } = this.cameras.main;

    const modalW = 400;
    const modalH = 450;
    const modalX = (width - modalW) / 2;
    const modalY = (height - modalH) / 2;

    const authorsList = authors.join('<br>');
    const licensesList = licenses.join(', ');

    const html = `
      <div class="modal-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: monospace;
      ">
        <div style="
          background: var(--ds-bg-secondary);
          border: 2px solid '${THEME().accentCss}';
          border-radius: 8px;
          width: ${modalW}px;
          max-height: ${modalH}px;
          display: flex;
          flex-direction: column;
        ">
          <div style="padding: 16px; text-align: center; border-bottom: 1px solid var(--ds-border);">
            <div style="font-size: 16px; color: '${THEME().accentCss}'; font-weight: bold;">致谢 CREDITS</div>
            <div style="font-size: 10px; color: var(--ds-text-muted); margin-top: 4px;">(排名不分先后 In No Particular Order)</div>
          </div>
          <div style="
            flex: 1;
            overflow-y: auto;
            padding: 12px 16px;
            background: var(--ds-bg-primary);
            margin: 12px;
            border-radius: 4px;
            border: 1px solid var(--ds-border);
          ">
            <div style="font-size: 11px; color: '${THEME().textSecondary}'; line-height: 1.8;">${authorsList}</div>
          </div>
          <div style="padding: 0 16px 8px 16px;">
            <div style="font-size: 10px; color: var(--ds-text-muted);">Licenses:</div>
            <div style="font-size: 9px; color: var(--ds-text-muted); margin-top: 4px;">${licensesList}</div>
          </div>
          <div style="padding: 12px; text-align: center; border-top: 1px solid var(--ds-border);">
            <button id="credits-close-btn" style="
              background: var(--ds-bg-tertiary);
              border: none;
              color: '${THEME().accentCss}';
              padding: 8px 24px;
              font-family: monospace;
              font-size: 12px;
              cursor: pointer;
              border-radius: 4px;
            ">关闭 CLOSE</button>
          </div>
        </div>
      </div>
    `;

    const domOverlay = this.add.dom(0, 0).createFromHTML(html).setOrigin(0, 0);
    const node = domOverlay.node as HTMLElement;
    node.style.position = 'fixed';
    node.style.top = '0';
    node.style.left = '0';

    const overlayEl = node.querySelector('.modal-overlay') as HTMLElement;
    const closeBtn = node.querySelector('#credits-close-btn') as HTMLButtonElement;

    const closeModal = () => {
      domOverlay.destroy();
    };

    closeBtn?.addEventListener('click', closeModal);
    overlayEl?.addEventListener('click', (e) => {
      if (e.target === overlayEl) closeModal();
    });
  }

  private createJsonEditorSection(panel: Phaser.GameObjects.Container, panelW: number, panelH: number): void {
    const y = panelH - 80;

    const divider = this.add.graphics();
    divider.lineStyle(1, THEME().panelBorder, 0.5);
    divider.lineBetween(24, y, panelW - 24, y);
    panel.add(divider);

    const label = this.add.text(24, y + 16, 'JSON 编辑器 JSON EDITOR', {
      fontSize: '10px',
      fontFamily: 'monospace',
      color: THEME().textMuted
    });
    panel.add(label);

    const btn = this.add.text(24, y + 36, '打开 JSON 编辑 OPEN', {
      fontSize: '12px',
      fontFamily: 'monospace',
      color: THEME().accentSecondary,
      backgroundColor: 'var(--ds-status-success-bg)',
      padding: { x: 12, y: 6 }
    }).setOrigin(0, 0).setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setColor(THEME().accentSecondary));
    btn.on('pointerout', () => btn.setColor(THEME().accentSecondary));
    btn.on('pointerdown', () => this.openJsonEditor());
    panel.add(btn);
  }

  private openJsonEditor(): void {
    if (!this.currentCharacter) return;

    const partsJson = JSON.stringify(this.currentCharacter.parts, null, 2);
    const { width, height } = this.cameras.main;

    const modalW = 500;
    const modalH = 400;

    const html = `
      <div class="json-modal-overlay" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        font-family: monospace;
      ">
        <div style="
          background: var(--ds-bg-secondary);
          border: 1px solid var(--ds-border);
          border-radius: 8px;
          width: ${modalW}px;
          height: ${modalH}px;
          display: flex;
          flex-direction: column;
        ">
          <div style="padding: 12px 16px; border-bottom: 1px solid var(--ds-border);">
            <span style="font-size: 14px; color: '${THEME().accentCss}';">角色配置 JSON EDITOR</span>
          </div>
          <div style="flex: 1; padding: 12px 16px;">
            <textarea id="json-editor" style="
              width: 100%;
              height: 100%;
              background: var(--ds-bg-primary);
              border: 1px solid var(--ds-border);
              border-radius: 4px;
              color: var(--ds-text-primary);
              font-size: 12px;
              font-family: monospace;
              resize: none;
              padding: 8px;
              box-sizing: border-box;
            ">${partsJson}</textarea>
          </div>
          <div style="padding: 12px 16px; display: flex; justify-content: flex-end; gap: 12px; border-top: 1px solid var(--ds-border);">
            <button id="json-cancel-btn" style="
              background: var(--ds-bg-tertiary);
              border: none;
              color: var(--ds-text-muted);
              padding: 8px 16px;
              font-family: monospace;
              font-size: 12px;
              cursor: pointer;
              border-radius: 4px;
            ">取消 CANCEL</button>
            <button id="json-save-btn" style="
              background: var(--ds-status-success-bg, rgba(0,255,0,0.1));
              border: none;
              color: var(--ds-status-success);
              padding: 8px 16px;
              font-family: monospace;
              font-size: 12px;
              cursor: pointer;
              border-radius: 4px;
            ">保存 SAVE</button>
          </div>
        </div>
      </div>
    `;

    const domOverlay = this.add.dom(0, 0).createFromHTML(html).setOrigin(0, 0);
    const node = domOverlay.node as HTMLElement;
    node.style.position = 'fixed';
    node.style.top = '0';
    node.style.left = '0';

    const overlayEl = node.querySelector('.json-modal-overlay') as HTMLElement;
    const cancelBtn = node.querySelector('#json-cancel-btn') as HTMLButtonElement;
    const saveBtn = node.querySelector('#json-save-btn') as HTMLButtonElement;
    const textarea = node.querySelector('#json-editor') as HTMLTextAreaElement;

    const closeModal = () => {
      domOverlay.destroy();
    };

    cancelBtn?.addEventListener('click', closeModal);

    saveBtn?.addEventListener('click', () => {
      if (textarea) {
        try {
          const newParts = JSON.parse(textarea.value);
          if (this.currentCharacter) {
            this.currentCharacter.parts = newParts;
            this.isDirty = true;
            this.partSelector?.setCurrentSelections(newParts);
            this.updatePreview();
            this.showMessage('JSON 已更新 JSON updated', 'success');
          }
        } catch (e) {
          this.showMessage('JSON 格式错误 Invalid JSON', 'error');
        }
      }
      closeModal();
    });

    overlayEl?.addEventListener('click', (e) => {
      if (e.target === overlayEl) closeModal();
    });
  }

  private createMainPanel(width: number, height: number): void {
    const panelX = THEME().leftPanelWidth;
    const panelY = THEME().headerHeight;
    const panelW = width - THEME().leftPanelWidth - THEME().rightPanelWidth;
    const panelH = height - THEME().headerHeight;

    this.mainPanelContainer = this.add.container(panelX, panelY);

    const bg = this.add.graphics();
    bg.fillStyle(THEME().panelBg, 1);
    bg.fillRect(0, 0, panelW, panelH);
    this.mainPanelContainer.add(bg);

    this.buildStepPanel(panelW, panelH);
  }

  private buildStepPanel(panelW: number, panelH: number): void {
    if (!this.mainPanelContainer) return;

    this.partSelector?.destroy?.();
    this.openClawConnectionPanel?.destroy?.();
    this.agentChatPanel?.destroy?.();
    this.backendSelector?.destroy?.();

    const container = this.mainPanelContainer;
    const existingChildren = container.list.slice(1);
    existingChildren.forEach(child => {
      if (child && typeof (child as any).destroy === 'function') {
        (child as any).destroy();
      }
    });
    container.remove(existingChildren, true);

    switch (this.currentStep) {
      case 'appearance':
        this.buildAppearancePanel(panelW, panelH);
        break;
      case 'openclaw':
        this.buildOpenClawPanel(panelW, panelH);
        break;
      case 'agent':
        this.buildAgentPanel(panelW, panelH);
        break;
    }
  }

  private buildAppearancePanel(panelW: number, panelH: number): void {
    if (!this.mainPanelContainer) return;

    this.partSelector = new PartSelector(this, {
      x: 16,
      y: 16,
      width: panelW - 32,
      height: panelH - 32,
      bodyType: this.currentCharacter?.bodyType ?? DEFAULT_BODY_TYPE,
      onPartSelected: (category, itemId, variant) => this.onPartSelected(category, itemId, variant),
      onRandomize: () => this.randomizeCharacter('normal'),
      onNext: () => this.setStep('openclaw')
    });
    const dom = this.partSelector.create();
    this.mainPanelContainer.add(dom);
  }

  private buildOpenClawPanel(panelW: number, panelH: number): void {
    if (!this.mainPanelContainer || !this.currentCharacter) return;

    this.backendSelector = new BackendSelector(this, {
      x: 16,
      y: 16,
      width: panelW - 32,
      height: panelH - 32,
      initialBackendType: this.currentCharacter.backendType as any || 'direct',
      initialDirectConfig: this.currentCharacter.directConfig as any,
      initialOpenClawConfig: this.currentCharacter.openClawConfig as any,
      initialStratixConfig: this.currentCharacter.stratixConfig as any,
      onChange: (backendType, config) => {
        this.selectedBackendType = backendType;
        this.selectedBackendConfig = config;
        if (this.currentCharacter) {
          this.currentCharacter.backendType = backendType;
          if (backendType === 'direct') {
            this.currentCharacter.directConfig = config as any;
            this.currentCharacter.openClawConfig = undefined;
            this.currentCharacter.stratixConfig = undefined;
          } else if (backendType === 'openclaw') {
            this.currentCharacter.openClawConfig = config as any;
            this.currentCharacter.directConfig = undefined;
            this.currentCharacter.stratixConfig = undefined;
          } else if (backendType === 'stratix') {
            this.currentCharacter.stratixConfig = config as any;
            this.currentCharacter.directConfig = undefined;
            this.currentCharacter.openClawConfig = undefined;
          }
        }
      },
      onNext: () => {
        this.setStep('agent');
      }
    });
    const dom = this.backendSelector.create();
    this.mainPanelContainer.add(dom);
  }

  private buildAgentPanel(panelW: number, panelH: number): void {
    if (!this.mainPanelContainer || !this.currentCharacter) return;

    const backendType = this.selectedBackendType || this.currentCharacter?.backendType || 'direct';

    this.agentChatPanel = new AgentChatPanel(this, {
      x: 16,
      y: 16,
      width: panelW - 32,
      height: panelH - 32,
      character: this.currentCharacter,
      backendType,
      directConfig: this.currentCharacter?.directConfig,
      stratixConfig: this.currentCharacter?.stratixConfig,
      onComplete: async () => {
        console.log('========================================');
        console.log('[CharacterCreatorScene] 🔵 onComplete callback triggered');
        
        const characterSnapshot = this.prepareCharacterForCreation();
        console.log('[CharacterCreatorScene] 📦 Character snapshot:', {
          id: characterSnapshot?.characterId,
          name: characterSnapshot?.name
        });
        
        if (characterSnapshot && this.currentCharacter) {
          characterSnapshot.backendType = this.selectedBackendType;
          characterSnapshot.directConfig = this.selectedBackendType === 'direct' ? this.selectedBackendConfig : undefined;
          characterSnapshot.openClawConfig = this.selectedBackendType === 'openclaw' ? this.selectedBackendConfig : undefined;
          characterSnapshot.stratixConfig = this.selectedBackendType === 'stratix' ? this.selectedBackendConfig : undefined;
          
          console.log('[CharacterCreatorScene] 🚀 Step 1: Emitting scene event');
          this.events.emit('character:created', characterSnapshot);
          console.log('[CharacterCreatorScene] ✅ Scene event emitted');
          
          console.log('[CharacterCreatorScene] 💾 Step 2: Starting async save (non-blocking)');
          this.saveCharacter().catch(err => {
            console.error('[CharacterCreatorScene] ❌ Failed to save character:', err);
          });
          
          console.log('[CharacterCreatorScene] ✅ onComplete completed (弹窗应该关闭了)');
          console.log('========================================');
        } else {
          console.error('[CharacterCreatorScene] ❌ No character to create');
          console.log('========================================');
        }
      },
      onBack: () => {
        this.setStep('openclaw');
      }
    });
    const dom = this.agentChatPanel.create();
    this.mainPanelContainer.add(dom);
  }

  private rebuildMainPanel(): void {
    const { width, height } = this.cameras.main;
    const panelW = width - THEME().leftPanelWidth - THEME().rightPanelWidth;
    const panelH = height - THEME().headerHeight;
    this.buildStepPanel(panelW, panelH);
  }

  private createRightPanel(width: number, height: number): void {
    const panelX = width - THEME().rightPanelWidth;
    const panelY = THEME().headerHeight;
    const panelW = THEME().rightPanelWidth;
    const panelH = height - THEME().headerHeight;

    const panel = this.add.container(panelX, panelY);

    const bg = this.add.graphics();
    bg.fillStyle(THEME().panelBg, 1);
    bg.fillRect(0, 0, panelW, panelH);
    bg.lineStyle(1, THEME().panelBorder, 1);
    bg.lineBetween(0, 0, 0, panelH);
    panel.add(bg);

    this.uiElements.rightPanel = panel;

    this.characterList = new CharacterList(this, {
      x: panelX + 16,
      y: panelY + 16,
      width: panelW - 32,
      height: panelH - 32,
      onCharacterSelected: (character) => this.loadCharacter(character),
      onCharacterDeleted: (characterId) => this.onCharacterDeleted(characterId)
    });
    this.characterList.create();
  }

  private async initializeDefaultParts(): Promise<void> {
    if (!this.currentCharacter) return;

    const defaultSelections = partRegistry.getDefaultSelections(this.currentCharacter.bodyType);
    this.currentCharacter.parts = { ...defaultSelections, ...this.currentCharacter.parts };

    console.log('[CharacterCreatorScene] Initialized parts:', this.currentCharacter.parts);

    this.partSelector?.setCurrentSelections(this.currentCharacter.parts);
  }

  private async onPartSelected(category: string, itemId: string, variant: string): Promise<void> {
    if (!this.currentCharacter) return;

    this.currentCharacter.parts[category] = { itemId, variant };
    this.isDirty = true;

    await this.updatePreview();
  }

  async updatePreview(): Promise<void> {
    if (!this.currentCharacter || !this.characterPreview) return;

    try {
      const result = await characterComposer.composeCharacter(
        this.currentCharacter.parts,
        { bodyType: this.currentCharacter.bodyType }
      );

      const textureKey = this.previewTextureKey;

      if (this.textures.exists(textureKey)) {
        this.textures.remove(textureKey);
      }

      const texture = this.textures.createCanvas(textureKey, SHEET_WIDTH, SHEET_HEIGHT);
      if (!texture) return;

      const ctx = texture.getContext();
      ctx.drawImage(result.canvas, 0, 0);
      texture.refresh();

      this.characterPreview.setTexture(textureKey);

      this.currentCharacter.thumbnail = textureManager.generateThumbnail(result.canvas, 128);

      this.updateCreditsDisplay();

    } catch (error) {
      console.error('Failed to update preview:', error);
      this.showMessage('预览更新失败 Preview update failed', 'error');
    }
  }

  private readonly OPTIONAL_CATEGORIES = ['quiver', 'shoulders', 'neck', 'backpack', 'cape', 'hat'];
  private readonly ALLOWED_SHIELDS = ['shield_heater_revised_wood', 'shield_heater_wood'];
  private readonly MINIMAL_SKIP_CATEGORIES = [
    'wings', 'wings_dots', 'wings_edge', 'tail',
    'weapon', 'weapon_magic_crystal', 'shield', 'shield_paint', 'shield_pattern', 'shield_trim',
    'backpack', 'backpack_straps', 'cargo', 'cape', 'cape_trim', 'quiver',
    'hat', 'hat_accessory', 'hat_buckle', 'hat_overlay', 'hat_trim',
    'bandana', 'bandana_overlay', 'headcover', 'headcover_rune', 'visor',
    'shoulders', 'neck', 'necklace', 'earrings', 'earring_left', 'earring_right',
    'charm', 'ring', 'sash', 'sash_tie', 'belt', 'buckles',
    'horns', 'fins', 'furry_ears', 'furry_ears_skin',
    'beard', 'mustache', 'sideburn',
    'expression', 'expression_crying', 'facial_left', 'facial_left_trim',
    'facial_mask', 'facial_right', 'facial_right_trim', 'facial_eyes',
    'wound_arm', 'wound_brain', 'wound_eye_left', 'wound_eye_right', 'wound_mouth', 'wound_ribs',
    'wheelchair', 'prosthesis_hand', 'prosthesis_leg', 'bandages', 'wrinkes',
    'hairextl', 'hairextr', 'hairtie', 'hairtie_rune', 'updo', 'ponytail',
    'jacket', 'jacket_collar', 'jacket_pockets', 'jacket_trim',
    'vest', 'apron', 'overalls',
    'armour', 'chainmail', 'bracers', 'bauldron',
    'gloves', 'sleeves', 'socks', 'dress', 'dress_sleeves', 'dress_trim', 'dress_sleeves_trim',
    'accessory', 'ammo', 'facial', 'eyebrows',
  ];
  private readonly MINIMAL_HEAD_PREFIX = 'Human';

  private getRandomizationConfig(mode: 'minimal' | 'normal' | 'full'): {
    skipCategories: string[];
    shieldMode: 'empty' | 'limited' | 'all';
    optionalEmptyChance: number;
  } {
    switch (mode) {
      case 'minimal':
        return {
          skipCategories: this.MINIMAL_SKIP_CATEGORIES,
          shieldMode: 'empty',
          optionalEmptyChance: 1
        };
      case 'normal':
        return {
          skipCategories: [],
          shieldMode: 'limited',
          optionalEmptyChance: 0.5
        };
      case 'full':
        return {
          skipCategories: [],
          shieldMode: 'all',
          optionalEmptyChance: 0
        };
    }
  }

  async randomizeCharacter(mode: 'minimal' | 'normal' | 'full' = 'normal'): Promise<void> {
    if (!this.currentCharacter) return;

    const config = this.getRandomizationConfig(mode);
    const allCategories = partRegistry.getAllCategories();

    for (const category of allCategories) {
      if (config.skipCategories.includes(category)) {
        continue;
      }

      if (category === 'shield') {
        if (config.shieldMode === 'empty') {
          delete this.currentCharacter.parts[category];
          continue;
        }
        if (config.shieldMode === 'limited') {
          if (Math.random() < 0.3) {
            delete this.currentCharacter.parts[category];
            continue;
          }
          const shieldId = this.ALLOWED_SHIELDS[Math.floor(Math.random() * this.ALLOWED_SHIELDS.length)];
          const variant = partRegistry.getRandomVariant(shieldId) ?? 'default';
          this.currentCharacter.parts[category] = { itemId: shieldId, variant };
          continue;
        }
      }

      if (this.OPTIONAL_CATEGORIES.includes(category)) {
        if (Math.random() < config.optionalEmptyChance) {
          delete this.currentCharacter.parts[category];
          continue;
        }
      }

      let part;
      if (mode === 'minimal' && category === 'head') {
        part = this.getHumanHeadPart();
      } else {
        part = partRegistry.getRandomPart(category, this.currentCharacter.bodyType);
      }
      
      if (part) {
        const variant = partRegistry.getRandomVariant(part.itemId) ?? 'default';
        this.currentCharacter.parts[category] = { itemId: part.itemId, variant };
      }
    }

    this.partSelector?.setCurrentSelections(this.currentCharacter.parts);
    this.isDirty = true;

    await this.updatePreview();
    this.showMessage('角色已随机 Character randomized', 'success');
  }

  private getHumanHeadPart(): PartMetadata | null {
    const allHeads = partRegistry.getPartsByCategory('head')
      .filter(p => p.required.includes(this.currentCharacter!.bodyType));
    
    const humanHeads = allHeads.filter(p => 
      p.itemId.startsWith(this.MINIMAL_HEAD_PREFIX)
    );
    
    if (humanHeads.length > 0) {
      return humanHeads[Math.floor(Math.random() * humanHeads.length)];
    }
    
    return allHeads.length > 0 ? allHeads[Math.floor(Math.random() * allHeads.length)] : null;
  }

  prepareCharacterForCreation(): SavedCharacter | null {
    if (!this.currentCharacter) return null;

    if (this.skillTree) {
      this.currentCharacter.skillTree = this.skillTree.getState();
      this.currentCharacter.attributes = this.skillTree.calculateAttributes();
    }

    return { ...this.currentCharacter };
  }

  async saveCharacter(): Promise<void> {
    if (!this.currentCharacter) return;

    try {
      if (this.skillTree) {
        this.currentCharacter.skillTree = this.skillTree.getState();
        this.currentCharacter.attributes = this.skillTree.calculateAttributes();
      }

      const texture = await textureManager.generateAndUploadTexture({
        characterId: this.currentCharacter.characterId,
        name: this.currentCharacter.name,
        bodyType: this.currentCharacter.bodyType,
        parts: this.currentCharacter.parts,
        thumbnail: this.currentCharacter.thumbnail,
        createdAt: this.currentCharacter.createdAt,
        updatedAt: this.currentCharacter.updatedAt
      });

      if (texture) {
        this.currentCharacter.texture = texture;
      }

      this.currentCharacter.updatedAt = Date.now();

      const characterToSave = { ...this.currentCharacter };

      if (characterToSave.directConfig) {
        const { apiKey, ...directConfigWithoutKey } = characterToSave.directConfig as any;
        characterToSave.directConfig = directConfigWithoutKey;
      }
      if (characterToSave.stratixConfig) {
        const { apiKey, ...stratixConfigWithoutKey } = characterToSave.stratixConfig as any;
        characterToSave.stratixConfig = stratixConfigWithoutKey;
      }

      const existingChar = await characterStorage.load(this.currentCharacter.characterId);
      const isNew = !existingChar;

      await characterStorage.save(characterToSave);
      this.isDirty = false;

      if (this.characterList) {
        this.characterList.refresh();
      }
      
      if (this.cameras && this.cameras.main) {
        this.showMessage('角色已保存 Character saved', 'success');
      }
    } catch (error) {
      console.error('[CharacterCreatorScene] Failed to save character:', error);
    }
  }

  setBodyType(bodyType: BodyType): void {
    if (!this.currentCharacter || this.currentCharacter.bodyType === bodyType) return;

    this.currentCharacter.bodyType = bodyType;
    this.partSelector?.setBodyType(bodyType);
    this.isDirty = true;

    this.uiElements.bodyTypeButtons?.forEach((btn, i) => {
      const isActive = BODY_TYPES[i] === bodyType;
      btn.setColor(isActive ? THEME().accent : THEME().textMuted);
      btn.setBackgroundColor(isActive ? 'rgba(0,0,0,0.1)' : 'transparent');
    });

    this.updatePreview();
  }

  setAnimation(animation: AnimationName): void {
    this.characterPreview?.setAnimation(animation);
  }

  setScale(scale: number): void {
    this.characterPreview?.setScale(scale);
  }

  setDirection(direction: number): void {
    this.characterPreview?.setDirection(direction);
  }

  async loadCharacter(character: SavedCharacter): Promise<void> {
    this.currentCharacter = character;

    if (this.uiElements.nameInput?.node) {
      const input = this.uiElements.nameInput.node.querySelector('input') as HTMLInputElement;
      if (input) input.value = character.name;
    }

    this.partSelector?.setCurrentSelections(character.parts);
    this.partSelector?.setBodyType(character.bodyType);
    this.isDirty = false;

    if (this.skillTree && character.skillTree) {
      this.skillTree.setState(character.skillTree);
    }

    await this.updatePreview();
    this.showMessage(`已加载 Loaded: ${character.name}`, 'info');
  }

  private async onCharacterDeleted(characterId: string): Promise<void> {
    const character = await characterStorage.load(characterId);

    if (character) {
      await textureManager.deleteTexture(character);
    }

    await characterStorage.delete(characterId);

    characterCreatorEvents.emitCharacterDeleted(characterId);
    this.callbacks.onCharacterDeleted?.(characterId);

    if (this.currentCharacter?.characterId === characterId) {
      this.currentCharacter = characterStorage.createNew();
      await this.initializeDefaultParts();
      await this.updatePreview();
    }
  }

  private updateAttributesDisplay(attributes: Record<string, number>): void {
    if (!this.uiElements.attrLabel) return;

    if (Object.keys(attributes).length === 0) {
      this.uiElements.attrLabel.setText('No bonuses');
    } else {
      const displayAttrs = Object.entries(attributes)
        .slice(0, 3)
        .map(([k, v]) => `${k.toUpperCase()}+${v}`)
        .join('  ');
      this.uiElements.attrLabel.setText(displayAttrs);
    }
  }

  private setupEventBus(): void {
    const unsubOpen = characterCreatorEvents.onOpenCreator((data) => {
      if (data.targetCharacterId) {
        this.loadCharacterById(data.targetCharacterId);
      }
    });
    this.eventUnsubscribers.push(unsubOpen);
  }

  async loadCharacterById(characterId: string): Promise<void> {
    const character = await characterStorage.load(characterId);
    if (character) {
      await this.loadCharacter(character);
    }
  }

  private showMessage(text: string, type: 'success' | 'error' | 'info' = 'info'): void {
    const { width, height } = this.cameras.main;

    const colors: Record<string, string> = {
      success: THEME().accentSecondary,
      error: 'var(--ds-status-danger)',
      info: THEME().accent
    };

    const bg = this.add.rectangle(width / 2, height - 40, 200, 32, 0x000000, 0.8);

    const message = this.add.text(width / 2, height - 40, text.toUpperCase(), {
      fontSize: '11px',
      fontFamily: 'monospace',
      color: colors[type]
    }).setOrigin(0.5).setDepth(1000);

    this.tweens.add({
      targets: [message, bg],
      alpha: { from: 1, to: 0 },
      duration: 2000,
      delay: 1000,
      onComplete: () => {
        message.destroy();
        bg.destroy();
      }
    });
  }

  getCurrentCharacter(): SavedCharacter | null {
    return this.currentCharacter;
  }

  isCharacterDirty(): boolean {
    return this.isDirty;
  }

  shutdown(): void {
    this.eventUnsubscribers.forEach(unsub => unsub());
    this.eventUnsubscribers = [];

    this.partSelector?.destroy?.();
    this.openClawConnectionPanel?.destroy?.();
    this.agentChatPanel?.destroy?.();
    this.backendSelector?.destroy?.();
    this.characterPreview?.destroy();
    this.characterList?.destroy();
    this.uiElements.nameInput?.destroy();

    if (this.textures.exists(this.previewTextureKey)) {
      this.textures.remove(this.previewTextureKey);
    }

    characterComposer.clearCache();
  }
}

export default CharacterCreatorScene;
