/**
 * 文件职责：**@会话引用**（core/session —— v3.2b-B8 / task_107）的**纯逻辑**——
 *   ① 解析输入里的 `@session_<id>` 语法（0 个 / 1 个 / 多个；非法 token 单列，不静默吞掉）；
 *   ② 把被引用会话的近期内容拼成**注入块**（【引用会话 <title>(<id>) 摘要/时间线】…）。
 * 方案来源：docs/SESSION-PLAN.md §8「@会话引用」。
 * 输入：一段自由文本（互聊议题 / 任务指令）/ 若干条「会话摘要 + 近期事件」。
 * 输出：解析结果（id 列表 + 非法 token）/ 注入块字符串。
 * 禁止事项：
 *   1. 碰存储 / store / 数据库 —— 本文件只算字符串（**零 IO**：不读库、不查会话是否存在）；
 *   2. 判定会话**存在与否** —— 那是 app 层服务的事（存在性要查真相源，core 不碰 IO）；
 *   3. 自己决定「读多少条」 —— 读多少是调用方（app 层读口）的口径，本文件只渲染拿到的事件；
 *   4. 抛异常 —— 输入不可信（用户随手打的字符），一切异常输入都降级成「没解析出引用」或「非法 token」。
 *
 * ★ 为什么解析与渲染都住在 core：两个入口（互聊议题 / 任务指令）要的是**同一份**口径 ——
 *   同一段文本在两处必须解析出同一个结果（两份实现必然漂移：改了一处忘了另一处，
 *   于是出现「互聊能引用、任务不能」这种诡异不一致）。
 *
 * @since v3.49（task_107 / v3.2b-B8）。
 */

import type { SessionEventView, SessionRecord } from './types';

/** 引用语法的前缀（用户写的就是它 + 会话 id）。 */
export const SESSION_REFERENCE_PREFIX = '@session_';

/**
 * 一次输入里最多引用几个会话。
 * why 有上限：每个引用都要读一段事件并拼进 prompt —— 无上限 = prompt 无界（性能铁律：注入必须有界）。
 * 超限**如实报错**（不静默截断）：悄悄丢掉用户明确要的引用，比报错更坏。
 */
export const SESSION_REFERENCE_MAX_TARGETS = 5;

/**
 * 被引用会话 id 的长度上限（码点）。
 * why 128：core 的会话 id 形如 `session_peer_chat_1762156800000_3`（约 33 字），128 绰绰有余；
 *   再长就是异常输入（防御：超长 token 不进事件载荷、不进 prompt）。
 */
export const SESSION_REFERENCE_MAX_ID_LEN = 128;

/**
 * 注入块里**近期原文**的条数上限（每条被引用的会话各算一份）。
 * why 20：够读懂「刚才那段对话在讲什么」，又不至于把 prompt 撑爆
 *   （与压缩路由的保留窗是两层不同的口径：那里管"库里留多少"，这里管"喂多少"）。
 */
export const SESSION_REFERENCE_MAX_EVENTS = 20;

/** 时间线里**单行**文本的长度上限（码点）。 */
export const SESSION_REFERENCE_MAX_TEXT_LEN = 120;

/** 单条被引用会话的注入段长度上限（码点）。 */
export const SESSION_REFERENCE_MAX_SECTION_LEN = 1200;

/** 整个注入块的长度上限（码点）—— 多个引用叠加时以它封顶。 */
export const SESSION_REFERENCE_MAX_BLOCK_LEN = 4000;

/** 解析结果：解析出的会话 id（保序去重）+ 非法 token（原文照抄，便于回话给用户）。 */
export interface SessionReferenceParseResult {
  /** 解析出的会话 id（按出现顺序，去重）。 */
  readonly ids: readonly string[];
  /** 非法的引用 token（如 `@session_` 后面没跟 id）。 */
  readonly invalid: readonly string[];
}

/** 一条被引用会话的素材：会话摘要（标题）+ 近期事件（读路由产物）。 */
export interface SessionReferenceSource {
  /** 被引用会话的摘要（标题 / 种类 / 参与者）。 */
  readonly session: SessionRecord;
  /** 被引用会话的近期事件（seq 正序；读路由给的「摘要 + 近期原文」）。 */
  readonly events: readonly SessionEventView[];
}

/** 引用 token 的匹配（会话 id 的字符集：字母 / 数字 / 下划线 / 连字符）。 */
const REFERENCE_TOKEN = /@session_([A-Za-z0-9_-]*)/g;

/**
 * 解析输入里的 @会话引用。
 *
 * 口径：
 *   - `@session_<id>` → 一个引用（id 允许字母 / 数字 / 下划线 / 连字符）；
 *   - `@session_` 后面没跟合法 id → **非法 token**（单列，不当成引用也不当成普通文本）；
 *   - `@` 前面是词字符（字母 / 数字 / 下划线）→ **不算引用**（那是邮箱 / 标识符的一部分，
 *     例如 `a@session_x` —— 把它当引用会去查一条叫 `a@session_x` 的会话，误导用户）；
 *   - 同一个 id 出现多次 → 只留一次（保序）。
 *
 * @param text 自由文本（互聊议题 / 任务指令 / 插话……）。
 */
export function parseSessionReferences(text: string): SessionReferenceParseResult {
  const ids: string[] = [];
  const invalid: string[] = [];
  if (!text) return { ids, invalid };
  const seen = new Set<string>();
  REFERENCE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null = REFERENCE_TOKEN.exec(text);
  while (match !== null) {
    const start = match.index;
    const raw = match[1] ?? '';
    // 边界：@ 前面不能是词字符（否则不是引用）。
    if (start > 0 && isWordChar(text.charAt(start - 1))) {
      match = REFERENCE_TOKEN.exec(text);
      continue;
    }
    if (raw.length === 0) {
      // `@session_` 光杆：写法不完整 → 记成非法 token（回话给用户，别当没看见）。
      if (!invalid.includes(SESSION_REFERENCE_PREFIX)) invalid.push(SESSION_REFERENCE_PREFIX);
    } else if (raw.length > SESSION_REFERENCE_MAX_ID_LEN) {
      const shown = `${SESSION_REFERENCE_PREFIX}${raw.slice(0, SESSION_REFERENCE_MAX_ID_LEN)}…`;
      if (!invalid.includes(shown)) invalid.push(shown);
    } else if (!seen.has(raw)) {
      seen.add(raw);
      ids.push(raw);
    }
    match = REFERENCE_TOKEN.exec(text);
  }
  return { ids, invalid };
}

/**
 * 把被引用会话的近期内容拼成**注入块**（进 agent 上下文头部）。
 *
 * 格式（方案 §8 的「标记「引用会话 X」」）：
 *   【引用会话 <title>(<id>)】
 *   摘要：……            ← 该会话折叠过（有压缩摘要事件）时才有
 *   时间线：            ← 有近期原文时才有
 *   - 11-02 15:32 用户：……
 *
 * why 摘要与时间线**并存**：压缩摘要讲的是「折叠掉的那段老历史」，近期原文讲的是「刚才发生了什么」——
 *   只给摘要会丢掉当下，只给原文会丢掉长会话的骨架。
 * why 每段都带标题与 id：agent 看到的是「哪场会话的哪部分」，不是一段来路不明的文字。
 *
 * @param sources 被引用会话的素材（读口给什么就渲染什么 —— 不编造没读到的事件）。
 * @returns 注入块；没有素材时返回空串（调用方据此不拼前缀）。
 */
export function buildSessionReferenceBlock(sources: readonly SessionReferenceSource[]): string {
  if (sources.length === 0) return '';
  const sections: string[] = [];
  for (const source of sources) {
    const section = buildSection(source);
    if (section.length > 0) sections.push(section);
  }
  if (sections.length === 0) return '';
  const block = sections.join('\n\n');
  if (block.length <= SESSION_REFERENCE_MAX_BLOCK_LEN) return block;
  // 超长 → 截尾并**明说**截了（截断是显式的：agent 得知道上下文不全）。
  // why 截位要给提示语**留出长度**：否则"截断后的块"反而比上限还长（上限是硬约束）。
  return truncateWithNote(block, SESSION_REFERENCE_MAX_BLOCK_LEN, '…（引用内容过长，已截断）');
}

/**
 * 截断并**明说**截了（提示语的长度从上限里扣 —— 截完的成品必须 ≤ 上限）。
 *
 * @param text 原文。
 * @param max 上限（码点）。
 * @param note 截断提示语。
 */
function truncateWithNote(text: string, max: number, note: string): string {
  if (text.length <= max) return text;
  const keep = Math.max(0, max - note.length);
  return `${text.slice(0, keep)}${note}`;
}

/** 单条被引用会话的注入段（头 + 摘要 + 时间线）。 */
function buildSection(source: SessionReferenceSource): string {
  const header = `【引用会话 ${source.session.title}(${source.session.id})】`;
  const lines: string[] = [header];

  const summary = describeCompressedSummary(source.events);
  if (summary.length > 0) lines.push(`摘要：${summary}`);

  const timeline = buildTimeline(source.events);
  if (timeline.length > 0) {
    lines.push('时间线：');
    lines.push(...timeline);
  }
  const section = lines.join('\n');
  if (section.length <= SESSION_REFERENCE_MAX_SECTION_LEN) return section;
  return truncateWithNote(section, SESSION_REFERENCE_MAX_SECTION_LEN, '…（本段引用已截断）');
}

/**
 * 时间线：最近若干条**原文**事件（压缩摘要事件本身不占行 —— 它已单列成「摘要」）。
 * why 取最近的：引用者的意图是「把刚才那段接上」，不是重放整场会话。
 */
function buildTimeline(events: readonly SessionEventView[]): string[] {
  const raw = events.filter((event) => event.type !== 'compressed' && event.type !== 'created');
  const recent = raw.slice(Math.max(0, raw.length - SESSION_REFERENCE_MAX_EVENTS));
  const lines: string[] = [];
  for (const event of recent) {
    const text = describeSessionEvent(event);
    if (text.length === 0) continue;
    lines.push(`- ${formatEventTime(event.createdAt)} ${text}`);
  }
  const dropped = raw.length - recent.length;
  if (dropped > 0) lines.push(`- （更早的 ${dropped} 条事件未注入）`);
  return lines;
}

/**
 * 压缩摘要 → 一行人话（**防御式解析**：读面不校验载荷形状，脏行不能炸掉整块）。
 *
 * 口径与 core/session/compress.ts 的规则版摘要同源：轮次 / 参与者 / 首末摘要 / 关键事件。
 */
function describeCompressedSummary(events: readonly SessionEventView[]): string {
  // 取**最后**一条摘要（折叠是逐段追加的，最后一条覆盖的范围最新）。
  let latest: Record<string, unknown> | null = null;
  for (const event of events) {
    if (event.type !== 'compressed') continue;
    const record = asRecord(event.payload);
    if (record) latest = record;
  }
  if (!latest) return '';
  const parts: string[] = [];
  const rounds = toInt(latest.rounds);
  if (rounds !== null && rounds > 0) parts.push(`共 ${rounds} 轮`);
  const participants = toStringArray(latest.participants);
  if (participants.length > 0) parts.push(`参与者：${participants.join('、')}`);
  const first = toText(latest.firstSummary);
  if (first.length > 0) parts.push(`起：${first}`);
  const last = toText(latest.lastSummary);
  if (last.length > 0) parts.push(`止：${last}`);
  const keyEvents = toStringArray(latest.keyEvents);
  if (keyEvents.length > 0) parts.push(`关键事件：${keyEvents.join('；')}`);
  const summary = parts.join('，');
  return capText(summary, SESSION_REFERENCE_MAX_TEXT_LEN * 2);
}

/** 事件 → 时间线上的一行人话（按事件类型取最有信息量的那段文本）。 */
function describeSessionEvent(event: SessionEventView): string {
  const payload = asRecord(event.payload);
  const text = (key: string): string => (payload ? toText(payload[key]) : '');
  switch (event.type) {
    case 'message':
      return `${text('author') || '未知'}：${capText(text('text'), SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'round':
      return `一轮结束：${capText(text('summary') || '（无摘要）', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'interrupt':
      return `中断：${capText(text('reason') || '会话被中断', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'resumed':
      return `恢复：${capText(text('note') || '会话已恢复', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'closed':
      return `收尾：${capText(text('reason') || '会话结束', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'forked':
      return `分叉自 ${text('sourceSessionId') || '（未知来源）'}`;
    case 'task_started':
      return `任务开始：${capText(text('summary') || '任务开始', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'step':
      return `步骤：${capText(text('label') || '关键节点', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'output_tail':
      return `输出：${capText(text('text'), SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'completed':
      return `完成：${capText(text('summary') || '任务完成', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'failed':
      return `失败：${capText(text('reason') || '任务失败', SESSION_REFERENCE_MAX_TEXT_LEN)}`;
    case 'reference':
      return `引用会话 ${text('targetSessionId') || '（未知）'}`;
    default:
      return capText(`${event.type} 事件`, SESSION_REFERENCE_MAX_TEXT_LEN);
  }
}

/** 时间戳 → 「MM-DD HH:mm」（本地时区；跨年省略年份 —— 引用场景里"哪一天"够用）。 */
function formatEventTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return '--';
  const date = new Date(at);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
}

// ===== 内部工具（纯函数）=====

/** 是否词字符（字母 / 数字 / 下划线 —— 引用边界判定用）。 */
function isWordChar(char: string): boolean {
  return /[A-Za-z0-9_]/.test(char);
}

/** 载荷 → 记录（不是对象就返回 null：读面不校验形状）。 */
function asRecord(payload: unknown): Record<string, unknown> | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  return payload as Record<string, unknown>;
}

/** 载荷里的字符串字段（非串 / 缺省 → 空串）。 */
function toText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** 载荷里的字符串数组（非数组 → 空数组；非串元素丢掉）。 */
function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
}

/** 载荷里的有限整数（非数 → null）。 */
function toInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.floor(value);
}

/** 截断到上限（超限截尾加省略号）。 */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}
