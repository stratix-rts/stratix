/**
 * 单测：切副本的 `InstanceLoaderPort` 实现（app/services/persistence/instance-loader.ts
 * + instance-loader-node.ts，task_179 / M1-05）。
 *
 * 驱动说明：与既有持久化单测同一策略 —— 用**真实的 sql.js 适配器**（生产同款）开临时文件库，
 *   行是真的写进去再读回来的（mock 掉连接等于把实现一起 mock 掉了）。
 *   store 用 core 的 `createStore()` 隔离（不碰 worldStore 单例）。
 *
 * 覆盖（design §7.1 M1-05 行的三条验收 + 失败语义）：
 *   ① 载入后 store.getState() **只有**该 instance 的实体；
 *   ② 载入**不做增量合并**（旧实例的实体一个不剩）；
 *   ③ 默认沙盒 inspect **恒 pathOk: true**（即使目录已删）；
 *   ＋ unload 清空；＋ load 的三类拒绝（不存在 / 已归档 / 路径不可达）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { createStore } from '../../../core/store';
import {
  DEFAULT_INSTANCE_ID,
  type CharacterView,
  type MissionView,
  type ProjectInstanceView,
} from '../../../core/types';
import {
  createInMemoryInstanceRegistry,
  createInstanceLoader,
  createStoreMissionsProvider,
} from '../../services/persistence/instance-loader';
import {
  createSqliteInstanceDataSource,
  nodePathExists,
} from '../../services/persistence/instance-loader-node';
import {
  ensureGameSaveTables,
  upsertCharacters,
  type PersistedCharacterRecord,
} from '../../services/persistence/game-save-dao';
import { upsertSessionRecord } from '../../services/persistence/session-dao';
import {
  ensureCharacterTasksTable,
  upsertTask,
} from '../../services/persistence/task-record-dao';

// ============================================================================
// 夹具
// ============================================================================

function character(patch: Partial<PersistedCharacterRecord> = {}): PersistedCharacterRecord {
  return {
    id: 'ch-1',
    name: '阿青',
    agentKind: 'claude',
    persona: '沉稳的斥候',
    level: 3,
    exp: 120,
    appearanceJson: null,
    bodyType: null,
    skinId: null,
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1700000000000,
    ...patch,
  };
}

/** core 契约上的角色视图（与持久化行不同名：养成数值叫 experience）。 */
function characterView(patch: Partial<CharacterView> = {}): CharacterView {
  return {
    id: 'ch-view-1',
    name: '阿青',
    persona: '沉稳的斥候',
    level: 3,
    experience: 120,
    ...patch,
  };
}

function mission(patch: Partial<MissionView> = {}): MissionView {
  return {
    id: 'mission-1',
    title: '守住北门',
    phase: 'running',
    unitIds: ['unit_ch-1'],
    createdAt: 1700000000000,
    ...patch,
  };
}

function instanceView(patch: Partial<ProjectInstanceView> = {}): ProjectInstanceView {
  return {
    instanceId: 'wsp_x',
    projectId: 'spx_1',
    path: '/tmp/stratix-demo-wsp-x',
    title: '副本 X',
    lastOpenedAt: 1700000000000,
    pinned: false,
    archived: false,
    status: 'idle',
    ...patch,
  };
}

describe('InstanceLoaderPort 实现（task_179 / M1-05）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-instance-loader-')), 'loader.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureGameSaveTables(db);
    ensureCharacterTasksTable(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  /** 造一套「库里已有默认沙盒的数据」的环境（角色 / 任务 / 会话各一行 + 一条内存态 mission）。 */
  function seedSandboxRows(): void {
    upsertCharacters(db, [character(), character({ id: 'ch-2', name: '小满' })]);
    upsertTask(db, {
      id: 'task-1',
      characterId: 'ch-1',
      prompt: '侦察北门',
      status: 'completed',
      output: '北门无敌情。',
      createdAt: 1700000000000,
      startedAt: 1700000001000,
      endedAt: 1700000010000,
    });
    upsertSessionRecord(db, {
      id: 'sess-1',
      kind: 'character_chat',
      title: '与阿青的对话',
      participants: ['ch-1'],
      status: 'closed',
      refId: null,
      createdAt: 1700000000000,
      lastEventAt: 1700000010000,
      closedAt: 1700000010000,
      eventCount: 3,
    });
  }

  function makeLoader(options?: {
    store?: ReturnType<typeof createStore>;
    registry?: ReturnType<typeof createInMemoryInstanceRegistry>;
    pathExists?: (p: string) => boolean;
    missions?: readonly MissionView[];
  }) {
    const store = options?.store ?? createStore();
    const registry =
      options?.registry ??
      createInMemoryInstanceRegistry([
        instanceView({ instanceId: DEFAULT_INSTANCE_ID, path: '/tmp/does-not-exist', sandbox: true }),
      ]);
    const source = createSqliteInstanceDataSource(db, {
      missions: () => options?.missions ?? [],
    });
    const loader = createInstanceLoader({
      store,
      registry,
      source,
      pathExists: options?.pathExists ?? nodePathExists,
    });
    return { store, registry, loader };
  }

  // --------------------------------------------------------------------------
  // ③ 默认沙盒 inspect 恒 pathOk: true
  // --------------------------------------------------------------------------
  describe('inspect', () => {
    test('默认沙盒恒 exists + pathOk（即使目录已删 —— 拦了就等于存量数据不可达）', () => {
      // pathExists 恒 false = 所有目录都不存在（含默认沙盒那条路径）。
      const { loader } = makeLoader({ pathExists: () => false });

      const inspection = loader.inspect(DEFAULT_INSTANCE_ID);
      expect(inspection.exists).toBe(true);
      expect(inspection.archived).toBe(false);
      expect(inspection.pathOk).toBe(true);
    });

    test('默认沙盒在注册表里没有记录时依然可进（exists 恒 true，view 缺省）', () => {
      const { loader } = makeLoader({ registry: createInMemoryInstanceRegistry([]) });

      const inspection = loader.inspect(DEFAULT_INSTANCE_ID);
      expect(inspection.exists).toBe(true);
      expect(inspection.pathOk).toBe(true);
      expect(inspection.view).toBeUndefined();
    });

    test('普通实例：注册表查不到 ⇒ 不存在；已归档 ⇒ archived；路径不可达 ⇒ pathOk false', () => {
      const { loader } = makeLoader({
        registry: createInMemoryInstanceRegistry([
          instanceView({ instanceId: 'wsp_x', archived: true }),
          instanceView({ instanceId: 'wsp_y', path: '/tmp/gone' }),
        ]),
        pathExists: (p) => p !== '/tmp/gone',
      });

      expect(loader.inspect('wsp_missing').exists).toBe(false);
      expect(loader.inspect('wsp_x').archived).toBe(true);
      expect(loader.inspect('wsp_y').pathOk).toBe(false);
      expect(loader.inspect('wsp_x').exists).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // ① 载入后 store 只有该 instance 的实体
  // --------------------------------------------------------------------------
  describe('load', () => {
    test('载入后 store 里是该 instance 的整份实体（角色 / 单位 / 任务 / 会话 / 编组任务）', async () => {
      seedSandboxRows();
      const { store, loader } = makeLoader({ missions: [mission()] });

      await expect(loader.load(DEFAULT_INSTANCE_ID)).resolves.toEqual({ ok: true });

      const state = store.getState();
      expect(state.characters.map((c) => c.id)).toEqual(['ch-1', 'ch-2']);
      expect(state.units.map((u) => u.id)).toEqual(['unit_ch-1', 'unit_ch-2']);
      expect((state.tasks ?? []).map((t) => t.id)).toEqual(['task-1']);
      expect((state.sessions ?? []).map((s) => s.id)).toEqual(['sess-1']);
      expect(state.missions.map((m) => m.id)).toEqual(['mission-1']);
      // 实体带实例归属（下游按 instanceId 过滤 —— M1-10 的桥接层过滤靠它）。
      expect(state.characters.every((c) => c.instanceId === DEFAULT_INSTANCE_ID)).toBe(true);
      expect((state.tasks ?? []).every((t) => t.instanceId === DEFAULT_INSTANCE_ID)).toBe(true);
    });

    test('★ 不做增量合并：旧实例的实体一个不剩（全量替换）', async () => {
      seedSandboxRows();
      const store = createStore();
      // 先把「上一个副本」的实体塞进 store（模拟切副本前的内存态）。
      store.replaceEntities({
        missions: [mission({ id: 'mission-old', title: '旧副本的编组任务' })],
        tasks: [
          {
            id: 'task-old',
            characterId: 'ch-old',
            prompt: '旧副本的活',
            status: 'running',
            createdAt: 1,
            startedAt: 1,
            endedAt: null,
            output: '',
          },
        ],
        sessions: [
          {
            id: 'sess-old',
            kind: 'character_chat',
            title: '旧副本的会话',
            participants: [],
            status: 'closed',
            createdAt: 1,
            lastEventAt: 1,
            closedAt: 1,
            eventCount: 1,
          },
        ],
        characters: [characterView({ id: 'ch-old', name: '旧角色' })],
        units: [
          {
            id: 'unit_ch-old',
            name: '旧角色',
            status: 'idle',
            missionId: null,
            power: 0,
          },
        ],
      });

      const { loader } = makeLoader({ store, missions: [mission()] });
      await expect(loader.load(DEFAULT_INSTANCE_ID)).resolves.toEqual({ ok: true });

      const state = store.getState();
      expect(state.characters.map((c) => c.id)).toEqual(['ch-1', 'ch-2']);
      expect(state.units.map((u) => u.id)).toEqual(['unit_ch-1', 'unit_ch-2']);
      expect((state.tasks ?? []).map((t) => t.id)).toEqual(['task-1']);
      expect((state.sessions ?? []).map((s) => s.id)).toEqual(['sess-1']);
      expect(state.missions.map((m) => m.id)).toEqual(['mission-1']);
      // 旧副本的实体一个都不剩。
      expect(state.characters.some((c) => c.id === 'ch-old')).toBe(false);
      expect((state.tasks ?? []).some((t) => t.id === 'task-old')).toBe(false);
      expect((state.sessions ?? []).some((s) => s.id === 'sess-old')).toBe(false);
      expect(state.missions.some((m) => m.id === 'mission-old')).toBe(false);
      expect(state.units.some((u) => u.id === 'unit_ch-old')).toBe(false);
    });

    test('零 DDL 期：别的副本没有行 ⇒ 载入后是空世界（不编造数据）', async () => {
      seedSandboxRows();
      const { store, loader } = makeLoader({
        registry: createInMemoryInstanceRegistry([
          instanceView({ instanceId: DEFAULT_INSTANCE_ID, path: '/tmp/does-not-exist', sandbox: true }),
          instanceView({ instanceId: 'wsp_x' }),
        ]),
        pathExists: () => true,
      });

      await expect(loader.load('wsp_x')).resolves.toEqual({ ok: true });
      const state = store.getState();
      expect(state.characters).toEqual([]);
      expect(state.units).toEqual([]);
      expect(state.tasks).toEqual([]);
      expect(state.sessions).toEqual([]);
      expect(state.missions).toEqual([]);
    });

    test('拒绝语义：实例不存在 / 已归档 / 路径不可达 —— 失败用返回值表达且不改 store', async () => {
      seedSandboxRows();
      const store = createStore();
      const { loader } = makeLoader({
        store,
        registry: createInMemoryInstanceRegistry([
          instanceView({ instanceId: 'wsp_x', archived: true }),
          instanceView({ instanceId: 'wsp_y', path: '/tmp/gone' }),
        ]),
        pathExists: (p) => p !== '/tmp/gone',
      });

      await expect(loader.load('wsp_missing')).resolves.toEqual({
        ok: false,
        reason: 'instance-missing',
      });
      await expect(loader.load('wsp_x')).resolves.toEqual({
        ok: false,
        reason: 'instance-archived',
      });
      await expect(loader.load('wsp_y')).resolves.toEqual({
        ok: false,
        reason: 'path-unreachable',
      });
      // 拒绝 ⇒ store 不动。
      expect(store.getState().characters).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // unload：清空
  // --------------------------------------------------------------------------
  describe('unload', () => {
    test('卸载后五类实体全空（离开副本 = 丢弃内存态）', async () => {
      seedSandboxRows();
      const { store, loader } = makeLoader({ missions: [mission()] });

      await loader.load(DEFAULT_INSTANCE_ID);
      await expect(loader.unload(DEFAULT_INSTANCE_ID)).resolves.toEqual({ ok: true });

      const state = store.getState();
      expect(state.characters).toEqual([]);
      expect(state.units).toEqual([]);
      expect(state.tasks).toEqual([]);
      expect(state.sessions).toEqual([]);
      expect(state.missions).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // mission 的来源（纯内存态）
  // --------------------------------------------------------------------------
  describe('mission 来源', () => {
    test('mission 按实例过滤：缺省 instanceId 归默认沙盒，别副本的编组任务不串进来', () => {
      seedSandboxRows();
      const store = createStore();
      store.replaceEntities({
        missions: [
          mission({ id: 'mission-sandbox' }),
          mission({ id: 'mission-other', instanceId: 'wsp_x' }),
        ],
        tasks: [],
        sessions: [],
        characters: [],
        units: [],
      });

      const provider = createStoreMissionsProvider(store);
      expect(provider(DEFAULT_INSTANCE_ID).map((m) => m.id)).toEqual(['mission-sandbox']);
      expect(provider('wsp_x').map((m) => m.id)).toEqual(['mission-other']);
    });
  });
});
