/**
 * 单测：**默认沙盒物化**（app/services/persistence/default-sandbox.ts + 组合根接线，
 * task_181 / M1-07）。
 *
 * 覆盖 design §7.1 M1-07 行的三条验收要点：
 *   ① 大厅**能看到**默认沙盒卡 ⇒ 注册表恒含沙盒 + `WorldState.projectInstances` 恒含它；
 *   ② 旧数据（旧 `instance_id = NULL` 的行）**落在**默认沙盒名下（COALESCE 命中）；
 *   ③ `project.enter(DEFAULT_INSTANCE_ID)` **能进**（不被「路径在？」判否）。
 *
 * 驱动说明：与既有持久化单测同一策略 —— 用**真实的 sql.js 适配器**（生产同款）开临时文件库，
 *   行是真的写进去再读回来的（mock 掉连接等于把实现一起 mock 掉了）。
 *   store 用 core 的 `createStore()` 隔离（不碰 worldStore 单例）；core runtime 用**真**的
 *   （裁决的全部职责就是「接在总线上」，mock 掉总线等于把被测行为一起 mock 掉）。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { Database } from '@/stratix-database/sqlite-adapter';

import { emitCommand, onWorldEvent, resetBus, type Unsubscribe } from '../../../core/bus';
import { createCoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import {
  DEFAULT_INSTANCE_ID,
  type ProjectInstanceView,
  type WorldEvent,
} from '../../../core/types';
import {
  createInstanceRegistryWithDefaultSandbox,
  listInstancesWithDefaultSandbox,
  publishProjectInstances,
} from '../../services/persistence/default-sandbox';
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

const CWD = '/tmp/stratix-default-sandbox-cwd';

/** 一条角色档案（持久化行 —— **没有 instance 列**，即「旧数据」）。 */
function characterRecord(id: string, name: string): PersistedCharacterRecord {
  return {
    id,
    name,
    agentKind: 'claude-code',
    persona: '干活的',
    level: 2,
    exp: 30,
    appearanceJson: null,
    bodyType: null,
    skinId: 'skin-default',
    externalSessionId: null,
    contextEnabled: true,
    createdAt: 1,
  };
}

describe('默认沙盒物化（task_181 / M1-07）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    dbPath = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-default-sandbox-')),
      'sandbox.sqlite'
    );
    db = new Database(dbPath);
    await db.initialize();
    ensureGameSaveTables(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    resetBus();
  });

  // ==========================================================================
  // ① 沙盒注册：注册表恒含它 + 世界态恒含它（大厅有卡的数据源）
  // ==========================================================================
  describe('沙盒注册', () => {
    test('注册表恒含默认沙盒：instanceId / path（进程 cwd 快照）/ sandbox 标记', () => {
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: CWD });

      const sandbox = registry.get(DEFAULT_INSTANCE_ID);
      expect(sandbox).toBeDefined();
      expect(sandbox?.instanceId).toBe(DEFAULT_INSTANCE_ID);
      expect(sandbox?.path).toBe(CWD);
      expect(sandbox?.sandbox).toBe(true);
      expect(sandbox?.archived).toBe(false);
      // 大厅卡片的第一块内容（标题）固定。
      expect(sandbox?.title).toBe('默认沙盒');
      // 列表里也有它（大厅卡片网格的数据源）。
      expect(registry.list().map((view) => view.instanceId)).toContain(DEFAULT_INSTANCE_ID);
    });

    test('沙盒不可删除、不可归档（承载全部历史数据）', () => {
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: CWD });

      registry.remove(DEFAULT_INSTANCE_ID);
      expect(registry.get(DEFAULT_INSTANCE_ID)).toBeDefined();

      registry.upsert({
        instanceId: DEFAULT_INSTANCE_ID,
        projectId: 'spx_sandbox',
        path: CWD,
        title: '默认沙盒',
        lastOpenedAt: 0,
        pinned: false,
        archived: true,
        status: 'archived',
      });
      expect(registry.get(DEFAULT_INSTANCE_ID)?.archived).toBe(false);
      expect(registry.get(DEFAULT_INSTANCE_ID)?.sandbox).toBe(true);
    });

    test('发布进世界态 ⇒ WorldState.projectInstances 恒含默认沙盒（大厅有卡）', () => {
      const store = createStore();
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: CWD });
      registry.upsert({
        instanceId: 'wsp_x',
        projectId: 'spx_1',
        path: '/tmp/stratix-demo-wsp-x',
        title: '副本 X',
        lastOpenedAt: 2,
        pinned: false,
        archived: false,
        status: 'idle',
      });

      publishProjectInstances(store, registry);

      const instances = store.getState().projectInstances ?? [];
      expect(instances.map((view) => view.instanceId)).toContain(DEFAULT_INSTANCE_ID);
      const sandbox = instances.find((view) => view.instanceId === DEFAULT_INSTANCE_ID);
      expect(sandbox?.sandbox).toBe(true);
      expect(sandbox?.path).toBe(CWD);
      // 沙盒卡固定排最前（M1-14 的卡片网格按这个顺序渲染）。
      expect(instances[0]?.instanceId).toBe(DEFAULT_INSTANCE_ID);
      // 别的副本也在清单里（不止一张卡）。
      expect(instances.map((view) => view.instanceId)).toContain('wsp_x');
    });

    test('外来注册表漏登记沙盒 ⇒ 清单兜底补上（大厅恒有默认沙盒卡）', () => {
      const foreign = createInMemoryInstanceRegistry([
        {
          instanceId: 'wsp_x',
          projectId: 'spx_1',
          path: '/tmp/stratix-demo-wsp-x',
          title: '副本 X',
          lastOpenedAt: 2,
          pinned: false,
          archived: false,
          status: 'idle',
        } satisfies ProjectInstanceView,
      ]);

      const instances = listInstancesWithDefaultSandbox(foreign);
      expect(instances.map((view) => view.instanceId)).toContain(DEFAULT_INSTANCE_ID);
      expect(instances[0]?.instanceId).toBe(DEFAULT_INSTANCE_ID);
    });
  });

  // ==========================================================================
  // ② 旧数据归属：旧行（instance_id = NULL）落在默认沙盒名下（COALESCE 命中）
  // ==========================================================================
  describe('旧数据归属', () => {
    test('旧行（库里没有 instance 列）载入后归属默认沙盒（COALESCE 命中）', async () => {
      upsertCharacters(db, [characterRecord('ch-old-1', '存量角色')]);
      const store = createStore();
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: CWD });
      const loader = createInstanceLoader({
        store,
        registry,
        source: createSqliteInstanceDataSource(db, {
          missions: createStoreMissionsProvider(store),
        }),
        pathExists: nodePathExists,
      });

      await expect(loader.load(DEFAULT_INSTANCE_ID)).resolves.toEqual({ ok: true });

      const state = store.getState();
      expect(state.characters.map((character) => character.id)).toEqual(['ch-old-1']);
      // 归属 = 默认沙盒（COALESCE 口径：instance 缺省 ⇒ wsp_sandbox）。
      expect(state.characters.every((character) => character.instanceId === DEFAULT_INSTANCE_ID)).toBe(
        true
      );
      expect(state.units.every((unit) => unit.instanceId === DEFAULT_INSTANCE_ID)).toBe(true);
    });

    test('别的副本没有行（零 DDL 期）⇒ 不编造数据', async () => {
      upsertCharacters(db, [characterRecord('ch-old-2', '存量角色')]);
      const store = createStore();
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: CWD });
      // 登记第二个副本（路径存在 ⇒ 不是「实例缺失 / 路径不可达」，而是「库里没有它的行」）。
      registry.upsert({
        instanceId: 'wsp_x',
        projectId: 'spx_1',
        path: os.tmpdir(),
        title: '副本 X',
        lastOpenedAt: 0,
        pinned: false,
        archived: false,
        status: 'idle',
      });
      const loader = createInstanceLoader({
        store,
        registry,
        source: createSqliteInstanceDataSource(db, {
          missions: createStoreMissionsProvider(store),
        }),
        pathExists: nodePathExists,
      });

      await expect(loader.load('wsp_x')).resolves.toEqual({ ok: true });
      expect(store.getState().characters).toEqual([]);
    });
  });

  // ==========================================================================
  // ③ 可进入：project.enter(DEFAULT_INSTANCE_ID) 不被「路径在？」判否
  // ==========================================================================
  describe('可进入', () => {
    test('enter(DEFAULT_INSTANCE_ID) 能进：写 activeInstanceId + 广播一条 project.changed', async () => {
      upsertCharacters(db, [characterRecord('ch-enter-1', '存量角色')]);
      const store = createStore();
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: CWD });
      const loader = createInstanceLoader({
        store,
        registry,
        source: createSqliteInstanceDataSource(db, {
          missions: createStoreMissionsProvider(store),
        }),
        pathExists: nodePathExists,
      });
      const events: WorldEvent[] = [];
      const off: Unsubscribe = onWorldEvent((event) => events.push(event));
      const runtime = createCoreRuntime({ store, instanceLoader: loader });
      const stop = runtime.start();

      emitCommand({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
      await new Promise((resolve) => setImmediate(resolve));

      expect(store.getState().activeInstanceId).toBe(DEFAULT_INSTANCE_ID);
      const changed = events.filter((event) => event.type === 'project.changed');
      expect(changed).toHaveLength(1);
      expect(changed[0]).toEqual({ type: 'project.changed', instanceId: DEFAULT_INSTANCE_ID });
      expect(events.filter((event) => event.type === 'project.enter.failed')).toHaveLength(0);
      // 存量数据随进入回到世界态（不再「消失」）。
      expect(store.getState().characters.map((character) => character.id)).toEqual(['ch-enter-1']);

      stop();
      off();
    });

    test('沙盒路径不存在也照样能进（路径校验特例豁免：拦了就等于数据又不可达）', async () => {
      const store = createStore();
      const registry = createInstanceRegistryWithDefaultSandbox({ cwd: '/tmp/does-not-exist' });
      const loader = createInstanceLoader({
        store,
        registry,
        source: createSqliteInstanceDataSource(db),
        // 所有路径都不存在（含沙盒那条）。
        pathExists: () => false,
      });
      const events: WorldEvent[] = [];
      const off: Unsubscribe = onWorldEvent((event) => events.push(event));
      const runtime = createCoreRuntime({ store, instanceLoader: loader });
      const stop = runtime.start();

      emitCommand({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
      await new Promise((resolve) => setImmediate(resolve));

      expect(store.getState().activeInstanceId).toBe(DEFAULT_INSTANCE_ID);
      expect(events.filter((event) => event.type === 'project.enter.failed')).toHaveLength(0);

      stop();
      off();
    });
  });
});
