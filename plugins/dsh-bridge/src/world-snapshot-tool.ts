/**
 * `stratix_world_snapshot` —— 唯一注册进 `ctx.tools` 的模型可见工具（spike 范围）。
 *
 * 契约要点：
 * - **只读投影**：工具返回 service 推来的最新一份全量快照，不写、不发命令；
 * - **不假装成功**：没收到过快照 = 「未附着」，如实标 `attached:false` + 说明，
 *   绝不返回一份空 units 冒充「战场真的空了」（docs/WORLD-SYNC.md §1.3）。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';
import type { WorldSyncClient } from './world-sync-client.js';
import type { WireCharacter, WireMission, WireUnit } from './protocol.js';

/** 可空字符串的 schema 节点（oneOf 是 dsh schema DSL 里唯一的联合写法）。 */
const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] } as const;
/** 可空整数的 schema 节点。 */
const NULLABLE_NUMBER = { oneOf: [{ type: 'number' }, { type: 'null' }] } as const;

/** 工具返回的规范值形状（= output.schema 的投影）。 */
export interface WorldSnapshotValue {
  /** 是否已收到 service 的全量快照（false = 状态面未附着，读不到真相）。 */
  attached: boolean;
  /** 最近一份快照的状态版本号；未附着时为 null。 */
  seq: number | null;
  /** 战场单位。 */
  units: {
    id: string;
    name: string;
    status: string;
    missionId: string | null;
    power: number;
    characterId: string | null;
    level: number | null;
  }[];
  /** 任务及状态机相位。 */
  missions: {
    id: string;
    title: string;
    phase: string;
    unitIds: string[];
  }[];
  /** 角色档案。 */
  characters: {
    id: string;
    name: string;
    level: number;
    agentKind: string | null;
  }[];
  /** 一句话说明：这一份快照是什么口径、缺了什么。 */
  note: string;
}

const UNIT_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    status: { type: 'string', required: true },
    missionId: { ...NULLABLE_STRING, required: true },
    power: { type: 'number', required: true },
    characterId: { ...NULLABLE_STRING, required: true },
    level: { ...NULLABLE_NUMBER, required: true },
  },
} as const;

const MISSION_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    phase: { type: 'string', required: true },
    unitIds: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const;

const CHARACTER_ITEM = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    level: { type: 'number', required: true },
    agentKind: { ...NULLABLE_STRING, required: true },
  },
} as const;

/** 规范值 schema：null 只出现在「未附着 / 该字段本身可空」这两条路径上，不与其他类型混用。 */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    attached: { type: 'boolean', required: true },
    seq: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    units: { type: 'array', required: true, items: UNIT_ITEM },
    missions: { type: 'array', required: true, items: MISSION_ITEM },
    characters: { type: 'array', required: true, items: CHARACTER_ITEM },
    note: { type: 'string', required: true },
  },
} as const;

function toUnit(unit: WireUnit): WorldSnapshotValue['units'][number] {
  return {
    id: unit.id,
    name: unit.name,
    status: unit.status,
    missionId: unit.missionId ?? null,
    power: unit.power,
    characterId: unit.characterId ?? null,
    level: unit.level ?? null,
  };
}

function toMission(mission: WireMission): WorldSnapshotValue['missions'][number] {
  return {
    id: mission.id,
    title: mission.title,
    phase: mission.phase,
    unitIds: [...mission.unitIds],
  };
}

function toCharacter(character: WireCharacter): WorldSnapshotValue['characters'][number] {
  return {
    id: character.id,
    name: character.name,
    level: character.level,
    agentKind: character.agentKind ?? null,
  };
}

/**
 * 造一个「未附着」的规范值。
 *
 * why 单独一支：未附着时 units/missions/characters 必须是空数组，但 `attached:false`
 * 与 note 明确说清「读不到真相」—— 空数组不得被读成「战场真的空了」。
 */
function unattachedValue(note: string): WorldSnapshotValue {
  return { attached: false, seq: null, units: [], missions: [], characters: [], note };
}

/**
 * 构造 `stratix_world_snapshot` 工具定义。
 *
 * @param client - 已启动的 world-sync 客户端（插件持有，本工具只读它的投影）。
 * @param describe - 诊断输出函数。
 */
export function createWorldSnapshotTool(
  client: WorldSyncClient,
  describe: (message: string) => void = (message: string) => console.error(`[stratix-dsh-bridge] ${message}`),
) {
  return defineTool({
    name: 'stratix_world_snapshot',
    description:
      'Read the current Stratix world state from the running Stratix service: the agent units on the battlefield, their task phase, and the character roster. Read-only — it never changes anything. Use it to answer questions about "what is on the battlefield right now".',
    parameters: {
      includeCharacters: {
        type: 'boolean',
        description: 'Include the character roster (name, level, bound agent kind). Defaults to true.',
      },
    },
    output: {
      schema: OUTPUT_SCHEMA,
      // 模型看到的是 render 的产物，不是规范值本身 —— 所以这里必须把**真数据**铺出去，
      // 只给一句汇总结论的话，模型无从判断这些单位是真是假（spike 实测踩过这个坑）。
      render: (_args, value) => [
        {
          type: 'text',
          text: value.attached
            ? `Stratix 世界快照（seq=${value.seq}）：${value.units.length} 个单位 / ${value.missions.length} 个任务 / ${value.characters.length} 个角色。\n${JSON.stringify(value, null, 2)}`
            : `Stratix 世界快照不可用：${value.note}`,
        },
      ],
    },
    async execute(args, exec) {
      if (exec.signal.aborted) throw new Error('stratix_world_snapshot 被取消');
      const snapshot = client.getSnapshot();
      if (snapshot === null) {
        const note = `状态面未附着：尚未收到 Stratix service 的全量快照（当前没有真相，不是战场为空）。`;
        describe('工具被调用，但还没有收到任何快照。');
        return unattachedValue(note);
      }
      const includeCharacters = args.includeCharacters !== false;
      const state = snapshot.state;
      const value: WorldSnapshotValue = {
        attached: true,
        seq: snapshot.seq,
        units: (state.units ?? []).map(toUnit),
        missions: (state.missions ?? []).map(toMission),
        characters: includeCharacters ? (state.characters ?? []).map(toCharacter) : [],
        note: `全量快照 seq=${snapshot.seq}，来自 Stratix service（world-sync 广播口径）。`,
      };
      describe(`返回快照 seq=${snapshot.seq}：${value.units.length} unit(s)。`);
      return value;
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'Read Stratix world state',
      kind: 'read',
      rawInput: args,
    }),
  });
}
