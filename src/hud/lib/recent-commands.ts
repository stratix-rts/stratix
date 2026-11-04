/**
 * 文件职责：**最近使用命令的记忆**（@since v3.9，task_150）—— ⌘K 面板把最近用过的命令置顶。
 *   纯逻辑 + 一层薄存储（localStorage 可注入 —— 单测用内存替身，不碰真浏览器存储）。
 *
 * ============ 为什么记这个（⌘K 的核心体验）============
 *   ⌘K 面板是「每天用 8 小时」的操作面。高频动作（切皮肤 / 开设置 / 派发）如果每次都要
 *   在长列表里找，键盘再快也白搭 —— **最近用过的置顶**是 Raycast / Linear 的同一口径：
 *   第二遍开始，常用命令永远在第一屏第一行。
 *
 * 输入：命令 id 序列（执行成功后记一条）。
 * 输出：最近使用顺序（最新在前，**最多 5 条**）。
 * 禁止事项：
 *   1. 无上限 —— 记忆必须封顶（perf 硬约束：数据不许无限增长）；
 *   2. 记不可用的命令 —— 记了也是死的（灰态命令不该占着第一行）；
 *   3. 直接 import world / app —— 铁律。
 */

/** localStorage 键（版本化前缀 —— 键名变了就自然失效，不做迁移）。 */
export const RECENT_COMMANDS_STORAGE_KEY = 'srf-recent-commands:v1';

/** 记忆条数上限（5 条 —— 够覆盖一个工作日的常用动作，又不至于把面板变成流水账）。 */
export const MAX_RECENT_COMMANDS = 5;

/** 存储口（可注入 —— 单测用内存替身，浏览器用 localStorage）。 */
export interface RecentCommandsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 内存存储（单测用；也是 localStorage 不可用时的降级宿主）。 */
export function createMemoryStorage(initial: Record<string, string> = {}): RecentCommandsStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
  };
}

/** 读当前浏览器的 localStorage；不可用（隐私模式 / 非浏览器）→ null。 */
export function browserStorage(): RecentCommandsStorage | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return {
      getItem: (key) => ls.getItem(key),
      setItem: (key, value) => { ls.setItem(key, value); },
    };
  } catch {
    return null;
  }
}

/**
 * 读最近使用顺序（最新在前）。
 * 读不出来 / 存的不是数组 / 数组里有非字符串 → 一律当空（不猜、不修）。
 */
export function readRecentCommands(storage: RecentCommandsStorage | null): string[] {
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(RECENT_COMMANDS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, MAX_RECENT_COMMANDS);
  } catch {
    return [];
  }
}

/**
 * 记一条最近使用（最新在前，去重，最多 MAX_RECENT_COMMANDS 条）。
 * @returns 记完后的顺序（便于调用方直接渲染）。
 */
export function rememberCommand(
  storage: RecentCommandsStorage | null,
  commandId: string
): string[] {
  const current = readRecentCommands(storage).filter((id) => id !== commandId);
  const next = [commandId, ...current].slice(0, MAX_RECENT_COMMANDS);
  if (storage) {
    try {
      storage.setItem(RECENT_COMMANDS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // 存不下（配额满 / 隐私模式）→ 内存里这次仍然有效，只是不跨刷新。静默降级，不打断操作。
    }
  }
  return next;
}
