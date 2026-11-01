/**
 * 文件职责：工具层共用的**角色守门**与在线位判定 —— 派单（task_assign）与对话（chat_send）
 *   走的是同一份判定口径，抄两份必然漂移，所以收在这里。
 * 输入：WorldState 快照 + 角色 id + 本次动作的意图。
 * 输出：守门通过的角色摘要；不通过则抛 McpToolError（守门错误码）。
 * 禁止事项：
 *   1. 在这里判"能不能做"之外的业务（相位、容量那些归各工具自己判）；
 *   2. 改判定口径 —— 本文件照抄 app 层 guardTaskCharacter 的四条（角色在档 / 绑了 agent /
 *      CLI 已检出 / 不离线），**不改变 app 层出队时的裁决权**（app 侧仍会再守一次）；
 *   3. 把守门失败写成静默回落 —— 守门失败必须让调用方看见错误码，不许悄悄换个角色。
 */

import type { CharacterView, WorldState } from '../../../core/types';
import { McpToolError } from '../envelope';

/** 守门通过后的角色摘要（只带工具回执要用的字段，不带人设全文）。 */
export interface GuardedCharacter {
  readonly id: string;
  readonly name: string;
  readonly agentKind: string | null;
}

/** 本次动作的意图 —— 只影响提示文案，不影响判定本身。 */
export type GuardIntent = 'assign' | 'chat';

/** 意图 → 下一步提示的措辞（"派单" / "对话"）。 */
const INTENT_HINTS: Readonly<Record<GuardIntent, { readonly offline: string; readonly unbound: string }>> =
  {
    assign: {
      offline: '等 CLI 恢复在线后重新派单，或换一位在线角色',
      unbound: '先在角色档案里绑定 agent，再派单',
    },
    chat: {
      offline: '等 CLI 恢复在线后重发，或换一位在线角色',
      unbound: '先在角色档案里绑定 agent，再对话',
    },
  };

/**
 * 角色守门（四条，与 app 层 guardTaskCharacter 同口径）。
 * 不通过即抛对应错误码：unknown_character / character_unbound / agent_not_installed / character_offline。
 */
export function guardCharacter(
  state: WorldState,
  characterId: string,
  intent: GuardIntent
): GuardedCharacter {
  const hints = INTENT_HINTS[intent];

  const character = state.characters.find((c) => c.id === characterId);
  if (!character) {
    throw new McpToolError('unknown_character', `未找到角色「${characterId}」的档案`, {
      hint: '用 stratix_registry 查可用的角色 id',
    });
  }
  if (!character.agentKind) {
    throw new McpToolError('character_unbound', `角色「${character.name}」未绑定 CLI agent`, {
      hint: hints.unbound,
    });
  }
  const detected = (state.detectedAgents ?? []).some(
    (agent) => agent.kind === character.agentKind && agent.installed
  );
  if (!detected) {
    throw new McpToolError(
      'agent_not_installed',
      `角色「${character.name}」绑定的 CLI（${character.agentKind}）未被检出`,
      { hint: '安装该 CLI 或换一个已装好的角色' }
    );
  }
  if (state.units.some((unit) => unit.characterId === characterId && unit.online === false)) {
    throw new McpToolError('character_offline', `角色「${character.name}」当前离线`, {
      hint: hints.offline,
    });
  }

  return { id: character.id, name: character.name, agentKind: character.agentKind };
}

/**
 * 角色的在线位：看它的战场单位（缺省即在线；没有单位则 null —— 不编造）。
 * why null 而不是 true：角色还没上场（没单位）与"单位在线"是两件事，混成一个布尔会骗人。
 */
export function characterOnline(state: WorldState, characterId: string): boolean | null {
  const unit = state.units.find((u) => u.characterId === characterId);
  if (!unit) return null;
  return unit.online !== false;
}

/** 角色名（查不到就是 null —— 不编造；回执里角色可能已被删）。 */
export function characterName(state: WorldState, characterId: string): string | null {
  const character: CharacterView | undefined = state.characters.find((c) => c.id === characterId);
  return character?.name ?? null;
}
