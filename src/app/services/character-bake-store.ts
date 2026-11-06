/**
 * 文件职责：**角色烘焙缓存的存取口**（@since v3.3，task_195 / CP-01）—— 整精灵图 + atlas 元数据的落盘 / 读取。
 *   权威定义：docs/DESIGN-asset-pipelines.md §2.1「产物存用户本地缓存目录（app userData 侧），
 *   不进仓库、不进 .stratix 契约目录」+ §2.2 纪律 3「本地缓存可整体重建」。
 * 输入：缓存键 + PNG 的 base64 + atlas 元数据。
 * 输出：CharacterBakeStore（存取口）—— 实现分两种：Electron IPC（真身，落 userData）与内存（测试 / 纯浏览器 dev）。
 * 禁止事项：
 *   1. import fs / path —— 渲染层没有文件系统（nodeIntegration 关闭），写盘只能经主进程 IPC；
 *   2. 把缓存写进仓库或 .stratix 契约目录 —— 烘焙产物是**用户本地缓存**，
 *      进仓库会污染版本控制，进契约目录会被当成契约资产（两边都不该发生）；
 *   3. 在这里做合成 —— 合成在 world/appearance/character-composer.ts，本文件只管存取；
 *   4. 把键直接拼成路径 —— 键会变成文件名，必须先消毒（见 sanitizeKeySegment），
 *      主进程侧还会再校验一次（纵深防御，防目录穿越）。
 *
 * ★ 为什么缓存要落盘而不是只放内存：
 *   烘焙整张 832×3456 的精灵表不便宜（合成 + PNG 编码），
 *   而角色一进战场就要用它 —— 每次启动都重烘一遍是白付钱。
 *   落盘 ⇒ 第二次启动直接读图（DESIGN §2.1「运行时一律只读整图」）。
 */

import { sanitizeKeySegment } from '../../world/appearance/bake-cache-key';
import type { BakedCharacterSheetMeta } from '../../world/appearance/bake-sheet-meta';

/** 缓存里的一条产物（PNG 的 base64 + atlas 元数据）。 */
export interface CharacterBakeEntry {
  /** 整精灵图的 PNG（base64，不带 data URL 前缀）。 */
  readonly pngBase64: string;
  /** atlas 元数据。 */
  readonly meta: BakedCharacterSheetMeta;
}

/**
 * 存取失败的**种类**（@since v3.3，task_196 / CP-02）。
 *
 * why 要分类：上层（烘焙服务）要据此判「这是哪一类失败面」——
 *   - `corrupt`：缓存里的东西**坏了**（文件截断 / JSON 损坏 / 版本不符）→ 该重烘；
 *   - `unavailable`：环境**不配合**（目录不可写 / 磁盘满 / IPC 断）→ 重烘也会失败，降温重试。
 *   两者都不该让用户看见（DESIGN §2.2 纪律 2），但内部日志要能分开说。
 */
export type CharacterBakeStoreErrorKind = 'corrupt' | 'unavailable';

/**
 * 存取口抛出的错误（带种类）。
 *
 * why 不用裸 Error：上层要按种类分流（重烘 / 降温重试），裸 Error 分不出来。
 */
export class CharacterBakeStoreError extends Error {
  readonly kind: CharacterBakeStoreErrorKind;

  constructor(kind: CharacterBakeStoreErrorKind, message: string) {
    super(message);
    this.name = 'CharacterBakeStoreError';
    this.kind = kind;
  }
}

/** 取存取错误的种类（不是存取错误 → undefined）。 */
export function characterBakeStoreErrorKind(error: unknown): CharacterBakeStoreErrorKind | undefined {
  return error instanceof CharacterBakeStoreError ? error.kind : undefined;
}

/**
 * 缓存存取口（渲染层视角）。
 *
 * 契约：
 *   - read：命中返回产物；未命中返回 null（**未命中不是错误**，不抛）；
 *     但**存取本身失败**（磁盘满 / 权限 / IPC 断）要抛 —— 由调用方（烘焙服务）降级处理，
 *     存取口自己不吞异常（吞了就分不清「没缓存」与「读不出来」，后者会被当成命中来记账）。
 *   - write：写一条产物（覆盖同键的旧产物）；失败要抛。
 *   - clear：整体清空（删缓存目录）—— 之后下次触发会全量重烘（纪律 3）；失败要抛。
 */
export interface CharacterBakeStore {
  read(key: string): Promise<CharacterBakeEntry | null>;
  write(key: string, pngBase64: string, meta: BakedCharacterSheetMeta): Promise<void>;
  clear(): Promise<void>;
}

/** preload 暴露的 characterBake 面（与 src/electron/preload.ts 的 ElectronAPI.characterBake 同构）。 */
export interface CharacterBakeIpcApi {
  read(key: string): Promise<{
    readonly ok: boolean;
    readonly pngBase64?: string | null;
    readonly meta?: BakedCharacterSheetMeta | null;
    readonly error?: string;
    /** 失败种类（@since v3.3，task_196 / CP-02）：坏了 / 环境不配合。 */
    readonly kind?: CharacterBakeStoreErrorKind;
  }>;
  write(
    key: string,
    pngBase64: string,
    meta: BakedCharacterSheetMeta
  ): Promise<{ readonly ok: boolean; readonly error?: string; readonly kind?: CharacterBakeStoreErrorKind }>;
  clear(): Promise<{ readonly ok: boolean; readonly error?: string; readonly kind?: CharacterBakeStoreErrorKind }>;
}

/**
 * 从 window.electronAPI 取 characterBake 面。
 *
 * 非 Electron 环境（纯 vite dev / node 单测）没有它 → 返回 null →
 * 调用方按「无缓存」降级（烘焙跳过、运行时直接合成，行为与今天一致）。
 */
export function characterBakeIpcApi(): CharacterBakeIpcApi | null {
  // globalThis 探测：node（jest）里 window 未定义，直接读会 ReferenceError。
  const scope: unknown = typeof window !== 'undefined' ? window : globalThis;
  const api = (scope as { electronAPI?: { characterBake?: CharacterBakeIpcApi } }).electronAPI;
  return api?.characterBake ?? null;
}

/**
 * 造基于 IPC 的存取口（真身：文件落 Electron 主进程的 userData 侧）。
 *
 * why 失败要抛：缓存是**优化**，不是必需品 ——
 *   但「存取失败」必须让上层知道（上层才降级：本次不落盘 / 按未命中处理）。
 *   存取口自己吞异常的话，上层会把「读不出来」记成「已缓存」，于是永远不再重烘 —— 那是缓存坏了还不自知。
 */
export function createIpcCharacterBakeStore(api: CharacterBakeIpcApi): CharacterBakeStore {
  return {
    async read(key: string): Promise<CharacterBakeEntry | null> {
      const result = await api.read(sanitizeKeySegment(key));
      if (!result?.ok) {
        // 种类由主进程给（corrupt = 文件坏了；unavailable = 环境不配合）。
        throw new CharacterBakeStoreError(
          result?.kind ?? 'unavailable',
          `读取烘焙缓存失败：${result?.error ?? '未知原因'}`
        );
      }
      if (!result.pngBase64 || !result.meta) return null;
      return { pngBase64: result.pngBase64, meta: result.meta };
    },

    async write(key: string, pngBase64: string, meta: BakedCharacterSheetMeta): Promise<void> {
      const result = await api.write(sanitizeKeySegment(key), pngBase64, meta);
      if (!result?.ok) {
        throw new CharacterBakeStoreError(
          result?.kind ?? 'unavailable',
          `写入烘焙缓存失败：${result?.error ?? '未知原因'}`
        );
      }
    },

    async clear(): Promise<void> {
      const result = await api.clear();
      if (!result?.ok) {
        throw new CharacterBakeStoreError(
          result?.kind ?? 'unavailable',
          `清空烘焙缓存失败：${result?.error ?? '未知原因'}`
        );
      }
    },
  };
}

/**
 * 内存存取口（进程内有效）。
 *
 * 用途：① 单测（不依赖 Electron）；② 纯浏览器 dev —— 那里没有 userData，
 *   留一份进程内缓存至少让「本次运行内不重复烘焙」这条体验成立。
 * why 不是「假数据」：它是存取口的**另一个真实实现**（存哪儿是实现细节）。
 */
export function createMemoryCharacterBakeStore(): CharacterBakeStore & {
  /** 当前条数（诊断用）。 */
  size(): number;
} {
  const entries = new Map<string, CharacterBakeEntry>();
  return {
    async read(key: string): Promise<CharacterBakeEntry | null> {
      return entries.get(sanitizeKeySegment(key)) ?? null;
    },
    async write(key: string, pngBase64: string, meta: BakedCharacterSheetMeta): Promise<void> {
      entries.set(sanitizeKeySegment(key), { pngBase64, meta });
    },
    async clear(): Promise<void> {
      entries.clear();
    },
    size(): number {
      return entries.size;
    },
  };
}
