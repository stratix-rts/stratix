/**
 * 文件职责：**任务标题草稿的共享面**（@since v3.9，task_150）—— 底栏命令面板与 ⌘K 面板
 *   共用的「用户正在敲的任务标题」这一份事实。
 *
 * ============ 为什么要有它（不是两份草稿）============
 *   底栏 composer 的草稿框与 ⌘K 面板的「派发任务」命令指的是**同一句话**。
 *   若各自存一份：用户在底栏写了半句，切到 ⌘K 面板派发 → 派出去的是另一句（甚至空的）。
 *   草稿是**用户的字**，不是某个面板的私有态 —— 它属于「这个应用正在起草的那条任务」。
 *   本模块是那一份共享面：底栏写 → ⌘K 面板读；⌘K 面板清 → 底栏同步清。
 *
 * 输入：字符串（面板写入）。
 * 输出：现值 + 订阅（变化时通知）。
 * 禁止事项：
 *   1. 触碰 DOM / localStorage —— 纯内存（草稿**不跨刷新**：刷新后草稿就该没了）；
 *   2. 变成业务状态 —— 它是**瞬时草稿**，不进 WorldState、不落库；
 *   3. import core/bus / world / app —— 铁律。
 */

/** 现值（最新草稿）。 */
let current = '';

/** 订阅者（面板把它同步到自己的输入框）。 */
const listeners = new Set<(value: string) => void>();

/** 读当前草稿。 */
export function getDraftTitle(): string {
  return current;
}

/** 写草稿（值不变则不通知 —— 少回调 = 少重绘）。 */
export function setDraftTitle(value: string): void {
  if (value === current) return;
  current = value;
  for (const listener of Array.from(listeners)) listener(current);
}
