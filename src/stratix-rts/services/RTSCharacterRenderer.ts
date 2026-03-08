import Phaser from 'phaser';
import type { StratixAgentConfig, BodyType } from '@/stratix-core/stratix-protocol';
import { textureLoadQueue, TextureLoadTask } from './TextureLoadQueue';
import { baseBodyTextureManager } from './BaseBodyTextureManager';
import { textureManager } from '@/stratix-core/services';
import { FRAME_SIZE, ANIMATION_OFFSETS, ANIMATION_CONFIGS, ANIMATION_FRAMERATES, CORE_RTS_ANIMATIONS } from '@/stratix-character-creator/constants';

const SCALE = 0.75;

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
    if (!config.profile) {
      return { type: 'fallback', textureKey: 'stratix-agent' };
    }

    await this.initialize();

    const character = config.profile;
    const characterId = character.characterId;
    const textureKey = `char-${characterId}`;

    if (this.loadedTextures.has(textureKey)) {
      return { type: 'ready', textureKey };
    }

    const cachedCanvas = textureManager.getCachedCanvas(characterId);
    if (cachedCanvas) {
      console.log(`[RTSCharacterRenderer] 📦 Using cached canvas for ${characterId}`);
      this.scene.textures.addCanvas(textureKey, cachedCanvas);
      this.createAnimationFrames(textureKey, cachedCanvas);
      this.loadedTextures.add(textureKey);
      return { type: 'ready', textureKey };
    }

    const textureUrl = await textureManager.ensureTexture(character);
    if (textureUrl) {
      const canvas = textureManager.getCachedCanvas(characterId);
      if (canvas) {
        console.log(`[RTSCharacterRenderer] 🎨 Canvas generated and cached for ${characterId}`);
        this.scene.textures.addCanvas(textureKey, canvas);
        this.createAnimationFrames(textureKey, canvas);
        this.loadedTextures.add(textureKey);
        return { type: 'ready', textureKey };
      }
      
      try {
        console.log(`[RTSCharacterRenderer] 🌐 Loading from URL for ${characterId}`);
        await this.loadTextureFromUrl(textureKey, textureUrl);
        this.loadedTextures.add(textureKey);
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
        const texture = this.scene.textures.get(key);
        if (texture) {
          this.createAnimationFramesFromTexture(key, texture);
        }
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
    if (this.scene.textures.exists(key)) {
      this.scene.textures.remove(key);
    }
    
    this.scene.textures.addCanvas(key, canvas);
    const texture = this.scene.textures.get(key);
    if (!texture) return;

    const frameWidth = FRAME_SIZE;
    const frameHeight = FRAME_SIZE;

    for (const animKey of CORE_RTS_ANIMATIONS) {
      const animConfig = ANIMATION_CONFIGS[animKey];
      const yPos = ANIMATION_OFFSETS[animKey];
      if (yPos === undefined || !animConfig) continue;

      const frameRate = ANIMATION_FRAMERATES[animKey] || 8;
      const uniqueFrameIndexes = [...new Set(animConfig.cycle)];

      for (let direction = 0; direction < 4; direction++) {
        for (const frameIndex of uniqueFrameIndexes) {
          const frameName = `${animKey}_${direction}_${frameIndex}`;
          texture.add(
            frameName,
            0,
            frameIndex * frameWidth,
            yPos + direction * frameHeight,
            frameWidth,
            frameHeight
          );
        }

        const frames: Phaser.Types.Animations.AnimationFrame[] = [];
        for (const frameIndex of animConfig.cycle) {
          const frameName = `${animKey}_${direction}_${frameIndex}`;
          frames.push({ key: key, frame: frameName });
        }

        const animKeyName = `${key}_${animKey}_${direction}`;
        
        if (!this.scene.anims.exists(animKeyName)) {
          this.scene.anims.create({
            key: animKeyName,
            frames,
            frameRate: frameRate,
            repeat: -1
          });
        }
      }
    }
  }

  private createAnimationFramesFromTexture(key: string, texture: Phaser.Textures.Texture): void {
    const frameWidth = FRAME_SIZE;
    const frameHeight = FRAME_SIZE;

    for (const animKey of CORE_RTS_ANIMATIONS) {
      const animConfig = ANIMATION_CONFIGS[animKey];
      const yPos = ANIMATION_OFFSETS[animKey];
      if (yPos === undefined || !animConfig) continue;

      const frameRate = ANIMATION_FRAMERATES[animKey] || 8;
      const uniqueFrameIndexes = [...new Set(animConfig.cycle)];

      for (let direction = 0; direction < 4; direction++) {
        for (const frameIndex of uniqueFrameIndexes) {
          const frameName = `${animKey}_${direction}_${frameIndex}`;
          texture.add(
            frameName,
            0,
            frameIndex * frameWidth,
            yPos + direction * frameHeight,
            frameWidth,
            frameHeight
          );
        }

        const frames: Phaser.Types.Animations.AnimationFrame[] = [];
        for (const frameIndex of animConfig.cycle) {
          const frameName = `${animKey}_${direction}_${frameIndex}`;
          frames.push({ key: key, frame: frameName });
        }

        const animKeyName = `${key}_${animKey}_${direction}`;
        
        if (!this.scene.anims.exists(animKeyName)) {
          this.scene.anims.create({
            key: animKeyName,
            frames,
            frameRate: frameRate,
            repeat: -1
          });
        }
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
