/**
 * 文件职责：**单位形象精灵源**（app 层实现）—— 把角色的 LPC 外观合成成战场用的走路精灵带。
 *   任务：.long-run-agent/tasks/task_029.md「战场单位渲染用 AgentProfile.appearance 合成形象」。
 * 输入：注册表（PartRegistry）+ 合成器（CharacterComposer）+ 画布工厂（app 层注入）。
 * 输出：UnitSpriteSource（world 侧端口的实现，见 world/objects/unit-sprite-source.ts）。
 * 禁止事项：
 *   1. import hud —— 本文件不认识任何屏；
 *   2. import world/scenes / world/objects 的 Phaser 件 —— 合成是纯 canvas 活，
 *      Phaser 的贴图与帧步进在 world 侧（unit-layer.ts）；
 *   3. 直接 document.createElement —— 画布工厂由 app 层注入（见 appearance-environment.ts），
 *      world/appearance 是零 DOM 模块，本文件是绑定层，同理不自己造 DOM；
 *   4. 每次请求都新建一张 832×3456 的合成大图 —— 合成画布复用同一张（重建很贵）；
 *   5. 并发合成共用一张画布 —— 合成串行执行（见 composeChain）。
 *
 * ★ 为什么要"精灵带"而不是整张精灵表：
 *   LPC 一张完整精灵表是 832×3456（约 11MB），而战场只需要"走路"这一个动画的 4 个方向。
 *   故合成完立刻裁出走路那 4 行（832×256），上传进显存的就只有这一条。
 *
 * ★ 烘焙缓存优先（@since v3.3，task_195 / CP-01）：
 *   整精灵图会被烘焙进用户本地缓存（见 app/services/character-bake-service.ts），
 *   本实现**先读缓存图**再裁带；没有缓存才合成（现状路径）。
 *   缓存图与现合成图同权 —— 两者都是像素，判空口径一致。
 */

import type { CharacterAppearance } from '../../core/types';
import { CharacterComposer } from '../../world/appearance/character-composer';
import {
  ANIMATION_OFFSETS,
  DEFAULT_ANIMATION,
  FRAME_SIZE,
} from '../../world/appearance/constants';
import { PartRegistry } from '../../world/appearance/part-registry';
import { UNIT_SHEET_COLUMNS } from '../../world/objects/unit-sprite-sheet';
import type { UnitSpriteSource } from '../../world/objects/unit-sprite-source';

/** 合成源构造选项。 */
export interface UnitSpriteSourceOptions {
  /** 素材注册表（要与预览服务共用同一个实例 —— 元数据只加载一次）。 */
  readonly registry: PartRegistry;
  /** 合成器（与预览服务共用同一个实例 —— 位图 LRU 缓存共用）。 */
  readonly composer: CharacterComposer;
  /** 画布工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createCanvas: () => HTMLCanvasElement;
  /**
   * 角色长相裁决（@since v3.8，task_140）：角色没自带外观时，按 agent 种类取品牌预设
   *   / 随机合成（见 world/appearance/character-look.ts）。
   *   由 app 层注入 —— world 层不认"品牌预设"这份知识（那是形象域的事）。
   *   缺省 = 不给兜底（角色没外观就没有形象，渲染层回落到占位形体）。
   */
  readonly resolveAppearance?: (characterId: string) => CharacterAppearance | null;
  /**
   * 烘焙缓存整图的读取口（@since v3.3，task_195 / CP-01）：**运行时优先读缓存图**，
   *   没有缓存才走现状的直合成（DESIGN §2.1「运行时一律只读整图」）。
   *   缺省 = 没有缓存这回事（行为与今天一致）。
   */
  readonly loadCachedSheet?: (
    characterId: string,
    appearance: CharacterAppearance
  ) => Promise<HTMLCanvasElement | null>;
}

/**
 * 造一个单位形象精灵源。
 *
 * 生命周期：每次 loadWalkBand → 等元数据就绪 → 合成 → 裁出走路 4 行 → 交出画布。
 */
export function createUnitSpriteSource(options: UnitSpriteSourceOptions): UnitSpriteSource {
  const { registry, composer, createCanvas, resolveAppearance, loadCachedSheet } = options;

  /** 复用的合成画布（832×3456 —— 重建很贵，务必复用）。 */
  let sheet: HTMLCanvasElement | null = null;
  /**
   * 合成串行链。
   * why 串行：合成器会把图画到**传入的那张画布**上 —— 两个合成同时跑会互相踩画面。
   * 故排队执行（串行也顺带压住了内存峰值：同一时刻只有一张合成大图）。
   */
  let composeChain: Promise<unknown> = Promise.resolve();
  /**
   * 兜底长相的缓存（角色 id → 外观）。
   * why 要缓存：兜底裁决里含随机合成（按角色 id 播种）—— 不缓存的话每次重试都会
   *   重新抽一份，同一角色可能前后两张脸。缓存住也顺带压掉重复裁决的开销。
   */
  const fallbackLooks = new Map<string, CharacterAppearance | null>();

  /**
   * 兜底长相（角色没自带外观时）。
   * why 缓存：裁决含随机合成，不缓存则每次重试都可能换一张脸。
   */
  const resolveFallback = (characterId: string): CharacterAppearance | null => {
    if (!resolveAppearance) return null;
    if (fallbackLooks.has(characterId)) return fallbackLooks.get(characterId) ?? null;
    let resolved: CharacterAppearance | null = null;
    try {
      resolved = resolveAppearance(characterId);
    } catch (error) {
      console.warn(`[UnitSpriteSource] 角色 ${characterId} 的兜底长相裁决失败：`, error);
      resolved = null;
    }
    fallbackLooks.set(characterId, resolved);
    return resolved;
  };

  /** 把一段合成排进链子里跑。 */
  const enqueue = <T,>(task: () => Promise<T>): Promise<T> => {
    const result = composeChain.then(task, task);
    // 链上不留失败：一次合成失败不该让后面的合成跟着失败。
    composeChain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  };

  /** 裁出精灵表里的"走路"4 行（上下左右），并按走路帧裁掉用不到的列。 */
  const cropWalkBand = (source: HTMLCanvasElement): HTMLCanvasElement => {
    const walk = ANIMATION_OFFSETS[DEFAULT_ANIMATION];
    // 列数取自帧序事实源（world/objects/unit-sprite-sheet）：走路帧最大列号 + 1。
    const width = UNIT_SHEET_COLUMNS * FRAME_SIZE;
    const height = 4 * FRAME_SIZE;

    const band = createCanvas();
    band.width = width;
    band.height = height;
    const ctx = band.getContext('2d');
    if (!ctx) return band;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(
      source,
      0, walk, width, height,
      0, 0, width, height
    );
    return band;
  };

  return {
    async loadWalkBand(
      characterId: string,
      appearance: CharacterAppearance | null
    ): Promise<HTMLCanvasElement | null> {
      try {
        // 元数据没加载出来就没有部位可选（注册表会退化成空表）。
        await registry.loadMetadata();

        // 角色没自带外观 → 走兜底裁决（品牌预设 / 随机合成，见 character-look.ts）。
        // 裁决不出（没注入裁决器 / 角色查不到）→ null，渲染层回落占位形象。
        const effective = appearance ?? resolveFallback(characterId);
        if (!effective) return null;

        // ===== 运行时优先读烘焙缓存图（@since v3.3，task_195 / CP-01）=====
        // why 在最前面：缓存图是**整精灵图**，裁走路那 4 行即可 —— 省掉整轮合成
        //   （合成要逐层取图 + 画 832×3456，是战场进场的最大一笔开销）。
        // 没缓存 / 缓存图是空的 → 落回现状的直合成（静默降级，用户无感知）。
        if (loadCachedSheet) {
          const cached = await loadCachedSheet(characterId, effective);
          if (cached) {
            const cachedBand = cropWalkBand(cached);
            if (!isBlankBand(cachedBand)) return cachedBand;
            console.warn(`[UnitSpriteSource] 角色 ${characterId} 的缓存整图为空，回落直合成`);
          }
        }

        return await enqueue(async () => {
          const selections = {
            ...registry.getDefaultSelections(effective.bodyType),
            ...registry.resolveSelections(effective),
          };
          const target = sheet ?? (sheet = createCanvas());
          const composed = await composer.composeCharacter(selections, {
            bodyType: effective.bodyType,
            animations: [DEFAULT_ANIMATION],
            targetCanvas: target,
          });
          const band = cropWalkBand(composed.canvas);
          // 素材缺失的**真降级**：整条精灵带全透明 = 一张看不见的图 ——
          // 与其贴一张空图（战场看着像"没这个单位"），不如回落到占位形象。
          if (isBlankBand(band)) {
            console.warn(
              `[UnitSpriteSource] 角色 ${characterId} 的素材全缺失，回落占位形象`
            );
            return null;
          }
          return band;
        });
      } catch (error) {
        console.warn(`[UnitSpriteSource] 角色 ${characterId} 的形象合成失败：`, error);
        return null;
      }
    },
  };
}

/**
 * 精灵带是不是"全空"（一个非透明像素都没有）。
 *
 * why 要判：素材整体缺失（路径改名 / 元数据加载失败）时，合成器会**跳过每一层**，
 *   交出一条全透明的画布 —— 贴上去等于战场少了一个单位（看着像"角色没上场"）。
 *   判出来回落到占位形象，战场不空、也不崩。
 *
 * @param band 精灵带画布。
 */
export function isBlankBand(band: HTMLCanvasElement): boolean {
  const ctx = band.getContext('2d');
  if (!ctx) return true;
  try {
    const data = ctx.getImageData(0, 0, band.width, band.height).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return false;
    }
    return true;
  } catch (error) {
    // 画布被污染（tainted）读不出像素 → 保守当作"有内容"（别误伤正常精灵带）。
    console.warn('[UnitSpriteSource] 精灵带像素读取失败，按有内容处理：', error);
    return false;
  }
}
