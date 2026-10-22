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
 * 输出信封（本机 openclaw 2026.4.2 源码 buildOutboundResultEnvelope）：
 *   {"payloads":[{"text":"..."}],"meta":{"durationMs":...,"aborted":false,"stopReason":"..."},"delivery":{...}}
 * 另兼容简形：{"result":"...","sessionId":"..."}。
 *
 * @since v3.8（task_023）
 */

import {
  asArray,
  asRecord,
  asString,
  tryParseJson,
  type CliAdapter,
  type SpawnOptions,
  type TransportEvent,
} from '../transport';

/** 解析 openclaw 的 JSON 输出。 */
export function parseOpenclawOutput(text: string): readonly TransportEvent[] {
  const doc = tryParseJson(text);
  if (!doc) return [];

  const events: TransportEvent[] = [];

  // —— 会话 id：信封各处都可能出现，都认一遍（哪处有就用哪处）——
  const meta = asRecord(doc.meta);
  const delivery = asRecord(doc.delivery);
  const sessionId =
    asString(doc.sessionId) ??
    asString(doc.session_id) ??
    asString(meta?.sessionId) ??
    asString(meta?.session_id) ??
    asString(meta?.sessionKey) ??
    asString(delivery?.sessionId) ??
    asString(delivery?.sessionKey);
  if (sessionId) events.push({ type: 'session', sessionId });

  // —— 回答文本 ——
  let text2: string | null = null;
  for (const raw of asArray(doc.payloads)) {
    const payload = asRecord(raw);
    if (!payload) continue;
    const value = asString(payload.text) ?? asString(payload.body) ?? asString(payload.message);
    if (value) {
      text2 = text2 ? `${text2}\n${value}` : value;
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

  // —— 失败：aborted / 错误信封 ——
  if (meta?.aborted === true) {
    events.push({ type: 'error', message: 'openclaw 运行被中止', code: 'cli_error' });
    return events;
  }
  const error = asRecord(doc.error);
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
   *   我们既没有手机号、也没有会话 id 时，只能靠 --agent 指定一个 agent。
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
      // 会话 id 原样透传：openclaw 的语义就是「用这个 session id 接着聊」。
      const sessionId = spawnOptions.sessionId;
      if (sessionId) {
        args.push('--session-id', sessionId);
      } else if (options.agentId) {
        // 没有会话 id 时用 agent id 选会话（CLI 硬性要求三选一）。
        args.push('--agent', options.agentId);
      }
      args.push('--message', prompt, '--json');
      return args;
    },
    parseLine: parseOpenclawOutput,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      if (!options.env) return spawnOptions;
      return { ...spawnOptions, env: { ...options.env, ...(spawnOptions.env ?? {}) } };
    },
  };
}
