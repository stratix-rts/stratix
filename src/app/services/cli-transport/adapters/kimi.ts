/**
 * 文件职责：**Kimi CLI** 的 adapter —— `kimi --yolo --prompt "<prompt>"` 的输出翻译。
 *   契约依据：docs/AGENT-MATRIX.md T1 行（headless: `kimi --yolo --prompt` / 会话恢复 `--session <id>`）。
 * 输入：kimi 的 stdout（**纯文本**，runtime 会整段收下）。
 * 输出：TransportEvent[]。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 纯函数，进程生命周期归 runtime.ts；
 *   2. 把纯文本硬说成「结构化输出」—— kimi 的非交互模式只吐文本（AGENT-MATRIX 原话：
 *      「文本输出（结构化弱）」），所以这里是 text 模式。
 *
 * why text 模式而不是 jsonl：kimi 的非交互输出是一整段回答（可能跨多行），
 *   逐行上送会把一段回答拆成几十条聊天记录 —— 整段作为**一条** message 才对。
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

/**
 * 解析 kimi 的输出。
 * why 还认 JSON：kimi 在某些配置下会吐 JSON（结构化弱但不是没有）——
 *   认得就按 JSON 解，解不出就交回 runtime 的「整段当文本」兜底。
 */
export function parseKimiOutput(text: string): readonly TransportEvent[] {
  const doc = tryParseJson(text);
  if (!doc) return [];

  const events: TransportEvent[] = [];

  // 会话 id（各版本字段名不一样，都认一遍）。
  const sessionId =
    asString(doc.session_id) ?? asString(doc.sessionId) ?? asString(doc.session) ?? null;
  if (sessionId) events.push({ type: 'session', sessionId });

  // 文本：常见的几种字段名。
  const direct =
    asString(doc.text) ??
    asString(doc.output) ??
    asString(doc.response) ??
    asString(doc.result) ??
    asString(doc.message);
  if (direct) {
    events.push({ type: 'message', text: direct });
    return events;
  }

  // 消息数组形态。
  for (const raw of asArray(doc.messages)) {
    const item = asRecord(raw);
    if (!item) continue;
    const itemText = asString(item.text) ?? asString(item.content);
    if (itemText) events.push({ type: 'message', text: itemText });
  }

  return events;
}

export interface KimiAdapterOptions {
  /** 自动放行工具调用（--yolo）；缺省 true（headless 无 TTY，交互确认必然失败）。 */
  readonly yolo?: boolean;
  /** 工作目录（-w）；缺省继承当前进程。 */
  readonly workDir?: string;
  /** 追加的环境变量。 */
  readonly env?: Readonly<Record<string, string>>;
}

/** 造 Kimi adapter。 */
export function createKimiAdapter(options: KimiAdapterOptions = {}): CliAdapter {
  const yolo = options.yolo ?? true;
  return {
    kind: 'kimi',
    binary: 'kimi',
    outputMode: 'text',
    buildArgs(prompt: string, spawnOptions: SpawnOptions = {}): readonly string[] {
      const args: string[] = [];
      if (yolo) args.push('--yolo');
      if (options.workDir) args.push('--work-dir', options.workDir);
      // 会话 id 原样透传：kimi 的语义是「resume 那个 session」。
      const sessionId = spawnOptions.sessionId;
      if (sessionId) args.push('--session', sessionId);
      args.push('--prompt', prompt);
      return args;
    },
    parseLine: parseKimiOutput,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      if (!options.env) return spawnOptions;
      return { ...spawnOptions, env: { ...options.env, ...(spawnOptions.env ?? {}) } };
    },
  };
}
