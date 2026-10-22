/**
 * 文件职责：**adapter 注册表** —— agent 种类 → adapter 工厂。
 *   名单权威来源：docs/AGENT-MATRIX.md T1 五家（claude-code / codex / opencode / kimi / openclaw），
 *   与 core/types.ts 的 AGENT_KINDS 同词表（**不许各写一份**：检测器认的类型必须在这里有 adapter）。
 * 输入：agent 种类（+ 各自的可选参数）。
 * 输出：对应的 CliAdapter。
 * 禁止事项：
 *   1. 在这里写解析逻辑 —— 解析在各家自己的文件里；
 *   2. 加一种 core 不认的 agent —— 词表以 core/types.ts 为准。
 *
 * @since v3.8（task_023）
 */

import { AGENT_KINDS, type AgentKind } from '../../../../core/types';
import type { CliAdapter } from '../transport';

import { createClaudeAdapter, type ClaudeAdapterOptions } from './claude';
import { createCodexAdapter, type CodexAdapterOptions } from './codex';
import { createKimiAdapter, type KimiAdapterOptions } from './kimi';
import { createOpenclawAdapter, type OpenclawAdapterOptions } from './openclaw';
import { createOpencodeAdapter, type OpencodeAdapterOptions } from './opencode';

/** 每家 adapter 的可选参数（并集 —— 调用方按种类传自己关心的那部分）。 */
export type CliAdapterOptions = ClaudeAdapterOptions &
  CodexAdapterOptions &
  KimiAdapterOptions &
  OpenclawAdapterOptions &
  OpencodeAdapterOptions;

/** 种类 → adapter 工厂。 */
export const CLI_ADAPTER_FACTORIES: Readonly<Record<AgentKind, (options?: CliAdapterOptions) => CliAdapter>> = {
  'claude-code': (options) => createClaudeAdapter(options),
  codex: (options) => createCodexAdapter(options),
  opencode: (options) => createOpencodeAdapter(options),
  kimi: (options) => createKimiAdapter(options),
  openclaw: (options) => createOpenclawAdapter(options),
};

/**
 * 按种类造 adapter。
 * why 找不到就抛：种类来自 core 词表，走到这里还找不到 = 注册表与词表脱节（bug，不是用户错误）。
 */
export function createAdapter(kind: AgentKind, options: CliAdapterOptions = {}): CliAdapter {
  const factory = CLI_ADAPTER_FACTORIES[kind];
  if (!factory) throw new Error(`没有 ${kind} 的 adapter`);
  return factory(options);
}

/** 自检：注册表覆盖 core 的 AGENT_KINDS 全量（少一家 = 那家 agent 装了却没法对话）。 */
export function verifyAdapterRoster(): { readonly ok: boolean; readonly missing: readonly string[] } {
  const missing = AGENT_KINDS.filter((kind) => !CLI_ADAPTER_FACTORIES[kind]);
  return { ok: missing.length === 0, missing };
}
