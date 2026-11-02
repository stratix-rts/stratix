/**
 * 文件职责：**task_run 会话事件埋点器**（@since v3.46，task_105 / v3.2b-B6）——
 *   把一条角色任务的执行生命周期翻译成**会话事件流**，并对事件频率做节制。
 *   方案来源：docs/SESSION-PLAN.md §8「task_run 事件全量但每步限长」。
 * 输入：任务执行侧的四个动作（开工 / 步骤 / 输出尾部 / 收尾）+ 会话写入面（SessionManager）。
 * 输出：会话事件（task_started / step / output_tail / completed / failed）与会话收尾。
 * 禁止事项：
 *   1. 碰任务执行本身 —— 本模块**只记账**，不执行、不重试、不改任务相位（埋点不许改行为）；
 *   2. 搬任务全文进会话 —— 全文仍在 character_tasks 表；会话只留骨架（渐进迁移：不搬旧数据）；
 *   3. 自己开库 / 自己写 session_events —— 落库由 core/session 的持久化口负责
 *      （service 独占写铁律：存储件只有 app/services/persistence 一处）；
 *   4. 无上限地记事件 —— 事件频率必须节制（见下方 eventCap 口径）；
 *   5. 抛异常打断任务执行 —— 记账失败只记日志（会话是史官，任务才是主角）。
 *
 * ============ 事件序列（LITE→FULL 渐进：只对新执行落事件，旧数据不迁移）============
 *   created（core 建会话时自带，seq=1）
 *     └ task_started  { taskId, 描述摘要 }     —— 任务开工（执行路径起点）
 *        ├ reference   { targetSessionId }      —— @会话引用（task_107：这条任务引用了别的会话）
 *        ├ step        { label, detail? }      —— 关键节点，一步一条
 *        ├ output_tail { text, truncated }      —— 输出尾部（尾 500 字，超出截断并标记）
 *        └ completed   { summary? }             —— 成功收尾
 *          或 failed    { reason }              —— 失败收尾（含错误摘要）
 *     └ closed（收尾时 core 自动补一条终态事件）
 *
 * ============ 事件频率节制（eventCap）============
 *   同一 task 的事件数上限：env `SX_TASK_EVENT_CAP`，缺省 50。
 *   超限后**只记 completed / failed**（终态必须留痕 —— "这单跑过没有、成了没有"是会话存在的理由），
 *   中间的 step / output_tail 停止记录。
 *   why 要有上限：任务输出可能极长、步骤可能极多；一条 task 灌进成百上千条事件，
 *     会把 session_events 表撑爆、把会话面板刷成噪声 —— 而面板的价值恰恰在"关键节点"。
 *   why 计数用**会话内序号**（事件信封的 seq）：序号就是该会话已落的事件数，
 *     不另设一套计数器（两份计数必然漂移）。
 *
 * @since v3.46，task_105（v3.2b-B6）。
 *   v3.47（task_104 / v3.2b-B5）追加**自动起名接线**：建会话后异步起名（旁路，不阻塞任务开工）。
 */

import type { SessionEventInput, SessionManager, SessionTitleService } from '../../core/session';

/** 同一 task 的会话事件数上限（env 缺省值）。 */
export const DEFAULT_TASK_EVENT_CAP = 50;

/** env 键名：同一 task 的会话事件数上限。 */
export const TASK_EVENT_CAP_ENV = 'SX_TASK_EVENT_CAP';

/** 终态口径（与任务的两种终态一一对应；cancelled 不落终态事件 —— 没跑过不算"跑过"）。 */
export type TaskSessionOutcome = 'completed' | 'failed';

/** 任务开工的入参。 */
export interface TaskSessionBeginInput {
  readonly taskId: string;
  readonly characterId: string;
  /** 任务指令原文（描述摘要的来源，也是自动起名的首条消息）。 */
  readonly prompt: string;
}

/** 任务收尾的入参。 */
export interface TaskSessionFinishInput extends TaskSessionBeginInput {
  readonly outcome: TaskSessionOutcome;
  /** 收尾摘要（成功 = 产出摘要；失败 = 错误摘要）。 */
  readonly summary: string;
}

/** 埋点器端口（程序化调用；缺端口 = 不记）。 */
export interface TaskSessionRecorder {
  /** 任务开工：建会话 + 记 task_started。同一 task 重复调用是 no-op（幂等）。 */
  begin(input: TaskSessionBeginInput): void;
  /** 记一个关键节点（label 是短语；detail 可缺省）。 */
  step(taskId: string, label: string, detail?: string): void;
  /** 记输出尾部（空输出不记 —— 没有输出就没有尾部可留）。 */
  outputTail(taskId: string, output: string): void;
  /**
   * 记一条 **@会话引用**（@since v3.49，task_107 / v3.2b-B8）——
   *   本任务引用了另一条会话（targetSessionId = 被引用的会话 id）。
   *
   * why 不受事件数上限（eventCap）约束：引用是**一次性**的事实（引用了几场会话），
   *   条数有界（≤ 一次输入里的引用个数），且它解释了"agent 为什么知道那件事"——
   *   属于"会话存在的理由"那一类（与 completed / failed 同级：不能被中途停记）。
   */
  reference(taskId: string, targetSessionId: string): void;
  /** 终态：记 completed / failed 并收尾会话（收尾后不再记任何事件）。 */
  finish(input: TaskSessionFinishInput): void;
}

export interface TaskSessionRecorderOptions {
  /** 会话写入面；缺省 = 不记会话（埋点是旁路，没有它任务照跑）。 */
  readonly sessions?: SessionManager;
  /**
   * 自动起名服务（可选，@since v3.47，task_104 / v3.2b-B5）—— 建会话后**异步**起名。
   * 缺省 = 不起名（标题就是建会话时那条规则版标题）。
   */
  readonly titles?: SessionTitleService;
  /** 同一 task 的事件数上限；缺省读 env，再缺省 DEFAULT_TASK_EVENT_CAP。 */
  readonly eventCap?: number;
  /** env 来源（单测注入）；缺省读进程 env。 */
  readonly env?: Record<string, string | undefined>;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}

/**
 * 同时被埋点的 task 会话数上限（内存表的硬顶）。
 * why 需要硬顶：表里留着**已收尾**的条目（终态幂等要靠它），
 * 任务一条条跑下来表会一直涨 —— 没有硬顶就是无界增长。
 * 超顶时淘汰一条（优先淘汰已收尾的）并顺手收尾它的会话
 * （不收尾 = 留下一条永不关闭的会话，长期占着 WorldState.sessions 的坑位，
 * 直到会话数达上限把新会话全拒了）。
 */
const MAX_TRACKED_TASK_SESSIONS = 200;

/** 单条 task 的会话状态（内存态；随任务收尾删除）。 */
interface TrackedSession {
  /** 会话 id；null = 建会话失败（达上限等），本条任务不再尝试建。 */
  readonly sessionId: string | null;
  /** 已落事件数（= 会话内序号，追加成功即更新）。 */
  recorded: number;
  /** 已收尾（终态幂等：重复 finish 不再记事件）。 */
  finished: boolean;
}

/**
 * 读 env（防御式）：渲染层 bundle 里 process.env 被 vite define 替换成空对象
 * （见 vite.config.ts 与 cli-transport/spawn-env.ts 的同款口径）—— 那里读到的就是"没配"。
 */
function safeEnv(): Record<string, string | undefined> {
  return typeof process !== 'undefined' && process.env ? process.env : {};
}

/**
 * 解析事件数上限：env 缺省 / 非法（NaN / ≤0）→ 50。
 * why 非法值回落而不是报错：env 是外部输入，配错一个不该让整条任务回路瘫掉。
 */
export function resolveTaskEventCap(
  env: Record<string, string | undefined> = safeEnv(),
  fallback: number = DEFAULT_TASK_EVENT_CAP
): number {
  const raw = env[TASK_EVENT_CAP_ENV];
  if (raw === undefined || raw.trim().length === 0) return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 造埋点器。
 *
 * @param options.sessions 缺省 = 不记（端口缺席即缺省范式：没接会话域的任务照跑）。
 * @param options.eventCap 缺省读 env `SX_TASK_EVENT_CAP`（默认 50）。
 */
export function createTaskSessionRecorder(
  options: TaskSessionRecorderOptions = {}
): TaskSessionRecorder {
  const logger = options.logger ?? ((): void => { /* 缺省静默 */ });
  const sessions = options.sessions;
  const titles = options.titles;
  const cap = options.eventCap ?? resolveTaskEventCap(options.env ?? safeEnv());
  /** taskId → 会话状态（内存态；收尾后**留着**做终态幂等，靠硬顶淘汰 —— 见 makeRoom）。 */
  const tracked = new Map<string, TrackedSession>();

  /** 记一条事件（旁路：抛错只记日志，绝不倒灌任务执行回路）。 */
  const append = (state: TrackedSession, input: SessionEventInput): void => {
    if (!sessions || !state.sessionId) return;
    try {
      const event = sessions.appendEvent(state.sessionId, input);
      if (event) state.recorded = event.seq; // 序号即已落事件数（不另设计数器）
    } catch (error) {
      logger(`[task-session] 会话事件记账抛错（${state.sessionId}/${input.type}）：${describe(error)}`);
    }
  };

  /**
   * 腾位置（内存表硬顶）：超顶时淘汰一条，并顺手收尾它的会话
   * （留着不关 = 一条永不关闭的会话占着坑位，直到会话数达上限把新会话全拒了）。
   *
   * 淘汰顺序：**先淘汰已收尾的**（它们的历史已落定，留着只为终态幂等），
   * 全是在办任务时才淘汰最旧的那条 —— 优先牺牲"已经没用的"，不牺牲"正在跑的"。
   */
  const makeRoom = (): void => {
    if (tracked.size < MAX_TRACKED_TASK_SESSIONS) return;
    let victim: string | undefined;
    for (const [taskId, state] of tracked) {
      if (state.finished) {
        victim = taskId;
        break;
      }
    }
    if (victim === undefined) {
      const oldest = tracked.keys().next();
      if (oldest.done) return;
      victim = oldest.value;
    }
    const state = tracked.get(victim);
    tracked.delete(victim);
    if (state?.sessionId && sessions) {
      try {
        // 已收尾的会话再 close 是"终态拒收动作" → 返回 null，不抛（无害）。
        sessions.closeSession(state.sessionId, '任务会话记录已清理');
      } catch (error) {
        logger(`[task-session] 清理旧会话抛错（${state.sessionId}）：${describe(error)}`);
      }
    }
    logger(`[task-session] 埋点表超顶（${MAX_TRACKED_TASK_SESSIONS}），淘汰最旧的一条：${victim}`);
  };

  /** 建会话（失败 = null：不记这条任务的事件，不打断任务）。 */
  const createSession = (input: TaskSessionBeginInput): string | null => {
    if (!sessions) return null;
    try {
      const session = sessions.createSession({
        kind: 'task_run',
        participants: [input.characterId],
        refId: input.taskId,
        // 首条消息只用于**自动起名**（不进事件流）：拿任务指令当标题主体，面板上一眼认得出是哪单。
        firstMessage: input.prompt,
      });
      const sessionId = session?.id ?? null;
      // 自动起名（@since v3.47，task_104 / v3.2b-B5）：**异步旁路** —— 不阻塞任务开工。
      //   素材用 taskTitle（任务指令）—— 与建会话时那条规则版标题同源，
      //   无 env 配置时算出的标题一字不差 → 写回时同名不改（行为与 2a 完全一致）。
      if (sessionId && titles) {
        void titles.retitle(sessionId, {
          kind: 'task_run',
          participants: [input.characterId],
          taskTitle: input.prompt,
        });
      }
      return sessionId;
    } catch (error) {
      logger(`[task-session] 建会话抛错（${input.taskId}）：${describe(error)}`);
      return null;
    }
  };

  return {
    begin(input: TaskSessionBeginInput): void {
      if (!sessions) return;
      if (tracked.has(input.taskId)) return; // 幂等：同一任务只开工一次
      makeRoom();
      const sessionId = createSession(input);
      const state: TrackedSession = { sessionId, recorded: 0, finished: false };
      tracked.set(input.taskId, state);
      if (!sessionId) return; // 建会话失败（达上限等）：本条任务不再记事件
      // 开工事件：taskId + 描述摘要（指令原文；core 侧按上限收口）。
      append(state, {
        type: 'task_started',
        payload: { taskId: input.taskId, summary: input.prompt },
      });
    },

    step(taskId: string, label: string, detail?: string): void {
      const state = tracked.get(taskId);
      if (!state || state.finished || !state.sessionId) return;
      if (state.recorded >= cap) return; // 超限：中间事件停记（终态仍记）
      append(state, {
        type: 'step',
        payload: detail === undefined ? { label } : { label, detail },
      });
    },

    outputTail(taskId: string, output: string): void {
      const state = tracked.get(taskId);
      if (!state || state.finished || !state.sessionId) return;
      if (state.recorded >= cap) return;
      if (output.trim().length === 0) return; // 没有输出就没有尾部可留
      append(state, { type: 'output_tail', payload: { text: output } });
    },

    reference(taskId: string, targetSessionId: string): void {
      const state = tracked.get(taskId);
      if (!state || state.finished || !state.sessionId) return;
      if (targetSessionId.trim().length === 0) return; // 没有目标就没有引用
      // 不看 eventCap：引用是一次性事实（条数有界），且属于"会话存在的理由"那一类。
      append(state, { type: 'reference', payload: { targetSessionId } });
    },

    finish(input: TaskSessionFinishInput): void {
      if (!sessions) return;
      let state = tracked.get(input.taskId);
      if (state?.finished) return; // 终态幂等（重复收尾不记第二遍）
      if (!state) {
        // 没开工就收尾（守门拦截 / 启动即失败这类"没跑起来"的路径）：
        // 这时补建一条会话，把终态记上 —— 会话存在的意义就是"这单跑过没有、成了没有"。
        makeRoom();
        const sessionId = createSession(input);
        state = { sessionId, recorded: 0, finished: false };
        tracked.set(input.taskId, state);
        if (!sessionId) return;
      }
      // 终态事件：超限也照记（这是会话存在的理由）。
      if (state.sessionId) {
        if (input.outcome === 'completed') {
          append(state, {
            type: 'completed',
            payload: input.summary.length > 0 ? { summary: input.summary } : {},
          });
        } else {
          append(state, { type: 'failed', payload: { reason: input.summary } });
        }
        try {
          sessions.closeSession(
            state.sessionId,
            input.outcome === 'completed' ? '任务完成' : '任务失败'
          );
        } catch (error) {
          logger(`[task-session] 会话收尾抛错（${state.sessionId}）：${describe(error)}`);
        }
      }
      state.finished = true;
      // **不**从表里删：留着这条是为了终态幂等（同一 task 重复收尾不再建第二条会话）。
      // 内存表的增长由 MAX_TRACKED_TASK_SESSIONS 硬顶兜住（makeRoom 淘汰）。
    },
  };
}
