/**
 * 文件职责：多 agent 流水线的**纯模型**（task_051）—— 模板渲染 / 前序输出截断 / 承接人
 *   解析 / 规格校验四个纯函数，零 IO、零 store、零事件（不 import bus / manager）。
 * 输入：types.ts 的契约形状与冻结常量（PipelineSpec / PREV_OUTPUT_MAX 等 —— 契约文件零
 *   import 铁律，形状在那里、逻辑在这里，本文件 re-export 方便上层只认 core/task 出口）。
 * 输出：可测试的纯函数 + PipelineRunnerPort（runtime 注入 app 编排器的端口形状）。
 * 禁止事项：
 *   1. IO / 总线 / store —— core 零 IO 铁律；编排执行（跑站 / 事件监听 / 落库）在
 *      app 层 pipeline-service，本文件只有可推导的纯逻辑；
 *   2. 把流水线塞进 WorldState —— ★架构注明：pipeline 是**编排模式**，不是新实体。
 *      core 的任务状态面已有六态相位真相（WorldState.tasks），流水线的执行期编排态
 *      （站序游标 / 各站实时相位 / 前序全文）是 app 层 service 的运行期私产（内存 +
 *      SQLite pipelines 表），进 WorldState 就是第二份真相 + core 膨胀，没有任何收益；
 *   3. 硬编码承接人 —— kind 只声明「要哪种角色」，解析读调用方传入的档案快照
 *      （resolvePipelineStepCharacter 是纯函数，测试注入角色列表即可穷举边角）。
 *
 * 模板变量契约（两枚，见 PipelineSpec 注释）：
 *   {{task}}        —— 原始议题原文（不截断，长度已在 MAX_PIPELINE_ISSUE_LEN 内）；
 *   {{prev_output}} —— 上一 completed 站的输出全文；超 PREV_OUTPUT_MAX 截尾保头并附注明。
 *   未认识的 {{...}} 占位符原样保留（模板是自由文本，花括号不是语法错误）。
 *
 * @since v3.27（task_051）。
 */

import type { CharacterView, PipelineSpec, PipelineStepSpec } from '../types';
import {
  MAX_PIPELINE_ISSUE_LEN,
  MAX_PIPELINE_NAME_LEN,
  MAX_PIPELINE_STEPS,
  MAX_PIPELINE_TEMPLATE_LEN,
  PREV_OUTPUT_MAX,
} from '../types';

// 契约形状与冻结常量再导出：上层只认 core/task 出口（index.ts 的铁律），不跨层摸 types。
export type { PipelineSpec, PipelineStepSpec } from '../types';
export {
  MAX_PIPELINE_ISSUE_LEN,
  MAX_PIPELINE_NAME_LEN,
  MAX_PIPELINE_STEPS,
  MAX_PIPELINE_TEMPLATE_LEN,
  PREV_OUTPUT_MAX,
} from '../types';

/** 截断注明行（保头截尾后追加在尾部，读 prompt 的 agent 与用户都知道少了东西）。 */
export const PREV_OUTPUT_TRUNCATION_NOTE = `\n…[前序输出超长，已截断，仅保留前 ${PREV_OUTPUT_MAX} 字]`;

/**
 * 截断 {{prev_output}} 的渲染源文本（纯函数）：保头截尾 + 注明行。
 * 恰好等于 PREV_OUTPUT_MAX 不截（「超限」才截，边界值完整保留）；空串原样。
 */
export function truncatePrevOutput(text: string): string {
  if (text.length <= PREV_OUTPUT_MAX) return text;
  return `${text.slice(0, PREV_OUTPUT_MAX)}${PREV_OUTPUT_TRUNCATION_NOTE}`;
}

/**
 * 渲染一站的 prompt（纯函数）：模板里的 {{task}} / {{prev_output}} 逐个替换。
 * 替换用 split/join（非正则）：占位符是字面量，正则的花括号转义只有坏处没有好处。
 * prevOutput 缺省 = 空串（首站模板不该引 {{prev_output}}；真引了渲染成空，prompt
 * 不至于出现字面占位符）。
 */
export function renderPipelineStepPrompt(
  promptTemplate: string,
  input: { readonly task: string; readonly prevOutput?: string }
): string {
  const prev = truncatePrevOutput(input.prevOutput ?? '');
  return promptTemplate.split('{{task}}').join(input.task).split('{{prev_output}}').join(prev);
}

/**
 * 解析一站的承接人（纯函数）：
 *   显式 characterId 优先（在档才返回，不在档返回 null —— 编排器记 skipped）；
 *   否则按 kind 取档案里**第一个**绑定该 kind 的角色（档案顺序即确定性，不在此处做
 *   忙闲/成功率推荐 —— 那是 hud 派发表单（050）的事，流水线站位的语义是「这种角色干这站」）。
 *   kind 与 characterId 都没给（规格缺口，validatePipelineSpec 已拒）返回 null。
 */
export function resolvePipelineStepCharacter(
  step: PipelineStepSpec,
  characters: readonly CharacterView[]
): CharacterView | null {
  if (step.characterId) {
    return characters.find((character) => character.id === step.characterId) ?? null;
  }
  if (step.kind) {
    return characters.find((character) => character.agentKind === step.kind) ?? null;
  }
  return null;
}

/**
 * 规格校验（纯函数，编排器与 hud 表单共用同一份裁决）：
 *   名字 trim 非空 ≤ MAX_PIPELINE_NAME_LEN；站数 1..MAX_PIPELINE_STEPS；每站
 *   kind / characterId 至少一个、模板 trim 非空 ≤ MAX_PIPELINE_TEMPLATE_LEN。
 *   返回 {ok:true} 或 {ok:false, reason}（reason 是面向日志与失败落库的短语，
 *   不承诺文案稳定 —— UI 侧的友好提示各自拼写）。
 */
export function validatePipelineSpec(
  spec: PipelineSpec
): { ok: true } | { ok: false; reason: string } {
  const name = spec?.name?.trim() ?? '';
  if (name.length === 0) return { ok: false, reason: '流水线名为空' };
  if (name.length > MAX_PIPELINE_NAME_LEN) {
    return { ok: false, reason: `流水线名过长（上限 ${MAX_PIPELINE_NAME_LEN} 字）` };
  }
  if (!Array.isArray(spec?.steps) || spec.steps.length === 0) {
    return { ok: false, reason: '流水线至少要有一站' };
  }
  if (spec.steps.length > MAX_PIPELINE_STEPS) {
    return { ok: false, reason: `流水线站数超限（上限 ${MAX_PIPELINE_STEPS} 站）` };
  }
  for (let index = 0; index < spec.steps.length; index += 1) {
    const step = spec.steps[index];
    if (!step?.kind && !step?.characterId?.trim()) {
      return { ok: false, reason: `第 ${index + 1} 站未指定承接人（kind / characterId 至少一个）` };
    }
    const template = step?.promptTemplate?.trim() ?? '';
    if (template.length === 0) return { ok: false, reason: `第 ${index + 1} 站指令模板为空` };
    if (template.length > MAX_PIPELINE_TEMPLATE_LEN) {
      return { ok: false, reason: `第 ${index + 1} 站指令模板过长（上限 ${MAX_PIPELINE_TEMPLATE_LEN} 字）` };
    }
  }
  return { ok: true };
}

/**
 * 原始议题校验（纯函数）：trim 非空 ≤ MAX_PIPELINE_ISSUE_LEN（{{task}} 的源文本）。
 */
export function validatePipelineIssue(issue: string): { ok: true } | { ok: false; reason: string } {
  const text = issue?.trim() ?? '';
  if (text.length === 0) return { ok: false, reason: '议题不能为空' };
  if (text.length > MAX_PIPELINE_ISSUE_LEN) {
    return { ok: false, reason: `议题过长（上限 ${MAX_PIPELINE_ISSUE_LEN} 字）` };
  }
  return { ok: true };
}

/**
 * runtime → app 编排器的端口形状（task_051）：core 不执行编排（零 IO），只把
 * HudCommand pipeline.start 转交给注入的实现（app 层 pipeline-service）。与 agentLink
 * 同一口径 —— runtime 认得这个口子，才不会把命令当未落地报 onUnhandled。
 * 返回值：流水线 id（发起失败也返回 id —— 坏规格落 failed 流水线，看得见）；
 * null = 端口实现自己都不认（理论不可达，防御性返回）。
 */
export interface PipelineRunnerPort {
  runPipeline(spec: PipelineSpec, issue: string): string | null;
}
