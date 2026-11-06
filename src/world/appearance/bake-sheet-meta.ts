/**
 * 文件职责：**烘焙整图的元数据（atlas）** —— 缓存里那张整精灵图的「说明书」（@since v3.3，task_195 / CP-01）。
 *   权威定义：docs/DESIGN-asset-pipelines.md §2.1「产物：部件合成一张整精灵图 + atlas 元数据」。
 * 输入：缓存键 + 角色 id + 版本号 + 皮肤指纹 + 版权署名。
 * 输出：BakedCharacterSheetMeta（纯 JSON —— 要原样落盘成 `<键>.json`）。
 * 禁止事项：
 *   1. 放像素 —— atlas 只描述「图长什么样、动画在哪几行」，像素在 PNG 里；
 *   2. 放运行时状态 —— 这份元数据要能被独立读出（删缓存目录后可整体重建，不依赖别的状态）；
 *   3. 引用活的注册表 / 合成器对象 —— 元数据是**快照**，序列化后自洽。
 *
 * ★ 为什么运行时需要它：
 *   缓存里存的是一张 832×3456 的整精灵图（15 个动画 × 4 个方向），
 *   运行时只想要其中某几个动画的若干帧 —— 「哪几行是哪个动画」这份事实必须跟着图一起存，
 *   否则读缓存的人得再问一遍合成器（那就把「运行时只读整图」又变回「运行时也要懂合成」了）。
 */

import {
  ANIMATION_CONFIGS,
  ANIMATION_OFFSETS,
  FRAME_SIZE,
  FRAMES_PER_ROW,
  SHEET_HEIGHT,
  SHEET_WIDTH,
} from './constants';
import type { CreditInfo } from './types';

/** 整图里的一个动画条目（图集行）。 */
export interface BakedSheetAnimation {
  /** 动画名（代码侧口径，如 'walk' / 'idle'）。 */
  readonly name: string;
  /** 动画起始行号（行号，非像素）。 */
  readonly row: number;
  /** 动画起始行的像素偏移（= 行号 × FRAME_SIZE）。 */
  readonly yPos: number;
  /** 帧数。 */
  readonly frames: number;
  /** 播放循环序列（LPC 的 idle 只有 3 帧但循环表有 15 帧，照抄才不会脚步乱跳）。 */
  readonly cycle: readonly number[];
}

/** 烘焙整图的元数据（与 `<键>.png` 配对落盘）。 */
export interface BakedCharacterSheetMeta {
  /** 缓存键（三要素拼成的那串）。 */
  readonly key: string;
  /** agent 标识（= 角色 id）。 */
  readonly agentId: string;
  /** 合成器版本号（版本变 ⇒ 这份元数据连同 PNG 一起作废）。 */
  readonly composerVersion: string;
  /** 皮肤指纹（换肤 ⇒ 指纹变 ⇒ 键变）。 */
  readonly skinFingerprint: string;
  /** 整图宽（像素）。 */
  readonly width: number;
  /** 整图高（像素）。 */
  readonly height: number;
  /** 单帧边长（像素）。 */
  readonly frameSize: number;
  /** 每行帧数。 */
  readonly framesPerRow: number;
  /** 动画清单（按行号升序）。 */
  readonly animations: readonly BakedSheetAnimation[];
  /** 参与部位的版权署名（LPC 素材要求署名，故合成结果要带出来）。 */
  readonly credits: readonly CreditInfo[];
  /** 烘焙时刻（毫秒时间戳；诊断用，不参与键）。 */
  readonly bakedAt: number;
}

/** 造元数据的入参。 */
export interface BuildBakedSheetMetaInput {
  readonly key: string;
  readonly agentId: string;
  readonly composerVersion: string;
  readonly skinFingerprint: string;
  readonly credits: readonly CreditInfo[];
  /** 烘焙时刻（缺省 = 现在）。 */
  readonly bakedAt?: number;
}

/**
 * 造一份整图元数据。
 *
 * 动画清单取自 constants 的事实源（ANIMATION_OFFSETS / ANIMATION_CONFIGS）——
 * 合成器画的行号与这里描述的行号必须一致（同一份事实源，不会漂）。
 */
export function buildBakedSheetMeta(input: BuildBakedSheetMetaInput): BakedCharacterSheetMeta {
  const animations: BakedSheetAnimation[] = Object.keys(ANIMATION_OFFSETS)
    .map((name) => {
      const config = ANIMATION_CONFIGS[name];
      return {
        name,
        row: config?.row ?? 0,
        yPos: ANIMATION_OFFSETS[name] ?? 0,
        frames: config?.num ?? 1,
        cycle: config?.cycle ?? [0],
      };
    })
    .sort((left, right) => left.row - right.row);

  return {
    key: input.key,
    agentId: input.agentId,
    composerVersion: input.composerVersion,
    skinFingerprint: input.skinFingerprint,
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    frameSize: FRAME_SIZE,
    framesPerRow: FRAMES_PER_ROW,
    animations,
    credits: input.credits,
    bakedAt: input.bakedAt ?? Date.now(),
  };
}
