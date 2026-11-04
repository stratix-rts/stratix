/**
 * 文件职责：**角色的"长相裁决"** —— 一个角色该用哪份外观上场（这是"上场链路"的第一环）。
 *   任务：.long-run-agent/tasks/task_140.md「角色上场——形象合成 + 战场入场走位」。
 * 输入：角色档案里与长相有关的三项（自带外观 / agent 种类 / 角色 id）+ 素材注册表。
 * 输出：一份可交给合成器的 CharacterAppearance（**绝不返回空** —— 空长相 = 战场上的占位圆）。
 * 禁止事项：
 *   1. 碰 DOM / canvas / Image —— 本模块是纯逻辑，合成在 character-composer.ts；
 *   2. import hud / app —— world 只认 core 的类型；
 *   3. 在这里合成精灵表 —— 那是合成器的活，本模块只**选**外观（形状层）；
 *   4. 返回 null 表示"没有长相" —— 调用方（上场管线）需要的是一个能直接用的外观，
 *      没有长相时走品牌预设 / 随机合成，而不是把问题丢给渲染层。
 *
 * ★ 裁决顺序（why 这个顺序）：
 *   1. **角色自带外观**（用户亲手挑的 / 向导里选的）—— 最高优先，绝不覆盖；
 *   2. **品牌预设**（按 agent 种类）—— 六家内置 CLI agent 各自有固定长相（task_031），
 *      同一个 agent 的角色在战场上长得一样 = 用户一眼认出"这是 claude-code 的那个"；
 *   3. **随机合成**（minimal 档）—— 自定义 agent / 没绑种类的角色没有品牌预设，
 *      随机一份（按角色 id 播种 → 同一角色每次恢复长得一样，不会"刷新一次换一张脸"）。
 *
 * why 不用「随机」兜底一切：品牌预设是确定性资产（task_031 的核心价值），
 *   拿随机去覆盖已知品牌 = 白瞎那份库；随机只留给真正没有预设的种类。
 */

import type { CharacterAppearance } from '../../core/types';

import { randomizeAppearance } from './appearance-randomizer';
import { BRAND_PRESETS } from './brand-presets';
import type { BodyType } from './constants';
import type { PartRegistry } from './part-registry';

/** 裁决输入（角色的长相相关字段 —— 不必是完整的 CharacterView）。 */
export interface CharacterLookSource {
  /** 角色 id（随机兜底时用作播种子 —— 同角色同长相）。 */
  readonly id?: string;
  /** 角色自带外观（用户挑的 / 向导选的）。 */
  readonly appearance?: CharacterAppearance | null;
  /** 角色绑定的 agent 种类（品牌预设的查表键）。 */
  readonly agentKind?: string | null;
}

/** 裁决选项。 */
export interface CharacterLookOptions {
  /** 素材注册表（随机兜底要读真实素材清单 —— 不编造长相）。 */
  readonly registry: PartRegistry;
  /** 体型（随机兜底用；缺省 'male'）。 */
  readonly bodyType?: BodyType;
}

/**
 * 裁决一个角色的上场长相。
 *
 * @param source 角色的长相相关字段。
 * @param options 素材注册表 / 体型。
 * @returns 一份可直接合成的外观。
 *   **永不返回 null**：素材元数据没加载出来时随机档会返回 parts 为空的对象 ——
 *   那是"素材缺失"的真实降级（合成器画不出东西 → 渲染层回落到占位形象），
 *   比编造一份假长相诚实。
 */
export function resolveCharacterLook(
  source: CharacterLookSource,
  options: CharacterLookOptions
): CharacterAppearance {
  // ① 角色自带外观 —— 用户挑的，最高优先。
  if (source.appearance) return source.appearance;

  // ② 品牌预设（按 agent 种类）—— 命中词表才用；词表外的（自定义 agent）走随机。
  const kind = source.agentKind ?? '';
  const preset = BRAND_PRESETS[kind as keyof typeof BRAND_PRESETS];
  if (preset) return preset;

  // ③ 随机合成（minimal 档 + 按角色 id 播种 → 同一角色每次都一样）。
  return randomizeAppearance(options.registry, {
    mode: 'minimal',
    bodyType: options.bodyType ?? 'male',
    random: seededRandom(source.id ?? ''),
  });
}

/**
 * 按字符串种子造一个确定性随机源（mulberry32）。
 *
 * why 要确定性：随机兜底若每次调用都换结果，同一角色在"刷新页面"后会换一张脸 ——
 *   用户认不出自己的角色。播种子取角色 id → 同一角色永远同一张脸。
 *
 * @param seed 种子字符串（角色 id）。
 */
export function seededRandom(seed: string): () => number {
  let state = hashString(seed);
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字符串 → 32 位整数种子（FNV-1a）。 */
function hashString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
