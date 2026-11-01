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
 *   4. 新增消息按 CHAT_SESSION_MESSAGE_CAP 截尾；task_074 用户显式翻页加载的历史
 *      通过 prependMessages 保留已读页，不被后续新增消息的截尾规则立即截掉。
 *
 * ============ 互聊会话（task_052）============
 * role 词表扩 'peer'：**HUD 层**的消息角色 —— 互聊中「对方说的话」（A2A 服务的 B 侧流 /
 *   单角色历史回填解析出的 [peer:id] 前缀行）。注意它与 SQLite 的 role 词表是两回事：
 *   库表词表（user/assistant/system/error）不含 peer，peer 身份走 content 前缀约定（见 agent-chat-service
 *   文件头「落库约定」）；本文件的 'peer' 只活在内存会话与渲染层。system 用于失败事件历史行。
 * peerChatSessionId(a,b)：互聊双方的**联合会话** id（排序拼接，与发起顺序无关）——
 *   联合视图（同屏双方气泡）就是以它为 key 的一条普通会话；appendStreamAs 支持显式归属+角色
 *   开流（A2A 服务在用户切走视图时也要把流钉在联合会话上，不串台进个人会话）。
 *
 * @since v3.13（task_034）；v3.28（task_052）追加 peer 角色 / peerId / appendStreamAs / 联合会话 id。
 */

import type { CharacterView } from '../../../core/types';
import { agentKindLabel } from '../../screens/onboarding-catalog';

/**
 * 消息角色词表。user = 本端说的；assistant = 角色 agent 回的（含流式收束后的整段）。
 * system = 失败事件历史行（task_073），由抽屉渲染成居中弱化文本。
 * peer = **互聊中对方说的话**（@since v3.28，task_052）—— 联合会话里 B 的气泡（右侧变体）/
 *   单角色历史里解析出的对方发言（bubble 渲染带对方名字前缀）。它只活在 HUD 内存，不进库
 *   （peer 身份走 content 前缀，见 chat-history.ts 的翻译）。
 */
export type CharacterChatRole = 'user' | 'assistant' | 'peer' | 'system';

/** 单条消息（已提交：流式缓冲 finalize 后也落到这个形状）。 */
export interface CharacterChatMessage {
  readonly id: string;
  readonly characterId: string;
  readonly role: CharacterChatRole;
  readonly text: string;
  /** 毫秒时间戳。 */
  readonly at: number;
  /**
   * 错误气泡标记（@since v3.14，task_035）：transport 失败 / 超时时 assistant 气泡的错误态 ——
   * 组件按它渲染警示配色 + 「重试」按钮（重发由组合根桥接的 onRetry 驱动 chat-service）。
   * 可选增补：老调用点不带它照旧合法。
   */
  readonly error?: boolean;
  /**
   * peer 消息的对方角色 id（@since v3.28，task_052）：role='peer' 时由写入方给出（A2A 服务 /
   *   历史翻译），渲染层用它解析对方名字（「贝塔：……」）。其余 role 不带。
   */
  readonly peerId?: string;
}

/** addMessage 的入参形状：id / at 缺省由存储生成（测试可显式传入做确定性断言）。 */
export interface CharacterChatMessageInput {
  readonly characterId?: string;
  readonly role: CharacterChatRole;
  readonly text: string;
  readonly id?: string;
  readonly at?: number;
  /** 错误气泡标记（@since v3.14，task_035；语义见 CharacterChatMessage.error）。 */
  readonly error?: boolean;
  /** peer 消息的对方角色 id（@since v3.28，task_052；语义见 CharacterChatMessage.peerId）。 */
  readonly peerId?: string;
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
  /**
   * 流收束后的消息角色（@since v3.28，task_052）：普通聊天流恒 'assistant'（缺省）；
   *   互聊的 B 侧流开成 'peer'（A 侧仍是 'assistant'）—— finalize 按它落角色，A/B 气泡由此分侧。
   */
  readonly role: CharacterChatRole;
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

/**
 * 互聊联合会话 id（@since v3.28，task_052）：一对角色的专属会话 key（排序拼接 —— 同一对
 * 角色无论谁发起都是同一条联合会话，第二次互聊接着上次的气泡流）。前缀 'peer-chat:' 与
 * 真实 characterId 空间天然不冲突（防御上仍以组件侧 requestHistory 的守卫为准：
 * 联合 id 不走历史回填）。
 */
export function peerChatSessionId(aId: string, bId: string): string {
  return `peer-chat:${[aId, bId].sort().join('|')}`;
}

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
  /** 登记联合会话的 peer 对方角色 id（task_052；peer 流收束时补 peerId 用）。 */
  setPeerIdHint(jointId: string, peerId: string): void;
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
  /** 将已按时间正序排列的历史页插到会话前端，保留当前消息与流式缓冲。 */
  prependMessages(characterId: string, inputs: readonly CharacterChatMessageInput[]): void;
  /**
   * 流式增量：已有活跃流 → 追加到该流（不论当前看谁）；
   * 无流 → 以"当前查看的角色"为归属新建（看不到角色就无处安放 → 返回 null 忽略）。
   */
  appendStream(chunk: string): StreamBuffer | null;
  /**
   * 显式归属 + 角色的开流增量（@since v3.28，task_052；语义见实现处注）。互聊服务专用 ——
   *   普通聊天继续走 appendStream（缺省 assistant 角色、归属跟视图）。
   */
  appendStreamAs(owner: string, role: CharacterChatRole, chunk: string): StreamBuffer | null;
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
  /** 联合会话 → peer 消息的对方角色 id（task_052）：组件在进入互聊模式时登记，
   *   finalize peer 流时取来补 peerId（开流参数只有 owner+role，对方 id 从这里来）。 */
  const peerIdHints = new Map<string, string>();

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
    /** 登记联合会话的 peer 对方角色 id（task_052；见 peerIdHints 声明处说明）。 */
    setPeerIdHint(jointId: string, peerId: string): void {
      peerIdHints.set(jointId, peerId);
    },

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
        error: input.error,
        peerId: input.peerId,
      };
      commit(characterId, message);
      return message;
    },

    prependMessages(characterId: string, inputs: readonly CharacterChatMessageInput[]): void {
      const existing = sessions.get(characterId) ?? [];
      if (!sessions.has(characterId) && inputs.length > 0) order.push(characterId);
      const earlier = inputs.flatMap((input) => {
        if (input.text.length === 0) return [];
        return [{
          id: input.id ?? nextId(),
          characterId,
          role: input.role,
          text: input.text,
          at: input.at ?? now(),
          error: input.error,
          peerId: input.peerId,
        }];
      });
      sessions.set(characterId, [...earlier, ...existing]);
    },

    appendStream(chunk: string): StreamBuffer | null {
      if (chunk.length === 0) return stream;
      if (stream) {
        stream = { ...stream, text: stream.text + chunk };
        return stream;
      }
      if (!viewing) return null;
      stream = { characterId: viewing, id: nextId(), role: 'assistant', text: chunk };
      return stream;
    },

    /**
     * 显式归属 + 角色的开流（@since v3.28，task_052）：互聊服务用 —— 流钉死在联合会话上，
     * 不依赖「当前查看的角色」（用户旁听时切走视图，流也不能串进个人会话）。
     * 活跃流与 (owner, role) 一致 → 追加；不一致 → 先收束旧流（半截话不丢，按它自己的
     * 角色归档）再开新流（互聊回合严格串行，这里只防边路竞态）。
     */
    appendStreamAs(owner: string, role: CharacterChatRole, chunk: string): StreamBuffer | null {
      if (chunk.length === 0) return stream;
      if (stream && (stream.characterId !== owner || stream.role !== role)) {
        const stale = stream;
        stream = null;
        if (stale.text.length > 0) {
          commit(stale.characterId, { ...stale, at: now() });
        }
      }
      if (stream) {
        stream = { ...stream, text: stream.text + chunk };
        return stream;
      }
      stream = { characterId: owner, id: nextId(), role, text: chunk };
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
        role: done.role,
        text: done.text,
        at: now(),
        ...(done.role === 'peer' ? { peerId: peerIdHints.get(done.characterId) } : {}),
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
