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
 *   - @since v3.6（task_120）**remove 不是相位迁移**：撤掉一条从未开工的任务（draft / pending）——
 *     它不进 'cancelled'，而是从世界态里**消失**（见 canRemoveMission：判据只有这一份）。
 *
 * @since v3.38（task_077）新增三块**数据能力**（不动既有相位与转移）：
 *   - 结构化正文（brief）：createMission 透传，落进 MissionView.brief；
 *   - 检查点历史（checkpoints）：appendMissionCheckpoint 追加（终态拒绝），纯函数不碰 store；
 *   - 依赖链（dependsOn）：createMission 透传 + isMissionUnlocked 判定（**只判定，不调度** ——
 *     自动解锁是下一单的事，这一单只把"依赖"这件事变成可判定的纯函数）。
 * @since v3.39（task_078）依赖链补上**调度口径**（仍在本文件，纯函数）：
 *   - resolveMissionDependencies / findMissingDependencies：逐条依赖的满足状态与"还差哪几个"，
 *     **core 守门（confirm）与 HUD 展示共用同一份判定**（各说一套是最难查的一类 bug）；
 *   - collectNewlyUnlocked：某条任务进终态后"刚刚解锁"的下游任务（解锁调度的算子）；
 *   - shortMissionId：任务 id 短码（Notice 文案与 HUD 依赖行共用一份口径）。
 *   ★解锁状态**不落 MissionView**：真相在相位上（isMissionUnlocked 现算），
 *     物化成字段会与"历史裁剪后查不到依赖 = 已满足"的口径漂移（详见 isMissionUnlocked 注释）。
 */

import { filterInstanceScope, scopeOf } from '../project/entity-scope';
import {
  MAX_MISSION_CHECKPOINTS,
  MAX_MISSION_DEPENDENCIES,
  MAX_SELECTION_SIZE,
  type ConfirmDecision,
  type MissionBrief,
  type MissionPhase,
  type MissionView,
  type ProjectInstanceId,
} from '../types';

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

/**
 * 可**撤掉**的相位（@since v3.6，task_120）：只有**从未开工**的编组任务（draft / pending）。
 *
 * why 与 cancel 分开（两个动作不是一回事）：
 *   - cancel = **叫停**：任意非终态 → 'cancelled'，留一条终态墓碑（UI 的「停止任务」走这条）；
 *   - remove = **撤掉**：这条任务还没确认、还没开工 —— 什么都没发生，世界态里不必留墓碑
 *     （外部 agent 用它清理自己造的悬空 / 探针任务）。
 *
 * why 只认这两个相位：已确认 / 在跑的任务背后有活儿在跑（撤任务不等于撤活儿 —— 角色任务还在跑，
 * 撤掉编组只会让状态自相矛盾）；终态是历史，改写/抹掉历史违反 core 的终态铁律。
 *
 * 口径只有这一份：core 的 manager 守门、MCP 工具的拒绝文案、HUD 的提示都调它（各写一份必然漂移）。
 */
export function canRemoveMission(mission: MissionView): boolean {
  return mission.phase === 'draft' || mission.phase === 'pending';
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

/** brief 的四段（契约词表见 types.ts 的 MissionBrief）。顺序即展示顺序。 */
const BRIEF_FIELDS = ['requirements', 'acceptance', 'deliverables', 'constraints'] as const;

/**
 * 结构化正文归一：逐段 trim，丢掉空段；**全空则整体不落**（brief = undefined）。
 * why 要归一：brief 是可选字段，调用方（HUD / MCP / 命令载荷）很可能传 `{ acceptance: '  ' }`
 * 这种"看似有值其实是空"的壳。留着空串等于给状态塞噪声，还让"这条任务有没有验收标准"
 * 这个判定变得含糊（空串既不是 undefined 也没有内容）。
 */
export function normalizeBrief(brief: MissionBrief | undefined): MissionBrief | undefined {
  if (!brief) return undefined;
  // 四段全是可选 → 局部用可变副本拼装（readonly 只约束"外部不能改"，拼装过程要能写）。
  const next: { -readonly [K in keyof MissionBrief]?: string } = {};
  for (const field of BRIEF_FIELDS) {
    const raw = brief[field];
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value.length > 0) next[field] = value;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

/**
 * 依赖链归一：去重 + 丢弃空 id + **丢弃自依赖** + 截断到 MAX_MISSION_DEPENDENCIES。
 * why 丢自依赖：自己等自己 = 永远解不了锁的死结（isMissionUnlocked 对自依赖判 false，
 * 那这条任务就永远出不来）。这种输入是调用方的错，不该由 core 默默收下变成一条死任务。
 * why 要截断：依赖列表随状态全量广播，且判定时要逐条查表（见 isMissionUnlocked）。
 */
export function normalizeDependsOn(
  dependsOn: readonly string[] | undefined,
  selfId: string
): string[] | undefined {
  if (!dependsOn || dependsOn.length === 0) return undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of dependsOn) {
    if (id.length === 0 || id === selfId || seen.has(id)) continue;
    if (out.length >= MAX_MISSION_DEPENDENCIES) break;
    seen.add(id);
    out.push(id);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * 新建任务。指派名单非空直接进入 pending（待确认）——「发起任务」与「新建任务」两条命令
 * （command-panel 的 selection 组 / global 组）因此共用这一个工厂，不需要调用方自己判相位。
 *
 * @since v3.38（task_077）brief / dependsOn 为**可选**透传：缺省时这两个键**不出现**在
 *  MissionView 里（不是 undefined 值），裸任务的状态形状与过去完全一致。
 */
export function createMission(input: {
  readonly id: string;
  readonly title: string;
  readonly unitIds: readonly string[];
  readonly createdAt: number;
  readonly brief?: MissionBrief;
  readonly dependsOn?: readonly string[];
  /**
   * @since v3.3（task_204 / M2-07）所属副本 id（manager 按当前活跃副本盖）。
   * 缺省 = 不落该键（形状与 M2-07 之前一致）；落了就必须是**真 id**
   *   （归属口径「缺省 ⇒ 默认沙盒」由 core/project/entity-scope.ts 统一裁决）。
   */
  readonly instanceId?: ProjectInstanceId | null;
}): MissionView {
  const unitIds = normalizeUnitIds(input.unitIds);
  const brief = normalizeBrief(input.brief);
  const dependsOn = normalizeDependsOn(input.dependsOn, input.id);
  return {
    id: input.id,
    title: input.title,
    unitIds,
    createdAt: input.createdAt,
    phase: unitIds.length > 0 ? 'pending' : 'draft',
    ...(brief ? { brief } : {}),
    ...(dependsOn ? { dependsOn } : {}),
    ...(input.instanceId !== undefined && input.instanceId !== null
      ? { instanceId: input.instanceId }
      : {}),
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
 * 追加一条检查点（@since v3.38，task_077）—— append-only 记账，**不改相位**。
 *
 * 规则：
 *   - 任意非终态相位都可记（draft / pending / confirmed / running）；
 *   - 终态（done / cancelled）拒绝：收尾后的任务不再改写历史（同 applyMissionAction 的终态铁律 ——
 *     否则事件重放会造出第二份真相）。
 *   - 超出 MAX_MISSION_CHECKPOINTS 时丢**最旧**的：最近的记账才有排查价值，
 *     而检查点随 WorldState 全量广播，条数必须有界。
 *
 * 相位裁决放在本文件而不是 manager：manager.ts 有一条铁律"不在写入面判相位合法性"，
 * 两处判定必然漂移。这里是纯函数，不碰 store / 时钟（at 由调用方给）。
 */
export function appendMissionCheckpoint(
  current: MissionView,
  note: string,
  at: number
): MissionTransition {
  if (isTerminalPhase(current.phase)) return reject(current);
  const checkpoints = [...(current.checkpoints ?? []), { at, note }];
  const trimmed =
    checkpoints.length > MAX_MISSION_CHECKPOINTS
      ? checkpoints.slice(checkpoints.length - MAX_MISSION_CHECKPOINTS)
      : checkpoints;
  return { next: { ...current, checkpoints: trimmed }, changed: true };
}

/**
 * 改标题（@since v3.11，task_155）—— **不改相位**的写入面（与 checkpoint 同一纪律）。
 *
 * 用途：任务发起时标题是占位「生成中…」（用户不再提供标题），
 *   Agent 第一轮工作回报生成标题后经 app 层 task-service 的回报通道回写到这里。
 *
 * 规则：
 *   - 任意非终态相位都可改（在办任务正在被命名）；
 *   - 终态（done / cancelled）拒绝：收尾后的任务不再改写历史（同 appendMissionCheckpoint 的铁律）；
 *   - 标题 trim 后为空 → 拒绝（不改出一个空标题 —— 那等于把占位擦掉又没东西可填）；
 *   - 标题与现值相同 → changed=false（不产生无谓广播）。
 *
 * 相位裁决放在本文件而不是 manager：manager.ts 的铁律是"不在写入面判相位合法性"。
 */
export function renameMission(current: MissionView, title: string): MissionTransition {
  if (isTerminalPhase(current.phase)) return reject(current);
  const next = title.trim();
  if (next.length === 0) return reject(current);
  if (next === current.title) return { next: current, changed: false };
  return { next: { ...current, title: next }, changed: true };
}

/**
 * 依赖判定（@since v3.38，task_077）：这条任务的前置条件是否都已满足。
 *
 * 规则：
 *   - 无依赖 → 已解锁（true）；
 *   - 依赖全部处于终态（done 或 **cancelled**）→ 已解锁。
 *     why cancelled 也算解锁：被叫停的前置任务同样"不会再来拖住这条"，
 *     若把 cancelled 算未解锁，前置一旦作废整条链就锁死（死锁）。
 *   - 存在**在办**（非终态）的依赖 → 未解锁（false）；
 *   - 自依赖 → 恒为 false（自己等自己永远等不到）；
 *   - 依赖 id 在 allMissions 里**查不到** → 视为已满足（不算阻塞）。
 *     why：missions 有上限（MAX_MISSIONS），超限时先丢终态历史（见 dropSettledMissions）——
 *     被丢掉的必然是终态的（本来就满足）。若把"查不到"判成阻塞，一条依赖了已收尾
 *     任务的链会在历史被裁掉后永久锁死。查不到的 id 也不会"以后才出现"（id 不会复用）。
 *
 * @since v3.39（task_078）：实现改为委托 findMissingDependencies —— 判定口径**只有一份**。
 * why 要收口：core 的 confirm 守门要回答"还差哪几个"，HUD 的依赖行要回答"哪条没满足"，
 * 两处各写一份判定迟早漂移（core 说能确认、界面说还差依赖 = 用户无从下手）。
 *
 * **本函数只判定，不调度** —— 什么时候把任务放出去（自动解锁）由 manager 侧的调度完成
 * （见 collectNewlyUnlocked 与 core/mission/manager.ts 的终态广播路径）。
 */
export function isMissionUnlocked(
  mission: MissionView,
  allMissions: readonly MissionView[]
): boolean {
  return findMissingDependencies(mission, allMissions).length === 0;
}

/**
 * 依赖明细（@since v3.39，task_078）：一条任务的每条依赖当前是什么状态。
 * **core 与 HUD 共用这一份形状**：守门要的是"哪几条没满足"，界面要的是"每条什么相位"。
 */
export interface MissionDependencyStatus {
  /** 依赖的任务 id（完整值，用于派发命令 / 定位）。 */
  readonly id: string;
  /** id 短码（见 shortMissionId）—— 念给用户听的形式。 */
  readonly shortId: string;
  /** 依赖任务的标题；查不到（历史被裁 / id 悬空）时为 null。 */
  readonly title: string | null;
  /** 依赖任务的相位；查不到时为 null。 */
  readonly phase: MissionPhase | null;
  /** 是否已满足：依赖处于终态（done / cancelled）或查不到 = 已满足；自依赖恒为未满足。 */
  readonly satisfied: boolean;
}

/**
 * 依赖明细（@since v3.39，task_078）：逐条解析依赖的满足状态。
 *
 * why 单独一个函数而不是让调用方各查各的：满足口径是**业务规则**（终态即满足、
 * 查不到即满足、自依赖永不满足），规则散在两处就会漂移。HUD 只做展示，
 * 但展示的必须是 core 认的那份满足 —— 所以两边都调这一个函数。
 *
 * @since v3.3（task_204 / M2-07）**依赖判定按副本隔离**：索引只收本副本的任务
 *   （跨副本的依赖 id 查不到 ⇒ 不阻塞本副本的任务，见函数体的说明）。
 */
export function resolveMissionDependencies(
  mission: MissionView,
  allMissions: readonly MissionView[]
): MissionDependencyStatus[] {
  const dependsOn = mission.dependsOn ?? [];
  if (dependsOn.length === 0) return [];
  // ★ 副本隔离（@since v3.3，task_204 / M2-07）：索引**只收本副本**的任务。
  //   why：全量索引会让 A 副本的任务依赖到 B 副本的任务 id 时，被 B 的相位判「未满足」——
  //   那是**跨副本的误判**（B 收不收尾与 A 无关），会把 A 永久锁住（design §4.2 表第 3 行）。
  //   隔离后跨副本的依赖 id **查不到** ⇒ 按本文件既有口径「查不到即已满足」处理（不阻塞本副本）。
  //   口径只有一份：core 的 confirm 守门、HUD 的依赖行、MCP 工具都走这个函数。
  const byId = new Map(
    filterInstanceScope(allMissions, scopeOf(mission.instanceId)).map((m) => [m.id, m])
  );
  return dependsOn.map((depId) => {
    const dep = byId.get(depId);
    // 自依赖 = 死结：无论相位如何都算"没满足"（与 isMissionUnlocked 的自依赖口径一致）。
    const satisfied = depId === mission.id ? false : dep ? isTerminalPhase(dep.phase) : true;
    return {
      id: depId,
      shortId: shortMissionId(depId),
      title: dep?.title ?? null,
      phase: dep?.phase ?? null,
      satisfied,
    };
  });
}

/**
 * 未满足的依赖 id 列表（@since v3.39，task_078）—— core 的 confirm 守门用它给出
 * "还差哪几个"，HUD 的依赖行用同一份判定标警示色。
 * 空数组 ⟺ isMissionUnlocked 为 true（两者恒等，见 isMissionUnlocked 的收口说明）。
 */
export function findMissingDependencies(
  mission: MissionView,
  allMissions: readonly MissionView[]
): string[] {
  return resolveMissionDependencies(mission, allMissions)
    .filter((dep) => !dep.satisfied)
    .map((dep) => dep.id);
}

/**
 * 任务 id 的短码（@since v3.39，task_078）—— Notice 文案与 HUD 依赖行共用一份口径。
 *
 * why 要短码：任务 id 是 `前缀_时间戳_序号` 的长串（mission_1762300000000_3），
 * 直接印在界面上一行放不下、念出来也没法听。但只留序号会跨会话撞车，
 * 所以取「前缀_末段」：mission_1762300000000_3 → mission_3。
 * 短码只用于**展示与提示**，任何派发 / 查表一律用完整 id（短码不唯一是允许的）。
 */
export function shortMissionId(id: string): string {
  const trimmed = id.trim();
  const parts = trimmed.split('_');
  if (parts.length < 2) return trimmed;
  const head = parts[0];
  const tail = parts[parts.length - 1];
  if (!head || !tail) return trimmed;
  return `${head}_${tail}`;
}

/**
 * 解锁调度算子（@since v3.39，task_078）：某条任务进终态后，**刚刚解锁**的下游任务。
 *
 * 输入是**前后两份任务列表**（before = 变更前，after = 变更后），输出是满足
 * 「依赖它」且「变更前未解锁、变更后已解锁」的任务。
 *
 * why 要前后两份：解锁是**差分**概念，只看 after 说不清"是不是刚解锁"——
 * 早就解锁的任务（依赖链上游早就收尾）不该被反复报成"新解锁"。
 * 只比对一次差分的代价：O(任务数 × 依赖数)，上限 100 × 32，可接受（只在终态迁移时算）。
 *
 * 注意：本函数**只算不写**。解锁不是新相位（不动状态机），而是"允许确认"的判定结果；
 * 落到用户可见面的动作在 manager（发 Notice）与 HUD（依赖行标就绪）。
 */
export function collectNewlyUnlocked(
  before: readonly MissionView[],
  after: readonly MissionView[],
  finishedId: string
): MissionView[] {
  const beforeById = new Map(before.map((m) => [m.id, m]));
  const unlocked: MissionView[] = [];
  for (const mission of after) {
    if (mission.id === finishedId) continue;
    if (!(mission.dependsOn ?? []).includes(finishedId)) continue;
    const previous = beforeById.get(mission.id);
    const wasUnlocked = previous ? isMissionUnlocked(previous, before) : false;
    if (wasUnlocked) continue;
    if (isMissionUnlocked(mission, after)) unlocked.push(mission);
  }
  return unlocked;
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