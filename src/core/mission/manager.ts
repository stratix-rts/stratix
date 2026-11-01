/**
 * 文件职责：**任务域的写入面** —— 把 HudCommand（mission.create / assign / confirm / cancel）
 *   与程序化调用翻译成状态机动作，并把结果**投影进 store**（WorldState.missions + units 的占用字段）。
 *   相位裁决全在 machine.ts（纯函数），本文件只做三件事：找对象 → 跑动作 → 写库 + 上报。
 *   来源：docs/REFACTOR_PLAN_V3.md §2「mission/ 任务分解 / 指派 / 回报状态机」。
 * 输入：core/store 的 CoreStore；core/runtime 转译好的 mission.* 命令参数（title/unitIds/decision…）。
 * 输出：WorldState.missions 与 WorldState.units[].missionId 的写入；失败时的 Notice。
 * 禁止事项：
 *   1. 自己订阅总线 / 自己 emitState —— 状态广播的唯一出口是 core/runtime.ts 的 store 订阅
 *      （与 agent-link 同一铁律，否则一次变更广播两遍，两侧白重渲染一次）；
 *   2. 在这里判定相位合法性 —— 那是 machine.ts 的职责，两处判定必然漂移；
 *   3. 在命令里抛异常 —— 命令总线是同步的，抛异常会打断整轮广播；一切失败都转成 Notice；
 *   4. 让 missions 无限增长 —— 超过 MAX_MISSIONS 先丢终态历史（见 pruneMissions）；
 *   5. 改单位忙闲（UnitView.status）—— 那份真相由 world / agent-link 投影，本模块只碰 missionId。
 *
 * 为什么本文件不自己订阅命令通道（与 agent-link 的做法不同）：agent-link 持有长驻连接（外部资源，
 * 必须随 runtime 起停），而任务域是纯内存投影，没有资源可清理；让 core/runtime.ts 像调用选择状态机
 * 那样直接调用本模块，少一次总线订阅、少一层"这条命令归谁"的判定，代价只是四行 case。
 *
 * 广播次数（perf）：一次命令通常只写一次 store（状态迁移 + 单位占用同步合并成同一次 setState），
 * 另加 store.pushNotice 自带的一次广播（与 agent-link 同一口径；通知队列本身受 MAX_NOTICES 约束）。
 *
 * @since v3.38（task_077）检查点（checkpoint）命令是**唯一的例外**：它**不发 Notice**
 * （成功与失败都不发）—— 记账是高频后台动作，逐条通知会冲垮通知队列并盖掉该让人看见的消息。
 */

import { worldStore, type CoreStore } from '../store';
import {
  MAX_MISSIONS,
  MAX_SELECTION_SIZE,
  NOTICE_TTL_MS,
  type ConfirmDecision,
  type MissionBrief,
  type MissionView,
  type NoticeLevel,
  type UnitView,
} from '../types';

import {
  appendMissionCheckpoint,
  applyMissionAction,
  createMission as createMissionView,
  dropSettledMissions,
  isTerminalPhase,
  type MissionAction,
} from './machine';

/** 命令/调用被拒的机器可读原因。 */
export type MissionRejectionCode = 'not-found' | 'empty-title' | 'limit-exceeded' | 'illegal-transition';

type CommitResult =
  | { readonly ok: true; readonly mission: MissionView; readonly droppedUnits: number }
  | { readonly ok: false; readonly code: MissionRejectionCode };

export interface MissionManagerOptions {
  /** 状态持有者；默认 worldStore 单例。单测用 createStore() 隔离。 */
  readonly store?: CoreStore;
  readonly now?: () => number;
  readonly createId?: (prefix: string) => string;
  /** 任务条数上限；默认契约常量 MAX_MISSIONS。 */
  readonly maxMissions?: number;
}

export interface MissionManager {
  readonly store: CoreStore;
  /**
   * 立一条任务（指派名单非空即直接进入 pending 待确认）。失败返回 null 并上报 Notice。
   * @since v3.38（task_077）brief（结构化正文）与 dependsOn（前置任务 id）为可选透传。
   */
  createMission(input: {
    readonly title: string;
    readonly unitIds: readonly string[];
    readonly brief?: MissionBrief;
    readonly dependsOn?: readonly string[];
  }): MissionView | null;
  /** 编组指派 / 改指派（unitIds 为空 = 收回指派，退回 draft）。 */
  assignMission(missionId: string, unitIds: readonly string[]): MissionView | null;
  /** 接收决策：accept 接单、reject 拒单（= cancelled）。 */
  decideMission(missionId: string, decision: ConfirmDecision): MissionView | null;
  /** 叫停在办任务。 */
  cancelMission(missionId: string): MissionView | null;
  /**
   * running → done：任务回报完成。
   * **当前没有 HudCommand 能到达它**（契约里没有 mission.complete）：world 侧上报完成事件时调用，
   * 或由 agent-link 的回报消息驱动（TODO(v3.x) 接回报链路）。先留出纯逻辑入口，
   * 免得回报落地时再回头改状态机 —— 迁移规则早写在 machine.ts 并有单测兜着。
   */
  completeMission(missionId: string): MissionView | null;
  /**
   * 追加一条检查点（@since v3.38，task_077）—— 静默记账：**不发 Notice**（成功与失败都不发）。
   * why 静默：记账是高频后台动作，逐条通知会把通知队列冲垮、盖掉真正该让人看见的消息。
   * 代价：调用方拿不到"记上了没有"的即时回执 —— 读方看 mission.checkpoints 即可。
   * 返回 null = 没记上（任务不存在 / 已终态 / note 为空）。
   */
  checkpointMission(missionId: string, note: string): MissionView | null;
}

/**
 * 指派名单对账：去重、丢弃未知单位、截断到 MAX_SELECTION_SIZE。
 * why 对账：HUD 的选择集可能带着已经消失的单位（快照与输入天然有时间差），
 * 悬空 id 留在任务上会让面板显示"未知单位"，编组=选择集的等价关系也就断了。
 */
export function reconcileAssignedUnits(
  unitIds: readonly string[],
  knownUnitIds: readonly string[]
): string[] {
  const known = new Set(knownUnitIds);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of unitIds) {
    if (id.length === 0 || seen.has(id) || !known.has(id)) continue;
    if (out.length >= MAX_SELECTION_SIZE) break;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * 把任务的占用关系同步到 units[].missionId（契约字段：单位当前承担的任务，空闲为 null）。
 * why 必须同步：MissionView 与 UnitView 是同一件事的两面，只写 missions 会让"已指派"的任务
 * 在单位侧看不见（agent-panel 会渲染成无任务），WorldState 内部自相矛盾。
 * 释放条件有两个：**任务进终态**，或**单位已不在名单里**（改指派 / 收回指派）。
 * 无变化时返回原数组引用，让 store 的"引用未变即不广播"这条优化对 units 也成立。
 *
 * 已知取舍：同一单位被两个在办任务指派时按"最后指派生效"（UnitView.missionId 是单值）。
 * 要表达"一个单位并行承担多个任务"得等 MissionView 增加占用关系字段，那是后续任务的事，不在这里造。
 */
export function syncUnitMissions(units: readonly UnitView[], mission: MissionView): UnitView[] {
  const releasing = isTerminalPhase(mission.phase);
  let changed = false;
  const next = units.map((unit) => {
    const mine = unit.missionId === mission.id;
    if (releasing) {
      if (!mine) return unit;
      changed = true;
      return { ...unit, missionId: null };
    }
    // 已被本任务占用但已不在名单里 = 被改指派/收回指派 → 释放
    if (mine && !mission.unitIds.includes(unit.id)) {
      changed = true;
      return { ...unit, missionId: null };
    }
    if (mine || !mission.unitIds.includes(unit.id)) return unit;
    changed = true;
    return { ...unit, missionId: mission.id };
  });
  return changed ? next : (units as UnitView[]);
}

class Manager implements MissionManager {
  readonly store: CoreStore;

  private readonly now: () => number;
  private readonly createId: (prefix: string) => string;
  private readonly maxMissions: number;
  private seq = 0;

  constructor(options: MissionManagerOptions = {}) {
    this.store = options.store ?? worldStore;
    this.now = options.now ?? ((): number => Date.now());
    this.createId = options.createId ?? ((prefix: string): string => `${prefix}_${this.now()}_${++this.seq}`);
    this.maxMissions = options.maxMissions ?? MAX_MISSIONS;
  }

  createMission(input: {
    readonly title: string;
    readonly unitIds: readonly string[];
    readonly brief?: MissionBrief;
    readonly dependsOn?: readonly string[];
  }): MissionView | null {
    const title = input.title.trim();
    if (title.length === 0) {
      this.notify('warn', rejectionText('empty-title', this.maxMissions));
      return null;
    }

    const outcome: { mission?: MissionView; code?: MissionRejectionCode; droppedUnits?: number } = {};
    this.store.setState((state) => {
      // 先腾位子：新任务要占 1 格，所以裁到 max-1，且**只丢终态历史**；
      // 全是在办任务时腾不出位置 → 拒绝新建并回 Notice，绝不静默挤掉谁（见 dropSettledMissions）。
      const kept = dropSettledMissions(state.missions, this.maxMissions - 1);
      if (kept.length >= this.maxMissions) {
        outcome.code = 'limit-exceeded';
        return state;
      }
      const assigned = reconcileAssignedUnits(input.unitIds, state.units.map((unit) => unit.id));
      const mission = createMissionView({
        id: this.createId('mission'),
        title,
        unitIds: assigned,
        createdAt: this.now(),
        // @since v3.38（task_077）：结构化正文与依赖链原样透传（归一在 machine.ts 里做）。
        brief: input.brief,
        dependsOn: input.dependsOn,
      });
      outcome.mission = mission;
      outcome.droppedUnits = countUnique(input.unitIds) - assigned.length;
      return { ...state, missions: [...kept, mission], units: syncUnitMissions(state.units, mission) };
    });

    const mission = outcome.mission;
    if (!mission) {
      this.notify('warn', rejectionText(outcome.code ?? 'limit-exceeded', this.maxMissions));
      return null;
    }
    this.notify(
      'info',
      mission.unitIds.length > 0
        ? `已发起任务「${mission.title}」，指派给 ${mission.unitIds.length} 个单位，待确认`
        : `已新建任务「${mission.title}」，待指派`,
    );
    this.reportDroppedUnits(outcome.droppedUnits ?? 0);
    return mission;
  }

  assignMission(missionId: string, unitIds: readonly string[]): MissionView | null {
    return this.finish(this.commit(missionId, [{ type: 'assign', unitIds }]));
  }

  decideMission(missionId: string, decision: ConfirmDecision): MissionView | null {
    // 接单即开工：accept 的落点语义是"接受并执行"，confirmed → running 合并进同一次写入
    // （HUD 只需要看到最终态；分开两次广播会让面板在两次重渲染之间闪一个中间态）。
    const actions: MissionAction[] =
      decision === 'accept'
        ? [{ type: 'decide', decision }, { type: 'start' }]
        : [{ type: 'decide', decision }];
    return this.finish(this.commit(missionId, actions), decision);
  }

  cancelMission(missionId: string): MissionView | null {
    return this.finish(this.commit(missionId, [{ type: 'cancel' }]));
  }

  completeMission(missionId: string): MissionView | null {
    return this.finish(this.commit(missionId, [{ type: 'complete' }]));
  }

  /**
   * 追加一条检查点（@since v3.38，task_077）—— 与其它命令不同：**全程静默**（不发 Notice）。
   *
   * 为什么不走 commit(actions)：checkpoint 不改相位（既不是迁移也不是回退），
   * 硬塞成一种 MissionAction 会把"记账"混进"相位机"里、把终态拒绝与相位拒绝搅成一锅。
   * 这里单独一条写入路径：找任务 → 交给 machine.ts 的 appendMissionCheckpoint 裁决
   * （终态拒绝在那里判，这一条只管写库）。
   *
   * 只改 missions，不碰 units：相位没变 → 单位占用关系不变（syncUnitMissions 无事可做）。
   */
  checkpointMission(missionId: string, note: string): MissionView | null {
    const trimmed = note.trim();
    if (trimmed.length === 0) return null; // 空 note 不记账（静默丢弃）

    const outcome: { mission?: MissionView } = {};
    this.store.setState((state) => {
      const index = state.missions.findIndex((mission) => mission.id === missionId);
      if (index < 0) return state; // 任务不存在：静默（不打扰）
      const step = appendMissionCheckpoint(state.missions[index], trimmed, this.now());
      if (step.error || !step.changed) return state; // 终态：静默拒绝
      const missions = state.missions.slice();
      missions[index] = step.next;
      outcome.mission = step.next;
      return { ...state, missions };
    });
    return outcome.mission ?? null;
  }

  /**
   * 一次写入跑完整串动作：**原子**——中途任一动作非法就整条作废，不留半截状态被广播出去。
   * assign 动作先对账未知单位；实质未变（引用相同）时返回原 state，store 自然跳过广播。
   */
  private commit(missionId: string, actions: readonly MissionAction[]): CommitResult {
    const outcome: { mission?: MissionView; code?: MissionRejectionCode; droppedUnits?: number } = {};

    this.store.setState((state) => {
      const index = state.missions.findIndex((mission) => mission.id === missionId);
      if (index < 0) {
        outcome.code = 'not-found';
        return state;
      }
      const knownUnitIds = state.units.map((unit) => unit.id);
      let droppedUnits = 0;
      let next = state.missions[index];

      for (const raw of actions) {
        let action = raw;
        if (raw.type === 'assign') {
          const unitIds = reconcileAssignedUnits(raw.unitIds, knownUnitIds);
          droppedUnits += countUnique(raw.unitIds) - unitIds.length;
          action = { type: 'assign', unitIds };
        }
        const step = applyMissionAction(next, action);
        if (step.error) {
          outcome.code = step.error;
          return state;
        }
        next = step.next;
      }

      if (next === state.missions[index]) return state;

      const missions = state.missions.slice();
      missions[index] = next;
      outcome.mission = next;
      outcome.droppedUnits = droppedUnits;
      return { ...state, missions, units: syncUnitMissions(state.units, next) };
    });

    if (!outcome.mission) return { ok: false, code: outcome.code ?? 'illegal-transition' };
    return { ok: true, mission: outcome.mission, droppedUnits: outcome.droppedUnits ?? 0 };
  }

  /**
   * 统一出口：把 commit 的结果变成"返回值 + Notice"。
   * 用户点了没反应是最伤的一种体验 —— 每种被拒都给出人话原因，绝不静默丢弃。
   */
  private finish(result: CommitResult, decision?: ConfirmDecision): MissionView | null {
    if (!result.ok) {
      this.notify('warn', rejectionText(result.code, this.maxMissions));
      return null;
    }
    const { mission } = result;
    if (decision === 'accept') this.notify('info', `已接单「${mission.title}」，开始执行`);
    else if (decision === 'reject') this.notify('warn', `已拒绝任务「${mission.title}」`);
    this.reportDroppedUnits(result.droppedUnits);
    return mission;
  }

  private reportDroppedUnits(dropped: number): void {
    if (dropped > 0) this.notify('warn', `已忽略 ${dropped} 个不存在的单位（可能刚刚离线）`);
  }

  private notify(level: NoticeLevel, text: string): void {
    const at = this.now();
    this.store.pushNotice({
      id: this.createId('notice'),
      level,
      text,
      createdAt: at,
      expiresAt: at + NOTICE_TTL_MS,
    });
  }
}

/** 去重后的入参个数（用于"忽略了几个未知单位"的口径，与是否截断无关）。 */
function countUnique(unitIds: readonly string[]): number {
  return new Set(unitIds.filter((id) => id.length > 0)).size;
}

/** 被拒原因的人话表述。用户点了没反应是最伤的一种体验 —— 每种被拒都必须有说法。 */
function rejectionText(code: MissionRejectionCode, maxMissions: number): string {
  switch (code) {
    case 'not-found':
      return '任务不存在';
    case 'empty-title':
      return '任务标题不能为空';
    case 'limit-exceeded':
      return `任务数已达上限（${maxMissions}），请先收尾再发起新任务`;
    case 'illegal-transition':
      return '当前状态下这一步不可执行（可能已经确认过或已经收尾）';
  }
}

export function createMissionManager(options: MissionManagerOptions = {}): MissionManager {
  return new Manager(options);
}