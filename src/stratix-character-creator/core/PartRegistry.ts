/**
 * PartRegistry - 部位注册表
 * 管理所有角色部位的元数据、路径构建
 * 参考 LPC Universal-LPC-Spritesheet-Character-Generator 实现
 */

import type { PartCategory, BodyType } from '../constants';
import { SPRITESHEET_BASE_PATH } from '../constants';
import type { PartMetadata, PartSelection } from '../types';

/**
 * Category alias mapping - maps code category names to metadata typeName values
 */
const CATEGORY_ALIASES: Record<string, string[]> = {
  torso: ['body', 'clothes', 'dress', 'armour', 'jacket', 'vest', 'chainmail', 'apron', 'overalls'],
  hands: ['gloves'],
  feet: ['shoes', 'socks'],
  facial: ['beard', 'mustache', 'eyebrows'],
  wrists: ['bracers', 'wrists'],
  neck: ['neck', 'necklace'],
  arms: ['arms', 'armour', 'sleeves'],
  hat: ['hat', 'hat_accessory', 'headcover', 'bandana', 'visor'],
  eyes: ['eyes', 'eye_color'],
};

class PartRegistry {
  private metadata: Map<string, PartMetadata> = new Map();
  private byCategory: Map<string, PartMetadata[]> = new Map(); // Use string key for aliases
  private loaded = false;

  async loadMetadata(): Promise<void> {
    if (this.loaded) return;

    try {
      const response = await fetch(`${SPRITESHEET_BASE_PATH}/item-metadata.json`);
      if (!response.ok) {
        throw new Error(`Failed to load metadata: ${response.status}`);
      }
      const data = await response.json();
      this.parseMetadata(data);
      this.loaded = true;
      console.log(`[PartRegistry] Loaded ${this.metadata.size} items across ${this.byCategory.size} categories`);
    } catch (error) {
      console.warn('Failed to load item-metadata.json, using empty registry:', error);
      this.loaded = true;
    }
  }

  private parseMetadata(data: Record<string, unknown>): void {
    this.metadata.clear();
    this.byCategory.clear();

    for (const [itemId, item] of Object.entries(data)) {
      if (this.isValidPartMetadata(item)) {
        const meta = item as PartMetadata;
        meta.itemId = itemId;
        this.metadata.set(itemId, meta);

        const typeName = meta.typeName as string;

        // Add to its own typeName category
        if (!this.byCategory.has(typeName)) {
          this.byCategory.set(typeName, []);
        }
        this.byCategory.get(typeName)!.push(meta);

        // Also add to aliased categories
        for (const [codeCategory, aliases] of Object.entries(CATEGORY_ALIASES)) {
          if (aliases.includes(typeName)) {
            if (!this.byCategory.has(codeCategory)) {
              this.byCategory.set(codeCategory, []);
            }
            this.byCategory.get(codeCategory)!.push(meta);
          }
        }
      }
    }
  }

  private isValidPartMetadata(item: unknown): boolean {
    if (typeof item !== 'object' || item === null) return false;
    const meta = item as Record<string, unknown>;
    return typeof meta.typeName === 'string' && typeof meta.required !== 'undefined';
  }

  getPart(itemId: string): PartMetadata | null {
    return this.metadata.get(itemId) ?? null;
  }

  getPartsByCategory(category: PartCategory): PartMetadata[] {
    return this.byCategory.get(category) ?? [];
  }

  getAllCategories(): string[] {
    return Array.from(this.byCategory.keys());
  }

  /**
   * Build sprite path based on LPC format
   * Path format: spritesheets/{basePath}{animation}/{variant}.png
   * Example: spritesheets/body/bodies/male/walk/light.png
   * Example: spritesheets/shadow/adult/walk/shadow.png
   */
  buildSpritePath(
    itemId: string,
    variant: string,
    bodyType: BodyType,
    animation: string,
    layerNum: number = 1
  ): string | null {
    const meta = this.metadata.get(itemId);
    if (!meta) return null;

    const layerKey = `layer_${layerNum}`;
    const layer = meta.layers?.[layerKey];
    if (!layer) return null;

    const basePath = layer[bodyType] as string | undefined;
    if (!basePath) return null;

    const variantFileName = this.variantToFilename(variant);

    return `${SPRITESHEET_BASE_PATH}/${basePath}${animation}/${variantFileName}.png`;
  }

  private variantToFilename(variant: string): string {
    return variant.toLowerCase().replace(/\s+/g, '_');
  }

  isPartSupported(itemId: string, bodyType: BodyType, animation: string): boolean {
    const meta = this.metadata.get(itemId);
    if (!meta) return false;

    if (!meta.required.includes(bodyType)) return false;

    if (meta.animations && meta.animations.length > 0) {
      return this.supportsAnimation(meta, animation);
    }

    return true;
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

  getVariants(itemId: string): string[] {
    const meta = this.metadata.get(itemId);
    return meta?.variants ?? [];
  }

  getCredits(itemIds: string[]): Array<{ authors: string[]; licenses: string[] }> {
    const credits: Array<{ authors: string[]; licenses: string[] }> = [];
    const seen = new Set<string>();

    for (const itemId of itemIds) {
      const meta = this.metadata.get(itemId);
      if (!meta?.credits) continue;

      for (const credit of meta.credits) {
        const key = credit.authors.join('|');
        if (!seen.has(key)) {
          seen.add(key);
          credits.push({
            authors: credit.authors,
            licenses: credit.licenses
          });
        }
      }
    }

    return credits;
  }

  getRandomPart(category: PartCategory, bodyType: BodyType): PartMetadata | null {
    const parts = this.getPartsByCategory(category).filter(p => p.required.includes(bodyType));
    if (parts.length === 0) return null;
    return parts[Math.floor(Math.random() * parts.length)];
  }

  getRandomVariant(itemId: string): string | null {
    const variants = this.getVariants(itemId);
    if (variants.length === 0) return null;
    return variants[Math.floor(Math.random() * variants.length)];
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  /**
   * Get default selections for a body type
   */
  getDefaultSelections(bodyType: BodyType): Record<string, PartSelection> {
    const selections: Record<string, PartSelection> = {};

    const shadowPart = this.getPart('shadow');
    if (shadowPart && shadowPart.required.includes(bodyType)) {
      selections['shadow'] = {
        itemId: shadowPart.itemId,
        variant: shadowPart.variants?.[0] ?? 'shadow'
      };
    }

    const bodyPart = this.getPart('body');
    if (bodyPart && bodyPart.required.includes(bodyType)) {
      selections['body'] = {
        itemId: bodyPart.itemId,
        variant: bodyPart.variants?.[0] ?? 'light'
      };
    }

    return selections;
  }
}

export const partRegistry = new PartRegistry();
export default PartRegistry;
