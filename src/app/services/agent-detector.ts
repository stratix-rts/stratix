/**
 * 文件职责：本地 CLI agent **检测器** —— 逐个探测「本机装没装 / 什么版本 / 二进制在哪」，
 *   结果并入 WorldState.detectedAgents（契约见 core/types.ts 的 DetectedAgent）。
 *   名单权威来源：docs/AGENT-MATRIX.md（T1 深度适配 / T2 基础适配 / T3 仅探测注册）。
 *   方案来源：.long-run-agent/tasks/task_022.md。
 * 输入：注入的 execFn（跑外部命令）+ 可选名单 / 超时 / 逐条回调 / 取消信号。
 * 输出：每项一条 DetectedAgent；detectAllAgents 逐条回调，**不等全部结束**。
 * 禁止事项：
 *   1. 在本文件里直接 spawn 子进程 —— 命令执行一律走注入的 execFn
 *      （真实实现见同目录 node-exec.ts；单测注入假 execFn 覆盖已装 / 未装 / 超时三态）；
 *   2. 阻塞式探测（等全部结果再返回）—— 必须逐条出结果逐条回调：
 *      名单 12 项、每项 10s 超量，全等完再出结果等于首启白屏几十秒；
 *   3. 把名单抄到别处 —— 名单只在本文件一份（AGENT_DETECTION_TARGETS），其余地方引用它；
 *   4. 碰 hud / world 渲染层 —— 检测结果只进 WorldState，怎么渲染归 hud；
 *   5. 引入新依赖 —— 只用 Node 内置能力 + 既有 core 契约。
 *
 * 运行位置：Node 环境（Electron 主进程 / 纯 Node 皆可跑）。
 *   渲染进程没有 child_process，故**本文件不进渲染 bundle**：
 *   主进程探测完经 IPC 交给渲染层，由 app/main/main-entry.ts 并入 core 状态。
 *
 * 三态语义（单测与验收都按这套口径）：
 *   - 已装   ：which 找到二进制 → status='installed'，path 非空；version 可能为 null（版本命令失败）；
 *   - 未装   ：which 明确没找到 → status='not-installed'，installed=false；
 *   - 超时   ：探测超时 → status='timeout'，installed 视 which 是否已成功而定（未知 ≠ 没装）。
 */

import {
  DETECTABLE_AGENT_KINDS,
  buildCustomAgentKind,
  type AgentDetectionTier,
  type DetectableAgentKind,
  type DetectedAgent,
} from '../../core/types';
import { isAllowedCustomAgentCmd } from '../../core/custom-agent';

// ============================================================================
// 名单（与 docs/AGENT-MATRIX.md 一一对应）
// ============================================================================

/** 名单里的一项：一个待探测的本地 CLI agent。 */
export interface AgentDetectionTarget {
  /** agent 种类（契约词表 DETECTABLE_AGENT_KINDS 内）。 */
  readonly kind: DetectableAgentKind;
  /** 探测分层（T1 / T2 / T3）。 */
  readonly tier: AgentDetectionTier;
  /** 二进制文件名（交给 which 去找）。 */
  readonly binary: string;
  /** 读版本用的参数（默认 ['--version']）。 */
  readonly versionArgs: readonly string[];
}

/**
 * 待探测名单（T1-T3 全量 12 项）。
 * why 名单在这里而不是散落各处：AGENT-MATRIX.md 是文档（会被人改），
 * 代码里需要一份**可测**的对照物 —— 单测据此断言"代码里的名单与文档口径一致"
 * （项数、分层分布、二进制名唯一），文档改了而代码没改会被测出来。
 */
export const AGENT_DETECTION_TARGETS: readonly AgentDetectionTarget[] = [
  // —— T1：深度适配（流式 + 会话恢复 + 结构化输出）——
  { kind: 'claude-code', tier: 'T1', binary: 'claude', versionArgs: ['--version'] },
  { kind: 'codex', tier: 'T1', binary: 'codex', versionArgs: ['--version'] },
  { kind: 'opencode', tier: 'T1', binary: 'opencode', versionArgs: ['--version'] },
  { kind: 'kimi', tier: 'T1', binary: 'kimi', versionArgs: ['--version'] },
  { kind: 'openclaw', tier: 'T1', binary: 'openclaw', versionArgs: ['--version'] },
  // dsh（DeepSeek Harness，@since v3.33 task_088）：**没有本地安装** —— 它按需经
  // `npx -y @deepseek-ai/dsh` 拉取运行（见 cli-transport/adapters/dsh.ts）。
  // 故探测口径 = 「运行器 npx 在不在」：which npx 找运行器，`npx --version` 取版本。
  // why 不探 `dsh` 本身：绝大多数机器没装全局 dsh，探它会永远报"未安装"，
  //   健康监测两轮后判离线 → 派任务/对话被拦，功能等于没有（比"版本列不准"严重得多）。
  // why 版本列报的是 npx/npm 的版本：探 dsh 包要真下载（冷缓存几十秒，会被 10s 超时打断
  //   并把「拉包」拖成永久失败）。dsh 自身的版本由它在运行时自报（`dsh --version`）。
  { kind: 'dsh', tier: 'T1', binary: 'npx', versionArgs: ['--version'] },
  // —— T2：基础适配（headless 可用，会话 / 结构化能力有限）——
  { kind: 'gemini', tier: 'T2', binary: 'gemini', versionArgs: ['--version'] },
  { kind: 'qwen', tier: 'T2', binary: 'qwen', versionArgs: ['--version'] },
  { kind: 'crush', tier: 'T2', binary: 'crush', versionArgs: ['--version'] },
  { kind: 'goose', tier: 'T2', binary: 'goose', versionArgs: ['--version'] },
  // —— T3：仅探测注册（展示「即将支持」）——
  { kind: 'aider', tier: 'T3', binary: 'aider', versionArgs: ['--version'] },
  { kind: 'copilot', tier: 'T3', binary: 'copilot', versionArgs: ['--version'] },
];

/**
 * T1 子名单（@since v3.30，task_054）：健康监测的周期探测面 —— 只有 T1 那几家能绑角色 / 跑
 * transport，掉线判定也只对它们有意义（T2/T3 没有执行链路，探它们是白耗子进程）。
 * 从主名单过孵而不是另抄一份（名单只在本文件一份的铁律）；主名单增删 T1 项时自动跟随。
 */
export const T1_AGENT_DETECTION_TARGETS: readonly AgentDetectionTarget[] = AGENT_DETECTION_TARGETS.filter(
  (target) => target.tier === 'T1'
);

/** 单项探测超时（ms）。why 10s：各 CLI 的 --version 正常在 1s 内，卡住说明环境有问题。 */
export const DEFAULT_DETECTION_TIMEOUT_MS = 10_000;

/** 版本文本长度上限：版本串来自外部命令输出，必须有界（perf：进状态的数据不许无界）。 */
export const MAX_VERSION_LEN = 64;

// ============================================================================
// 命令执行契约（注入点）
// ============================================================================

/** 一次命令执行的结果。 */
export interface ExecOutcome {
  /** 退出码；非 0 = 命令没成功（which 找不到二进制就是这种）。 */
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /**
   * 执行方自己判定超时（真实实现会 kill 子进程）。
   * why 单独一个字段：命令超时后**仍然有退出码**（例如 143 / -1），
   * 只看退出码会把「超时」误判成「没装」—— 这是检测器最容易搞错的一处。
   */
  readonly timedOut?: boolean;
}

/**
 * 注入的命令执行器：跑一条命令并回结果。
 * timeoutMs 是**提示**：执行方应当自己也设超时（真实实现靠它 kill 子进程），
 * 检测器另外还有一道兜底计时（见 runGuarded），保证「不返回的 execFn」也不会卡住整轮探测。
 */
export type ExecFn = (
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs: number }
) => Promise<ExecOutcome>;

// ============================================================================
// 单项探测
// ============================================================================

export interface DetectAgentOptions {
  /** 命令执行器（注入点）。 */
  readonly execFn: ExecFn;
  /** 单项超时（ms）；缺省 DEFAULT_DETECTION_TIMEOUT_MS。 */
  readonly timeoutMs?: number;
  /** 找二进制的命令；缺省按平台取（win32 用 where，其余用 which）。 */
  readonly whichCommand?: string;
}

/** 超时哨兵：与「命令执行失败」区分开（两者都走异常路径，但不是一回事）。 */
class DetectionTimeoutError extends Error {
  constructor() {
    super('agent detection timeout');
    this.name = 'DetectionTimeoutError';
  }
}

/** 一次受控执行的结果。 */
type GuardedOutcome =
  | { readonly kind: 'ok'; readonly outcome: ExecOutcome }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'failed' };

/**
 * 跑一条命令并**保证有界**：超过 timeoutMs 即判超时。
 * why 要这道兜底：注入的 execFn 未必遵守 timeoutMs（假实现可能压根不返回），
 * 没有兜底的话一个卡住的 agent 会把整轮探测（以及调用方的启动流程）一起拖死。
 * 注：超时后**不**取消注入的 execFn —— 取消语义归执行方（真实实现自己 kill 子进程）。
 */
async function runGuarded(
  execFn: ExecFn,
  command: string,
  args: readonly string[],
  timeoutMs: number
): Promise<GuardedOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new DetectionTimeoutError()), timeoutMs);
  });
  try {
    const outcome = await Promise.race([execFn(command, args, { timeoutMs }), timeout]);
    return { kind: 'ok', outcome };
  } catch (error) {
    if (error instanceof DetectionTimeoutError) return { kind: 'timeout' };
    return { kind: 'failed' };
  } finally {
    // 计时器必须清理：探测 12 项就会挂 12 个定时器，不清会拖住 Node 进程退出（资源必须可清理）。
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 找二进制的命令：win32 用 where，其余用 which（macOS / Linux 通用）。 */
export function defaultWhichCommand(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'where' : 'which';
}

/**
 * 从版本输出里取版本号：首个 semver 片段；没有 semver 时，**首行含数字**才退回首行原文。
 * why 要这个「含数字」的条件：版本命令失败时输出的是报错（"command not found" / "boom"），
 * 把报错当版本号写进状态就是撒谎 —— 首行没有任何数字，多半不是版本。
 * 含数字的退化情况（如 "claude 2.0"）仍是用户看得懂的信息，丢掉反而更没用。
 */
export function parseVersion(output: string): string | null {
  const line = output
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  if (!line) return null;
  const semver = /\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/.exec(line);
  const value = semver ? semver[0] : /\d/.test(line) ? line : null;
  if (value === null) return null;
  return value.length > MAX_VERSION_LEN ? value.slice(0, MAX_VERSION_LEN) : value;
}

/** 取首个非空行（which 的输出就是路径；多行时取第一行）。 */
function firstNonEmptyLine(output: string): string | null {
  const line = output
    .split('\n')
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line ?? null;
}

/**
 * 探测单个 agent：先 which 定位，再跑一次版本命令。
 * why 分两步而不是一条 `claude --version` 了事：
 *   没装时版本命令会报 "command not found"（各家文案还不一样），
 *   先 which 才知道「到底装没装」，报错文案与退出码也更可预期。
 * 语义：
 *   - which 失败（非 0）→ 未装（not-installed），**不再**跑版本命令（装了才谈版本）；
 *   - which 成功 → 已确认安装（installed=true），版本命令超时/失败只影响 version，不影响"装没装"；
 *   - 任一步超时 → status='timeout'（安装状态未确认，除非 which 已成功）。
 */
export async function detectAgent(
  target: AgentDetectionTarget,
  options: DetectAgentOptions
): Promise<DetectedAgent> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  const whichCommand = options.whichCommand ?? defaultWhichCommand();
  const base = { kind: target.kind, tier: target.tier } as const;

  // —— 第一步：定位二进制 ——
  const located = await runGuarded(options.execFn, whichCommand, [target.binary], timeoutMs);
  if (located.kind === 'timeout') {
    return { ...base, installed: false, status: 'timeout', version: null, path: null };
  }
  if (located.kind === 'failed') {
    return { ...base, installed: false, status: 'failed', version: null, path: null };
  }
  if (located.outcome.timedOut) {
    return { ...base, installed: false, status: 'timeout', version: null, path: null };
  }
  if (located.outcome.code !== 0) {
    return { ...base, installed: false, status: 'not-installed', version: null, path: null };
  }
  const path = firstNonEmptyLine(located.outcome.stdout);
  if (!path) {
    // which 说成功却没给路径：环境异常（PATH 被改坏 / which 被替身），不能当成"装了"。
    return { ...base, installed: false, status: 'failed', version: null, path: null };
  }

  // —— 第二步：读版本（用解析出的绝对路径，避免 PATH 歧义）——
  const versioned = await runGuarded(options.execFn, path, target.versionArgs, timeoutMs);
  if (versioned.kind === 'timeout') {
    return { ...base, installed: true, status: 'timeout', version: null, path };
  }
  if (versioned.kind === 'failed') {
    return { ...base, installed: true, status: 'failed', version: null, path };
  }
  if (versioned.outcome.timedOut) {
    return { ...base, installed: true, status: 'timeout', version: null, path };
  }
  // 版本命令非 0 退出不影响"装没装"：路径已确认存在，只是版本读不出来。
  const version = parseVersion(versioned.outcome.stdout) ?? parseVersion(versioned.outcome.stderr);
  return { ...base, installed: true, status: 'installed', version, path };
}

// ============================================================================
// 自定义 agent 注册的探测（@since v3.32，task_056）
// ============================================================================

/** 一条自定义注册（探测视角的最小形状；全量形状见 persistence/custom-agent-dao）。 */
export interface CustomDetectionTarget {
  /** 注册 id（拼 kind = `custom:<id>`）。 */
  readonly id: string;
  /** 显示名（注册表里的用户命名，进 DetectedAgent.label）。 */
  readonly name: string;
  /** 探测命令（白名单内串；exit 0 = 在装 —— 与内置的 which+version 两步不同，这是单步直跑）。 */
  readonly probeCmd: string;
}

/** 探测命令 → argv：白名单串按空白切分即忠实 token 化（无引号/反斜杠要还原，见 custom.ts 同一口径）。 */
function customProbeArgv(probeCmd: string): readonly string[] {
  return probeCmd.split(/\s+/).filter((token) => token.length > 0);
}

/** 一次受控探测的退出码 → 探测结论（与内置三态口径对齐，见文件头三态语义）。 */
function customOutcomeStatus(outcome: ExecOutcome): { installed: boolean; status: 'installed' | 'not-installed' | 'failed' } {
  if (outcome.code === 0) return { installed: true, status: 'installed' };
  // 127 = shell「命令不存在」的惯例退出码（node-exec 的 ENOENT 也归它）：这是「确定没装」。
  if (outcome.code === 127) return { installed: false, status: 'not-installed' };
  // 其它非 0：命令在但没跑成（坏旗标 / 凭证缺失 / 崩了）—— 探测失败，不算「确定没装」。
  return { installed: false, status: 'failed' };
}

/**
 * 探测单个自定义注册：直跑 probeCmd，exit 0 = 在装（task_056 规格）。
 * 与内置 detectAgent 的两步（which → version）不同：自定义注册**只有一条命令可探**，
 * 版本 / 路径一律 null（注册行不承诺这两样语义）；tier 恒 T1（能绑角色、能跑 transport）。
 * 白名单外的脏命令（库被手改）→ failed，不跑（fail closed，与 adapter 渲染同一口径）。
 */
export async function detectCustomAgent(
  target: CustomDetectionTarget,
  options: DetectAgentOptions
): Promise<DetectedAgent> {
  const base = {
    kind: buildCustomAgentKind(target.id),
    tier: 'T1' as const,
    label: target.name,
    version: null,
    path: null,
  } as const;
  if (!isAllowedCustomAgentCmd(target.probeCmd)) {
    return { ...base, installed: false, status: 'failed' };
  }
  const argv = customProbeArgv(target.probeCmd);
  const binary = argv[0];
  if (!binary) return { ...base, installed: false, status: 'failed' };

  const timeoutMs = options.timeoutMs ?? DEFAULT_DETECTION_TIMEOUT_MS;
  const guarded = await runGuarded(options.execFn, binary, argv.slice(1), timeoutMs);
  if (guarded.kind === 'timeout') return { ...base, installed: false, status: 'timeout' };
  if (guarded.kind === 'failed') return { ...base, installed: false, status: 'failed' };
  if (guarded.outcome.timedOut) return { ...base, installed: false, status: 'timeout' };
  return { ...base, ...customOutcomeStatus(guarded.outcome) };
}

/** 自定义注册整轮探测的选项（与 detectAllAgents 同一节奏：逐条回调、可取消）。 */
export interface DetectCustomAgentsOptions extends DetectAgentOptions {
  /** 待探测的注册行；通常由主进程从 custom_agents 表读出。 */
  readonly targets: readonly CustomDetectionTarget[];
  /** 逐条回调。 */
  readonly onResult?: (result: DetectedAgent) => void;
  /** 日志回调；缺省不打。 */
  readonly logger?: (line: string) => void;
  readonly signal?: AbortSignal;
}

/** 跑完一整轮自定义注册探测（顺序执行、逐条回调 —— 与 detectAllAgents 同一节奏与理由）。 */
export async function detectCustomAgents(options: DetectCustomAgentsOptions): Promise<DetectedAgent[]> {
  const logger = options.logger ?? ((): void => undefined);
  const results: DetectedAgent[] = [];
  for (const target of options.targets) {
    if (options.signal?.aborted) break;
    const result = await detectCustomAgent(target, options);
    results.push(result);
    options.onResult?.(result);
    logger(formatDetectionLog(result));
  }
  return results;
}

// ============================================================================
// 整轮探测
// ============================================================================

export interface DetectAllAgentsOptions extends DetectAgentOptions {
  /** 待探测名单；缺省 AGENT_DETECTION_TARGETS。 */
  readonly targets?: readonly AgentDetectionTarget[];
  /** 逐条回调：每探测完一项立刻调用（首启引导据此渐进展示）。 */
  readonly onResult?: (result: DetectedAgent) => void;
  /** 日志回调；缺省打到 console.log（真机跑一次就能看到探测日志）。 */
  readonly logger?: (line: string) => void;
  /** 取消信号：置为 aborted 后不再开始下一项（当前正在跑的那条由它自己的超时兜底）。 */
  readonly signal?: AbortSignal;
}

/**
 * 跑完一整轮探测：**逐条**探测、**逐条**回调。
 * why 顺序执行而不是并发：11 个 agent 并发 spawn 会一次性拉起一堆外部进程（本机 CPU / IO 抖动），
 *   而探测本身不是性能关键路径；顺序跑最坏情况 11×10s，但结果是流式出来的，
 *   用户看到第一条的时间不受后面几项拖累。
 */
export async function detectAllAgents(options: DetectAllAgentsOptions): Promise<DetectedAgent[]> {
  const targets = options.targets ?? AGENT_DETECTION_TARGETS;
  const logger = options.logger ?? ((line: string): void => console.log(line));
  const results: DetectedAgent[] = [];

  for (const target of targets) {
    if (options.signal?.aborted) {
      logger(`[agent-detector] 已取消，跳过剩余 ${targets.length - results.length} 项`);
      break;
    }
    const result = await detectAgent(target, options);
    results.push(result);
    // 先回调再记日志：回调方（写状态 → 广播）先于日志看到结果，顺序不纠结，但固定下来好排查。
    options.onResult?.(result);
    logger(formatDetectionLog(result));
  }

  return results;
}

/**
 * 探测日志的一行（真机跑一次 dev 时看这个）。
 * 格式：`[agent-detector] claude-code (T1) ✓ 已安装 · 2.0.14 · /usr/local/bin/claude`
 */
export function formatDetectionLog(result: DetectedAgent): string {
  const head = `[agent-detector] ${result.kind} (${result.tier})`;
  switch (result.status) {
    case 'installed':
      return `${head} ✓ 已安装${result.version ? ` · ${result.version}` : ' · 版本未知'}${
        result.path ? ` · ${result.path}` : ''
      }`;
    case 'not-installed':
      return `${head} ✗ 未安装`;
    case 'timeout':
      return `${head} ⏱ 探测超时（安装状态未确认${result.path ? `，但已定位到 ${result.path}` : ''}）`;
    case 'failed':
      return `${head} ✗ 探测失败`;
    default:
      return head;
  }
}

/**
 * 把一条新结果并进当前快照（同 kind 覆盖，新 kind 追加）。
 * why 需要它：检测是**逐条**到达的，而状态里只留一份当前快照 ——
 *   合并规则必须只有一处（各调用方各写一份，覆盖/追加顺序迟早漂移）。
 */
export function mergeDetectedAgents(
  current: readonly DetectedAgent[],
  incoming: DetectedAgent
): DetectedAgent[] {
  const index = current.findIndex((agent) => agent.kind === incoming.kind);
  if (index === -1) return [...current, incoming];
  const next = current.slice();
  next[index] = incoming;
  return next;
}

/**
 * 自检：代码里的名单是否与契约词表一致（种类齐全、无重复、分层分布符合 AGENT-MATRIX.md）。
 * why 做成函数而不是只在单测里写一遍：Electron 主进程启动时可以打一行自检日志，
 * 名单被改坏（加了新种类却忘了加进 DETECTABLE_AGENT_KINDS）时当场可见。
 */
export function verifyAgentRoster(
  targets: readonly AgentDetectionTarget[] = AGENT_DETECTION_TARGETS
): { readonly ok: boolean; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const kinds = new Set<string>();
  const binaries = new Set<string>();
  for (const target of targets) {
    if (kinds.has(target.kind)) problems.push(`kind 重复：${target.kind}`);
    if (binaries.has(target.binary)) problems.push(`binary 重复：${target.binary}`);
    kinds.add(target.kind);
    binaries.add(target.binary);
    if (!(DETECTABLE_AGENT_KINDS as readonly string[]).includes(target.kind)) {
      problems.push(`kind 不在契约词表内：${target.kind}`);
    }
  }
  for (const kind of DETECTABLE_AGENT_KINDS) {
    if (!kinds.has(kind)) problems.push(`名单缺少 kind：${kind}`);
  }
  return { ok: problems.length === 0, problems };
}
