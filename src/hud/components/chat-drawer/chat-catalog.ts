/**
 * 文件职责：角色聊天抽屉的**会话状态与视图模型派生**（纯逻辑，零 DOM）——
 *   多角色会话存储（characterId → 独立消息数组）+ 流式缓冲（appendStream 增量 / finalize 收束）
 *   + 头部信息派生（角色名 / agent kind 徽标文案）。
 *   与 panels/chat-catalog.ts（外部 agent 会话，WorldState.links/messages 驱动、禁止本地回显）
 *   是两条不同的数据通道：本目录服务**本地角色对话**（点战场单位切上下文、transport 流式回显），
 *   消息真相由本存储持有（task_036 落库后改为加载历史回填，接口形状不变）。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 hud 层级 + task_034（transport 打桩，纯 UI 任务）。
 * 输入：会话操作（addMessage / appendStream / finalizeStream / setViewing）；WorldState.characters 快照。
 * 输出：CharacterChatSessions（可在 node 环境单测的会话存储）、resolveCharacterHeader（头部信息）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 chat-drawer.ts 的事；
 *   2. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   3. 直接调 core/bus —— 角色档案快照由组件经注入的 subscribe 回填进来，本文件只吃数据；
 *   4. 无上限增长 —— 每角色会话数组按 CHAT_SESSION_MESSAGE_CAP 截尾
 *      （perf 硬约束：数据不许无限增长；历史由 task_036 的 SQLite 负责，HUD 只留尾部）。
 *
 * @since v3.13（task_034）
 */

import type { CharacterView } from '../../../core/types';
import { agentKindLabel } from '../../screens/onboarding-catalog';

/** 消息角色词表。user = 本端说的；assistant = 角色 agent 回的（含流式收束后的整段）。 */
export type CharacterChatRole = 'user' | 'assistant';

/** 单条消息（已提交：流式缓冲 finalize 后也落到这个形状）。 */
export interface CharacterChatMessage {
  readonly id: string;
  readonly characterId: string;
  readonly role: CharacterChatRole;
  readonly text: string;
  /** 毫秒时间戳。 */
  readonly at: number;
}

/** addMessage 的入参形状：id / at 缺省由存储生成（测试可显式传入做确定性断言）。 */
export interface CharacterChatMessageInput {
  readonly characterId?: string;
  readonly role: CharacterChatRole;
  readonly text: string;
  readonly id?: string;
  readonly at?: number;
}

/**
 * 流式缓冲：一次 appendStream 会话的中间态。
 * why 绑定 characterId 而不是"当前查看的角色"：流属于**发言者**，不属于视图 ——
 * 用户中途切到别的角色会话，流仍在原角色名下增长，finalize 也归档到原角色（不串台）。
 * text 可变（增量追加），id 在流开始时即确定：finalize 复用同一个 id，
 * 气泡从"流式中"变成"已提交"时 id 不变（DOM 稳定，测试可断言）。
 */
export interface StreamBuffer {
  readonly characterId: string;
  readonly id: string;
  text: string;
}

/** 头部信息（组件头部渲染的全部输入）。 */
export interface CharacterHeaderInfo {
  readonly characterId: string;
  /** 展示名；档案缺失时回落到 id（id 是事实，不编造名字）。 */
  readonly name: string;
  /** agent kind 徽标文案；未绑定 / 未知时为 null（组件显示通用徽标）。 */
  readonly kindLabel: string | null;
}

/**
 * 每角色消息保留上限（perf 硬约束）。
 * 取值对齐契约的 MAX_AGENT_MESSAGES_PER_LINK=100（外部会话同款量级），
 * 不直接 import 那个常量：那是 agent-link 的契约上限，这里是 HUD 本地缓存的展示上限，
 * 语义不同（历史真相在 task_036 的 SQLite），耦合两个数值反而互相绑死。
 */
export const CHAT_SESSION_MESSAGE_CAP = 100;

/** kind 未绑定时的徽标文案（词表外回落见 resolveCharacterHeader）。 */
export const UNBOUND_KIND_LABEL = '未绑定';

/** 会话存储的可注入能力（测试注入确定性 id / 时间；生产用默认值）。 */
export interface ChatSessionStoreOptions {
  /** 每角色消息上限；缺省 CHAT_SESSION_MESSAGE_CAP。 */
  readonly cap?: number;
  /** 时间源；缺省 Date.now。 */
  readonly now?: () => number;
  /** 消息 id 源；缺省内部自增计数器。 */
  readonly nextId?: () => string;
}

/** 会话存储对外形状（组件与测试按它操作）。 */
export interface CharacterChatSessions {
  /** 当前查看的角色（纯展示态：正在看谁，不是业务状态）。 */
  readonly viewing: string | null;
  /** 活跃流缓冲；无流为 null。 */
  readonly stream: StreamBuffer | null;
  /** 出现过消息的角色 id（按首次发言顺序）。 */
  readonly characterIds: readonly string[];
  setViewing(characterId: string | null): void;
  /** 读某角色的已提交消息（时间正序，截尾后）；读零成本。 */
  messages(characterId: string): readonly CharacterChatMessage[];
  /**
   * 提交一条完整消息（user 气泡 / 非 UI 途径补录的 assistant 消息）。
   * characterId 缺省取当前查看的角色；无归属（两者皆空）或正文为空 → 返回 null 不落库。
   */
  addMessage(input: CharacterChatMessageInput): CharacterChatMessage | null;
  /**
   * 流式增量：已有活跃流 → 追加到该流（不论当前看谁）；
   * 无流 → 以"当前查看的角色"为归属新建（看不到角色就无处安放 → 返回 null 忽略）。
   */
  appendStream(chunk: string): StreamBuffer | null;
  /**
   * 收束活跃流为一条 assistant 消息（id 沿用流的 id）。
   * 正文为空 → 丢弃缓冲不落库（空气泡没有信息量）；无流 → no-op 返回 null。
   */
  finalizeStream(): CharacterChatMessage | null;
}

/**
 * 会话存储工厂（纯逻辑，无 DOM、无定时器 —— 演示假流在 demo-fake-stream.ts，别混进来）。
 */
export function createCharacterChatSessions(options: ChatSessionStoreOptions = {}): CharacterChatSessions {
  const cap = options.cap ?? CHAT_SESSION_MESSAGE_CAP;
  const now = options.now ?? (() => Date.now());
  let counter = 0;
  const nextId = options.nextId ?? ((): string => {
    counter += 1;
    return `cc-${counter}`;
  });

  const sessions = new Map<string, CharacterChatMessage[]>();
  const order: string[] = [];
  let viewing: string | null = null;
  let stream: StreamBuffer | null = null;

  const commit = (characterId: string, message: CharacterChatMessage): void => {
    const list = sessions.get(characterId) ?? [];
    if (!sessions.has(characterId)) order.push(characterId);
    list.push(message);
    // 截尾保尾巴（最新）：与外部会话同口径 —— 丢最旧的，"更早的未显示"由渲染层提示
    if (list.length > cap) list.splice(0, list.length - cap);
    sessions.set(characterId, list);
  };

  return {
    get viewing(): string | null { return viewing; },
    get stream(): StreamBuffer | null { return stream; },
    get characterIds(): readonly string[] { return [...order]; },

    setViewing(characterId: string | null): void {
      viewing = characterId;
    },

    messages(characterId: string): readonly CharacterChatMessage[] {
      return sessions.get(characterId) ?? [];
    },

    addMessage(input: CharacterChatMessageInput): CharacterChatMessage | null {
      const characterId = input.characterId ?? viewing;
      if (!characterId) return null;
      const text = input.text;
      if (text.length === 0) return null;
      const message: CharacterChatMessage = {
        id: input.id ?? nextId(),
        characterId,
        role: input.role,
        text,
        at: input.at ?? now(),
      };
      commit(characterId, message);
      return message;
    },

    appendStream(chunk: string): StreamBuffer | null {
      if (chunk.length === 0) return stream;
      if (stream) {
        stream = { ...stream, text: stream.text + chunk };
        return stream;
      }
      if (!viewing) return null;
      stream = { characterId: viewing, id: nextId(), text: chunk };
      return stream;
    },

    finalizeStream(): CharacterChatMessage | null {
      if (!stream) return null;
      const done = stream;
      stream = null;
      if (done.text.length === 0) return null;
      const message: CharacterChatMessage = {
        id: done.id,
        characterId: done.characterId,
        role: 'assistant',
        text: done.text,
        at: now(),
      };
      commit(done.characterId, message);
      return message;
    },
  };
}

/**
 * 派生头部信息：characterId → 名字 + kind 徽标文案。
 * 档案缺失（角色已被删 / 状态还没到）→ 名字回落 id、kind 为 null —— 不编造档案。
 * kindLabel 的词表来自 onboarding-catalog 的 AGENT_KIND_LABELS（词表即契约，单一真相源）。
 */
export function resolveCharacterHeader(
  characters: readonly CharacterView[],
  characterId: string | null
): CharacterHeaderInfo | null {
  if (!characterId) return null;
  const found = characters.find((c) => c.id === characterId);
  if (!found) return { characterId, name: characterId, kindLabel: null };
  return {
    characterId,
    name: found.name,
    kindLabel: found.agentKind ? agentKindLabel(found.agentKind) : null,
  };
}

/**
 * 发送闸门：草稿 trim 后非空才可发。
 * 返回 trim 后的正文（发出去的就是这个），空草稿返回 null（按钮 / Enter 两条路共用同一判定）。
 */
export function sendableDraft(draft: string): string | null {
  const text = draft.trim();
  return text.length > 0 ? text : null;
}
