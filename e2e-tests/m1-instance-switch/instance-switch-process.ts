/**
 * 文件职责：**M1 端到端验收的战场侧进程**（@since v3.3，task_190 / docs/DESIGN-project-map.md §7.1「M1-16」行）。
 *
 * ============ 这一单验什么 ============
 *   进默认沙盒 → 造单位 / 任务 → 切到第二个副本 → 断言**无残留**
 *   （单位表空、地图槽归零、种子键分家）→ 切回 → 断言数据**还在**（不是被清空）。
 *
 * ============ 走的是真链路（不是单点）============
 *   core 总线派单（`project.enter` / `project.exit`）→ core runtime 裁决
 *   → app 侧装载端口读库 → store 全量替换 → state 广播 → world 桥接层按副本过滤
 *   → 战场场景重建（Phaser 场景生命周期）→ 表现态板显式析构。
 *   组合根是**生产组合根** `createStratixService` + **生产端口实现**
 *   （`createInstanceLoader` / `createSqliteInstanceDataSource` / `createProjectArchive`），
 *   装配顺序照抄 `src/stratix-gateway/service/boot.ts` —— 不是本文件自己拼一套近似的路。
 *
 * ============ 只有三处是「替身 / 注入」，且都是生产里本来就有的接缝 ============
 *   ① **Phaser 本身**：node 里跑不了 Phaser ⇒ 换成最小桩（phaser-stub.ts）——
 *      被替掉的只有渲染 / 输入 / 动画，场景的**业务逻辑一行没改**（跑的是真类）。
 *      场景生死按 **Phaser 3.90 的真实语义**复刻（scene-manager-stub.ts）：
 *      `start` ⇒ 已在跑则先 shutdown 再 init→create；**场景实例被复用**（残留的根因）。
 *   ② **CLI 二进制**：换成「只回报所见」的替身（fake-cli.ts）——
 *      真 claude 二进制不在本机、也不该在验收里真花钱；被替的**只有最后一跳**。
 *   ③ **渲染侧存档 IPC 那一跳**：换成直连 DAO（与 `src/electron/main.ts` 的
 *      `game:saveCharacters` / `game:saveUnitPositions` / `game:loadSnapshot` handler
 *      **同一个函数**）—— 渲染层没有 fs 能力，生产里那一跳是 IPC，本进程里没有渲染层。
 *      被换掉的只是**传输**，落库口径一字未改。
 *
 * ============ 两个进程（不是一次跑完）============
 *   `SX_M1_PHASE=seed`   —— 造数据：进默认沙盒 → 建角色（= 造单位）→ 派一单（= 造任务）
 *                          → 右击移动（= 造站位）→ 全部真落库。
 *   `SX_M1_PHASE=switch` —— **重启读档**（等价组合根 preBoot：读档 → 站位种子按副本分区）
 *                          → 进默认沙盒 → 切第二个副本 → 切回 → 逐段如实回报所见。
 *   why 分两个进程：站位种子是**启动读档**时写进 registry 的（组合根 preBoot）——
 *   同一个进程里造完数据再切副本，读档那一步就没发生过，种子分区根本无从验。
 *   分进程 = 真的重启一次，读档走的是**生产代码**（game-save-coordinator + 一次性迁移）。
 *
 * 输入（环境变量）：
 *   `SX_M1_WORKDIR`          临时工作目录（默认沙盒 = 进程 cwd 快照 ⇒ 库与沙盒都在这儿）；
 *   `SX_M1_INSTANCE_B_ROOT`  第二个副本的根目录（夹具拷过去的副本）；
 *   `SX_M1_PHASE`            `seed` | `switch`；
 *   `SX_M1_RESULT_FILE`      结果 JSON 落盘路径。
 * 输出：一个结果 JSON（落盘）+ stdout 一行 `SX_M1_RESULT_OK`。
 * 禁止事项：
 *   1. 断言 —— 断言在驱动脚本（m1-instance-switch.e2e.mjs）里，本文件只**如实回报所见**；
 *   2. 改生产行为 —— 本文件只接线，不改 core / service 的语义；
 *   3. 跳过真实落库 —— 「零 DDL」验的是**结构**，前提是数据真的写进去了。
 *
 * @since v3.3，task_190。
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  createInstanceRegistryWithDefaultSandbox,
  publishProjectInstances,
} from '../../src/app/services/persistence/default-sandbox';
import {
  nodeProcessCwd,
  nodeProcessGitBranch,
} from '../../src/app/services/persistence/default-sandbox-node';
import { positionSeedOwner } from '../../src/app/services/persistence/character-record';
import {
  createGameSaveCoordinator,
  type GameSaveApi,
} from '../../src/app/services/persistence/game-save-coordinator';
import {
  ensureGameSaveTables,
  loadGameSnapshot,
  upsertCharacters,
  upsertUnitPositions,
  type SqliteDatabaseLike,
} from '../../src/app/services/persistence/game-save-dao';
import {
  createInstanceLoader,
  createStoreMissionsProvider,
} from '../../src/app/services/persistence/instance-loader';
import {
  createSqliteInstanceDataSource,
  nodePathExists,
} from '../../src/app/services/persistence/instance-loader-node';
import { createProjectArchive } from '../../src/app/services/persistence/project-archive';
import {
  createInstanceRootResolver,
  createNodeArchiveAppender,
} from '../../src/app/services/persistence/project-archive-node';
import { emitCommand, emitState, onWorldEvent } from '../../src/core/bus';
import { worldStore } from '../../src/core/store';
import {
  DEFAULT_INSTANCE_ID,
  type Point,
  type ProjectInstanceId,
  type ProjectInstanceView,
  type WorldEvent,
} from '../../src/core/types';
import { destroyDatabase, getDatabase } from '../../src/stratix-database';
import { createStratixService } from '../../src/stratix-gateway/service';
import { createServiceStorage } from '../../src/stratix-gateway/service/storage';
import {
  LEGACY_UNIT_POSITION_SEED_KEY,
  migrateLegacyPositionSeed,
  unitPositionSeedKey,
} from '../../src/world/objects/unit-registry';
import {
  BATTLEFIELD_SCENE_KEY,
  BattlefieldScene,
} from '../../src/world/scenes/BattlefieldScene';
import { LOBBY_SCENE_KEY, LobbyScene } from '../../src/world/scenes/LobbyScene';
import { switchToBattlefield, switchToLobby } from '../../src/world/scenes/scene-switch';

import { createReportTransportFactory } from './fake-cli';
import { StubSceneManager } from './scene-manager-stub';

// ============================================================================
// 环境变量入口
// ============================================================================

const WORKDIR = process.env.SX_M1_WORKDIR ?? '';
const INSTANCE_B_ROOT = process.env.SX_M1_INSTANCE_B_ROOT ?? '';
const RESULT_FILE = process.env.SX_M1_RESULT_FILE ?? '';
const PHASE = process.env.SX_M1_PHASE ?? 'switch';

/** 第二个副本的实例 id（注册表里的一条记录；M1 的内存态注册表由本进程物化）。 */
const INSTANCE_B_ID: ProjectInstanceId = 'wsp_instance_b';

/** 等命令落地的超时（毫秒）—— 替身秒回，正常远快于此。 */
const WAIT_TIMEOUT_MS = 60_000;

// ============================================================================
// 小工具
// ============================================================================

/** 睡一会儿（毫秒）。 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 轮询直到 fn 返回真值；超时抛错。 */
async function waitFor(label: string, fn: () => boolean): Promise<void> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (fn()) return;
    await sleep(25);
  }
  throw new Error(`等「${label}」超时`);
}

// ============================================================================
// 白盒观测（私有表现态；仓库既有做法见 src/world/__tests__/battlefield-scene-reset.test.ts）
// ============================================================================

interface UnitRegistryView {
  readonly size: number;
  readonly restoredPositions?: ReadonlyMap<string, Point>;
  list(): readonly { readonly id: string; readonly position: Point }[];
}

interface SceneInternals {
  readonly units: UnitRegistryView;
  readonly mapBoard: { readonly nextSlot: number };
  readonly instanceId: string | null;
}

/** 场景的私有表现态（单位表 / 地图槽 / 本次进入的副本 id）。 */
function internalsOf(scene: unknown): SceneInternals {
  return scene as unknown as SceneInternals;
}

/** 一段观测：store + 战场场景 + 键仓。 */
interface Observation {
  readonly activeInstanceId: string | null;
  readonly store: {
    readonly units: number;
    readonly characters: number;
    readonly tasks: number;
    readonly missions: number;
  };
  readonly scene: {
    readonly battlefieldRunning: boolean;
    readonly lobbyRunning: boolean;
    readonly units: number;
    readonly nextSlot: number;
    readonly instanceId: string | null;
    /** 场景此刻拿着的站位种子键（单位 id 清单）—— 空 = 没拿到任何种子。 */
    readonly seedUnitIds: readonly string[];
    /** 战场上每个单位的坐标（单位 id → 坐标）。 */
    readonly unitPositions: Record<string, { x: number; y: number }>;
  };
  /** 键仓里的站位种子键（键名清单）—— 看「种子键分家」用。 */
  readonly registryKeys: readonly string[];
  /** 旧全局键还在不在（在 = 迁移没做干净 ⇒ 留着回落口）。 */
  readonly legacySeedPresent: boolean;
  /** 默认沙盒那个分区键里装着的单位 id 清单。 */
  readonly sandboxSeedUnitIds: readonly string[];
}

/** 键仓（Phaser game.registry 的形状）。 */
interface SeedRegistry {
  get(key: string): unknown;
  set(key: string, value: unknown): unknown;
  remove(key: string): void;
  keys(): string[];
}

/** 取一份完整观测。 */
function observe(sceneManager: StubSceneManager, registry: SeedRegistry): Observation {
  const state = worldStore.getState();
  const battlefield = sceneManager.get(BATTLEFIELD_SCENE_KEY);
  const internals = battlefield ? internalsOf(battlefield) : null;
  const restored = internals?.units.restoredPositions;
  const positions: Record<string, { x: number; y: number }> = {};
  for (const unit of internals?.units.list() ?? []) {
    positions[unit.id] = { x: unit.position.x, y: unit.position.y };
  }
  const sandboxSeed = registry.get(unitPositionSeedKey(DEFAULT_INSTANCE_ID));
  return {
    activeInstanceId: state.activeInstanceId ?? null,
    store: {
      units: state.units.length,
      characters: state.characters.length,
      tasks: state.tasks?.length ?? 0,
      missions: state.missions.length,
    },
    scene: {
      battlefieldRunning: sceneManager.isRunning(BATTLEFIELD_SCENE_KEY),
      lobbyRunning: sceneManager.isRunning(LOBBY_SCENE_KEY),
      units: internals?.units.size ?? 0,
      nextSlot: internals?.mapBoard.nextSlot ?? 0,
      instanceId: internals?.instanceId ?? null,
      seedUnitIds: restored ? [...restored.keys()] : [],
      unitPositions: positions,
    },
    registryKeys: registry.keys(),
    legacySeedPresent: registry.get(LEGACY_UNIT_POSITION_SEED_KEY) !== undefined,
    sandboxSeedUnitIds:
      sandboxSeed instanceof Map ? [...(sandboxSeed as Map<string, Point>).keys()] : [],
  };
}

// ============================================================================
// 装配（照抄 src/stratix-gateway/service/boot.ts 的顺序）
// ============================================================================

interface Harness {
  readonly sceneManager: StubSceneManager;
  readonly registry: SeedRegistry;
  readonly db: SqliteDatabaseLike;
  readonly stop: () => void;
}

/** 第二个副本的注册表条目（路径 = 夹具目录 ⇒ 勘察「路径在？」为真）。 */
function instanceBView(): ProjectInstanceView {
  return {
    instanceId: INSTANCE_B_ID,
    projectId: 'spx_m1b_7d2f9a4c6b8e1d30f5a2c7b',
    path: INSTANCE_B_ROOT,
    title: '荒原哨站',
    lastOpenedAt: 0,
    pinned: false,
    archived: false,
    status: 'idle',
  };
}

async function bootstrap(): Promise<Harness> {
  // ===== ⓪ 开库（真库；建在临时目录，不碰用户的真实库）=====
  const storage = await createServiceStorage({ dataDir: path.join(WORKDIR, 'db') });
  const db = getDatabase().getDatabase() as unknown as SqliteDatabaseLike;

  // ===== ⓪' 默认沙盒物化 + 第二个副本登记（注册表恒含沙盒）=====
  const instanceRegistry = createInstanceRegistryWithDefaultSandbox({
    cwd: nodeProcessCwd(),
    branch: nodeProcessGitBranch(),
    views: [instanceBView()],
  });

  // ===== ① 组合根 + 副本端口（M1-07 的装配，照抄 boot.ts）=====
  const instanceLoader = createInstanceLoader({
    store: worldStore,
    registry: instanceRegistry,
    source: createSqliteInstanceDataSource(db, {
      missions: createStoreMissionsProvider(worldStore),
    }),
    pathExists: nodePathExists,
  });
  const projectArchive = createProjectArchive({
    missions: createStoreMissionsProvider(worldStore),
    resolveInstanceRoot: createInstanceRootResolver(instanceRegistry),
    appender: createNodeArchiveAppender(),
  });
  const service = createStratixService({
    store: worldStore,
    storage,
    taskExecution: { createTransport: createReportTransportFactory() },
    instanceLoader,
    projectArchive,
    logger: (line: string): void => console.log(`[m1] ${line}`),
  });
  // 实例清单进世界态（大厅卡片的数据源）—— 一次写入 = 一次广播。
  publishProjectInstances(worldStore, instanceRegistry);

  // ===== ② 战场层：Phaser 桩 + 真场景类 =====
  const sceneManager = new StubSceneManager();
  sceneManager.add(BATTLEFIELD_SCENE_KEY, BattlefieldScene as never);
  sceneManager.add(LOBBY_SCENE_KEY, LobbyScene as never);
  // 场景管理器端口（Phaser 的 SceneManager 形状）—— 组合根只认这个调用面。
  const scenePort = sceneManager as unknown as Parameters<typeof switchToBattlefield>[0];

  // ===== ③ 场景切换接线（照抄组合根 main-entry 的那一段）=====
  // project.changed（唯一权威信号）⇒ 大厅 ⇄ 战场互斥切换；场景重建后补发一次当前态。
  const stopSceneSwitch = onWorldEvent((event: WorldEvent): void => {
    if (event.type !== 'project.changed') return;
    if (event.instanceId === null) {
      switchToLobby(scenePort);
      return;
    }
    switchToBattlefield(scenePort, event.instanceId);
    emitState(worldStore.getState());
  });

  const stop = (): void => {
    stopSceneSwitch();
    service.stop();
    destroyDatabase();
  };

  return { sceneManager, registry: sceneManager.registry as unknown as SeedRegistry, db, stop };
}

// ============================================================================
// 渲染侧存档通道（IPC 那一跳换成直连 DAO；函数与 electron/main.ts 的 handler 同源）
// ============================================================================

function createLocalSaveApi(db: SqliteDatabaseLike): GameSaveApi {
  return {
    loadSnapshot: async () => {
      ensureGameSaveTables(db);
      return { ok: true, ...loadGameSnapshot(db) };
    },
    saveCharacters: async (records) => {
      ensureGameSaveTables(db);
      upsertCharacters(db, records);
      return { ok: true };
    },
    saveUnitPositions: async (entries) => {
      ensureGameSaveTables(db);
      upsertUnitPositions(db, entries);
      return { ok: true };
    },
  };
}

// ============================================================================
// 剧本
// ============================================================================

/** world 通道上见过的全部事件（按到达顺序）。 */
const seenEvents: WorldEvent[] = [];

/**
 * 等一条 project.changed（instanceId 匹配）。
 * @param expected 期望的副本 id（null = 退出副本 / 大厅态）
 * @param fromIndex 从第几条开始找（前面的已消费）
 */
async function waitForProjectChanged(
  expected: ProjectInstanceId | null,
  fromIndex: number
): Promise<number> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (let index = fromIndex; index < seenEvents.length; index += 1) {
      const event = seenEvents[index];
      if (event.type === 'project.changed' && event.instanceId === expected) return index + 1;
    }
    await sleep(25);
  }
  throw new Error(`等 project.changed(${expected ?? 'null'}) 超时`);
}

/** 读一条库里的一行计数。 */
function countRows(db: SqliteDatabaseLike, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 读一条库里的站位行。 */
function readUnitPosition(
  db: SqliteDatabaseLike,
  characterId: string
): { x: number; y: number } | null {
  const row = db
    .prepare('SELECT x, y FROM unit_positions WHERE character_id = ?')
    .get(characterId) as { x?: number; y?: number } | undefined;
  if (!row) return null;
  return { x: Number(row.x ?? 0), y: Number(row.y ?? 0) };
}

/** 读一条库里的任务行（完整往返：从库里捞子进程的回报）。 */
function readTaskRow(
  db: SqliteDatabaseLike,
  taskId: string
): { status: string; output: string } | null {
  const row = db
    .prepare('SELECT status, output FROM character_tasks WHERE id = ?')
    .get(taskId) as { status?: string; output?: string } | undefined;
  if (!row) return null;
  return { status: String(row.status ?? ''), output: String(row.output ?? '') };
}

/** `sqlite_master` 全量行（库结构的权威快照；**字节比较**用）。 */
function dumpSchema(db: SqliteDatabaseLike): Record<string, unknown>[] {
  return db
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
    .all() as Record<string, unknown>[];
}

async function runSeedPhase(harness: Harness): Promise<Record<string, unknown>> {
  const { sceneManager, registry, db } = harness;

  // ===== ① 读档（组合根 preBoot 的那一段；此刻库里是空的）=====
  const saveApi = createLocalSaveApi(db);
  const coordinator = createGameSaveCoordinator({
    api: saveApi,
    store: worldStore,
    debounceMs: 50,
  });
  const injection = await coordinator.restore();
  // 站位种子分区（组合根 preBoot：先落旧全局键，再一次性迁移，迁完删旧键）。
  registry.set(LEGACY_UNIT_POSITION_SEED_KEY, injection.positionsByUnitId);
  migrateLegacyPositionSeed(registry, {
    ownerOf: positionSeedOwner(injection),
    fallbackInstanceId: DEFAULT_INSTANCE_ID,
  });
  coordinator.start();

  // ===== ② 开机进战场（Phaser 场景数组第一个）+ 补发一次当前态 =====
  sceneManager.start(BATTLEFIELD_SCENE_KEY, {});
  emitState(worldStore.getState());

  // ===== ③ 进默认沙盒（真实命令链路）=====
  emitCommand({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
  let cursor = await waitForProjectChanged(DEFAULT_INSTANCE_ID, 0);

  // ===== ④ 造单位：建角色（= 战场上多一个 agent 单位）=====
  // 出队守门读 detectedAgents（真相源 = store；生产由探测器写入）。
  worldStore.setDetectedAgents([
    { kind: 'claude-code', tier: 'T1', installed: true, status: 'installed', version: null, path: null },
  ]);
  const characterName = '验收角色';
  emitCommand({
    type: 'character.create',
    name: characterName,
    agentKind: 'claude-code',
    skinId: 'skin-default',
    persona: '你是验收角色，负责在默认沙盒里跑一单并如实回报。',
  });
  await waitFor('角色建档（store 里出现角色与它的单位）', () => {
    const state = worldStore.getState();
    return state.characters.length > 0 && state.units.length > 0;
  });
  const character = worldStore.getState().characters[0];
  const unit = worldStore.getState().units[0];
  // 档案真落库（渲染侧存档通道 ⇒ characters 表）。
  await waitFor('角色档案落库（characters 表）', () => countRows(db, 'characters') >= 1);

  // ===== ⑤ 造任务：派一单（真派发链：core → task-service → 真子进程 → 真落库）=====
  emitCommand({
    type: 'task.assign',
    characterId: character.id,
    prompt: '汇报当前项目概况。',
  });
  await waitFor('任务落到 store', () => (worldStore.getState().tasks?.length ?? 0) > 0);
  const task = worldStore.getState().tasks?.[0];
  if (!task) throw new Error('任务已落到 store，却仍取不到任务行');
  await waitFor('任务跑完（终态）', () => {
    const item = worldStore.getState().tasks?.find((entry) => entry.id === task.id);
    return item?.status === 'completed' || item?.status === 'failed' || item?.status === 'cancelled';
  });
  await waitFor('任务落库（character_tasks 表）', () => countRows(db, 'character_tasks') >= 1);

  // ===== ⑥ 造站位：右击移动（core 广播 unit.position ⇒ app 层防抖落 unit_positions）=====
  // why 等「落库值 == 移动终点」而不是「表里有行」：角色建档时战场会**上报一次出生点**
  //   （场景 syncUnits 的落位上报）⇒ 表里早就有行了；等终点值才是真的「移动落库了」。
  const moveTarget = { x: 640, y: 360 };
  emitCommand({ type: 'unit.move', unitIds: [unit.id], x: moveTarget.x, y: moveTarget.y });
  await waitFor('站位落库（unit_positions 表里的坐标 = 移动终点）', () => {
    const current = readUnitPosition(db, character.id);
    return current !== null && current.x === moveTarget.x && current.y === moveTarget.y;
  });
  await waitFor('站位冲刷完成（缓冲清空）', () => coordinator.pendingPositionCount === 0);
  const position = readUnitPosition(db, character.id);

  const taskRow = readTaskRow(db, task.id);
  let report: { marker?: string; cwd?: string; prompt?: string } | null = null;
  try {
    report = JSON.parse(taskRow?.output ?? '');
  } catch {
    report = null;
  }

  coordinator.stop();

  return {
    phase: 'seed',
    characterId: character.id,
    unitId: unit.id,
    taskId: task.id,
    taskStatus: worldStore.getState().tasks?.find((entry) => entry.id === task.id)?.status ?? '',
    persistedTaskStatus: taskRow?.status ?? '',
    taskOutput: taskRow?.output ?? '',
    cliMarker: report?.marker ?? '',
    cliCwd: report?.cwd ?? '',
    position,
    dbCounts: {
      characters: countRows(db, 'characters'),
      unitPositions: countRows(db, 'unit_positions'),
      characterTasks: countRows(db, 'character_tasks'),
    },
    projectChangedSeen: seenEvents
      .filter((event) => event.type === 'project.changed')
      .map((event) => (event as { instanceId: string | null }).instanceId),
    cursor,
  };
}

async function runSwitchPhase(harness: Harness): Promise<Record<string, unknown>> {
  const { sceneManager, registry, db } = harness;

  // ===== ① 启动读档（组合根 preBoot 的那一段，逐行照抄）=====
  const saveApi = createLocalSaveApi(db);
  const coordinator = createGameSaveCoordinator({
    api: saveApi,
    store: worldStore,
    debounceMs: 50,
  });
  const injection = await coordinator.restore();
  // 恢复的单位要先于首次 state 广播进 store（否则场景先按网格落位、后到注入，同一单位出现两次落位事件）。
  if (injection.characters.length > 0) {
    worldStore.setState((current) => {
      const existingIds = new Set(current.units.map((unit) => unit.id));
      const restoredUnits = injection.units.filter((unit) => !existingIds.has(unit.id));
      return {
        ...current,
        characters: [...injection.characters],
        units: [...current.units, ...restoredUnits],
      };
    });
  }
  // 站位种子分区：旧全局键 → 各副本的新键，迁完**删掉旧键**（不留回落口）。
  registry.set(LEGACY_UNIT_POSITION_SEED_KEY, injection.positionsByUnitId);
  migrateLegacyPositionSeed(registry, {
    ownerOf: positionSeedOwner(injection),
    fallbackInstanceId: DEFAULT_INSTANCE_ID,
  });
  coordinator.start();

  // ===== ② 开机进战场 + 补发一次当前态 =====
  sceneManager.start(BATTLEFIELD_SCENE_KEY, {});
  emitState(worldStore.getState());
  const boot = observe(sceneManager, registry);

  // ===== ③ 进默认沙盒（真实命令链路）=====
  emitCommand({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
  let cursor = await waitForProjectChanged(DEFAULT_INSTANCE_ID, 0);
  const inSandbox = observe(sceneManager, registry);

  // ===== ④ 切到第二个副本 =====
  emitCommand({ type: 'project.enter', instanceId: INSTANCE_B_ID });
  cursor = await waitForProjectChanged(INSTANCE_B_ID, cursor);
  const inInstanceB = observe(sceneManager, registry);

  // ===== ⑤ 退出副本（回大厅态）=====
  emitCommand({ type: 'project.exit' });
  cursor = await waitForProjectChanged(null, cursor);
  const exited = observe(sceneManager, registry);

  // ===== ⑥ 切回默认沙盒 =====
  emitCommand({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
  cursor = await waitForProjectChanged(DEFAULT_INSTANCE_ID, cursor);
  const backToSandbox = observe(sceneManager, registry);

  // ===== ⑦ 库里的数据（证明「切回后旧数据还在」，且没被清空）=====
  const dbCounts = {
    characters: countRows(db, 'characters'),
    unitPositions: countRows(db, 'unit_positions'),
    characterTasks: countRows(db, 'character_tasks'),
  };
  const schema = dumpSchema(db);
  const pragma = (db as unknown as { pragma(sql: string): unknown }).pragma('schema_version');

  // 第二个副本的根目录里有没有落下归档文件（没有未终结 mission ⇒ 不该有）。
  const historyDir = path.join(INSTANCE_B_ROOT, '.stratix', 'history');
  const archiveFiles = fs.existsSync(historyDir) ? fs.readdirSync(historyDir) : [];

  coordinator.stop();

  return {
    phase: 'switch',
    sandboxPath: nodeProcessCwd(),
    instanceBPath: INSTANCE_B_ROOT,
    boot,
    inSandbox,
    inInstanceB,
    exited,
    backToSandbox,
    // 宿主可见控制面（dsh「暴露」面向）：实例清单在世界里摊开着，宿主能看见、能进。
    instances: worldStore.getState().projectInstances ?? [],
    dbCounts,
    schema,
    pragma,
    archiveFiles,
    restoredSeedUnitIds: [...injection.positionsByUnitId.keys()],
    cursor,
  };
}

async function main(): Promise<void> {
  if (!WORKDIR || !INSTANCE_B_ROOT || !RESULT_FILE) {
    throw new Error(
      '缺少环境变量：SX_M1_WORKDIR / SX_M1_INSTANCE_B_ROOT / SX_M1_RESULT_FILE'
    );
  }
  // world 通道的事件留档（等 project.changed 用）。
  onWorldEvent((event: WorldEvent): void => {
    seenEvents.push(event);
  });

  const harness = await bootstrap();
  let result: Record<string, unknown>;
  try {
    result = PHASE === 'seed' ? await runSeedPhase(harness) : await runSwitchPhase(harness);
  } finally {
    harness.stop();
  }
  fs.writeFileSync(RESULT_FILE, JSON.stringify(result));
  process.stdout.write('SX_M1_RESULT_OK\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(
    `[m1-switch] 失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
  );
  process.exitCode = 1;
});
