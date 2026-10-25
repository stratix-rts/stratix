/**
 * 文件职责：游戏存档协调器（task_033）—— 渲染侧的持久化编排：
 *   ① 启动恢复：loadSnapshot（IPC → 主进程 DAO）→ 构造「注入 core store 的角色/单位 + 交给战场的站位种子」；
 *   ② 档案落库：订阅 core 广播，characters 数组实质变化时把**变化的档案**存回主进程；
 *   ③ 站位落库：订阅 world 通道的 unit.position 事件，防抖（默认 3s）批量存回主进程。
 * 输入：GameSaveApi（preload 暴露的 IPC 面）、core/bus、core/store。
 * 输出：注入用的 RestoreInjection；两条 IPC 写通道的调用。
 * 禁止事项：
 *   1. import fs / sqlite / electron 主进程模块 —— 渲染层没有 Node 能力，持久化一律经 IPC；
 *   2. 自己解释存档以外的业务（等级、命名）—— 那是 core/character 的职责，这里只做「记录 ↔ CharacterView」翻译；
 *   3. 高频刷库 —— 位置事件必须防抖合并（拖拽/移动每帧都在发，2-5s 批量落一次）；
 *   4. 读档失败时阻塞启动 —— 存档坏了应该降级成"空世界 + 警告"，绝不能让游戏起不来。
 *
 * why 协调器放 app 层而不是 core：落库是 IO，core 零 IO 是分层铁律；
 *   组合根（main-entry）只负责把它接进总线和 store，翻译与防抖细节住在这里。
 *
 * why 走 onState/onWorldEvent 而不是让 core/character 直接调 DAO：
 *   core 不知道存储的存在（依赖方向：app → core，不能反过来）；
 *   「状态变了 → 持久化」本来就是组合根侧的关注点（与 agentDetection 快照并入 store 同一模式）。
 *
 * @since v3.12，task_033。
 */

import { onState, onWorldEvent, type Unsubscribe } from '../../../core/bus';
import { CHARACTER_UNIT_ID_PREFIX, toCharacterUnit } from '../../../core/character';
import { worldStore, type CoreStore } from '../../../core/store';
import {
  APPEARANCE_BODY_TYPES,
  MAX_CHARACTERS,
  isBindableAgentKind,
  type AppearanceBodyType,
  type CharacterAppearance,
  type CharacterView,
  type Point,
  type UnitView,
} from '../../../core/types';

import type { GameSaveSnapshot, PersistedCharacterRecord, PersistedUnitPosition } from './game-save-dao';

// ============================================================================
// IPC 面（与 src/electron/preload.ts 的 gameSave 段保持同构 —— 那边是实现，这边是形状）
// ============================================================================

/** 快照读取结果（IPC 往返载荷）。ok=false 时 characters/unitPositions 缺省。 */
export interface GameSaveSnapshotResult extends GameSaveSnapshot {
  readonly ok: boolean;
  readonly error?: string;
}

export interface GameSaveWriteResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** preload 暴露的存档 API（main-entry 只认这个形状，不 import electron）。 */
export interface GameSaveApi {
  /** 读完整快照（角色档案 + 全部站位）。 */
  loadSnapshot(): Promise<GameSaveSnapshotResult>;
  /** 批量 upsert 角色档案。 */
  saveCharacters(records: readonly PersistedCharacterRecord[]): Promise<GameSaveWriteResult>;
  /** 批量 upsert 单位站位。 */
  saveUnitPositions(entries: readonly PersistedUnitPosition[]): Promise<GameSaveWriteResult>;
}

/** 从 window.electronAPI 取存档 API；非 Electron 环境（纯 vite dev）返回 null。 */
export function gameSaveApi(): GameSaveApi | null {
  const api = (window as unknown as { electronAPI?: { gameSave?: GameSaveApi } }).electronAPI;
  return api?.gameSave ?? null;
}

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
 * 角色的绑定就丢了 —— 注册在与否是检测层的事，档案层只认形状。
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
    // 不写字段让老快照 / 新代码任意组合都等价 —— 缺省即开，两侧归一口径）。
    ...(record.contextEnabled === false ? { contextEnabled: false } : {}),
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

// ============================================================================
// 协调器
// ============================================================================

export interface GameSaveCoordinatorOptions {
  /** 存档 IPC 面（gameSaveApi() 的产物；单测注入 fake）。 */
  readonly api: GameSaveApi;
  /** 状态持有者；默认 worldStore 单例（单测用 createStore() 隔离）。 */
  readonly store?: CoreStore;
  /** 站位落库防抖窗口（ms）；默认 3000（任务规格 2-5s）。 */
  readonly debounceMs?: number;
}

export interface GameSaveCoordinator {
  /**
   * 启动恢复：读快照 → 构造注入包。失败**不抛**：返回空注入 + 打警告（降级为空世界，
   * 启动不能被存档问题卡死）。组合根拿返回值写 store / 塞 registry。
   */
  restore(): Promise<RestoreInjection>;
  /**
   * 接上两条订阅（档案 diff 落库 + 站位防抖落库）。必须在 restore 注入**之后**调：
   * 先订阅后注入的话，注入那批档案会被 diff 当成"新变化"整批回写一遍（无害但白费 IPC）。
   * 返回 stop；重复 start 是 no-op。
   */
  start(): () => void;
  /** 退订 + 立即冲刷未落盘的站位缓冲（尽力而为，失败只警告）。 */
  stop(): void;
  /** 仅供单测观测：当前缓冲里待落库的站位数。 */
  readonly pendingPositionCount: number;
}

export function createGameSaveCoordinator(options: GameSaveCoordinatorOptions): GameSaveCoordinator {
  const api = options.api;
  const store = options.store ?? worldStore;
  const debounceMs = options.debounceMs ?? 3000;

  // 已入库档案的引用台账：CharacterView 是不可变对象，字段变了就是新引用 ——
  // 按「同 id 比引用」diff，只把真变了的那几条送去 IPC（全量回写既慢也会把 created_at 语义搅浑）。
  const knownCharacters = new Map<string, CharacterView>();
  let lastCharactersRef: readonly CharacterView[] = [];
  // 站位缓冲：characterId → 最新坐标（同一单位高频上报只留最后一个）。
  const positionBuffer = new Map<string, PersistedUnitPosition>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stops: Unsubscribe[] = [];

  const warn = (message: string, error: unknown): void => {
    console.warn(`[GameSave] ${message}`, error);
  };

  const flushPositions = (): void => {
    flushTimer = null;
    if (positionBuffer.size === 0) return;
    const entries = Array.from(positionBuffer.values());
    positionBuffer.clear();
    api
      .saveUnitPositions(entries)
      .then((result) => {
        if (!result.ok) warn('站位落库被拒', result.error ?? 'unknown');
      })
      .catch((error) => warn('站位落库失败', error));
  };

  const scheduleFlush = (): void => {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(flushPositions, debounceMs);
  };

  const restore = async (): Promise<RestoreInjection> => {
    try {
      const result = await api.loadSnapshot();
      if (!result.ok) {
        warn(`读档被拒，降级为空世界：${result.error ?? 'unknown'}`, '');
        return { characters: [], units: [], positionsByUnitId: new Map() };
      }
      return buildRestoreInjection(result);
    } catch (error) {
      // IPC 通道本身不通（非 Electron / 主进程异常）：同样降级，不阻塞启动。
      warn('读档失败，降级为空世界', error);
      return { characters: [], units: [], positionsByUnitId: new Map() };
    }
  };

  const start = (): (() => void) => {
    if (running) return stop;
    running = true;

    // 台账初始化为当前状态：注入过的档案不算"新变化"（见 start 的 JSDoc 时序要求）。
    lastCharactersRef = store.getState().characters;
    knownCharacters.clear();
    for (const character of lastCharactersRef) knownCharacters.set(character.id, character);

    const offState = onState((state) => {
      if (state.characters === lastCharactersRef) return;
      lastCharactersRef = state.characters;

      // 按 id 比引用找变化项（新增 + 字段被改写的）。core 的不可变更新保证：没变的还是旧引用。
      const changed: PersistedCharacterRecord[] = [];
      for (const character of state.characters) {
        if (knownCharacters.get(character.id) === character) continue;
        knownCharacters.set(character.id, character);
        changed.push(characterViewToRecord(character, Date.now()));
      }
      // 台账收缩（角色被删）目前契约里没有命令路径，不处理 —— 真出现时 Known 台账会留旧项，
      // 影响仅是"同 id 重建角色时少一次回写"，无害。
      if (changed.length === 0) return;

      api
        .saveCharacters(changed)
        .then((result) => {
          if (!result.ok) warn('档案落库被拒', result.error ?? 'unknown');
        })
        .catch((error) => warn('档案落库失败', error));
    });

    const offWorld = onWorldEvent((event) => {
      if (event.type !== 'unit.position') return;
      const characterId = characterIdFromUnitId(event.unitId);
      // 非角色单位（无前缀）或台账外单位不入库：unit_positions 的键必须是真实角色。
      if (characterId === null || !knownCharacters.has(characterId)) return;
      positionBuffer.set(characterId, { characterId, x: event.x, y: event.y });
      scheduleFlush();
    });

    stops = [
      () => {
        offState();
        offWorld();
      },
    ];
    return stop;
  };

  const stop = (): void => {
    if (!running) return;
    running = false;
    stops.forEach((off) => off());
    stops = [];
    // 页面卸载前把缓冲里的站位冲出去（尽力而为；IPC 不通就认了，下轮启动会有 3s 内的站位回退）。
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushPositions();
    }
    knownCharacters.clear();
  };

  return {
    restore,
    start,
    stop,
    get pendingPositionCount() {
      return positionBuffer.size;
    },
  };
}
