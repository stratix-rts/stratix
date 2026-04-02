/**
 * (Migrated)
 * CharacterPreview - 角色预览组件
 * 使用 Phaser Spritesheet 播放 LPC 动画
 */

import Phaser from 'phaser';

import { 
  FRAME_SIZE, 
  SHEET_WIDTH, 
  SHEET_HEIGHT, 
  FRAMES_PER_ROW, 
  ANIMATION_CONFIGS,
  LOGICAL_TO_LPC,
  LPC_DIRECTION_ROWS
} from '../constants';
import type { AnimationName } from '../types';

import { getToken } from '@/design-system/config';
import { Depth } from '@/design-system/tokens/depth';

// Phaser 图形对象使用数字颜色（运行时获取）
const getPhaserColor = (tokenPath: string) => parseInt(getToken(tokenPath).replace('#', '0x'));

// DOM 样式使用 CSS 变量
const THEME = {
  bg: () => getPhaserColor('colors.background.tertiary'),
  border: () => getPhaserColor('colors.border.default'),
  accent: () => getPhaserColor('colors.primary'),
  text: 'var(--ds-text-primary)',
  textMuted: 'var(--ds-text-muted)'
};

export interface CharacterPreviewConfig {
  x: number;
  y: number;
  size: number;
  scale?: number;
}

export class CharacterPreview {
  private scene: Phaser.Scene;
  private config: CharacterPreviewConfig;
  private container: Phaser.GameObjects.Container;
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private currentAnimation: AnimationName = 'idle';
  private currentDirection: number = 2;  // 默认朝下 (DOWN)
  private currentScale: number;
  private textureKey: string = '';
  private animationKey: string = '';
  private createdFrameKeys: string[] = [];

  constructor(scene: Phaser.Scene, config: CharacterPreviewConfig) {
    this.scene = scene;
    this.config = config;
    this.currentScale = config.scale ?? 2;

    this.container = scene.add.container(config.x, config.y).setDepth(Depth.UI_MODAL_CONTENT);
  }

  setTexture(textureKey: string): void {
    this.cleanupFrameTextures();
    this.textureKey = textureKey;
    this.createAnimation();
  }

  private cleanupFrameTextures(): void {
    for (const key of this.createdFrameKeys) {
      if (this.scene.textures.exists(key)) {
        this.scene.textures.remove(key);
      }
    }
    this.createdFrameKeys = [];
  }

  private createAnimation(): void {
    if (!this.textureKey || !this.scene.textures.exists(this.textureKey)) {
      console.warn(`[CharacterPreview] Texture not found: ${this.textureKey}`);
      return;
    }

    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
    }

    if (this.animationKey && this.scene.anims.exists(this.animationKey)) {
      this.scene.anims.remove(this.animationKey);
    }

    const animConfig = ANIMATION_CONFIGS[this.currentAnimation];
    if (!animConfig) {
      console.warn(`No animation config for: ${this.currentAnimation}`);
      return;
    }

    const { row, cycle } = animConfig;
    const lpcRow = LOGICAL_TO_LPC[this.currentDirection] ?? LPC_DIRECTION_ROWS.DOWN;
    const dirRow = row + lpcRow;

    const frameIndexes = cycle.map(col => dirRow * FRAMES_PER_ROW + col);

    const texture = this.scene.textures.get(this.textureKey);
    
    if (!texture || !(texture instanceof Phaser.Textures.CanvasTexture)) {
      console.warn(`[CharacterPreview] Texture is not CanvasTexture`);
      this.createSpriteFromFrames(frameIndexes);
      return;
    }

    this.animationKey = `anim_${this.textureKey}_${this.currentAnimation}_${this.currentDirection}_${Date.now()}`;

    const frames: Phaser.Types.Animations.AnimationFrame[] = frameIndexes.map((frameIndex, i) => {
      const frameName = `${this.textureKey}_${frameIndex}_${Date.now()}`;
      
      const srcX = (frameIndex % FRAMES_PER_ROW) * FRAME_SIZE;
      const srcY = Math.floor(frameIndex / FRAMES_PER_ROW) * FRAME_SIZE;
      
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = FRAME_SIZE;
      frameCanvas.height = FRAME_SIZE;
      const ctx = frameCanvas.getContext('2d');
      if (ctx && texture.canvas) {
        ctx.drawImage(
          texture.canvas,
          srcX, srcY, FRAME_SIZE, FRAME_SIZE,
          0, 0, FRAME_SIZE, FRAME_SIZE
        );
        this.scene.textures.addCanvas(frameName, frameCanvas);
        this.createdFrameKeys.push(frameName);
      }
      
      return { key: frameName, frame: 0, duration: 100 };
    });

    if (frames.length > 0) {
      this.scene.anims.create({
        key: this.animationKey,
        frames: frames,
        frameRate: 8,
        repeat: -1
      });

      const firstFrameKey = frames[0].key as string;
      this.sprite = this.scene.add.sprite(0, 0, firstFrameKey);
      this.sprite.setScale(this.currentScale);
      this.sprite.setOrigin(0.5, 0.5);
      this.container.add(this.sprite);
      
      this.sprite.play(this.animationKey);
      console.log(`[CharacterPreview] Animation created: ${this.animationKey}`);
    }
  }

  private createSpriteFromFrames(frameIndexes: number[]): void {
    if (frameIndexes.length === 0) return;
    
    const firstFrame = frameIndexes[0];
    const srcX = (firstFrame % FRAMES_PER_ROW) * FRAME_SIZE;
    const srcY = Math.floor(firstFrame / FRAMES_PER_ROW) * FRAME_SIZE;
    
    const frameKey = `${this.textureKey}_frame_${firstFrame}`;
    
    if (!this.scene.textures.exists(frameKey)) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = FRAME_SIZE;
      frameCanvas.height = FRAME_SIZE;
      const ctx = frameCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = getToken('colors.background.tertiary');
        ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
        this.scene.textures.addCanvas(frameKey, frameCanvas);
      }
    }
    
    this.sprite = this.scene.add.sprite(0, 0, frameKey);
    this.sprite.setScale(this.currentScale);
    this.container.add(this.sprite);
  }

  setAnimation(animation: AnimationName): void {
    if (this.currentAnimation === animation) return;
    this.currentAnimation = animation;
    this.createAnimation();
  }

  setDirection(direction: number): void {
    if (this.currentDirection === direction) return;
    this.currentDirection = Math.max(0, Math.min(3, direction));
    this.createAnimation();
  }

  cycleDirection(): number {
    this.currentDirection = (this.currentDirection + 1) % 4;
    this.createAnimation();
    return this.currentDirection;
  }

  setScale(scale: number): void {
    this.currentScale = Math.max(0.5, Math.min(4, scale));
    if (this.sprite) {
      this.sprite.setScale(this.currentScale);
    }
  }

  zoomIn(): void {
    this.setScale(this.currentScale + 0.5);
  }

  zoomOut(): void {
    this.setScale(this.currentScale - 0.5);
  }

  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  getCurrentAnimation(): AnimationName {
    return this.currentAnimation;
  }

  getCurrentDirection(): number {
    return this.currentDirection;
  }

  getCurrentScale(): number {
    return this.currentScale;
  }

  destroy(): void {
    this.cleanupFrameTextures();
    this.sprite?.destroy();
    this.container.destroy();
  }
}
