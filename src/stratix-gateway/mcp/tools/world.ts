/**
 * 文件职责：`stratix_world_snapshot` —— 战场现状快照（只读投影）。
 * 输入：filters（要哪几段 / 看哪些单位 / 什么相位 / limit）+ 只读的数据面端口。
 * 输出：计数与精简条目（每段最多 limit 条），被截断时带 truncated 标记。
 * 禁止事项：
 *   1. 在这里改状态 —— 本工具只读，不落任何命令；
 *   2. 回灌全文 —— 角色人设全文、任务输出全文一律不回（默认摘要，展开用 stratix_task_status）；
 *   3. 自己维护一份战场副本 —— 快照是 WorldState 的即时投影，每次调用现读现算；
 *   4. 按对象的插入序返回 —— 各段顺序沿用 WorldState 的既有顺序（稳定、可预期）。
 */

import type {
  CharacterTask,
  MissionPhase,
  TaskStatus,
  UnitStatus,
  WorldState,
} from '../../../core/types';
import {
  optionalInteger,
  optionalObject,
  optionalStringArray,
  truncateText,
} from '../args';
import { McpToolError, toToolResult } from '../envelope';
import type { ToolSpec } from '../types';

import { characterOnline } from './common';

/** 快照可返回的四段（与 spec §2.1 的 filters.domains 词表一致）。 */
const DOMAINS = ['units', 'missions', 'tasks', 'characters'] as const;
type Domain = (typeof DOMAINS)[number];

const UNIT_STATUSES: readonly UnitStatus[] = ['idle', 'busy', 'offline', 'error'];
const MISSION_PHASES: readonly MissionPhase[] = [
  'draft',
  'pending',
  'confirmed',
  'running',
  'done',
  'cancelled',
];
const TASK_STATUSES: readonly TaskStatus[] = [
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'cancelled',
];

/** 单段最多返回的条数上限（schema 同此值；此处是代码侧的兜底）。 */
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;
/** 任务列表里的摘要长度上限（码点）—— 列表项是"扫一眼"用的，不是拿来读的。 */
const TASK_SUMMARY_MAX = 120;

interface SnapshotFilters {
  readonly domains: readonly Domain[];
  readonly unitIds: readonly string[] | undefined;
  readonly unitStatus: readonly UnitStatus[] | undefined;
  readonly missionPhase: readonly MissionPhase[] | undefined;
  readonly taskStatus: readonly TaskStatus[] | undefined;
  readonly characterIds: readonly string[] | undefined;
  readonly limit: number;
}

interface Section<T> {
  readonly returned: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly items: readonly T[];
}

/** 读 filters（非法取值 → invalid_arguments）。 */
function readFilters(args: Readonly<Record<string, unknown>>): SnapshotFilters {
  const raw = optionalObject(args, 'filters');
  if (!raw) {
    return {
      domains: DOMAINS,
      unitIds: undefined,
      unitStatus: undefined,
      missionPhase: undefined,
      taskStatus: undefined,
      characterIds: undefined,
      limit: DEFAULT_LIMIT,
    };
  }

  const domainsRaw = optionalStringArray(raw, 'domains');
  if (domainsRaw) {
    for (const domain of domainsRaw) {
      if (!DOMAINS.includes(domain as Domain)) {
        throw new McpToolError(
          'invalid_arguments',
          `filters.domains 含未知取值「${domain}」`,
          { hint: `domains 只能是：${DOMAINS.join(' / ')}` }
        );
      }
    }
  }

  const unitStatusRaw = optionalStringArray(raw, 'unit_status');
  for (const status of unitStatusRaw ?? []) {
    if (!UNIT_STATUSES.includes(status as UnitStatus)) {
      throw new McpToolError('invalid_arguments', `filters.unit_status 含未知取值「${status}」`, {
        hint: `unit_status 只能是：${UNIT_STATUSES.join(' / ')}`,
      });
    }
  }

  const missionPhaseRaw = optionalStringArray(raw, 'mission_phase');
  for (const phase of missionPhaseRaw ?? []) {
    if (!MISSION_PHASES.includes(phase as MissionPhase)) {
      throw new McpToolError('invalid_arguments', `filters.mission_phase 含未知取值「${phase}」`, {
        hint: `mission_phase 只能是：${MISSION_PHASES.join(' / ')}`,
      });
    }
  }

  const taskStatusRaw = optionalStringArray(raw, 'task_status');
  for (const status of taskStatusRaw ?? []) {
    if (!TASK_STATUSES.includes(status as TaskStatus)) {
      throw new McpToolError('invalid_arguments', `filters.task_status 含未知取值「${status}」`, {
        hint: `task_status 只能是：${TASK_STATUSES.join(' / ')}`,
      });
    }
  }

  const limit = optionalInteger(raw, 'limit', { min: 1, max: MAX_LIMIT }) ?? DEFAULT_LIMIT;

  return {
    domains: (domainsRaw as Domain[] | undefined) ?? DOMAINS,
    unitIds: optionalStringArray(raw, 'unit_ids'),
    unitStatus: unitStatusRaw as UnitStatus[] | undefined,
    missionPhase: missionPhaseRaw as MissionPhase[] | undefined,
    taskStatus: taskStatusRaw as TaskStatus[] | undefined,
    characterIds: optionalStringArray(raw, 'character_ids'),
    limit,
  };
}

/** 截断一段（保序、保前 limit 条）。 */
function section<T>(items: readonly T[], limit: number): Section<T> {
  const total = items.length;
  const returned = Math.min(total, limit);
  return {
    returned,
    total,
    truncated: total > returned,
    items: items.slice(0, returned),
  };
}

function matchesUnit(filters: SnapshotFilters, unit: WorldState['units'][number]): boolean {
  if (filters.unitIds && !filters.unitIds.includes(unit.id)) return false;
  if (filters.unitStatus && !filters.unitStatus.includes(unit.status)) return false;
  return true;
}

function matchesMission(filters: SnapshotFilters, mission: WorldState['missions'][number]): boolean {
  if (filters.missionPhase && !filters.missionPhase.includes(mission.phase)) return false;
  return true;
}

function matchesTask(filters: SnapshotFilters, task: CharacterTask): boolean {
  if (filters.taskStatus && !filters.taskStatus.includes(task.status)) return false;
  return true;
}

function matchesCharacter(
  filters: SnapshotFilters,
  character: WorldState['characters'][number]
): boolean {
  if (filters.characterIds && !filters.characterIds.includes(character.id)) return false;
  return true;
}

/** 角色的在线位：看它的战场单位（缺省即在线；没有单位则 null —— 不编造）。 */

export const worldSnapshotTool: ToolSpec = {
  name: 'stratix_world_snapshot',
  domain: 'world',
  verb: 'snapshot',
  order: 1,
  description: [
    '读取战场现状快照：当前在场的单位（agent）、在办与历史任务、角色名册。',
    '何时用：派单前确认"谁现在空闲"、判断某任务的进展、汇报当前战况。',
    '何时不用：只想看一条任务的细节 —— 用 stratix_task_status；只想看某条编组任务 —— 用 stratix_mission_status。',
    '边界：只读，不改变任何状态。默认只回计数与精简条目（每段最多 limit 条，默认 20、上限 100）；',
    '被截断时 truncated=true 且 returned < total。不返回角色人设全文与任务输出全文。',
    '错误：invalid_arguments（过滤器取值非法）。',
  ].join('\n'),
  inputSchema: {
    type: 'object',
    properties: {
      filters: {
        type: 'object',
        description: '要哪几段、看哪些对象、每段最多几条。缺省 = 全部四段、每段 20 条。',
        properties: {
          domains: {
            type: 'array',
            items: { type: 'string', enum: [...DOMAINS] },
            description: '要哪几段。缺省 = 全部四段。',
          },
          unit_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '只看这些单位。',
          },
          unit_status: {
            type: 'array',
            items: { type: 'string', enum: [...UNIT_STATUSES] },
            description: '只看这些忙闲状态的单位。',
          },
          mission_phase: {
            type: 'array',
            items: { type: 'string', enum: [...MISSION_PHASES] },
            description: '只看这些相位的编组任务。',
          },
          task_status: {
            type: 'array',
            items: { type: 'string', enum: [...TASK_STATUSES] },
            description: '只看这些相位的角色任务。',
          },
          character_ids: {
            type: 'array',
            items: { type: 'string' },
            description: '只看这些角色。',
          },
          limit: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_LIMIT,
            default: DEFAULT_LIMIT,
            description: '每段最多返回几条。',
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
  errors: ['invalid_arguments'],
  readOnly: true,
  handler: (args, host) => {
    const filters = readFilters(args);
    const state = host.getWorldState();

    const data: Record<string, unknown> = { taken_at: Date.now() };
    const totals: Record<string, number> = {};

    if (filters.domains.includes('units')) {
      const units = state.units.filter((unit) => matchesUnit(filters, unit));
      const built = section(units, filters.limit);
      totals.units = built.total;
      data.units = {
        returned: built.returned,
        total: built.total,
        truncated: built.truncated,
        items: built.items.map((unit) => ({
          id: unit.id,
          name: unit.name,
          status: unit.status,
          online: unit.online !== false,
          character_id: unit.characterId ?? null,
          mission_id: unit.missionId ?? null,
        })),
      };
    }

    if (filters.domains.includes('missions')) {
      const missions = state.missions.filter((mission) => matchesMission(filters, mission));
      const built = section(missions, filters.limit);
      totals.missions = built.total;
      data.missions = {
        returned: built.returned,
        total: built.total,
        truncated: built.truncated,
        items: built.items.map((mission) => ({
          id: mission.id,
          title: mission.title,
          phase: mission.phase,
          unit_count: mission.unitIds.length,
        })),
      };
    }

    if (filters.domains.includes('tasks')) {
      const tasks = (state.tasks ?? []).filter((task) => matchesTask(filters, task));
      const built = section(tasks, filters.limit);
      totals.tasks = built.total;
      data.tasks = {
        returned: built.returned,
        total: built.total,
        truncated: built.truncated,
        items: built.items.map((task) => ({
          id: task.id,
          character_id: task.characterId,
          status: task.status,
          created_at: task.createdAt,
          summary: truncateText(task.output.trim() || task.prompt.trim(), TASK_SUMMARY_MAX),
        })),
      };
    }

    if (filters.domains.includes('characters')) {
      const characters = state.characters.filter((character) => matchesCharacter(filters, character));
      const built = section(characters, filters.limit);
      totals.characters = built.total;
      data.characters = {
        returned: built.returned,
        total: built.total,
        truncated: built.truncated,
        items: built.items.map((character) => ({
          id: character.id,
          name: character.name,
          agent_kind: character.agentKind ?? null,
          level: character.level,
          online: characterOnline(state, character.id),
        })),
      };
    }

    // totals 只含被请求的段（没要的那段连计数都不给 —— 少给即少占上下文）。
    data.totals = totals;

    return toToolResult({ ok: true, data });
  },
};
