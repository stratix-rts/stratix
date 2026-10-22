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
}

/**
 * 造一个单位形象精灵源。
 *
 * 生命周期：每次 loadWalkBand → 等元数据就绪 → 合成 → 裁出走路 4 行 → 交出画布。
 */
export function createUnitSpriteSource(options: UnitSpriteSourceOptions): UnitSpriteSource {
  const { registry, composer, createCanvas } = options;

  /** 复用的合成画布（832×3456 —— 重建很贵，务必复用）。 */
  let sheet: HTMLCanvasElement | null = null;
  /**
   * 合成串行链。
   * why 串行：合成器会把图画到**传入的那张画布**上 —— 两个合成同时跑会互相踩画面。
   * 故排队执行（串行也顺带压住了内存峰值：同一时刻只有一张合成大图）。
   */
  let composeChain: Promise<unknown> = Promise.resolve();

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
      appearance: CharacterAppearance
    ): Promise<HTMLCanvasElement | null> {
      try {
        // 元数据没加载出来就没有部位可选（注册表会退化成空表）。
        await registry.loadMetadata();
        return await enqueue(async () => {
          const selections = {
            ...registry.getDefaultSelections(appearance.bodyType),
            ...registry.resolveSelections(appearance),
          };
          const target = sheet ?? (sheet = createCanvas());
          const composed = await composer.composeCharacter(selections, {
            bodyType: appearance.bodyType,
            animations: [DEFAULT_ANIMATION],
            targetCanvas: target,
          });
          return cropWalkBand(composed.canvas);
        });
      } catch (error) {
        console.warn(`[UnitSpriteSource] 角色 ${characterId} 的形象合成失败：`, error);
        return null;
      }
    },
  };
}
