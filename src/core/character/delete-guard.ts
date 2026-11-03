/**
 * 文件职责：**删除角色的占用判定**（纯函数）—— 「这个角色现在能不能删」。
 *   名册供给（character.create）需要配一个逆向工具（character.delete），但**不是任何角色都能删**：
 *   正在跑任务 / 正在对话（在线）的角色一删就变成"任务在跑、承人没了"的孤儿单。
 * 输入：一份 WorldState 快照 + 角色 id。
 * 输出：拦截原因（null = 可以删）或 null。
 * 禁止事项：
 *   1. 在这里改状态 —— 本文件只判"能不能删"，落库在 manager.ts（一次 setState 内原子化）；
 *   2. 判"角色在不在名册" —— 那不是"占用"，是"不存在"，判在 manager / MCP 工具两侧（口径不同：
 *      manager 返 not-found，工具返 unknown_character）；
 *   3. 判"角色绑的 CLI 装没装" —— 装没装与能不能删无关（没装的角色恰恰最该删）；
 *   4. 自己收一份任务 / 会话快照 —— 只读 WorldState，调用方给什么就判什么。
 *
 * @since v3.7（task_129）随 character_delete 工具落地：判定口径抽成纯函数，
 *   core 的 manager（权威裁决）与 MCP 工具（前置快筛 / 说清原因）共用同一份 —— 两处各写一份必然漂移。
 */

import type { WorldState } from '../types';

/** 拦截原因。 */
export type CharacterDeleteBlockReason = 'character-busy' | 'character-online';

/** 一次拦截（原因 + 人话细节）。detail 里带具体 id，调用方据此说清"为什么不能删"。 */
export interface CharacterDeleteBlock {
  readonly reason: CharacterDeleteBlockReason;
  /** 人话细节（如在办任务 id / 在办会话 id）—— 直接进 Notice 与错误文案。 */
  readonly detail: string;
}

/**
 * 未收尾的任务相位（占用中）。
 * why 这三个：queued（排着）、running（跑着）、awaiting_approval（等审批）—— 都还没收尾，
 *   承人此刻不能消失。completed / failed / cancelled 是终态（历史），不占资源，允许删。
 */
const ACTIVE_TASK_STATUSES = new Set(['queued', 'running', 'awaiting_approval']);

/**
 * 角色是否"占用中"：有未收尾的角色任务，或战场单位仍在执行编组任务。
 *
 * why 两条都要看：
 *   - 任务队列（state.tasks）是**角色任务**的真相（queued/running/awaiting_approval）；
 *   - 战场单位（state.units）的 status / missionId 是**编组任务**的真相 —— 编组任务在跑时
 *     角色的单位 status = 'busy' 且带着 missionId，这一单在 state.tasks 里未必有对应条目。
 */
function findBusyBlock(state: WorldState, characterId: string): CharacterDeleteBlock | null {
  const tasks = state.tasks ?? [];
  const busyTask = tasks.find(
    (task) => task.characterId === characterId && ACTIVE_TASK_STATUSES.has(task.status)
  );
  if (busyTask) {
    return { reason: 'character-busy', detail: `任务 ${busyTask.id}（${busyTask.status}）还没收尾` };
  }
  const unit = state.units.find((item) => item.characterId === characterId);
  if (unit) {
    // 单位挂在编组任务上（missionId 非空）= 这条编组任务还占着这个角色。
    if (unit.missionId !== null) {
      return { reason: 'character-busy', detail: `还挂在编组任务 ${unit.missionId} 上` };
    }
    if (unit.status !== 'idle') {
      return { reason: 'character-busy', detail: `战场单位 ${unit.id} 还在执行（状态 ${unit.status}）` };
    }
  }
  return null;
}

/**
 * 角色是否"在线"：有在办的角色会话（character_chat 会话处于 active）。
 *
 * why 这么判"在线"：角色的在线位（units[].online）是**CLI 进程健康态**，缺省即在线
 *   —— 拿它当删除闸门会把名册里绝大多数角色都锁死（等于没有删除工具）。
 *   真正"占着这个角色"的是**在办会话**：对话正在跑，这时删角色等于中途掐掉一轮对话。
 *   会话状态是 core/session 的真相（state.sessions 里的摘要，status='active' 即在说话）。
 */
function findOnlineBlock(state: WorldState, characterId: string): CharacterDeleteBlock | null {
  const sessions = state.sessions ?? [];
  const session = sessions.find(
    (item) =>
      item.kind === 'character_chat' &&
      item.status === 'active' &&
      item.participants.includes(characterId)
  );
  if (session) {
    return { reason: 'character-online', detail: `会话 ${session.id} 还在进行中` };
  }
  return null;
}

/**
 * 判定这个角色能不能删（不能删时给出原因）。
 * why 先判 busy 再判 online：任务占用比对话占用更"硬"（任务有产物与回报链），
 *   两件事同时成立时报更严重的那件。
 */
export function findCharacterDeleteBlock(
  state: WorldState,
  characterId: string
): CharacterDeleteBlock | null {
  return findBusyBlock(state, characterId) ?? findOnlineBlock(state, characterId);
}
