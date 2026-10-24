/**
 * 文件职责：**形象预览服务**（app 层）—— 组合根注入给 hud 向导屏的那一侧实现。
 *   它同时认识三样东西：world 的 LPC 合成栈、Phaser 迷你实例、hud 的端口契约。
 *   任务：.long-run-agent/tasks/task_028.md「hud 向导第②步重做 —— canvas 动画预览 + 随机形象 + 部件选择器」。
 * 输入：素材注册表（PartRegistry）+ 合成器（CharacterComposer）+ 画布/图片工厂 + 预览游戏工厂。
 * 输出：AppearancePreviewPort 的实现（hud 屏只认这个接口，见 hud/screens/appearance-preview-port.ts）。
 * 禁止事项：
 *   1. import hud 的**屏** —— 本文件只 import hud 的**端口类型**（纯类型，编译后零 JS）；
 *      屏不认识本文件（组合根负责接线）；
 *   2. 改 core 的状态 —— 本文件不碰 store / bus，只产出"长什么样"的数据；
 *   3. 直接 document.createElement —— 画布与图片对象由 app 层注入（见 appearance-environment.ts），
 *      world/appearance 是零 DOM 模块，本文件是"绑定层"，同理不自己造 DOM；
 *   4. 无上限缓存 —— 合成画布复用同一张（832×3456），不每次新建。
 *
 * ★ 为什么随机逻辑在这层而不在 hud（@since v3.12，task_032 扩到两件）：
 *   "重随机"要走规则化随机器（normal 档，task_030），"默认形象"要查品牌预设库
 *   （task_031）—— 两者都在 world/appearance，hud 不认识它们（铁律）。
 *   于是屏只发"给我默认形象 / 给我一套随机的"这两个意图，具体取什么由本服务回答。
 */

import type { AppearanceBodyType, CharacterAppearance, DetectableAgentKind } from '../../core/types';
import type {
  AppearanceCategoryInfo,
  AppearancePreviewPort,
} from '../../hud/screens/appearance-preview-port';
import { randomizeAppearance } from '../../world/appearance/appearance-randomizer';
import { BRAND_PRESETS } from '../../world/appearance/brand-presets';
import { CharacterComposer } from '../../world/appearance/character-composer';
import { DEFAULT_ANIMATION } from '../../world/appearance/constants';
import { PartRegistry } from '../../world/appearance/part-registry';

import type { PreviewGameCreator, PreviewGameHandle } from './appearance-preview-game';

/**
 * 参与形象选择的部位类别（任务口径：body / hair / eyes / ears / facial 五类）。
 * why 不把 22 个类别全开：首启向导是"快速挑一个长相"，不是完整的换装器；
 * 五类够表达"这是个人"，其余部位留给 v3.x 的换装面板。
 */
export const PREVIEW_CATEGORIES = ['body', 'hair', 'eyes', 'ears', 'facial'] as const;

/** 部位类别的显示名（中文）。 */
export const PREVIEW_CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  body: '身体（肤色）',
  hair: '头发',
  eyes: '眼睛',
  ears: '耳朵',
  facial: '面部毛发',
});

/**
 * 可选体型（任务口径：male / female 两种）。
 * why 只给两种：LPC 素材虽然有 6 种体型目录，但首启向导只在这两种之间抽 ——
 * 多给会让"随机形象"的组合爆炸，且其余体型的素材覆盖并不齐。
 */
export const PREVIEW_BODY_TYPES: readonly AppearanceBodyType[] = Object.freeze(['male', 'female']);

/** 预览服务构造选项。 */
export interface AppearancePreviewServiceOptions {
  /** 素材注册表（缺省 = 空注册表；正式用请注入已 loadMetadata 的实例或让本服务去加载）。 */
  readonly registry?: PartRegistry;
  /** 合成器（缺省 = 用上面的注册表现造一个）。 */
  readonly composer?: CharacterComposer;
  /** 画布工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createCanvas: () => HTMLCanvasElement;
  /** 图片工厂（world 层零 DOM：由 app 层注入）。 */
  readonly createImage: () => HTMLImageElement;
  /** 预览游戏工厂（Phaser 迷你实例；单测注入假实现）。 */
  readonly createGame: PreviewGameCreator;
  /** 可选体型（缺省 PREVIEW_BODY_TYPES）。 */
  readonly bodyTypes?: readonly AppearanceBodyType[];
  /** 随机源（缺省 Math.random；单测注入固定种子源）。 */
  readonly random?: () => number;
}

/**
 * 造一个形象预览服务。
 *
 * 生命周期：
 *   构造 → 后台加载素材元数据（失败不抛：退化成空清单，向导照常能走完）；
 *   attach(host) → 建 Phaser 迷你实例；
 *   preview(appearance) → 合成（异步）→ 把精灵表交给实例逐帧显示；
 *   destroy() → 销毁实例（向导关闭时调用）。
 */
export function createAppearancePreviewService(
  options: AppearancePreviewServiceOptions
): AppearancePreviewPort {
  const registry = options.registry ?? new PartRegistry();
  const composer =
    options.composer ??
    new CharacterComposer({
      registry,
      createCanvas: options.createCanvas,
      createImage: options.createImage,
    });
  const random = options.random ?? Math.random;
  const bodyTypes = options.bodyTypes ?? PREVIEW_BODY_TYPES;

  /**
   * 素材元数据的加载（**懒加载**）。
   * why 懒：item-metadata.json 有 1.4MB —— 每次启动都拉一遍是白付钱（用户可能根本不看向导）。
   * 真正用到它的地方（whenReady / 向导第②步）才触发第一次加载，之后复用同一个 promise。
   * 失败也 resolve —— 降级成空清单，不卡住向导。
   */
  let readyPromise: Promise<void> | null = null;
  const ensureReady = (): Promise<void> => {
    if (!readyPromise) readyPromise = registry.loadMetadata();
    return readyPromise;
  };

  /** 当前挂着的预览实例与其宿主（同一个宿主重复 attach 是无副作用的）。 */
  let game: PreviewGameHandle | null = null;
  let host: HTMLElement | null = null;
  /** 复用的合成画布（832×3456 —— 重建很贵，务必复用）。 */
  let sheet: HTMLCanvasElement | null = null;
  /** 合成批次号：只有最新一次合成的结果会被显示（丢弃过期结果，避免"闪回旧形象"）。 */
  let composeSeq = 0;

  /** 某类别在某体型下可选的变体（去重 + 排序）。 */
  const variantsFor = (category: string, bodyType: AppearanceBodyType): readonly string[] => {
    const seen = new Set<string>();
    for (const part of registry.getPartsByCategory(category)) {
      // 素材没有该体型 → 这层的图不存在，选了也画不出来（宁可不给）。
      if (!part.required.includes(bodyType)) continue;
      for (const variant of part.variants) seen.add(variant);
    }
    return Array.from(seen).sort();
  };

  /** 从候选里随机挑一个（空候选 → null）。 */
  const pick = <T>(items: readonly T[]): T | null => {
    if (items.length === 0) return null;
    const index = Math.floor(random() * items.length);
    return items[Math.min(Math.max(index, 0), items.length - 1)] ?? null;
  };

  /** 合成一张走路动画的精灵表（复用同一张画布）。 */
  const compose = async (appearance: CharacterAppearance): Promise<HTMLCanvasElement> => {
    const selections = {
      ...registry.getDefaultSelections(appearance.bodyType),
      ...registry.resolveSelections(appearance),
    };
    const target = sheet ?? (sheet = options.createCanvas());
    const result = await composer.composeCharacter(selections, {
      bodyType: appearance.bodyType,
      animations: [DEFAULT_ANIMATION],
      targetCanvas: target,
    });
    return result.canvas;
  };

  /**
   * 按规则随机出一份带 itemId 的外观；素材没加载出来 → parts 为空 → 收敛成 null。
   * （供 preset 的兑底与 randomizeNormal 共用：空 parts = 不编造长相。）
   */
  const ruleRandom = (mode: 'minimal' | 'normal'): CharacterAppearance | null => {
    const bodyType = pick(bodyTypes) ?? bodyTypes[0] ?? 'male';
    const candidate = randomizeAppearance(registry, { mode, bodyType, random });
    return Object.keys(candidate.parts).length > 0 ? candidate : null;
  };

  const destroyGame = (): void => {
    if (!game) return;
    game.destroy();
    game = null;
  };

  return {
    bodyTypes,

    listCategories(bodyType: AppearanceBodyType): readonly AppearanceCategoryInfo[] {
      return PREVIEW_CATEGORIES.map((category) => ({
        category,
        name: PREVIEW_CATEGORY_LABELS[category] ?? category,
        variants: variantsFor(category, bodyType),
      }));
    },

    whenReady(): Promise<void> {
      return ensureReady();
    },

    preset(kind: string): CharacterAppearance | null {
      // 已知 kind → 品牌预设（静态数据：素材元数据没加载也能取，确定性、无随机）。
      const preset = BRAND_PRESETS[kind as DetectableAgentKind];
      if (preset) return preset;
      // 词表外的 kind：minimal 档规则随机一次当默认（task_032 口径）；
      // 素材没就绪（抽不出任何部位）→ null，屏据此提示，不编造长相。
      return ruleRandom('minimal');
    },

    randomizeNormal(): CharacterAppearance | null {
      // 「重随机」按钮：normal 档规则随机（task_030），itemId 精确格式。
      return ruleRandom('normal');
    },

    attach(nextHost: HTMLElement): void {
      // 同一个容器重复挂 → 无副作用（重建 Phaser 实例很贵，别每次重画都重来一遍）。
      if (game && host === nextHost) return;
      destroyGame();
      host = nextHost;
      game = options.createGame(nextHost);
    },

    preview(appearance: CharacterAppearance): void {
      if (!game) return;
      const seq = ++composeSeq;
      void compose(appearance)
        .then((canvas) => {
          // 过期结果直接丢：用户连点"随机"时，只有最后一次该显示。
          if (seq !== composeSeq || !game) return;
          game.setSheet(canvas);
        })
        .catch((error) => {
          console.warn('[AppearancePreviewService] 形象合成失败：', error);
        });
    },

    destroy(): void {
      // 让在途的合成结果作废（否则它会在实例销毁后把图塞回来）。
      composeSeq += 1;
      destroyGame();
      host = null;
      sheet = null;
    },
  };
}
