/**
 * 文件职责：**Claude Code** 的 CLI adapter —— 把 `claude -p` 的 stream-json 事件流
 *   翻译成公共 TransportEvent。
 *   契约依据：docs/AGENT-MATRIX.md T1 行（`claude -p "<prompt>" --permission-mode bypassPermissions`
 *   / `--resume <session-id>` / `--output-format stream-json`）。
 * 输入：一行 stream-json 文本（runtime 切好行）。
 * 输出：TransportEvent[]（可能是空数组 —— 这一行没有值得上送的内容）。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 本文件是**纯函数**（拼参数 + 解析一行），进程生命周期归 runtime.ts；
 *   2. 把 claude 私有字段名漏进公共事件类型 —— 只上送 message / tool_use / tool_result / session / error；
 *   3. 在 adapter 里记状态 —— 解析是纯函数，状态在 runtime。
 *
 * stream-json 事件形状（claude --print --output-format stream-json）：
 *   {"type":"system","subtype":"init","session_id":"<uuid>",...}
 *   {"type":"assistant","message":{"content":[{"type":"text","text":"..."},{"type":"tool_use","id":"t1","name":"Bash","input":{...}}]}}
 *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"..."}]}}
 *   {"type":"result","subtype":"success","is_error":false,"result":"...","session_id":"<uuid>"}
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

/** 权限模式。默认 bypassPermissions（headless 无 TTY，交互式确认必然失败）。 */
export type ClaudePermissionMode = 'bypassPermissions' | 'acceptEdits' | 'default';

export interface ClaudeAdapterOptions {
  /** 权限模式；缺省 bypassPermissions（见上）。 */
  readonly permissionMode?: ClaudePermissionMode;
  /**
   * 追加的环境变量。
   * 默认带 `CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1`
   * （AGENT-MATRIX T1 备注：规避代理模型下的窗口长度告警）。
   */
  readonly env?: Readonly<Record<string, string>>;
}

/** 解析一行 stream-json。 */
export function parseClaudeLine(line: string): readonly TransportEvent[] {
  const event = tryParseJson(line);
  if (!event) return []; // 非 JSON 行（banner / 警告）—— 跳过，不当错误。

  const type = asString(event.type);
  switch (type) {
    case 'system':
      return parseSystem(event);
    case 'assistant':
      return parseAssistant(event);
    case 'user':
      return parseUser(event);
    case 'result':
      return parseResult(event);
    default:
      return []; // 不认识的事件类型 —— 跳过（协议演进留口：不能因为不认识的类型就崩）。
  }
}

/** system/init：带 session_id —— 原样透传给 AgentProfile.externalSessionId。 */
function parseSystem(event: Record<string, unknown>): readonly TransportEvent[] {
  const sessionId = asString(event.session_id);
  return sessionId ? [{ type: 'session', sessionId }] : [];
}

/** assistant：content 里的 text → message；tool_use → tool_use。 */
function parseAssistant(event: Record<string, unknown>): readonly TransportEvent[] {
  const message = asRecord(event.message);
  const blocks = asArray(message?.content);
  const events: TransportEvent[] = [];
  for (const raw of blocks) {
    const block = asRecord(raw);
    if (!block) continue;
    const blockType = asString(block.type);
    if (blockType === 'text') {
      const text = asString(block.text);
      if (text) events.push({ type: 'message', text });
    } else if (blockType === 'tool_use') {
      const tool = asString(block.name);
      if (!tool) continue;
      events.push({
        type: 'tool_use',
        tool,
        input: block.input,
        id: asString(block.id) ?? undefined,
      });
    }
  }
  return events;
}

/** user：content 里的 tool_result → tool_result（工具回执，不是 agent 说的话）。 */
function parseUser(event: Record<string, unknown>): readonly TransportEvent[] {
  const message = asRecord(event.message);
  const blocks = asArray(message?.content);
  const events: TransportEvent[] = [];
  for (const raw of blocks) {
    const block = asRecord(raw);
    if (!block || asString(block.type) !== 'tool_result') continue;
    events.push({
      type: 'tool_result',
      id: asString(block.tool_use_id) ?? undefined,
      text: stringifyContent(block.content),
    });
  }
  return events;
}

/**
 * result：本轮的收尾事件。
 * why 不把 result 的文本再上送成 message：assistant 事件里已经有同一段文本，
 *   重复上送会让聊天记录里同一句话出现两次。收尾信息由 runtime 的 done 事件带（text = 最后一条 message）。
 * 但 is_error 为真时必须报错 —— 那一轮其实是失败的。
 */
function parseResult(event: Record<string, unknown>): readonly TransportEvent[] {
  if (event.is_error === true) {
    const message = asString(event.result) ?? asString(event.subtype) ?? 'claude 执行失败';
    return [{ type: 'error', message, code: 'cli_error' }];
  }
  return [];
}

/** tool_result 的 content 可能是字符串，也可能是内容块数组。 */
function stringifyContent(content: unknown): string | undefined {
  const direct = asString(content);
  if (direct) return direct;
  const blocks = asArray(content);
  const texts: string[] = [];
  for (const raw of blocks) {
    const block = asRecord(raw);
    if (!block) continue;
    const text = asString(block.text);
    if (text) texts.push(text);
  }
  return texts.length > 0 ? texts.join('\n') : undefined;
}

/**
 * 造 Claude adapter。
 * @param options 权限模式 / 追加环境变量
 */
export function createClaudeAdapter(options: ClaudeAdapterOptions = {}): CliAdapter {
  const permissionMode = options.permissionMode ?? 'bypassPermissions';
  const extraEnv: Record<string, string> = {
    CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT: '1',
    ...(options.env ?? {}),
  };

  return {
    kind: 'claude-code',
    binary: 'claude',
    outputMode: 'jsonl',
    buildArgs(prompt: string, spawnOptions: SpawnOptions = {}): readonly string[] {
      const args: string[] = [
        '-p',
        prompt,
        '--output-format',
        'stream-json',
        // stream-json 在 print 模式下需要 --verbose 才会吐事件流。
        '--verbose',
        '--permission-mode',
        permissionMode,
      ];
      // 会话 id **原样透传**：claude 的语义是 uuid，传什么就是什么。
      const sessionId = spawnOptions.sessionId;
      if (sessionId) args.push('--resume', sessionId);
      return args;
    },
    parseLine: parseClaudeLine,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      return { ...spawnOptions, env: { ...extraEnv, ...(spawnOptions.env ?? {}) } };
    },
  };
}
