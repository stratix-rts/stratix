/**
 * 文件职责：**角色烘焙管线**（@since v3.3，task_195 / CP-01；task_196 / CP-02 补静默降级）——
 *   部件合成一张整精灵图 + atlas 元数据，落进用户本地缓存；运行时优先读缓存图。
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
 *   - 纪律 2（静默降级）→ 本文件所有失败路径都只记内部日志，返回值表示结果，不抛；
 *   - 纪律 3（可整体重建）→ store.clear() 清目录；下次触发时 ensureBaked 全量重烘。
 *
 * ★ 纪律 2 的四类失败面（@since v3.3，task_196 / CP-02）：
 *   失败一律回落「运行时直接合成」（CP-01 之前的现状路径），用户永远看到可用结果；
 *   失败只进**内部日志**（agent / 皮肤 / 原因俱全，事后可定位），不弹错、不阻塞、不冒泡到 UI 层。
 *   ① 部件缺件（parts-missing）：元数据取不到 / **真缺件**（目录在、文件缺）/ 合成计划为空 / 画出全透明；
 *      —— 真缺件与**合法缺失**是两级（@since v3.3，task_209 / CP-04）：
 *      合法缺失 = 素材库该层该动画本就没有文件（目录不存在，如 LPC 人眼层的 eyes×climb）
 *      ⇒ 该格留空/透明（与运行时直合成结果一致）⇒ **不阻断烘焙**。
 *   ② 渲染失败（render-failed）：合成抛错 / 整图 PNG 编码失败；
 *   ③ 缓存目录不可写（cache-unwritable）：落盘失败（权限 / 磁盘满 / IPC 断）；
 *   ④ 版本损坏（cache-corrupt）：缓存产物版本 / 键 / 指纹 / 结构对不上，或文件本身坏了。
 */

import type { CharacterAppearance } from '../../core/types';
import { appearanceFingerprint, characterBakeKey } from '../../world/appearance/bake-cache-key';
import {
  buildBakedSheetMeta,
  type BakedCharacterSheetMeta,
} from '../../world/appearance/bake-sheet-meta';
import { CharacterComposer } from '../../world/appearance/character-composer';
import { COMPOSER_VERSION } from '../../world/appearance/composer-version';
import { ANIMATION_OFFSETS, DEFAULT_ANIMATION, FRAME_SIZE, SHEET_WIDTH } from '../../world/appearance/constants';
import { PartRegistry } from '../../world/appearance/part-registry';
import type { PartSelection } from '../../world/appearance/types';

import type { CharacterBakeEntry, CharacterBakeStore } from './character-bake-store';
import { characterBakeStoreErrorKind } from './character-bake-store';

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
 * 静默降级的**原因码**（@since v3.3，task_196 / CP-02）。
 *
 * why 要有码：内部日志要能事后定位「哪一类失败面」—— 四类失败面的修法完全不同
 *   （补素材 / 修合成器 / 修目录权限 / 修版本键），混成一句「烘焙失败」就没法用。
 */
export type CharacterBakeDegradeReason =
  /** ① 部件缺件：元数据/部位解析失败、某层素材取不到、合成计划为空、画出全透明。 */
  | 'parts-missing'
  /** ② 渲染失败：合成抛错、整图 PNG 编码失败。 */
  | 'render-failed'
  /** ③ 缓存目录不可写：落盘失败（权限 / 磁盘满 / IPC 断）。 */
  | 'cache-unwritable'
  /** ④ 版本损坏：缓存产物的版本 / 键 / 指纹 / 结构对不上，或缓存文件本身坏了。 */
  | 'cache-corrupt'
  /** 附：缓存读不出来（环境不配合）—— 按未命中处理（触发一次重烘）。 */
  | 'cache-unreadable';

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
  /**
   * 内部日志口（@since v3.3，task_196 / CP-02）。
   *
   * why 走注入口：app 侧的日志惯例是「服务自己不认识日志通道，由组合根注入」
   *   （见 agent-detector / chat-history / health-monitor 的 logger 选项）。
   * 缺省 = console.warn（本服务自己的默认通道；日志只是内部诊断，不是用户可见反馈）。
   */
  readonly logger?: (line: string) => void;
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
  const logger = options.logger ?? ((line: string): void => console.warn(line));

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

  /**
   * 记一条**内部**日志（降级现场）。
   *
   * why 要带齐 agent / 皮肤 / 原因：烘焙失败对用户是静默的（纪律 2），
   *   于是内部日志就是**唯一**的事后线索 —— 少了任何一项，事后都无法定位是哪张脸、哪一类问题。
   */
  const logDegrade = (
    reason: CharacterBakeDegradeReason,
    agentId: string,
    appearance: CharacterAppearance,
    detail: string
  ): void => {
    logger(
      `[CharacterBake] 静默降级（回落运行时直合成）：` +
        `agent=${agentId} skin=${appearanceFingerprint(appearance)} 原因=${reason} 细节=${detail}`
    );
  };

  /** 校验缓存产物是否配得上当前这次烘焙（不合格 = 版本损坏面）。 */
  const inspectEntry = (
    entry: CharacterBakeEntry,
    expected: { key: string; skinFingerprint: string }
  ): string | null => {
    const meta = entry.meta as BakedCharacterSheetMeta | undefined;
    if (!meta) return '元数据缺失';
    if (meta.key !== expected.key) return `缓存键不符（缓存=${meta.key} 当前=${expected.key}）`;
    if (meta.composerVersion !== composerVersion) {
      return `合成器版本不符（缓存=${meta.composerVersion} 当前=${composerVersion}）`;
    }
    if (meta.skinFingerprint !== expected.skinFingerprint) {
      return `皮肤指纹不符（缓存=${meta.skinFingerprint} 当前=${expected.skinFingerprint}）`;
    }
    if (!isPositiveInt(meta.width) || !isPositiveInt(meta.height)) return '整图尺寸非法';
    if (!isPositiveInt(meta.frameSize)) return '帧尺寸非法';
    if (typeof entry.pngBase64 !== 'string' || entry.pngBase64.length === 0) return 'PNG 数据为空';
    return null;
  };

  /**
   * 读一条缓存产物（读不出来 = 当作没有）。
   *
   * why 不直接用 store.read：存取失败与「未命中」在服务层要**同等对待** ——
   *   两者都不该让上层炸；区别只在于「未命中」会触发一次烘焙，失败同样会（重试的机会）。
   * why 要分「坏了」（corrupt）与「环境不配合」（unavailable）：
   *   前者要重烘修好，后者重烘也会白烧（降温重试即可）。
   */
  const readCachedEntry = async (
    target: CharacterBakeStore,
    agentId: string,
    appearance: CharacterAppearance,
    key: string
  ): Promise<
    | { readonly kind: 'hit'; readonly entry: CharacterBakeEntry }
    | { readonly kind: 'miss' }
    | { readonly kind: 'corrupt' }
  > => {
    let entry: CharacterBakeEntry | null = null;
    try {
      entry = await target.read(key);
    } catch (error) {
      const kind = characterBakeStoreErrorKind(error);
      if (kind === 'corrupt') {
        logDegrade('cache-corrupt', agentId, appearance, `缓存文件损坏（按未命中处理）：${describeError(error)}`);
        return { kind: 'corrupt' };
      }
      logDegrade('cache-unreadable', agentId, appearance, `读取缓存失败（按未命中处理）：${describeError(error)}`);
      return { kind: 'miss' };
    }
    if (!entry) return { kind: 'miss' };
    const invalid = inspectEntry(entry, { key, skinFingerprint: appearanceFingerprint(appearance) });
    if (invalid) {
      logDegrade('cache-corrupt', agentId, appearance, `缓存产物不合格（按未命中处理）：${invalid}`);
      return { kind: 'corrupt' };
    }
    return { kind: 'hit', entry };
  };

  /** 真烘一次：合成整图 → 校验 → 编码 PNG → 落盘（外层已串行化）。 */
  const bakeOnce = async (
    agentId: string,
    appearance: CharacterAppearance,
    key: string
  ): Promise<CharacterBakeOutcome> => {
    if (!store) return 'skipped';

    // ===== 阶段 1：元数据 + 部位展开（失败面 ① 部件缺件）=====
    let selections: Record<string, PartSelection>;
    try {
      // 元数据没加载出来就没有部位可选（注册表会退化成空表）。
      await registry.loadMetadata();
      selections = {
        ...registry.getDefaultSelections(appearance.bodyType),
        ...registry.resolveSelections(appearance),
      };
    } catch (error) {
      logDegrade('parts-missing', agentId, appearance, `元数据/部位解析失败：${describeError(error)}`);
      failedAt.set(key, Date.now());
      return 'failed';
    }

    // ===== 阶段 2：合成整图（失败面 ② 渲染失败）=====
    let composed: Awaited<ReturnType<CharacterComposer['composeCharacter']>>;
    try {
      const target = sheet ?? (sheet = createCanvas());
      // 合成**全部动画**（合成器的缺省口径）= 一张整精灵图（DESIGN §2.1 的产物定义）。
      composed = await composer.composeCharacter(selections, {
        bodyType: appearance.bodyType,
        targetCanvas: target,
      });
    } catch (error) {
      logDegrade('render-failed', agentId, appearance, `合成整图失败：${describeError(error)}`);
      failedAt.set(key, Date.now());
      return 'failed';
    }

    // ===== 阶段 3：缺件校验（失败面 ① 部件缺件）=====
    // why 缺件也算失败：合成器对单张缺图是「跳过该层照常出图」的降级，
    //   但那是一张**少了几层**的图 —— 烤进缓存就等于把坏素材永久固化（DESIGN §2.2 纪律 1 的原意）。
    //   宁可这次不烘（运行时直合成，用户看到的与今天一致），并把缺件名单记进内部日志。
    //
    // ★ 缺件分两级（@since v3.3，task_209 / CP-04）：
    //   failedParts = **真缺件**（元数据声称有、动画目录也在，只是文件丢了/坏了）
    //     → 失败面：静默降级（回落运行时直合成）。
    //   missingParts = **合法缺失**（素材库该层该动画本就没有文件 ⇒ 目录不存在，
    //     如 LPC 人眼层的 eyes×climb）→ 该格留空/透明，与运行时直合成**结果一致**，
    //     不是坏素材 ⇒ 不阻断烘焙（只记一条内部日志，便于事后看素材覆盖度）。
    const missing = composed.failedParts ?? [];
    if (missing.length > 0) {
      logDegrade(
        'parts-missing',
        agentId,
        appearance,
        `缺件 ${missing.length} 层：${missing.slice(0, 5).join('、')}`
      );
      failedAt.set(key, Date.now());
      return 'failed';
    }
    const absent = composed.missingParts ?? [];
    if (absent.length > 0) {
      logger(
        `[CharacterBake] 合法缺失 ${absent.length} 格（素材库该层该动画本就没有文件）：` +
          `${absent.slice(0, 5).join('、')}`
      );
    }
    if (composed.parts.length === 0) {
      logDegrade('parts-missing', agentId, appearance, '合成计划为空（没有可画的层）');
      failedAt.set(key, Date.now());
      return 'failed';
    }
    // 走路那几行一个像素都没有 = 画出来是张空图（贴上去等于「没这个单位」）。
    if (!hasPixelsInWalkBand(composed.canvas)) {
      logDegrade('parts-missing', agentId, appearance, '合成结果是全透明画布（走路帧无像素）');
      failedAt.set(key, Date.now());
      return 'failed';
    }

    // ===== 阶段 4：编码 PNG（失败面 ② 渲染失败）=====
    const pngBase64 = encodePng(composed.canvas);
    if (!pngBase64) {
      logDegrade('render-failed', agentId, appearance, '整图 PNG 编码失败');
      failedAt.set(key, Date.now());
      return 'failed';
    }

    // ===== 阶段 5：落盘（失败面 ③ 缓存目录不可写）=====
    const meta: BakedCharacterSheetMeta = buildBakedSheetMeta({
      key,
      agentId,
      composerVersion,
      skinFingerprint: appearanceFingerprint(appearance),
      credits: composed.credits,
    });
    try {
      await store.write(key, pngBase64, meta);
    } catch (error) {
      logDegrade('cache-unwritable', agentId, appearance, `写入缓存失败：${describeError(error)}`);
      failedAt.set(key, Date.now());
      return 'failed';
    }
    bakedKeys.add(key);
    failedAt.delete(key);
    return 'baked';
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
      const hit = await readCachedEntry(store, agentId, appearance, key);
      if (hit.kind === 'hit') {
        bakedKeys.add(key);
        failedAt.delete(key);
        return 'cached' as CharacterBakeOutcome;
      }
      // 命中不了（未命中 / 缓存坏了）→ 烘一炉新的（坏的会被这次覆盖修好）。
      return bakeOnce(agentId, appearance, key);
    });
    inflight.set(key, task);
    try {
      return await task;
    } finally {
      inflight.delete(key);
    }
  };

  /** 运行时取缓存整图（只读；未命中 / 坏了 → null → 调用方直合成）。 */
  const loadCachedSheet = async (
    agentId: string,
    appearance: CharacterAppearance
  ): Promise<HTMLCanvasElement | null> => {
    if (!store) return null;
    const key = keyOf(agentId, appearance);
    const hit = await readCachedEntry(store, agentId, appearance, key);
    if (hit.kind !== 'hit') return null;
    try {
      const decoded = await decodePng(hit.entry.pngBase64, hit.entry.meta, createCanvas, createImage);
      if (!decoded) {
        logDegrade('cache-corrupt', agentId, appearance, '缓存整图解码失败（拿不到画布上下文）');
        return null;
      }
      // 空图 = 缓存里那张图没用（贴上去等于「没这个单位」）→ 当损坏处理，回落直合成。
      if (!hasPixelsInWalkBand(decoded)) {
        logDegrade('cache-corrupt', agentId, appearance, '缓存整图是空图（走路帧无像素）');
        return null;
      }
      return decoded;
    } catch (error) {
      // 静默降级：缓存读不出来就当没有，运行时直合成。
      logDegrade('cache-corrupt', agentId, appearance, `缓存整图解码失败：${describeError(error)}`);
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
        // 兜底兜底：ensureBaked 本身不抛，但万一抛了也不能冒泡到 UI 层。
        logger(`[CharacterBake] 触发烘焙失败（已静默）：agent=${character.id} ${describeError(error)}`);
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
      logger(`[CharacterBake] 清空烘焙缓存失败（已静默）：${describeError(error)}`);
    }
  };

  return { ensureBaked, loadCachedSheet, syncCharacters, clearCache };
}

/** 正整数（尺寸类字段的合法性判定）。 */
function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * 走路那几行里有没有非透明像素。
 *
 * why 只看走路那几行：运行时只用得到走路动画（战场单位带），
 *   全图 832×3456 读一遍像素是 11MB 的一次性开销，而走路带只有 832×256 —— 读它就够判「这张图有没有用」。
 * why 读不出像素时按「有内容」处理：画布被污染（tainted）或上下文不可用时不该反过来把正常缓存判成坏的。
 */
function hasPixelsInWalkBand(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d');
  if (!ctx) return true;
  const walk = ANIMATION_OFFSETS[DEFAULT_ANIMATION];
  if (walk === undefined) return true;
  try {
    const data = ctx.getImageData(0, walk, SHEET_WIDTH, 4 * FRAME_SIZE).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] !== 0) return true;
    }
    return false;
  } catch (error) {
    // 读不出像素（tainted / 上下文缺失）→ 保守当作「有内容」（别误伤正常缓存）。
    return true;
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

/** 错误 → 一行人能读的说明（内部日志用）。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
