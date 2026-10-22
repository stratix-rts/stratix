/**
 * 文件职责：精灵图的 **LRU 缓存**（纯逻辑，零 DOM）。
 *   来源：git 历史 a9498ae~1:src/stratix-character-creator/core/CharacterComposer.ts 里的
 *        imageCache + cacheOrder（复活时抽成独立模块，便于单测与复用）。
 *   任务：.long-run-agent/tasks/task_027.md「合成含 LRU 图缓存逻辑原样保留」。
 * 输入：一个"按 key 加载图片"的异步函数。
 * 输出：命中即复用、未命中即加载并入缓存；超出上限时淘汰**最久未用**的那一张。
 * 禁止事项：
 *   1. 自己 new Image() —— 加载器必须注入（单测要打桩，渲染层也可能换实现）；
 *   2. 无上限增长 —— 精灵图是位图，缓存必须有上限（见 MAX_CACHE_SIZE）；
 *   3. 把失败也缓存下来 —— 加载失败不入缓存（下一次还会重试），失败由调用方兜底。
 *
 * why 要上限：一名角色 = 十余个部位 × 十余个动画 = 上百张位图；
 *   不设上限则切角色/换装时位图只增不减，直接吃爆渲染进程内存（perf 硬约束：资源要有界、要能回收）。
 */

/** 默认缓存上限（张位图）。与历史实现一致（MAX_CACHE_SIZE = 100）。 */
export const MAX_CACHE_SIZE = 100;

/** 缓存构造选项。 */
export interface LruCacheOptions<T> {
  /** 上限（张）。 */
  readonly maxSize: number;
  /** 加载器：key → 图片。 */
  readonly load: (key: string) => Promise<T>;
}

/**
 * 简单的 LRU 缓存（Map 保插入序 = LRU 在前、MRU 在后）。
 *
 * why 用 Map 而不是 Map + 数组：Map 的插入序本身就是 LRU 序，
 * 命中时 delete + set 一次即可把它挪到末尾（MRU），淘汰时取第一个 key（LRU）。
 * 少一份要同步维护的数组，也就没有"两份顺序不一致"的 bug。
 */
export class LruCache<T> {
  private readonly entries = new Map<string, T>();
  private readonly maxSize: number;
  private readonly load: (key: string) => Promise<T>;

  /** 正在加载中的 promise（防止并发重复加载同一张图）。 */
  private readonly pending = new Map<string, Promise<T>>();

  constructor(options: LruCacheOptions<T>) {
    this.maxSize = Math.max(1, Math.floor(options.maxSize));
    this.load = options.load;
  }

  /** 当前缓存条数。 */
  get size(): number {
    return this.entries.size;
  }

  /** 是否已缓存某个 key。 */
  has(key: string): boolean {
    return this.entries.has(key);
  }

  /**
   * 取缓存内容：命中则刷新其"最近使用"次序并返回；未命中则加载后入缓存。
   *
   * why 并发去重：同一张图可能被多个部位同时请求（不同动画、同一路径），
   * 不去重就会重复下载同一张位图（浪费带宽与内存）。
   */
  async get(key: string): Promise<T> {
    const cached = this.entries.get(key);
    if (cached !== undefined) {
      this.touch(key);
      return cached;
    }

    const inFlight = this.pending.get(key);
    if (inFlight) return inFlight;

    const promise = this.load(key)
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }

  /** 直接塞入（不触发加载）。 */
  set(key: string, value: T): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, value);

    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  /** 清空缓存（合成器对外暴露，用于换装 / 释放内存）。 */
  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }

  /** 缓存内的 key 列表（LRU → MRU 顺序；调试 / 单测用）。 */
  keys(): string[] {
    return Array.from(this.entries.keys());
  }

  /** 把某个 key 挪到"最近使用"位置。 */
  private touch(key: string): void {
    const value = this.entries.get(key);
    if (value === undefined) return;
    this.entries.delete(key);
    this.entries.set(key, value);
  }
}
