/**
 * CanvasPreviewScene - 独立的角色预览Phaser场景
 * 用于 CharacterCreatorModalV2 局部嵌入
 */

import Phaser from 'phaser';
import {
  FRAME_SIZE,
  FRAMES_PER_ROW,
  ANIMATION_CONFIGS,
  LOGICAL_TO_LPC,
  LPC_DIRECTION_ROWS,
} from '../stratix-character-creator/constants';
import type { AnimationName } from '../stratix-character-creator/types';

const getPhaserColor = (tokenPath: string) => {
  const value = getComputedStyle(document.documentElement).getPropertyValue(tokenPath).trim();
  return parseInt(value.replace('#', '0x'));
};

const getToken = (path: string): string => {
  return getComputedStyle(document.documentElement).getPropertyValue(path).trim() || '#000000';
};

export class CanvasPreviewScene extends Phaser.Scene {
  private sprite: Phaser.GameObjects.Sprite | null = null;
  private currentAnimation: AnimationName = 'idle';
  private currentDirection: number = 2;
  private currentScale: number = 2;
  private textureKey: string = '';
  private animationKey: string = '';
  private createdFrameKeys: string[] = [];

  constructor() {
    super({ key: 'CanvasPreviewScene' });
  }

  create(): void {
    // Background
    this.cameras.main.setBackgroundColor(getPhaserColor('--ds-bg-tertiary'));

    // Listen for texture updates from parent
    this.events.on('texture:updated', (textureKey: string) => {
      this.setTexture(textureKey);
    });

    // Listen for animation/direction changes
    this.events.on('animation:change', (anim: AnimationName) => {
      this.setAnimation(anim);
    });

    this.events.on('direction:change', (dir: number) => {
      this.setDirection(dir);
    });

    this.events.on('scale:change', (scale: number) => {
      this.setScale(scale);
    });

    // Create placeholder sprite
    this.createPlaceholder();
  }

  private createPlaceholder(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(getPhaserColor('--ds-bg-secondary'), 1);
    graphics.fillRect(0, 0, 200, 200);
    graphics.lineStyle(2, getPhaserColor('--ds-border'), 1);
    graphics.strokeRect(0, 0, 200, 200);

    const text = this.add.text(100, 100, 'Loading...', {
      fontSize: '14px',
      color: '#888888',
    });
    text.setOrigin(0.5, 0.5);
  }

  setTexture(textureKey: string): void {
    this.cleanupFrameTextures();
    this.textureKey = textureKey;
    this.createAnimation();
  }

  private cleanupFrameTextures(): void {
    for (const key of this.createdFrameKeys) {
      if (this.textures.exists(key)) {
        this.textures.remove(key);
      }
    }
    this.createdFrameKeys = [];

    if (this.animationKey && this.anims.exists(this.animationKey)) {
      this.anims.remove(this.animationKey);
    }
  }

  private createAnimation(): void {
    if (!this.textureKey || !this.textures.exists(this.textureKey)) {
      console.warn(`[CanvasPreview] Texture not found: ${this.textureKey}`);
      return;
    }

    if (this.sprite) {
      this.sprite.destroy();
      this.sprite = null;
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

    const texture = this.textures.get(this.textureKey);

    if (!(texture instanceof Phaser.Textures.CanvasTexture)) {
      console.warn(`[CanvasPreview] Texture is not CanvasTexture`);
      this.createSpriteFromFrames(frameIndexes);
      return;
    }

    this.animationKey = `anim_${this.textureKey}_${this.currentAnimation}_${this.currentDirection}`;

    const frames: Phaser.Types.Animations.AnimationFrame[] = frameIndexes.map((frameIndex) => {
      const frameName = `${this.textureKey}_${frameIndex}`;

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
        if (this.textures.exists(frameName)) {
          this.textures.remove(frameName);
        }
        this.textures.addCanvas(frameName, frameCanvas);
        this.createdFrameKeys.push(frameName);
      }

      return { key: frameName, frame: 0, duration: 100 };
    });

    if (frames.length > 0) {
      this.anims.create({
        key: this.animationKey,
        frames: frames,
        frameRate: 8,
        repeat: -1,
      });

      const firstFrameKey = frames[0].key as string;
      this.sprite = this.add.sprite(
        this.cameras.main.centerX,
        this.cameras.main.centerY,
        firstFrameKey
      );
      this.sprite.setScale(this.currentScale);
      this.sprite.setOrigin(0.5, 0.5);
      this.sprite.play(this.animationKey);
    }
  }

  private createSpriteFromFrames(frameIndexes: number[]): void {
    if (frameIndexes.length === 0) return;

    const firstFrame = frameIndexes[0];
    const frameKey = `${this.textureKey}_frame_${firstFrame}`;

    if (!this.textures.exists(frameKey)) {
      const frameCanvas = document.createElement('canvas');
      frameCanvas.width = FRAME_SIZE;
      frameCanvas.height = FRAME_SIZE;
      const ctx = frameCanvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = getToken('--ds-bg-tertiary');
        ctx.fillRect(0, 0, FRAME_SIZE, FRAME_SIZE);
        this.textures.addCanvas(frameKey, frameCanvas);
      }
    }

    this.sprite = this.add.sprite(
      this.cameras.main.centerX,
      this.cameras.main.centerY,
      frameKey
    );
    this.sprite.setScale(this.currentScale);
    this.sprite.setOrigin(0.5, 0.5);
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

  getCurrentAnimation(): AnimationName {
    return this.currentAnimation;
  }

  getCurrentDirection(): number {
    return this.currentDirection;
  }

  getCurrentScale(): number {
    return this.currentScale;
  }

  updateTextureFromCanvas(canvas: HTMLCanvasElement): void {
    const key = `char_canvas_${Date.now()}`;
    if (this.textures.exists(key)) {
      this.textures.remove(key);
    }
    this.textures.addCanvas(key, canvas);
    this.setTexture(key);
  }

  resize(width: number, height: number): void {
    this.cameras.main.setSize(width, height);
  }
}
