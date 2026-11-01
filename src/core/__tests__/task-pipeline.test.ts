/**
 * 单测：流水线纯模型（core/task/pipeline.ts，task_051）。
 *
 * 驱动说明：纯函数零 IO，直调断言即可（bus / store / manager 都不碰 —— core 零 IO 铁律的
 * 测试面：本文件 import 不出现 bus/store 就是合规证明）。截断边界用 PREV_OUTPUT_MAX 驱动，
 * 不硬编码 4000（常量动的时候测试跟着走，边界语义不变）。
 */

import {
  PREV_OUTPUT_MAX,
  PREV_OUTPUT_TRUNCATION_NOTE,
  renderPipelineStepPrompt,
  resolvePipelineStepCharacter,
  truncatePrevOutput,
  validatePipelineIssue,
  validatePipelineSpec,
} from '../task';
import {
  MAX_PIPELINE_ISSUE_LEN,
  MAX_PIPELINE_NAME_LEN,
  MAX_PIPELINE_STEPS,
  MAX_PIPELINE_TEMPLATE_LEN,
  type CharacterView,
} from '../types';

const characters: CharacterView[] = [
  { id: 'ch-1', name: '实现者', persona: '', level: 1, experience: 0, agentKind: 'claude-code', skinId: null, externalSessionId: null },
  { id: 'ch-2', name: '评审员', persona: '', level: 1, experience: 0, agentKind: 'kimi', skinId: null, externalSessionId: null },
  { id: 'ch-3', name: '另一实现者', persona: '', level: 1, experience: 0, agentKind: 'claude-code', skinId: null, externalSessionId: null },
];

describe('truncatePrevOutput（{{prev_output}} 截断：保头截尾 + 注明）', () => {
  it('不超限原样返回（不添注明行）', () => {
    const text = 'a'.repeat(PREV_OUTPUT_MAX);
    expect(truncatePrevOutput(text)).toBe(text);
    expect(truncatePrevOutput('')).toBe('');
    expect(truncatePrevOutput('short')).toBe('short');
  });

  it('超限截尾保头并附注明（保留前 PREV_OUTPUT_MAX 字 + NOTE）', () => {
    const text = 'x'.repeat(PREV_OUTPUT_MAX + 999);
    const truncated = truncatePrevOutput(text);
    expect(truncated.startsWith('x'.repeat(PREV_OUTPUT_MAX))).toBe(true);
    expect(truncated.endsWith(PREV_OUTPUT_TRUNCATION_NOTE)).toBe(true);
    expect(truncated.length).toBe(PREV_OUTPUT_MAX + PREV_OUTPUT_TRUNCATION_NOTE.length);
  });
});

describe('renderPipelineStepPrompt（模板变量渲染）', () => {
  it('{{task}} 与 {{prev_output}} 双变量替换', () => {
    const prompt = renderPipelineStepPrompt('议题：{{task}}\n上一站产出：\n{{prev_output}}', {
      task: '修复登录页',
      prevOutput: '已定位到 csrf 校验缺失',
    });
    expect(prompt).toBe('议题：修复登录页\n上一站产出：\n已定位到 csrf 校验缺失');
  });

  it('同一变量出现多次全部替换', () => {
    const prompt = renderPipelineStepPrompt('{{task}} + {{task}}', { task: 'T' });
    expect(prompt).toBe('T + T');
  });

  it('prevOutput 缺省渲染空串（首站模板引了也不留字面占位符）', () => {
    expect(renderPipelineStepPrompt('上站：{{prev_output}}。', { task: 'T' })).toBe('上站：。');
  });

  it('prevOutput 超限走截断（渲染产物里可见注明行）', () => {
    const prompt = renderPipelineStepPrompt('接续：\n{{prev_output}}', {
      task: 'T',
      prevOutput: 'y'.repeat(PREV_OUTPUT_MAX + 1),
    });
    expect(prompt.startsWith(`接续：\n${'y'.repeat(PREV_OUTPUT_MAX)}`)).toBe(true);
    expect(prompt.endsWith(PREV_OUTPUT_TRUNCATION_NOTE)).toBe(true);
  });

  it('未认识的 {{...}} 占位符原样保留（模板是自由文本）', () => {
    expect(renderPipelineStepPrompt('{{custom}} {{task}}', { task: 'T' })).toBe('{{custom}} T');
  });
});

describe('resolvePipelineStepCharacter（承接人解析）', () => {
  it('显式 characterId 优先：在档返回该角色（同 kind 多人也认点名）', () => {
    expect(resolvePipelineStepCharacter({ characterId: 'ch-3', promptTemplate: 'x' }, characters)?.id).toBe('ch-3');
  });

  it('显式 characterId 不在档返回 null（编排器记 skipped）', () => {
    expect(resolvePipelineStepCharacter({ characterId: 'ghost', promptTemplate: 'x' }, characters)).toBeNull();
  });

  it('按 kind 取档案里第一个绑定该 kind 的角色（确定性：档案顺序）', () => {
    expect(resolvePipelineStepCharacter({ kind: 'kimi', promptTemplate: 'x' }, characters)?.id).toBe('ch-2');
    expect(resolvePipelineStepCharacter({ kind: 'claude-code', promptTemplate: 'x' }, characters)?.id).toBe('ch-1');
  });

  it('kind 无在档角色返回 null', () => {
    expect(resolvePipelineStepCharacter({ kind: 'openclaw', promptTemplate: 'x' }, characters)).toBeNull();
  });

  it('kind 与 characterId 都缺（规格缺口）返回 null', () => {
    expect(resolvePipelineStepCharacter({ promptTemplate: 'x' }, characters)).toBeNull();
  });
});

describe('validatePipelineSpec（规格校验）', () => {
  it('合法规格通过（kind 型 / characterId 型 / 混合）', () => {
    expect(validatePipelineSpec({ name: '实现+审阅', steps: [{ kind: 'claude-code', promptTemplate: '做 {{task}}' }] })).toEqual({ ok: true });
    expect(
      validatePipelineSpec({
        name: '点名',
        steps: [
          { characterId: 'ch-1', promptTemplate: 'a' },
          { kind: 'kimi', promptTemplate: 'b {{prev_output}}' },
        ],
      })
    ).toEqual({ ok: true });
  });

  it('名字空 / 过长被拒', () => {
    expect(validatePipelineSpec({ name: '  ', steps: [{ kind: 'kimi', promptTemplate: 'a' }] }).ok).toBe(false);
    expect(
      validatePipelineSpec({ name: 'n'.repeat(MAX_PIPELINE_NAME_LEN + 1), steps: [{ kind: 'kimi', promptTemplate: 'a' }] }).ok
    ).toBe(false);
  });

  it('零站 / 超站被拒（1..MAX_PIPELINE_STEPS）', () => {
    expect(validatePipelineSpec({ name: 'x', steps: [] }).ok).toBe(false);
    const tooMany = Array.from({ length: MAX_PIPELINE_STEPS + 1 }, () => ({ kind: 'kimi' as const, promptTemplate: 'a' }));
    expect(validatePipelineSpec({ name: 'x', steps: tooMany }).ok).toBe(false);
  });

  it('站缺承接人（kind/characterId 都没有）或模板空 / 过长被拒', () => {
    expect(validatePipelineSpec({ name: 'x', steps: [{ promptTemplate: 'a' }] }).ok).toBe(false);
    expect(validatePipelineSpec({ name: 'x', steps: [{ kind: 'kimi', promptTemplate: '   ' }] }).ok).toBe(false);
    expect(
      validatePipelineSpec({ name: 'x', steps: [{ kind: 'kimi', promptTemplate: 'a'.repeat(MAX_PIPELINE_TEMPLATE_LEN + 1) }] }).ok
    ).toBe(false);
  });
});

describe('validatePipelineIssue（议题校验）', () => {
  it('合法议题通过（trim 边界：首尾空白不算空）', () => {
    expect(validatePipelineIssue(' 修个登录页 ')).toEqual({ ok: true });
  });
  it('空 / 超长被拒', () => {
    expect(validatePipelineIssue('   ').ok).toBe(false);
    expect(validatePipelineIssue('i'.repeat(MAX_PIPELINE_ISSUE_LEN + 1)).ok).toBe(false);
  });
});
