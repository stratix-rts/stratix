/**
 * ThemeSelectorUI - 主题切换按钮
 *
 * 在 UI 层显示当前主题，点击切换
 */

import Phaser from 'phaser';

import { THEMES, ThemeName } from '../themes/ThemeManager';

export interface ThemeSelectorCallbacks {
  onThemeSelect: (theme: ThemeName) => void;
}

export class ThemeSelectorUI {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private button: Phaser.GameObjects.Container;
  private dropdown: Phaser.GameObjects.Container;
  private dropdownItems: Phaser.GameObjects.Container[] = [];
  private callbacks: ThemeSelectorCallbacks;
  private currentTheme: ThemeName = 'fantasy';
  private isOpen: boolean = false;

  // 主题颜色映射
  private themeColors: Record<ThemeName, number> = {
    fantasy: 0x4a7c59,
    cartoon: 0x4a90d9,
    cyberpunk: 0x9c27b0,
    nature: 0x6d4c41,
  };

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    callbacks: ThemeSelectorCallbacks
  ) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0, 0);
    this.container.setDepth(1000);

    this.button = this.createButton();
    this.dropdown = this.createDropdown();

    this.container.add(this.button);
    this.container.add(this.dropdown);
    this.dropdown.setVisible(false);
  }

  private createButton(): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(0, 0);

    // 按钮背景
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x333333, 0.8);
    bg.fillRoundedRect(0, 0, 100, 28, 6);
    bg.lineStyle(1, 0x555555, 0.5);
    bg.strokeRoundedRect(0, 0, 100, 28, 6);
    btn.add(bg);

    // 主题色圆点
    const dot = this.scene.add.graphics();
    dot.fillStyle(this.themeColors[this.currentTheme], 1);
    dot.fillCircle(14, 14, 6);
    btn.add(dot);
    (btn as any).dotGraphics = dot;

    // 主题名称文字
    const label = THEMES[this.currentTheme].displayName;
    const text = this.scene.add.text(28, 6, label, {
      fontSize: '13px',
      color: '#ffffff',
      fontFamily: 'system-ui, sans-serif',
    });
    btn.add(text);
    (btn as any).labelText = text;

    // 下拉箭头
    const arrow = this.scene.add.graphics();
    arrow.fillStyle(0xffffff, 0.7);
    arrow.fillTriangle(78, 10, 88, 10, 83, 16);
    btn.add(arrow);

    // 点击区域
    const hitArea = this.scene.add.rectangle(50, 14, 100, 28, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    hitArea.on('pointerdown', this.toggleDropdown.bind(this));
    btn.add(hitArea);

    return btn;
  }

  private createDropdown(): Phaser.GameObjects.Container {
    const drop = this.scene.add.container(0, 32);

    // 背景
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x222222, 0.95);
    bg.fillRoundedRect(0, 0, 100, 120, 6);
    bg.lineStyle(1, 0x444444, 0.5);
    bg.strokeRoundedRect(0, 0, 100, 120, 6);
    drop.add(bg);

    // 创建每个主题选项
    const themes: ThemeName[] = ['fantasy', 'cartoon', 'cyberpunk', 'nature'];
    themes.forEach((theme, index) => {
      const item = this.createDropdownItem(theme, index);
      drop.add(item);
      this.dropdownItems.push(item);
    });

    return drop;
  }

  private createDropdownItem(theme: ThemeName, index: number): Phaser.GameObjects.Container {
    const item = this.scene.add.container(0, index * 30);

    // 选中状态背景（默认隐藏）
    const selectedBg = this.scene.add.graphics();
    selectedBg.fillStyle(0x444444, 1);
    selectedBg.fillRoundedRect(2, 2, 96, 26, 4);
    selectedBg.setVisible(theme === this.currentTheme);
    item.add(selectedBg);
    (item as any).selectedBg = selectedBg;

    // 颜色圆点
    const dot = this.scene.add.graphics();
    dot.fillStyle(this.themeColors[theme], 1);
    dot.fillCircle(14, 15, 6);
    item.add(dot);

    // 主题名称
    const text = this.scene.add.text(28, 8, THEMES[theme].displayName, {
      fontSize: '13px',
      color: theme === this.currentTheme ? '#ffffff' : '#aaaaaa',
      fontFamily: 'system-ui, sans-serif',
    });
    item.add(text);

    // 选中标记
    if (theme === this.currentTheme) {
      const check = this.scene.add.graphics();
      check.lineStyle(2, 0xffffff, 0.8);
      check.lineBetween(80, 15, 83, 18);
      check.lineBetween(83, 18, 90, 11);
      item.add(check);
    }

    // 点击区域
    const hitArea = this.scene.add.rectangle(50, 15, 96, 26, 0x000000, 0);
    hitArea.setInteractive({ useHandCursor: true });
    hitArea.on('pointerdown', () => this.selectTheme(theme));
    item.add(hitArea);

    // 悬停效果
    hitArea.on('pointerover', () => {
      if (theme !== this.currentTheme) {
        selectedBg.clear();
        selectedBg.fillStyle(0x383838, 1);
        selectedBg.fillRoundedRect(2, 2, 96, 26, 4);
      }
    });
    hitArea.on('pointerout', () => {
      if (theme !== this.currentTheme) {
        selectedBg.clear();
        selectedBg.fillStyle(0x444444, 1);
        selectedBg.fillRoundedRect(2, 2, 96, 26, 4);
      }
    });

    return item;
  }

  private toggleDropdown(): void {
    this.isOpen = !this.isOpen;
    this.dropdown.setVisible(this.isOpen);
  }

  private selectTheme(theme: ThemeName): void {
    if (theme === this.currentTheme) {
      this.isOpen = false;
      this.dropdown.setVisible(false);
      return;
    }

    // 更新当前主题
    this.currentTheme = theme;

    // 更新按钮显示
    const dotGraphics = (this.button as any).dotGraphics as Phaser.GameObjects.Graphics;
    dotGraphics.clear();
    dotGraphics.fillStyle(this.themeColors[theme], 1);
    dotGraphics.fillCircle(14, 14, 6);

    const labelText = (this.button as any).labelText as Phaser.GameObjects.Text;
    labelText.setText(THEMES[theme].displayName);

    // 更新下拉选项选中状态
    this.dropdownItems.forEach((item, index) => {
      const themes: ThemeName[] = ['fantasy', 'cartoon', 'cyberpunk', 'nature'];
      const itemTheme = themes[index];
      const selectedBg = (item as any).selectedBg as Phaser.GameObjects.Graphics;
      const text = item.list[2] as Phaser.GameObjects.Text;

      selectedBg.clear();
      if (itemTheme === theme) {
        selectedBg.fillStyle(0x444444, 1);
        selectedBg.fillRoundedRect(2, 2, 96, 26, 4);
        selectedBg.setVisible(true);
        text.setColor('#ffffff');
      } else {
        selectedBg.setVisible(false);
        text.setColor('#aaaaaa');
      }
    });

    // 关闭下拉
    this.isOpen = false;
    this.dropdown.setVisible(false);

    // 触发回调
    this.callbacks.onThemeSelect(theme);
  }

  /**
   * 设置当前主题（外部调用，用于同步状态）
   */
  public setTheme(theme: ThemeName): void {
    if (theme === this.currentTheme) return;

    this.currentTheme = theme;

    // 更新按钮显示
    const dotGraphics = (this.button as any).dotGraphics as Phaser.GameObjects.Graphics;
    dotGraphics.clear();
    dotGraphics.fillStyle(this.themeColors[theme], 1);
    dotGraphics.fillCircle(14, 14, 6);

    const labelText = (this.button as any).labelText as Phaser.GameObjects.Text;
    labelText.setText(THEMES[theme].displayName);
  }

  /**
   * 获取容器
   */
  public getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /**
   * 销毁
   */
  public destroy(): void {
    this.container.destroy();
  }
}
