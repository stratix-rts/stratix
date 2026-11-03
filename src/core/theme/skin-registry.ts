/**
 * 文件职责：**皮肤库注册表** —— 皮肤清单、徽标色、随机抽签。
 *   来源：.long-run-agent/tasks/task_024.md「hud 皮肤库扩展」；
 *   @since v3.9（task_026）由 src/hud/theme/ 迁到 src/core/theme/。
 *   设计：皮肤 = 一份 token 样式表（hud/theme/tokens-*.css）+ 一条元数据（id / 徽标色 / 文案）。
 * 输入：无（纯静态清单 + 可注入的随机源）。
 * 输出：listSkins() / getSkin() / isSkinId() / resolveAccent() / randomSkin() / createSkinRandomizer()。
 * 禁止事项：
 *   1. import *.css —— 样式表由调用方（dev-entry）注入，registry 只管元数据
 *      （避免 jest transform 与 css 解析耦合）；
 *   2. 依赖 Math.random 直接取数 —— 随机源必须可注入（seed），否则不可测；
 *   3. 依赖 DOM —— 本模块零 DOM 副作用；
 *   4. 在 registry 内做配色推导 —— 色值是既定事实，登记即可；
 *   5. 引用 hud / world —— **core 是 hud 与 world 唯一的共用底座**，本模块放 core 正是为了两侧共用。
 *
 * ★ 为什么从 hud/theme 迁到 core/theme（task_026）：
 *   皮肤的**徽标色**有两处消费者 —— HUD 的角色徽标（hud）与战场的单位染色（world）。
 *   按 §1 通信铁律「任何 hud ↔ world 直接调用 = 架构违规」，两侧不能互相 import；
 *   而 world 只允许认识 core。故这份「皮肤 → 颜色」的登记表必须落在两侧共用的 core。
 *   留在 hud/theme 会逼出两条坏路：world import hud（跨层违规），或把颜色表抄一份进 world（两份真相）。
 *   `file` 字段只是 token 样式表的**文件名**（样式表本体仍在 hud/theme）—— core 只存键，不 import CSS。
 *
 * 兼容性：SkinId 是**字符串资源键**，可直接当作 core 侧 AgentProfile.skinId 使用
 *   （core 只校验「非空字符串 + 长度上限」，不解析资源是否存在，见 core/character/profile.ts）。
 */

/** 皮肤 id 词表：与 theme/tokens-*.css 一一对应。 */
export type SkinId =
  | 'default'
  | 'pixel'
  | 'crimson'
  | 'forest'
  | 'ocean'
  | 'sunset'
  | 'mono'
  | 'aurora';

/** 单条皮肤的元数据。 */
export interface SkinDefinition {
  /** 皮肤 id（= token 文件名的中段，也是 AgentProfile.skinId 可用的资源键）。 */
  readonly id: SkinId;
  /** UI 文案。 */
  readonly label: string;
  /** UI 副文案 / 提示。 */
  readonly hint: string;
  /** 徽标色：角色头像 / 单位染色用；与该皮肤 token 里的 `--srf-badge-accent` 同值。 */
  readonly accent: string;
  /** token 样式表文件名（相对 src/hud/theme/ 目录）。 */
  readonly file: string;
}

/** 皮肤清单（只读）。顺序即 UI 展示顺序。 */
export const SKINS: readonly SkinDefinition[] = Object.freeze([
  {
    id: 'default',
    label: '默认',
    hint: '现代深色，等宽数字，高对比边框',
    accent: '#7fb3ff',
    file: 'tokens-default.css',
  },
  {
    id: 'pixel',
    label: '像素',
    hint: '直角边框 + 像素化渲染 + 扫描线',
    accent: '#ffc98f',
    file: 'tokens-pixel.css',
  },
  {
    id: 'crimson',
    label: '绯红',
    hint: '暖红主色，适合高警戒任务',
    accent: '#ff4d6d',
    file: 'tokens-crimson.css',
  },
  {
    id: 'forest',
    label: '森林',
    hint: '低饱和墨绿，长时间值守不刺眼',
    accent: '#4ade80',
    file: 'tokens-forest.css',
  },
  {
    id: 'ocean',
    label: '海洋',
    hint: '深蓝青调，冷静的指挥台配色',
    accent: '#38bdf8',
    file: 'tokens-ocean.css',
  },
  {
    id: 'sunset',
    label: '暮色',
    hint: '橙紫渐层，弱化边框存在感',
    accent: '#ff7a59',
    file: 'tokens-sunset.css',
  },
  {
    id: 'mono',
    label: '单色',
    hint: '去色灰阶，只看信息不看颜色',
    accent: '#f5f5f5',
    file: 'tokens-mono.css',
  },
  {
    id: 'aurora',
    label: '极光',
    hint: '冷底霓光，强调发光与辉光层级',
    accent: '#a78bfa',
    file: 'tokens-aurora.css',
  },
]);

/**
 * 皮肤偏好的 localStorage 键名（@since v3.6，task_115）。
 * 值 = 皮肤 id（见 SkinId）；无键 / 非法值 = 用默认皮肤。
 * why 冻结在 core：键名是**契约级事实** —— 写入方（HUD 皮肤控制器切皮肤时）与读取方
 *   （下次启动恢复皮肤）必须认同一个键；抄两份字面量迟早对不上（同 DEMO_MODE.storageKey 的纪律）。
 * why 不进契约的偏好视图：皮肤是**每客户端本地**的展示偏好（不进 WorldState、不广播），
 *   见 core/types.ts 的「用户偏好」段 —— 另立字段只会造出第二个真相源。
 */
export const SKIN_STORAGE_KEY = 'stratix.skin';

/** id → 定义的索引（内部构建，外部只读）。 */
const SKIN_BY_ID: ReadonlyMap<SkinId, SkinDefinition> = new Map(SKINS.map((s) => [s.id, s]));

/** 兜底徽标色：皮肤 id 未知时用 default 的。 */
const DEFAULT_ACCENT: string = SKINS[0].accent;

/** 全部皮肤 id（顺序与清单一致）。 */
export const SKIN_IDS: readonly SkinId[] = Object.freeze(SKINS.map((s) => s.id));

/**
 * 列出全部皮肤。
 * 返回只读清单本身（不是副本）—— 调用方拿到的数组无法被就地改写。
 */
export function listSkins(): readonly SkinDefinition[] {
  return SKINS;
}

/** 按 id 取皮肤；未知 id 返回 undefined。 */
export function getSkin(id: string): SkinDefinition | undefined {
  return SKIN_BY_ID.get(id as SkinId);
}

/** id 是否在皮肤库内。 */
export function isSkinId(id: string): id is SkinId {
  return SKIN_BY_ID.has(id as SkinId);
}

/**
 * 取皮肤徽标色（角色头像 / 单位染色用）。
 * 未知 id 回落 default 的徽标色 —— 皮肤 id 由外部传入（AgentProfile.skinId），不能因为不认识的
 * id 就让渲染侧拿不到颜色。
 */
export function resolveAccent(skinId: string): string {
  const skin = SKIN_BY_ID.get(skinId as SkinId);
  if (skin) return skin.accent;
  return DEFAULT_ACCENT;
}

/** 抽签器：一轮之内不重复，抽完整轮才重新洗牌。 */
export interface SkinRandomizer {
  /** 抽下一套皮肤。 */
  next(): SkinDefinition;
  /** 重置抽签池（可换种子）；换种子即重新洗牌。 */
  reset(seed?: number): void;
  /** 当前种子；null = 未固定种子（每次重置都取运行时随机种子）。 */
  readonly seed: number | null;
  /** 本轮已抽出的皮肤 id（按抽签顺序）。 */
  readonly drawn: readonly SkinId[];
}

/** 确定性伪随机源（mulberry32）：同种子 → 同一序列。 */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 未固定种子时用的运行时种子。 */
function runtimeSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

/** Fisher–Yates 洗牌（就地打乱副本，不改原数组）。 */
function shuffle<T>(items: readonly T[], prng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * 构造一个抽签器。
 * @param seed 固定随机源；不给则每次重置都取运行时随机种子。
 */
export function createSkinRandomizer(seed?: number): SkinRandomizer {
  let currentSeed: number | null = seed === undefined ? null : seed >>> 0;
  let prng = createPrng(currentSeed ?? runtimeSeed());
  let pool: SkinId[] = [];
  let drawn: SkinId[] = [];

  const refill = (): void => {
    pool = shuffle(SKIN_IDS, prng);
    drawn = [];
  };
  refill();

  const next = (): SkinDefinition => {
    if (pool.length === 0) refill();
    const index = Math.floor(prng() * pool.length);
    const id = pool.splice(index, 1)[0];
    drawn.push(id);
    const skin = SKIN_BY_ID.get(id);
    if (!skin) throw new Error(`[skin-registry] unknown skin id: ${id}`);
    return skin;
  };

  const reset = (nextSeed?: number): void => {
    currentSeed = nextSeed === undefined ? null : nextSeed >>> 0;
    prng = createPrng(currentSeed ?? runtimeSeed());
    refill();
  };

  return {
    next,
    reset,
    get seed(): number | null {
      return currentSeed;
    },
    get drawn(): readonly SkinId[] {
      return drawn.slice();
    },
  };
}

/** 模块级共享抽签器（应用默认走这条）。 */
const sharedRandomizer = createSkinRandomizer();
/** 共享抽签器当前被固定的种子（null = 未固定）。 */
let sharedSeed: number | null = null;

/**
 * 抽一套皮肤（一轮内不重复）。
 *
 * @param seed 注入随机源：
 *   - 给一个**新**种子 → 重置抽签池并按该种子重洗（此后同一 seed 的调用继续往后抽）；
 *   - 给**同一个**种子 → 不重置，继续抽（所以连续多次调用不会抽到同一套）；
 *   - 不给 → 沿用当前种子继续抽。
 */
export function randomSkin(seed?: number): SkinDefinition {
  if (seed !== undefined) {
    const normalized = seed >>> 0;
    if (normalized !== sharedSeed) {
      sharedSeed = normalized;
      sharedRandomizer.reset(normalized);
    }
  }
  return sharedRandomizer.next();
}

/** 重置模块级抽签池（换人设 / 重新洗牌 / 测试隔离用）。 */
export function resetSkinRandomizer(seed?: number): void {
  sharedSeed = seed === undefined ? null : seed >>> 0;
  sharedRandomizer.reset(sharedSeed ?? undefined);
}
