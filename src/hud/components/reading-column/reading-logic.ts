/**
 * 文件职责：**阅读列**（Reading Column）的纯逻辑层 —— 消息分野 / 连续分组 / 时间线 /
 *   窗口化切片 / 滚动记忆（@since v3.9，task_149）。
 *
 * ============ 为什么要有这一层 ============
 *   读面的"结构判断"（谁是用户、谁连着谁、跨没跨分钟、该渲染哪一段、滚到哪）
 *   **全部是纯函数** —— 它们不碰 DOM、不读时钟、不发命令。
 *   把它们从 DOM 代码里剥出来，单测就能在 jsdom 之外直接断言：
 *   分组对不对、分隔条插在哪、窗口切在哪、记忆留几条。
 *
 * ============ 纪律 ============
 *   1. 纯逻辑 —— 本文件不得 import 任何 DOM API / 不得有副作用。
 *   2. 不编数据 —— 输入没有就是没有（不造一条假消息出来充数）。
 *   3. 时刻由调用方给 —— 本文件不读 Date.now()（单测可断言）。
 *
 * 输入：ReadingMessage[]（已归一的展示形状）。
 * 输出：时间线条目 / 窗口切片 / 滚动记忆。
 */

/** 消息身份 —— 三种视觉分野（用户 / agent 回复 / 系统事件）。 */
export type ReadingRole = 'user' | 'agent' | 'system';

/** 语气（普通 / 警示 / 错误）—— 决定行内配色。 */
export type ReadingTone = 'normal' | 'warn' | 'error';

/** 行内动作（如「从这里分叉」）—— 阅读列只画钮，裁决在别处。 */
export interface ReadingAction {
  /** 钮面文案。 */
  readonly label: string;
  /** 动作名（回传给宿主）。 */
  readonly action: string;
  /** 载荷（回传给宿主）。 */
  readonly payload?: string;
  /** 悬浮提示。 */
  readonly title?: string;
  /** 附加属性（如 data-at-seq / data-session）。 */
  readonly attrs?: Readonly<Record<string, string>>;
}

/** 一条消息（阅读列的输入形状 —— 已归一，与来源无关）。 */
export interface ReadingMessage {
  /** 唯一 id（同一列内唯一）。 */
  readonly id: string;
  /** 视觉身份。 */
  readonly role: ReadingRole;
  /** 署名（分组时只显示组首那条的署名）。 */
  readonly author: string;
  /** 正文（markdown 源文本或纯文本，由 markdown 选项决定渲染方式）。 */
  readonly text: string;
  /** 时刻（毫秒）。 */
  readonly at: number;
  /** 语气。 */
  readonly tone?: ReadingTone;
  /** 徽标（如「演示数据」）。 */
  readonly badge?: string;
  /** 该条是否按 markdown 渲染（缺省 = 跟随列级选项）。 */
  readonly markdown?: boolean;
  /** 行内动作。 */
  readonly action?: ReadingAction;
}

/** 时间线条目：分隔条。 */
export interface ReadingSeparatorRow {
  readonly kind: 'separator';
  readonly key: string;
  /** 分隔条文案（「14:32」）。 */
  readonly label: string;
}

/** 时间线条目：一条消息。 */
export interface ReadingMessageRow {
  readonly kind: 'message';
  readonly key: string;
  readonly message: ReadingMessage;
  /**
   * 本条是否**开启一个新分组**（要显示头像 / 署名）。
   * why 需要它：同一 agent 连着说三句时，只有第一句该挂头像与名字 ——
   *   每条都重复一遍头像 = 视觉噪音（r5 镜头 7 的原话"不每条重复头像/名字"）。
   */
  readonly opensGroup: boolean;
}

/** 时间线条目。 */
export type ReadingRow = ReadingSeparatorRow | ReadingMessageRow;

/** 一分钟（跨分钟时间分隔条的判定粒度）。 */
export const TIME_MINUTE_MS = 60_000;

/**
 * 时刻 → 「14:32」。
 * why 只到分钟：秒在同一屏里是噪音；跨分钟的分组由分隔条承担。
 */
export function formatClockTime(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 时刻 → 分钟桶（跨没跨分钟的判定）。 */
export function minuteBucket(at: number): number {
  return Math.floor(at / TIME_MINUTE_MS);
}

/**
 * 消息列表 → 时间线条目。
 *
 * 两条规则：
 *   ① **跨分钟插分隔条** —— 与上一条不在同一分钟桶时，在它前面插一条「14:32」。
 *   ② **连续同 agent 分组** —— 与上一条同身份且同署名时，不开启新分组（不重复头像/名字）。
 *      系统事件**永不合并**（每条系统事件都是独立的事实，合并会让人以为只有一条）。
 */
export function buildReadingTimeline(messages: readonly ReadingMessage[]): ReadingRow[] {
  const rows: ReadingRow[] = [];
  let prev: ReadingMessage | null = null;
  for (const message of messages) {
    if (prev !== null && minuteBucket(prev.at) !== minuteBucket(message.at)) {
      rows.push({ kind: 'separator', key: `sep:${message.id}`, label: formatClockTime(message.at) });
    }
    const opensGroup =
      prev === null ||
      prev.role !== message.role ||
      prev.author !== message.author ||
      message.role === 'system';
    rows.push({ kind: 'message', key: `msg:${message.id}`, message, opensGroup });
    prev = message;
  }
  return rows;
}

/** 窗口化：可视区前后各留几行（缓冲）。 */
export const READING_WINDOW_BUFFER = 6;

/** 消息数超过这条线才开窗口化（少了就直接全渲染 —— 更准，也省一次测量）。 */
export const READING_VIRTUALIZE_MIN = 40;

/** 未量到高度时的估算行高（px）。 */
export const READING_DEFAULT_ROW_HEIGHT = 64;

/** 窗口切片结果。 */
export interface ReadingWindow {
  /** 起始行下标（含）。 */
  readonly start: number;
  /** 结束行下标（含）；-1 = 空。 */
  readonly end: number;
  /** 顶部占位高度（把没渲染的行"顶"出视野）。 */
  readonly topPad: number;
  /** 底部占位高度。 */
  readonly bottomPad: number;
}

/**
 * 按前缀偏移表切出可视窗口。
 *
 * @param prefix 每行的起始偏移（长度 = 行数 + 1，末位 = 总高）
 * @param scrollTop 滚动位置
 * @param viewportHeight 视口高
 */
export function computeReadingWindow(
  prefix: readonly number[],
  scrollTop: number,
  viewportHeight: number,
  buffer: number = READING_WINDOW_BUFFER
): ReadingWindow {
  const count = prefix.length - 1;
  if (count <= 0) return { start: 0, end: -1, topPad: 0, bottomPad: 0 };
  const total = prefix[count]!;
  const first = indexAtOffset(prefix, scrollTop, count);
  const last = indexAtOffset(prefix, scrollTop + viewportHeight, count);
  const start = Math.max(0, first - buffer);
  const end = Math.min(count - 1, last + buffer);
  return {
    start,
    end,
    topPad: prefix[start]!,
    bottomPad: Math.max(0, total - prefix[end + 1]!),
  };
}

/** 偏移 → 落在哪一行（二分；prefix 单调不减）。 */
function indexAtOffset(prefix: readonly number[], offset: number, count: number): number {
  let lo = 0;
  let hi = count - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prefix[mid]! <= offset) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * 行高表 → 前缀偏移表。
 * @param heights 每行高度（0 / 缺省 = 用 fallback 估算）
 */
export function buildPrefix(heights: readonly number[], fallback: number): number[] {
  const prefix = new Array<number>(heights.length + 1);
  prefix[0] = 0;
  for (let i = 0; i < heights.length; i += 1) {
    const h = heights[i]!;
    prefix[i + 1] = prefix[i]! + (h > 0 ? h : fallback);
  }
  return prefix;
}

/** 滚动记忆：最多记几个上下文。 */
export const SCROLL_MEMORY_LIMIT = 5;

/** 滚动记忆表（LRU）。 */
export interface ScrollMemory {
  /** 记一个上下文的位置（ratio = 已滚比例 0..1）。 */
  remember(key: string, ratio: number): void;
  /** 取回（没有 = null）。 */
  recall(key: string): number | null;
  /** 当前记着的键（按 LRU 顺序：最旧在前）。 */
  keys(): readonly string[];
  /** 条数。 */
  size(): number;
  /** 全清。 */
  clear(): void;
}

/** 滚动记忆的构造选项。 */
export interface ScrollMemoryOptions {
  /** 最多记几条（缺省 5）。 */
  readonly limit?: number;
  /** 持久化口（缺省 = localStorage；传 null = 只在内存里）。 */
  readonly storage?: Storage | null;
  /** 持久化键（缺省 'stratix:reading-scroll'）。 */
  readonly storageKey?: string;
}

/**
 * 造一张滚动记忆表。
 *
 * why 记 **ratio 而不是 scrollTop**：面板高度会变（折叠/展开、窗口缩放），
 *   绝对像素位置一恢复就指到别的地方去了；比例位置跟内容走。
 * why 限 5 条：记忆表是"最近看过的几个会话"，不是历史数据库 ——
 *   容量小才不会在 localStorage 里堆垃圾（容量纪律）。
 */
export function createScrollMemory(options: ScrollMemoryOptions = {}): ScrollMemory {
  const limit = Math.max(1, options.limit ?? SCROLL_MEMORY_LIMIT);
  const storage = options.storage === undefined ? safeLocalStorage() : options.storage;
  const storageKey = options.storageKey ?? 'stratix:reading-scroll';
  const map = new Map<string, number>();

  if (storage) {
    try {
      const raw = storage.getItem(storageKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === 'number' && Number.isFinite(value)) {
              map.set(key, clampRatio(value));
            }
          }
        }
      }
    } catch {
      // 存储读不出来（隐私模式 / 配额满）—— 内存里照样能用，不报错。
    }
  }
  while (map.size > limit) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }

  const persist = (): void => {
    if (!storage) return;
    try {
      storage.setItem(storageKey, JSON.stringify(Object.fromEntries(map)));
    } catch {
      // 写不进去就算了 —— 记忆只是体验，不是数据。
    }
  };

  return {
    remember(key: string, ratio: number): void {
      if (!key) return;
      map.delete(key);
      map.set(key, clampRatio(ratio));
      while (map.size > limit) {
        const oldest = map.keys().next();
        if (oldest.done) break;
        map.delete(oldest.value);
      }
      persist();
    },
    recall(key: string): number | null {
      return map.has(key) ? map.get(key)! : null;
    },
    keys(): readonly string[] {
      return Array.from(map.keys());
    },
    size(): number {
      return map.size;
    },
    clear(): void {
      map.clear();
      persist();
    },
  };
}

/** ratio 收敛到 0..1（脏值不进来）。 */
function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 取 localStorage（不可用时返回 null —— 不抛）。 */
function safeLocalStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
