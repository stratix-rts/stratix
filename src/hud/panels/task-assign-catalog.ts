/**
 * 文件职责：派发智能推荐的**纯函数模块**（task_050）—— 由 WorldState（角色/单位/任务相位）
 *   + 历史成功率快照（app 层缓存注入）派生「交给谁」的候选人排序与推荐理由，
 *   并构造带指定承接人的 task.assign 载荷。纯逻辑、零 DOM、零 IO：同样的输入必然同样的输出。
 * 来源：.long-run-agent/tasks/task_050.md「派发智能推荐 —— 按 agent 特长 + 忙闲状态推荐承接人」。
 * 输入：WorldState 的三张读数（characters / units / tasks）+ 每角色历史统计
 *   （completed / failed / 平均完成时长，来自 character_tasks 表的 SQL 聚合，经 IPC → app 层缓存
 *   → 表单打开时注入；缺省 = 无历史 → 成功率取中性值）。
 * 输出：AssigneeModel 排序列表（推荐角标在第一位）+ 排队预计提示文案 + 命令构造入参。
 * 禁止事项：
 *   1. 碰 DOM —— 本文件必须能在 node 环境单测，表单 UI 在 agent-panel.ts；
 *   2. 做 IO / 认识 transport / 认识 DAO —— 历史统计是**参数**，取数归 app 层
 *      （task-record.ts 的聚合查询 + 缓存），hud 只消费注入的快照；
 *   3. 在 core 里复刻推荐算法 —— 择人是 HUD 的展示决策（core 不知道预设库与历史成功率），
 *      core 只认 task.assign 的最终载荷（缺省 = characterId，037 现行为；指定 = targetCharacterId，
 *      manager 校验在档）；
 *   4. 编造读数 —— 无历史显示「未知」，无绑定 agentKind 的角色不进候选人（它接了任务也只能
 *      被出队守门拦成 failed，推荐它是给用户挖坑），缺数据就如实降级。
 *
 * ============ 评分模型（权重常量集中可调）============
 * score = W.idle × 空闲(0|1) + W.specialty × 专属度(0–1) + W.successRate × 成功率(0–1)
 *   - 空闲：该角色在办任务数（queued+running+awaiting_approval）为 0。用任务相位真相而不是
 *     UnitView.status —— 后者只由 running 派生，排队中的角色看着「空闲」其实接不动新活；
 *   - 专属度：suitableKinds **点名**该角色 agentKind 的预设数（043 预设库的反向利用：
 *     dedicatedPresetCount），除以饱和常数夹到 1 —— 有专属预设 = 预设库认为该 kind 有明确
 *     用途画像，是「擅长此类」的代理指标（任务本身是自由文本，没有 kind 可正向匹配）；
 *   - 成功率：completed/(completed+failed)（cancelled / 在办不计入）；无历史退 0.5 中性值
 *     （不惩罚新角色也不奖励它）。权重默认 idle 0.5 / specialty 0.3 / successRate 0.2 ——
 *     忙闲是硬约束（没人接=白推荐），特长其次，历史是修正项。
 * 排序：score 降序 → 在办数升序（同分时队短的先）→ 原序稳定（同一输入两次调用顺序一致）。
 *
 * @since v3.26（task_050）。前置：037（task.assign + FIFO）、043（预设库 suitableKinds）、
 *   047/049（六态相位真相）、038（派发表单）。
 */

import type {
  AgentKind,
  CharacterTask,
  CharacterView,
  UnitStatus,
  UnitView,
  WorldState,
} from '../../core/types';

import { agentKindLabel } from '../screens/onboarding-catalog';
import { dedicatedPresetCount } from '../screens/persona-presets';

// ============================================================================
// 权重常量（集中可调 —— 调推荐口味只动这一处）
// ============================================================================

/**
 * 评分权重（三项和不必为 1，但归一到 1 便于把 score 读成百分位置信度）。
 * idle 硬约束 > specialty > successRate：忙闲是「能不能接」，后两项是「接得好不好」。
 */
export const RECOMMEND_WEIGHTS: Readonly<{ idle: number; specialty: number; successRate: number }> =
  Object.freeze({
    /** 空闲加分（0 或 1，乘数）。 */
    idle: 0.5,
    /** 专属度得分（0–1，乘数）。 */
    specialty: 0.3,
    /** 历史成功率（0–1，乘数；无历史用 NEUTRAL_SUCCESS_RATE）。 */
    successRate: 0.2,
  });

/** 无历史记录时的中性成功率（不惩罚新人：一半一半）。 */
export const NEUTRAL_SUCCESS_RATE = 0.5;

/** 专属度饱和常数：点名该 kind 的预设数达到 N 个即满分（库当前最多 1 个专属预设）。 */
export const SPECIALTY_SATURATE_PRESETS = 1;

// ============================================================================
// 历史统计快照（app 层缓存 → 表单打开时注入）
// ============================================================================

/** 一个角色的历史任务统计（character_tasks 表 SQL 聚合的归约结果）。 */
export interface CharacterTaskStatInput {
  readonly characterId: string;
  /** 终态 completed 条数。 */
  readonly completed: number;
  /** 终态 failed 条数。 */
  readonly failed: number;
  /** completed+failed 的平均耗时（ended−started，ms）；无样本 = null（显示「未知」）。 */
  readonly avgDurationMs: number | null;
}

/**
 * 统计提供口：异步取一次全量快照（每角色一行）。生产 = app 层 task-record 的聚合查询
 * （表单打开时调一次即「缓存刷新」，不做实时订阅）；缺省 / 非 Electron = 无（中性降级）。
 */
export type TaskStatsProvider = () => Promise<readonly CharacterTaskStatInput[] | null>;

/** 成功率：completed/(completed+failed)；无历史（或行缺失）= null（调用方按中性值计分）。 */
export function successRateOf(stat: CharacterTaskStatInput | undefined): number | null {
  if (!stat) return null;
  const settled = stat.completed + stat.failed;
  if (settled <= 0) return null;
  return stat.completed / settled;
}

// ============================================================================
// 候选模型与推荐
// ============================================================================

/** 在办任务判定（与 agent-catalog 的 isActiveTask 同一词表：queued/running/awaiting 算在办）。 */
function isActiveTask(task: CharacterTask): boolean {
  return task.status === 'queued' || task.status === 'running' || task.status === 'awaiting_approval';
}

/** 派发候选人的完整读数（视图模型 + 评分依据，卡片渲染与提交解析都从它出发）。 */
export interface AssigneeModel {
  readonly characterId: string;
  readonly name: string;
  readonly agentKind: AgentKind;
  /** kind 显示名（词表单一真相源：onboarding-catalog 的 AGENT_KIND_LABELS）。 */
  readonly kindLabel: string;
  /** 战场单位实时态（忙闲徽标用；null = 该角色暂无单位投影 —— 档案在仍可接任务）。 */
  readonly unitStatus: UnitStatus | null;
  /** 在办任务数（队列长度，含 running 与 awaiting）。 */
  readonly activeCount: number;
  /** activeCount === 0（评分用的「空闲」，比 UnitView.status 严格 —— 排队也算不空）。 */
  readonly idle: boolean;
  /** 点名该 kind 的专属预设数（「擅长此类」的依据，卡片可显示为徽标）。 */
  readonly specialtyPresets: number;
  /** 历史成功率（0–1）；null = 无历史（理由短语不编数）。 */
  readonly successRate: number | null;
  /** 综合分（权重见 RECOMMEND_WEIGHTS）。 */
  readonly score: number;
  /** 推荐理由短语，如「空闲 · 擅长此类 · 成功率 86%」。 */
  readonly reason: string;
  /** 排序后第一位 = 推荐（卡片角标）。 */
  readonly recommended: boolean;
}

/**
 * 推荐理由短语：三段式，用「 · 」连接 —— 空闲/排队（必有）、擅长此类（专属预设 ≥1）、
 * 成功率（有历史才显示；无历史不写「成功率 50%」，那会是把无知包装成判断）。
 */
export function buildAssigneeReason(input: {
  readonly idle: boolean;
  readonly activeCount: number;
  readonly specialtyPresets: number;
  readonly successRate: number | null;
}): string {
  const parts: string[] = [input.idle ? '空闲' : `排队 ${input.activeCount}`];
  if (input.specialtyPresets > 0) parts.push('擅长此类');
  if (input.successRate !== null) parts.push(`成功率 ${Math.round(input.successRate * 100)}%`);
  return parts.join(' · ');
}

/** 推荐入参的最小面（WorldState 的三张读数；null = 还没收到状态 → 空候选）。 */
export type RecommendInput = Pick<WorldState, 'characters' | 'units' | 'tasks'> | null;

/**
 * 派发候选人排序（推荐算法本体，纯函数）：
 *   候选 = 已绑 agentKind 的角色（未绑定者接了任务只会被出队守门拦成 failed，不列）；
 *   评分 = 空闲加分 + 专属度 + 历史成功率（模型与权重见文件头）；
 *   排序 = score 降序 → 在办数升序 → 原序稳定（两次调用顺序一致，可断言）。
 * 返回空数组的两种情形：没收到状态 / 没有任何已绑定角色（表单退化为 038 行为：派给表单角色）。
 */
export function recommendAssignees(
  state: RecommendInput,
  stats?: readonly CharacterTaskStatInput[] | null
): readonly AssigneeModel[] {
  if (!state) return [];
  const statById = new Map((stats ?? []).map((stat) => [stat.characterId, stat] as const));

  const candidates = state.characters.filter((c): c is CharacterView & { agentKind: AgentKind } => Boolean(c.agentKind));
  const unitByCharacter = new Map<string, UnitView>();
  for (const unit of state.units) {
    if (unit.characterId && !unitByCharacter.has(unit.characterId)) unitByCharacter.set(unit.characterId, unit);
  }
  const tasks = state.tasks ?? [];

  const scored = candidates.map((character, index) => {
    const activeCount = tasks.filter((t) => t.characterId === character.id && isActiveTask(t)).length;
    const idle = activeCount === 0;
    const specialtyPresets = dedicatedPresetCount(character.agentKind);
    const stat = statById.get(character.id);
    const successRate = successRateOf(stat);
    const score =
      (idle ? RECOMMEND_WEIGHTS.idle : 0) +
      Math.min(specialtyPresets / SPECIALTY_SATURATE_PRESETS, 1) * RECOMMEND_WEIGHTS.specialty +
      (successRate ?? NEUTRAL_SUCCESS_RATE) * RECOMMEND_WEIGHTS.successRate;
    return {
      character,
      index,
      activeCount,
      idle,
      specialtyPresets,
      successRate,
      score,
    };
  });

  scored.sort((a, b) => b.score - a.score || a.activeCount - b.activeCount || a.index - b.index);

  return scored.map((entry, rank) => ({
    characterId: entry.character.id,
    name: entry.character.name || entry.character.id,
    agentKind: entry.character.agentKind,
    kindLabel: agentKindLabel(entry.character.agentKind),
    unitStatus: unitByCharacter.get(entry.character.id)?.status ?? null,
    activeCount: entry.activeCount,
    idle: entry.idle,
    specialtyPresets: entry.specialtyPresets,
    successRate: entry.successRate,
    score: entry.score,
    reason: buildAssigneeReason(entry),
    recommended: rank === 0,
  }));
}

// ============================================================================
// 排队预计（全忙提示）
// ============================================================================

/**
 * 排队预计短语：目标角色的队列长度 × 历史平均完成时长（FIFO、并发 1：队里每条大约
 * 一个均值 —— running 那条剩多久不知道，均值是诚实的近似）。无历史 = 「未知」，
 * 不编一个数。返回 null = 目标空闲（没什么可估的，不显示提示）。
 * 文案示例：「Neo 队列 2 条 · 预计 ~24 分钟」/「Neo 队列 2 条 · 预计未知」。
 */
export function buildQueueEstimateHint(
  assignee: AssigneeModel,
  stats?: readonly CharacterTaskStatInput[] | null
): string | null {
  if (assignee.idle) return null;
  const avg = (stats ?? []).find((stat) => stat.characterId === assignee.characterId)?.avgDurationMs ?? null;
  const estimate = avg !== null && Number.isFinite(avg) ? formatDurationMs(assignee.activeCount * avg) : null;
  return `${assignee.name} 队列 ${assignee.activeCount} 条 · ${estimate !== null ? `预计 ${estimate}` : '预计未知'}`;
}

/** 时长格式化：≥1 分钟取整分钟（~N 分钟）；不足 1 分钟如实说「<1 分钟」。 */
function formatDurationMs(ms: number): string {
  const minutes = ms / 60_000;
  return minutes >= 1 ? `~${Math.round(minutes)} 分钟` : '<1 分钟';
}

/** 是否全员在忙（没收到状态 / 没候选人 = false —— 全忙提示只在「有人但都忙」时出现）。 */
export function isAllBusy(assignees: readonly AssigneeModel[]): boolean {
  return assignees.length > 0 && assignees.every((a) => !a.idle);
}

/**
 * 「自动（推荐）」模式的承接人解析：排序第一位即推荐人；没收到状态 / 没有候选人时
 * 退回表单角色（038 行为 —— 由 core/app 的既有守门兜底，不在这里编一个目标）。
 */
export function resolveAutoTarget(
  assignees: readonly AssigneeModel[],
  fallbackCharacterId: string | null
): string | null {
  return assignees[0]?.characterId ?? fallbackCharacterId;
}
