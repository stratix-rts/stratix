/**
 * 文件职责：**角色档案 ↔ 持久化记录的双向翻译**（纯函数，零 IO）——
 *   「持久化记录 ↔ CharacterView」的映射 + 「快照 → 恢复注入包」的组装。
 * 输入：SQLite 的一行角色记录（PersistedCharacterRecord）/ 一份快照（GameSaveSnapshot）/ 一个角色视图。
 * 输出：CharacterView（脏行返回 null）/ 持久化记录 / 恢复注入包（角色 + 单位投影 + 站位种子）。
 * 禁止事项：
 *   1. 在这里做 IO —— 读写归 game-save-dao（DAO 层）；本模块只翻译；
 *   2. 复制一份映射 —— 渲染侧恢复（game-save-coordinator）与 service 侧恢复
 *      （stratix-gateway/service/world-restore.ts）共用本模块，映射只有这一份；
 *   3. 触碰渲染层 / DOM / IPC —— 本模块必须能被纯 node 进程 import
 *      （service 进程用它恢复世界态，前后端分离 A4）；
 *   4. 在这里判业务合法性（建档是否合法、等级曲线、经验结算）—— 那些真相在 core
 *      （core/character/profile.ts、progression-service）。
 *
 * why 从 game-save-coordinator 拆出来（@since v3.43，task_080 / service-split A4）：
 *   那段翻译原先与**渲染侧**的 IPC 协调器同文件；service 进程（gateway）恢复世界态时
 *   要的是同一份映射 —— 但协调器带 IPC / 浏览器假设，不该被 service 依赖。
 *   纯翻译独立成模块后，两侧共用一份，谁都不抄第二遍（抄一份必然漂移）。
 *
 * @since v3.43（task_080 / service-split A4）从 game-save-coordinator 拆出。
 */

import { CHARACTER_UNIT_ID_PREFIX, toCharacterUnit } from '../../../core/character';
import {
  APPEARANCE_BODY_TYPES,
  DEFAULT_INSTANCE_ID,
  MAX_CHARACTERS,
  isBindableAgentKind,
  type AppearanceBodyType,
  type CharacterAppearance,
  type CharacterView,
  type Point,
  type ProjectInstanceId,
  type UnitView,
} from '../../../core/types';

import type { GameSaveSnapshot, PersistedCharacterRecord } from './game-save-dao';

// ============================================================================
// 记录 ↔ CharacterView 翻译（纯函数，恢复与落库共用同一对映射，不许两侧各写一份）
// ============================================================================

/**
 * 解析外观 JSON → CharacterAppearance；形状不合法（坏 JSON / 体型不在词表 / parts 不是对象）
 * 一律降级为 null（老档案无外观照旧合法，core 不替它编造长相）。
 */
export function parseAppearanceJson(json: string | null): CharacterAppearance | null {
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const { bodyType, parts } = raw as { bodyType?: unknown; parts?: unknown };
  if (typeof bodyType !== 'string' || !(APPEARANCE_BODY_TYPES as readonly string[]).includes(bodyType)) {
    return null;
  }
  if (typeof parts !== 'object' || parts === null) return null;
  return { bodyType: bodyType as AppearanceBodyType, parts: parts as CharacterAppearance['parts'] };
}

/**
 * 持久化记录 → CharacterView。
 * agentKind 不在可建档词表里（内置五家 AGENT_KINDS ∪ 形状合法的 `custom:<id>`，task_056）
 * → 归为未绑定（null）：HUD 显示「未绑定」，不渲染一个不认识的种类。
 * why 自定义段也要认：注册删了（角色保留语义）后重启恢复，kind 若被这里抹成 null，
 *   角色的绑定就丢了 —— 注册在与否是检测层的事，档案层只认形状。
 * id / name 为空的行视为脏数据，返回 null（调用方跳过并警告）。
 */
export function recordToCharacterView(record: PersistedCharacterRecord): CharacterView | null {
  if (!record.id || !record.name) return null;
  const kind =
    record.agentKind !== null && isBindableAgentKind(record.agentKind) ? record.agentKind : null;
  return {
    id: record.id,
    name: record.name,
    persona: record.persona,
    level: record.level,
    experience: record.exp,
    agentKind: kind,
    skinId: record.skinId,
    externalSessionId: record.externalSessionId,
    appearance: parseAppearanceJson(record.appearanceJson),
    // @since v3.29（task_053）：context_enabled 列镜像；false 才写（true 是缺省语义，
    //   不写字段让老快照 / 新代码任意组合都等价 —— 缺省即开，两侧归一口径）。
    ...(record.contextEnabled === false ? { contextEnabled: false } : {}),
    // 归属镜像（@since v3.3，task_205）：行上的 instance_id ⇒ 视图上的 instanceId。
    // why 带上：副本维度的容量判定按「行带着归属」计账（落库层 capacity-limits.ts），
    //   视图不带归属 ⇒ 回写时行会落 NULL ⇒ 副本计数失准。
    ...(record.instanceId ? { instanceId: record.instanceId } : {}),
  };
}

/** CharacterView → 持久化记录。createdAt 由调用方给（首次入库时间；upsert 冲突时库侧保留原值）。 */
export function characterViewToRecord(character: CharacterView, createdAt: number): PersistedCharacterRecord {
  return {
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
    // 缺省（undefined/null）≡ true（@since v3.29，task_053）。
    contextEnabled: character.contextEnabled ?? true,
    createdAt,
    // 归属（@since v3.3，task_205 / M2-08）：视图带归属 ⇒ 行带 instance_id
    //   （副本维度的容量计账靠它；缺省 = 未归属 ⇒ 不带这个键，行落 NULL）。
    ...(character.instanceId ? { instanceId: character.instanceId } : {}),
  };
}

// ============================================================================
// 恢复注入（纯函数，可独立单测）
// ============================================================================

/** 恢复注入包：组合根一次性写入 store / 交给战场的三件套。 */
export interface RestoreInjection {
  /** 恢复后的角色档案（写入 WorldState.characters）。 */
  readonly characters: readonly CharacterView[];
  /** 恢复后的单位投影（写入 WorldState.units，与建档时同一投影函数）。 */
  readonly units: readonly UnitView[];
  /** 站位种子：unitId → 上次世界坐标（交给 BattlefieldScene 的注册表）。 */
  readonly positionsByUnitId: ReadonlyMap<string, Point>;
}

/**
 * 快照 → 恢复注入（纯函数）。
 * 规则：
 *   - 脏行（id/name 为空）跳过并计数（警告由调用方按 skipped 脏行数打）；
 *   - 超过 MAX_CHARACTERS 的多余档案**不恢复**（契约上限是硬约束，宁可少恢复也不撑爆广播）；
 *   - 站位只收「本次真的恢复了的角色」的记录 —— 没有档案的孤儿站位不注入（恢复它没意义）；
 *   - 无站位记录的角色不进种子：注册表自然走网格落位（无记录随机落位的语义不变）。
 */
export function buildRestoreInjection(snapshot: GameSaveSnapshot): RestoreInjection {
  const characters: CharacterView[] = [];
  for (const record of snapshot.characters) {
    if (characters.length >= MAX_CHARACTERS) break;
    const view = recordToCharacterView(record);
    if (view) characters.push(view);
  }

  const restoredIds = new Set(characters.map((c) => c.id));
  const positionsByUnitId = new Map<string, Point>();
  for (const position of snapshot.unitPositions) {
    if (!restoredIds.has(position.characterId)) continue;
    positionsByUnitId.set(`${CHARACTER_UNIT_ID_PREFIX}${position.characterId}`, {
      x: position.x,
      y: position.y,
    });
  }

  return {
    characters,
    units: characters.map(toCharacterUnit),
    positionsByUnitId,
  };
}

/** 从战场单位 id 反解角色 id；不是角色单位（无前缀）返回 null。 */
export function characterIdFromUnitId(unitId: string): string | null {
  return unitId.startsWith(CHARACTER_UNIT_ID_PREFIX)
    ? unitId.slice(CHARACTER_UNIT_ID_PREFIX.length)
    : null;
}

/**
 * 站位种子的**归属裁决**（@since v3.3，task_185 / M1-11）：unitId → 所属副本 id。
 *
 * why 在翻译层判：站位是「按 instance 归属」的事实，归属写在**角色档案**上
 *   （character.instanceId）—— 读档这一侧是唯一知道「谁属于谁」的地方
 *   （world 层只知道「我现在是哪个副本」，不知道「这个单位属于谁」）。
 * 口径与 core 侧一致（bridge 的 scopeOf / design §1.2.1 R1-03）：
 *   缺省 / null ⇒ **默认沙盒**（老存档没有副本维度 ⇒ 归默认沙盒，不是「无归属」）。
 */
export function positionSeedOwner(injection: RestoreInjection): (unitId: string) => ProjectInstanceId {
  const ownerByCharacterId = new Map<string, ProjectInstanceId>();
  for (const character of injection.characters) {
    ownerByCharacterId.set(character.id, character.instanceId ?? DEFAULT_INSTANCE_ID);
  }
  return (unitId: string): ProjectInstanceId => {
    const characterId = characterIdFromUnitId(unitId);
    if (characterId === null) return DEFAULT_INSTANCE_ID;
    return ownerByCharacterId.get(characterId) ?? DEFAULT_INSTANCE_ID;
  };
}
