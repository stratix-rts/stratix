/**
 * 文件职责：**角色烘焙管线**（@since v3.3，task_195 / CP-01）—— 部件合成一张整精灵图 + atlas 元数据，
 *   落进用户本地缓存；运行时优先读缓存图。
 *   权威定义：docs/DESIGN-asset-pipelines.md §2.1（触发与产物）+ §2.2（三条纪律）。
 * 输入：角色 id + 角色外观 + 缓存存取口（app 层）。
 * 输出：CharacterBakeService —— ensureBaked（确保缓存里有）/ loadCachedSheet（运行时取缓存整图）。
 * 禁止事项：
 *   1. import hud —— 本文件不认识任何屏（触发由组合根接总线，见 main-entry.ts）；
 *   2. import pixelfx —— 铁则：两条烘焙管线禁止互卷（DESIGN §0）；
 *   3. 弹错 / 阻塞界面 —— 烘焙失败一律静默降级（DESIGN §2.2 纪律 2：用户永远看到可用结果）；
 *   4. 并发烘焙 —— 合成会占一张 832×3456 的大画布，同时跑多份 = 内存尖峰，故串行；
 *   5. 无上限的内存缓存 —— 记住的只是「哪些键已烘焙」，不缓存像素。
 *
 * ★ 三条纪律怎么落在这里：
 *   - 纪律 1（缓存键三要素）→ world/appearance/bake-cache-key.ts；
 *   - 纪律 2（静默降级）→ 本文件所有失败路径都只 console.warn，返回值表示结果，不抛；
 *   - 纪律 3（可整体重建）→ store.clear() 清目录；下次触发时 ensureBaked 全量重烘。
 */

import type { CharacterAppearance } from '../../core/types';
import { appearanceFingerprint, characterBakeKey } from '../../world/appearance/bake-cache-key';
import {
  buildBakedSheetMeta,
  type BakedCharacterSheetMeta,
} from '../../world/appearance/bake-sheet-meta';
import { CharacterComposer } from '../../world/appearance/character-composer';
import { COMPOSER_VERSION } from '../../world/appearance/composer-version';
import { PartRegistry } from '../../world/appearance/part-registry';

import type { CharacterBakeStore } from './character-bake-store';

/** 一次烘焙的结果。 */
export type CharacterBakeOutcome =
  /** 缓存里已经有了（命中）—— 没有重新合成。 */
  | 'cached'
  /** 本次合成并落盘成功。 */
  | 'baked'
  /** 没烘（无缓存存取口 / 无外观）—— 运行时走直合成。 */
  | 'skipped'
  /** 烘焙失败（静默降级：运行时走直合成）。 */
  | 'failed';

/**
 * 烘焙失败后的重试冷却（毫秒）。
 *
 * why 要冷却：状态广播很频繁（每条任务变更一次），而失败的键不会进「已落盘」记性 ——
 *   没有冷却的话，每次广播都会重试一次整图合成（白烧 CPU 与内存）。
 *   冷却期内直接返回 failed（运行时直合成，用户无感知），过了冷却期自动再试一次。
 */
const BAKE_RETRY_COOLDOWN_MS = 60_000;

/** 触发面：一条角色档案（只要 id 与外观）。 */
export interface CharacterBakeTrigger {
  readonly id: string;
  readonly appearance?: CharacterAppearance | null;
}

/** 烘焙服务构造选项。 */
export interface CharacterBakeServiceOptions {
  /** 素材注册表（要 loadMetadata 过才有部位可选）。 */
  readonly registry: PartRegistry;
  /** 合成器（与预览/战场共用同一实例 —— 位图 LRU 缓存共用）。 */
  readonly composer: CharacterComposer;
  /** 画布工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createCanvas: () => HTMLCanvasElement;
  /** 图片工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createImage: () => HTMLImageElement;
  /**
   * 缓存存取口。
   * 缺省 = 无缓存（纯浏览器 dev 没有 userData）→ 全程降级：烘焙跳过、运行时直合成。
   */
  readonly store?: CharacterBakeStore | null;
  /** 合成器版本号（缺省 = 当前 COMPOSER_VERSION；单测可注入别的版本验证失效）。 */
  readonly composerVersion?: string;
}

/** 角色烘焙服务。 */
export interface CharacterBakeService {
  /**
   * 确保缓存里有这个角色 × 这套皮肤的整图（幂等）。
   * 命中缓存 → 不重新合成；未命中 → 合成整图 + 落盘。
   */
  ensureBaked(agentId: string, appearance: CharacterAppearance): Promise<CharacterBakeOutcome>;
  /**
   * 运行时取缓存里的整图（**只读**：命中返回画布，未命中/失败返回 null → 调用方直合成）。
   */
  loadCachedSheet(
    agentId: string,
    appearance: CharacterAppearance
  ): Promise<HTMLCanvasElement | null>;
  /**
   * 触发面：把一批角色档案里「有外观」的逐个确保烘焙（**两个触发点都收敛到这里**）。
   */
  syncCharacters(characters: readonly CharacterBakeTrigger[]): void;
  /** 清空缓存（删目录）并忘掉「已烘焙」的记性 —— 下次触发全量重烘（纪律 3）。 */
  clearCache(): Promise<void>;
}

/**
 * 造一个角色烘焙服务。
 *
 * 生命周期：构造（不做事）→ syncCharacters / ensureBaked（触发）→ loadCachedSheet（运行时取图）。
 */
export function createCharacterBakeService(
  options: CharacterBakeServiceOptions
): CharacterBakeService {
  const { registry, composer, createCanvas, createImage } = options;
  const store = options.store ?? null;
  const composerVersion = options.composerVersion ?? COMPOSER_VERSION;

  /** 已确认落盘的键（本次会话内）—— 避免每次状态广播都去磁盘问一遍。 */
  const bakedKeys = new Set<string>();
  /** 烘焙失败的键与时刻（键 → 上次失败时间戳）。 */
  const failedAt = new Map<string, number>();
  /** 在途的烘焙（按键去重 —— 同一角色被连着触发两次只烘一次）。 */
  const inflight = new Map<string, Promise<CharacterBakeOutcome>>();
  /** 烘焙串行链（同一时刻只烘一份 —— 大画布 + PNG 编码，别并发）。 */
  let chain: Promise<unknown> = Promise.resolve();
  /** 复用的合成画布（832×3456 —— 重建很贵，务必复用）。 */
  let sheet: HTMLCanvasElement | null = null;

  /** 把一段活排进串行链。 */
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = chain.then(task, task);
    // 链上不留失败：一次烘焙失败不该让后面的烘焙跟着失败。
    chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  /** 缓存键（版本号走服务上的那份 —— 与触发面用同一口径）。 */
  const keyOf = (agentId: string, appearance: CharacterAppearance): string =>
    characterBakeKey({ agentId, appearance, composerVersion });

  /** 真烘一次：合成整图 → 编码 PNG → 落盘（外层已串行化）。 */
  const bakeOnce = async (
    agentId: string,
    appearance: CharacterAppearance,
    key: string
  ): Promise<CharacterBakeOutcome> => {
    if (!store) return 'skipped';
    try {
      // 元数据没加载出来就没有部位可选（注册表会退化成空表）。
      await registry.loadMetadata();

      const selections = {
        ...registry.getDefaultSelections(appearance.bodyType),
        ...registry.resolveSelections(appearance),
      };
      const target = sheet ?? (sheet = createCanvas());
      // 合成**全部动画**（合成器的缺省口径）= 一张整精灵图（DESIGN §2.1 的产物定义）。
      const composed = await composer.composeCharacter(selections, {
        bodyType: appearance.bodyType,
        targetCanvas: target,
      });

      const pngBase64 = encodePng(composed.canvas);
      if (!pngBase64) {
        console.warn('[CharacterBake] 整图编码失败（本次不落盘，运行时直合成）');
        failedAt.set(key, Date.now());
        return 'failed';
      }

      const meta: BakedCharacterSheetMeta = buildBakedSheetMeta({
        key,
        agentId,
        composerVersion,
        skinFingerprint: appearanceFingerprint(appearance),
        credits: composed.credits,
      });
      await store.write(key, pngBase64, meta);
      bakedKeys.add(key);
      failedAt.delete(key);
      return 'baked';
    } catch (error) {
      // 静默降级（纪律 2）：失败只进日志，用户看到的仍是可用结果（运行时直合成）。
      console.warn('[CharacterBake] 角色烘焙失败（降级为运行时直合成）：', error);
      failedAt.set(key, Date.now());
      return 'failed';
    }
  };

  /** 确保缓存里有（幂等）。 */
  const ensureBaked = async (
    agentId: string,
    appearance: CharacterAppearance
  ): Promise<CharacterBakeOutcome> => {
    if (!store) return 'skipped';
    const key = keyOf(agentId, appearance);
    // 本次会话内已经确认落盘 → 不重复问磁盘。
    if (bakedKeys.has(key)) return 'cached';
    // 刚失败过 ⇒ 冷却期内不重试（状态广播很频繁，每次都重烘一遍是烧 CPU）。
    const lastFailure = failedAt.get(key);
    if (lastFailure !== undefined && Date.now() - lastFailure < BAKE_RETRY_COOLDOWN_MS) {
      return 'failed';
    }
    // 在途的同一键 → 等它，不重复烘。
    const running = inflight.get(key);
    if (running) return running;

    const task = enqueue(async () => {
      // 进链子后先看一眼磁盘：上次烘过（换了个进程 / 清了内存记性）就直接复用。
      const hit = await readCachedEntry(store, key);
      if (hit) {
        bakedKeys.add(key);
        failedAt.delete(key);
        return 'cached' as CharacterBakeOutcome;
      }
      return bakeOnce(agentId, appearance, key);
    });
    inflight.set(key, task);
    try {
      return await task;
    } finally {
      inflight.delete(key);
    }
  };

  /** 运行时取缓存整图（只读；未命中 → null）。 */
  const loadCachedSheet = async (
    agentId: string,
    appearance: CharacterAppearance
  ): Promise<HTMLCanvasElement | null> => {
    if (!store) return null;
    const key = keyOf(agentId, appearance);
    try {
      const hit = await readCachedEntry(store, key);
      if (!hit) return null;
      return await decodePng(hit.pngBase64, hit.meta, createCanvas, createImage);
    } catch (error) {
      // 静默降级：缓存读不出来就当没有，运行时直合成。
      console.warn('[CharacterBake] 读取烘焙缓存失败（降级为运行时直合成）：', error);
      return null;
    }
  };

  /** 触发面：把一批角色档案里「有外观」的逐个确保烘焙。 */
  const syncCharacters = (characters: readonly CharacterBakeTrigger[]): void => {
    if (!store) return;
    for (const character of characters) {
      const appearance = character.appearance;
      if (!appearance) continue;
      void ensureBaked(character.id, appearance).catch((error: unknown) => {
        console.warn('[CharacterBake] 触发烘焙失败：', error);
      });
    }
  };

  /** 清空缓存（删目录）并忘掉「已烘焙」的记性 —— 下次触发全量重烘（纪律 3）。 */
  const clearCache = async (): Promise<void> => {
    bakedKeys.clear();
    failedAt.clear();
    inflight.clear();
    if (!store) return;
    try {
      await store.clear();
    } catch (error) {
      console.warn('[CharacterBake] 清空烘焙缓存失败：', error);
    }
  };

  return { ensureBaked, loadCachedSheet, syncCharacters, clearCache };
}

/**
 * 读一条缓存产物（读不出来 = 当作没有）。
 *
 * why 不直接用 store.read：存取失败与「未命中」在服务层要**同等对待** ——
 *   两者都不该让上层炸；区别只在于「未命中」会触发一次烘焙，失败同样会（重试的机会）。
 */
async function readCachedEntry(
  store: CharacterBakeStore,
  key: string
): Promise<Awaited<ReturnType<CharacterBakeStore['read']>>> {
  try {
    return await store.read(key);
  } catch (error) {
    console.warn('[CharacterBake] 读取烘焙缓存失败（按未命中处理）：', error);
    return null;
  }
}

/**
 * 画布 → PNG 的 base64（不带 data URL 前缀 —— 主进程那边要的是裸字节）。
 *
 * why 不用 toBlob：toBlob 是异步回调式，编码同样一张图却拿不到同步结果，
 *   而这里要的就是「编码完直接落盘」这一条直线。
 */
function encodePng(canvas: HTMLCanvasElement): string | null {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const marker = 'data:image/png;base64,';
    if (!dataUrl.startsWith(marker)) return null;
    const payload = dataUrl.slice(marker.length);
    return payload.length > 0 ? payload : null;
  } catch (error) {
    console.warn('[CharacterBake] 整图编码失败：', error);
    return null;
  }
}

/**
 * 缓存里的 PNG → 画布。
 *
 * why 走 data URL 而不是 file:// 路径：file:// 的图画进 canvas 会**污染**画布
 *   （tainted），之后 getImageData 就废了（战场那条「整条精灵带全透明」的判空就靠它）。
 *   data URL 不污染 —— 读缓存图与现合成图在像素读取上完全同权。
 */
async function decodePng(
  pngBase64: string,
  meta: BakedCharacterSheetMeta,
  createCanvas: () => HTMLCanvasElement,
  createImage: () => HTMLImageElement
): Promise<HTMLCanvasElement | null> {
  const image = createImage();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('烘焙缓存整图加载失败'));
    image.src = `data:image/png;base64,${pngBase64}`;
  });

  const canvas = createCanvas();
  canvas.width = meta.width;
  canvas.height = meta.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return canvas;
}
