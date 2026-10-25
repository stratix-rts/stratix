/**
 * 文件职责：**OpenClaw** 的 adapter —— `openclaw agent --message "<prompt>" --json` 的输出翻译。
 *   契约依据：docs/AGENT-MATRIX.md T1 行（headless 走「sessions API（本机 gateway）」，
 *   本实现落在 CLI 侧：openclaw 的 CLI 会打到同一个 gateway，会话体系原生）。
 * 输入：openclaw 的 stdout（**一个 pretty-print 的 JSON 文档**，runtime 整段收下）。
 * 输出：TransportEvent[]。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 纯函数，进程生命周期归 runtime.ts；
 *   2. 把输出当 JSONL 逐行解 —— openclaw 的 `--json` 是 **pretty-print**（缩进换行），
 *      逐行解会每行都解析失败（这是 openclaw 独有的坑，故它是 json 模式而不是 jsonl）。
 *
 * 输出信封（两代形状都认）：
 *   ① gateway 实测形状（2026-10-25，openclaw 2026.4.2 真机两轮验证）：
 *      {"runId":"...","status":"ok","summary":"completed",
 *       "result":{"payloads":[{"text":"..."}],"meta":{"durationMs":...,
 *       "agentMeta":{"sessionId":"...","provider":"...","model":"..."},"aborted":false}}}
 *      —— 文本在 result.payloads[].text，会话 id 在 result.meta.agentMeta.sessionId。
 *      （task_035 时只认顶层扁平信封，两处都解析不到 —— 实证 bug，task_055 修。）
 *   ② 扁平简形（历史兼容）：{"payloads":[{"text":"..."}],"meta":{...},"delivery":{...}}
 *      与 {"result":"...","sessionId":"..."}。
 *
 * 会话策略（task_055 真机实测）：`--session-id <id>` 支持调用方自选 id ——
 *   首发生成 uuid 传入即建立同名 session，续发同 id 命中同一会话且上下文保留
 *   （实测两轮同 id + 暗号记忆命中）；并且自选 id 避免「无路由参数时落到 gateway
 *   主会话」的副作用。故 prepare 在「无 sessionId 且无 agentId」时生成 uuid。
 *
 * @since v3.8（task_023）；v3.31（task_055）result 信封解析 + uuid 会话种子。
 */

import { randomUUID } from 'crypto';

import {
  asArray,
  asRecord,
  asString,
  tryParseJson,
  type CliAdapter,
  type SpawnOptions,
  type TransportEvent,
} from '../transport';

/** 解析 openclaw 的 JSON 输出（两代信封形状，见文件头）。 */
export function parseOpenclawOutput(text: string): readonly TransportEvent[] {
  const doc = tryParseJson(text);
  if (!doc) return [];

  const events: TransportEvent[] = [];

  // —— gateway 实测形状：文本与会话 id 都包在 result 里（task_055）——
  const result = asRecord(doc.result);
  const resultMeta = asRecord(result?.meta);
  const agentMeta = asRecord(resultMeta?.agentMeta);

  // —— 会话 id：信封各处都可能出现，都认一遍（哪处有就用哪处；新旧两代全覆盖）——
  const meta = asRecord(doc.meta);
  const delivery = asRecord(doc.delivery);
  const sessionId =
    asString(agentMeta?.sessionId) ??
    asString(agentMeta?.session_id) ??
    asString(doc.sessionId) ??
    asString(doc.session_id) ??
    asString(result?.sessionId) ??
    asString(meta?.sessionId) ??
    asString(meta?.session_id) ??
    asString(meta?.sessionKey) ??
    asString(delivery?.sessionId) ??
    asString(delivery?.sessionKey);
  if (sessionId) events.push({ type: 'session', sessionId });

  // —— 回答文本 ——
  let text2: string | null = null;
  for (const raw of asArray(result?.payloads)) {
    const payload = asRecord(raw);
    if (!payload) continue;
    const value = asString(payload.text) ?? asString(payload.body) ?? asString(payload.message);
    if (value) {
      text2 = text2 ? `${text2}\n${value}` : value;
    }
  }
  if (!text2) {
    for (const raw of asArray(doc.payloads)) {
      const payload = asRecord(raw);
      if (!payload) continue;
      const value = asString(payload.text) ?? asString(payload.body) ?? asString(payload.message);
      if (value) {
        text2 = text2 ? `${text2}\n${value}` : value;
      }
    }
  }
  if (!text2) {
    text2 = asString(doc.result) ?? asString(doc.text) ?? asString(doc.reply) ?? asString(doc.output);
  }
  if (!text2) {
    for (const raw of asArray(doc.messages)) {
      const item = asRecord(raw);
      if (!item) continue;
      const value = asString(item.text) ?? asString(item.content);
      if (value) text2 = text2 ? `${text2}\n${value}` : value;
    }
  }
  if (text2) events.push({ type: 'message', text: text2 });

  // —— 失败：aborted / 错误信封（两代形状的 aborted 都认）——
  if (meta?.aborted === true || resultMeta?.aborted === true) {
    events.push({ type: 'error', message: 'openclaw 运行被中止', code: 'cli_error' });
    return events;
  }
  const error = asRecord(doc.error) ?? asRecord(result?.error);
  if (error) {
    const data = asRecord(error.data);
    const message = asString(data?.message) ?? asString(error.message) ?? 'openclaw 报错';
    events.push({ type: 'error', message, code: 'cli_error' });
  }

  return events;
}

export interface OpenclawAdapterOptions {
  /**
   * agent id。
   * why 需要它：openclaw CLI 要求「会话选择三选一」—— --to <E.164> / --session-id / --agent。
   *   首发时若没给 agentId，adapter 会自生成 uuid 传 --session-id（task_055，见文件头
   *   「会话策略」）—— agentId 是调用方的显式路由选择，给了就尊重（不种 uuid）。
   */
  readonly agentId?: string;
  /** 走本地内嵌 agent（--local）而不是 gateway；缺省 false（走 gateway，与矩阵一致）。 */
  readonly local?: boolean;
  /** 追加的环境变量。 */
  readonly env?: Readonly<Record<string, string>>;
}

/** 造 OpenClaw adapter。 */
export function createOpenclawAdapter(options: OpenclawAdapterOptions = {}): CliAdapter {
  return {
    kind: 'openclaw',
    binary: 'openclaw',
    outputMode: 'json',
    buildArgs(prompt: string, spawnOptions: SpawnOptions = {}): readonly string[] {
      const args: string[] = ['agent'];
      if (options.local) args.push('--local');
      // 会话 id 原样透传：openclaw 的语义就是「用这个 session id 接着聊」
      //（首发时 prepare 已种入 uuid，见文件头「会话策略」）。
      const sessionId = spawnOptions.sessionId;
      if (sessionId) {
        args.push('--session-id', sessionId);
      } else if (options.agentId) {
        // 调用方显式给了 agentId：尊重具体路由（不生成 uuid，会话由 agent 路由决定）。
        args.push('--agent', options.agentId);
      }
      args.push('--message', prompt, '--json');
      return args;
    },
    parseLine: parseOpenclawOutput,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      // task_055：无 sessionId 且无 agentId 时生成 uuid 作为会话 id ——
      // ①避免裸 agent 命令落到 gateway 主会话（副作用隔离）；②下一轮同 id 续接。
      // 放 prepare 而不是 buildArgs：runtime 会用 prepare 后的 options 种入内存 sessionId，
      // 即使输出信封解析失败，done.sessionId 也能兜底带回生成的 id。
      // （实测依据：gateway 路径两轮验证命中；--local 路径未实测，旗标被 CLI 接受，
      //  最坏情况是被内嵌 agent 忽略 —— 退化为每轮新会话，不劣于现状。）
      if (!spawnOptions.sessionId && !options.agentId) {
        return { ...spawnOptions, sessionId: randomUUID() };
      }
      if (!options.env) return spawnOptions;
      return { ...spawnOptions, env: { ...options.env, ...(spawnOptions.env ?? {}) } };
    },
  };
}
