/**
 * 文件职责：**气泡说话系统的纯逻辑层**（task_076 / DEMO-PLAN.md §3）—— 三件事，零 Phaser：
 *   ① 频率控制板 SpeechBubbleBoard：同屏 ≤3 个（新事件排队、旧的优先收）/ 同单位 5s 冷却 /
 *      存活 4s 自动收 —— 板子是「此刻屏幕上有哪些气泡、每个处在什么相位」的唯一真相；
 *   ② 出入场动画曲线 bubbleAnimationAt：入场 scale 0→1（Back.Out，锚点在尾巴）/
 *      出场上浮 10px + alpha→0（Cubic.In）—— 渲染层只把这条曲线写进显示对象；
 *   ③ 文本排版 layoutSpeechText：最大宽 160px、最多 2 行、超出省略号截断。
 * 输入：单位 id + 话语类别（SpeechKind）+ 时钟（可注入）+ 随机源（可注入）。
 * 输出：SpeechBubbleBoard（板子）+ bubbleAnimationAt（动画帧）+ layoutSpeechText（排版结果）。
 * 禁止事项：
 *   1. import phaser —— 本文件零渲染引擎依赖（node 单测直接 import，与 task-fx.ts 同纪律）；
 *   2. import hud / app / vue / legacy(stratix-rts) —— 铁律：world 只认识 core/types；
 *   3. 持有业务真相（任务相位、角色状态）—— 什么时候说话由 core 事件决定，这里只管「能不能说」；
 *   4. 写死尺寸 / 时长字面量 —— 全部取自 world/speech-spec.ts（SPEECH_BUBBLE_SPEC）；
 *   5. 在 import 期读时钟 / 随机 —— 时钟与随机都由调用方注入（单测可确定性推进）。
 *
 * ============ 为什么「≤3 同屏」是**排队**而不是「挤掉最新的」 ============
 * 直播画面上，气泡挤成一片就没人读了。规矩是：**同屏最多 3 个**，第 4 个事件先排队；
 * 腾位置的方式是「旧的优先收」——最旧的一枚开始退场（300ms），退场完位置让给排队的那条。
 * 同单位 5s 冷却保证「同一个单位不会连着说两句话」，排队中的请求在提升时**再查一次冷却**
 * （排了 4s 还没轮到，期间它自己又说过了 → 这条直接丢掉，不补说）。
 *
 * @since v3.3（task_076）。
 */

import { SPEECH_BUBBLE_SPEC } from '../speech-spec';
import { pickSpeechText, type SpeechKind } from '../speech-templates';

/** 气泡相位：入场 → 驻留 → 退场。 */
export type SpeechBubblePhase = 'entering' | 'alive' | 'exiting';

/** 一枚气泡（对外只读快照）。 */
export interface SpeechBubble {
  /** 气泡 id（板内唯一，渲染层用它对账节点）。 */
  readonly id: number;
  /** 说话单位 id。 */
  readonly unitId: string;
  /** 话语类别（null = 显式文案气泡，原样说，不属于任何句库池）。 */
  readonly kind: SpeechKind | null;
  /** 实际说出的那句话（离线句库抽的）。 */
  readonly text: string;
  /** 当前相位。 */
  readonly phase: SpeechBubblePhase;
  /** 冒出来的时刻（ms）—— 入场动画与存活计时都从此刻起算。 */
  readonly shownAtMs: number;
  /** 开始退场的时刻（ms；null = 还没退）。 */
  readonly exitAtMs: number | null;
}

/** 一次请求的归宿。 */
export type SpeechRequestOutcome =
  /** 已冒泡。 */
  | 'shown'
  /** 排队中（同屏满了）。 */
  | 'queued'
  /** 被同单位冷却挡下（5s 内不重复）。 */
  | 'cooldown'
  /** 被丢弃（队列已满，丢的是最老的一条排队请求）。 */
  | 'dropped';

export interface SpeechBubbleBoardOptions {
  /** 时钟注入（默认 Date.now）：单测确定性推进相位。 */
  readonly now?: () => number;
  /** 随机源注入（默认 Math.random）：单测确定性选句。 */
  readonly random?: () => number;
  /** 同屏上限（默认 3）。 */
  readonly maxOnScreen?: number;
  /** 同单位冷却（ms，默认 5000）。 */
  readonly cooldownMs?: number;
  /** 存活时长（ms，默认 4000）。 */
  readonly lifeMs?: number;
  /** 排队上限（默认 6）。 */
  readonly maxQueue?: number;
}

/** 排队中的一条请求（模板句还没抽 —— 提升时才抽，避免说了一句过时的话）。 */
interface PendingSpeech {
  readonly unitId: string;
  /** 话语类别（null = 显式文案，原样说）。 */
  readonly kind: SpeechKind | null;
  /** 显式文案（null = 到提升时按类别抽句）。 */
  readonly text: string | null;
}

/** 板内记录（字段可变 —— 相位是板在推进的）。 */
interface SpeechBubbleRecord {
  readonly id: number;
  readonly unitId: string;
  /** 话语类别（null = 显式文案气泡，不属于任何句库池）。 */
  readonly kind: SpeechKind | null;
  readonly text: string;
  phase: SpeechBubblePhase;
  readonly shownAtMs: number;
  exitAtMs: number | null;
}

/**
 * 气泡频率控制板（瞬态表现真相）。
 *
 * why 单独一个板而不是渲染层自己数：频率规则（同屏 ≤3 / 同单位 5s / 存活 4s）是**规则**，
 *   渲染层只该负责画；规则必须能被穷举测试（node 单测直接跑本类）。
 */
export class SpeechBubbleBoard {
  private readonly nowFn: () => number;
  private readonly randomFn: () => number;
  private readonly records: SpeechBubbleRecord[] = [];
  private readonly pending: PendingSpeech[] = [];
  private readonly lastSpokenAt = new Map<string, number>();
  private nextId = 1;

  /** 同屏上限。 */
  readonly maxOnScreen: number;
  /** 同单位冷却（ms）。 */
  readonly cooldownMs: number;
  /** 存活时长（ms）。 */
  readonly lifeMs: number;
  /** 排队上限。 */
  readonly maxQueue: number;
  /** 入场时长（ms）= 通用入场口径。 */
  readonly enterDurationMs: number;
  /** 出场时长（ms）= 通用退场口径。 */
  readonly exitDurationMs: number;

  constructor(options: SpeechBubbleBoardOptions = {}) {
    this.nowFn = options.now ?? ((): number => Date.now());
    this.randomFn = options.random ?? Math.random;
    this.maxOnScreen = options.maxOnScreen ?? SPEECH_BUBBLE_SPEC.maxOnScreen;
    this.cooldownMs = options.cooldownMs ?? SPEECH_BUBBLE_SPEC.unitCooldownMs;
    this.lifeMs = options.lifeMs ?? SPEECH_BUBBLE_SPEC.lifeMs;
    this.maxQueue = options.maxQueue ?? SPEECH_BUBBLE_SPEC.maxQueue;
    this.enterDurationMs = SPEECH_BUBBLE_SPEC.enterDurationMs;
    this.exitDurationMs = SPEECH_BUBBLE_SPEC.exitDurationMs;
  }

  /**
   * 请求某个单位冒一句话（按类别从离线句库抽）。
   *
   * @returns 'shown' 立刻冒泡 / 'queued' 排队 / 'cooldown' 冷却挡下
   */
  request(unitId: string, kind: SpeechKind, nowMs?: number): SpeechRequestOutcome {
    return this.place(unitId, kind, null, nowMs);
  }

  /**
   * 请求某个单位冒**指定的一句**（不抽句库）。
   * 供总线上的 unit.bubble 事件用（world 层当场指挥，原话已经定好了 —— 例如「收到」）。
   */
  requestText(unitId: string, text: string, nowMs?: number): SpeechRequestOutcome {
    return this.place(unitId, null, text, nowMs);
  }

  /**
   * 推进板子：相位迁移 + 退场清理 + 排队提升。
   * 调用方（渲染层）每帧 / 每步调一次即可 —— 板子自己不需要定时器。
   */
  tick(nowMs?: number): void {
    const now = nowMs ?? this.nowFn();
    const finished: SpeechBubbleRecord[] = [];
    for (const record of this.records) {
      const elapsed = now - record.shownAtMs;
      if (record.phase === 'entering') {
        if (elapsed >= this.enterDurationMs) record.phase = 'alive';
      } else if (record.phase === 'alive') {
        // 存活到期 → 自动收起（规格：4s 自动收）。
        if (elapsed >= this.lifeMs) this.retire(record, now);
      } else if (record.phase === 'exiting') {
        if (now - (record.exitAtMs ?? now) >= this.exitDurationMs) finished.push(record);
      }
    }
    for (const record of finished) this.remove(record);

    // 位置空出来了 → 提升排队（先到先得；冷却中的直接丢，不补说）。
    while (this.records.length < this.maxOnScreen && this.pending.length > 0) {
      const next = this.pending.shift();
      if (!next) break;
      if (this.isCoolingDown(next.unitId, now)) continue;
      this.spawn(next.unitId, next.kind, next.text, now);
    }
  }

  /** 当前屏幕上的气泡快照（含正在退场的）。 */
  bubbles(): readonly SpeechBubble[] {
    return [...this.records];
  }

  /** 当前屏幕上的气泡数（含退场中 —— 退场中的仍占位置，≤3 是硬上限）。 */
  count(): number {
    return this.records.length;
  }

  /** 排队中的请求数（观测用）。 */
  pendingCount(): number {
    return this.pending.length;
  }

  /** 单位离场：收掉它的气泡与排队请求（表现不许悬在已不存在的单位头顶）。 */
  clearUnit(unitId: string): void {
    for (let i = this.records.length - 1; i >= 0; i -= 1) {
      if (this.records[i]?.unitId === unitId) this.records.splice(i, 1);
    }
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      if (this.pending[i]?.unitId === unitId) this.pending.splice(i, 1);
    }
  }

  /** 全清（场景重启 / 沙盒复位）。 */
  clear(): void {
    this.records.length = 0;
    this.pending.length = 0;
    this.lastSpokenAt.clear();
  }

  /** 同单位冷却判定：5s 内说过 → 不重复冒泡。 */
  private isCoolingDown(unitId: string, now: number): boolean {
    const last = this.lastSpokenAt.get(unitId);
    return last !== undefined && now - last < this.cooldownMs;
  }

  /**
   * 落位一次请求：冷却 → 有位置就冒泡 → 没位置就排队（并让最旧的一枚开始退场）。
   *
   * @param kind 话语类别（null = 显式文案）
   * @param text 显式文案（null = 按类别抽句）
   */
  private place(
    unitId: string,
    kind: SpeechKind | null,
    text: string | null,
    nowMs?: number
  ): SpeechRequestOutcome {
    const now = nowMs ?? this.nowFn();
    if (this.isCoolingDown(unitId, now)) return 'cooldown';
    if (this.records.length < this.maxOnScreen) {
      this.spawn(unitId, kind, text, now);
      return 'shown';
    }
    // 满了：新事件排队。腾位置的规矩是「旧的优先收」—— 让**最旧的一枚**开始退场，
    // 排队的那条等它退完（300ms）再上；已经在退场的不重复退（退场中就是位置已让出）。
    // why 只在「队列是空的」时强制收一次：一口气来 5 个事件时，只切掉最旧的一枚，
    //   其余排队 —— 气泡不会被连环砍掉，读话的人还来得及看清。
    if (this.pending.length === 0) {
      const oldest = this.records.find((record) => record.phase !== 'exiting');
      if (oldest) this.retire(oldest, now);
    }
    if (this.pending.length >= this.maxQueue) {
      this.pending.shift();
      return 'dropped';
    }
    this.pending.push({ unitId, kind, text });
    return 'queued';
  }

  /** 冒泡（抽句 + 落板 + 记冷却起点）。 */
  private spawn(
    unitId: string,
    kind: SpeechKind | null,
    text: string | null,
    now: number
  ): void {
    this.records.push({
      id: this.nextId,
      unitId,
      kind,
      text: text ?? (kind === null ? '' : pickSpeechText(kind, this.randomFn)),
      phase: 'entering',
      shownAtMs: now,
      exitAtMs: null,
    });
    this.nextId += 1;
    this.lastSpokenAt.set(unitId, now);
  }

  /** 让一枚气泡开始退场。 */
  private retire(record: SpeechBubbleRecord, now: number): void {
    if (record.phase === 'exiting') return;
    record.phase = 'exiting';
    record.exitAtMs = now;
  }

  /** 移除一枚退场完毕的气泡。 */
  private remove(record: SpeechBubbleRecord): void {
    const index = this.records.indexOf(record);
    if (index >= 0) this.records.splice(index, 1);
  }
}

// ============================================================================
// 动画曲线
// ============================================================================

/** 一帧的气泡动画参数（渲染层把它写进显示对象）。 */
export interface BubbleAnimationFrame {
  /** 缩放倍率（入场 0→1；驻留 / 退场恒 1）。 */
  readonly scale: number;
  /** 透明度（退场 1→0）。 */
  readonly alpha: number;
  /** 纵向偏移（px，负 = 上浮；退场时最多 -10px）。 */
  readonly riseY: number;
}

/** 动画时序口径（可覆盖 —— 单测可以压缩时长）。 */
export interface BubbleAnimationSpec {
  readonly enterDurationMs: number;
  readonly exitDurationMs: number;
  readonly exitRisePx: number;
}

/**
 * 某一相位、某一时刻的动画参数。
 *
 * why 入场是**缩放**而不是位移：规格写的是「scale 0→1 Back.Out 250ms（锚点在尾巴）」——
 *   气泡从尾巴那一点「长」出来，比从上方滑下来更像「单位在说这句话」。
 * why 退场是**上浮 + 淡出**而不是缩回：缩回会和入场撞个正着（看着像抖了一下），
 *   上浮淡出是「话飘走了」，与规格一致。
 */
export function bubbleAnimationAt(
  phase: SpeechBubblePhase,
  elapsedMs: number,
  spec: BubbleAnimationSpec = SPEECH_BUBBLE_SPEC
): BubbleAnimationFrame {
  if (phase === 'entering') {
    const t = clamp01(elapsedMs / Math.max(1, spec.enterDurationMs));
    return { scale: backOut(t), alpha: 1, riseY: 0 };
  }
  if (phase === 'exiting') {
    const t = clamp01(elapsedMs / Math.max(1, spec.exitDurationMs));
    const eased = cubicIn(t);
    return { scale: 1, alpha: 1 - eased, riseY: -spec.exitRisePx * eased };
  }
  return { scale: 1, alpha: 1, riseY: 0 };
}

/** Back.Out 缓动（与 Phaser 的 'Back.Out' 同一条曲线）。 */
export function backOut(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** Cubic.In 缓动（与 Phaser 的 'Cubic.In' 同一条曲线）。 */
export function cubicIn(t: number): number {
  return clamp01(t) ** 3;
}

/** 钳到 [0,1]。 */
function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// ============================================================================
// 文本排版
// ============================================================================

/** 排版结果：几行 + 是否被截断。 */
export interface SpeechTextLayout {
  readonly lines: readonly string[];
  /** true = 原文超出「最多 N 行」，已用省略号截断。 */
  readonly truncated: boolean;
}

/**
 * 把一句话排成「最多 maxLines 行、每行不超过 maxWidthPx」的版式。
 *
 * @param text 原文
 * @param measure 量一段文字的像素宽度（渲染层用隐藏的 Text 对象量；单测注入假量尺）
 * @param maxWidthPx 单行最大宽度（px）
 * @param maxLines 最多几行
 *
 * why **按字断行**而不是交给 Phaser 的 wordWrap：中文没有空格，Phaser 的 basicWordWrap
 *   只在空格处断，中文长句会顶破宽度；这里逐字量宽断行，中英混排都稳。
 * why 截断时用「…」而不是直接砍掉：砍掉的话读者不知道后面还有话。
 */
export function layoutSpeechText(
  text: string,
  measure: (candidate: string) => number,
  maxWidthPx: number,
  maxLines: number
): SpeechTextLayout {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const char of paragraph) {
      const candidate = current + char;
      if (current.length > 0 && measure(candidate) > maxWidthPx) {
        lines.push(current);
        current = char;
      } else {
        current = candidate;
      }
    }
    if (current.length > 0) lines.push(current);
  }
  if (lines.length <= maxLines) return { lines, truncated: false };

  // 超出的部分折进最后一行：留 maxLines-1 行完整行 + 一行带省略号的残句。
  // why 不能多留一行：maxLines 是**硬上限**（规格「最多 2 行」），多一行就顶破了。
  const keep = Math.max(0, maxLines - 1);
  const kept = lines.slice(0, keep);
  const overflow = lines[keep] ?? '';
  kept.push(ellipsize(overflow, measure, maxWidthPx));
  return { lines: kept, truncated: true };
}

/** 截断一行并补省略号（逐字收窄到放得下为止）。 */
function ellipsize(line: string, measure: (candidate: string) => number, maxWidthPx: number): string {
  const ellipsis = '…';
  if (measure(line + ellipsis) <= maxWidthPx) return line + ellipsis;
  let cut = line;
  while (cut.length > 0 && measure(cut + ellipsis) > maxWidthPx) {
    cut = cut.slice(0, -1);
  }
  return `${cut}${ellipsis}`;
}
