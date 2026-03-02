import type { CharacterData, CharacterTexture } from '@/stratix-core/stratix-protocol';
import { characterComposer } from '@/stratix-character-creator/core/CharacterComposer';
import {
  FRAME_SIZE,
  SHEET_WIDTH,
  ANIMATION_OFFSETS
} from '@/stratix-character-creator/constants';
import { textureManager } from '@/stratix-core/services';
import { services } from '@/stratix-core/services/ServiceLocator';

const RTS_ANIMATIONS = ['walk', 'idle', 'run'];

/**
 * @deprecated Use textureManager from '@/stratix-core/services' instead
 * This class is maintained for backward compatibility only
 */
class TextureService {
  private textureCache: Map<string, HTMLCanvasElement> = new Map();

  async generateAndUploadTexture(characterData: CharacterData): Promise<CharacterTexture | null> {
    console.warn('[TextureService] DEPRECATED: Use textureManager.generateAndUploadTexture() instead');
    return textureManager.generateAndUploadTexture(characterData);
  }

  async checkTexture(filePath: string): Promise<{ exists: boolean; url: string | null }> {
    console.warn('[TextureService] DEPRECATED: Use services.checkTexture() instead');
    const { exists, url } = await services.checkTexture(filePath);
    return { exists, url };
  }

  async ensureTexture(characterData: CharacterData): Promise<string | null> {
    console.warn('[TextureService] DEPRECATED: Use textureManager.ensureTexture() instead');
    return textureManager.ensureTexture(characterData);
  }

  generateRTSTextureUrl(characterId: string): string {
    return `/textures/${characterId}.png`;
  }

  extractAnimationFrame(
    canvas: HTMLCanvasElement,
    animation: string,
    frame: number,
    direction: number
  ): HTMLCanvasElement | null {
    const yPos = ANIMATION_OFFSETS[animation];
    if (yPos === undefined) return null;

    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = FRAME_SIZE;
    frameCanvas.height = FRAME_SIZE;

    const ctx = frameCanvas.getContext('2d');
    if (!ctx) return null;

    const srcX = frame * FRAME_SIZE;
    const srcY = yPos + direction * FRAME_SIZE;

    ctx.drawImage(
      canvas,
      srcX, srcY, FRAME_SIZE, FRAME_SIZE,
      0, 0, FRAME_SIZE, FRAME_SIZE
    );

    return frameCanvas;
  }

  getCachedCanvas(characterId: string): HTMLCanvasElement | undefined {
    console.warn('[TextureService] DEPRECATED: Use textureManager.getCachedCanvas() instead');
    return textureManager.getCachedCanvas(characterId);
  }

  clearCache(): void {
    console.warn('[TextureService] DEPRECATED: Use textureManager.clearCache() instead');
    textureManager.clearCache();
    this.textureCache.clear();
  }
}

export const textureService = new TextureService();
export default TextureService;
