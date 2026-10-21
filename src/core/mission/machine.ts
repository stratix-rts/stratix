/**
 * 文件职责：任务（Mission）状态机 —— **纯函数**，是「什么动作能让任务走到哪个相位」的唯一裁决点。
 *   语义来源：docs/REFACTOR_PLAN_V3.md §2「mission/ 任务分解 / 指派 / 回报状态机」。
 * 输入：当前 MissionView + 一个 MissionAction。
 * 输出：新的 MissionView 与本次迁移是否实质变更（changed=false 时调用方可跳过广播）。
 * 禁止事项：
 *   1. 碰 store / bus / DOM —— 本文件只算状态，不持有也不写入任何东西（写库在 manager.ts）；
 *   2. 直接修改传入的 mission —— 任务态是 immutable，返回新对象；
 *   3. 静默接受非法迁移 —— 非法动作原样返回并带 error，让上层据此上报 Notice（用户点了没反应最伤）；
 *   4. 引入 Zone / 持久化编队 —— Zone 已砍（D5），编组 = 当前多选集合（见 core/unit/group.ts）；
 *   5. 关心单位是否在线 —— 本模块只认 mission 自己的指派名单，存在性由 manager 对账。
 *
 * 相位机（契约词表见 types.ts 的 MissionPhase）：
 *   draft ──assign(非空)──▶ pending ──decide(accept)──▶ confirmed ──start──▶ running ──complete──▶ done
 *     │                       │                            │                     │
 *     └──assign(空)/cancel───┴────decide(reject)/cancel───┴─────────────────────┴──cancel──▶ cancelled
 *   - assign 允许重复执行（pending → pending = 改指派对象，仍待确认；assign(空) 从 pending 退回 draft = 收回指派）。
 *   - done / cancelled 是终态：任何动作都判非法，重复取消也不会二次改写历史。
 *   - decide 只能从 pending 出发：没指派不能确认（draft），已确认的不能重复确认（confirmed/running）。
 */

import { MAX_SELECTION_SIZE, type ConfirmDecision, type MissionPhase, type MissionView } from '../types';

/** 迁移被拒的机器可读原因。HUD/单测据此分流，不解析错误字符串。 */
export type MissionErrorCode =
  /** 当前相位不允许这个动作（含重复确认、对终态操作）。 */
  | 'illegal-transition';

export interface MissionTransition {
  /** 迁移成功后的任务；被拒时是**原引用**（调用方据此判定"没变"）。 */
  readonly next: MissionView;
  readonly changed: boolean;
  readonly error?: MissionErrorCode;
}

export type MissionAction =
  /** 编组指派 / 改指派（unitIds 为空 = 收回指派，任务退回 draft）。 */
  | { type: 'assign'; unitIds: readonly string[] }
  /** 接收决策：accept 接单、reject 拒单（拒单 = cancelled，见 types.ts 词表说明）。 */
  | { type: 'decide'; decision: ConfirmDecision }
  /** confirmed → running：确认之后开工。 */
  | { type: 'start' }
  /** running → done：回报完成。 */
  | { type: 'complete' }
  /** 任意非终态 → cancelled：叫停。 */
  | { type: 'cancel' };

/** 终态：不再接受任何动作。 */
const TERMINAL_PHASES: readonly MissionPhase[] = ['done', 'cancelled'];

export function isTerminalPhase(phase: MissionPhase): boolean {
  return TERMINAL_PHASES.includes(phase);
}

/** 在办（未收尾）：HUD 的"进行中"分组与单位 missionId 的占用判定都用它。 */
export function isActivePhase(phase: MissionPhase): boolean {
  return !isTerminalPhase(phase);
}

/** 去重 + 截断到 MAX_SELECTION_SIZE：编组名单与选择集同一上限口径，避免超大编组拖垮广播与渲染。 */
function normalizeUnitIds(unitIds: readonly string[]): string[] {
  return Array.from(new Set(unitIds.filter((id) => id.length > 0))).slice(0, MAX_SELECTION_SIZE);
}

/**
 * 名单等价判定：**与顺序无关**。
 * why：任务的指派对象是一"组"人（编组），谁排第几没有任何业务含义（对比 core/unit/group.ts 的
 * isSameGroup 同口径）。若按顺序比，同一批人换个顺序指派就会被当成实质变更，白白广播一次、
 * 让面板重渲染 —— 而用户什么都没改。
 */
function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every((id) => set.has(id));
}

/** 非法迁移：原样返回当前引用 + changed=false，调用方不需要判断"是否变了"。 */
function reject(current: MissionView): MissionTransition {
  return { next: current, changed: false, error: 'illegal-transition' };
}

function move(current: MissionView, phase: MissionPhase, patch: Partial<MissionView> = {}): MissionTransition {
  return { next: { ...current, ...patch, phase }, changed: true };
}

/**
 * 新建任务。指派名单非空直接进入 pending（待确认）——「发起任务」与「新建任务」两条命令
 * （command-panel 的 selection 组 / global 组）因此共用这一个工厂，不需要调用方自己判相位。
 */
export function createMission(input: {
  readonly id: string;
  readonly title: string;
  readonly unitIds: readonly string[];
  readonly createdAt: number;
}): MissionView {
  const unitIds = normalizeUnitIds(input.unitIds);
  return {
    id: input.id,
    title: input.title,
    unitIds,
    createdAt: input.createdAt,
    phase: unitIds.length > 0 ? 'pending' : 'draft',
  };
}

/**
 * 状态机本体。纯函数、可穷举测试：非法迁移一律 reject，不抛异常
 * （命令总线是同步的，抛异常会打断一次广播；失败语义由上层转成 Notice）。
 */
export function applyMissionAction(current: MissionView, action: MissionAction): MissionTransition {
  // 终态不可再动：重复 complete / cancel 都不该改写历史（否则事件重放会造出第二份真相）
  if (isTerminalPhase(current.phase)) return reject(current);

  switch (action.type) {
    case 'assign': {
      // 只在"还没开工"时允许改人：confirmed / running 后换人等于把已开工的活悄悄转走。
      if (current.phase !== 'draft' && current.phase !== 'pending') return reject(current);
      const unitIds = normalizeUnitIds(action.unitIds);
      const phase: MissionPhase = unitIds.length > 0 ? 'pending' : 'draft';
      // 指派同一批人（或在 draft 上反复指派空名单）= 没实质变化，跳过广播
      if (sameMembers(current.unitIds, unitIds) && current.phase === phase) {
        return { next: current, changed: false };
      }
      return move(current, phase, { unitIds });
    }

    case 'decide': {
      // 决策只认"已指派待确认"：draft 没编组可确认，confirmed/running 已决策过。
      if (current.phase !== 'pending') return reject(current);
      return action.decision === 'accept'
        ? move(current, 'confirmed')
        : move(current, 'cancelled');
    }

    case 'start': {
      if (current.phase !== 'confirmed') return reject(current);
      return move(current, 'running');
    }

    case 'complete': {
      if (current.phase !== 'running') return reject(current);
      return move(current, 'done');
    }

    case 'cancel': {
      return move(current, 'cancelled');
    }
  }
}

/**
 * 腾位置：只丢终态（done / cancelled）的历史，直到能容下 keep 条。
 * **绝不丢在办任务**（draft / pending / confirmed / running）—— 让一条在办任务静默消失比
 * "拒绝新建"更糟：用户会以为活儿还在跑。腾不出位置时由调用方拒绝新建并回 Notice。
 * 这也是 missions 有界的保证：上限只可能通过"丢历史 / 拒新建"两条路满足，不会出现第三种。
 */
export function dropSettledMissions(missions: readonly MissionView[], keep: number): MissionView[] {
  const drop = new Set<number>();
  let remaining = missions.length;
  for (let i = 0; i < missions.length && remaining > keep; i += 1) {
    if (isTerminalPhase(missions[i].phase)) { drop.add(i); remaining -= 1; }
  }
  return drop.size === 0 ? missions.slice() : missions.filter((_, i) => !drop.has(i));
}