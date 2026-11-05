/**
 * 文件职责：本地 CLI agent 的**传输层抽象** —— 把各家 headless CLI（claude / codex / opencode /
 *   kimi / openclaw）的一次调用归一成一条 `AsyncIterable<TransportEvent>`。
 *   契约依据：docs/AGENT-MATRIX.md「集成要点」第 1 / 2 / 4 / 5 条 + .long-run-agent/tasks/task_023.md。
 * 输入：一段 prompt（+ 可选外部会话 id / 取消信号 / 超时）。
 * 输出：TransportEvent 事件流；各家私有格式的翻译在 adapters/ 里，**本文件不认识任何一家 CLI**。
 * 禁止事项：
 *   1. 在本文件里 import child_process —— 子进程一律走注入的 ProcessFactory
 *      （真实实现见 node-process.ts；单测注入假工厂喂样例 JSONL，不必真调外部二进制）；
 *   2. 把「一家 CLI 的字段名」漏进公共事件类型 —— 公共词汇表只认
 *      message / tool_use / tool_result / session / done / error；
 *   3. 在事件流里塞业务状态 —— 本层只搬运字节与事件，状态归 core/agent-link；
 *   4. 引入新依赖 —— 只用 Node 内置能力 + 既有 core 契约。
 *
 * 事件词汇表（AGENT-MATRIX「集成要点」第 1 条）：
 *   - message      ：agent 说的话（文本块）；
 *   - tool_use     ：agent 调了工具（工具名 + 入参）；
 *   - tool_result  ：工具回了什么；
 *   - session      ：外部会话 id（各家语义不同，**原样透传**给 AgentProfile.externalSessionId）；
 *   - done         ：本轮结束（退出码 + 本轮最终文本）；
 *   - error        ：失败（取消 / 超时 / 非 0 退出 / CLI 自报错误）。
 *
 * 运行位置：Node 环境（Electron 主进程 / 纯 Node 皆可跑）。渲染进程没有 child_process，
 *   故本目录不进渲染 bundle：主进程跑 transport，事件经 IPC 交给渲染层。
 */

import type { AgentKind } from '../../../core/types';

/** 本目录支持的 CLI agent 种类（与 core 的 AgentKind 同词表 —— T1 五家）。 */
export type CliTransportKind = AgentKind;

// ============================================================================
// 事件
// ============================================================================

/** 传输层错误码：区分「为什么失败」，便于上层分类展示与重试决策。 */
export type TransportErrorCode =
  /** 子进程拉不起来（binary 不存在 / 无权限）。 */
  | 'spawn_failed'
  /** 调用方主动取消（AbortSignal）。 */
  | 'aborted'
  /** 超过 timeoutMs。 */
  | 'timeout'
  /** 进程非 0 退出（CLI 自己失败）。 */
  | 'nonzero_exit'
  /** CLI 在事件流里自报了错误（如模型不存在）。 */
  | 'cli_error';

/** 传输层事件：公共词汇表。 */
export type TransportEvent =
  /** agent 说的一段话。 */
  | { readonly type: 'message'; readonly text: string }
  /** agent 调工具。 */
  | { readonly type: 'tool_use'; readonly tool: string; readonly input?: unknown; readonly id?: string }
  /** 工具返回。 */
  | { readonly type: 'tool_result'; readonly tool?: string; readonly text?: string; readonly id?: string }
  /** 外部会话 id（**原样透传**，不解释、不改写）。 */
  | { readonly type: 'session'; readonly sessionId: string }
  /** 本轮结束：退出码 + 本轮最终文本（最后一条 message）+ 会话 id（若有）。 */
  | {
      readonly type: 'done';
      readonly exitCode: number;
      readonly text: string | null;
      readonly sessionId: string | null;
    }
  /** 失败。 */
  | { readonly type: 'error'; readonly message: string; readonly code: TransportErrorCode };

// ============================================================================
// 调用参数
// ============================================================================

export interface SpawnOptions {
  /**
   * 外部会话 id（上一轮拿到的 session 事件里的值）。
   * **原样透传**给各家 CLI —— 各家语义不同（claude uuid / codex thread / kimi session），
   * 传输层不解释、不归一（见 AGENT-MATRIX「集成要点」第 4 条）。
   */
  readonly sessionId?: string | null;
  /** 取消信号：置为 aborted 后必须终止**整个进程树**（见「集成要点」第 5 条）。 */
  readonly signal?: AbortSignal;
  /** 超时（ms）：缺省不限。超时按 abort 路径处理，只是错误码不同。 */
  readonly timeoutMs?: number;
  /**
   * 工作目录（缺省 = 继承当前进程 cwd）。
   *
   * @since v3.44，task_165：工作目录的**供给方**已抽成端口 `CwdProvider` ——
   *   注入的 provider 给出值时以它为准；缺省 provider（返回 undefined）⇒ 本字段照旧生效，
   *   行为与今天一致（见 runtime 的 resolveCwd）。
   */
  readonly cwd?: string;
  /** 追加的环境变量（不覆盖既有环境）。 */
  readonly env?: Readonly<Record<string, string>>;
  /** opencode 专用：探测到本地 serve 端口时带上 --attach（否则走 run 降级）。 */
  readonly attachUrl?: string | null;
}

// ============================================================================
// 子进程端口（注入点）
// ============================================================================

/**
 * 一次子进程运行的句柄。
 * why 抽象成「行」而不是「字节流」：各 adapter 关心的是**逐行**的 JSONL / 文本，
 *   在这里切行一次，各家就不用各写一遍切行（含半行缓冲的处理）。
 */
export interface CliProcessHandle {
  /** stdout 逐行（已切好行，行尾不带换行符）。 */
  readonly stdout: AsyncIterable<string>;
  /** stderr 逐行。 */
  readonly stderr: AsyncIterable<string>;
  /** 进程退出码（promise 在进程结束时 settle）。 */
  readonly exit: Promise<number>;
  /**
   * 终止**整个进程树**（子进程自己拉的孙进程也要死）。
   * why 必须杀树：claude / codex / kimi 都会再拉自己的子进程（bash / 工具），
   *   只 kill 直接子进程会留下孤儿进程继续跑（perf 硬约束：资源必须可回收）。
   */
  killTree(signal?: NodeJS.Signals): void;
}

/** 子进程工厂：真实实现走 child_process，单测注入假工厂。 */
export type ProcessFactory = (
  command: string,
  args: readonly string[],
  options: { readonly cwd?: string; readonly env?: Readonly<Record<string, string>> }
) => CliProcessHandle;

// ============================================================================
// cwd 供给端口（注入点 —— @since v3.44，task_165 / docs/DESIGN-workspace.md §8 M0-01）
// ============================================================================

/**
 * cwd 供给端口：给出**子进程的工作目录**。
 *
 * why 抽成端口：「进程在哪儿跑」是**供给问题**（谁给路径），不是「怎么 spawn」的问题
 *   （后者归 ProcessFactory）⇒ 供给方单独成端口，将来换供给方不必动 spawn 逻辑。
 *
 * 形状对齐 dsh（DESIGN-workspace §8 M0-01 的 A 面）：dsh headless **没有 `--cwd` 选项**，
 *   cwd 只能靠**进程 cwd**（`apps/cli/src/args.ts`）⇒ 本端口返回的就是「进程 cwd 该是什么」。
 *   将来 `ctx.remote.stratix.enterInstance` = 「切 cwdProvider 实现」的薄封装（宿主可见控制面）。
 *
 * 缺省实现（`defaultCwdProvider`）返回 `undefined` ⇒ 子进程继承当前进程 cwd，
 *   与今天**逐字节一致**（本条只铺管道，无行为变更）。
 */
export type CwdProvider = () => string | undefined;

/**
 * 缺省 cwd 供给实现：恒返回 `undefined`（= 继承当前进程 cwd）。
 * why 单独导出而不是「没传就不调」：让「缺省行为」有**唯一一份真相**，可被单测钉住。
 */
export const defaultCwdProvider: CwdProvider = (): string | undefined => undefined;

// ============================================================================
// Adapter 契约（纯函数，无 IO）
// ============================================================================

/** adapter 产出的 stdout 形态。 */
export type CliOutputMode =
  /** 逐行 JSON（JSONL）—— claude / codex / opencode。 */
  | 'jsonl'
  /** 整段 JSON（一个文档，可能跨多行）—— openclaw（`--json` 输出是 pretty-print 的）。 */
  | 'json'
  /** 纯文本 —— kimi（非交互模式只吐文本，结构化弱）。 */
  | 'text';

/**
 * 一家 CLI 的**纯**适配器：只认「怎么拼参数」与「怎么把一行输出翻译成事件」。
 * why 拆这么纯：拼参数与解析都能对着样例 JSONL 单测，
 *   进程生命周期（spawn / 取消 / 杀树）由 runtime 统一管，各家不重复实现。
 */
export interface CliAdapter {
  /** 种类（与 core 的 AgentKind 同词表）。 */
  readonly kind: CliTransportKind;
  /** 二进制文件名。 */
  readonly binary: string;
  /** stdout 形态。 */
  readonly outputMode: CliOutputMode;
  /** 拼参数：prompt + 会话 id → argv。 */
  buildArgs(prompt: string, options?: SpawnOptions): readonly string[];
  /** 翻译一行 stdout → 事件（可空数组：这一行没有值得上送的内容）。 */
  parseLine(line: string): readonly TransportEvent[];
  /**
   * 翻译一行 stderr → 事件（可空数组）。缺省不解析 —— stderr 只进错误尾巴缓冲。
   *
   * why 需要这个钩子（@since v3.31，task_055）：有的 CLI 把**会话 id 只打在 stderr**
   *   （kimi 的收尾提示行 `To resume this session: kimi -r <uuid>`），stdout 全程拿不到。
   *   契约：这里只该产出 session / error 事件 —— stderr 不是对话内容，message 不许从这里出；
   *   事件在进程退出、stdout 排干之后统一上送（时序见 runtime「stderr 收割」），
   *   保证收尾 done 事件带的 sessionId 已经吸收了 stderr 里的id。
   */
  parseStderrLine?(line: string): readonly TransportEvent[];
  /**
   * spawn 前的一次性准备（如 opencode 探测 serve 端口，决定要不要 --attach；
   * openclaw 首发生成 uuid 会话 id —— task_055）。
   * 缺省 = 不做准备工作。
   */
  prepare?(options: SpawnOptions): Promise<SpawnOptions>;
}

// ============================================================================
// Transport（对外唯一入口）
// ============================================================================

export interface CliTransport {
  /** 种类。 */
  readonly kind: CliTransportKind;
  /** 二进制文件名。 */
  readonly binary: string;
  /** 拼参数（转发给 adapter；供上层预演 / 单测断言）。 */
  buildArgs(prompt: string, options?: SpawnOptions): readonly string[];
  /**
   * 跑一轮对话，产出事件流。
   * 约定：
   *   - 正常结束 → 最后一个事件是 done（exitCode=0）；
   *   - 失败 → 产出 error 事件并结束（不再补 done —— 两者的语义不同，别混）；
   *   - 被取消 → 产出 error{code:'aborted'} 并结束。
   */
  spawn(prompt: string, options?: SpawnOptions): AsyncIterable<TransportEvent>;
}

// ============================================================================
// 小工具
// ============================================================================

/** stderr 尾巴长度上限：CLI 报错时可能刷几百行日志，进事件流的部分必须有界（perf：数据不许无界）。 */
export const MAX_STDERR_TAIL = 2000;

/** 取 stderr 尾部（并压成一行，避免事件里塞进大段换行文本）。 */
export function stderrTail(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= MAX_STDERR_TAIL) return trimmed;
  return `…${trimmed.slice(trimmed.length - MAX_STDERR_TAIL)}`;
}

/** 从「可能不是对象」的 JSON 里安全取字段（各家 CLI 的字段类型不稳定，解析不许抛异常）。 */
export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 安全取字符串字段。 */
export function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * 解析一行 JSON，失败返回 null（**不抛异常**）。
 * why 不抛：各家 CLI 会在 stdout 里混进 banner / 警告行，脏一行不该让整轮对话失败。
 */
export function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  try {
    return asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * 取数组字段（各家有时给数组、有时给单个对象）。
 * why 需要这个归一：claude 的 content 有时是数组、有时是单个对象；codex 的 item 同理。
 */
export function asArray(value: unknown): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}
