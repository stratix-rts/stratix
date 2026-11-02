/**
 * 文件职责：cli-transport 模块的**对外出口** —— 上层只 import 这里。
 *   模块分层（自底向上）：
 *     transport.ts   词汇表与端口（CliAdapter / CliTransport / ProcessFactory）—— 纯类型 + 纯函数
 *     runtime.ts     进程生命周期（spawn / 读行 / 取消 / 杀树）—— 依赖注入的 ProcessFactory
 *     spawn-env.ts   spawn env 组装（STRATIX_CLI_ENV > 代理类透传）—— 纯函数（task_090）
 *     node-process.ts真实 child_process 工厂（生产用）+ 进程树 kill
 *     adapters/*     各家 CLI 的纯适配器（拼参数 + 解析一行）
 * 输入 / 输出：见各文件。
 * 禁止事项：
 *   1. 在这里做业务判断 —— 这里只做转发；
 *   2. 让上层直接 import adapters/ 内部文件 —— 出口只有一个。
 *
 * @since v3.8（task_023）
 */

export {
  createAdapter,
  verifyAdapterRoster,
  CLI_ADAPTER_FACTORIES,
  type CliAdapterOptions,
} from './adapters';

export { createClaudeAdapter, parseClaudeLine, type ClaudeAdapterOptions } from './adapters/claude';
export {
  createCustomAdapter,
  parseCustomJsonOutput,
  quoteSingle,
  renderCustomRunArgv,
  renderCustomRunCommandPreview,
  type CustomAgentAdapterSpec,
  type RenderedCustomRun,
} from './adapters/custom';
export { createCodexAdapter, parseCodexLine, type CodexAdapterOptions } from './adapters/codex';
export {
  createDshAdapter,
  parseDshLine,
  DSH_HEADLESS_PROFILE,
  DSH_PACKAGE_NAME,
  DSH_RUNNER_BINARY,
  type DshAdapterOptions,
} from './adapters/dsh';
export { createKimiAdapter, parseKimiOutput, parseKimiStderrLine, type KimiAdapterOptions } from './adapters/kimi';
export { createOpenclawAdapter, parseOpenclawOutput, type OpenclawAdapterOptions } from './adapters/openclaw';
export {
  createOpencodeAdapter,
  createTcpServeProbe,
  parseOpencodeLine,
  DEFAULT_SERVE_URL,
  type OpencodeAdapterOptions,
  type ServeProbe,
  type ServeProbeResult,
} from './adapters/opencode';

export {
  createNodeProcessFactory,
  killTree,
  type NodeProcessFactoryOptions,
} from './node-process';

export { createCliTransport, type CliTransportDeps } from './runtime';

export {
  assembleSpawnEnv,
  resolveSpawnEnv,
  CLI_ENV_JSON_VAR,
  PROXY_ENV_KEYS,
  type SpawnEnvAssembly,
  type SpawnEnvSources,
} from './spawn-env';

export {
  asArray,
  asRecord,
  asString,
  stderrTail,
  tryParseJson,
  MAX_STDERR_TAIL,
  type CliAdapter,
  type CliOutputMode,
  type CliProcessHandle,
  type CliTransport,
  type CliTransportKind,
  type ProcessFactory,
  type SpawnOptions,
  type TransportErrorCode,
  type TransportEvent,
} from './transport';

import type { AgentKind } from '../../../core/types';

import { createAdapter, type CliAdapterOptions, type CustomAgentAdapterSpec } from './adapters';
import { createCustomAdapter } from './adapters/custom';
import { createNodeProcessFactory } from './node-process';
import { createCliTransport } from './runtime';
import type { CliTransport, ProcessFactory } from './transport';

/**
 * 一站式造一个 transport（生产用）。
 * @param kind agent 种类（内置六家；自定义段走 createTransportForCustomAgent —— 那要注册行）
 * @param options adapter 参数（各家可选参数）
 * @param deps 子进程工厂（缺省用真实的 child_process 工厂；单测注入假工厂）
 */
export function createTransportFor(
  kind: AgentKind,
  options: CliAdapterOptions = {},
  deps: { readonly factory?: ProcessFactory; readonly logger?: (line: string) => void } = {}
): CliTransport {
  const adapter = createAdapter(kind, options);
  const factory = deps.factory ?? createNodeProcessFactory();
  return createCliTransport(adapter, { factory, logger: deps.logger });
}

/**
 * 按注册行造自定义 agent 的 transport（@since v3.32，task_056）。
 * 与 createTransportFor 同一 runtime（进程生命周期零重复）；adapter 换成按注册行
 * 模板动态构造的那只（见 adapters/custom.ts 文件头的安全边界注）。
 */
export function createTransportForCustomAgent(
  spec: CustomAgentAdapterSpec,
  deps: { readonly factory?: ProcessFactory; readonly logger?: (line: string) => void } = {}
): CliTransport {
  const adapter = createCustomAdapter(spec);
  const factory = deps.factory ?? createNodeProcessFactory();
  return createCliTransport(adapter, { factory, logger: deps.logger });
}
