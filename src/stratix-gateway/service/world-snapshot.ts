/**
 * 文件职责：**service 进程的世界态快照**（missions + characters）—— 序列化 / 反序列化 / 恢复翻译。
 *   快照 = 一份「重启后要把世界态恢复成什么样」的完整事实：编组任务（含正文与检查点）
 *   与角色名册。落盘由 world-persist.ts 负责（IO + 防抖），本模块只做**纯翻译**。
 * 输入：WorldState（活的状态）/ 快照 JSON 原文（untrusted）。
 * 输出：可序列化的快照对象 / 恢复进 store 的世界态。
 * 禁止事项：
 *   1. 在这里做 IO（读文件 / 写文件）—— 那是 world-persist.ts 的活；
 *   2. 自己抄一份「角色 ↔ 记录」的映射 —— 翻译只有一份，在
 *      app/services/persistence/character-record.ts（渲染侧与 service 侧共用）；
 *   3. 认识 MCP / HTTP —— 本模块必须能被纯 node 进程 import；
 *   4. 解析失败就抛出去打断启动 —— 坏档降级成空世界 + 一行警告（与 world-restore.ts 同一口径）。
 *
 * why 快照是**一份文件**而不是散落几张表：missions 与 characters 同属「世界态」，
 *   一起存一起读，恢复出来才不会自相矛盾（任务指向的单位与名册对不上号）。
 *   文件落在 gateway 的 dataDir 下（与 SQLite 同级）—— 纯文本、可人工检查、可手工写坏做降级演练。
 *
 * @since v3.7（task_133）missions + characters 持久化落盘（重启可恢复）。
 */

import {
  recordToCharacterView,
  type RestoreInjection,
} from '../../app/services/persistence/character-record';
import type { PersistedCharacterRecord } from '../../app/services/persistence/game-save-dao';
import { toCharacterUnit } from '../../core/character';
import { normalizeBrief, syncUnitMissions } from '../../core/mission';
import type { CoreStore } from '../../core/store';
import {
  MAX_MISSIONS,
  MAX_MISSION_CHECKPOINTS,
  MAX_MISSION_DEPENDENCIES,
  type MissionCheckpoint,
  type MissionPhase,
  type MissionView,
  type WorldState,
} from '../../core/types';

/** 快照格式版本（将来改结构时靠它识别旧档）。 */
export const WORLD_SNAPSHOT_VERSION = 1;

/** 合法的任务相位词表（快照里出现别的值 = 脏数据，跳过）。 */
const MISSION_PHASES: readonly MissionPhase[] = [
  'draft',
  'pending',
  'confirmed',
  'running',
  'done',
  'cancelled',
];

/** 一份世界态快照（落盘后的文件内容就是这个对象的 JSON）。 */
export interface WorldSnapshot {
  readonly version: number;
  /** 落盘时刻（epoch ms）—— 给人看的，不参与业务判定。 */
  readonly savedAt: number;
  /** 编组任务（含正文 / 检查点 / 依赖）。 */
  readonly missions: readonly MissionView[];
  /** 角色名册（形状 = 既有 SQLite 角色记录，本文件不另立一套）。 */
  readonly characters: readonly PersistedCharacterRecord[];
}

/** 恢复结果（供启动日志与测试断言用）。 */
export interface WorldSnapshotRestoreResult {
  /** 恢复进 store 的角色数。 */
  readonly characters: number;
  /** 恢复进 store 的战场单位数（角色单位，与建档时同一投影）。 */
  readonly units: number;
  /** 恢复进 store 的编组任务数。 */
  readonly missions: number;
  /** 被判脏而丢弃的条目数（角色 + 任务合计）。 */
  readonly skipped: number;
}

// ============================================================================
// 状态 → 快照（纯函数）
// ============================================================================

/** 建快照所需的外部输入（时间与角色建档时刻由调用方给 —— 本模块不读时钟）。 */
export interface BuildWorldSnapshotInput {
  readonly state: WorldState;
  /** 落盘时刻。 */
  readonly now: number;
  /**
   * 角色的建档时刻（epoch ms）。
   * why 由调用方给：CharacterView 里**没有** createdAt 字段（契约如此），
   *   而角色记录的 created_at 决定恢复后的名册顺序（loadCharacters 按它升序）——
   *   这个值只能由**持有者**（落盘方）一路带着，不能每次现编。
   */
  readonly characterCreatedAt: (characterId: string) => number;
}

/** 活的状态 → 快照（纯函数）。 */
export function buildWorldSnapshot(input: BuildWorldSnapshotInput): WorldSnapshot {
  return {
    version: WORLD_SNAPSHOT_VERSION,
    savedAt: input.now,
    missions: input.state.missions.map(toMissionRecord),
    characters: input.state.characters.map((character) => ({
      id: character.id,
      name: character.name,
      agentKind: character.agentKind ?? null,
      persona: character.persona,
      level: character.level,
      exp: character.experience,
      appearanceJson: character.appearance ? JSON.stringify(character.appearance) : null,
      bodyType: character.appearance?.bodyType ?? null,
      skinId: character.skinId ?? null,
      externalSessionId: character.externalSessionId ?? null,
      contextEnabled: character.contextEnabled ?? true,
      createdAt: input.characterCreatedAt(character.id),
    })),
  };
}

/** MissionView → 快照条目（纯拷贝：去掉 undefined 的可选字段，免得 JSON 里出现 undefined）。 */
function toMissionRecord(mission: MissionView): MissionView {
  return {
    id: mission.id,
    title: mission.title,
    phase: mission.phase,
    unitIds: [...mission.unitIds],
    createdAt: mission.createdAt,
    ...(mission.brief ? { brief: mission.brief } : {}),
    ...(mission.checkpoints ? { checkpoints: mission.checkpoints.map((c) => ({ ...c })) } : {}),
    ...(mission.dependsOn ? { dependsOn: [...mission.dependsOn] } : {}),
  };
}

// ============================================================================
// 快照原文 → 快照（宽容解析：坏档降级，不抛）
// ============================================================================

/**
 * 解析快照原文（untrusted）。
 *
 * 返回 null = **整个档不可用**（不是对象 / 版本不认识 / 字段形状不对）→ 调用方降级成空世界。
 * 单条脏数据（某个任务字段不对、某个角色没名字）只丢那一条，不拖垮整档。
 */
export function parseWorldSnapshot(raw: unknown): WorldSnapshot | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const version = Number(obj.version ?? 0);
  if (!Number.isFinite(version) || version < 1 || version > WORLD_SNAPSHOT_VERSION) return null;

  const missions = Array.isArray(obj.missions) ? obj.missions : [];
  const characters = Array.isArray(obj.characters) ? obj.characters : [];

  return {
    version,
    savedAt: Number(obj.savedAt ?? 0) || 0,
    missions: missions.map(parseMissionRecord).filter((m): m is MissionView => m !== null),
    characters: characters
      .map(parseCharacterRecord)
      .filter((c): c is PersistedCharacterRecord => c !== null),
  };
}

/** 解析单条任务（脏 → null）。 */
function parseMissionRecord(raw: unknown): MissionView | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : '';
  const title = typeof obj.title === 'string' ? obj.title : '';
  if (!id || !title) return null;
  const phase = MISSION_PHASES.includes(obj.phase as MissionPhase) ? (obj.phase as MissionPhase) : null;
  if (!phase) return null;

  const unitIds = Array.isArray(obj.unitIds)
    ? obj.unitIds.filter((v): v is string => typeof v === 'string')
    : [];
  const checkpoints: MissionCheckpoint[] = Array.isArray(obj.checkpoints)
    ? obj.checkpoints
        .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
        .map((c) => ({ at: Number(c.at ?? 0) || 0, note: typeof c.note === 'string' ? c.note : '' }))
        .slice(-MAX_MISSION_CHECKPOINTS)
    : [];
  const dependsOn = Array.isArray(obj.dependsOn)
    ? obj.dependsOn.filter((v): v is string => typeof v === 'string').slice(0, MAX_MISSION_DEPENDENCIES)
    : [];

  const briefRaw = (typeof obj.brief === 'object' && obj.brief !== null
    ? obj.brief
    : undefined) as Record<string, unknown> | undefined;
  const brief = normalizeBrief({
    ...(typeof briefRaw?.requirements === 'string' ? { requirements: briefRaw.requirements } : {}),
    ...(typeof briefRaw?.acceptance === 'string' ? { acceptance: briefRaw.acceptance } : {}),
    ...(typeof briefRaw?.deliverables === 'string' ? { deliverables: briefRaw.deliverables } : {}),
    ...(typeof briefRaw?.constraints === 'string' ? { constraints: briefRaw.constraints } : {}),
  });

  return {
    id,
    title,
    phase,
    unitIds,
    createdAt: Number(obj.createdAt ?? 0) || 0,
    ...(brief ? { brief } : {}),
    ...(checkpoints.length > 0 ? { checkpoints } : {}),
    ...(dependsOn.length > 0 ? { dependsOn } : {}),
  };
}

/** 解析单条角色记录（脏 → null）。 */
function parseCharacterRecord(raw: unknown): PersistedCharacterRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : '';
  const name = typeof obj.name === 'string' ? obj.name : '';
  if (!id || !name) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    id,
    name,
    agentKind: str(obj.agentKind),
    persona: typeof obj.persona === 'string' ? obj.persona : '',
    level: Number(obj.level ?? 1) || 1,
    exp: Number(obj.exp ?? 0) || 0,
    appearanceJson: str(obj.appearanceJson),
    bodyType: str(obj.bodyType),
    skinId: str(obj.skinId),
    externalSessionId: str(obj.externalSessionId),
    contextEnabled: obj.contextEnabled !== false,
    createdAt: Number(obj.createdAt ?? 0) || 0,
  };
}

// ============================================================================
// 快照 → 世界态（纯函数 + store 写入）
// ============================================================================

/**
 * 把快照恢复进 store（角色 + 单位 + 编组任务）。
 *
 * 幂等：id 已在 store 里就跳过（不重复投影单位）。
 * 不抛：坏数据已由 parseWorldSnapshot 过滤掉，这一步只做写入。
 */
export function restoreWorldFromSnapshot(
  store: CoreStore,
  snapshot: WorldSnapshot
): WorldSnapshotRestoreResult {
  const restored = buildSnapshotInjection(snapshot);
  const missions = snapshot.missions.slice(0, MAX_MISSIONS);

  let characters = 0;
  let units = 0;
  let restoredMissions = 0;
  let skipped = 0;

  store.setState((current) => {
    const knownCharacterIds = new Set(current.characters.map((character) => character.id));
    const knownUnitIds = new Set(current.units.map((unit) => unit.id));
    const knownMissionIds = new Set(current.missions.map((mission) => mission.id));

    const nextCharacters = restored.characters.filter(
      (character) => !knownCharacterIds.has(character.id)
    );
    const nextUnits = restored.units.filter((unit) => !knownUnitIds.has(unit.id));
    const nextMissions = missions.filter((mission) => !knownMissionIds.has(mission.id));

    characters = nextCharacters.length;
    units = nextUnits.length;
    restoredMissions = nextMissions.length;

    if (nextCharacters.length === 0 && nextUnits.length === 0 && nextMissions.length === 0) {
      return current;
    }

    // 单位占用：恢复出来的任务要重新占住它的单位（与建档 / 指派时同一投影口径 syncUnitMissions）。
    // 终态任务不占单位 —— 与 core 的语义一致（syncUnitMissions 自己判终态）。
    let mergedUnits = [...current.units, ...nextUnits];
    for (const mission of nextMissions) {
      mergedUnits = syncUnitMissions(mergedUnits, mission);
    }

    return {
      ...current,
      characters: [...current.characters, ...nextCharacters],
      units: mergedUnits,
      missions: [...current.missions, ...nextMissions],
    };
  });

  skipped = Math.max(0, snapshot.characters.length - characters) + Math.max(0, snapshot.missions.length - restoredMissions);

  return { characters, units, missions: restoredMissions, skipped };
}

/**
 * 快照 → 恢复注入包（角色 + 单位投影）。
 *
 * why 复用 character-record 的注入包：角色的「单位投影」只有这一份口径
 *   （buildRestoreInjection → toCharacterUnit），抄一份必然与建档时的单位 id / 字段漂移。
 */
export function buildSnapshotInjection(snapshot: WorldSnapshot): RestoreInjection {
  const characters = snapshot.characters
    .map((record) => recordToCharacterView(record))
    .filter((view): view is NonNullable<typeof view> => view !== null);

  // 单位 id 由角色 id 派生（与建档时同一函数）—— 这里复用 core 的投影。
  return {
    characters,
    units: characters.map((character) => toCharacterUnit(character)),
    positionsByUnitId: new Map(),
  };
}
