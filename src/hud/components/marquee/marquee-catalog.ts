/**
 * 文件职责：**事件跑马灯的纯逻辑层**（task_080）—— 文案模板 / 分级配色 / 相对时间 / 事件→条目映射。
 *   来源：docs/DEMO-PLAN.md §6（事件跑马灯 + 里程碑大字）。
 * 输入：core 总线上的 WorldEvent（task.queued / task.completed / task.failed）+ 事件上下文
 *   （角色名、任务短标题 —— 由组合根从 WorldState 解析后喂进来）。
 * 输出：MarqueeEntry（图标 + 短句 + 相对时间 + 分级）—— 渲染由 marquee.ts 负责。
 * 禁止事项：
 *   1. import world / phaser / app —— 铁律：hud 只认识 core；
 *   2. 碰 DOM —— 本文件是纯函数（单测直打，不起浏览器）；
 *   3. 自己订阅总线 —— 事件订阅归组合根（与 toast / 音效同一装配口径）；
 *   4. 在这里写死色值字面量 —— 颜色取自唯一事实源 core/theme/visual-spec.ts 的
 *      VISUAL_PALETTE（七色语义色），本文件只做「语义 → CSS 变量 + 兜底色」的翻译；
 *   5. 写「AI 腔」文案 —— 短句、具体、带人名与任务名，不写「已成功完成」这类空话，
 *      不用三段式排比、不用装饰性破折号（humanizer-zh 标准）。
 *
 * ============ 分级配色的语义 ============
 *   派活 = 蓝（unit）、完成 = 绿（success）、报错 = 红（danger）、里程碑 = 金（progress）。
 * 四色全部来自唯一事实源的七色语义色 —— 跑马灯不另立一套色表。
 */

import { MARQUEE_METRICS, VISUAL_PALETTE } from '../../../core/theme/visual-spec';
import type { CharacterTask, MissionView, WorldEvent } from '../../../core/types';

/** 跑马灯条目的分级（四级，与 DEMO-PLAN §6 的「完成绿 / 报错红 / 派活蓝 / 里程碑金」一一对应）。 */
export type MarqueeKind = 'dispatch' | 'complete' | 'error' | 'milestone';

/** 分级 → 图标（零资产：直接用字形，不引图标库、不加图片文件）。 */
export const MARQUEE_ICONS: Readonly<Record<MarqueeKind, string>> = Object.freeze({
  dispatch: '📋',
  complete: '✅',
  error: '⚠️',
  milestone: '🏆',
});

/**
 * 分级 → 语义色键（键名即 core/theme/visual-spec.ts 的 VISUAL_PALETTE 键）。
 * why 用键而不是色值：色值只在唯一事实源一处，本文件只认键。
 */
export const MARQUEE_TONE_KEYS: Readonly<Record<MarqueeKind, 'unit' | 'success' | 'danger' | 'progress'>> =
  Object.freeze({
    dispatch: 'unit',
    complete: 'success',
    error: 'danger',
    milestone: 'progress',
  });

/**
 * 分级 → CSS 颜色表达式（`var(--srf-visual-*, 兜底色)`）。
 * 变量名与兜底色都来自唯一事实源：token 由 hud/theme/visual-tokens.ts 注入，
 * 兜底色给 jsdom / 未注入 token 的环境用（与 minimap 的兜底同一口径）。
 */
export function marqueeToneColor(kind: MarqueeKind): string {
  const key = MARQUEE_TONE_KEYS[kind];
  return `var(--srf-visual-${key}, ${VISUAL_PALETTE[key]})`;
}

/** 一条跑马灯条目（渲染面消费的最小数据）。 */
export interface MarqueeEntry {
  /** 分级（决定配色）。 */
  readonly kind: MarqueeKind;
  /** 图标字形。 */
  readonly icon: string;
  /** 短句正文（纯文本，不含 HTML）。 */
  readonly text: string;
  /** 事件发生时刻（ms 时间戳）—— 相对时间由它算。 */
  readonly at: number;
}

/** 事件上下文（组合根从 WorldState 解析后喂进来；解析不到就留空，模板会走兜底句式）。 */
export interface MarqueeEventContext {
  /** 执行角色名。 */
  readonly characterName?: string | null;
  /** 任务短标题（mission 标题优先，没有就用任务原文截断）。 */
  readonly taskTitle?: string | null;
}

/** 任务短标题的最大字数（超出截断加省略号）—— 跑马灯一行要能一眼扫完。 */
export const MARQUEE_TITLE_MAX_CHARS = 12;

/**
 * 截短文本（跑马灯一行只放得下十几个字）。
 * 先把空白折叠掉（任务原文常带换行），再按字数截断并补省略号。
 */
export function shortenText(text: string, maxChars: number = MARQUEE_TITLE_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  return `${flat.slice(0, Math.max(1, maxChars - 1))}…`;
}

/**
 * 相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前。
 * why 这样分档：秒级没有意义（「12 秒前」是噪音），分钟级够用，天级兜底长线任务。
 */
export function formatRelativeTime(at: number, now: number): string {
  const deltaMs = Math.max(0, now - at);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/**
 * 解析任务短标题：mission 标题优先（那是人起的、够短），否则退回任务原文截断。
 * why 优先 mission：任务原文是给 agent 的指令（又长又技术），跑马灯要给观众看。
 */
export function resolveTaskTitle(
  task: CharacterTask,
  missions: readonly MissionView[] = []
): string {
  const missionId = task.missionId;
  if (missionId) {
    const mission = missions.find((m) => m.id === missionId);
    const title = mission?.title?.trim();
    if (title) return shortenText(title);
  }
  return shortenText(task.prompt ?? '');
}

/**
 * 里程碑序号判定：每完成 MARQUEE_METRICS.milestoneEvery 个任务触发一次。
 * 纯函数（计数在调用方，判定在这里）—— 便于单测直打边界。
 */
export function isMilestoneCount(count: number): boolean {
  return count > 0 && count % MARQUEE_METRICS.milestoneEvery === 0;
}

/** 里程碑大字文案：第 N 个任务完成！（感叹号是这一下的重量，别处不加）。 */
export function milestoneText(count: number): string {
  return `第 ${count} 个任务完成！`;
}

/**
 * 里程碑条目的文案（进跑马灯的那一条金色记录）。
 * 大字带感叹号、跑马灯不带 —— 同一件事两种语气，不重复喊。
 */
export function milestoneEntryText(count: number): string {
  return `第 ${count} 个任务完成`;
}

/**
 * 事件 → 跑马灯条目（无对应条目的事件返回 null，调用方跳过）。
 * 只认三条生命周期事件：派活（task.queued）/ 完成（task.completed）/ 报错（task.failed）。
 * why 不收 task.started：开工那一下由气泡系统说话（§3），跑马灯只留「派活—完成—报错」三拍，
 * 少而准（与音效服务的取舍同款）。
 */
export function marqueeEntryForEvent(
  event: WorldEvent,
  context: MarqueeEventContext,
  now: number
): MarqueeEntry | null {
  if (
    event.type !== 'task.queued' &&
    event.type !== 'task.completed' &&
    event.type !== 'task.failed'
  ) {
    return null;
  }
  const kind: MarqueeKind =
    event.type === 'task.queued' ? 'dispatch' : event.type === 'task.completed' ? 'complete' : 'error';
  const name = context.characterName?.trim() ?? '';
  const title = context.taskTitle?.trim() ?? '';
  return {
    kind,
    icon: MARQUEE_ICONS[kind],
    text: marqueeTextFor(kind, name, title),
    at: now,
  };
}

/**
 * 分级 + 角色名 + 任务名 → 短句。
 * 句式刻意口语：谁做了什么、卡在哪儿，一眼能读完。
 * 缺角色名 / 缺任务名时各有一句兜底 —— 不出现「undefined」或空槽。
 */
export function marqueeTextFor(kind: MarqueeKind, name: string, title: string): string {
  const who = name.length > 0 ? name : '';
  const what = title.length > 0 ? `「${title}」` : '';
  switch (kind) {
    case 'dispatch':
      if (who && what) return `${who} 接了${what}`;
      if (who) return `${who} 接了新任务`;
      return what ? `新任务${what}` : '派了新任务';
    case 'complete':
      if (who && what) return `${who} 完成了${what}`;
      if (who) return `${who} 完成了任务`;
      return what ? `${what}完成了` : '任务完成';
    case 'error':
      if (who && what) return `${who} 在${what}上卡住了`;
      if (who) return `${who} 卡住了`;
      return what ? `${what}卡住了` : '有任务卡住了';
    case 'milestone':
      return '';
  }
}
