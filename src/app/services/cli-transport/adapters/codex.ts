/**
 * 文件职责：**Codex CLI** 的 adapter —— 把 `codex exec --json` 的 JSONL 事件流翻译成公共 TransportEvent。
 *   契约依据：docs/AGENT-MATRIX.md T1 行（`codex exec "<prompt>"` / `codex exec resume <id>` / `--json`）。
 * 输入：一行 JSONL 文本（runtime 切好行）。
 * 输出：TransportEvent[]。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 纯函数，进程生命周期归 runtime.ts；
 *   2. 只认一种事件格式 —— codex 有**两代**格式（新 `type/item.*`、旧 `msg.*`），
 *      只认一代会在版本切换时整轮静默无输出（这是最容易被忽略的坑）。
 *
 * 新格式（rollout v2）：
 *   {"type":"thread.started","thread_id":"th_..."}
 *   {"type":"item.started","item":{"id":"i0","type":"command_execution","command":"ls"}}
 *   {"type":"item.completed","item":{"id":"i0","type":"command_execution","aggregated_output":"a\n","exit_code":0}}
 *   {"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"pong"}}
 *   {"type":"turn.completed","usage":{...}}
 * 旧格式（`msg.*` 信封）：
 *   {"id":"0","msg":{"type":"agent_message","message":"pong"}}
 *   {"id":"1","msg":{"type":"exec_command_begin","command":["bash","-lc","ls"],"call_id":"c1"}}
 *   {"id":"2","msg":{"type":"exec_command_end","call_id":"c1","stdout":"a\n","exit_code":0}}
 *   {"id":"3","msg":{"type":"session_configured","session_id":"..."}}
 *
 * @since v3.8（task_023）
 */

import {
  asRecord,
  asString,
  tryParseJson,
  type CliAdapter,
  type SpawnOptions,
  type TransportEvent,
} from '../transport';

/** 会话 id：codex 的语义是 thread id / session id，原样透传。 */
export function parseCodexLine(line: string): readonly TransportEvent[] {
  const event = tryParseJson(line);
  if (!event) return [];

  // —— 旧格式：msg 信封 ——
  const legacy = asRecord(event.msg);
  if (legacy) return parseLegacy(legacy);

  // —— 新格式：type 顶层 ——
  const type = asString(event.type);
  switch (type) {
    case 'thread.started': {
      const threadId = asString(event.thread_id);
      return threadId ? [{ type: 'session', sessionId: threadId }] : [];
    }
    case 'item.started':
      return parseItem(event, 'started');
    case 'item.completed':
      return parseItem(event, 'completed');
    case 'error': {
      const message = asString(event.message) ?? 'codex 报错';
      return [{ type: 'error', message, code: 'cli_error' }];
    }
    default:
      return [];
  }
}

/** 新格式的 item：区分「开始用工具」与「工具回来了 / agent 说话了」。 */
function parseItem(
  event: Record<string, unknown>,
  phase: 'started' | 'completed'
): readonly TransportEvent[] {
  const item = asRecord(event.item);
  if (!item) return [];
  const itemType = asString(item.type);
  const id = asString(item.id) ?? undefined;

  if (itemType === 'agent_message') {
    const text = asString(item.text);
    return text ? [{ type: 'message', text }] : [];
  }
  if (itemType === 'reasoning') return []; // 思考过程不上送（UI 不展示，也免得刷屏）。
  if (itemType === 'command_execution' || itemType === 'mcp_tool_call' || itemType === 'web_search') {
    if (phase === 'started') {
      return [
        {
          type: 'tool_use',
          tool: itemType,
          input: item.command ?? item.args ?? item.query,
          id,
        },
      ];
    }
    const output =
      asString(item.aggregated_output) ?? asString(item.output) ?? asString(item.text) ?? undefined;
    return [{ type: 'tool_result', tool: itemType, text: output, id }];
  }
  if (itemType === 'file_change') {
    return phase === 'started' ? [{ type: 'tool_use', tool: itemType, id }] : [];
  }
  return [];
}

/** 旧格式：msg.type 分派。 */
function parseLegacy(msg: Record<string, unknown>): readonly TransportEvent[] {
  const type = asString(msg.type);
  switch (type) {
    case 'agent_message': {
      const text = asString(msg.message) ?? asString(msg.text);
      return text ? [{ type: 'message', text }] : [];
    }
    case 'agent_reasoning':
      return [];
    case 'exec_command_begin':
    case 'exec_command_begin_patch':
      return [
        {
          type: 'tool_use',
          tool: 'exec_command',
          input: msg.command,
          id: asString(msg.call_id) ?? undefined,
        },
      ];
    case 'exec_command_end':
    case 'exec_command_end_patch':
      return [
        {
          type: 'tool_result',
          tool: 'exec_command',
          text: asString(msg.stdout) ?? asString(msg.stderr) ?? undefined,
          id: asString(msg.call_id) ?? undefined,
        },
      ];
    case 'session_configured': {
      const sessionId = asString(msg.session_id);
      return sessionId ? [{ type: 'session', sessionId }] : [];
    }
    case 'error': {
      const message = asString(msg.message) ?? 'codex 报错';
      return [{ type: 'error', message, code: 'cli_error' }];
    }
    default:
      return [];
  }
}

export interface CodexAdapterOptions {
  /** 追加的环境变量。 */
  readonly env?: Readonly<Record<string, string>>;
  /** codex 的子命令；缺省 'exec'（exec 本身就是 headless 模式）。 */
  readonly subcommand?: string;
}

/** 造 Codex adapter。 */
export function createCodexAdapter(options: CodexAdapterOptions = {}): CliAdapter {
  const subcommand = options.subcommand ?? 'exec';
  return {
    kind: 'codex',
    binary: 'codex',
    outputMode: 'jsonl',
    buildArgs(prompt: string, spawnOptions: SpawnOptions = {}): readonly string[] {
      const args: string[] = [subcommand, '--json'];
      // 会话 id 原样透传：codex 的恢复语义是 `codex exec resume <id>`。
      const sessionId = spawnOptions.sessionId;
      if (sessionId) args.push('resume', sessionId);
      args.push(prompt);
      return args;
    },
    parseLine: parseCodexLine,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      if (!options.env) return spawnOptions;
      return { ...spawnOptions, env: { ...options.env, ...(spawnOptions.env ?? {}) } };
    },
  };
}
