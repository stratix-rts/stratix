/**
 * 单测：**站位行的副本归属写侧**（@since v3.3，task_210 / M2-11）。
 *
 * why 有这个文件：M2-10（task_207）端到端验收时如实记下一笔**写侧欠账**——
 *   `unit_positions` 的 `instance_id` 列（M2-01 加的）与读口过滤（M2-01 补的）都在，
 *   但**写侧一直没写** ⇒ 站位行永远落 NULL ⇒ 按 COALESCE 口径全部算进**默认沙盒**：
 *   非沙盒副本里角色的站位在本副本**读不回来**（写口在 electron IPC `game:saveUnitPositions`，
 *   那一层拿不到副本归属 ⇒ 本单把归属**随载荷一起**带过去）。
 *   （与 characters / character_tasks / sessions / session_events 的写侧欠账同一族。）
 *
 * 覆盖七条：
 *   ① 带归属写 ⇒ 落库行的 instance_id 就是它（写侧真的写了）+ 读口原样带回来（往返保真）；
 *   ② 不带归属写 ⇒ 落 NULL（COALESCE 口径 ⇒ 归默认沙盒）+ 读口不带这个键；
 *   ③ 更新已有行时**不带**归属 ⇒ 原值**不被清空**（COALESCE 语义：不清）；
 *   ④ 读口按副本过滤：A 读得到自己的站位，**沙盒读不到 A 的**、读得到旧行（读写闭环）；
 *   ⑤ 脏归属（空串 / 非串）⇒ 按「未归属」处理（落 NULL，不让垃圾值进库）；
 *   ⑥ 写侧载荷口径（writeSideInstanceId）：默认沙盒 ⇒ 不带归属；其它副本 ⇒ 显式带；
 *   ⑦ 渲染侧闭环（协调器）：非沙盒副本里写的站位**带归属**；沙盒里写的**不带**（沙盒路径不变）。
 *
 * 手法与 task-instance-id.test.ts（task_207 同款）一致：**真实 sql.js 适配器**（生产同款）
 * + 临时文件库 —— DAO 的职责就是「建表 + 参数绑定 + 行映射」，mock 掉连接等于把它一起 mock 掉。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { emitWorldEvent, resetBus } from '@/core/bus';
import { createCoreRuntime } from '@/core/runtime';
import { createStore } from '@/core/store';
import { DEFAULT_INSTANCE_ID, type CharacterView } from '@/core/types';
import { Database } from '@/stratix-database/sqlite-adapter';

import {
  createGameSaveCoordinator,
  type GameSaveApi,
} from '../../services/persistence/game-save-coordinator';
import {
  ensureGameSaveTables,
  loadUnitPositions,
  upsertUnitPositions,
  type PersistedUnitPosition,
} from '../../services/persistence/game-save-dao';
import { writeSideInstanceId } from '../../services/persistence/instance-scope';

/** 副本 A / B 的实例 id（沙盒 = DEFAULT_INSTANCE_ID = 'wsp_sandbox'）。 */
const INSTANCE_A = 'wsp_pos_a';
const INSTANCE_B = 'wsp_pos_b';

/** 造一条站位记录。 */
function position(patch: Partial<PersistedUnitPosition> = {}): PersistedUnitPosition {
  return { characterId: 'ch-1', x: 10, y: 20, ...patch };
}

/** 直接读库里的 instance_id（不靠 DAO 的映射 —— 映射可能把 null 归一成「不带这个键」）。 */
function rawInstanceId(db: Database, characterId: string): string | null {
  const row = db
    .prepare(`SELECT instance_id FROM unit_positions WHERE character_id = ?`)
    .get(characterId) as { instance_id?: string | null } | undefined;
  const value = row?.instance_id;
  return value === null || value === undefined ? null : String(value);
}

describe('unit_positions 的 instance_id 写侧（task_210 / M2-11）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-position-instance-'));
    dbPath = path.join(dir, 'stratix.db.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureGameSaveTables(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('① 带归属写 ⇒ 落库行的 instance_id 就是它', () => {
    upsertUnitPositions(db, [position({ characterId: 'ch-a', instanceId: INSTANCE_A })]);
    expect(rawInstanceId(db, 'ch-a')).toBe(INSTANCE_A);
    // 读口把那一列原样带回来（行 ↔ 记录的双向映射：归属不丢）。
    expect(loadUnitPositions(db)).toEqual([
      { characterId: 'ch-a', x: 10, y: 20, instanceId: INSTANCE_A },
    ]);
  });

  it('② 不带归属写 ⇒ 落 NULL（COALESCE 口径 ⇒ 归默认沙盒）', () => {
    upsertUnitPositions(db, [position({ characterId: 'ch-legacy' })]);
    expect(rawInstanceId(db, 'ch-legacy')).toBeNull();
    // 读口也不带这个键（往返保真：未归属 ≠ 归属沙盒）。
    expect(loadUnitPositions(db)).toEqual([{ characterId: 'ch-legacy', x: 10, y: 20 }]);
  });

  it('③ 更新已有行时不带归属 ⇒ 原值不被清空（COALESCE 语义：来件没带就不清）', () => {
    upsertUnitPositions(db, [position({ characterId: 'ch-a', instanceId: INSTANCE_A })]);
    upsertUnitPositions(db, [position({ characterId: 'ch-a', x: 99, y: -3 })]);
    expect(rawInstanceId(db, 'ch-a')).toBe(INSTANCE_A);
    // 坐标照常更新（写侧补归属不该影响别的字段）。
    expect(loadUnitPositions(db)).toEqual([
      { characterId: 'ch-a', x: 99, y: -3, instanceId: INSTANCE_A },
    ]);
  });

  it('④ 读写闭环：非沙盒副本写站位 ⇒ 本副本读得到，沙盒读不到（沙盒只读得到自己的旧行）', () => {
    upsertUnitPositions(db, [position({ characterId: 'ch-a', instanceId: INSTANCE_A })]);
    upsertUnitPositions(db, [position({ characterId: 'ch-b', instanceId: INSTANCE_B })]);
    upsertUnitPositions(db, [position({ characterId: 'ch-legacy' })]);

    const idsIn = (instanceId?: string): string[] =>
      loadUnitPositions(db, instanceId ? { instanceId } : {}).map((row) => row.characterId);

    expect(idsIn(INSTANCE_A)).toEqual(['ch-a']);
    expect(idsIn(INSTANCE_B)).toEqual(['ch-b']);
    // 沙盒读不到别的副本的行（A / B 的站位对沙盒不可见），只读得到自己的旧行（NULL 行）。
    expect(idsIn(DEFAULT_INSTANCE_ID)).toEqual(['ch-legacy']);
    // 不过滤（缺省）⇒ 全表（“全场总览”口径，不该按副本切）。
    expect(idsIn().sort()).toEqual(['ch-a', 'ch-b', 'ch-legacy']);
  });

  it('⑤ 脏归属（空串 / 非串）⇒ 按「未归属」处理（落 NULL，不让垃圾值进库）', () => {
    upsertUnitPositions(db, [
      position({ characterId: 'ch-empty', instanceId: '' }),
      position({ characterId: 'ch-junk', instanceId: 42 as unknown as string }),
    ]);
    expect(rawInstanceId(db, 'ch-empty')).toBeNull();
    expect(rawInstanceId(db, 'ch-junk')).toBeNull();
  });

  it('⑥ 写侧载荷口径：默认沙盒 ⇒ 不带归属（行保持 NULL）；其它副本 ⇒ 显式带上', () => {
    expect(writeSideInstanceId(DEFAULT_INSTANCE_ID)).toBeUndefined();
    expect(writeSideInstanceId(INSTANCE_A)).toBe(INSTANCE_A);
  });
});

// ============================================================================
// 渲染侧闭环（协调器 → IPC 载荷）
// ============================================================================

/** 一个够用的角色（协调器只认「台账里的角色」）。 */
function character(): CharacterView {
  return {
    id: 'character_1',
    name: '阿锻',
    persona: '沉着冷静',
    level: 2,
    experience: 120,
    agentKind: 'claude-code',
    skinId: 'skin_forge',
    externalSessionId: null,
    appearance: { bodyType: 'male', parts: { hair: 'black' } },
  };
}

/** 真总线 + 真 runtime：store.setState 的变更必须经 runtime 广播才能到协调器（与生产同链路）。 */
function harness(): {
  api: GameSaveApi & { saveUnitPositions: jest.Mock };
  store: ReturnType<typeof createStore>;
  stopRuntime: () => void;
} {
  const store = createStore();
  const runtime = createCoreRuntime({ store, onUnhandled: () => {} });
  const stopRuntime = runtime.start();
  const api = {
    loadSnapshot: jest.fn(async () => ({ ok: true, characters: [], unitPositions: [] })),
    saveCharacters: jest.fn(async () => ({ ok: true })),
    saveUnitPositions: jest.fn(async () => ({ ok: true })),
  };
  return { api, store, stopRuntime };
}

/** 排空微任务（fake api 的 async resolve 链要落定后才能断言调用）。 */
const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe('渲染侧：站位落库带上副本归属（task_210 / M2-11）', () => {
  beforeEach(() => {
    resetBus();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetBus();
  });

  it('⑦ 非沙盒副本里写的站位带归属；沙盒里写的不带归属（沙盒路径与补齐前一致）', async () => {
    const { api, store, stopRuntime } = harness();

    // ===== 非沙盒副本 A：写出的站位必须带 A 的归属 =====
    store.setState((s) => ({ ...s, activeInstanceId: INSTANCE_A, characters: [character()] }));
    const coordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    coordinator.start();
    await flushMicrotasks();

    emitWorldEvent({ type: 'unit.position', unitId: 'unit_character_1', x: 3, y: 4 });
    jest.advanceTimersByTime(1000);
    expect(api.saveUnitPositions).toHaveBeenCalledTimes(1);
    expect(api.saveUnitPositions.mock.calls[0]?.[0]).toEqual([
      { characterId: 'character_1', x: 3, y: 4, instanceId: INSTANCE_A },
    ]);
    coordinator.stop();

    // ===== 沙盒（大厅态 / 默认沙盒）：写出的站位**不带**归属 ⇒ 落 NULL（沙盒路径零变化）=====
    api.saveUnitPositions.mockClear();
    store.setState((s) => ({ ...s, activeInstanceId: null }));
    const sandboxCoordinator = createGameSaveCoordinator({ api, store, debounceMs: 1000 });
    sandboxCoordinator.start();
    await flushMicrotasks();

    emitWorldEvent({ type: 'unit.position', unitId: 'unit_character_1', x: 5, y: 6 });
    jest.advanceTimersByTime(1000);
    expect(api.saveUnitPositions).toHaveBeenCalledTimes(1);
    expect(api.saveUnitPositions.mock.calls[0]?.[0]).toEqual([
      { characterId: 'character_1', x: 5, y: 6 },
    ]);
    sandboxCoordinator.stop();

    stopRuntime();
  });
});
