/**
 * 文件职责：LPC **部位注册表** —— 素材元数据的加载 / 解析 / 索引 / 精灵路径构建。
 *   来源：git 历史 a9498ae~1:src/stratix-character-creator/core/PartRegistry.ts（复活 + 改造）。
 *   任务：.long-run-agent/tasks/task_027.md。
 * 输入：item-metadata.json（通过注入的 fetch 取；basePath 指向素材根）。
 * 输出：部位元数据索引 + 精灵图片路径 + 由 core 外观模型展开出的部位选择。
 * 禁止事项：
 *   1. 直接调全局 fetch —— fetch 必须可注入（单测要打桩，且渲染层可能换实现）；
 *   2. 碰 DOM / canvas —— 本模块是纯数据 + 纯字符串拼接；
 *   3. 校验素材文件是否存在 —— 那是浏览器加载图片时才知道的事，注册表只负责"拼得出路径"；
 *   4. 塞业务规则（谁能穿什么）—— 那是 core / 业务层的事。
 *
 * ★ 分类别名表（CATEGORY_ALIASES）为什么必须有：
 *   素材侧的类别名（typeName）是 'clothes' / 'dress' / 'jacket' / 'boots'…，
 *   代码侧的类别名是 'torso' / 'feet'…，两边不是一一对应。
 *   别名表把素材类别**映射到**代码类别（一个素材类别可属于多个代码类别），
 *   于是"选一个 torso"能同时看到衣服/裙子/甲胄。
 */

import type { CharacterAppearance } from '../../core/types';

import {
  ANIM_ALIASES,
  SPRITESHEET_BASE_PATH,
  type BodyType,
  type PartCategory,
} from './constants';
import type { CreditInfo, PartMetadata, PartSelection } from './types';

/** fetch 的最小契约（只要 ok / status / json，够用且便于打桩）。 */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** 可注入的 fetch 形态。 */
export type FetchLike = (url: string) => Promise<FetchResponseLike>;

/** 注册表构造选项。 */
export interface PartRegistryOptions {
  /** 注入的 fetch（缺省用 globalThis.fetch）。 */
  readonly fetchImpl?: FetchLike;
  /** 素材根路径（缺省 SPRITESHEET_BASE_PATH = '/spritesheets'）。 */
  readonly basePath?: string;
}

/**
 * 代码类别 → 素材类别名列表（一个素材类别可归入多个代码类别）。
 * 与历史实现保持一致（不重排、不增删），否则已有存档里的选择会指到别的素材上。
 */
const CATEGORY_ALIASES: Record<string, readonly string[]> = {
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

/** 注册表。 */
export class PartRegistry {
  private readonly metadata = new Map<string, PartMetadata>();
  /** 类别 → 部位列表（键含素材自身的 typeName 与别名表映射出的代码类别）。 */
  private readonly byCategory = new Map<string, PartMetadata[]>();
  private readonly fetchImpl: FetchLike;
  private readonly basePath: string;
  private loaded = false;
  /** 在途的加载 promise（并发去重：同一个注册表只拉一次 1.4MB 的元数据）。 */
  private loading: Promise<void> | null = null;

  constructor(options: PartRegistryOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
    this.basePath = options.basePath ?? SPRITESHEET_BASE_PATH;
  }

  /**
   * 加载素材元数据。
   *
   * why 失败不抛：素材缺失不该让整个应用起不来 —— 注册表退化成"空表"，
   * 合成时没有部位可画（画面上是空角色），比整个渲染层崩掉好。
   * 但**必须记住失败过**（loaded = true）：否则每次合成都重试一次网络请求。
   *
   * why 加了并发去重（@since v3.10，task_029）：同一个注册表实例会被**两处**并发触发加载
   * （向导的随机形象 + 战场的形象合成），各自 await 同一个 promise 即可 —— 不去重就是白拉 1.4MB。
   */
  async loadMetadata(): Promise<void> {
    if (this.loaded) return;
    if (this.loading) {
      await this.loading;
      return;
    }

    this.loading = (async () => {
      try {
        const response = await this.fetchImpl(`${this.basePath}/item-metadata.json`);
        if (!response.ok) {
          throw new Error(`Failed to load metadata: ${response.status}`);
        }
        const data = await response.json();
        this.parseMetadata(data);
      } catch (error) {
        console.warn('[PartRegistry] 素材元数据加载失败，退化为空注册表：', error);
        this.metadata.clear();
        this.byCategory.clear();
      } finally {
        this.loaded = true;
        this.loading = null;
      }
    })();

    await this.loading;
  }

  /**
   * 解析元数据 JSON（纯逻辑，可单测）。
   *
   * 规则：
   *   - 顶层每一项必须是一个对象，且带字符串的 typeName；
   *   - 缺 required 字段的项视为坏数据，跳过（不猜）；
   *   - 合法项按 typeName 归类，并按别名表**额外**归入相关代码类别。
   */
  parseMetadata(data: unknown): void {
    this.metadata.clear();
    this.byCategory.clear();

    if (typeof data !== 'object' || data === null || Array.isArray(data)) return;

    for (const [itemId, item] of Object.entries(data as Record<string, unknown>)) {
      if (!isValidPartMetadata(item)) continue;
      const meta = { ...(item as Omit<PartMetadata, 'itemId'>), itemId };

      this.metadata.set(itemId, meta);
      this.pushToCategory(meta.typeName, meta);

      for (const [codeCategory, aliases] of Object.entries(CATEGORY_ALIASES)) {
        if (aliases.includes(meta.typeName)) {
          this.pushToCategory(codeCategory, meta);
        }
      }
    }
  }

  private pushToCategory(category: string, meta: PartMetadata): void {
    const bucket = this.byCategory.get(category);
    if (bucket) {
      bucket.push(meta);
    } else {
      this.byCategory.set(category, [meta]);
    }
  }

  /** 取部位元数据（按条目 id）。 */
  getPart(itemId: string): PartMetadata | null {
    return this.metadata.get(itemId) ?? null;
  }

  /** 取某类别的全部部位。 */
  getPartsByCategory(category: PartCategory | string): PartMetadata[] {
    return this.byCategory.get(category) ?? [];
  }

  /** 全部已知类别（含别名类别）。 */
  getAllCategories(): string[] {
    return Array.from(this.byCategory.keys());
  }

  /** 部位总数（诊断用）。 */
  get size(): number {
    return this.metadata.size;
  }

  /** 元数据是否已加载过（成功或失败都算加载过）。 */
  isLoaded(): boolean {
    return this.loaded;
  }

  /** 某部位的变体列表。 */
  getVariants(itemId: string): readonly string[] {
    return this.getPart(itemId)?.variants ?? [];
  }

  /**
   * 构建精灵图片路径。
   *
   * 路径格式：`{素材根}/{图层相对路径}{动画}/{变体}.png`
   * 例：'/spritesheets/body/bodies/male/walk/light.png'
   *
   * @param itemId 部位条目 id。
   * @param variant 变体名（大小写 / 空格会被规整成文件名形式）。
   * @param bodyType 体型（决定用哪套图层路径）。
   * @param animation 动画名。
   * @param layerNum 图层号（1 起）。
   * @returns 路径；部位不存在 / 该体型没有图层 / 该图层没有该动画 → null（跳过这一层）。
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

    const layer = meta.layers?.[`layer_${layerNum}`];
    if (!layer) return null;

    const basePath = (layer as Record<string, string | undefined>)[bodyType];
    if (!basePath) return null;

    return `${this.basePath}/${basePath}${animation}/${variantToFilename(variant)}.png`;
  }

  /** 部位是否支持某体型 + 某动画。 */
  isPartSupported(itemId: string, bodyType: BodyType, animation: string): boolean {
    const meta = this.metadata.get(itemId);
    if (!meta) return false;
    if (!meta.required.includes(bodyType)) return false;
    if (meta.animations && meta.animations.length > 0) {
      return supportsAnimation(meta, animation);
    }
    return true;
  }

  /** 版权署名（按部位 id 汇总并去重）。 */
  getCredits(itemIds: readonly string[]): CreditInfo[] {
    const credits: CreditInfo[] = [];
    const seen = new Set<string>();

    for (const itemId of itemIds) {
      const meta = this.metadata.get(itemId);
      if (!meta?.credits) continue;

      for (const credit of meta.credits) {
        const key = credit.authors.join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        credits.push({
          authors: [...credit.authors],
          licenses: [...credit.licenses],
          ...(credit.file ? { file: credit.file } : {}),
          ...(credit.notes ? { notes: credit.notes } : {}),
          ...(credit.urls ? { urls: [...credit.urls] } : {}),
        });
      }
    }

    return credits;
  }

  /**
   * 查某类别里"拥有该变体"的全部部位。
   *
   * why 需要"全部"而不是"第一个"：同一类别下的多个素材常共用同一套变体名
   * （91 个发型共用一套发色：blonde / black / red…；各款鞋也共用一套配色）。
   * 于是"类别 + 变体"往往定位不到唯一素材 —— UI 要列全部候选由它自己挑，
   * 合成侧则取第一个（见 resolveSelections 的说明）。
   */
  findPartsByVariant(category: PartCategory | string, variant: string): PartMetadata[] {
    return this.getPartsByCategory(category).filter((part) => part.variants.includes(variant));
  }

  /**
   * 由 core 的外观模型（category → variant 字典）展开成渲染面的部位选择。
   *
   * why 要这一步：core 存的是"部位的变体名"（薄），渲染要的是"哪个素材 + 哪个变体"（厚）。
   * 同一个类别下可能有多个素材（如 torso 下有 clothes / dress / jacket），
   * 这里按"变体名命中哪个素材的变体列表"反查；命中不了就**跳过该部位**并记一条警告
   * （宁缺毋滥 —— 画错素材比不画更刺眼）。
   *
   * ⚠️ 同类别多素材共用变体名时（如所有发型共用发色），变体名定位不到唯一款式，
   *    这里取元数据顺序里的第一个命中项 —— 即 core 的外观模型表达的是"发色"级别的选择，
   *    不是"发型款式"级别的选择。要选具体款式，渲染侧得自己记住款式（itemId）。
   *
   * @returns 部位类别 → 部位选择。
   */
  resolveSelections(appearance: CharacterAppearance): Record<string, PartSelection> {
    const selections: Record<string, PartSelection> = {};

    for (const [category, variant] of Object.entries(appearance.parts)) {
      const hits = this.findPartsByVariant(category, variant);
      const hit = hits[0];
      if (!hit) {
        console.warn(
          `[PartRegistry] 部位「${category}」的变体「${variant}」在素材里找不到，跳过该部位`
        );
        continue;
      }
      selections[category] = { itemId: hit.itemId, variant };
    }

    return selections;
  }

  /**
   * 某体型的默认部位选择（阴影 + 身体）。
   * why 需要默认：LPC 的身体层是必选的（没有身体就没有角色），且它的变体就是肤色。
   */
  getDefaultSelections(bodyType: BodyType): Record<string, PartSelection> {
    const selections: Record<string, PartSelection> = {};

    for (const [category, itemId] of [
      ['shadow', 'shadow'],
      ['body', 'body'],
    ] as const) {
      const part = this.getPart(itemId);
      if (!part || !part.required.includes(bodyType)) continue;
      selections[category] = { itemId: part.itemId, variant: part.variants[0] ?? 'light' };
    }

    return selections;
  }
}

/** 变体名 → 素材文件名（小写 + 空格转下划线）。 */
export function variantToFilename(variant: string): string {
  return variant.toLowerCase().replace(/\s+/g, '_');
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

/** 元数据项的形状校验（坏数据跳过，不猜）。 */
function isValidPartMetadata(item: unknown): boolean {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) return false;
  const meta = item as Record<string, unknown>;
  return typeof meta.typeName === 'string' && typeof meta.required !== 'undefined';
}

/** 缺省 fetch（取全局；单测一律注入自己的实现）。 */
function defaultFetch(url: string): Promise<FetchResponseLike> {
  const globalFetch = (globalThis as { fetch?: typeof fetch }).fetch;
  if (!globalFetch) {
    return Promise.reject(new Error('当前环境没有 fetch —— 请注入 fetchImpl'));
  }
  return globalFetch(url) as unknown as Promise<FetchResponseLike>;
}
