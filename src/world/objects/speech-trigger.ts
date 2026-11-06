/**
 * 文件职责：**气泡话术的触发链**（@since v3.3，task_219 / IX-06）——
 *   决定「谁、在什么时候、说什么」：把 agent 的持续状态（思考中 / 工作中 / LLM 吞吐中）
 *   翻译成一句话，以及在全场静默时按克制的节奏抛一条闲置彩蛋。
 *   本文件**只做裁决**，不画气泡、不发总线事件（画的是 objects/speech-bubble-layer.ts，
 *   发事件的是 world/bridge/bus-adapter.ts）。
 * 输入：单位在场清单 + 每单位的状态信号（说话中 / 在忙 / 在思考）+ 时钟 + 随机源（都可注入）。
 * 输出：每次 tick 返回一组 SpeechTriggerEvent（unitId + text + 来源 + 状态键）。
 * 禁止事项：
 *   1. import phaser —— 本文件零渲染引擎依赖（node 单测直接 import，与 speech-bubble.ts 同纪律）；
 *   2. import hud / app —— 铁律：world 只认识 core；
 *   3. 持有业务真相（任务表 / 会话表）—— 它只认「某单位此刻在什么状态」这三个信号；
 *   4. 自己挑文案 —— 文案池在 core/theme/bubble-copy.ts（唯一事实源），本文件只管时机；
 *   5. 写死文案字面量 —— 改文案只改 core/theme/bubble-copy.ts。
 *
 * ★ 为什么触发链在 world 而不是 core：
 *   「什么时候冒泡」是**表现层的时机**（同屏 ≤3 / 同单位 5s 冷却都在 world/objects/speech-bubble.ts
 *   的板子上裁决），而「说什么」是**文案事实**（在 core/theme）。把两件事分开放：
 *   core 不知道屏幕上已经有几枚气泡，world 不该知道文案池长什么样。
 *
 * @since v3.3（task_219 / IX-06）。
 */

import {
  SPEECH_COPY_METRICS,
  createSpeechCopyPicker,
  type SpeechCopyMetrics,
  type SpeechCopyPicker,
  type SpeechStateKey,
} from '../../core/theme/bubble-copy';

/** 一次触发的来源。 */
export type SpeechTriggerSource =
  /** 状态气泡：agent 的持续状态进入时说一句。 */
  | 'state'
  /** 闲置彩蛋：全场静默时的一句技巧 / 世界观闲话。 */
  | 'idle';

/** 一次触发：让某个单位说一句话。 */
export interface SpeechTriggerEvent {
  /** 说话单位 id。 */
  readonly unitId: string;
  /** 说出的那句话（已从 core/theme/bubble-copy.ts 的池子里抽好）。 */
  readonly text: string;
  /** 来源。 */
  readonly source: SpeechTriggerSource;
  /** 状态键（闲置彩蛋为 null —— 它不对应任何 agent 状态）。 */
  readonly state: SpeechStateKey | null;
}

/** 触发器的构造参数。 */
export interface SpeechTriggerOptions {
  /** 时钟注入（默认 Date.now）：单测确定性推进。 */
  readonly now?: () => number;
  /** 随机源注入（默认 Math.random）：单测确定性选单位 / 抽间隔。 */
  readonly random?: () => number;
  /** 抽取器注入（默认自建一份）：同屏共用一份 ⇒ 跨池也不重样。 */
  readonly picker?: SpeechCopyPicker;
  /** 节奏度量注入（默认 SPEECH_COPY_METRICS）。 */
  readonly metrics?: SpeechCopyMetrics;
}

/** 单个单位在触发器里的状态。 */
interface TriggerUnit {
  /** 在场（由 syncUnits 维护）。 */
  present: boolean;
  /** 正在说话（LLM 吞吐中）。 */
  speaking: boolean;
  /** 在忙（任务在跑）。 */
  busy: boolean;
  /** 接了活还没开工（思考中）。 */
  thinking: boolean;
  /** 上一次落地的状态键（null = 之前不在任何状态里）。 */
  lastState: SpeechStateKey | null;
  /** 待说的状态键（还在沉降期里 —— 还没到说话时刻）。 */
  pendingState: SpeechStateKey | null;
  /** 待说状态的起始时刻（ms）—— 沉降期从此刻起算。 */
  pendingSinceMs: number | null;
  /**
   * 每个状态键上一次开口的时刻（ms）—— 同状态节流**按状态键分别记**。
   * why 分开记：「思考 → 工作 → 思考」时，第二句「思考中」距第一句只有几秒 ⇒ 该压掉；
   *   若只记「上一句是什么状态」，中间那句「工作」会把思考的计时冲掉，压不住。
   */
  readonly spokenAt: Map<SpeechStateKey, number>;
}

/**
 * 气泡触发链（纯逻辑，零 Phaser）。
 *
 * ★ 四条触发规则（缺一不可）：
 *   ① **状态迁移才说话**：agent 进入某个状态（thinking / working / streaming）时说一句；
 *      状态没变就不重复（不然「正在吐字…」会没完没了）。
 *   ② **沉降期**：状态要稳住 metrics.stateSettleMs 才说话；期内状态变了 ⇒ 前一句作废
 *      （「接了活」→「开工了」只说后一句，不让两句互相打脸）。
 *   ③ **同状态节流**：同一单位的**同一个**状态气泡，最小间隔 metrics.stateMinIntervalMs ——
 *      换状态不节流（「接单了」→「开工了」是两句不同的话，不该被压掉）。
 *   ④ **闲置才彩蛋**：全场静默 metrics.idleGraceMs 之后，才按 metrics.idleMinIntervalMs ~
 *      idleMaxIntervalMs 的随机间隔抛一条闲置彩蛋，且只挂在**真的闲着**的单位头上。
 */
export class SpeechTrigger {
  private readonly nowFn: () => number;
  private readonly randomFn: () => number;
  private readonly picker: SpeechCopyPicker;
  private readonly metrics: SpeechCopyMetrics;
  private readonly units = new Map<string, TriggerUnit>();

  /** 上一次**任何**气泡的时刻（ms）—— 闲置彩蛋的静默门槛看它。 */
  private lastActivityAtMs: number;
  /** 上一次闲置彩蛋的时刻（ms）。 */
  private lastIdleAtMs: number;
  /** 距下一条闲置彩蛋还要等多久（ms）—— 每发一条重抽。 */
  private nextIdleDelayMs: number;

  constructor(options: SpeechTriggerOptions = {}) {
    this.nowFn = options.now ?? ((): number => Date.now());
    this.randomFn = options.random ?? Math.random;
    this.picker = options.picker ?? createSpeechCopyPicker({ random: this.randomFn });
    this.metrics = options.metrics ?? SPEECH_COPY_METRICS;
    const now = this.nowFn();
    this.lastActivityAtMs = now;
    this.lastIdleAtMs = now;
    this.nextIdleDelayMs = this.rollIdleDelay();
  }

  /**
   * 同步在场单位清单（场景在 state 同步时调一次 —— 不在每帧调，避免每帧建数组）。
   *
   * @param unitIds 当前在场的单位 id
   */
  syncUnits(unitIds: readonly string[]): void {
    const alive = new Set(unitIds);
    for (const id of alive) {
      const record = this.units.get(id);
      if (record) {
        record.present = true;
        continue;
      }
      this.units.set(id, {
        present: true,
        speaking: false,
        busy: false,
        thinking: false,
        lastState: null,
        pendingState: null,
        pendingSinceMs: null,
        spokenAt: new Map(),
      });
    }
    // 离场的单位：从清单里摘掉（它的状态不该再驱动气泡）。
    for (const [id, record] of this.units) {
      if (!alive.has(id)) record.present = false;
    }
  }

  /** 单位离场（清掉它的触发状态 —— 表现不许悬在已不存在的单位头顶）。 */
  removeUnit(unitId: string): void {
    this.units.delete(unitId);
  }

  /** 说话状态变化（unit.speaking 事件驱动）—— true = LLM 正在吐字。 */
  setSpeaking(unitId: string, speaking: boolean): void {
    const record = this.ensure(unitId);
    record.speaking = speaking;
  }

  /** 忙闲变化（单位 status='busy' 驱动 —— 有 running 任务就是忙）。 */
  setBusy(unitId: string, busy: boolean): void {
    const record = this.ensure(unitId);
    record.busy = busy;
  }

  /** 「接了活还没开工」变化（任务入队驱动）。 */
  setThinking(unitId: string, thinking: boolean): void {
    const record = this.ensure(unitId);
    record.thinking = thinking;
  }

  /**
   * 记一次「外部气泡」（移动指令 / 选中 / 任务完成等事件气泡）—— 闲置彩蛋的静默门槛看它。
   *
   * why 需要：刚派完活就冒「小技巧」，像是在说「你刚才那单不算数」。
   */
  noteActivity(nowMs?: number): void {
    this.lastActivityAtMs = nowMs ?? this.nowFn();
  }

  /**
   * 推进触发链，产出本轮该说的话。
   *
   * @param nowMs 当前时刻（ms）
   * @returns 本轮要冒的泡（空数组 = 本轮不说话）
   */
  tick(nowMs?: number): readonly SpeechTriggerEvent[] {
    const now = nowMs ?? this.nowFn();
    const events: SpeechTriggerEvent[] = [];

    for (const [unitId, record] of this.units) {
      if (!record.present) continue;
      const next = resolveState(record);

      // ① 状态迁移 ⇒ 重新武装「待说」窗口（旧的待说句作废 —— 状态都变了，那句话已经不对了）。
      if (next !== record.lastState) {
        record.lastState = next;
        record.pendingState = next;
        record.pendingSinceMs = next === null ? null : now;
      }

      // ② 没有待说的状态 / 已经说过（pending 清空）→ 本轮不说话。
      const pending = record.pendingState;
      if (pending === null || pending !== next) continue;
      if (record.pendingSinceMs === null) continue;

      // ③ 沉降期未到 —— 再等等（此刻状态又变了，上面会把 pending 换掉）。
      if (now - record.pendingSinceMs < this.metrics.stateSettleMs) continue;

      // 沉降期到了 ⇒ 这一句落地（此后不再重复，除非状态再变一次）。
      record.pendingState = null;
      record.pendingSinceMs = null;

      // ④ 同状态节流：刚说过同一个状态 → 压掉。
      if (!this.maySpeakState(record, pending, now)) continue;

      record.spokenAt.set(pending, now);
      events.push({
        unitId,
        text: this.picker.pick(pending),
        source: 'state',
        state: pending,
      });
    }

    const idle = this.pickIdleEvent(now);
    if (idle) events.push(idle);

    if (events.length > 0) this.lastActivityAtMs = now;
    return events;
  }

  /** 当前是否处在「全场静默」窗口（闲置彩蛋的门槛）。 */
  isQuiet(nowMs?: number): boolean {
    const now = nowMs ?? this.nowFn();
    return now - this.lastActivityAtMs >= this.metrics.idleGraceMs;
  }

  /**
   * 状态气泡是否放行：**同一个状态键**距上次开口不足最小间隔 → 压掉。
   *
   * why 按状态键分别记（而不是只记「上一句是什么」）：思考 → 工作 → 思考，
   *   第二句「思考中」距第一句只有几秒 ⇒ 该压掉；只记上一句的话，
   *   中间那句「工作」会把思考的计时冲掉 ⇒ 压不住（同一状态连着刷屏）。
   */
  private maySpeakState(record: TriggerUnit, state: SpeechStateKey, now: number): boolean {
    const last = record.spokenAt.get(state);
    if (last === undefined) return true;
    return now - last >= this.metrics.stateMinIntervalMs;
  }

  /**
   * 闲置彩蛋的裁决：静默够久 + 间隔到了 + 有真闲着的单位 → 抛一条。
   *
   * why 要「真闲着」：正在说话 / 在忙 / 刚接活的单位都不该冒技巧 —— 那不是闲置。
   */
  private pickIdleEvent(now: number): SpeechTriggerEvent | null {
    if (now - this.lastActivityAtMs < this.metrics.idleGraceMs) return null;
    if (now - this.lastIdleAtMs < this.nextIdleDelayMs) return null;
    const candidates: string[] = [];
    for (const [unitId, record] of this.units) {
      if (!record.present) continue;
      if (record.speaking || record.busy || record.thinking) continue;
      candidates.push(unitId);
    }
    if (candidates.length === 0) return null;
    const index = Math.min(candidates.length - 1, Math.max(0, Math.floor(this.randomFn() * candidates.length)));
    const unitId = candidates[index] ?? '';
    if (!unitId) return null;
    this.lastIdleAtMs = now;
    this.nextIdleDelayMs = this.rollIdleDelay();
    return { unitId, text: this.picker.pickIdle(), source: 'idle', state: null };
  }

  /** 抽下一条闲置彩蛋的间隔（落在 [min, max] 区间内）。 */
  private rollIdleDelay(): number {
    const { idleMinIntervalMs, idleMaxIntervalMs } = this.metrics;
    const span = Math.max(0, idleMaxIntervalMs - idleMinIntervalMs);
    return idleMinIntervalMs + Math.floor(this.randomFn() * (span + 1));
  }

  /** 取（必要时建）单位的状态记录。 */
  private ensure(unitId: string): TriggerUnit {
    const existing = this.units.get(unitId);
    if (existing) return existing;
    const created: TriggerUnit = {
      present: false,
      speaking: false,
      busy: false,
      thinking: false,
      lastState: null,
      pendingState: null,
      pendingSinceMs: null,
      spokenAt: new Map(),
    };
    this.units.set(unitId, created);
    return created;
  }
}

/**
 * 一个单位此刻处在哪个状态（优先级：说话 > 忙 > 思考）。
 *
 * why 说话优先：正在吐字时冒「开工了」是噪音 —— 此刻最该说的是「正在吐字…」。
 */
function resolveState(record: TriggerUnit): SpeechStateKey | null {
  if (record.speaking) return 'streaming';
  if (record.busy) return 'working';
  if (record.thinking) return 'thinking';
  return null;
}
