/**
 * 文件职责：**自定义 agent 注册**的 CliAdapter（task_056）—— 按注册表的 runCmdTemplate
 *   渲染执行命令、按 outputParser 解析输出。契约同内置五家（CliAdapter，transport.ts）：
 *   纯函数、不碰进程（进程生命周期归 runtime.ts）。
 *
 * ============ 执行模型与安全边界（task_056 规格②，接 core/custom-agent.ts 的第一道门）============
 * 1. **argv 直拼不经 shell**：模板过白名单后按空白切 token，`{prompt}` 占位符所在位置
 *    把 **prompt 原样作为单个 argv 元素**插入（binary = 模板首 token）。spawn 走
 *    ProcessFactory 的 execFile 语义（node-process.ts，不经 sh -c）—— shell 注入在构造上
 *    不存在：prompt 里的 `;` `&` `$( )` 引号换行全部只是一个参数字符串的字面内容，
 *    永远不会被 shell 解释。**这就是"防命令注入"的最终防线**（白名单是第一道门）。
 * 2. **单引号包裹（quoteSingle）只用于预览串**：`renderCustomRunCommandPreview` 产出
 *    人可读的命令串（向导弹窗 / 日志展示），POSIX sh 语义下单引号内的内容零解释 ——
 *    预览串里 prompt 的任何字符都逃不出引号（`'` 转义成 `'\''`）。为什么不在执行路径上
 *    用它：执行路径没有 shell，单引号会变成 prompt 的字面内容污染对话。
 * 3. **渲染时重校验**：renderCustomRunArgv 对模板再跑一遍白名单（注册后库被手改 /
 *    DAO 直写的脏数据），非法模板直接抛错（runtime 会把 prepare/spawn 异常转成
 *    error 事件，用户看到的是一轮失败对话而不是注入事故 —— fail closed）。
 * 4. **无 session 语义**：buildArgs 忽略 spawnOptions.sessionId —— 每轮新会话
 *    （task_055 之前 kimi 的同一口径：没有会话恢复就没有 id 透传）。
 *
 * 输出解析两种（outputParser）：
 *   - 'plain'：整段 stdout 就是一条回答（outputMode 'text'，parseLine 恒返 [] ——
 *     runtime 的 text 兑底把整段当一条 message 上送，与 kimi adapter 同款口径）；
 *   - 'json'：整段 stdout 当一个 JSON 文档，提取 .text / .content / .output 首个非空字符串；
 *     解析不出 JSON / 字段全空 → 返 [] 降级 plain（整段当文本 —— 「容错降级」规格）。
 *     why 不用 outputMode 'json'（解析失败报错）：自定义 CLI 的输出没有契约保证，
 *     混杂文本是常态，报错会把可用的回答变成失败轮。
 *
 * @since v3.32（task_056）。
 */

import {
  isAllowedCustomAgentCmd,
  CUSTOM_AGENT_PROMPT_PLACEHOLDER,
  type CustomAgentOutputParser,
} from '../../../../core/custom-agent';
import { buildCustomAgentKind, type CustomAgentKind } from '../../../../core/types';

import {
  asRecord,
  asString,
  tryParseJson,
  type CliAdapter,
  type TransportEvent,
} from '../transport';

// ============================================================================
// 渲染（执行 argv + 预览串）
// ============================================================================

/** 渲染产物：可执行文件 + 参数表（ProcessFactory 的直接输入形状）。 */
export interface RenderedCustomRun {
  readonly binary: string;
  readonly args: readonly string[];
}

/**
 * 模板 + prompt → 执行 argv（安全核心，见文件头）。
 * 白名单外字符一律抛错（fail closed）；`{prompt}` 位置插入**原样 prompt**（单元素）。
 */
export function renderCustomRunArgv(template: string, prompt: string): RenderedCustomRun {
  const segments = template.split(CUSTOM_AGENT_PROMPT_PLACEHOLDER);
  if (segments.length !== 2) {
    throw new Error(`自定义 agent 模板非法（占位符数量不对）：${template}`);
  }
  for (const segment of segments) {
    if (!isAllowedCustomAgentCmd(segment) && segment.length > 0) {
      // 空段合法（占位符在首/尾）；非空段必须过白名单（注册后库被手改的脏数据在这拦下）。
      throw new Error(`自定义 agent 模板含白名单外字符：${template}`);
    }
  }
  // 白名单含空格不含引号/反斜杠 → 按空白切分是忠实的 token 化（没有 shell 的引号语义要还原）。
  const head = segments[0]?.split(/\s+/).filter((token) => token.length > 0) ?? [];
  const tail = segments[1]?.split(/\s+/).filter((token) => token.length > 0) ?? [];
  const binary = head[0];
  if (!binary) throw new Error(`自定义 agent 模板缺少可执行文件名：${template}`);
  return { binary, args: [...head.slice(1), prompt, ...tail] };
}

/**
 * POSIX sh 语义的单引号包裹：`it's` → `'it'\''s'`。
 * 只用于预览串（文件头第 2 条）：引号内零解释，`'` 用 `'\''` 逃出再进。
 */
export function quoteSingle(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

/** 人可读的命令预览串（向导「将执行」展示 / 日志）：argv 拼回一串，prompt 段单引号包裹。 */
export function renderCustomRunCommandPreview(template: string, prompt: string): string {
  const rendered = renderCustomRunArgv(template, prompt);
  // 预览与执行同源（同一份 renderCustomRunArgv）—— 展示的就是会跑的，不会两边漂移。
  // prompt 换成单引号包裹版：预览串可能进 shell 语义的上下文（文档 / 终端复制粘贴）。
  const quotedPrompt = quoteSingle(prompt);
  return [rendered.binary, ...rendered.args.map((arg) => (arg === prompt ? quotedPrompt : arg))].join(' ');
}

// ============================================================================
// 输出解析
// ============================================================================

/** json 解析器的提取字段（首个非空命中）：与 kimi 的宽容口径同族，覆盖最常见的三种命名。 */
const JSON_TEXT_FIELDS = ['text', 'content', 'output'] as const;

/**
 * 解析 json 模式的整段输出：JSON 文档 → .text / .content / .output 首个非空字符串；
 * 不是 JSON / 字段全空 → 返 []（runtime 的 text 兑底会把整段当一条 message —— 容错降级 plain）。
 */
export function parseCustomJsonOutput(text: string): readonly TransportEvent[] {
  const doc = tryParseJson(text);
  if (!doc) return [];
  const record = asRecord(doc);
  if (!record) return [];
  for (const field of JSON_TEXT_FIELDS) {
    const value = asString(record[field]);
    if (value && value.trim().length > 0) return [{ type: 'message', text: value }];
  }
  return [];
}

// ============================================================================
// adapter 工厂
// ============================================================================

/** 自定义 agent 的注册行（adapter 视角的最小形状；持久化全量形状见 custom-agent-dao）。 */
export interface CustomAgentAdapterSpec {
  /** 注册 id（拼 kind 用）。 */
  readonly id: string;
  /** 执行模板（已过白名单；渲染时再校验一次）。 */
  readonly runCmdTemplate: string;
  /** 输出解析器。 */
  readonly outputParser: CustomAgentOutputParser;
}

/**
 * 造一个自定义 agent 的 adapter。
 * 契约完全同内置五家（prepare 可选缺省 / parseStderrLine 缺省）：无 prepare（没有端口探测
 * 这类前置步骤）、无 stderr 钩子（没有会话 id 可收割 —— 无 session 语义）。
 */
export function createCustomAdapter(spec: CustomAgentAdapterSpec): CliAdapter {
  const kind: CustomAgentKind = buildCustomAgentKind(spec.id);
  // 模板首 token（binary）在工厂期解析一次：注册行坏（渲染抛错）在工厂期就炸，
  // 别等第一轮对话才失败（用户注册完立刻能看到错误，而不是攒到聊天时）。
  const probeRender = renderCustomRunArgv(spec.runCmdTemplate, '');
  const parseLine =
    spec.outputParser === 'json' ? parseCustomJsonOutput : (): readonly TransportEvent[] => [];
  return {
    kind,
    binary: probeRender.binary,
    outputMode: 'text', // 两种解析器都走「整段收下」路径（见文件头输出解析说明）
    buildArgs(prompt: string): readonly string[] {
      // 渲染时重跑（而不是复用工厂期 argv）：prompt 才是本轮的真输入；sessionId 忽略（无 session 语义）。
      return renderCustomRunArgv(spec.runCmdTemplate, prompt).args;
    },
    parseLine,
  };
}
