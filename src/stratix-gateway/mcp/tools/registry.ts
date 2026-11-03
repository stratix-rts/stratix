/**
 * 文件职责：`stratix_registry` —— 列出工作台上"可操作的对象"（只读）：本地 CLI agent 探测结果、
 *   角色名册、战场单位名册。
 * 输入：无（无参工具）。
 * 输出：三段清单 + 计数；不含角色人设全文与外部会话凭据。
 * 禁止事项：
 *   1. 在这里落任何状态 —— 本工具只读，不发任何命令；
 *   2. 回灌角色人设全文 / 外部会话 id —— 那是角色自己的设定与凭据，不是"可操作对象"；
 *   3. 另跑一遍 CLI 探测 —— 探测结果由 app 层写进 WorldState.detectedAgents，
 *      这里只读那份投影（重跑一次探测是慢操作，且会和健康监测抢 PATH）；
 *   4. 按对象的插入序返回 —— 三段都按 id（agent 按 kind）码位序稳定排序，
 *      同一份状态两次读到的顺序必须一致。
 */

import type { WorldState } from '../../../core/types';
import { toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

import { characterOnline } from './common';

export const registryTool: ToolSpec = {
  name: 'stratix_registry',
  domain: 'registry',
  verb: 'list',
  // 清单位次（§2 的条目号只作文档锚点，见 docs/MCP-SPEC.md §2.0）：
  // mission 域新工具插进来后，registry 整体后移两位 —— 既有工具之间的相对次序不变。
  order: 11,
  description: [
    '列出工作台上"可操作的对象"：可用的 CLI agent、角色名册、战场单位名册。',
    '何时用：第一次派单前查"有哪些角色、分别绑的是哪个 CLI、谁在线"；拿到 unknown_character 错误后查该用哪个 id。',
    '何时不用：查任务进展 —— 用 stratix_task_status / stratix_mission_status；查总体忙闲分布 —— 用 stratix_world_snapshot。',
    '边界：只读。返回三段：agents（本地 CLI agent 探测结果）、characters（角色名册：id、名字、绑定的 agent 种类、等级、在线位）、',
    'units（战场单位：id、名字、关联角色、忙闲）。**不含**角色人设全文与外部会话凭据。列表按 id 字典序稳定排序。',
    '错误：internal_error。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  errors: ['internal_error'],
  readOnly: true,
  handler: (_args, host) => {
    const state = host.getWorldState();

    const agents = [...(state.detectedAgents ?? [])].sort((a, b) =>
      a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0
    );
    const characters = [...state.characters].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const units = [...state.units].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    return toToolResult({
      ok: true,
      data: {
        agents: agents.map((agent) => ({
          kind: agent.kind,
          tier: agent.tier,
          installed: agent.installed,
          status: agent.status,
          version: agent.version,
        })),
        characters: characters.map((character) => ({
          id: character.id,
          name: character.name,
          agent_kind: character.agentKind ?? null,
          level: character.level,
          online: characterOnline(state, character.id),
          unit_id: unitIdOf(state, character.id),
        })),
        units: units.map((unit) => ({
          id: unit.id,
          name: unit.name,
          character_id: unit.characterId ?? null,
          status: unit.status,
          online: unit.online !== false,
        })),
        totals: {
          agents: agents.length,
          characters: characters.length,
          units: units.length,
        },
      },
    });
  },
};

/** 角色对应的战场单位 id（没有上场就是 null —— 不编造）。 */
function unitIdOf(state: WorldState, characterId: string): string | null {
  const unit = state.units.find((item) => item.characterId === characterId);
  return unit?.id ?? null;
}
