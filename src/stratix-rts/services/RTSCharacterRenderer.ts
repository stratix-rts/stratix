import Phaser from 'phaser';
import type { StratixAgentConfig, BodyType } from '@/stratix-core/stratix-protocol';
import { textureLoadQueue, TextureLoadTask } from './TextureLoadQueue';
import { baseBodyTextureManager } from './BaseBodyTextureManager';
import { textureManager } from '@/stratix-core/services';
import { FRAME_SIZE, ANIMATION_OFFSETS } from '@/stratix-character-creator/constants';

const SCALE = 0.75;

interface AnimationConfig {
  key: string;
  row: number;
  frames: number;
  frameRate: number;
}

const RTS_ANIMATION_CONFIGS: AnimationConfig[] = [
  { key: 'idle', row: 22, frames: 4, frameRate: 4 },
  { key: 'walk', row: 8, frames: 8, frameRate: 8 },
  { key: 'run', row: 38, frames: 8, frameRate: 10 }
];

export type TextureLoadResult = 
  | { type: 'ready'; textureKey: string }
  | { type: 'placeholder'; textureKey: string; characterId: string }
  | { type: 'fallback'; textureKey: string };

export type TextureReadyCallback = (characterId: string, textureKey: string) => void;

class RTSCharacterRenderer {
  private scene: Phaser.Scene;
  private loadedTextures: Set<string> = new Set();
  private pendingCallbacks: Map<string, Set<TextureReadyCallback>> = new Map();
  private initialized: boolean = false;
  private initPromise: Promise<void> | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize(): Promise<void> {
    await baseBodyTextureManager.initialize(this.scene);
    
    textureLoadQueue.on('taskComplete', ({ taskId, canvas }: { taskId: string; canvas: HTMLCanvasElement }) => {
      this.onTextureGenerated(taskId, canvas);
    });

    this.initialized = true;
  }

  async loadCharacterTexture(
    config: StratixAgentConfig,
    onTextureReady?: TextureReadyCallback
  ): Promise<TextureLoadResult> {
    if (!config.character) {
      return { type: 'fallback', textureKey: 'stratix-agent' };
    }

    await this.initialize();

    const character = config.character;
    const characterId = character.characterId;
    const textureKey = `char-${characterId}`;

    if (this.loadedTextures.has(textureKey)) {
      return { type: 'ready', textureKey };
    }

    const textureUrl = await textureManager.ensureTexture(character);
    if (textureUrl) {
      try {
        await this.loadTextureFromUrl(textureKey, textureUrl);
        this.loadedTextures.add(textureKey);
        
        const canvas = textureManager.getCachedCanvas(characterId);
        if (canvas) {
          this.createAnimationFrames(textureKey, canvas);
        }
        
        return { type: 'ready', textureKey };
      } catch (error) {
        console.warn(`[RTSCharacterRenderer] Failed to load texture from URL:`, error);
      }
    }

    if (textureLoadQueue.isCompleted(characterId)) {
      const canvas = textureLoadQueue.getCompleted(characterId);
      if (canvas) {
        this.scene.textures.addCanvas(textureKey, canvas);
        this.createAnimationFrames(textureKey, canvas);
        this.loadedTextures.add(textureKey);
        return { type: 'ready', textureKey };
      }
    }

    const baseBodyKey = baseBodyTextureManager.getBaseBodyTextureKey(character.bodyType as BodyType);
    
    if (onTextureReady) {
      this.addPendingCallback(characterId, onTextureReady);
    }

    textureLoadQueue.enqueue(config, 5, {
      onComplete: (canvas) => {
        // Handled via event
      },
      onError: (error) => {
        console.error(`[RTSCharacterRenderer] Failed to generate texture for ${characterId}:`, error);
      }
    });

    if (baseBodyKey) {
      return { type: 'placeholder', textureKey: baseBodyKey, characterId };
    }

    return { type: 'fallback', textureKey: 'stratix-agent' };
  }

  private addPendingCallback(characterId: string, callback: TextureReadyCallback): void {
    if (!this.pendingCallbacks.has(characterId)) {
      this.pendingCallbacks.set(characterId, new Set());
    }
    this.pendingCallbacks.get(characterId)!.add(callback);
  }

  private onTextureGenerated(characterId: string, canvas: HTMLCanvasElement): void {
    const textureKey = `char-${characterId}`;

    if (this.scene.textures.exists(textureKey)) {
      this.scene.textures.remove(textureKey);
    }

    this.scene.textures.addCanvas(textureKey, canvas);
    this.createAnimationFrames(textureKey, canvas);
    this.loadedTextures.add(textureKey);

    const callbacks = this.pendingCallbacks.get(characterId);
    if (callbacks) {
      callbacks.forEach(callback => callback(characterId, textureKey));
      this.pendingCallbacks.delete(characterId);
    }
  }

  private loadTextureFromUrl(key: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.scene.textures.exists(key)) {
        resolve();
        return;
      }

      this.scene.load.image(key, url);
      this.scene.load.once(`filecomplete-image-${key}`, () => {
        const texture = this.scene.textures.get(key);
        if (texture) {
          this.createAnimationFramesFromTexture(key, texture);
        }
        resolve();
      });
      this.scene.load.once(`loaderror-image-${key}`, () => {
        reject(new Error(`Failed to load texture: ${url}`));
      });
      this.scene.load.start();
    });
  }

  private createAnimationFrames(key: string, canvas: HTMLCanvasElement): void {
    const frameWidth = FRAME_SIZE;
    const frameHeight = FRAME_SIZE;

    for (const animConfig of RTS_ANIMATION_CONFIGS) {
      const yPos = ANIMATION_OFFSETS[animConfig.key];
      if (yPos === undefined) continue;

      for (let direction = 0; direction < 4; direction++) {
        const frameNames: string[] = [];
        
        for (let f = 0; f < animConfig.frames; f++) {
          const frameKey = `${key}_${animConfig.key}_${direction}_${f}`;
          const frameCanvas = document.createElement('canvas');
          frameCanvas.width = frameWidth;
          frameCanvas.height = frameHeight;
          
          const ctx = frameCanvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(
              canvas,
              f * frameWidth,
              yPos + direction * frameHeight,
              frameWidth,
              frameHeight,
              0, 0,
              frameWidth,
              frameHeight
            );
          }
          
          if (!this.scene.textures.exists(frameKey)) {
            this.scene.textures.addCanvas(frameKey, frameCanvas);
          }
          frameNames.push(frameKey);
        }

        const animKey = `${key}_${animConfig.key}_${direction}`;
        
        if (!this.scene.anims.exists(animKey)) {
          this.scene.anims.create({
            key: animKey,
            frames: frameNames.map((frameName) => ({
              key,
              frame: frameName
            })),
            frameRate: animConfig.frameRate,
            repeat: -1
          });
        }
      }
    }
  }

  private createAnimationFramesFromTexture(key: string, texture: Phaser.Textures.Texture): void {
    const frameWidth = FRAME_SIZE;
    const frameHeight = FRAME_SIZE;

    for (const animConfig of RTS_ANIMATION_CONFIGS) {
      const yPos = ANIMATION_OFFSETS[animConfig.key];
      if (yPos === undefined) continue;

      for (let direction = 0; direction < 4; direction++) {
        const animKey = `${key}_${animConfig.key}_${direction}`;
        
        if (this.scene.anims.exists(animKey)) continue;

        const frames: Phaser.Types.Animations.AnimationFrame[] = [];
        
        for (let f = 0; f < animConfig.frames; f++) {
          const frameName = `${animConfig.key}_${direction}_${f}`;
          texture.add(
            frameName,
            0,
            f * frameWidth,
            yPos + direction * frameHeight,
            frameWidth,
            frameHeight
          );
          frames.push({ key, frame: frameName });
        }

        this.scene.anims.create({
          key: animKey,
          frames,
          frameRate: animConfig.frameRate,
          repeat: -1
        });
      }
    }
  }

  getAnimationKey(textureKey: string, animation: string, direction: number): string {
    return `${textureKey}_${animation}_${direction}`;
  }

  getScale(): number {
    return SCALE;
  }

  isLoaded(textureKey: string): boolean {
    return this.loadedTextures.has(textureKey);
  }

  clear(): void {
    this.loadedTextures.clear();
    this.pendingCallbacks.clear();
  }

  getQueueStats(): { pending: number; running: number } {
    return {
      pending: textureLoadQueue.getQueueLength(),
      running: textureLoadQueue.getRunningCount()
    };
  }
}

export default RTSCharacterRenderer;
