/**
 * CommandPanel V2 - 响应式版本
 * 
 * 使用EnhancedUIComponent和响应式Token
 * 自动响应主题变化
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
}

export interface Skill {
  skillId: string;
  name: string;
  description: string;
  icon?: string;
  hotkey?: string;
}

interface SkillButton {
  container: Phaser.GameObjects.Container;
  skill: Skill;
}

export class CommandPanelV2 extends EnhancedUIComponent {
  private unitInfoContainer: Phaser.GameObjects.Container | null = null;
  private skillsContainer: Phaser.GameObjects.Container | null = null;
  private commandsContainer: Phaser.GameObjects.Container | null = null;
  private skillButtons: Map<string, SkillButton> = new Map();
  private currentUnit: UnitInfo | null = null;
  private currentSkills: Skill[] = [];
  private onSkillSelect: (skill: Skill) => void;
  private onCommandExecute: (command: string) => void;
  
  private backgroundColor: ReactiveToken<string>;
  private backgroundTertiaryColor: ReactiveToken<string>;
  private textPrimaryColor: ReactiveToken<string>;
  private textSecondaryColor: ReactiveToken<string>;
  private textMutedColor: ReactiveToken<string>;
  private borderColor: ReactiveToken<string>;
  private accentColor: ReactiveToken<string>;
  private infoColor: ReactiveToken<string>;
  private successColor: ReactiveToken<string>;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    width: number,
    height: number,
    onSkillSelect: (skill: Skill) => void,
    onCommandExecute: (command: string) => void
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
    
    this.backgroundColor = this.useToken('colors.background.primary');
    this.backgroundTertiaryColor = this.useToken('colors.background.tertiary');
    this.textPrimaryColor = this.useToken('colors.text.primary');
    this.textSecondaryColor = this.useToken('colors.text.secondary');
    this.textMutedColor = this.useToken('colors.text.muted');
    this.borderColor = this.useToken('colors.border.default');
    this.accentColor = this.useToken('colors.accent');
    this.infoColor = this.useToken('colors.semantic.info');
    this.successColor = this.useToken('colors.semantic.success');
  }
  
  create(): void {
    this.container = this.scene.add.container(this.config.x, this.config.y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);
    
    this.createBackground();
    this.createUnitInfoPanel();
    this.createSkillsContainer();
    this.createCommandsContainer();
    this.showEmptyState();
    
    this.onCreate();
  }
  
  private createBackground(): void {
    const bg = this.scene.add.graphics();
    const bgColor = this.hexToNumber(this.backgroundColor.get());
    bg.fillStyle(bgColor, 0.95);
    bg.fillRoundedRect(0, 0, this.config.width || 500, this.config.height || 180, 8);
    (this.container as Phaser.GameObjects.Container).add(bg);
  }
  
  private createUnitInfoPanel(): void {
    const unitInfoWidth = 140;
    
    this.unitInfoContainer = this.scene.add.container(8, 8);
    this.renderUnitInfoBackground(unitInfoWidth);
    (this.container as Phaser.GameObjects.Container).add(this.unitInfoContainer);
  }
  
  private renderUnitInfoBackground(width: number): void {
    const height = (this.config.height || 180) - 16;
    
    const bg = this.scene.add.graphics();
    bg.fillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()), 1);
    bg.fillRoundedRect(0, 0, width, height - 64, 8);
    bg.lineStyle(1, this.hexToNumber(this.borderColor.get()), 0.3);
    bg.strokeRoundedRect(0, 0, width, height - 64, 8);
    this.unitInfoContainer?.add(bg);
    
    const avatar = this.scene.add.graphics();
    avatar.fillStyle(0x2a2a4e, 1);
    avatar.fillRoundedRect(16, 16, 60, 60, 8);
    avatar.lineStyle(2, this.hexToNumber(this.borderColor.get()), 0.5);
    avatar.strokeRoundedRect(16, 16, 60, 60, 8);
    this.unitInfoContainer?.add(avatar);
    
    const typeIcon = this.scene.add.text(46, 36, '👤', {
      fontSize: '32px',
      fontFamily: 'Arial, sans-serif',
    });
    typeIcon.setOrigin(0.5);
    this.unitInfoContainer?.add(typeIcon);
    
    const nameText = this.createText(88, 20, '未选中', {
      fontSize: '14px',
      fontStyle: 'bold',
    });
    this.unitInfoContainer?.add(nameText);
    
    const statusText = this.createText(88, 40, '-', {
      fontSize: '12px',
      color: this.textSecondaryColor.get(),
    });
    this.unitInfoContainer?.add(statusText);
    
    const healthBarBg = this.scene.add.graphics();
    healthBarBg.fillStyle(this.hexToNumber(this.borderColor.get()), 1);
    healthBarBg.fillRoundedRect(16, 88, width - 32, 6, 3);
    this.unitInfoContainer?.add(healthBarBg);
    
    const healthBarFill = this.scene.add.graphics();
    healthBarFill.fillStyle(this.hexToNumber(this.successColor.get()), 1);
    healthBarFill.fillRoundedRect(16, 88, width - 32, 6, 3);
    this.unitInfoContainer?.add(healthBarFill);
    
    const unitLabel = this.createText(16, 102, '单位', {
      fontSize: '10px',
      color: this.textSecondaryColor.get(),
    });
    this.unitInfoContainer?.add(unitLabel);
  }
  
  private createSkillsContainer(): void {
    const unitInfoWidth = 140;
    this.skillsContainer = this.scene.add.container(unitInfoWidth + 16, 8);
    (this.container as Phaser.GameObjects.Container).add(this.skillsContainer);
  }
  
  private createCommandsContainer(): void {
    this.commandsContainer = this.scene.add.container(8, (this.config.height || 180) - 64);
    (this.container as Phaser.GameObjects.Container).add(this.commandsContainer);
  }
  
  private showEmptyState(): void {
    const label = this.createText(
      (this.config.width || 500) / 2,
      (this.config.height || 180) / 2,
      '未选中单位',
      {
        fontSize: '14px',
        color: this.textMutedColor.get(),
      }
    );
    label.setOrigin(0.5);
    (this.container as Phaser.GameObjects.Container).add(label);
  }
  
  public setUnit(unit: UnitInfo): void {
    this.currentUnit = unit;
  }
  
  public setSkills(skills: Skill[]): void {
    this.currentSkills = skills;
    this.createSkillButtons(skills);
  }
  
  private createSkillButtons(skills: Skill[]): void {
    (this.skillsContainer as Phaser.GameObjects.Container)?.removeAll(true);
    
    const buttonWidth = 72;
    const buttonHeight = 72;
    const spacing = 8;
    const buttonsPerRow = Math.floor(((this.config.width || 500) - 156) / (buttonWidth + spacing));
    
    skills.forEach((skill, index) => {
      const row = Math.floor(index / buttonsPerRow);
      const col = index % buttonsPerRow;
      const x = col * (buttonWidth + spacing);
      const y = row * (buttonHeight + spacing);
      
      const button = this.createSkillButton(x, y, buttonWidth, buttonHeight, skill);
      this.skillsContainer?.add(button);
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
    
    const bg = this.scene.add.rectangle(
      width / 2,
      height / 2,
      width,
      height,
      this.hexToNumber(this.backgroundTertiaryColor.get())
    );
    bg.setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true });
    container.add(bg);
    
    const nameText = this.createText(width / 2, height / 2 - 10, skill.name, {
      fontSize: '11px',
      wordWrap: { width: width - 8 },
    });
    nameText.setOrigin(0.5);
    container.add(nameText);
    
    if (skill.hotkey) {
      const hotkeyText = this.createText(width - 8, 8, skill.hotkey, {
        fontSize: '10px',
        color: this.infoColor.get(),
      });
      container.add(hotkeyText);
    }
    
    bg.on('pointerdown', () => {
      this.onSkillSelect(skill);
    });
    
    bg.on('pointerover', () => {
      bg.setFillStyle(this.hexToNumber(this.accentColor.get()));
    });
    
    bg.on('pointerout', () => {
      bg.setFillStyle(this.hexToNumber(this.backgroundTertiaryColor.get()));
    });
    
    return container;
  }
  
  protected updateThemeStyles(): void {
    (this.container as Phaser.GameObjects.Container)?.removeAll(true);
    this.createBackground();
    this.createUnitInfoPanel();
    this.createSkillsContainer();
    this.createCommandsContainer();
    if (this.currentSkills.length > 0) {
      this.createSkillButtons(this.currentSkills);
    } else {
      this.showEmptyState();
    }
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
    this.unitInfoContainer?.destroy();
    this.skillsContainer?.destroy();
    this.commandsContainer?.destroy();
    super.destroy();
  }
}