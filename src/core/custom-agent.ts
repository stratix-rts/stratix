/**
 * 文件职责：**自定义 agent 注册的纯校验层**（task_056）—— 名字 / 探测命令 / 执行模板 /
 *   解析器选择的合法性裁决。词表与上限冻结在 core：注册表单（hud 向导 / 设置屏）、
 *   注册落库（主进程 IPC）、检测探测（app/agent-detector）三侧共用同一份口径，
 *   不许各写一套（一侧放行另一侧拒，用户就会看到"测试通过却注册不了"的鬼现象）。
 *
 * ============ 安全边界（task_056 规格①，本文件是第一道门）============
 * 自定义注册把"一条外部命令"接进执行链路，注入面必须封死在纯校验层：
 *   1. **模板白名单字符校验**：runCmdTemplate / probeCmd 只许
 *      `[A-Za-z0-9 _\-./:=@%+,]`（字母数字、空格、常见旗标与路径字符）。
 *      命令注入的全部载体 —— `;` `|` `&` `$( )` 反引号 `>` `<` `*` `?` 引号、反斜杠、换行 ——
 *      一个都不在白名单里；模板里**不可能**写出第二条命令或重定向。
 *   2. **占位符唯一**：runCmdTemplate 必须含恰好一个 `{prompt}`；`{`/`}` 不在白名单字符里，
 *      校验时先按 `{prompt}` 切分、再对两侧剩余段做白名单判定（`{foo}` 之类的花括号串进不来）。
 *   3. **执行侧双保险**（app/services/cli-transport/adapters/custom.ts，渲染时再验一遍）：
 *      执行走 **argv 直拼不经 shell**（prompt 作为单个参数元素原样进 argv），注入在构造上不存在；
 *      单引号包裹（quoteSingle）只用于**人可读的命令预览串**（向导弹窗 / 日志），那里才是引号语义的用武之地。
 *   4. **长度上限**：命令模板 / 探测命令 ≤ 200 字符、名字 ≤ 32 码点、注册条数 ≤ 16 ——
 *      注册串随 kind 拼进 WorldState 广播（perf：进状态的数据必须有界）。
 *
 * 输入：待注册草案（unknown 脏值可入，运行时类型裁决全在本文件）。
 * 输出：{ok:true, draft}（规范化的注册草案）或 {ok:false, code}（机器可读错误码）。
 * 禁止事项：
 *   1. IO / DB —— core 零 IO；注册表落库在 app/persistence/custom-agent-dao；
 *   2. 抛异常 —— 命令总线是同步的，一切失败走错误码；
 *   3. 认识 shell 语义 —— 本文件只判字符集与形状，"命令能不能跑通"是 probeCmd 的事。
 *
 * @since v3.32（task_056）。
 */

import type { WorldState } from './types';

// ============================================================================
// 词表与上限（契约级冻结常量）
// ============================================================================

/** 输出解析器词表：plain = 整段 stdout 当回答；json = 提取结构化字段（取不到降级 plain）。 */
export const CUSTOM_AGENT_OUTPUT_PARSERS = ['plain', 'json'] as const;

/** 输出解析器类型（词表元素）。 */
export type CustomAgentOutputParser = (typeof CUSTOM_AGENT_OUTPUT_PARSERS)[number];

/** 名字长度上限（按 Unicode 码点计，与角色名同一口径）。 */
export const MAX_CUSTOM_AGENT_NAME_LEN = 32;

/** 命令（探测 / 执行模板）长度上限。 */
export const MAX_CUSTOM_AGENT_CMD_LEN = 200;

/** 注册条数上限（why 有界：注册串拼 kind 随 WorldState 广播，perf 硬约束）。 */
export const MAX_CUSTOM_AGENTS = 16;

/** 注册 id（slug）长度上限。 */
export const MAX_CUSTOM_AGENT_ID_LEN = 32;

/**
 * 命令白名单字符集：字母数字、空格、`-` `_` `.` `/` `:` `=` `@` `%` `+` `,`。
 * why 放行这些：常见 CLI 的旗标（--flag / -f）、路径（./bin/foo / /usr/local/bin/foo）、
 *   值赋（--mode=fast / KEY:val）、常见占位（%s 不行但 % 允许出现在 URL/格式串）都在内。
 * why 一个都不多放：`;` `|` `&` `(` `)` 反引号 `$` `>` `<` `*` `?` `[` `]` `!` `#` `~` `^`
 *   `{` `}` `'` `"` `\\` 换行 —— 全是 shell 元字符或引号载体，注入面必须封死（见文件头）。
 */
const CUSTOM_AGENT_CMD_ALLOWED_RE = /^[A-Za-z0-9 _\-./:=@%+,]*$/;

/** 模板占位符（冻结常量：切分与校验共用一份，不许各抄字面量）。 */
export const CUSTOM_AGENT_PROMPT_PLACEHOLDER = '{prompt}';

// ============================================================================
// 注册草案与校验结果
// ============================================================================

/** 自定义 agent 注册草案（校验的输入；id 由名字派生，见 slugifyCustomAgentId）。 */
export interface CustomAgentDraft {
  readonly name: unknown;
  readonly probeCmd: unknown;
  readonly runCmdTemplate: unknown;
  readonly outputParser: unknown;
}

/** 校验通过后的规范化草案（注册落库的输入形状）。 */
export interface ValidCustomAgentDraft {
  /** trim 后的名字（显示名）。 */
  readonly name: string;
  /** 由名字派生的注册 id（slug）。 */
  readonly id: string;
  readonly probeCmd: string;
  readonly runCmdTemplate: string;
  readonly outputParser: CustomAgentOutputParser;
}

/** 校验错误码（机器可读；文案由调用侧映射，core 不绑 UI 语言）。 */
export type CustomAgentValidationCode =
  | 'empty-name'
  | 'name-too-long'
  | 'empty-id'
  | 'empty-probe-cmd'
  | 'cmd-too-long'
  | 'cmd-invalid-chars'
  | 'empty-template'
  | 'template-missing-prompt'
  | 'template-duplicate-prompt'
  | 'template-no-binary'
  | 'unknown-parser';

export type CustomAgentValidation =
  | { readonly ok: true; readonly draft: ValidCustomAgentDraft }
  | { readonly ok: false; readonly code: CustomAgentValidationCode };

/**
 * 名字 → 注册 id（slug）：小写化、非 [a-z0-9] 全折叠成 `-`、连字符去重、首尾去 `-`、截 32。
 * 中文 / 符号名折叠后可能为空 → 调用方按 empty-id 拒（提示"加个字母或数字"），
 * 不替用户编造 id（注册 id 会拼进 kind 字符串对外广播，编造就对不上号）。
 */
export function slugifyCustomAgentId(rawName: string): string {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_CUSTOM_AGENT_ID_LEN)
    .replace(/-+$/g, '');
}

/** 命令串（探测命令或模板剩余段）的白名单判定：空串与非法字符都算不过。 */
export function isAllowedCustomAgentCmd(cmd: string): boolean {
  if (cmd.length === 0) return false;
  if (cmd.length > MAX_CUSTOM_AGENT_CMD_LEN) return false;
  return CUSTOM_AGENT_CMD_ALLOWED_RE.test(cmd);
}

/**
 * 校验一份注册草案（纯函数、可穷举测试）。
 * 语义六条：
 *   1. 名字：trim 非空、≤ 32 码点；派生 id（slugifyCustomAgentId）非空；
 *   2. probeCmd：白名单字符、非空、≤ 200 字符（探测命令没有占位符，全串过白名单）；
 *   3. runCmdTemplate：按 `{prompt}` 切分后两侧剩余段各过白名单（花括号进不来）、
 *      恰好一个占位符、首段至少一个非空 token（得有可执行文件名）；
 *   4. outputParser：词表内（'plain' | 'json'）；
 *   5. 全部 trim 后判定（用户在表单里多打的空格不构成拒绝理由，但也不进库）；
 *   6. 被拒一律返回错误码，不抛异常。
 */
export function validateCustomAgentDraft(draft: CustomAgentDraft): CustomAgentValidation {
  // —— 名字 ——
  if (typeof draft.name !== 'string') return { ok: false, code: 'empty-name' };
  const name = draft.name.trim();
  if (name.length === 0) return { ok: false, code: 'empty-name' };
  if (Array.from(name).length > MAX_CUSTOM_AGENT_NAME_LEN) return { ok: false, code: 'name-too-long' };
  const id = slugifyCustomAgentId(name);
  if (id.length === 0) return { ok: false, code: 'empty-id' };

  // —— 探测命令（exit 0 = 在装；无占位符语义，整串白名单）——
  if (typeof draft.probeCmd !== 'string') return { ok: false, code: 'empty-probe-cmd' };
  const probeCmd = draft.probeCmd.trim();
  if (probeCmd.length === 0) return { ok: false, code: 'empty-probe-cmd' };
  if (probeCmd.length > MAX_CUSTOM_AGENT_CMD_LEN) return { ok: false, code: 'cmd-too-long' };
  if (!CUSTOM_AGENT_CMD_ALLOWED_RE.test(probeCmd)) return { ok: false, code: 'cmd-invalid-chars' };

  // —— 执行模板（恰好一个 {prompt}；两侧剩余段白名单）——
  if (typeof draft.runCmdTemplate !== 'string') return { ok: false, code: 'empty-template' };
  const template = draft.runCmdTemplate.trim();
  if (template.length === 0) return { ok: false, code: 'empty-template' };
  if (template.length > MAX_CUSTOM_AGENT_CMD_LEN) return { ok: false, code: 'cmd-too-long' };
  const segments = template.split(CUSTOM_AGENT_PROMPT_PLACEHOLDER);
  if (segments.length < 2) return { ok: false, code: 'template-missing-prompt' };
  if (segments.length > 2) return { ok: false, code: 'template-duplicate-prompt' };
  // 切掉占位符后的两侧剩余段：各自必须是白名单串（允许空段 —— {prompt} 可以在首/尾）。
  for (const segment of segments) {
    if (!CUSTOM_AGENT_CMD_ALLOWED_RE.test(segment)) return { ok: false, code: 'cmd-invalid-chars' };
  }
  // 首段得有可执行文件名（白名单串切分后首 token 非空）。
  if (segments[0]?.trim().length === 0) return { ok: false, code: 'template-no-binary' };

  // —— 解析器 ——
  if (
    typeof draft.outputParser !== 'string' ||
    !(CUSTOM_AGENT_OUTPUT_PARSERS as readonly string[]).includes(draft.outputParser)
  ) {
    return { ok: false, code: 'unknown-parser' };
  }

  return {
    ok: true,
    draft: { name, id, probeCmd, runCmdTemplate: template, outputParser: draft.outputParser as CustomAgentOutputParser },
  };
}

/**
 * 注册条数上限裁决（与 validateCustomAgentDraft 分开：条数要看注册表现状，是 IO 侧的事 ——
 * core 只提供常量与判据，查表在调用方）。返回 true = 还能再注册。
 */
export function canRegisterMoreCustomAgents(currentCount: number): boolean {
  return currentCount < MAX_CUSTOM_AGENTS;
}

/**
 * WorldState.characters 里是否还有绑定某个自定义注册的角色（删除注册的语义裁决：
 * 有角色仍绑着 → 删除注册只断检测，角色档案保留 —— 报告与提示按此措辞）。
 */
export function hasCharactersBoundToCustomKind(state: Pick<WorldState, 'characters'> | null, kind: string): boolean {
  if (!state?.characters) return false;
  return state.characters.some((character) => character.agentKind === kind);
}
