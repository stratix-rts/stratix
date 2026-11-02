/**
 * 文件职责：**当日回放控制器**（task_082 / DEMO-PLAN.md §9）—— 把「当天的 task_run 事件流」
 *   变成一条可拖动、可倍速的时间轴：加载 → 拖动定位（重演到那一刻）→「60 秒看完今天」自动倍速。
 *   控制器只做**编排**：读数据（读取口）、发节拍（emitBeat 注入）、更新时间戳角标
 *   （setClock 注入）、通知 UI（subscribe）。它自己不碰 DOM、不碰总线、不碰 IO。
 *   why 镜头不归这里管：「自动导演镜头」的落位只有 world 知道（回放化身站在真实单位那儿
 *   还是稳定槽位上），hud 隔着总线反推只能得到「大概在哪」—— 镜头追不准等于没导演。
 *   所以控制器只发节拍，镜头由 world 侧随节拍自己跟（见 objects/replay-board + 场景）。
 * 输入：DayReplayPort（读当天的事件流）+ 若干注入的出口（emitBeat / setClock / onEntry / timers）。
 * 输出：ReplayState（条目 + 播放位置 + 是否在播）+ 一串 replay.beat 节拍。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. import core/bus —— 总线出口一律由组合根注入（本控制器零总线依赖，可单测直打）；
 *   3. 在这里画任何东西 —— 表现归 world 侧的回放化身层，HUD 侧归 scrubber 组件；
 *   4. 造数据 —— 读不到就是读不到（空数组 → 空态），绝不编一条事件出来；
 *   5. 无上限地攒条目 —— 条数封顶走 capReplayEntries（数据不许无限增长）。
 *
 * ============ 三种播放姿态 ============
 *   seek(at) —— 拖动时间轴：先发一拍 reset（清场），再把 at 之前的节拍**按序重放**一遍
 *     （战场回到那一刻的样子）。重放是同步的：拖动要跟手，不能一帧帧等。
 *   play()   —— 「60 秒看完今天」：节拍间隔压到 0.5-2s（replayGapMs），逐拍推进，
 *     每一拍顺带把角标跳到那一刻（镜头由 world 侧随节拍自己跟）。
 *   stop()   —— 停：清掉未触发的定时器（资源必须可清理）。
 *
 * @since v3.3（task_082）。
 */

import type { ReplayBeat } from '../../../core/types';

import {
  capReplayEntries,
  replayGapMs,
  sortReplayEntries,
  type DayReplayEntry,
  type DayReplayPort,
} from './replay-catalog';

/** 定时器口（单测注入假定时器；缺省用全局 setTimeout）。 */
export interface ReplayTimers {
  setTimeout(handler: () => void, delayMs: number): number;
  clearTimeout(handle: number): void;
}

/** 控制器状态（订阅者拿到的快照）。 */
export interface ReplayState {
  /** 已加载的条目（按时刻升序）。 */
  readonly entries: readonly DayReplayEntry[];
  /** 数据是否已加载过（false = 还没读，或读失败）。 */
  readonly loaded: boolean;
  /** 读失败了吗（读不到与没有是两回事 —— 失败要说清楚，别装成「今天没活儿」）。 */
  readonly failed: boolean;
  /** 当前播放位置（真实时刻；null = 还没开始回放）。 */
  readonly cursorAt: number | null;
  /** 是否正在自动倍速播放。 */
  readonly playing: boolean;
}

/** 控制器依赖（全部注入 —— 本模块零 IO、零 DOM、零总线）。 */
export interface ReplayControllerDeps {
  /** 读取口（读当天的 task_run 事件流）。 */
  readonly port: DayReplayPort;
  /** 发一拍回放节拍（组合根注入 core/bus 的 emitWorldEvent）。 */
  readonly emitBeat: (beat: ReplayBeat) => void;
  /** 时间戳角标（组合根注入 HUD 组件）；传 null = 收角标。 */
  readonly setClock: (at: number | null) => void;
  /** 每拍的事件反馈（跑马灯等；组合根翻译成 HUD 侧条目）。 */
  readonly onEntry?: (entry: DayReplayEntry) => void;
  /** 定时器口（缺省全局 setTimeout）。 */
  readonly timers?: ReplayTimers;
}

/** 控制器对外形状。 */
export interface ReplayController {
  /** 读当天的事件流；返回读到的条目数（读失败 → 0，状态里 loaded=false）。 */
  load(): Promise<number>;
  /** 拖动定位：重演到 at 那一刻（含）。 */
  seek(at: number): void;
  /** 「60 秒看完今天」：自动倍速从头演一遍。 */
  play(): void;
  /** 停：清掉未触发的定时器。 */
  stop(): void;
  /** 释放：退订 + 清定时器 + 收角标。 */
  dispose(): void;
  /** 订阅状态变化（返回退订闭包）。 */
  subscribe(handler: (state: ReplayState) => void): () => void;
  /** 当前状态快照。 */
  readonly state: ReplayState;
}

/** 默认定时器口（全局 setTimeout —— 浏览器与 node 都有）。 */
function defaultTimers(): ReplayTimers {
  return {
    setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs) as unknown as number,
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  };
}

/**
 * 造回放控制器。
 *
 * why 控制器在 hud 层而不是 app 层：它只认 core 契约与注入的出口，
 *   不需要 app 的任何能力（数据由读取口进来，总线由组合根注入）——
 *   放 hud 层就能被单测直接打，也不用给 app 层再开一个「回放编排」的口子。
 */
export function createReplayController(deps: ReplayControllerDeps): ReplayController {
  const timers = deps.timers ?? defaultTimers();

  let entries: DayReplayEntry[] = [];
  let loaded = false;
  let failed = false;
  let cursorAt: number | null = null;
  let playing = false;
  /** 未触发的节拍定时器句柄（停播时要清 —— 资源必须可清理）。 */
  let pendingTimer: number | null = null;
  const subscribers = new Set<(state: ReplayState) => void>();

  const snapshot = (): ReplayState => ({
    entries,
    loaded,
    failed,
    cursorAt,
    playing,
  });

  const notify = (): void => {
    const state = snapshot();
    for (const handler of subscribers) handler(state);
  };

  const clearPending = (): void => {
    if (pendingTimer === null) return;
    timers.clearTimeout(pendingTimer);
    pendingTimer = null;
  };

  /**
   * 发一拍节拍（reset 拍不带角色信息）。
   * why onEntry 收**原条目**而不是从节拍反推：条目里还有 sessionId 等上下文，
   *   反推会把它抹掉（一份数据两处形状 = 迟早漂移）。
   */
  const emit = (beat: ReplayBeat, entry?: DayReplayEntry): void => {
    deps.emitBeat(beat);
    if (entry) deps.onEntry?.(entry);
  };

  /** 条目 → 节拍（词表一一对应；reset 不来自条目）。 */
  const beatOf = (entry: DayReplayEntry): ReplayBeat => ({
    at: entry.at,
    kind: entry.kind,
    characterId: entry.characterId,
    taskId: entry.taskId,
    label: entry.label,
  });

  const stop = (): void => {
    clearPending();
    if (playing) {
      playing = false;
      notify();
    }
  };

  return {
    async load(): Promise<number> {
      let fetched: readonly DayReplayEntry[] = [];
      try {
        fetched = await deps.port.loadDay();
      } catch {
        // 读不到就是读不到：如实呈现空态，不编数据（禁 mock）。
        fetched = [];
        loaded = false;
        failed = true;
        entries = [];
        notify();
        return 0;
      }
      entries = capReplayEntries(sortReplayEntries(fetched));
      loaded = true;
      failed = false;
      notify();
      return entries.length;
    },

    seek(at: number): void {
      stop();
      // 清场先走：回放不叠在上一帧的残留上（拖回早的时刻要看到「那一刻」而不是「那一刻 + 后来」）。
      emit({ at, kind: 'reset' });
      for (const entry of entries) {
        if (entry.at > at) break;
        emit(beatOf(entry), entry);
      }
      cursorAt = at;
      deps.setClock(at);
      notify();
    },

    play(): void {
      stop();
      if (entries.length === 0) {
        // 没数据就没有「看完今天」—— 空态按钮自己会禁用，这里不硬演。
        deps.setClock(null);
        notify();
        return;
      }
      emit({ at: entries[0].at, kind: 'reset' });
      playing = true;
      const gap = replayGapMs(entries.length);
      let index = 0;
      const step = (): void => {
        if (!playing) return;
        const entry = entries[index];
        if (!entry) {
          playing = false;
          pendingTimer = null;
          deps.setClock(null);
          notify();
          return;
        }
        index += 1;
        emit(beatOf(entry), entry);
        cursorAt = entry.at;
        deps.setClock(entry.at);
        notify();
        pendingTimer = timers.setTimeout(step, gap);
      };
      notify();
      pendingTimer = timers.setTimeout(step, gap);
    },

    stop,

    dispose(): void {
      stop();
      subscribers.clear();
      deps.setClock(null);
    },

    subscribe(handler: (state: ReplayState) => void): () => void {
      subscribers.add(handler);
      handler(snapshot());
      return () => {
        subscribers.delete(handler);
      };
    },

    get state(): ReplayState {
      return snapshot();
    },
  };
}
