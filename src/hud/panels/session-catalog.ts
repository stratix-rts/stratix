/**
 * 文件职责：**会话面板**（hud/panels/session-panel.ts）的纯逻辑层 —— 会话种类筛选 / 状态徽标 /
 *   行视图派生（标题截断、相对时间）/ 渲染签名 / 历史抽屉的**条目形状**与两路投影
 *   （任务单引用、命令行消息投影）。
 * 输入：core 的会话契约（core/types.ts 的 SessionRecord / SessionKind / SessionStatus / WorldState）。
 * 输出：面板直接消费的常量与纯函数（无 IO、无 DOM、无副作用）。
 * 禁止事项：
 *   1. import world/、gateway、phaser、任何 UI 库 —— 铁律；
 *   2. 在这里发命令 / 读存储 —— 命令由面板发（session.interrupt），历史由读取口读；
 *   3. 造数据 —— 没有就是没有（历史缺失要说"未附着"，不编一条出来充数）。
 *
 * why 单独成 catalog 文件（与 command-catalog / log-catalog 同一惯例）：
 *   面板只负责"把模型画成 Shadow DOM"，所有**可单测的判断**（能不能中断、筛出哪几条、
 *   标题怎么截、时间怎么写）都在这里 —— 单测不必起 DOM。
 *
 * @since v3.43（task_095 / v3.2a S5）；v3.47（task_101）补 canResume（可恢复续聊的判定）；
 *   v3.48（task_102）补 canFork（可分叉的判定）与历史条目的 seq（分叉入口要用的 atSeq）。
 */

import type {
  MissionPhase,
  SessionKind,
  SessionRecord,
  SessionStatus,
  WorldState,
} from '../../core/types';

/** 会话种类筛选档位：`'all'` = 全部（其余 = 五种 kind 之一）。 */
export type SessionKindFilter = 'all' | SessionKind;

/** 筛选筹码的一档（面板上的一个 chip）。 */
export interface SessionKindFilterSpec {
  readonly id: SessionKindFilter;
  readonly label: string;
}

/**
 * 筛选筹码表（全部 + 五种 kind，顺序 = 面板上的展示顺序）。
 * why 显式列出而不是从 kinds 数组推：kind 的**中文名**是产品口径（"编队"对 mission_run），
 *   顺序也是给人看的 —— 两者都该写死在一处，别让数组顺序意外变成 UI 顺序。
 */
export const SESSION_KIND_FILTERS: readonly SessionKindFilterSpec[] = [
  { id: 'all', label: '全部' },
  { id: 'character_chat', label: '聊天' },
  { id: 'peer_chat', label: '互聊' },
  { id: 'task_run', label: '任务' },
  { id: 'mission_run', label: '编队' },
  { id: 'shell_link', label: '连接' },
];

/** kind → 中文标签（面板上的 kind 徽标）。 */
const KIND_LABELS: Record<SessionKind, string> = {
  character_chat: '聊天',
  peer_chat: '互聊',
  task_run: '任务',
  mission_run: '编队',
  shell_link: '连接',
};

/** kind 的中文标签；词表外的值原样返回（不编一个像样的名字出来）。 */
export function kindLabel(kind: SessionKind): string {
  return KIND_LABELS[kind] ?? kind;
}

/** 状态 → 中文标签（面板上的状态徽标）。 */
const STATUS_LABELS: Record<SessionStatus, string> = {
  active: '进行中',
  idle: '空闲',
  interrupted: '已中断',
  closed: '已结束',
};

/** 状态的中文标签；词表外的值原样返回。 */
export function statusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * 这条会话现在能不能中断（行内「中断」钮的可见性）。
 * why 只有 active / idle：interrupted 与 closed 都是**不可再来一次**的相位 ——
 *   状态机会拒绝重复中断并回 Notice（core/session/machine.ts）。按钮点不动的事实，
 *   不该由用户点一次才知道。
 */
export function canInterrupt(record: SessionRecord): boolean {
  return record.status === 'active' || record.status === 'idle';
}

/**
 * 会话是否处于"可恢复提示"档（interrupted）。
 * why 单独一档：interrupted 的会话**不该**再给「中断」钮（重复中断必被拒），
 *   但该告诉用户"它断了、以后能续上"。
 * @since v3.47（task_101）：恢复按钮已上线（见 canResume），本档降级为**纯提示**。
 */
export function isResumableHint(record: SessionRecord): boolean {
  return record.status === 'interrupted';
}

/**
 * 这条会话现在能不能「恢复续聊」（行内「恢复」钮的可见性）。
 * why 两个条件都要：kind=peer_chat（第一期只做互聊 —— 方案 docs/SESSION-PLAN.md §8）
 *   + status=interrupted（只有断了的会话才谈得上续；active 的会话本来就在跑，
 *   给「恢复」钮等于让用户点出一个重复启动）。
 */
export function canResume(record: SessionRecord): boolean {
  return record.kind === 'peer_chat' && record.status === 'interrupted';
}

/**
 * 这条会话能不能「分叉」（历史抽屉里每条事件旁的「从这里分叉」入口的可见性）。
 *
 * why 第一期只认 peer_chat：分叉复制的是**对话事实**（消息 / 轮次 / 中断标记 ——
 *   core/session/context-replay.ts 的复制口径），而只有互聊会话的事件流里有这些。
 *   其余四类复制过去的是空：character_chat 的消息本体在 chat_messages 表（不在会话事件流里），
 *   task_run / mission_run 是任务实体的生命周期镜像（复制过去等于新建一条空会话），
 *   shell_link 是 agent-link 连接的投影（分叉连接没有意义）。
 *   给一个"点了必得到空壳"的按钮，比不给按钮更伤 —— 用户以为历史带过去了，其实没有。
 */
export function canFork(record: SessionRecord): boolean {
  return record.kind === 'peer_chat';
}

/**
 * 筛出可见会话（按筛选档过滤 + 最近活动的在前）。
 * why 排序按 lastEventAt 而不是 createdAt：会话是"正在进行的事"，用户找的是**刚动过的**那条。
 */
export function visibleSessions(
  records: readonly SessionRecord[] | undefined,
  filter: SessionKindFilter
): SessionRecord[] {
  const list = (records ?? []).filter((record) => filter === 'all' || record.kind === filter);
  return [...list].sort((a, b) => b.lastEventAt - a.lastEventAt || b.createdAt - a.createdAt);
}

/** 进行中（active）的条数（面板摘要用）。 */
export function activeCount(records: readonly SessionRecord[] | undefined): number {
  return (records ?? []).filter((record) => record.status === 'active').length;
}

/** 标题展示上限（码点）。超出截断并加省略号 —— 完整标题仍在 title 属性里。 */
export const SESSION_TITLE_DISPLAY_MAX = 24;

/** 截断标题（按码点切，中文不会被切半个字）。 */
export function truncateTitle(title: string, max: number = SESSION_TITLE_DISPLAY_MAX): string {
  const chars = Array.from(title);
  if (chars.length <= max) return title;
  return `${chars.slice(0, Math.max(1, max - 1)).join('')}…`;
}

/**
 * 相对时间（会话列表的"最近活动"）。
 * why 相对而不是绝对时刻：列表要的是"多久没动"，绝对时刻在扫视时没有信息量。
 * now 由调用方给（单测可断言，不依赖真实时钟）。
 */
export function formatRelativeTime(at: number, now: number): string {
  const diff = Math.max(0, now - at);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(at).toISOString().slice(0, 10);
}

/**
 * 渲染签名（判重用）：会话摘要 + 筛选档。
 * why 签名只吃摘要字段：事件本体不进 WorldState（core 铁律），摘要变了才值得重画列表。
 */
export function sessionsSignature(
  records: readonly SessionRecord[] | undefined,
  filter: SessionKindFilter
): string {
  const list = records ?? [];
  const ids = list
    .map((r) => `${r.id}:${r.status}:${r.title}:${r.lastEventAt}:${r.eventCount}`)
    .join('|');
  return `${filter}#${ids}`;
}

/**
 * 历史条目（抽屉里的一行）—— **已归一**的展示形状。
 * why 要归一：四路读取器各自的原始行形状差别极大（库行 / 事件信封 / 消息投影），
 *   面板只该认一种形状；翻译在读取口那侧做（app 层），面板只画。
 */
export interface SessionHistoryEntry {
  /** 行 id（同一抽屉内唯一；测试按它断言）。 */
  readonly id: string;
  /**
   * 翻页游标（**不透明**字符串）：本条之前的更早一页从哪儿接着读。
   * why 不透明：角色对话用消息 id、会话事件用 seq —— 两种游标语义不同，
   *   面板不该知道它们的区别，只负责把上一条的游标原样回传给读取口。
   */
  readonly cursor: string;
  /** 事件时刻（毫秒）。 */
  readonly at: number;
  /** 发言人 / 来源（角色名、事件类型名、"任务单"…）。 */
  readonly author: string;
  /** 正文。 */
  readonly text: string;
  /** 语气（普通 / 警示 / 错误）—— 决定行内配色。 */
  readonly tone: 'normal' | 'warn' | 'error';
  /**
   * 来源事件在会话内的序号（seq）—— 缺省 = 这条不是会话事件（角色对话消息没有 seq）。
   * why 需要它：抽屉里的「从这里分叉」入口要把 **atSeq = 该事件的 seq** 交给命令
   *   （分叉 = 复制到某条事件为止）。游标（cursor）不能拿来当 seq 用 ——
   *   角色对话那路的游标是消息 id，两种游标语义不同（见上面的 cursor 注）。
   */
  readonly seq?: number;
}

/**
 * 历史读取口（面板侧契约）。
 * 只有两路真 IO：角色对话历史（chat_messages 表）与会话事件流（session_events 表）。
 * why 另两路不占端口：任务单详情与命令行消息的真相**就在 WorldState 里**
 *   （mission 视图 / messages 投影），再走一遍 IO 就是多一份可能过期的真相。
 */
export interface SessionHistoryPort {
  /**
   * 角色对话历史（character_chat）。
   * @param characterId 角色 id（会话参与者）
   * @param limit 本页条数
   * @param before 更早一页的游标（缺省 = 取最近一页）
   */
  readonly loadCharacterChat?: (
    characterId: string,
    limit: number,
    before?: string
  ) => Promise<readonly SessionHistoryEntry[]>;
  /**
   * 会话事件流（peer_chat / task_run）。
   * @param sessionId 会话 id
   * @param limit 本页条数
   * @param before 更早一页的游标（缺省 = 取最近一页）
   */
  readonly loadSessionEvents?: (
    sessionId: string,
    limit: number,
    before?: string
  ) => Promise<readonly SessionHistoryEntry[]>;
}

/** 任务单相位 → 中文标签（任务单引用条目用）。 */
const MISSION_PHASE_LABELS: Record<MissionPhase, string> = {
  draft: '草稿',
  pending: '待确认',
  confirmed: '已确认',
  running: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

/** 任务单相位的中文标签；词表外的值原样返回。 */
export function missionPhaseLabel(phase: MissionPhase): string {
  return MISSION_PHASE_LABELS[phase] ?? phase;
}

/**
 * 任务单引用条目（mission_run 路）：**引用** WorldState.missions 里那条任务单，
 * 而不是把任务单内容搬进会话域（渐进迁移铁律：旧表不搬）。
 * 找不到那条任务单时如实说"不在当前世界状态里" —— 不编一条任务单详情出来。
 */
export function missionReferenceEntries(
  session: SessionRecord,
  state: WorldState | null
): SessionHistoryEntry[] {
  const refId = session.refId ?? '';
  const mission = refId ? state?.missions.find((m) => m.id === refId) ?? null : null;
  if (!mission) {
    return [
      {
        id: `${session.id}:mission-ref`,
        cursor: '',
        at: session.lastEventAt,
        author: '任务单',
        text: refId
          ? `任务单 ${refId} 的详情不在当前世界状态里`
          : '这条会话没有关联任务单',
        tone: 'warn',
      },
    ];
  }
  return [
    {
      id: `${session.id}:mission-ref`,
      cursor: '',
      at: mission.createdAt,
      author: '任务单',
      text: `「${mission.title}」· ${missionPhaseLabel(mission.phase)}`,
      tone: 'normal',
    },
  ];
}

/**
 * 命令行消息投影（shell_link 路）：会话的 refId / 参与者是那条 agent-link 的 linkId，
 * WorldState.messages 里同 linkId 的消息就是它的历史投影（不搬进会话域）。
 */
export function shellLinkEntries(
  session: SessionRecord,
  state: WorldState | null
): SessionHistoryEntry[] {
  const linkId = session.refId ?? session.participants[0] ?? '';
  if (!linkId) return [];
  return (state?.messages ?? [])
    .filter((message) => message.linkId === linkId)
    .map((message) => ({
      id: message.id,
      cursor: '',
      at: message.at,
      author: message.author,
      text: message.text,
      tone: 'normal' as const,
    }));
}
