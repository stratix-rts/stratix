/**
 * 文件职责：**sheet 特效的变体（同一 kind 的多套 seed 变体）**的运行时读口（@since v3.3，task_194 / AP-04）。
 *
 *   发布期烘焙（task_192 / AP-02）每个效果烘了 K=2 套 seed 变体：基础变体（`<kind>.png`，
 *   运行时索引已命中）+ `__s1` 变体（`<kind>__s1.png`）。192 留下的边界是「变体的运行时消费
 *   还没接线」—— 本模块把那半边接上：**运行时随机挑一套变体播**（DESIGN §1.1「seed → 烘 K 变体随机选」）。
 *
 * ★ 变体清单从哪来（为什么不写死在索引里）：
 *   变体是**构建期产物**（不入库），产物目录里有一份 manifest（`fx-bake-manifest.json`），
 *   里面逐条记着每个产物是什么（皮肤 / kind / 变体号 / 相对路径）。
 *   运行时读 manifest ⇒ ① dev 目录里没有 manifest ⇒ 没有变体（静默，不试错、不刷 404）；
 *      ② 发布产物里有 manifest ⇒ 变体清单与产物**逐条对得上**，不会出现「索引说有、文件却没有」。
 *
 * 禁止事项：
 *   1. import app / hud —— 铁律：world 只认 core；
 *   2. import scripts/ —— 构建期脚本不是运行时依赖（口径抄一份即可，字段名见 manifest 结构版本号）；
 *   3. 在这里猜文件是否存在 —— 存在与否由 manifest 说了算（文件在不在，浏览器自己会说）。
 */

import type { SpriteFxKind, SpriteFxSource } from './fx-atlas';

/** 发布期烘焙 manifest 的文件名（与构建期烘焙器同名字段口径）。 */
export const FX_BAKE_MANIFEST_NAME = 'fx-bake-manifest.json';

/**
 * 运行时取 sheet 的皮肤目录（相对素材根）。
 * why 固定 default：运行时索引（appearance/fx-sources.generated.ts）指向的就是 `default/…`；
 *   发布闭集里的 pixel 皮肤有各自的目录，但运行时索引不按皮肤切（沿用 task_161 现状，
 *   见 task_192 工作文档 §6.2「其余皮肤回落 default 的 sheet」）—— 本单不改这条口径。
 */
export const SPRITE_FX_RUNTIME_SKIN = 'default';

/** 一个可用的 sheet 变体（同一 kind 的另一套 seed 分布）。 */
export interface SpriteFxVariant {
  /** 语义 kind（与基础变体同一个）。 */
  readonly kind: SpriteFxKind;
  /** 变体标识（'s1'）。 */
  readonly variantId: string;
  /** Phaser 纹理 key（atlas key）。 */
  readonly atlasKey: string;
  /** Phaser 动画 key。 */
  readonly animKey: string;
  /** PNG 相对素材根的路径。 */
  readonly pngPath: string;
  /** atlas JSON 相对素材根的路径。 */
  readonly jsonPath: string;
}

/** 变体清单在 Phaser game registry 里的键（素材加载场景写、精灵特效层读）。 */
export const SPRITE_FX_VARIANTS_KEY = 'stratix:fx-variants';

/** 只读的键值存储（Phaser 的 DataManager 满足这个形状）。 */
export interface SpriteFxVariantStore {
  get(key: string): unknown;
}

/**
 * 读当前可用的 sheet 变体清单。
 *
 * @param store Phaser game registry（场景的 `this.registry`）。
 * @returns 变体清单（没登记 / 值非法 ⇒ 空清单 ⇒ 全部走基础变体）。
 */
export function readSpriteFxVariants(store: SpriteFxVariantStore | null | undefined): readonly SpriteFxVariant[] {
  if (!store) return [];
  const raw = store.get(SPRITE_FX_VARIANTS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.filter(isSpriteFxVariant);
}

/** 六个 sheet kind 的闭集（运行时索引里的 kind；变体清单只认这六个）。 */
const SPRITE_FX_KINDS: readonly SpriteFxKind[] = [
  'celebrate',
  'levelUp',
  'error',
  'spawn',
  'despawn',
  'command',
];

/**
 * 从烘焙 manifest 里解析出运行时可用的变体。
 *
 * 只收**变体序号 > 0** 的条目 —— 基础变体（序号 0）由运行时索引负责，
 * 这里重复收一遍会让同一次播放有两个候选（一个是基础、一个是它的重复），随机挑的分布就歪了。
 *
 * @param manifest manifest 的解析结果（任何形状都能吃 —— 解析不出来就是没有变体）。
 * @param skin 皮肤目录（缺省 SPRITE_FX_RUNTIME_SKIN）。
 * @returns 变体清单（解析不出来 ⇒ 空清单）。
 */
export function spriteFxVariantsFromManifest(
  manifest: unknown,
  skin: string = SPRITE_FX_RUNTIME_SKIN,
): readonly SpriteFxVariant[] {
  if (typeof manifest !== 'object' || manifest === null) return [];
  const artifacts = (manifest as { artifacts?: unknown }).artifacts;
  if (!Array.isArray(artifacts)) return [];
  const variants: SpriteFxVariant[] = [];
  for (const artifact of artifacts) {
    const variant = parseArtifact(artifact, skin);
    if (variant) variants.push(variant);
  }
  return variants;
}

/** 解析一条 manifest 产物记录（形状不对 / 不是本运行时的皮肤或 kind ⇒ 跳过）。 */
function parseArtifact(artifact: unknown, skin: string): SpriteFxVariant | null {
  if (typeof artifact !== 'object' || artifact === null) return null;
  const record = artifact as {
    skin?: unknown;
    kind?: unknown;
    variantId?: unknown;
    variantIndex?: unknown;
    png?: unknown;
    json?: unknown;
  };
  if (record.skin !== skin) return null;
  if (typeof record.kind !== 'string') return null;
  if (!SPRITE_FX_KINDS.includes(record.kind as SpriteFxKind)) return null;
  // 基础变体（序号 0）归运行时索引管 —— 这里只收真正的「另一套分布」。
  if (typeof record.variantIndex !== 'number' || record.variantIndex <= 0) return null;
  if (typeof record.variantId !== 'string' || record.variantId.length === 0) return null;
  if (typeof record.png !== 'string' || typeof record.json !== 'string') return null;
  return {
    kind: record.kind as SpriteFxKind,
    variantId: record.variantId,
    atlasKey: `fx:${record.kind}__${record.variantId}`,
    animKey: `fx-anim:${record.kind}__${record.variantId}`,
    pngPath: record.png,
    jsonPath: record.json,
  };
}

/** 一个值是不是合法的变体条目（registry 里什么都能塞）。 */
function isSpriteFxVariant(value: unknown): value is SpriteFxVariant {
  if (typeof value !== 'object' || value === null) return false;
  const variant = value as Partial<SpriteFxVariant>;
  return (
    typeof variant.kind === 'string' &&
    typeof variant.variantId === 'string' &&
    typeof variant.atlasKey === 'string' &&
    typeof variant.animKey === 'string'
  );
}

/**
 * 把一个变体条目派生成「可播的特效源」（与基础变体同参数，只换纹理 / 动画 key）。
 *
 * why 变体不另存一份参数表：变体是**同效果的另一套 seed 分布** —— 帧数 / 帧名 / 帧率 /
 *   枢轴 / 缩放全与基础变体相同（烘焙器只改 seed，见 scripts/lib/fx-release-bake.ts）。
 *   参数只留一份（生成索引），变体只带「我是什么纹理」—— 少一份就会漂一份。
 *
 * @param base 基础变体的运行时参数（生成索引里那条）。
 * @param variant 变体条目。
 * @returns 可播的特效源。
 */
export function spriteFxVariantSource(
  base: SpriteFxSource,
  variant: SpriteFxVariant,
): SpriteFxSource {
  return {
    ...base,
    atlasKey: variant.atlasKey,
    animKey: variant.animKey,
    pngPath: variant.pngPath,
    jsonPath: variant.jsonPath,
  };
}

/**
 * 列出某个 kind 的全部候选（基础变体 + 它的变体）。
 *
 * why 基础变体永远在候选里：变体是**构建期产物**，dev 环境没有 ⇒ 候选退化成基础变体，
 *   行为与 task_161 一模一样（不多不少地照播）。
 *
 * @param base 基础变体的运行时参数。
 * @param variants 变体清单（已按 kind 过滤）。
 * @returns 候选列表（基础变体在前）。
 */
export function spriteFxCandidates(
  base: SpriteFxSource,
  variants: readonly SpriteFxVariant[],
): readonly SpriteFxSource[] {
  const candidates: SpriteFxSource[] = [base];
  for (const variant of variants) {
    if (variant.kind !== base.kind) continue;
    candidates.push(spriteFxVariantSource(base, variant));
  }
  return candidates;
}

/**
 * 从候选里随机挑一个（运行时消费变体的唯一裁决处）。
 *
 * why 抽成纯函数：随机是**最该被单测钉住**的行为（"随机挑"最容易退化成"总是挑第一个"）。
 *   把随机源做成入参，单测就能喂确定的序列，逐条断言挑中了谁。
 *
 * @param candidates 候选列表。
 * @param random 随机源（缺省 Math.random；入参是为了可测）。
 * @returns 挑中的候选（候选为空 ⇒ null）。
 */
export function pickSpriteFxCandidate<T>(
  candidates: readonly T[],
  random: () => number = Math.random,
): T | null {
  if (candidates.length === 0) return null;
  const raw = random();
  const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(raw * candidates.length)));
  return candidates[index] ?? null;
}
