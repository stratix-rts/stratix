/**
 * 单测：流水线面板目录（hud/panels/pipeline-catalog.ts，task_051）。
 *
 * 驱动说明：纯函数直调（无 DOM / adapter —— hud 目录的可测面就是目录本身；面板装配
 * 在 agent-panel-pipeline.test.ts 用 jsdom 验）。预设常量与契约常量对齐断言
 * （改预设文案不用改测试，但**契约级形状**（站数/变量/合法性）必须锁住）。
 */

import { describe, expect, it } from '@jest/globals';

import {
  buildPipelineCard,
  buildPipelineStartCommand,
  CUSTOM_PIPELINE_STATIONS,
  PIPELINE_PRESETS,
  pipelinePhaseBadge,
  pipelineStatusBadge,
  type PipelineCardInput,
} from '../panels/pipeline-catalog';
import { validatePipelineSpec } from '../../core/task';

describe('PIPELINE_PRESETS（预设模板，task_051 需求：3 个 + 常量可维护）', () => {
  it('恰好 3 个预设：实现+审阅 / 翻译+校对 / 分析+总结', () => {
    expect(PIPELINE_PRESETS.map((preset) => preset.name)).toEqual(['实现+审阅', '翻译+校对', '分析+总结']);
  });

  it('每个预设都是合法规格（与编排器同一份裁决）；第二站必引 {{prev_output}}', () => {
    for (const preset of PIPELINE_PRESETS) {
      const spec = {
        name: preset.name,
        steps: preset.steps.map((step) => ({ kind: step.kind, promptTemplate: step.promptTemplate })),
      };
      expect(validatePipelineSpec(spec)).toEqual({ ok: true });
      expect(preset.steps.length).toBeGreaterThanOrEqual(2);
      expect(preset.steps[0].promptTemplate).toContain('{{task}}');
      expect(preset.steps[1].promptTemplate).toContain('{{prev_output}}');
    }
  });
});

describe('pipelinePhaseBadge（相位映射：待启动/排队/在办/✓/✗/跳过）', () => {
  it('六相位各有显示词与图标（✓/✗ 锁住需求口径）', () => {
    expect(pipelinePhaseBadge('pending')).toMatchObject({ label: '待启动', tone: 'pending' });
    expect(pipelinePhaseBadge('queued')).toMatchObject({ label: '排队', tone: 'active' });
    expect(pipelinePhaseBadge('running')).toMatchObject({ label: '在办', tone: 'active' });
    expect(pipelinePhaseBadge('completed')).toMatchObject({ label: '完成', icon: '✓', tone: 'ok' });
    expect(pipelinePhaseBadge('failed')).toMatchObject({ label: '失败', icon: '✗', tone: 'bad' });
    expect(pipelinePhaseBadge('skipped')).toMatchObject({ label: '跳过', tone: 'skip' });
  });

  it('整线终态徽标：completed=✓ / failed=✗ / running=跑站中', () => {
    expect(pipelineStatusBadge('completed')).toMatchObject({ icon: '✓', tone: 'ok' });
    expect(pipelineStatusBadge('failed')).toMatchObject({ icon: '✗', tone: 'bad' });
    expect(pipelineStatusBadge('running')).toMatchObject({ label: '跑站中', tone: 'active' });
  });
});

describe('buildPipelineCard（卡片模型组装）', () => {
  const card: PipelineCardInput = {
    id: 'pipeline_1',
    name: '实现+审阅',
    issue: '修复登录页',
    status: 'running',
    steps: [
      { characterId: 'ch-1', characterName: '实现者', phase: 'completed', prompt: 'a', taskId: 't1' },
      { characterId: null, characterName: null, phase: 'skipped', prompt: '', taskId: null },
      { characterId: 'ch-2', characterName: '评审员', phase: 'queued', prompt: 'b', taskId: 't2' },
    ],
  };

  it('站序 + 相位徽标 + 站名补位（跳过站没角色名 → 「第 N 站」占位）', () => {
    const model = buildPipelineCard(card);
    expect(model.statusBadge.label).toBe('跑站中');
    expect(model.steps.map((step) => step.title)).toEqual(['实现者', '第 2 站', '评审员']);
    expect(model.steps.map((step) => step.badge.label)).toEqual(['完成', '跳过', '排队']);
    expect(model.steps.map((step) => step.index)).toEqual([0, 1, 2]);
  });
});

describe('buildPipelineStartCommand（表单命令构造）', () => {
  it('预设：选任一预设 + 合法议题 → pipeline.start，规格即预设翻译', () => {
    const command = buildPipelineStartCommand({ presetId: 'impl-review', custom: [], issue: ' 修复登录页 ' });
    expect(command).toEqual({
      type: 'pipeline.start',
      spec: {
        name: '实现+审阅',
        steps: PIPELINE_PRESETS[0].steps.map((step) => ({ kind: step.kind, promptTemplate: step.promptTemplate })),
      },
      issue: '修复登录页',
    });
  });

  it('自定义：两站（角色 × 非空模板）→ pipeline.start（characterId 型站位）', () => {
    const command = buildPipelineStartCommand({
      presetId: 'custom',
      custom: [
        { characterId: 'ch-1', promptTemplate: '做 {{task}}' },
        { characterId: 'ch-2', promptTemplate: '审 {{prev_output}}' },
      ],
      issue: '议题',
    });
    expect(command).toEqual({
      type: 'pipeline.start',
      spec: {
        name: '自定义两站',
        steps: [
          { characterId: 'ch-1', promptTemplate: '做 {{task}}' },
          { characterId: 'ch-2', promptTemplate: '审 {{prev_output}}' },
        ],
      },
      issue: '议题',
    });
    expect(CUSTOM_PIPELINE_STATIONS).toBe(2);
  });

  it('构造不出来返回 null（不发）：空议题 / 没选预设 / 自定义缺角色 / 模板空', () => {
    expect(buildPipelineStartCommand({ presetId: 'impl-review', custom: [], issue: '   ' })).toBeNull();
    expect(buildPipelineStartCommand({ presetId: null, custom: [], issue: '议题' })).toBeNull();
    expect(
      buildPipelineStartCommand({
        presetId: 'custom',
        custom: [
          { characterId: null, promptTemplate: 'a' },
          { characterId: 'ch-2', promptTemplate: 'b' },
        ],
        issue: '议题',
      })
    ).toBeNull();
    expect(
      buildPipelineStartCommand({
        presetId: 'custom',
        custom: [
          { characterId: 'ch-1', promptTemplate: '   ' },
          { characterId: 'ch-2', promptTemplate: 'b' },
        ],
        issue: '议题',
      })
    ).toBeNull();
    // 自定义站位数不足（表单没画全的防御）。
    expect(
      buildPipelineStartCommand({
        presetId: 'custom',
        custom: [{ characterId: 'ch-1', promptTemplate: 'a' }],
        issue: '议题',
      })
    ).toBeNull();
  });
});
