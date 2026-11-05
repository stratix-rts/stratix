/**
 * 文件职责：**默认沙盒在 service 组合根的接线**单测（task_181 / M1-07）——
 *   验「组合根接线」这一层（app/services/persistence/default-sandbox.ts 的单测见
 *   src/app/__tests__/persistence/default-sandbox.test.ts）：
 *     ① boot 后 `WorldState.projectInstances` **恒含默认沙盒** ⇒ 大厅有卡（数据在位）；
 *     ② boot 后 `project.enter(DEFAULT_INSTANCE_ID)` **能进** ⇒ 存量数据可达（R1-04）。
 * 输入：真 SQLite 文件库（临时目录，跑完删掉）+ 真的 core runtime。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. mock 掉数据库 —— 这里验的就是「真库真进副本」，mock 掉就什么都没验；
 *   2. 直接往 store 塞角色来「造」存量数据 —— 角色必须经**真实库**进来。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ensureGameSaveTables,
  upsertCharacters,
  type PersistedCharacterRecord,
  type SqliteDatabaseLike,
} from '../../../app/services/persistence/game-save-dao';
import { emitCommand, resetBus } from '../../../core/bus';
import { createStore } from '../../../core/store';
import { DEFAULT_INSTANCE_ID } from '../../../core/types';
import { destroyDatabase, initializeDatabase } from '../../../stratix-database';

import { bootStratixService } from '../boot';

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

describe('默认沙盒在 service 组合根的接线（task_181 / M1-07）', () => {
  let dir: string;
  let db: SqliteDatabaseLike;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-sandbox-boot-'));
    const database = await initializeDatabase({ dataDir: dir });
    db = database.getDatabase() as unknown as SqliteDatabaseLike;
    ensureGameSaveTables(db);
  });

  afterAll(() => {
    destroyDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  afterEach(() => {
    resetBus();
  });

  it('boot：实例清单恒含默认沙盒（大厅卡的数据源就位）', () => {
    const store = createStore();
    const booted = bootStratixService({ store, db, detectAgents: false });

    const instances = store.getState().projectInstances ?? [];
    const sandbox = instances.find((view) => view.instanceId === DEFAULT_INSTANCE_ID);
    expect(sandbox).toBeDefined();
    expect(sandbox?.sandbox).toBe(true);
    // path = 进程 cwd 快照（绝对路径 —— dsh 的 workspace 挂载要拿它比对 realpath）。
    expect(path.isAbsolute(sandbox?.path ?? '')).toBe(true);

    booted.stop();
  });

  it('boot：project.enter(DEFAULT_INSTANCE_ID) 能进 ⇒ 存量数据可达（R1-04）', async () => {
    upsertCharacters(db, [characterRecord('ch-sandbox-boot', '存量角色')]);

    const store = createStore();
    const booted = bootStratixService({ store, db, detectAgents: false });

    emitCommand({ type: 'project.enter', instanceId: DEFAULT_INSTANCE_ID });
    await new Promise((resolve) => setImmediate(resolve));

    expect(store.getState().activeInstanceId).toBe(DEFAULT_INSTANCE_ID);
    expect(store.getState().characters.some((c) => c.id === 'ch-sandbox-boot')).toBe(true);

    booted.stop();
  });
});
