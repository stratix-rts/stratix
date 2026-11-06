/**
 * 文件职责：**落库层容量上限的唯一事实源**（@since v3.3，task_205 / M2-08）——
 *   三个池（`characters` / `session_events` / `exp_events`+`unit_positions`）的上限数值。
 *
 * 权威依据：docs/DESIGN-project-map.md §1.4 **M2 行（右列：落库表跨 instance 总量上限）**
 *   ① `characters`：**全局**上限（`MAX_CHARACTERS_TOTAL`，建议 512）+ **每 instance** 上限 64（现状值）；
 *   ② `session_events`：**每 instance 每会话** N 条（建议 512）+ **每 instance 总** M 条（建议 4096）
 *      ⇒ 超出**滚动归档**到 `history/`（R1-20）；
 *   ③ `exp_events` / `unit_positions`：**随 `characters` 同步清理**（无独立池）。
 *
 * ★ 为什么落库层要上限（design §1.4 R1-21 的论证）：
 *   内存池（missions / tasks / sessions）切副本后由 store 只装活跃副本的一份 ⇒ 天然有界；
 *   落库表（characters / exp_events / unit_positions / session_events）却是**跨 instance 累积**的 ——
 *   现状 `MAX_CHARACTERS=64` 只管单 instance ⇒ 200 个副本 ⇒ 12,800 行**无界**；
 *   而生产驱动是 sql.js（**库整体驻留内存**）⇒ 无界增长直接吃内存（撞 PERFORMANCE_GUIDELINES
 *   「数据不许无限增长」）。⇒ 上限必须是**跨 instance 的总量口径**。
 *
 * 输入：无（纯常量；除 core/types.ts 的既有 roster 上限外零 import）。
 * 输出：`CAPACITY_LIMITS`（汇总表，调参只改这一处）+ 四个具名常量。
 * 禁止事项：
 *   1. 在这里写判定 / 归档逻辑 —— 本模块只有**数值**；判定与滚动归档在
 *      `app/services/persistence/capacity-limits.ts` 与 `session-event-archive.ts`；
 *   2. 抄第二份「每 instance 角色上限」—— 那条上限的既有定义在 core/types.ts 的 `MAX_CHARACTERS`
 *      （core manager / MCP 工具 / roster 物化三处共用），本模块只**转出别名**，单一事实源不许分叉；
 *   3. import 存储 / IO / DOM —— 常量模块是依赖图的叶子（谁都能引，谁都不许它引）。
 *
 * @since v3.3（task_205 / M2-08）。
 */

import { MAX_CHARACTERS } from './types';

/**
 * 每 instance 的角色上限（= 现状值 64）。
 *
 * why 是别名而不是新数字：`MAX_CHARACTERS`（core/types.ts）是**既有**的 roster 上限 ——
 *   core manager 建档守门、MCP 工具快筛、roster 物化护栏三处都在用它；
 *   容量层只是把同一条上限**按副本口径**再命名一次（便于读代码时一眼看出「这是每副本的那条」）。
 */
export const MAX_CHARACTERS_PER_INSTANCE = MAX_CHARACTERS;

/**
 * `characters` 表的**全局**行数上限（跨全部副本）。
 *
 * why 需要全局这条：每副本 64 条在单副本下看着安全，但副本数一多就是 64 × N；
 *   落库表**跨副本累积**且整体驻留内存 ⇒ 必须有一条**与副本数无关**的硬上限兜底。
 * why 512：单副本满编 64 的 8 倍 —— 留出「正常开好几个副本」的余量，
 *   同时把全库角色行数钉在几百行量级（远小于 session_events 的量级）。
 */
export const MAX_CHARACTERS_TOTAL = 512;

/**
 * `session_events` 表的**每 instance 每会话**条数上限。
 *
 * why 每会话也要有：单个长会话的事件流是 append-only 的，无界增长会让
 *   「读这个会话的历史」越翻越慢（且整表驻留内存）；512 条足够覆盖绝大多数会话，
 *   超出部分**滚动归档**到 `history/`（不是丢弃 —— 历史仍在，只是不在热表里）。
 */
export const MAX_SESSION_EVENTS_PER_SESSION = 512;

/**
 * `session_events` 表的**每 instance 总量**条数上限。
 *
 * why 与「每会话」那条并存：会话数本身有上限（core 的 `MAX_SESSIONS`），
 *   但「会话数 × 每会话条数」仍是乘积 ⇒ 还需要一条**按副本**的总量线兜底。
 * 4096 = 512 × 8（同上：给正常量留余量，把热表规模钉死）。
 */
export const MAX_SESSION_EVENTS_PER_INSTANCE = 4096;

/**
 * 容量上限汇总表（**调参只改这一处**）。
 *
 * why 要汇总表：四个数字散在四个文件里，改一个上限要翻四个文件 ⇒ 迟早只改一半。
 *   这里一张表列全（键名 = 池名 + 口径），谁要看上限先看这张表。
 */
export const CAPACITY_LIMITS: Readonly<{
  /** 每 instance 的角色上限（现状值）。 */
  readonly charactersPerInstance: number;
  /** 角色表全局（跨副本）行数上限。 */
  readonly charactersTotal: number;
  /** 每 instance 每会话的事件条数上限。 */
  readonly sessionEventsPerSession: number;
  /** 每 instance 的事件总条数上限。 */
  readonly sessionEventsPerInstance: number;
}> = Object.freeze({
  charactersPerInstance: MAX_CHARACTERS_PER_INSTANCE,
  charactersTotal: MAX_CHARACTERS_TOTAL,
  sessionEventsPerSession: MAX_SESSION_EVENTS_PER_SESSION,
  sessionEventsPerInstance: MAX_SESSION_EVENTS_PER_INSTANCE,
});
