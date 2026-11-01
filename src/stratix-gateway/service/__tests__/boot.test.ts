/**
 * 文件职责：service 进程启动接线（bootStratixService，A4 / task_080）的单测 ——
 *   验四件事：
 *     ① boot 后组合根已接通（runtime 在跑、store 就是给的那一份）；
 *     ② 世界态恢复把库里的角色档案变成 store 里的**角色 + 战场单位**（units 不再恒为 0）；
 *     ③ MCP 数据面与 service 同 store（同一个世界态，不另起一份）；
 *     ④ stop 之后命令不再落地（订阅退干净）+ 恢复幂等（重复恢复不产生重复单位）。
 * 输入：无（自足单测；真 SQLite 文件库建在临时目录里，跑完删掉）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. mock 掉数据库 —— 这里验的就是「真库真恢复」，mock 掉就什么都没验；
 *   2. 直接往 store 里塞角色来「造」单位 —— 角色必须经**恢复通路**进来，否则测的不是真实链路。
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
import { createStore, type CoreStore } from '../../../core/store';
import { destroyDatabase, initializeDatabase } from '../../../stratix-database';

import { bootStratixService } from '../boot';

/** 一条角色档案（字段与 PersistedCharacterRecord 一一对应）。 */
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

describe('service 进程启动接线（bootStratixService）', () => {
  let dir: string;
  let db: SqliteDatabaseLike;

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-service-boot-'));
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

  it('boot：组合根已接通，store 就是给的那一份', () => {
    const store = createStore();
    const booted = bootStratixService({ store, db, detectAgents: false });

    expect(booted.service.store).toBe(store);
    expect(booted.service.runtime.running).toBe(true);
    // 执行环接上了（缺省即在本进程跑，不需要再传 createTransport）。
    expect(booted.service.taskService).not.toBeNull();

    booted.stop();
  });

  it('世界态恢复：库里的角色变成 store 里的角色 + 战场单位', () => {
    upsertCharacters(db, [characterRecord('char-boot-1', '恢复角色')]);

    const store = createStore();
    const booted = bootStratixService({ store, db, detectAgents: false });

    expect(booted.restore.characters).toBeGreaterThanOrEqual(1);
    expect(booted.restore.units).toBe(booted.restore.characters);
    const state = store.getState();
    expect(state.characters.some((character) => character.id === 'char-boot-1')).toBe(true);
    expect(state.units.some((unit) => unit.characterId === 'char-boot-1')).toBe(true);

    booted.stop();
  });

  it('恢复幂等：重复恢复不产生重复单位（同一 id 只投影一次）', () => {
    const store = createStore();
    const first = bootStratixService({ store, db, detectAgents: false });
    const unitsAfterFirst = store.getState().units.length;
    first.stop();

    const second = bootStratixService({ store, db, detectAgents: false });
    expect(store.getState().units.length).toBe(unitsAfterFirst);
    second.stop();
  });

  it('MCP 数据面与 service 同 store：world_snapshot 看得见恢复出来的单位', async () => {
    upsertCharacters(db, [characterRecord('char-mcp-1', 'MCP 角色')]);

    const store: CoreStore = createStore();
    const booted = bootStratixService({ store, db, detectAgents: false });

    // MCP host 走的是**同一个 store**（接线见 gateway/index.ts 的 /mcp 路由）。
    const { createCoreMcpHost } = await import('../../mcp/context');
    const host = createCoreMcpHost({ store: booted.service.store });
    const state = host.getWorldState();

    expect(state.units.some((unit) => unit.characterId === 'char-mcp-1')).toBe(true);

    booted.stop();
  });

  it('stop 之后命令不再落地（runtime 退订干净）', () => {
    const store = createStore();
    const booted = bootStratixService({ store, db, detectAgents: false });
    booted.stop();

    emitCommand({ type: 'mission.create', title: '停机后的任务', unitIds: [] });

    expect(booted.service.runtime.running).toBe(false);
    expect(store.getState().missions).toHaveLength(0);
  });
});
