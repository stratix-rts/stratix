/**
 * 文件职责：`stratix_mission_create`（建编组任务）与 `stratix_mission_status`（查编组任务）
 *   —— 战场编组域的两个工具。
 * 输入：create = title / units / auto_confirm；status = mission_id（缺省即列表）/ limit。
 * 输出：受理回执（标识 + 相位 + 查法 poll）或编组任务与其名下角色任务的摘要。
 * 禁止事项：
 *   1. 绕过 core 总线直接写状态 —— 建任务只发 HudCommand.mission.*，由 core 状态机裁决；
 *   2. 自己判"能不能确认" —— confirm 只认 pending 相位是 core 的裁决，工具不另写一套；
 *   3. 在工具里"直接置完成" —— 编组任务只能由 running 走到 done，MCP 不提供这种后门
 *      （docs/MCP-SPEC.md §3.2）；想收尾就派一条带 mission_id 的角色任务；
 *   4. 回灌任务输出全文 —— 只回状态与摘要。
 */

import { MAX_MISSIONS, MAX_SELECTION_SIZE, type WorldState } from '../../../core/types';
import {
  countCodePoints,
  optionalBoolean,
  optionalInteger,
  optionalStringArray,
  optionalStringOrNull,
  requireString,
} from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

import { characterName } from './common';

/**
 * 任务标题的码点上限（MCP 侧自设）。
 * why core 只校验非空、超长上限是 MCP 侧自设的：防超长标题进状态广播（WorldState 全量广播，
 * 每个字段都得有界）。200 码点足够写清一件事，又不至于把广播体积撑起来。
 */
const MAX_MISSION_TITLE_LEN = 200;

/** 列表模式默认返回条数 / 上限（与 schema 同值；此处是代码侧兜底）。 */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const missionCreateTool: ToolSpec = {
  name: 'stratix_mission_create',
  domain: 'mission',
  verb: 'create',
  order: 5,
  description: [
    '新建一条编组任务（mission）并指派给一组战场单位；默认一次性完成"建任务 → 指派 → 接单开工"，直接进入 running。',
    '何时用：需要多个角色协同完成一件事（一个写代码、一个审阅、一个出文档）。',
    '何时不用：只派一个人 —— 用 stratix_task_assign；只想查现有编组任务 —— 用 stratix_mission_status。',
    '边界：units 是战场单位 id 列表（可空；空 = 草稿任务，不会自己开工）。单位 id 不存在时**静默剔除**并在',
    'dropped_units 里报数（不猜、不报错）。auto_confirm=false 时任务停在 pending 待确认 —— 第一期 MCP 不提供确认工具，',
    '确认留给 UI 面板裁决（core 口径：confirm 只认 pending）。auto_confirm=true 时若有效名单为空（单位 id 全不存在），',
    '任务无法进入 running，返回 illegal_transition。编组任务上限 100 条，超限拒绝新建。',
    '错误：invalid_arguments（title 为空或超长）/ mission_capacity_exceeded（可重试）/ illegal_transition。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        minLength: 1,
        maxLength: MAX_MISSION_TITLE_LEN,
        description: '任务标题。core 只校验非空，200 码点上限是 MCP 侧自设（防超长标题进状态广播）。',
      },
      units: {
        type: 'array',
        items: { type: 'string' },
        maxItems: MAX_SELECTION_SIZE,
        description: '指派的战场单位 id 列表。上限 256（MAX_SELECTION_SIZE）。',
      },
      auto_confirm: {
        type: 'boolean',
        default: true,
        description:
          'true = 内部完成建任务→指派→接单开工（落到 running）；false = 停在 pending 待 UI 确认。',
      },
    },
    required: ['title'],
    additionalProperties: false,
  },
  errors: ['invalid_arguments', 'mission_capacity_exceeded', 'illegal_transition', 'internal_error'],
  readOnly: false,
  handler: (args, host) => {
    const title = requireString(args, 'title');
    if (countCodePoints(title) > MAX_MISSION_TITLE_LEN) {
      throw new McpToolError(
        'invalid_arguments',
        `title 超过 ${MAX_MISSION_TITLE_LEN} 码点上限`,
        { hint: '把标题写短一点（只写这件事是什么）' }
      );
    }
    const requestedUnits = optionalStringArray(args, 'units') ?? [];
    if (requestedUnits.length > MAX_SELECTION_SIZE) {
      throw new McpToolError(
        'invalid_arguments',
        `units 超过 ${MAX_SELECTION_SIZE} 条上限`,
        { hint: '拆成多条编组任务，或先收窄指派范围' }
      );
    }
    const autoConfirm = optionalBoolean(args, 'auto_confirm', true);

    const state = host.getWorldState();
    if ((state.missions ?? []).length >= MAX_MISSIONS) {
      throw new McpToolError('mission_capacity_exceeded', `编组任务数已满（上限 ${MAX_MISSIONS}）`, {
        hint: '等在办编组任务收尾后重试',
      });
    }

    // ① 建任务 —— 只发命令，落库与相位由 core 裁决（core 会自行对账名单：去重、剔未知单位）。
    const beforeIds = new Set((state.missions ?? []).map((mission) => mission.id));
    host.dispatchCommand({ type: 'mission.create', title, unitIds: requestedUnits });

    const created = (host.getWorldState().missions ?? []).find(
      (mission) => !beforeIds.has(mission.id)
    );
    if (!created) {
      throw new McpToolError(
        'internal_error',
        '编组任务未落地：本进程没有 core 运行时接管这条命令',
        { hint: '确认 Stratix 运行时在本进程已启动后再建任务' }
      );
    }

    // ② 指派 —— 用 core 对账后的名单再指一次（同一批人 = 无实质变更，不产生多余广播）。
    //    名单为空时这一步是空转（草稿任务本来就没有编组），仍然发出来是为了走同一条命令路径。
    host.dispatchCommand({
      type: 'mission.assign',
      missionId: created.id,
      unitIds: [...created.unitIds],
    });

    // ③ 接单开工 —— accept 在 core 内部合并 decide + start，落点即 running。
    if (autoConfirm) {
      host.dispatchCommand({
        type: 'mission.confirm',
        missionId: created.id,
        decision: 'accept',
      });
    }

    const finalState = host.getWorldState();
    const mission = (finalState.missions ?? []).find((item) => item.id === created.id);
    if (!mission) {
      throw new McpToolError('internal_error', '编组任务在操作过程中消失了（不应发生）', {
        hint: '查服务端日志确认 core 运行时是否异常',
      });
    }

    if (autoConfirm && mission.phase !== 'running') {
      // confirm 只认 pending 相位：名单为空（草稿）时确认不了，任务停在 draft。
      throw new McpToolError(
        'illegal_transition',
        `编组任务「${title}」没能进入 running（当前 ${mission.phase} 相位）`,
        {
          hint:
            '有效名单为空（单位 id 不存在）时无法接单开工 —— 用 stratix_registry 查战场单位 id 后重试，' +
            '或改传 auto_confirm=false 先立一条待指派的草稿任务',
        }
      );
    }

    // dropped_units：请求的去重名单 − core 实际采纳的名单（core 静默剔除了不存在的单位）。
    const droppedUnits = countUnique(requestedUnits) - mission.unitIds.length;

    return toToolResult({
      ok: true,
      data: {
        mission_id: mission.id,
        title: mission.title,
        phase: mission.phase,
        auto_confirm_applied: autoConfirm,
        units: mission.unitIds.map((unitId) => ({
          id: unitId,
          name: unitName(finalState, unitId),
        })),
        dropped_units: droppedUnits,
        created_at: mission.createdAt,
        next: {
          tool: 'stratix_task_assign',
          args: { mission_id: mission.id },
          hint: '派具体任务时带上 mission_id，任务终态会自动回报到这条编组任务',
        },
        poll: {
          tool: 'stratix_mission_status',
          args: { mission_id: mission.id },
        },
      },
    });
  },
};

export const missionStatusTool: ToolSpec = {
  name: 'stratix_mission_status',
  domain: 'mission',
  verb: 'status',
  order: 6,
  description: [
    '读取编组任务（mission）的状态；带 mission_id 读单条，不带则列出最近的编组任务。',
    '何时用：查一条编组任务的进展与它下面的角色任务；回话前确认"这件事推进到哪了"。',
    '何时不用：查单个角色的任务 —— 用 stratix_task_status；查全场忙闲 —— 用 stratix_world_snapshot。',
    '边界：只读。列模式默认返回最近 20 条（limit 可调，上限 100），按创建时间倒序；被截断时 truncated=true。',
    '单条模式附带该任务下的角色任务摘要（任务 id、承接角色、状态）。',
    '错误：mission_not_found / invalid_arguments。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      mission_id: {
        type: ['string', 'null'],
        description: '缺省 = 列出最近若干条编组任务。',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        default: DEFAULT_LIMIT,
        description: '列模式最多返回几条（按创建时间倒序）。',
      },
    },
    additionalProperties: false,
  },
  errors: ['mission_not_found', 'invalid_arguments'],
  readOnly: true,
  handler: (args, host) => {
    const missionId = optionalStringOrNull(args, 'mission_id') ?? null;
    const limit = optionalInteger(args, 'limit', { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT;

    const state = host.getWorldState();
    const missions = state.missions ?? [];

    if (missionId) {
      const mission = missions.find((item) => item.id === missionId);
      if (!mission) {
        throw new McpToolError('mission_not_found', `编组任务「${missionId}」不存在`, {
          hint: '用 stratix_world_snapshot 确认 mission id',
        });
      }
      const tasks = (state.tasks ?? []).filter((task) => task.missionId === mission.id);
      return toToolResult({
        ok: true,
        data: {
          mission: {
            id: mission.id,
            title: mission.title,
            phase: mission.phase,
            unit_count: mission.unitIds.length,
            created_at: mission.createdAt,
            units: mission.unitIds.map((unitId) => ({
              id: unitId,
              name: unitName(state, unitId),
            })),
          },
          tasks: tasks.map((task) => ({
            id: task.id,
            character: { id: task.characterId, name: characterName(state, task.characterId) },
            status: task.status,
          })),
          task_totals: {
            total: tasks.length,
            completed: tasks.filter((task) => task.status === 'completed').length,
            running: tasks.filter((task) => task.status === 'running').length,
            failed: tasks.filter((task) => task.status === 'failed').length,
          },
        },
      });
    }

    // 列模式：按创建时间倒序（同一毫秒内保持既有顺序 —— 排序稳定，不让同刻条目乱跳）。
    const ordered = [...missions].sort((a, b) => b.createdAt - a.createdAt);
    const total = ordered.length;
    const items = ordered.slice(0, limit);
    return toToolResult({
      ok: true,
      data: {
        missions: {
          returned: items.length,
          total,
          truncated: total > items.length,
          items: items.map((mission) => ({
            id: mission.id,
            title: mission.title,
            phase: mission.phase,
            unit_count: mission.unitIds.length,
            created_at: mission.createdAt,
          })),
        },
        limit,
      },
    });
  },
};

/** 去重后的名单长度（core 的 dropped 口径：按去重后的入参个数算）。 */
function countUnique(unitIds: readonly string[]): number {
  return new Set(unitIds.filter((id) => id.length > 0)).size;
}

/** 战场单位名（查不到就是 null —— 不编造）。 */
function unitName(state: WorldState, unitId: string): string | null {
  const unit = state.units.find((item) => item.id === unitId);
  return unit?.name ?? null;
}
