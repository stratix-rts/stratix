/**
 * 文件职责：**OpenCode** 的 adapter —— `opencode run --format json` 的事件翻译 + serve 端口探测。
 *   契约依据：docs/AGENT-MATRIX.md T1 行与「集成要点」第 3 条
 *   （"OpenCode 特例：优先走 opencode serve HTTP API，检测 serve 端口失败再降级 run spawn"）。
 * 输入：一行 JSON 文本（runtime 切好行）。
 * 输出：TransportEvent[]。
 * 禁止事项：
 *   1. 在这里 spawn 进程 —— 纯函数（+ 一个**可注入**的端口探测）；进程生命周期归 runtime.ts；
 *   2. 把「探测失败」当成致命错误 —— 探测失败正是**降级**信号（改走 run spawn），不是失败；
 *   3. 端口探测用固定 sleep —— 必须是真连接探测（TCP connect），否则每次调用都要白等。
 *
 * 降级策略（本机实现）：
 *   - 探测到本地 opencode serve 在跑 → `opencode run --attach <url>`（复用 server 的会话库，
 *     会话由 server 持久化 —— AGENT-MATRIX 说这是「最佳路径」）；
 *   - 探测不到 → 直接 `opencode run`（spawn 一个一次性会话）。
 *   两条路径的命令形态一致，差别只在 --attach，故降级对上层完全透明。
 *
 * 事件形状（opencode 的事件信封，两个家族都认 —— 家族 A 是本机实测到的扁平形状，
 * 家族 B 是 SDK 事件总线形状 `properties.part`）：
 *   A: {"type":"error","timestamp":...,"sessionID":"ses_x","error":{"name":"APIError","data":{"message":"..."}}}
 *   B: {"type":"message.part.updated","properties":{"part":{"type":"text","text":"..."}}}
 *
 * @since v3.8（task_023）
 */

import { connect } from 'net';

import {
  asRecord,
  asString,
  tryParseJson,
  type CliAdapter,
  type SpawnOptions,
  type TransportEvent,
} from '../transport';

/** serve 探测结果。 */
export interface ServeProbeResult {
  readonly ok: boolean;
  readonly url: string | null;
}

/** 探测函数（可注入 —— 单测里注入假探测，不真连端口）。 */
export type ServeProbe = () => Promise<ServeProbeResult>;

/** opencode serve 的默认地址（本机 opencode server 的约定端口）。 */
export const DEFAULT_SERVE_URL = 'http://127.0.0.1:4096';

/**
 * 默认探测：TCP 连一下 serve 端口，通就是通。
 * why 用 TCP 而不是 HTTP：探测只关心「端口有没有人听」，发 HTTP 请求反而依赖对方的路由；
 * 超时短（300ms）—— 探测不该拖慢每一轮对话。
 */
export function createTcpServeProbe(
  url: string = DEFAULT_SERVE_URL,
  timeoutMs = 300
): ServeProbe {
  const target = new URL(url);
  const port = Number(target.port || (target.protocol === 'https:' ? 443 : 80));
  const host = target.hostname || '127.0.0.1';
  return () =>
    new Promise<ServeProbeResult>((resolve) => {
      const socket = connect({ host, port });
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        socket.destroy();
        resolve({ ok, url: ok ? url : null });
      };
      socket.setTimeout(timeoutMs, () => finish(false));
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
    });
}

/**
 * 解析一行 opencode 事件。
 * why 写得这么"宽"：opencode 的事件信封有两代形状（见文件头），
 *   认死一个形状的代价是「另一代全是静默跳过」—— 表现为对话没有输出，很难排查。
 */
export function parseOpencodeLine(line: string): readonly TransportEvent[] {
  const event = tryParseJson(line);
  if (!event) return [];

  const events: TransportEvent[] = [];

  // —— 会话 id（两种形状都放在顶层）——
  const sessionId = asString(event.sessionID) ?? asString(event.sessionId);
  if (sessionId) events.push({ type: 'session', sessionId });

  // —— 错误（扁平形状的 type=error）——
  if (asString(event.type) === 'error') {
    const message = extractErrorMessage(event);
    events.push({ type: 'error', message, code: 'cli_error' });
    return events;
  }

  // —— 载荷：SDK 形状在 properties.part，扁平形状在顶层 ——
  const properties = asRecord(event.properties);
  const payload = asRecord(properties?.part) ?? asRecord(event.part) ?? event;

  const payloadType = asString(payload.type);

  if (payloadType === 'text') {
    const text = asString(payload.text);
    if (text) events.push({ type: 'message', text });
    return events;
  }

  if (payloadType === 'tool') {
    const tool = asString(payload.tool) ?? 'tool';
    const state = asRecord(payload.state);
    const input = state?.input ?? payload.input;
    events.push({ type: 'tool_use', tool, input, id: asString(payload.id) ?? undefined });
    const status = asString(state?.status);
    if (status === 'completed' || status === 'error') {
      const output = asString(state?.output) ?? asString(state?.title) ?? undefined;
      events.push({ type: 'tool_result', tool, text: output, id: asString(payload.id) ?? undefined });
    }
    return events;
  }

  // 扁平形状的纯文本事件：{"type":"text","text":"..."}
  if (asString(event.type) === 'text') {
    const text = asString(event.text);
    if (text) events.push({ type: 'message', text });
  }

  return events;
}

/** 从错误事件里挖出人话消息（opencode 的错误是两层套嵌：error.data.message）。 */
function extractErrorMessage(event: Record<string, unknown>): string {
  const error = asRecord(event.error);
  const data = asRecord(error?.data);
  return (
    asString(data?.message) ??
    asString(error?.message) ??
    asString(event.message) ??
    'opencode 报错'
  );
}

export interface OpencodeAdapterOptions {
  /** 探测函数；缺省走 TCP 探测（DEFAULT_SERVE_URL）。 */
  readonly probeServe?: ServeProbe;
  /** serve 地址；缺省 DEFAULT_SERVE_URL。 */
  readonly serveUrl?: string;
  /** 模型（provider/model）；缺省用 opencode 自己的默认模型。 */
  readonly model?: string;
}

/** 造 OpenCode adapter。 */
export function createOpencodeAdapter(options: OpencodeAdapterOptions = {}): CliAdapter {
  const serveUrl = options.serveUrl ?? DEFAULT_SERVE_URL;
  const probe = options.probeServe ?? createTcpServeProbe(serveUrl);

  return {
    kind: 'opencode',
    binary: 'opencode',
    outputMode: 'jsonl',
    buildArgs(prompt: string, spawnOptions: SpawnOptions = {}): readonly string[] {
      const args: string[] = ['run', '--format', 'json'];
      if (options.model) args.push('--model', options.model);
      // 探测到 serve 才带 --attach（降级路径不带，命令形态对上层透明）。
      const attachUrl = spawnOptions.attachUrl;
      if (attachUrl) args.push('--attach', attachUrl);
      const sessionId = spawnOptions.sessionId;
      if (sessionId) args.push('--session', sessionId);
      args.push(prompt);
      return args;
    },
    parseLine: parseOpencodeLine,
    async prepare(spawnOptions: SpawnOptions): Promise<SpawnOptions> {
      // 调用方显式给了 attachUrl 就不探测（尊重调用方）。
      if (spawnOptions.attachUrl !== undefined) return spawnOptions;
      const probed = await probe();
      // 探测失败 = 降级信号，不是错误：返回 attachUrl=null 走 run spawn。
      return { ...spawnOptions, attachUrl: probed.ok ? probed.url : null };
    },
  };
}
