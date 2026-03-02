/**
 * (Migrated)
 * ButtonGroup - 操作按钮组
 * 提供随机生成、保存、返回等操作按钮
 */

import Phaser from 'phaser';
import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';

export interface ButtonConfig {
  text: string;
  color?: number;
  hoverColor?: number;
  icon?: string;
  callback: () => void;
}

export interface ButtonGroupConfig {
  x: number;
  y: number;
  buttons: ButtonConfig[];
  direction?: 'horizontal' | 'vertical';
  spacing?: number;
}

class StyledButton {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private background: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private config: ButtonConfig;
  private width: number = 120;
  private height: number = 40;

  constructor(scene: Phaser.Scene, x: number, y: number, config: ButtonConfig) {
    this.scene = scene;
    this.config = config;
    this.container = scene.add.container(x, y).setDepth(Depth.UI_MODAL_CONTENT);

    this.background = scene.add.rectangle(0, 0, this.width, this.height, config.color ?? parseInt(getToken('colors.background.secondary').replace('#', '0x')))
      .setInteractive({ useHandCursor: true });

    this.text = scene.add.text(0, 0, config.text, {
      fontSize: '14px',
      color: getToken('colors.text.primary'),
      fontStyle: 'bold'
    }).setOrigin(0.5);

    this.container.add([this.background, this.text]);
    this.setupEvents();
  }

  private setupEvents(): void {
    const color = this.config.color ?? parseInt(getToken('colors.background.secondary').replace('#', '0x'));
    const hoverColor = this.config.hoverColor ?? parseInt(getToken('colors.background.primary').replace('#', '0x'));

    this.background.on('pointerover', () => {
      this.background.setFillStyle(hoverColor);
    });

    this.background.on('pointerout', () => {
      this.background.setFillStyle(color);
    });

    this.background.on('pointerdown', () => {
      this.background.setFillStyle(hoverColor);
      this.config.callback();
    });

    this.background.on('pointerup', () => {
      this.background.setFillStyle(hoverColor);
    });
  }

  setEnabled(enabled: boolean): void {
    this.background.setInteractive({ useHandCursor: enabled });
    this.text.setAlpha(enabled ? 1 : 0.5);
  }

  setText(text: string): void {
    this.text.setText(text);
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  destroy(): void {
    this.container.destroy();
  }
}

export class ButtonGroup {
  private scene: Phaser.Scene;
  private config: ButtonGroupConfig;
  private buttons: StyledButton[] = [];
  private container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, config: ButtonGroupConfig) {
    this.scene = scene;
    this.config = config;
    this.container = scene.add.container(config.x, config.y).setDepth(Depth.UI_MODAL_CONTENT);
    this.createButtons();
  }

  private createButtons(): void {
    const spacing = this.config.spacing ?? 10;
    const direction = this.config.direction ?? 'vertical';

    this.config.buttons.forEach((btnConfig, index) => {
      const offset = index * (40 + spacing);
      const x = direction === 'horizontal' ? offset : 0;
      const y = direction === 'vertical' ? offset : 0;

      const button = new StyledButton(this.scene, x, y, btnConfig);
      this.buttons.push(button);
      this.container.add(button.getContainer());
    });
  }

  setButtonEnabled(index: number, enabled: boolean): void {
    if (this.buttons[index]) {
      this.buttons[index].setEnabled(enabled);
    }
  }

  setButtonText(index: number, text: string): void {
    if (this.buttons[index]) {
      this.buttons[index].setText(text);
    }
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  destroy(): void {
    this.buttons.forEach(btn => btn.destroy());
    this.container.destroy();
  }
}

export { StyledButton };
