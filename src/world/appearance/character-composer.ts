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

/**
 * **目录存在性探针**的上限（每个失败格最多试几个兄弟变体文件）。
 *
 * why 要有上限：探针是「多发几次取图请求」换判定确定性 —— 不设上限就是拿带宽换 CPU。
 *   探到**第一个**成功就停（目录存在即证实），只有全失败才会走满上限。
 *   4 个足够：LPC 的动画目录里装着该层全套变体（实测每个目录 8~32 个变体），
 *   而被问的那一格最多只缺 1 个文件。
 */
const MAX_DIRECTORY_PROBES = 4;

/**
 * **目录存在性判定**的缓存上限（条）。
 *
 * why 要有上限：判定是「目录 URL → 目录在不在」，目录数随「部位 × 动画 × 体型」增长，
 *   不设上限就是无界增长（perf 硬约束：数据不许无限涨）。
 *   超限时淘汰最久未用的一条（Map 的插入序 = LRU 序）。
 */
const MAX_DIRECTORY_VERDICTS = 512;

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
  /**
   * **动画目录存在性判定**的缓存（目录 URL → 目录是否存在）。
   *
   * why 要缓存：缺件分级要探目录（多发几次取图请求），而目录判定对同一目录是恒定的 ——
   *   不缓存就是每合成一次都重探一遍（白烧带宽）。
   *   上限见 MAX_DIRECTORY_VERDICTS（超限淘汰最久未用）。
   */
  private readonly directoryVerdicts = new Map<string, boolean>();

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
    const { loaded: images, failed, absent } = await this.loadImages(plan, bodyType);

    for (const item of plan) {
      const img = images.get(item.spritePath);
      if (img) {
        ctx.drawImage(img, 0, item.yPos);
      }
    }

    const credits = this.registry.getCredits(
      plan.map((item) => item.itemId)
    );

    // 缺件随结果带出（分两级，@since v3.3，task_209 / CP-04）：
    //   failedParts  = **真缺件**（动画目录在、文件丢了/坏了）→ 烘焙的失败面（task_196 / CP-02）；
    //   missingParts = **合法缺失**（素材库这层这动画本就没有文件 ⇒ 目录压根不存在）
    //                  → 该格留空/透明，烘焙照常成功。
    return { canvas, parts: plan, credits, failedParts: failed, missingParts: absent };
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
   * 取出计划里用到的全部图片（命中缓存的直接复用），并给失败格**分级**。
   *
   * why 单张失败不中断整轮合成：某个部位缺图不该让整个角色画不出来 ——
   * 失败的那张跳过即可（画面上少一层），其余照常合成。
   * why 还要把失败的路径**收集起来**（@since v3.3，task_196 / CP-02）：
   * 「少了一层」对合成器是可接受的降级，但对烘焙是失败面 ——
   * 烘焙期要拿这份名单去判失败、去内部日志暴露（DESIGN §2.3）。
   *
   * ★ 两级缺件（@since v3.3，task_209 / CP-04）：
   *   - **合法缺失**（absent）：素材库该层该动画**本就没有文件**（动画目录不存在）
   *     —— 该格留空/透明，合成照常成功，烘焙也照常入缓存；
   *   - **真缺件**（failed）：元数据声称有、目录也在，只是**文件丢了/坏了**
   *     —— 仍是烘焙的失败面（静默降级）。
   *   分级办法见 classifyFailure（目录存在性探针）。
   */
  private async loadImages(
    plan: readonly PartInfo[],
    bodyType: BodyType
  ): Promise<{
    readonly loaded: Map<string, HTMLImageElement>;
    readonly failed: readonly string[];
    readonly absent: readonly string[];
  }> {
    const loaded = new Map<string, HTMLImageElement>();
    const failedPaths = new Set<string>();
    const uniquePaths = Array.from(new Set(plan.map((item) => item.spritePath)));

    await Promise.all(
      uniquePaths.map(async (path) => {
        try {
          const img = await this.imageCache.get(path);
          loaded.set(path, img);
        } catch (error) {
          failedPaths.add(path);
          console.warn(`[CharacterComposer] 精灵图加载失败，跳过该层：${path}`, error);
        }
      })
    );

    if (failedPaths.size === 0) {
      return { loaded, failed: [], absent: [] };
    }

    // ===== 第二步：给每个失败格分级（真缺件 / 合法缺失，@since v3.3，task_209 / CP-04）=====
    // 路径 → 计划项（同一路径可能被多层共用，取第一项当判定上下文）。
    const itemByPath = new Map<string, PartInfo>();
    for (const item of plan) {
      if (!itemByPath.has(item.spritePath)) {
        itemByPath.set(item.spritePath, item);
      }
    }
    // 本次合成**有没有一格取到图** ——
    //   「一格都没成功」意味着取图通道/网络整体坏了，此时不能把失败当成「目录不存在」。
    const channelHealthy = loaded.size > 0;

    const failed: string[] = [];
    const absent: string[] = [];
    await Promise.all(
      Array.from(failedPaths).map(async (path) => {
        const item = itemByPath.get(path);
        if (!item) {
          failed.push(path);
          return;
        }
        const verdict = await this.classifyFailure(item, bodyType, channelHealthy);
        if (verdict === 'absent') {
          absent.push(path);
        } else {
          failed.push(path);
        }
      })
    );

    return { loaded, failed, absent };
  }

  /**
   * 给一个加载失败的格**分级**（@since v3.3，task_209 / CP-04）。
   *
   * ★ 判定规则（可判定，依据 = 素材目录结构）：
   *   - **动画目录不存在** ⇒ 合法缺失：素材库这层这动画本就没有文件 ⇒ 该格留空/透明，
   *     合成与烘焙都照常成功（带眼睛的角色不再因为「eyes×climb 没有文件」被整表判缺件）。
   *   - **动画目录存在、只是文件缺** ⇒ 真缺件：仍走 parts-missing 失败面（静默降级）。
   *
   * ★ 目录存在性怎么判（静态服务不提供目录列表 ⇒ 列不出目录内容）：
   *   探针法 —— 试**同一图层目录下的兄弟变体文件**（注册表给，见 getDirectoryProbeFiles）：
   *   任一探针取得到 ⇒ 该动画目录里装着这层的文件 ⇒ 目录存在 ⇒ **真缺件**；
   *   全部取不到 ⇒ 该动画目录里没有这层的任何文件（这一层本就没有这个动画）⇒ **合法缺失**。
   *
   * ★ 判定边界（诚实说明）：
   *   「目录存在、但里面装的不是元数据登记的变体」（孤儿目录）会被判成合法缺失 ——
   *   真素材实测 19852 个失败格里 29 个（0.15%）属这一类；
   *   画面上同样是一格空白（与运行时直合成一致），不影响用户可见结果。
   *
   * ★ 探针集怎么凑（三种情况）：
   *   1. 该层在目标目录里有**别的兄弟变体**（多变体层，如人眼层 8 个色）⇒ 拿它们探；
   *   2. 只有自己那一个变体（单变体层，如 LPC 的 shadow）⇒ 没有兄弟可借，
   *      拿**自己那张失败的文件**再探一次（顺带排掉「首次加载其实是网络抖动」）；
   *   3. 一次都探不到 ⇒ 该动画目录里没有这层的任何文件 ⇒ 合法缺失。
   *
   * ★ 闸门（宁可判真缺件，也不误判合法缺失）：
   *   **本次合成一格都没成功** ⇒ 取图通道/网络整体坏了（不是目录不存在）⇒ 判真缺件。
   *
   * @param item 失败的计划项。
   * @param bodyType 体型（决定用哪套图层目录）。
   * @param channelHealthy 本次合成是否至少有一格取到图（取图通道是否正常）。
   * @returns 'real' = 真缺件；'absent' = 合法缺失。
   */
  private async classifyFailure(
    item: PartInfo,
    bodyType: BodyType,
    channelHealthy: boolean
  ): Promise<'real' | 'absent'> {
    const path = item.spritePath;
    const slash = path.lastIndexOf('/');
    if (slash < 0) return 'real';

    const dir = path.slice(0, slash + 1);
    const failedFile = path.slice(slash + 1);

    const cached = this.directoryVerdicts.get(dir);
    if (cached !== undefined) {
      return cached ? 'real' : 'absent';
    }

    // 探针集 = 同目录兄弟变体文件；本格那个**已知失败**的文件放在最后兜底
    //   （单变体的层没有别的兄弟可借 —— 没有兜底就判不出「目录不存在」，
    //    而「目录不存在」恰恰是最常见的那一档，如 LPC 人眼层的 eyes×climb）。
    const probeFiles = this.registry
      .getDirectoryProbeFiles(item.itemId, item.layerNum, bodyType)
      .filter((file) => file !== failedFile);
    const probes = [...probeFiles.slice(0, MAX_DIRECTORY_PROBES - 1), failedFile];

    let dirExists = false;
    if (probes.length > 0) {
      for (const probe of probes) {
        if (await this.probeImage(dir + probe)) {
          dirExists = true;
          break;
        }
      }
      if (!dirExists && !channelHealthy) {
        // 闸门：本次合成一格都没成功 —— 分不清是「目录不存在」还是「取图通道坏了」，
        // 保守当真缺件（降级比烤进一张坏图安全）。
        dirExists = true;
      }
    } else {
      // 兜底：连失败文件都拼不出路径 ⇒ 不可判定 ⇒ 保守当真缺件。
      dirExists = true;
    }

    this.rememberDirectoryVerdict(dir, dirExists);
    return dirExists ? 'real' : 'absent';
  }

  /**
   * 探一次文件在不在（**不进位图 LRU** —— 探针图只是判据，不参与绘制）。
   *
   * why 不走 LRU：LRU 是给「要画的图」用的（上限 100 张），
   *   探针图塞进去会挤掉真正要画的精灵图。
   */
  private probeImage(src: string): Promise<boolean> {
    return new Promise((resolve) => {
      const img = this.createImage();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
  }

  /** 记一条目录存在性判定（超限淘汰最久未用）。 */
  private rememberDirectoryVerdict(dir: string, exists: boolean): void {
    const cache = this.directoryVerdicts;
    cache.delete(dir);
    cache.set(dir, exists);
    while (cache.size > MAX_DIRECTORY_VERDICTS) {
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
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
    // 目录存在性判定也一起清：素材可能被换掉（换装 = 另一批文件），旧判定会误伤。
    this.directoryVerdicts.clear();
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
