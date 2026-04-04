/**
 * CharacterComposer - 角色组合器
 * 核心精灵拼接逻辑，参考 LPC 实现
 */

import type { BodyType } from '../constants';
import {
  FRAME_SIZE,
  SHEET_WIDTH,
  SHEET_HEIGHT,
  ANIMATION_OFFSETS,
  LAYER_Z_POSITIONS
} from '../constants';
import type { PartSelection, ComposeOptions, ComposeResult, PartInfo, CreditInfo, PartMetadata } from '../types';

import { partRegistry } from './PartRegistry';

interface ItemToDraw {
  itemId: string;
  variant: string;
  spritePath: string | null;
  zPos: number;
  layerNum: number;
  animation: string;
  yPos: number;
  img?: HTMLImageElement;
}

class CharacterComposer {
  private imageCache: Map<string, HTMLImageElement> = new Map();

  async composeCharacter(
    selections: Record<string, PartSelection>,
    options: ComposeOptions
  ): Promise<ComposeResult> {
    const { bodyType, animations = Object.keys(ANIMATION_OFFSETS), targetCanvas } = options;

    const canvas = targetCanvas ?? document.createElement('canvas');
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const itemsToDraw = this.buildItemsList(selections, bodyType, animations);

    itemsToDraw.sort((a, b) => a.zPos - b.zPos);

    await this.loadImages(itemsToDraw);

    for (const item of itemsToDraw) {
      if (item.img) {
        ctx.drawImage(item.img, 0, item.yPos);
      }
    }

    const parts: PartInfo[] = itemsToDraw.map(item => ({
      itemId: item.itemId,
      variant: item.variant,
      spritePath: item.spritePath ?? '',
      zPos: item.zPos,
      layerNum: item.layerNum,
      animation: item.animation,
      yPos: item.yPos
    }));

    const credits = this.collectCredits(selections);

    return { canvas, parts, credits };
  }

  private buildItemsList(
    selections: Record<string, PartSelection>,
    bodyType: BodyType,
    animations: string[]
  ): ItemToDraw[] {
    const items: ItemToDraw[] = [];

    for (const [category, selection] of Object.entries(selections)) {
      const { itemId, variant } = selection;
      const meta = partRegistry.getPart(itemId);

      if (!meta) {
        continue;
      }
      if (!meta.required.includes(bodyType)) {
        continue;
      }

      for (let layerNum = 1; layerNum < 10; layerNum++) {
        const layerKey = `layer_${layerNum}`;
        const layer = meta.layers?.[layerKey];
        if (!layer) break;

        const zPos = layer.zPos ?? LAYER_Z_POSITIONS[category] ?? 50;

        for (const animName of animations) {
          if (!this.supportsAnimation(meta, animName)) continue;

          const yPos = ANIMATION_OFFSETS[animName];
          if (yPos === undefined) continue;

          const spritePath = partRegistry.buildSpritePath(
            itemId,
            variant,
            bodyType,
            animName,
            layerNum
          );

          items.push({
            itemId,
            variant,
            spritePath,
            zPos,
            layerNum,
            animation: animName,
            yPos
          });
        }
      }
    }

    return items;
  }

  private supportsAnimation(meta: PartMetadata, animName: string): boolean {
    if (!meta.animations || meta.animations.length === 0) return true;

    const animAliases: Record<string, string[]> = {
      combat_idle: ['combat', 'idle'],
      backslash: ['1h_slash', '1h_backslash', 'slash', 'slash_oversize', 'slash_reverse_oversize'],
      halfslash: ['1h_halfslash', 'slash', 'slash_oversize'],
      slash: ['slash', 'slash_oversize', 'slash_reverse_oversize', '1h_slash'],
      thrust: ['thrust', 'thrust_oversize'],
      shoot: ['shoot', 'bow'],
      spellcast: ['spellcast', 'magic'],
      walk: ['walk'],
      run: ['run', 'walk'],
      idle: ['idle'],
      hurt: ['hurt']
    };

    const aliases = animAliases[animName];
    if (aliases) {
      return aliases.some(alias => meta.animations!.includes(alias));
    }

    return meta.animations.includes(animName);
  }

  private async loadImages(items: ItemToDraw[]): Promise<void> {
    const loadPromises = items.map(async (item) => {
      if (!item.spritePath) return;

      if (this.imageCache.has(item.spritePath)) {
        item.img = this.imageCache.get(item.spritePath);
        return;
      }

      try {
        const img = await this.loadImage(item.spritePath);
        item.img = img;
        this.imageCache.set(item.spritePath, img);
      } catch (error) {
        console.warn(`[CharacterComposer] Failed to load image: ${item.spritePath}`, error);
      }
    });

    await Promise.all(loadPromises);
  }

  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
  }

  extractAnimation(canvas: HTMLCanvasElement, animation: string): HTMLCanvasElement | null {
    const yPos = ANIMATION_OFFSETS[animation];
    if (yPos === undefined) return null;

    const animCanvas = document.createElement('canvas');
    animCanvas.width = SHEET_WIDTH;
    animCanvas.height = 4 * FRAME_SIZE;

    const ctx = animCanvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(
      canvas,
      0, yPos, SHEET_WIDTH, 4 * FRAME_SIZE,
      0, 0, SHEET_WIDTH, 4 * FRAME_SIZE
    );

    return animCanvas;
  }

  extractSingleFrame(
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

  generateThumbnail(canvas: HTMLCanvasElement, size: number = 128): string {
    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = size;
    thumbCanvas.height = size;

    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return '';

    const walkY = ANIMATION_OFFSETS.walk;
    const direction = 2;  // 默认朝下 (DOWN)
    const frame = 0;

    const srcX = frame * FRAME_SIZE;
    const srcY = walkY + direction * FRAME_SIZE;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      canvas,
      srcX, srcY, FRAME_SIZE, FRAME_SIZE,
      0, 0, size, size
    );

    return thumbCanvas.toDataURL('image/png');
  }

  private collectCredits(selections: Record<string, PartSelection>): CreditInfo[] {
    const itemIds = Object.values(selections).map(s => s.itemId);
    return partRegistry.getCredits(itemIds);
  }

  clearCache(): void {
    this.imageCache.clear();
  }

  getCacheSize(): number {
    return this.imageCache.size;
  }
}

export const characterComposer = new CharacterComposer();
export default CharacterComposer;
