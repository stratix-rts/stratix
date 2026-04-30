/**
 * ZoneTypeSelectorUI - Zone 建筑类型选择器
 * 画框完成后弹出，让用户选择建筑类型
 */

import Phaser from 'phaser';

import { BuildingType, BUILDING_NAMES, BUILDING_COLORS, BUILDING_ICONS } from '../buildings/types/BuildingType';

export interface ZoneTypeSelectorCallbacks {
  onTypeSelect: (type: BuildingType) => void;
  onCancel: () => void;
}

export class ZoneTypeSelectorUI {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private overlay: Phaser.GameObjects.Graphics;
  private panel: Phaser.GameObjects.Container;
  private callbacks: ZoneTypeSelectorCallbacks;
  private isVisible: boolean = false;

  // 按钮数据
  private readonly typeList: { type: BuildingType; icon: string; name: string; color: number }[] = [
    { type: BuildingType.DataCenter, icon: BUILDING_ICONS[BuildingType.DataCenter], name: BUILDING_NAMES[BuildingType.DataCenter], color: BUILDING_COLORS[BuildingType.DataCenter] },
    { type: BuildingType.Workshop, icon: BUILDING_ICONS[BuildingType.Workshop], name: BUILDING_NAMES[BuildingType.Workshop], color: BUILDING_COLORS[BuildingType.Workshop] },
    { type: BuildingType.Studio, icon: BUILDING_ICONS[BuildingType.Studio], name: BUILDING_NAMES[BuildingType.Studio], color: BUILDING_COLORS[BuildingType.Studio] },
    { type: BuildingType.Library, icon: BUILDING_ICONS[BuildingType.Library], name: BUILDING_NAMES[BuildingType.Library], color: BUILDING_COLORS[BuildingType.Library] },
    { type: BuildingType.Command, icon: BUILDING_ICONS[BuildingType.Command], name: BUILDING_NAMES[BuildingType.Command], color: BUILDING_COLORS[BuildingType.Command] },
  ];

  private escHandler: (() => void) | null = null;

  constructor(scene: Phaser.Scene, callbacks: ZoneTypeSelectorCallbacks) {
    this.scene = scene;
    this.callbacks = callbacks;

    // 主容器
    this.container = scene.add.container(0, 0);
    this.container.setDepth(10000);

    // 遮罩层
    this.overlay = scene.add.graphics();
    this.overlay.fillStyle(0x000000, 0.4);
    this.overlay.fillRect(-960, -540, 1920, 1080);
    this.overlay.setInteractive(
      new Phaser.Geom.Rectangle(-960, -540, 1920, 1080),
      Phaser.Geom.Rectangle.Contains
    );
    this.overlay.on('pointerdown', () => this.hide());
    this.container.add(this.overlay);

    // 面板
    this.panel = scene.add.container(0, 0);
    this.container.add(this.panel);

    this.container.setVisible(false);

    // ESC 键关闭
    if (scene.input.keyboard) {
      this.escHandler = () => {
        if (this.isVisible) this.hide();
      };
      scene.input.keyboard.on('keydown-ESC', this.escHandler);
    }
  }

  /** 显示选择器 */
  show(): void {
    this.isVisible = true;
    this.container.setVisible(true);
    this.buildPanel();
  }

  /** 隐藏选择器 */
  hide(): void {
    this.isVisible = false;
    this.container.setVisible(false);
    this.panel.removeAll(true);
  }

  /** 是否可见 */
  isOpen(): boolean {
    return this.isVisible;
  }

  /** 构建面板内容 */
  private buildPanel(): void {
    this.panel.removeAll(true);

    const cam = this.scene.cameras.main;
    const centerX = cam.scrollX + cam.width / 2;
    const centerY = cam.scrollY + cam.height / 2;

    // 标题
    const title = this.scene.add.text(centerX, centerY - 100, '选择建筑类型', {
      fontSize: '18px',
      color: '#ffffff',
      fontStyle: 'bold',
      backgroundColor: '#000000cc',
      padding: { x: 16, y: 8 },
    }).setOrigin(0.5);
    this.panel.add(title);

    // 类型按钮（横向排列）
    const buttonWidth = 120;
    const buttonHeight = 80;
    const gap = 16;
    const totalWidth = this.typeList.length * buttonWidth + (this.typeList.length - 1) * gap;
    const startX = centerX - totalWidth / 2 + buttonWidth / 2;

    for (let i = 0; i < this.typeList.length; i++) {
      const item = this.typeList[i];
      const bx = startX + i * (buttonWidth + gap);
      const by = centerY;

      const button = this.createButton(bx, by, buttonWidth, buttonHeight, item);
      this.panel.add(button);
    }
  }

  /** 创建单个类型按钮 */
  private createButton(
    x: number, y: number,
    width: number, height: number,
    item: { type: BuildingType; icon: string; name: string; color: number }
  ): Phaser.GameObjects.Container {
    const btn = this.scene.add.container(x, y);

    // 背景矩形
    const bg = this.scene.add.graphics();
    bg.fillStyle(item.color, 0.85);
    bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
    bg.lineStyle(2, 0xffffff, 0.3);
    bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);

    // 设置点击区域
    bg.setInteractive(
      new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
      Phaser.Geom.Rectangle.Contains
    );

    // 悬停效果
    bg.on('pointerover', () => {
      bg.clear();
      bg.fillStyle(item.color, 1);
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
      bg.lineStyle(2, 0xffffff, 0.6);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
    });

    bg.on('pointerout', () => {
      bg.clear();
      bg.fillStyle(item.color, 0.85);
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8);
      bg.lineStyle(2, 0xffffff, 0.3);
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8);
    });

    // 点击
    bg.on('pointerdown', () => {
      this.hide();
      this.callbacks.onTypeSelect(item.type);
    });

    // 图标
    const icon = this.scene.add.text(0, -12, item.icon, {
      fontSize: '28px',
    }).setOrigin(0.5);

    // 名称
    const name = this.scene.add.text(0, 20, item.name, {
      fontSize: '13px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    btn.add([bg, icon, name]);
    return btn;
  }

  destroy(): void {
    if (this.escHandler && this.scene.input.keyboard) {
      this.scene.input.keyboard.off('keydown-ESC', this.escHandler);
      this.escHandler = null;
    }
    this.container?.destroy();
  }
}
