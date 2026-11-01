/**
 * 文件职责：**DeepSeek Harness（dsh）** 的 CLI adapter —— 把
 *   `npx -y @deepseek-ai/dsh --profile headless --json "<task>"` 的 NDJSON 运行事件流
 *   翻译成公共 TransportEvent。
 *   契约依据：docs/DSH-INTEGRATION-PLAN.md §1（桥 A）+ 本机实测记录
 *   （.long-run-agent/tasks/task_088.md「契约实测记录」）。
 * 输入：一行 NDJSON（runtime 切好行）。
 * 输出：TransportEvent[]（可能是空数组 —— 这一行没有值得上送的内容）。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 本文件是**纯函数**（拼参数 + 解析一行），进程生命周期归 runtime.ts；
 *   2. 把 dsh 私有字段名漏进公共事件类型 —— 只上送 message / tool_use / tool_result / session / error；
 *   3. 在 adapter 里记状态 —— 解析是纯函数，状态在 runtime。
 *
 * ============ dsh headless 契约（实测，2026-11-02）============
 *   - 启动：`npx -y @deepseek-ai/dsh --profile headless --json "<task>"`（profile 缺省会被 dsh
 *     自动从内置模板铺出来，DSH_HOME 下没有 profiles/headless 也能跑 —— 实测新建 DSH_HOME 首次跑通）；
 *   - `--json` = stdout 吐**换行分隔的运行事件**；不带 `--json` 时 stdout 只有最终答案、诊断走 stderr；
 *   - 事件形状（实测 + dsh-headless@0.2.1-rc.5 源码 projectJsonRun 双向印证）：
 *       {"type":"session","sessionId":"session-<uuid>","cwd":"<dir>"}
 *       {"type":"status","phase":"turn_start","turn":1}
 *       {"type":"status","phase":"step_start","turn":1,"step":1}
 *       {"type":"status","phase":"step_end","turn":1,"step":1,"usage":{...}}
 *       {"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"|"error"|...,...}}
 *       {"type":"thinking","text":"..."}                      （推理块 —— 不是「agent 说的话」）
 *       {"type":"text","text":"..."}                          （回答文本）
 *       {"type":"tool_call","callId":"c1","tool":"<名字>","input":{...}}
 *       {"type":"tool_result","callId":"c1","status":"completed"|"error","result":"..."}
 *       {"type":"final","text":"<最终答案>"}                  （终局事件，text 与 text 事件同一段回答）
 *       {"type":"error","message":"<致命错误>"}              （顶层错误事件；dsh 随后 exit 1）
 *   - 会话恢复：`--session-id <id>` 认领已持久化的 Session（会话 id 原样透传，不解释不改写）；
 *   - 退出码：成功 0；失败（如缺 API key）1，且 stderr 有一行 `dsh: <CODE>: <原因>`。
 *
 * ============ 降级语义（task_088 需求④）============
 *   - 本机没有 npx → 子进程拉不起来 → runtime 出 error{code:'spawn_failed'}（runtime 兜底，不假成功）；
 *   - npx 在但拉不到 @deepseek-ai/dsh（断网 / 源不可达）→ npx 非 0 退出 → runtime 出
 *     error{code:'nonzero_exit'}（同样是真失败，绝不假装成功）。
 *
 * @since v3.33（task_088）
 */

import {
  asRecord,
  asString,
  tryParseJson,
  type CliAdapter,
  type SpawnOptions,
  type TransportEvent,
} from '../transport';

/** dsh 的 npm 包名（默认；adapter 允许覆盖，便于指向内网镜像的同包）。 */
export const DSH_PACKAGE_NAME = '@deepseek-ai/dsh';

/** dsh 的 headless profile 名（默认）。 */
export const DSH_HEADLESS_PROFILE = 'headless';

/**
 * dsh 的运行器：dsh 不装全局也能跑 —— 走 `npx -y <包名>`（npx 命中 PATH 上的 dsh 时直接跑它，
 * 否则按需把包装进 npx 缓存）。故 adapter 的 binary 是 npx，不是 dsh。
 */
export const DSH_RUNNER_BINARY = 'npx';

export interface DshAdapterOptions {
  /** npm 包名；缺省 `@deepseek-ai/dsh`。 */
  readonly packageName?: string;
  /** profile 名；缺省 `headless`（one-shot runner：答一个任务就退出）。 */
  readonly profile?: string;
  /** 追加的环境变量（如代理：https_proxy / http_proxy）。 */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * 解析一行 dsh 运行事件（NDJSON）。
 * why 不认识的事件类型一律跳过：dsh 自我声明 dev preview、必有破坏性变更，
 *   不能因为多出一个新事件类型就让整轮对话崩掉（协议演进留口）。
 */
export function parseDshLine(line: string): readonly TransportEvent[] {
  const event = tryParseJson(line);
  if (!event) return []; // 非 JSON 行（banner / 警告）—— 跳过，不当错误。

  switch (asString(event.type)) {
    case 'session':
      return parseSession(event);
    case 'text':
      return parseText(event);
    case 'thinking':
      return []; // 推理块不是「agent 说的话」—— 不上送成 message（否则聊天记录里全是内心戏）。
    case 'tool_call':
      return parseToolCall(event);
    case 'tool_result':
      return parseToolResult(event);
    case 'status':
      return parseStatus(event);
    case 'error':
      // 顶层 error 事件：dsh-headless 的 fail() 在 --json 模式下把致命错误写成
      // {"type":"error","message":"..."} 再 exit 1（实测：未知 --session-id 就是这条）。
      // 不解析它的话，这句原因只会落进 stderr 尾巴（nonzero_exit），错误码更粗、消息更晚。
      return parseTopLevelError(event);
    case 'final':
      // 终局事件里的 text 与 text 事件是同一段回答（dsh 源码：final 携带默认模式打印的那份答案）。
      // 不再上送成 message —— 重复上送会让同一句话在聊天记录里出现两次
      // （与 adapters/claude.ts 对 result 事件的同一口径）。
      return [];
    default:
      return [];
  }
}

/** session：带 sessionId —— 原样透传给 AgentProfile.externalSessionId。 */
function parseSession(event: Record<string, unknown>): readonly TransportEvent[] {
  const sessionId = asString(event.sessionId);
  return sessionId ? [{ type: 'session', sessionId }] : [];
}

/** text：回答文本 → message。 */
function parseText(event: Record<string, unknown>): readonly TransportEvent[] {
  const text = asString(event.text);
  return text ? [{ type: 'message', text }] : [];
}

/** tool_call：工具名 + 入参 → tool_use（callId 原样当工具调用 id）。 */
function parseToolCall(event: Record<string, unknown>): readonly TransportEvent[] {
  const tool = asString(event.tool);
  if (!tool) return [];
  return [
    {
      type: 'tool_use',
      tool,
      input: event.input,
      id: asString(event.callId) ?? undefined,
    },
  ];
}

/**
 * tool_result：工具回执 → tool_result。
 * why 不把 status='error' 升格成 error 事件：工具报错是**这一次工具调用**失败，
 *   agent 通常会看到回执后重试或换路子；整轮失败由 turn_end 的 reason 决定。
 */
function parseToolResult(event: Record<string, unknown>): readonly TransportEvent[] {
  return [
    {
      type: 'tool_result',
      id: asString(event.callId) ?? undefined,
      text: asString(event.result) ?? undefined,
    },
  ];
}

/**
 * 顶层 error 事件（dsh-headless 的 fail() 写的 {"type":"error","message":"..."}）。
 * why 单独认：它是**致命错误**的直述（未知 session id / 任务非法等），比 stderr 尾巴更早更准。
 */
function parseTopLevelError(event: Record<string, unknown>): readonly TransportEvent[] {
  const message = asString(event.message) ?? 'dsh 执行失败';
  return [{ type: 'error', message, code: 'cli_error' }];
}

/**
 * status：只认 turn_end 的失败语义（其余 phase 只是进度心跳 —— 上送没有价值）。
 * reason.kind 的取值域（dsh-session 的 TurnEndReasonMap）：completed / aborted / blocked /
 *   error / max-tokens / interrupted / forked。其中只有 error 与 blocked 是「这一轮没成」。
 * aborted 交给 runtime 判（我们自己取消时 runtime 会自己出 error{aborted}，不重复报）；
 * max-tokens / interrupted 是「有插件兜住了」，不当失败。
 */
function parseStatus(event: Record<string, unknown>): readonly TransportEvent[] {
  if (asString(event.phase) !== 'turn_end') return [];
  const reason = asRecord(event.reason);
  const kind = asString(reason?.kind);
  if (kind === 'error') {
    const failure = asRecord(reason?.error);
    const message = asString(failure?.message) ?? 'dsh 执行失败';
    return [{ type: 'error', message, code: 'cli_error' }];
  }
  if (kind === 'blocked') {
    return [{ type: 'error', message: 'dsh 任务被阻塞（turn_end reason=blocked）', code: 'cli_error' }];
  }
  return [];
}

/**
 * 造 dsh adapter。
 * @param options 包名 / profile / 追加环境变量
 */
export function createDshAdapter(options: DshAdapterOptions = {}): CliAdapter {
  const packageName = options.packageName ?? DSH_PACKAGE_NAME;
  const profile = options.profile ?? DSH_HEADLESS_PROFILE;

  return {
    kind: 'dsh',
    binary: DSH_RUNNER_BINARY,
    outputMode: 'jsonl',
    buildArgs(prompt: string, spawnOptions: SpawnOptions = {}): readonly string[] {
      const args: string[] = ['-y', packageName, '--profile', profile, '--json'];
      // 会话 id 原样透传：dsh 的语义是「认领这个持久化 Session」（未知 id 是 dsh 自己的错）。
      const sessionId = spawnOptions.sessionId;
      if (sessionId) args.push('--session-id', sessionId);
      // 任务文本作为**单个** argv 元素（不经 shell）—— 多词 / 带引号的 prompt 不会被拆词。
      args.push(prompt);
      return args;
    },
    parseLine: parseDshLine,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      if (!options.env) return spawnOptions;
      return { ...spawnOptions, env: { ...options.env, ...(spawnOptions.env ?? {}) } };
    },
  };
}
