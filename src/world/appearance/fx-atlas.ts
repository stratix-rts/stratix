/**
 * 文件职责：战场「精灵特效」（sprite FX）的**纯逻辑层**（@since v3.3，task_161）——
 *   ① 契约：SpriteFxKind（语义 kind）+ SpriteFxSource（一张 sheet 的运行时参数）；
 *   ② 池：SpriteFxPool —— 并发上限 / 到期回收 / 离屏回收的**唯一裁决处**；
 *   ③ 帧名推导：spriteFxFrameNames（atlas 帧名 → Phaser 帧表）。
 * 输入：生成索引（scripts/generate-pixelfx-sheets.ts 的产物）与时间戳。
 * 输出：特效实例的账本（谁在放、放了多久、该不该收）。
 * 禁止事项：
 *   1. import phaser —— 本模块零渲染依赖，node 单测才能穷举断言（并发上限 / 回收）；
 *   2. import hud / app —— 铁律：world 只认识 core；
 *   3. 在本模块里出现 pixelfx 的效果名 —— 契约里只有通用语义 kind（celebrate / levelUp / error /
 *      spawn / despawn / command），"用哪个库的效果"是资产管线的事，运行时不许知道；
 *   4. 自己管一个定时器 —— 特效的回收由宿主层的 tick 驱动（全场一个 tick，perf 硬约束）。
 *
 * ★ why 池与渲染分开：并发上限（≤4）与回收（到期 / 离屏）是**规则**，规则必须能被穷举断言；
 *   绘制（Phaser sprite / anim）是**兑现**。规则层零 Phaser → jest（node 环境）直接单测；
 *   渲染层只负责把池里的账本变成屏幕上的动画（见 objects/sprite-fx-layer.ts）。
 */

/**
 * 特效的**语义 kind**（闭集）—— 战场只说"要什么演出"，不说"用哪个效果文件"。
 *
 * why 闭集而不是字符串：触点（任务完成 / 报错 / 上场 / 下场 / 指令 / 升级）都是有限几种，
 *   闭集让"漏接一个触点"在编译期就暴露（switch 不穷尽会报错）。
 */
export type SpriteFxKind =
  /** 任务完成（庆祝）。 */
  | 'celebrate'
  /** 角色升级（治疗光环）。 */
  | 'levelUp'
  /** 报错 / 卡住（冲击爆闪）。 */
  | 'error'
  /** 单位上场（传送门开启）。 */
  | 'spawn'
  /** 单位下场（消散）。 */
  | 'despawn'
  /** 指令下达（信号弹）。 */
  | 'command';

/** 一张 sheet 的运行时参数（由资产管线生成索引给出）。 */
export interface SpriteFxSource {
  /** 语义 kind。 */
  readonly kind: SpriteFxKind;
  /** Phaser 纹理 key（= atlas key）。 */
  readonly atlasKey: string;
  /** Phaser 动画 key。 */
  readonly animKey: string;
  /** PNG 相对素材根的路径（形如 'default/celebrate.png'）。 */
  readonly pngPath: string;
  /** atlas JSON 相对素材根的路径（形如 'default/celebrate.json'）。 */
  readonly jsonPath: string;
  /** 帧名前缀（atlas 里的帧名 = "<prefix> <序号>"）。 */
  readonly framePrefix: string;
  /** 帧数。 */
  readonly frames: number;
  /** 帧率（fps）。 */
  readonly fps: number;
  /** 是否循环播放。 */
  readonly loop: boolean;
  /** 单帧宽（px）。 */
  readonly frameWidth: number;
  /** 单帧高（px）。 */
  readonly frameHeight: number;
  /** 枢轴 x（帧内像素坐标；特效的"接地处"）。 */
  readonly pivotX: number;
  /** 枢轴 y（帧内像素坐标）。 */
  readonly pivotY: number;
  /** 战场显示缩放（1 = 原生像素尺寸）。 */
  readonly scale: number;
  /** 播完一遍的时长（ms）。 */
  readonly durationMs: number;
}

/**
 * 推导一张 sheet 的全部帧名（atlas 的帧名形如 "<prefix> <序号>"）。
 *
 * why 在这里推而不是读 JSON：运行时索引里已经记着帧数与前缀，帧名是**可推导**的 ——
 *   可推导的东西不存第二份（存了就会漂）。
 */
export function spriteFxFrameNames(source: SpriteFxSource): string[] {
  const names: string[] = [];
  for (let index = 0; index < source.frames; index += 1) {
    names.push(`${source.framePrefix} ${index}`);
  }
  return names;
}

/**
 * 特效的挂载原点（0~1 的比例，用作 sprite 的 origin）—— 枢轴落在"接地处"。
 *
 * why 不用帧中心：特效图多为"上天下地"构图（人物站在画面底部），按中心挂会有一半埋进地里。
 */
export function spriteFxOrigin(source: SpriteFxSource): { readonly x: number; readonly y: number } {
  return {
    x: source.frameWidth > 0 ? source.pivotX / source.frameWidth : 0.5,
    y: source.frameHeight > 0 ? source.pivotY / source.frameHeight : 0.5,
  };
}

/** 一个正在播放的特效实例（池里的账本条目）。 */
export interface SpriteFxInstance {
  /** 实例 id（单调递增；渲染层据此找回自己的显示对象）。 */
  readonly id: number;
  /** 语义 kind。 */
  readonly kind: SpriteFxKind;
  /** 挂载点 x（世界坐标）。 */
  readonly x: number;
  /** 挂载点 y（世界坐标）。 */
  readonly y: number;
  /** 起播时刻（ms；同一把钟由调用方给）。 */
  readonly startedAtMs: number;
  /** 到期时刻（ms）。 */
  readonly endsAtMs: number;
}

/** 一次播发的结果：新实例 + 因并发上限被挤掉的实例。 */
export interface SpriteFxSpawnResult {
  /** 新建的实例。 */
  readonly instance: SpriteFxInstance;
  /** 被挤掉的实例（最老的先让位）—— 调用方负责销毁它们的显示对象。 */
  readonly evicted: readonly SpriteFxInstance[];
}

/**
 * 特效实例池 —— 并发上限 / 到期 / 离屏三件事的**唯一裁决处**。
 *
 * why 有上限：特效是"每帧都要画"的演出，一次刷屏十几条特效会把帧率拖垮
 *   （task_161 requirement 5）。上限到顶时**最老的先让位**（FIFO）——
 *   新触点比旧触点更值得被看见。
 * why 池不自己开定时器：宿主层（TaskFxLayer）已有全场一个 tick，池只提供"该收谁"的纯裁决。
 */
export class SpriteFxPool {
  /** 正在播放的实例（按起播先后排列；最老的在前）。 */
  private readonly instances: SpriteFxInstance[] = [];
  /** 下一个实例 id。 */
  private nextId = 1;

  /**
   * @param maxConcurrent 并发上限（个；必须 ≥ 1）。
   */
  constructor(readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error(`[fx-atlas] maxConcurrent 必须是 ≥1 的整数，收到 ${maxConcurrent}`);
    }
  }

  /** 当前实例数。 */
  get size(): number {
    return this.instances.length;
  }

  /** 当前实例快照（只读副本）。 */
  list(): readonly SpriteFxInstance[] {
    return this.instances.slice();
  }

  /**
   * 播一个特效：登记实例，并在超上限时挤掉最老的。
   *
   * @param kind 语义 kind。
   * @param x 挂载点 x（世界坐标）。
   * @param y 挂载点 y（世界坐标）。
   * @param nowMs 当前时刻（ms）。
   * @param durationMs 播完时长（ms）。
   */
  spawn(
    kind: SpriteFxKind,
    x: number,
    y: number,
    nowMs: number,
    durationMs: number
  ): SpriteFxSpawnResult {
    const evicted: SpriteFxInstance[] = [];
    // 挤位：满了就把最老的请出去（直到有空位）。
    while (this.instances.length >= this.maxConcurrent) {
      const oldest = this.instances.shift();
      if (!oldest) break;
      evicted.push(oldest);
    }
    const instance: SpriteFxInstance = {
      id: this.nextId,
      kind,
      x,
      y,
      startedAtMs: nowMs,
      endsAtMs: nowMs + Math.max(0, durationMs),
    };
    this.nextId += 1;
    this.instances.push(instance);
    return { instance, evicted };
  }

  /**
   * 回收：到期（播完）或离屏（滚出视口）的实例。
   *
   * @param nowMs 当前时刻（ms）。
   * @param isVisible 可见性判定（省略 = 不做离屏回收）。
   * @returns 被回收的实例（调用方负责销毁它们的显示对象）。
   */
  collect(
    nowMs: number,
    isVisible?: (instance: SpriteFxInstance) => boolean
  ): readonly SpriteFxInstance[] {
    const removed: SpriteFxInstance[] = [];
    for (let index = this.instances.length - 1; index >= 0; index -= 1) {
      const instance = this.instances[index];
      const expired = nowMs >= instance.endsAtMs;
      const invisible = isVisible ? !isVisible(instance) : false;
      if (!expired && !invisible) continue;
      this.instances.splice(index, 1);
      removed.push(instance);
    }
    // 回收顺序按起播先后（旧的先收）—— 便于日志阅读。
    removed.reverse();
    return removed;
  }

  /** 按 id 移除一个实例（场景强制清理用）；找不到返回 null。 */
  remove(id: number): SpriteFxInstance | null {
    const index = this.instances.findIndex((instance) => instance.id === id);
    if (index < 0) return null;
    return this.instances.splice(index, 1)[0] ?? null;
  }

  /** 清空（场景 shutdown）：返回被清掉的实例。 */
  clear(): readonly SpriteFxInstance[] {
    const all = this.instances.slice();
    this.instances.length = 0;
    return all;
  }
}
