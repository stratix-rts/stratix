/**
 * 单测：**任务行的副本归属写侧**（@since v3.3，task_207 / M2-10）。
 *
 * why 有这个文件：M2-10 端到端验收时发现一处**写侧欠账**——
 *   `character_tasks` 的 `instance_id` 列（M2-01 加的）与读口过滤（M2-01 补的）都在，
 *   但**写侧一直没写** ⇒ 任务行永远落 NULL ⇒ 按 COALESCE 口径全部算进**默认沙盒**：
 *   副本里派的任务在本副本**读不回来**，反倒污染沙盒的池子。
 *   （与 characters / sessions / session_events 的写侧欠账同一族，M2-05…M2-08 已补。）
 *
 * 覆盖四条：
 *   ① 带归属写 ⇒ 落库行的 instance_id 就是它（写侧真的写了）；
 *   ② 不带归属写 ⇒ 落 NULL（COALESCE 口径 ⇒ 归默认沙盒）；
 *   ③ 更新已有行时**不带**归属 ⇒ 原值**不被清空**（COALESCE 语义：不清）；
 *   ④ app 层 `taskEventToRecord` 把 core 盖的 instanceId 带到落库记录里（真相源 = core 快照）。
 *
 * 手法与 task-record-dao.test.ts 同款：**真实 sql.js 适配器**（生产同款）+ 临时文件库
 * —— DAO 的职责就是「建表 + 参数绑定 + 行映射」，mock 掉连接等于把它一起 mock 掉。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_INSTANCE_ID } from '@/core/types';
import { Database } from '@/stratix-database/sqlite-adapter';

import { taskEventToRecord } from '../../services/task-service';
import {
  ensureCharacterTasksTable,
  loadRecentTasks,
  upsertTask,
  type PersistedTaskRecord,
} from '../../services/persistence/task-record-dao';

/** 副本 A / B 的实例 id。 */
const INSTANCE_A = 'wsp_task_a';
const INSTANCE_B = 'wsp_task_b';

/** 造一条任务记录。 */
function record(patch: Partial<PersistedTaskRecord> = {}): PersistedTaskRecord {
  return {
    id: 'task_1',
    characterId: 'ch-1',
    prompt: '侦察北门',
    status: 'queued',
    output: '',
    createdAt: 1700000000000,
    startedAt: null,
    endedAt: null,
    ...patch,
  };
}

/** 直接读库里的 instance_id（不靠 DAO 的映射 —— 映射可能把 null 归一成「不带这个键」）。 */
function rawInstanceId(db: Database, id: string): string | null {
  const row = db
    .prepare(`SELECT instance_id FROM character_tasks WHERE id = ?`)
    .get(id) as { instance_id?: string | null } | undefined;
  const value = row?.instance_id;
  return value === null || value === undefined ? null : String(value);
}

describe('character_tasks 的 instance_id 写侧（task_207 / M2-10）', () => {
  let dbPath: string;
  let db: Database;

  beforeEach(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-task-instance-'));
    dbPath = path.join(dir, 'stratix.db.sqlite');
    db = new Database(dbPath);
    await db.initialize();
    ensureCharacterTasksTable(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it('① 带归属写 ⇒ 落库行的 instance_id 就是它', () => {
    upsertTask(db, record({ id: 'task_a', instanceId: INSTANCE_A }));
    expect(rawInstanceId(db, 'task_a')).toBe(INSTANCE_A);
  });

  it('② 不带归属写 ⇒ 落 NULL（COALESCE 口径 ⇒ 归默认沙盒）', () => {
    upsertTask(db, record({ id: 'task_legacy' }));
    expect(rawInstanceId(db, 'task_legacy')).toBeNull();
  });

  it('③ 更新已有行时不带归属 ⇒ 原值不被清空（COALESCE 语义：来件没带就不清）', () => {
    upsertTask(db, record({ id: 'task_a', instanceId: INSTANCE_A }));
    upsertTask(db, record({ id: 'task_a', status: 'completed', output: '干完了' }));
    expect(rawInstanceId(db, 'task_a')).toBe(INSTANCE_A);
  });

  it('④ 读口按副本过滤：A 只看得见 A 的那单，B 只看得见 B 的那单，沙盒看得见旧行', () => {
    upsertTask(db, record({ id: 'task_a', instanceId: INSTANCE_A }));
    upsertTask(db, record({ id: 'task_b', instanceId: INSTANCE_B }));
    upsertTask(db, record({ id: 'task_legacy' }));

    const idsIn = (instanceId?: string): string[] =>
      loadRecentTasks(db, 'ch-1', 20, instanceId ? { instanceId } : {}).map((row) => row.id);

    expect(idsIn(INSTANCE_A).sort()).toEqual(['task_a']);
    expect(idsIn(INSTANCE_B).sort()).toEqual(['task_b']);
    expect(idsIn(DEFAULT_INSTANCE_ID).sort()).toEqual(['task_legacy']);
  });

  it('⑤ app 层：core 盖的 instanceId 随任务快照一起落到落库记录里', () => {
    const stamped = taskEventToRecord({
      id: 'task_a',
      characterId: 'ch-1',
      prompt: '侦察北门',
      status: 'queued',
      output: '',
      createdAt: 1700000000000,
      startedAt: null,
      endedAt: null,
      instanceId: INSTANCE_A,
    });
    expect(stamped.instanceId).toBe(INSTANCE_A);

    // 没带归属的快照 ⇒ 不带这个键（老行语义：不凭空造归属）。
    const legacy = taskEventToRecord({
      id: 'task_legacy',
      characterId: 'ch-1',
      prompt: '侦察北门',
      status: 'queued',
      output: '',
      createdAt: 1700000000000,
      startedAt: null,
      endedAt: null,
    });
    expect(legacy.instanceId).toBeUndefined();
  });
});
