/**
 * 文件职责：流水线面板目录（task_051）—— agent-panel「流水线」模式的**纯目录**：
 *   ① 预设模板 PIPELINE_PRESETS（实现+审阅 / 翻译+校对 / 分析+总结 —— 常量可维护：
 *      改文案 / 加预设只动这一处，面板与命令构造自动跟上）；
 *   ② 卡片读数模型（PipelineCardInput → PipelineCardModel）与**相位映射**
 *      （pipelinePhaseBadge：pending/queued/running/completed/failed/skipped →
 *      待启动/排队/在办/✓/✗/跳过）；
 *   ③ 表单提交的命令构造（buildPipelineStartCommand：预设或自定义两站 → HudCommand
 *      pipeline.start；构造不出来返回 null，面板不发）。
 * 输入：hud 自己的输入形状（PipelineCardInput 等 —— app 层 pipeline-service 的
 *   PipelineRunView 与之**同构**，结构一致即可注入，不跨层 import，与 050 的
 *   CharacterTaskStatInput 同一手法）+ core 的契约常量与校验（validatePipelineSpec 等）。
 * 输出：纯函数与常量（可测、无 DOM）。
 * 禁止事项：
 *   1. import world / app —— hud 目录铁律（面板渲染的活的站态**只**经注入的实时 feed 口
 *      拿，路径见 agent-panel 的 deps.pipelines）；
 *   2. DOM / 自定义元素 —— 那是 agent-panel 的事，这里只出数据形状；
 *   3. 定编排语义 —— 站怎么跑是 app 层 pipeline-service 的事，这里只管「怎么显示」与
 *      「怎么把用户选择拼成一份合法规格」。
 *
 * @since v3.27（task_051）。
 */

import { validatePipelineIssue, validatePipelineSpec } from '../../core/task';
import type { AgentKind, HudCommand, PipelineSpec, PipelineStepSpec } from '../../core/types';

/** 自定义模式的站数（task 需求：预设 3 个 + 自定义两站 —— 站数定死，UI 与构造器同源）。 */
export const CUSTOM_PIPELINE_STATIONS = 2;

/** 预设模板的一站（展示用 label + 规格：kind 与指令模板）。 */
export interface PipelinePresetStep {
  readonly label: string;
  readonly kind: AgentKind;
  readonly promptTemplate: string;
}

/** 预设模板（name 进 PipelineSpec.name；steps 渲染成 kind 型站位）。 */
export interface PipelinePreset {
  readonly id: string;
  readonly label: string;
  readonly name: string;
  readonly description: string;
  readonly steps: readonly PipelinePresetStep[];
}

/**
 * 预设模板 3 个（task_051 需求）。★可维护常量：文案 / 站数（≤ MAX_PIPELINE_STEPS）/
 *   新增预设都在这里改 —— 面板的选项列表与 buildPipelineStartCommand 的构造路径自动跟上。
 * 模板变量：{{task}} = 原始议题；{{prev_output}} = 上一站输出全文（渲染在 core/task/pipeline.ts）。
 * 站位语义：第二站必引 {{prev_output}}（串行协作的本体 —— 上一站的产出是下一站的输入）。
 */
export const PIPELINE_PRESETS: readonly PipelinePreset[] = [
  {
    id: 'impl-review',
    label: '实现 + 审阅',
    name: '实现+审阅',
    description: '代码 agent 实现，评审 agent 审阅并给改进建议',
    steps: [
      {
        label: '实现',
        kind: 'claude-code',
        promptTemplate: '请实现以下需求，给出完整方案与代码：\n{{task}}',
      },
      {
        label: '审阅',
        kind: 'kimi',
        promptTemplate: '请审阅以下实现，指出问题并给出具体的改进建议：\n{{prev_output}}',
      },
    ],
  },
  {
    id: 'translate-proofread',
    label: '翻译 + 校对',
    name: '翻译+校对',
    description: '先翻成英文，再校对修订出终稿',
    steps: [
      {
        label: '翻译',
        kind: 'kimi',
        promptTemplate: '请把以下内容翻译成英文，只输出译文：\n{{task}}',
      },
      {
        label: '校对',
        kind: 'claude-code',
        promptTemplate: '请校对以下英文译文，纠正错漏并输出修订后的完整译文：\n{{prev_output}}',
      },
    ],
  },
  {
    id: 'analyze-summarize',
    label: '分析 + 总结',
    name: '分析+总结',
    description: '深度分析议题，再压缩成简明摘要',
    steps: [
      {
        label: '分析',
        kind: 'openclaw',
        promptTemplate: '请深入分析以下议题，给出要点、风险与结论：\n{{task}}',
      },
      {
        label: '总结',
        kind: 'kimi',
        promptTemplate: '请把以下分析压缩成简明摘要（要点 + 一句话结论）：\n{{prev_output}}',
      },
    ],
  },
];

/** 面板读数的单站相位（app 层 PipelineStepPhase 同构 —— 见文件头输入注）。 */
export type PipelinePhase =
  | 'pending'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped';

/** 面板读数的单站输入（app 层 PipelineStepView 同构）。 */
export interface PipelineStepCardInput {
  readonly characterId: string | null;
  readonly characterName: string | null;
  readonly phase: PipelinePhase;
  readonly prompt: string;
  readonly taskId: string | null;
}

/** 面板读数的整线输入（app 层 PipelineRunView 同构）。 */
export interface PipelineCardInput {
  readonly id: string;
  readonly name: string;
  readonly issue: string;
  readonly status: 'running' | 'completed' | 'failed';
  readonly steps: readonly PipelineStepCardInput[];
}

/** 相位徽标：显示词 + 图标 + 色调（面板按色调挑 CSS 变量，不在这里写样式）。 */
export interface PipelinePhaseBadge {
  readonly label: string;
  readonly icon: string;
  readonly tone: 'pending' | 'active' | 'ok' | 'bad' | 'skip';
}

/**
 * 相位映射（task_051 需求：排队/在办/✓/✗/跳过）—— 面板卡片、HUD 卡渲染、测试共用一份。
 * pending 单独有词（「待启动」）：不是排队（还没入列），读的人能分清「在队里」和「没轮到」。
 */
export function pipelinePhaseBadge(phase: PipelinePhase): PipelinePhaseBadge {
  switch (phase) {
    case 'pending':
      return { label: '待启动', icon: '·', tone: 'pending' };
    case 'queued':
      return { label: '排队', icon: '…', tone: 'active' };
    case 'running':
      return { label: '在办', icon: '▸', tone: 'active' };
    case 'completed':
      return { label: '完成', icon: '✓', tone: 'ok' };
    case 'failed':
      return { label: '失败', icon: '✗', tone: 'bad' };
    case 'skipped':
      return { label: '跳过', icon: '—', tone: 'skip' };
  }
}

/** 整线终态徽标（同相位映射口径：completed=✓ / failed=✗ / running=跑站中）。 */
export function pipelineStatusBadge(status: PipelineCardInput['status']): PipelinePhaseBadge {
  if (status === 'completed') return { label: '已完成', icon: '✓', tone: 'ok' };
  if (status === 'failed') return { label: '已失败', icon: '✗', tone: 'bad' };
  return { label: '跑站中', icon: '▸', tone: 'active' };
}

/** 卡片读数的单站模型（面板渲染的直接形状）。 */
export interface PipelineStepCardModel {
  readonly index: number;
  /** 站名：承接角色名 +（无角色时）站位号 —— 跳过站没角色，仍要显示「第 N 站」。 */
  readonly title: string;
  readonly badge: PipelinePhaseBadge;
  readonly phase: PipelinePhase;
  readonly prompt: string;
}

/** 卡片读数的整线模型。 */
export interface PipelineCardModel {
  readonly id: string;
  readonly name: string;
  readonly issue: string;
  readonly status: PipelineCardInput['status'];
  readonly statusBadge: PipelinePhaseBadge;
  readonly steps: readonly PipelineStepCardModel[];
}

/**
 * 组装卡片模型（纯函数）：相位 → 徽标映射 + 站名补位。跳过/待启动的站没角色名，
 * 用「第 N 站」占位（站序可见性：断链读数必须能看出哪几站没跑）。
 */
export function buildPipelineCard(card: PipelineCardInput): PipelineCardModel {
  return {
    id: card.id,
    name: card.name,
    issue: card.issue,
    status: card.status,
    statusBadge: pipelineStatusBadge(card.status),
    steps: card.steps.map((step, index) => ({
      index,
      title: step.characterName ?? `第 ${index + 1} 站`,
      badge: pipelinePhaseBadge(step.phase),
      phase: step.phase,
      prompt: step.prompt,
    })),
  };
}

/** 表单的自定义站位（角色 × 模板；两站定长 —— CUSTOM_PIPELINE_STATIONS）。 */
export interface PipelineCustomStation {
  readonly characterId: string | null;
  readonly promptTemplate: string;
}

/**
 * 面板注入的实时 feed 口（task_051）：subscribe 通知重画，snapshot 拿读数快照。
 * ★注入方向：app 层 pipeline-service.feed 与之**同构**（结构一致即可注入，不跨层 import ——
 * 与 050 的 TaskStatsProvider 同一手法）。流水线站态不进 WorldState（架构注见
 * core/task/pipeline.ts），面板的实时读数只经这条注入面，不碰总线。
 */
export interface PipelineFeedInput {
  subscribe(listener: () => void): () => void;
  snapshot(): readonly PipelineCardInput[] | null;
}

/** 表单状态：选中预设 id（'custom' = 自定义两站）+ 自定义站位 + 共享议题。 */
export interface PipelineFormInput {
  readonly presetId: string | null;
  readonly custom: readonly PipelineCustomStation[];
  readonly issue: string;
}

/**
 * 表单提交的命令构造（纯函数）：预设 → 直接翻译成规格；自定义 → 两站（characterId 选了
 * 且模板非空才成站）。合法性双闸：这里先裁（构造不出来返回 null，面板不发、表单保持
 * 开着），编排器侧 validatePipelineSpec 再兜底（跨层同一份裁决函数）。
 */
export function buildPipelineStartCommand(input: PipelineFormInput): HudCommand | null {
  const issue = input.issue.trim();
  const preset =
    input.presetId === 'custom' ? null : PIPELINE_PRESETS.find((item) => item.id === input.presetId) ?? null;

  let spec: PipelineSpec;
  if (preset) {
    spec = {
      name: preset.name,
      steps: preset.steps.map<PipelineStepSpec>((step) => ({
        kind: step.kind,
        promptTemplate: step.promptTemplate,
      })),
    };
  } else {
    // 自定义两站：任何一站缺角色或空模板 → null（表单保持开着，用户补齐）。
    const stations = (input.custom ?? []).slice(0, CUSTOM_PIPELINE_STATIONS);
    if (stations.length !== CUSTOM_PIPELINE_STATIONS) return null;
    const steps: PipelineStepSpec[] = [];
    for (const station of stations) {
      const characterId = station.characterId?.trim();
      const template = station.promptTemplate.trim();
      if (!characterId || template.length === 0) return null;
      steps.push({ characterId, promptTemplate: station.promptTemplate });
    }
    spec = { name: '自定义两站', steps };
  }

  // 同一份裁决（core/task/pipeline.ts）：议题先裁（空议题不发），规格再裁。
  if (!validatePipelineIssue(issue).ok) return null;
  if (!validatePipelineSpec(spec).ok) return null;
  return { type: 'pipeline.start', spec, issue };
}
