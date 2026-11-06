/**
 * 文件职责：LPC **角色合成器** —— 把若干部位的精灵图按 z 序叠成一张角色精灵表。
 *   来源：git 历史 a9498ae~1:src/stratix-character-creator/core/CharacterComposer.ts（复活 + 改造）。
 *   任务：.long-run-agent/tasks/task_027.md。
 * 输入：部位选择（category → {itemId, variant}）+ 体型 + 动画集合。
 * 输出：合成后的精灵表画布 + 参与层清单 + 版权署名。
 * 禁止事项：
 *   1. 自己 document.createElement / new Image —— **world 层零 DOM**：画布与图片对象由
 *      调用方（app 层绑定）注入，见 src/app/services/appearance-environment.ts；
 *      本模块自己 new 出来的 document 是违规（world/README 的铁律）；
 *   2. 直接 fetch 素材 —— 取图走注册表给的路径，取图过程走注入的 image 工厂；
 *   3. 改 core 的外观模型 —— core 只存"部位 → 变体"，展开成 itemId 是注册表的活；
 *   4. 无上限缓存位图 —— 走 LruCache（上限 100），换装时能 clear。
 *
 * 合成原理（LPC 素材是"分层精灵图"）：
 *   一个角色 = 阴影 + 身体 + 衣服 + 头发 + 帽子…，每层是一张按动画分目录的精灵图。
 *   合成 = 按 z 序把每层的精灵图画到同一张主精灵表的对应动画行上
 *   （动画行偏移 = ANIMATION_OFFSETS[animation]，行内 4 行分别是 上/左/下/右）。
 */

import {
  ANIM_ALIASES,
  ANIMATION_OFFSETS,
  DEFAULT_DIRECTION,
  FRAME_SIZE,
  LAYER_Z_POSITIONS,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  THUMBNAIL_SIZE,
  type BodyType,
} from './constants';
import { LruCache, MAX_CACHE_SIZE } from './image-cache';
import { PartRegistry } from './part-registry';
import type {
  ComposeOptions,
  ComposeResult,
  PartInfo,
  PartMetadata,
  PartSelection,
} from './types';

/** 合成器构造选项。 */
export interface CharacterComposerOptions {
  /** 部位注册表（缺省 = 用默认 fetch 的空注册表；正式用请注入已 loadMetadata 的实例）。 */
  readonly registry?: PartRegistry;
  /** 画布工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createCanvas: () => HTMLCanvasElement;
  /** 图片工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createImage: () => HTMLImageElement;
  /** 位图缓存上限（张）。 */
  readonly maxCacheSize?: number;
}

/** 合成器。 */
export class CharacterComposer {
  private readonly registry: PartRegistry;
  private readonly createCanvas: () => HTMLCanvasElement;
  private readonly createImage: () => HTMLImageElement;
  private readonly imageCache: LruCache<HTMLImageElement>;

  constructor(options: CharacterComposerOptions) {
    this.registry = options.registry ?? new PartRegistry();
    this.createCanvas = options.createCanvas;
    this.createImage = options.createImage;
    this.imageCache = new LruCache<HTMLImageElement>({
      maxSize: options.maxCacheSize ?? MAX_CACHE_SIZE,
      load: (src) => this.loadImage(src),
    });
  }

  /**
   * 合成一个角色。
   *
   * @param selections 部位选择（category → {itemId, variant}）。
   * @param options 体型 / 动画集合 / 目标画布。
   */
  async composeCharacter(
    selections: Record<string, PartSelection>,
    options: ComposeOptions
  ): Promise<ComposeResult> {
    const { bodyType, animations = Object.keys(ANIMATION_OFFSETS) } = options;

    const canvas = options.targetCanvas ?? this.createCanvas();
    canvas.width = SHEET_WIDTH;
    canvas.height = SHEET_HEIGHT;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      throw new Error('合成失败：拿不到 2d 画布上下文');
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 先算"要画什么"（纯逻辑，可单测），再取图、绘制。
    const plan = this.planItems(selections, bodyType, animations);
    const { loaded: images, failed } = await this.loadImages(plan);

    for (const item of plan) {
      const img = images.get(item.spritePath);
      if (img) {
        ctx.drawImage(img, 0, item.yPos);
      }
    }

    const credits = this.registry.getCredits(
      plan.map((item) => item.itemId)
    );

    // 缺件（取不到图的层）随结果带出 —— 烘焙期据此判定失败面（task_196 / CP-02）。
    return { canvas, parts: plan, credits, failedParts: failed };
  }

  /**
   * 计算合成计划（**纯逻辑**：不取图、不碰画布）。
   *
   * 输出按 z 序升序排好（同 z 序时保持部位在先的稳定次序）。
   *
   * @param selections 部位选择。
   * @param bodyType 体型。
   * @param animations 动画集合。
   */
  planItems(
    selections: Record<string, PartSelection>,
    bodyType: BodyType,
    animations: readonly string[]
  ): PartInfo[] {
    const items: PartInfo[] = [];

    for (const [category, selection] of Object.entries(selections)) {
      const { itemId, variant } = selection;
      const meta = this.registry.getPart(itemId);
      if (!meta) continue;
      if (!meta.required.includes(bodyType)) continue;

      for (let layerNum = 1; layerNum < 10; layerNum++) {
        const layer = meta.layers?.[`layer_${layerNum}`];
        if (!layer) break;

        const zPos = layer.zPos ?? LAYER_Z_POSITIONS[category] ?? 50;

        for (const animation of animations) {
          if (!supportsAnimation(meta, animation)) continue;

          const yPos = ANIMATION_OFFSETS[animation];
          if (yPos === undefined) continue;

          const spritePath = this.registry.buildSpritePath(
            itemId,
            variant,
            bodyType,
            animation,
            layerNum
          );
          if (!spritePath) continue;

          items.push({ itemId, variant, spritePath, zPos, layerNum, animation, yPos });
        }
      }
    }

    return items.sort((a, b) => a.zPos - b.zPos);
  }

  /**
   * 取出计划里用到的全部图片（命中缓存的直接复用）。
   *
   * why 单张失败不中断整轮合成：某个部位缺图不该让整个角色画不出来 ——
   * 失败的那张跳过即可（画面上少一层），其余照常合成。
   * why 还要把失败的路径**收集起来**（@since v3.3，task_196 / CP-02）：
   * 「少了一层」对合成器是可接受的降级，但对烘焙是失败面 ——
   * 烘焙期要拿这份名单去判失败、去内部日志暴露（DESIGN §2.3）。
   */
  private async loadImages(plan: readonly PartInfo[]): Promise<{
    readonly loaded: Map<string, HTMLImageElement>;
    readonly failed: readonly string[];
  }> {
    const loaded = new Map<string, HTMLImageElement>();
    const failed: string[] = [];
    const uniquePaths = Array.from(new Set(plan.map((item) => item.spritePath)));

    await Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const img = await this.imageCache.get(path);
          loaded.set(path, img);
        } catch (error) {
          failed.push(path);
          console.warn(`[CharacterComposer] 精灵图加载失败，跳过该层：${path}`, error);
        }
      })
    );

    return { loaded, failed };
  }

  /** 加载单张图片（注入的 image 工厂）。 */
  private loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = this.createImage();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`精灵图加载失败：${src}`));
      img.src = src;
    });
  }

  /**
   * 从主精灵表里裁出某个动画的 4 行（上下左右）。
   *
   * @param canvas 主精灵表。
   * @param animation 动画名。
   * @returns 裁出的画布；动画名不认识 → null。
   */
  extractAnimation(canvas: HTMLCanvasElement, animation: string): HTMLCanvasElement | null {
    const yPos = ANIMATION_OFFSETS[animation];
    if (yPos === undefined) return null;

    const animCanvas = this.createCanvas();
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

  /**
   * 从主精灵表里裁出单帧。
   *
   * @param canvas 主精灵表。
   * @param animation 动画名。
   * @param frame 帧号（0 起）。
   * @param direction 方向行号（0=上 1=左 2=下 3=右）。
   */
  extractSingleFrame(
    canvas: HTMLCanvasElement,
    animation: string,
    frame: number,
    direction: number
  ): HTMLCanvasElement | null {
    const yPos = ANIMATION_OFFSETS[animation];
    if (yPos === undefined) return null;

    const frameCanvas = this.createCanvas();
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

  /**
   * 生成缩略图（data URL）。
   *
   * @param canvas 主精灵表。
   * @param size 缩略图边长。
   */
  generateThumbnail(canvas: HTMLCanvasElement, size: number = THUMBNAIL_SIZE): string {
    const thumbCanvas = this.createCanvas();
    thumbCanvas.width = size;
    thumbCanvas.height = size;

    const ctx = thumbCanvas.getContext('2d');
    if (!ctx) return '';

    const walkY = ANIMATION_OFFSETS.walk;
    const direction = DEFAULT_DIRECTION; // 默认朝下
    const frame = 0;

    const srcX = frame * FRAME_SIZE;
    const srcY = walkY + direction * FRAME_SIZE;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, srcX, srcY, FRAME_SIZE, FRAME_SIZE, 0, 0, size, size);

    return thumbCanvas.toDataURL('image/png');
  }

  /** 清空位图缓存（换装 / 释放内存时调用）。 */
  clearCache(): void {
    this.imageCache.clear();
  }

  /** 当前缓存的位图数量（诊断用）。 */
  getCacheSize(): number {
    return this.imageCache.size;
  }
}

/** 部位是否支持某动画（尊重别名表；素材没写动画列表 = 视为全支持）。 */
function supportsAnimation(meta: PartMetadata, animation: string): boolean {
  if (!meta.animations || meta.animations.length === 0) return true;
  const aliases = ANIM_ALIASES[animation];
  if (aliases) {
    return aliases.some((alias) => meta.animations.includes(alias));
  }
  return meta.animations.includes(animation);
}
