/**
 * 文件职责：**会话自动起名的规则版实现**（@since v3.47，task_104 / v3.2b-B5）——
 *   把 2a 的起名规则收进「标题端口」的默认实现，并提供"起名素材"到"规则入参"的翻译。
 * 方案来源：docs/SESSION-PLAN.md §8「title provider 端口注入：默认规则实现（现截断逻辑迁入）」。
 * 输入：TitleSeed（起名素材）。
 * 输出：标题字符串（同步、确定性）。
 * 禁止事项：
 *   1. 碰网络 / 任何 IO —— 本文件是 core 纯逻辑；LLM 版起名在 app 层（llm-title-provider.ts）；
 *   2. 改起名规则的口径 —— 规则版是**默认行为**，无 env 配置时必须与 2a 逐字一致
 *      （验收项：无 env 配置时行为与 2a 完全一致）；
 *   3. 依赖 core 之外的层（app / hud / gateway）。
 *
 * 分层：types（契约：TitleSeed / TitleProvider）→ machine（纯逻辑：判相位 / 封事件）
 *   → title-provider（起名规则）→ manager（写 store + 上报 Notice）。
 *
 * @since v3.47，task_104（v3.2b-B5）。起名规则自 2a（task_091）起就在 machine.ts 里，
 *   本单按方案 §8 把它**迁入**本文件（规则的**内容一字未改**，只是住址变了 ——
 *   口径不变是硬要求：同一输入必须仍算出同一条标题）。
 */

import { capSessionTitle, normalizeSessionParticipants } from './machine';
import { MIN_SESSION_TITLE_LEN, type SessionKind, type TitleProvider, type TitleSeed } from './types';

/** 标题的 kind 前缀（决定会话是"角色对话"还是"互聊"——用户一眼要能分清）。 */
const KIND_LABEL: Record<SessionKind, string> = {
  character_chat: '角色对话',
  peer_chat: '互聊',
  task_run: '任务执行',
  mission_run: '任务单',
  shell_link: '命令行',
};

/**
 * kind 的默认短语：首条消息太短、或压根没有消息时兜底（保证标题落在 [12,20] 区间，
 * 且每种 kind 的兜底文案都自解释）。
 */
const KIND_DEFAULT_BODY: Record<SessionKind, string> = {
  character_chat: '与未命名角色的会话',
  peer_chat: '与未命名对象的会话',
  task_run: '未命名任务的执行记录',
  mission_run: '未命名任务单的运行记录',
  shell_link: '未命名连接的会话记录',
};

/** 压掉换行与连续空白：标题是单行文本，多行会把面板撑开。 */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * kind 的中文标签（对外给起名实现用 —— LLM 版要在 prompt 里说明"这是哪种会话"）。
 */
export function sessionKindLabel(kind: SessionKind): string {
  return KIND_LABEL[kind];
}

/**
 * 自动起名（2a 规则版）—— **纯函数、确定性、无 LLM**。
 *
 * 规则：`kind 前缀 + '：' + 主体`，整体截到 [12,20] 码点。
 *   主体优先取**首条消息**（首行、压空白）；没有首条消息时取参与者（用 '、' 连接）。
 *   两者都没有（或拼出来太短）→ 补 kind 的默认短语。
 *
 * why 要有下限 12：面板上一行放不下太短的标题，而"互聊：hi"这种标题用户看不出是什么会话；
 * why 要有上限 20：标题随 WorldState 全量广播，必须有界。
 * why 不用 LLM：2a 是规则版 —— 起名要可单测、可复现（同一个会话两次算出同一个标题），
 *   LLM 起名是 2b 的**可选**实现（env 配齐才启用，见 app/services/llm-title-provider.ts）。
 */
export function deriveSessionTitle(input: {
  readonly kind: SessionKind;
  readonly participants?: readonly string[];
  readonly firstMessage?: string;
}): string {
  const label = KIND_LABEL[input.kind];
  const fallback = KIND_DEFAULT_BODY[input.kind];
  const message = input.firstMessage ? collapseWhitespace(input.firstMessage) : '';
  const participants = (input.participants ?? []).filter((p) => p.length > 0).join('、');
  const body = message.length > 0 ? message : participants;

  let title = body.length > 0 ? `${label}：${body}` : `${label}：${fallback}`;
  // 主体太短 → 补默认短语（信息量不足的标题在界面上没有辨识度）。
  if (title.length < MIN_SESSION_TITLE_LEN) {
    title = `${label}：${body} · ${fallback}`;
  }
  return capSessionTitle(title);
}

/**
 * 起名素材里的**主体文本**（@since v3.47，task_104）——
 *   首条用户消息优先，没有就用任务标题，都没有就是空串（由规则版落到参与者兜底）。
 *
 * why 两个来源分开放：互聊的素材是"用户说的第一句话"，任务的素材是"任务指令"——
 *   它们在业务上是不同的东西（一个是对话，一个是派活），但对起名而言是同一类素材：
 *   "这轮会话在聊什么"。
 */
export function resolveTitleBodyText(seed: TitleSeed): string {
  const message = seed.firstUserMessage?.trim() ?? '';
  if (message.length > 0) return message;
  return seed.taskTitle?.trim() ?? '';
}

/**
 * 规则版起名实现（TitleProvider 端口的**默认**实现）——
 *   同步、确定性、无 IO；无 env 配置时这就是唯一生效的实现。
 *
 * why 参与者要先归一再算：建会话那一刻 manager 已把参与者归一过（去重 / 截断），
 *   这里再归一一次是为了让**任何**调用方（哪怕直接拿原始参与者来起名）算出的标题一致 ——
 *   同一场会话不该因为谁起的名而有两张面孔。
 */
export function createRulesTitleProvider(): TitleProvider {
  return {
    id: 'rules',
    generate(seed: TitleSeed): string {
      return deriveSessionTitle({
        kind: seed.kind,
        participants: normalizeSessionParticipants(seed.participants),
        firstMessage: resolveTitleBodyText(seed),
      });
    },
  };
}
