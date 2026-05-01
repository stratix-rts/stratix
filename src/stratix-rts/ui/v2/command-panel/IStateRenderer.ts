import Phaser from 'phaser';
import type { PanelData } from './types';

export interface IStateRenderer {
  render(container: Phaser.GameObjects.Container, data: PanelData, contentWidth: number): Phaser.Tweens.Tween[];
  destroy(): void;
}
