/**
 * 文件职责：状态屏的**视图模型派生**（纯逻辑，零 DOM、零依赖）—— 把一份 WorldState 派生成
 *   「四张核心指标卡 + 系统状态三项 + 最近事件列表」，UI 呈现全部在 status-screen.ts。
 *   词表与时间/级别文案复用 hud/panels/log-catalog（与日志抽屉同源，不另写一份）。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级（main / settings / character 之后的态势总览屏）。
 * 输入：WorldState 快照（只读）+ 两个本屏自测的观测量（总线广播时刻样本、首次观测时刻）。
 * 输出：StatusModel（渲染用模型）与 statusSignature（渲染判重签名）。
 * 禁止事项：
 *   1. 触碰 DOM —— 本文件必须能在 node 环境单测，渲染是 status-screen.ts 的事；
 *   2. import world/、vue、@/stratix-rts、core/bus —— 铁律，HUD 一律经注入的 adapter 收发；
 *   3. 在本地维护业务态 —— 每一个数都从 WorldState 现算，本屏一改就发命令等回广播；
 *   4. 编造状态 —— 契约里没有的量（见下「口径」各条）一律显示"没有/未知"，不猜不填；
 *   5. 修改 WorldState —— 本文件对 state 只读。
 *
 * ★ 四条口径（每个数凭什么这么数，写在这里免得后来者重新猜一套）：
 *   - 活跃任务 = **未收尾**的任务数（phase ∉ {done, cancelled}）。草稿与待确认都还是"活儿"，
 *     只数 confirmed/running 会让"发了 5 个任务、都在等确认"的态势显示成 0，那是假的；
 *     在办 / 待确认的细分放在 hint 里，两种读法都能拿到。
 *   - 进行中会话 = links 中 phase ∈ {connecting, connected, reconnecting}。
 *     idle / closing / closed 是非活动相位，不计入（closing 算"正在收尾"而不是"在跑"）。
 *   - 未读通知 = WorldState.notices 的条数，即 **core 仍持有的存活通知**（core 自己剔除过期）。
 *     契约里**没有**任何"已读/未读"字段（Notice 上没有读过没有的标记），所以这里如实按
 *     "core 手上还有几条"来念，不假装是一个已读未读系统 —— 想做已读要等 core 提供字段。
 *   - 总线活跃度 = 本屏订阅链在滑动窗口内**收到的投递次数**。它是 HUD 侧真实观测（每次
 *     adapter.subscribe 回调记一个时刻），不是 core 的内部计数；adapter 的重放（mount 后
 *     回放缓存快照）也算一次投递，这一点在这里写明，不假装"这一秒系统真的动了这么多次"。
 *   - 运行时长 = 自本屏**首次收到 state** 起算的观测时长。契约里没有进程启动时间戳，
 *     观测时长是唯一诚实的取值；组件负责把首次观测时刻传进来。
 */

import type { AgentLinkPhase, MissionPhase, NoticeLevel, UnitStatus, WorldState } from '../../core/types';
import { formatLogTime, levelLabel, sourceLabel } from '../panels/log-catalog';

// ============================================================================
// 容量与阈值（perf 硬约束：派生出来的每一份数据都有界，样本环形缓冲不许无限涨）
// ============================================================================

/** 最近事件最多渲染几条（notifications 在契约里已由 MAX_NOTICES 封顶，这里再收一道显示上限）。 */
export const MAX_STATUS_EVENTS = 10;

/** 总线活跃度的观测窗口：只统计最近这 60 秒内的投递。 */
export const BUS_WINDOW_MS = 60_000;

/**
 * 广播时刻样本的环形缓冲上限。
 * why 需要它：统计活跃度要记住"最近一段时间内每次投递的时刻"，不设界就随运行时长无限涨。
 * 取 64 ≫ 60s 窗口内的合理投递速率；写满时丢最旧的（超出窗口的最旧样本本就不参与统计）。
 */
export const MAX_BUS_SAMPLES = 64;

/** 窗口内投递次数达到这个值即判「活跃」。低于它但 >0 判「正常」，=0 判「静默」。 */
export const BUS_ACTIVE_THRESHOLD = 20;

// ============================================================================
// 渲染用模型
// ============================================================================

/** 语义色槽。组件据此挑 --srf-* 变量，色值本身不落在这里（与 log-catalog 的 tone 同一口径）。 */
export type StatusTone = 'ok' | 'busy' | 'warn' | 'error' | 'idle';

/** 指标卡 id 词表。渲染顺序即此数组顺序，不另排。 */
export const STATUS_METRIC_IDS = ['units', 'missions', 'sessions', 'notices'] as const;
export type StatusMetricId = (typeof STATUS_METRIC_IDS)[number];

export interface StatusMetric {
  readonly id: StatusMetricId;
  readonly label: string;
  readonly value: number;
  /** 副行说明（这个数是怎么来的 / 细分构成）。空字符串表示无可补充。 */
  readonly hint: string;
}

/** 四张卡，按 STATUS_METRIC_IDS 的 key 命名 —— 取值处不写 [0]/[1] 下标。 */
export type StatusMetrics = Record<StatusMetricId, StatusMetric>;

/** gateway 连接态：只认 agent-link 投影的相位，不做连接健康度的"推测"。 */
export interface ConnectionStatus {
  readonly tone: StatusTone;
  readonly label: string;
  /** 相位构成明细，如「已连接 2 · 连接中 1」。 */
  readonly detail: string;
  /** 各相位计数（键集合固定为 AgentLinkPhase 全集，缺失相位显式补 0，方便测试直接断言）。 */
  readonly counts: Readonly<Record<AgentLinkPhase, number>>;
  readonly total: number;
}

export interface BusStatus {
  readonly tone: StatusTone;
  readonly label: string;
  /** 如「近 60 秒 12 次投递」。 */
  readonly detail: string;
  readonly recentCount: number;
}

export interface UptimeStatus {
  readonly tone: StatusTone;
  readonly label: string;
  readonly value: string;
  readonly ms: number;
}

/** 最近事件行（紧凑形态：时间 / 级别 / 来源 / 正文，比日志抽屉少任务标签列）。 */
export interface StatusEventRow {
  readonly id: string;
  readonly at: number;
  readonly level: NoticeLevel;
  readonly levelLabel: string;
  readonly source: string;
  readonly text: string;
}

export interface StatusEvents {
  readonly rows: readonly StatusEventRow[];
  /** 未截断的通知总数（> rows.length 说明还有更早的没显示）。 */
  readonly total: number;
}

export interface StatusModel {
  readonly metrics: StatusMetrics;
  readonly connection: ConnectionStatus;
  readonly bus: BusStatus;
  readonly uptime: UptimeStatus;
  readonly events: StatusEvents;
}

// ============================================================================
// 相位 / 状态词表（判定口径集中一处，组件只念结论）
// ============================================================================

/** 计入「进行中会话」的相位。idle / closing / closed 不算 —— 见文件头口径。 */
const ACTIVE_LINK_PHASES: readonly AgentLinkPhase[] = ['connecting', 'connected', 'reconnecting'];

/** 计入「活跃任务」的相位（= 未收尾）。终态只有 done / cancelled。 */
const ACTIVE_MISSION_PHASES: readonly MissionPhase[] = ['draft', 'pending', 'confirmed', 'running'];

const METRIC_LABELS: Readonly<Record<StatusMetricId, string>> = {
  units: '单位总数',
  missions: '活跃任务',
  sessions: '进行中会话',
  notices: '未读通知',
};

// ============================================================================
// 派生：指标卡
// ============================================================================

/**
 * 四张指标卡。全部现算自 state，state 为 null（还没收到广播）时全部显示 0 并在 hint 里说明
 * 「等待世界状态」—— 不拿上一份数据冒充当前值。
 */
export function resolveMetrics(state: WorldState | null): StatusMetrics {
  const units = state?.units ?? [];
  const missions = state?.missions ?? [];
  const links = state?.links ?? [];
  const notices = state?.notices ?? [];

  const unitStatusCount = (status: UnitStatus): number =>
    units.filter((unit) => unit.status === status).length;

  const missionPhaseCount = (phases: readonly MissionPhase[]): number =>
    missions.filter((mission) => phases.includes(mission.phase)).length;

  const unitParts: string[] = [];
  const busy = unitStatusCount('busy');
  const errUnits = unitStatusCount('error');
  const offline = unitStatusCount('offline');
  if (busy > 0) unitParts.push(`忙碌 ${busy}`);
  if (errUnits > 0) unitParts.push(`异常 ${errUnits}`);
  if (offline > 0) unitParts.push(`离线 ${offline}`);
  if (unitParts.length === 0) unitParts.push(state ? '全部空闲' : '等待世界状态');

  const missionParts: string[] = [];
  const working = missionPhaseCount(['confirmed', 'running']);
  const awaiting = missionPhaseCount(['pending']);
  const done = missionPhaseCount(['done']);
  missionParts.push(`在办 ${working}`, `待确认 ${awaiting}`);
  if (done > 0) missionParts.push(`已完成 ${done}`);

  const connectedCount = links.filter((link) => link.phase === 'connected').length;
  const activeLinks = links.filter((link) => ACTIVE_LINK_PHASES.includes(link.phase)).length;
  const linkErrors = links.filter((link) => link.phase === 'error').length;

  const sessionParts: string[] = [];
  if (connectedCount > 0) sessionParts.push(`已连接 ${connectedCount}`);
  if (activeLinks - connectedCount > 0) sessionParts.push(`连接中 ${activeLinks - connectedCount}`);
  if (linkErrors > 0) sessionParts.push(`异常 ${linkErrors}`);
  if (sessionParts.length === 0) sessionParts.push(state ? '暂无会话' : '等待世界状态');

  const warnCount = notices.filter((n) => n.level === 'warn').length;
  const errorCount = notices.filter((n) => n.level === 'error').length;
  const noticeHint = notices.length === 0
    ? (state ? '暂无通知' : '等待世界状态')
    : `警告 ${warnCount} · 错误 ${errorCount}`;

  return {
    units: { id: 'units', label: METRIC_LABELS.units, value: units.length, hint: unitParts.join(' · ') },
    missions: {
      id: 'missions',
      label: METRIC_LABELS.missions,
      value: missionPhaseCount(ACTIVE_MISSION_PHASES),
      hint: missionParts.join(' · '),
    },
    sessions: {
      id: 'sessions',
      label: METRIC_LABELS.sessions,
      value: activeLinks,
      hint: sessionParts.join(' · '),
    },
    notices: { id: 'notices', label: METRIC_LABELS.notices, value: notices.length, hint: noticeHint },
  };
}

// ============================================================================
// 派生：系统状态
// ============================================================================

/**
 * gateway 连接态：把 links 的相位压成一个总态。
 * 优先级自上而下（异常 > 连接中 > 已连接 > 非活动），why 这么排：
 *   有一条 error 就该让人先看见它，而不是被别的会话"已连接"盖住；
 *   连接中/重连是过渡态，压过已连接是对的（正卡在握手上正是用户要知道的）；
 *   全都 idle / closed / closing 时如实说"没有活动会话"，不美化也不报错。
 */
export function resolveConnection(state: WorldState | null): ConnectionStatus {
  const links = state?.links ?? [];
  const counts: Record<AgentLinkPhase, number> = {
    idle: 0,
    connecting: 0,
    connected: 0,
    reconnecting: 0,
    closing: 0,
    closed: 0,
    error: 0,
  };
  for (const link of links) counts[link.phase] += 1;

  const detailParts: string[] = [];
  if (counts.connected > 0) detailParts.push(`已连接 ${counts.connected}`);
  if (counts.connecting > 0) detailParts.push(`连接中 ${counts.connecting}`);
  if (counts.reconnecting > 0) detailParts.push(`重连中 ${counts.reconnecting}`);
  if (counts.error > 0) detailParts.push(`异常 ${counts.error}`);
  if (counts.closing > 0) detailParts.push(`关闭中 ${counts.closing}`);
  if (counts.closed > 0) detailParts.push(`已关闭 ${counts.closed}`);
  if (counts.idle > 0) detailParts.push(`空闲 ${counts.idle}`);

  const tone: StatusTone = !state
    ? 'idle'
    : links.length === 0
      ? 'idle'
      : counts.error > 0
        ? 'error'
        : counts.connecting + counts.reconnecting > 0
          ? 'busy'
          : counts.connected > 0
            ? 'ok'
            : 'idle';

  const label = !state
    ? '等待世界状态'
    : links.length === 0
      ? '未连接'
      : counts.error > 0
        ? '连接异常'
        : counts.connecting + counts.reconnecting > 0
          ? '连接中'
          : counts.connected > 0
            ? '已连接'
            : counts.closing > 0
              ? '关闭中'
              : '未连接';

  return {
    tone,
    label,
    detail: detailParts.length > 0 ? detailParts.join(' · ') : '暂无会话',
    counts,
    total: links.length,
  };
}

/** 追加一个广播时刻样本，返回新的样本数组（环形封顶，见 MAX_BUS_SAMPLES）。纯函数，便于单测。 */
export function pushBusSample(samples: readonly number[], at: number): readonly number[] {
  const next = [...samples, at];
  return next.length > MAX_BUS_SAMPLES ? next.slice(next.length - MAX_BUS_SAMPLES) : next;
}

/** 总线活跃度：数窗口内（now - BUS_WINDOW_MS, now] 的投递样本。窗口外的样本直接不算，不做近似。 */
export function summarizeBus(
  samples: readonly number[],
  now: number,
  windowMs: number = BUS_WINDOW_MS,
): BusStatus {
  const from = now - windowMs;
  const recent = samples.filter((at) => at > from && at <= now).length;
  const tone: StatusTone = recent === 0 ? 'idle' : recent >= BUS_ACTIVE_THRESHOLD ? 'busy' : 'ok';
  const label = recent === 0 ? '静默' : recent >= BUS_ACTIVE_THRESHOLD ? '活跃' : '正常';
  const seconds = Math.round(windowMs / 1000);
  return {
    tone,
    label,
    detail: `近 ${seconds} 秒 ${recent} 次投递`,
    recentCount: recent,
  };
}

/**
 * 时长格式化：固定「X 小时 Y 分」「Y 分 Z 秒」，不用 toLocale（单测要稳定，且扫一眼不需要全量精度）。
 * 输入非法（负数 / 非有限）统一回落到 '--'，不显示 "NaN 分"。
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (hours > 0) return `${hours} 小时 ${pad(minutes)} 分`;
  if (minutes > 0) return `${minutes} 分 ${pad(seconds)} 秒`;
  return `${seconds} 秒`;
}

/**
 * 运行时长（观测时长）。
 * @param observedSince 本屏首次收到 WorldState 的时刻；null = 还没收到过状态，如实显示「--」。
 * why 观测而不查"进程启动时间"：契约里没有这个字段（HUD 也不该去猜），观测时长是唯一诚实的取值。
 */
export function resolveUptime(observedSince: number | null, now: number): UptimeStatus {
  if (observedSince === null) {
    return { tone: 'idle', label: '运行时长', value: '--', ms: 0 };
  }
  const ms = Math.max(0, now - observedSince);
  return { tone: ms > 0 ? 'ok' : 'idle', label: '运行时长', value: formatDuration(ms), ms };
}

// ============================================================================
// 派生：最近事件（与日志抽屉同源 notices，紧凑形态）
// ============================================================================

/**
 * 最近事件 = 当前 notices 里最新的 MAX_STATUS_EVENTS 条（倒序：最新在前）。
 * 与 log-drawer 的关键差异（不是 bug，是两种形态）：抽屉是**累积**视图（条目留在本地环缓冲里，
 * 6 秒过期后仍可翻查），而状态屏是**当前态势**快照 —— core 剔除过期通知后，这里也自然跟着消失。
 * 时间与级别文案直接复用 log-catalog 的工具函数，两侧不各写一份格式。
 */
export function resolveStatusEvents(state: WorldState | null): StatusEvents {
  const notices = state?.notices ?? [];
  const rows: StatusEventRow[] = [...notices]
    .sort((a, b) => (b.createdAt - a.createdAt) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    .slice(0, MAX_STATUS_EVENTS)
    .map((notice) => ({
      id: notice.id,
      at: notice.createdAt,
      level: notice.level,
      levelLabel: levelLabel(notice.level),
      // source 未标注（Notice.source 是 @since v3.4 的可选增补）时回落到通用来源文案，不编造来源。
      source: notice.source ?? sourceLabel('notice'),
      text: notice.text,
    }));

  return { rows, total: notices.length };
}

/**
 * 组装渲染模型。观测量的来源在组件里（本屏自己记的投递时刻与首次观测时刻），本函数只做拼装。
 * @param now            当前时刻（组件传 Date.now()，单测传固定值 → 可确定性断言）
 * @param busSamples     订阅链的广播时刻样本（环形，见 pushBusSample）
 * @param observedSince  首次收到 state 的时刻；null = 还没收到过
 */
export function resolveStatusModel(
  state: WorldState | null,
  now: number,
  busSamples: readonly number[] = [],
  observedSince: number | null = null,
): StatusModel {
  return {
    metrics: resolveMetrics(state),
    connection: resolveConnection(state),
    bus: summarizeBus(busSamples, now),
    uptime: resolveUptime(observedSince, now),
    events: resolveStatusEvents(state),
  };
}

// ============================================================================
// 渲染签名（perf：core 每次状态变更都全量广播，无关变动不该触发本屏重绘）
// ============================================================================

/**
 * 判重签名：只覆盖**指标卡 + 连接态 + 事件列表**所依赖的状态字段。
 *   - units   : id + status（hint 只念忙碌/异常/离线）
 *   - missions: id + phase（活跃/在办/待确认/已完成都按相位算）
 *   - links   : id + phase（连接态只压相位）
 *   - notices : id + level + createdAt + source + text（事件行就是这几项）
 * 选中集、角色档案、消息流、偏好不进签名 —— 本屏不显示它们，变了也不该重绘。
 * 总线活跃度与运行时长按秒自走（组件 tick），不进签名，否则每次投递都会强制重绘整屏。
 */
export function statusSignature(state: WorldState | null): string {
  if (!state) return 'none';
  const units = state.units.map((u) => `${u.id}~${u.status}`).join(',');
  const missions = state.missions.map((m) => `${m.id}~${m.phase}`).join(',');
  const links = state.links.map((l) => `${l.id}~${l.phase}`).join(',');
  const notices = state.notices
    .map((n) => `${n.id}~${n.level}~${n.createdAt}~${n.source ?? ''}~${n.text}`)
    .join(',');
  return `u:${units}|m:${missions}|l:${links}|n:${notices}`;
}

/** 事件行的行时间文案（复用日志抽屉的固定格式，两侧显示同一时刻就得到同一串字符）。 */
export const formatEventTime = formatLogTime;