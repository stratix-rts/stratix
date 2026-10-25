/**
 * 文件职责：**Kimi CLI** 的 adapter —— `kimi --yolo --prompt "<prompt>"` 的输出翻译。
 *   契约依据：docs/AGENT-MATRIX.md T1 行（headless: `kimi --yolo --prompt` / 会话恢复 `--session <id>`）。
 * 输入：kimi 的 stdout（**纯文本**，runtime 会整段收下）；stderr 的收尾提示行（会话 id，见下）。
 * 输出：TransportEvent[]。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 纯函数，进程生命周期归 runtime.ts；
 *   2. 把纯文本硬说成「结构化输出」—— stdout 只吐文本，这里是 text 模式。
 *
 * ============ 会话 id 从哪里拿（task_055 真机调研，2026-10-25，kimi 1.48.0）============
 * 调研结论（`kimi --help` + CLI 源码 `cli/__init__.py` + 真机实跑）：
 *   - `--print --output-format stream-json` 旗标存在，但 stream-json 只把**内容/工具调用**
 *     结构化（ui/print/visualize.py 的 JsonPrinter），**会话 id 不进 stdout 事件**；
 *   - 会话 id 的唯一出口是 stderr 收尾提示行：`To resume this session: kimi -r <uuid>`
 *     （`_print_resume_hint`，每轮结束都打 —— 成功/失败都打，session 非空即打；真机 401
 *     失败轮也验证到该行）；
 *   - 实测 `--session <id>` resume 命中同一 session：透传上次 id → 尾行回显同一 uuid
 *     （miss 会新建并回显新 id），续接链路成立；凭证过期（401）下无法完成成功对话的
 *     两轮实测，属环境限制，链路证据已闭环（旗标/源码/回显）。
 * 故：保持 text 模式（stdout 整段作为一条 message，不逐行拆）；会话 id 走
 *   parseStderrLine 钩子从 stderr 收割（runtime 在收尾事件前统一上送，见 transport.ts）。
 *
 * @since v3.8（task_023）；v3.31（task_055）stderr 收割会话 id。
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

/** kimi stderr 收尾提示行的会话 id（task_055 真机实测形状，见文件头「会话 id 从哪里拿」）。 */
const KIMI_RESUME_HINT_RE =
  /To resume this session:\s*kimi\s+\S+\s+([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/;

/**
 * 解析 kimi 的 stderr 行：只认收尾提示行里的会话 id，其余（日志噪声）静默跳过。
 * 契约：只产出 session 事件（stderr 不是对话内容，runtime 也只收 session —— 双保险）。
 */
export function parseKimiStderrLine(line: string): readonly TransportEvent[] {
  const match = KIMI_RESUME_HINT_RE.exec(line);
  return match ? [{ type: 'session', sessionId: match[1] }] : [];
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
    parseStderrLine: parseKimiStderrLine,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      if (!options.env) return spawnOptions;
      return { ...spawnOptions, env: { ...options.env, ...(spawnOptions.env ?? {}) } };
    },
  };
}
