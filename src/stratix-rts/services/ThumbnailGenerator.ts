import Phaser from 'phaser';

const TYPE_COLORS: Record<string, number> = {
  writer: 0x4A90E2,
  dev: 0x9B59B6,
  analyst: 0xE67E22,
  custom: 0x00ffff
};

export class ThumbnailGenerator {
  private static instance: ThumbnailGenerator;
  private scene: Phaser.Scene | null = null;
  private loadedThumbnails: Set<string> = new Set();

  static getInstance(): ThumbnailGenerator {
    if (!ThumbnailGenerator.instance) {
      ThumbnailGenerator.instance = new ThumbnailGenerator();
    }
    return ThumbnailGenerator.instance;
  }

  initialize(scene: Phaser.Scene): void {
    this.scene = scene;
    this.generateTypeThumbnails();
  }

  private generateTypeThumbnails(): void {
    if (!this.scene) return;

    Object.entries(TYPE_COLORS).forEach(([type, color]) => {
      const textureKey = `type-${type}-thumbnail`;
      
      if (this.scene!.textures.exists(textureKey)) {
        this.loadedThumbnails.add(textureKey);
        return;
      }

      const graphics = this.scene!.make.graphics();
      graphics.fillStyle(color, 1);
      graphics.fillCircle(16, 16, 14);
      graphics.lineStyle(2, 0xffffff, 0.5);
      graphics.strokeCircle(16, 16, 14);
      graphics.generateTexture(textureKey, 32, 32);
      graphics.destroy();

      this.loadedThumbnails.add(textureKey);
    });
  }

  async loadCharacterThumbnail(
    thumbnail: string,
    agentId: string
  ): Promise<string> {
    if (!this.scene) {
      throw new Error('ThumbnailGenerator not initialized');
    }

    const textureKey = `thumbnail-${agentId}`;

    if (this.scene.textures.exists(textureKey)) {
      return textureKey;
    }

    if (this.loadedThumbnails.has(textureKey)) {
      return textureKey;
    }

    try {
      if (thumbnail.startsWith('data:')) {
        await this.loadBase64Thumbnail(textureKey, thumbnail);
      } else {
        await this.loadUrlThumbnail(textureKey, thumbnail);
      }

      this.loadedThumbnails.add(textureKey);
      return textureKey;
    } catch (error) {
      console.warn(`[ThumbnailGenerator] Failed to load thumbnail for ${agentId}, using fallback`);
      return this.getFallbackThumbnail('custom');
    }
  }

  private loadBase64Thumbnail(textureKey: string, base64: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.scene) {
        reject(new Error('Scene not initialized'));
        return;
      }

      if (this.scene.textures.exists(textureKey)) {
        resolve();
        return;
      }

      try {
        const img = new Image();
        img.onload = () => {
          if (this.scene!.textures.exists(textureKey)) {
            resolve();
            return;
          }
          const texture = this.scene!.textures.addBase64(textureKey, base64);
          
          this.scene!.time.delayedCall(100, () => {
            if (texture) {
              resolve();
            } else {
              reject(new Error('Failed to create texture'));
            }
          });
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = base64;
      } catch (error) {
        reject(error);
      }
    });
  }

  private loadUrlThumbnail(textureKey: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.scene) {
        reject(new Error('Scene not initialized'));
        return;
      }

      this.scene!.load.image(textureKey, url);
      
      this.scene!.load.once(`filecomplete-image-${textureKey}`, () => {
        resolve();
      });
      
      this.scene!.load.once(`loaderror-image-${textureKey}`, () => {
        reject(new Error(`Failed to load thumbnail: ${url}`));
      });
      
      this.scene!.load.start();
    });
  }

  getFallbackThumbnail(type: string): string {
    const typeKey = TYPE_COLORS[type as keyof typeof TYPE_COLORS] ? type : 'custom';
    return `type-${typeKey}-thumbnail`;
  }

  hasThumbnail(textureKey: string): boolean {
    return this.loadedThumbnails.has(textureKey);
  }

  clear(): void {
    this.loadedThumbnails.clear();
    this.scene = null;
  }
}

export const thumbnailGenerator = ThumbnailGenerator.getInstance();
