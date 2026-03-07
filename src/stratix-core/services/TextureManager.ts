/**
 * 纹理管理器 - 统一业务层
 * 
 * 职责：
 * 1. 生成雪碧图（Canvas）
 * 2. 生成头像（Thumbnail）
 * 3. 上传纹理到存储层（跨平台）
 * 4. 管理纹理缓存（LRU 策略）
 * 5. 防止并发重复上传
 */

import { services } from './ServiceLocator';
import { characterComposer } from '@/stratix-character-creator/core/CharacterComposer';
import { ALL_ANIMATIONS } from '@/stratix-character-creator/constants';
import type { CharacterData, CharacterTexture } from '@/stratix-core/stratix-protocol';

interface CacheEntry {
  canvas: HTMLCanvasElement;
  lastAccess: number;
  accessCount: number;
}

class TextureManager {
  private canvasCache: Map<string, CacheEntry> = new Map();
  private uploadPromises: Map<string, Promise<CharacterTexture | null>> = new Map();
  
  private readonly MAX_CACHE_SIZE = 20;

  /**
   * 生成并上传纹理（自动防重复）
   */
  async generateAndUploadTexture(
    characterData: CharacterData,
    options?: { force?: boolean }
  ): Promise<CharacterTexture | null> {
    const characterId = characterData.characterId;

    // 1. 检查是否已有相同的上传任务在进行（防重复）
    if (this.uploadPromises.has(characterId)) {
      console.log(`[TextureManager] Waiting for existing upload: ${characterId}`);
      return this.uploadPromises.get(characterId)!;
    }

    // 2. 检查服务器缓存
    if (!options?.force && characterData.texture?.filePath) {
      const { exists } = await services.checkTexture(characterData.texture.filePath);
      if (exists) {
        console.log(`[TextureManager] Using server cache: ${characterId}`);
        return characterData.texture;
      }
    }

    // 3. 检查内存缓存
    const cached = this.getCachedCanvas(characterId);
    if (cached && !options?.force) {
      console.log(`[TextureManager] Using memory cache: ${characterId}`);
      
      const uploadPromise = this.executeUpload(characterData, cached);
      this.uploadPromises.set(characterId, uploadPromise);
      
      try {
        const texture = await uploadPromise;
        return texture;
      } finally {
        this.uploadPromises.delete(characterId);
      }
    }

    // 4. 生成新的纹理
    const generatePromise = (async () => {
      try {
        const result = await characterComposer.composeCharacter(
          characterData.parts,
          {
            bodyType: characterData.bodyType as any,
            animations: ALL_ANIMATIONS
          }
        );

        const canvas = result.canvas;
        
        this.addToCache(characterId, canvas);
        
        const texture = await this.executeUpload(characterData, canvas);
        
        return texture;
      } catch (error) {
        console.error('[TextureManager] Failed to generate texture:', error);
        return null;
      } finally {
        this.uploadPromises.delete(characterId);
      }
    })();

    this.uploadPromises.set(characterId, generatePromise);
    
    return generatePromise;
  }

  /**
   * 确保纹理可用（优先使用缓存）
   */
  async ensureTexture(characterData: CharacterData): Promise<string | null> {
    if (characterData.texture?.filePath) {
      const { exists, url } = await services.checkTexture(characterData.texture.filePath);
      if (exists && url) {
        return url;
      }
    }

    const texture = await this.generateAndUploadTexture(characterData);
    if (texture) {
      return services.getTextureUrl(texture.filePath);
    }

    return null;
  }

  /**
   * 生成头像
   */
  generateThumbnail(canvas: HTMLCanvasElement, size: number = 128): string {
    return characterComposer.generateThumbnail(canvas, size);
  }

  /**
   * 删除纹理
   */
  async deleteTexture(characterData: CharacterData): Promise<void> {
    if (!characterData.texture?.filePath) return;

    try {
      await services.deleteTexture(characterData.texture.filePath);
      this.canvasCache.delete(characterData.characterId);
      console.log(`[TextureManager] Texture deleted: ${characterData.texture.filePath}`);
    } catch (error) {
      console.warn('[TextureManager] Failed to delete texture:', error);
    }
  }

  /**
   * 获取缓存的 Canvas（自动 LRU 更新）
   */
  getCachedCanvas(characterId: string): HTMLCanvasElement | undefined {
    const cached = this.canvasCache.get(characterId);
    
    if (cached) {
      cached.lastAccess = Date.now();
      cached.accessCount++;
      return cached.canvas;
    }
    
    return undefined;
  }

  /**
   * 执行上传
   */
  private async executeUpload(
    characterData: CharacterData,
    canvas: HTMLCanvasElement
  ): Promise<CharacterTexture | null> {
    try {
      const imageData = canvas.toDataURL('image/png');
      const filename = `${characterData.characterId}.png`;

      const texture = await services.uploadTexture(
        characterData.characterId,
        imageData,
        filename
      );

      console.log(`[TextureManager] Texture uploaded: ${texture.filePath}`);
      return texture;

    } catch (error) {
      console.error('[TextureManager] Upload failed:', error);
      return null;
    }
  }

  /**
   * 添加到缓存（自动 LRU 淘汰）
   */
  private addToCache(characterId: string, canvas: HTMLCanvasElement): void {
    if (this.canvasCache.size >= this.MAX_CACHE_SIZE) {
      this.evictLRU();
    }

    this.canvasCache.set(characterId, {
      canvas,
      lastAccess: Date.now(),
      accessCount: 1
    });
  }

  /**
   * LRU 淘汰策略
   */
  private evictLRU(): void {
    let lruKey: string | null = null;
    let lruScore = Infinity;

    for (const [key, value] of this.canvasCache.entries()) {
      const score = value.accessCount * 1000 + (Date.now() - value.lastAccess);
      if (score < lruScore) {
        lruScore = score;
        lruKey = key;
      }
    }

    if (lruKey) {
      console.log(`[TextureManager] Evicting LRU cache: ${lruKey}`);
      this.canvasCache.delete(lruKey);
    }
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.canvasCache.clear();
    this.uploadPromises.clear();
  }

  /**
   * 获取缓存大小
   */
  getCacheSize(): number {
    return this.canvasCache.size;
  }
}

export const textureManager = new TextureManager();
export default TextureManager;
