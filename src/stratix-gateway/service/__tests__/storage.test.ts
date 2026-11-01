/**
 * 文件职责：service 侧存储归一（createServiceStorage，A3 / task_079）的单测 ——
 *   验三件事：
 *     ① 三个落库点（任务全文 / chat / exp_events）真写进库、读得回来；
 *     ② 守卫照旧（IPC 校验层迁过来后的同口径）：坏形状一律拒 —— 不写库、只记一行警告；
 *     ③ 组合根接线：storage 端口给出即接管落库口（exp.gained 落进库）。
 * 输入：无（自足单测；真 SQLite 文件库建在临时目录里，跑完删掉）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. mock 掉数据库 —— 这里验的就是「真落库」，mock 掉就什么都没验；
 *   2. 用内存假库代替文件库 —— 落盘路径（关库重开能读回）由冒烟脚本验，单测只管语义。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { emitWorldEvent, resetBus } from '../../../core/bus';
import { createStore } from '../../../core/store';
import { destroyDatabase, getDatabase } from '../../../stratix-database';
import { createStratixService } from '../stratix-service';
import { createServiceStorage, type ServiceStorage } from '../storage';

/** 读一张表的行数（自报家门：直接从库里数 —— 证明落的是库，不是内存假象）。 */
function countRows(table: string): number {
  const row = getDatabase()
    .getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

describe('service 侧存储归一（createServiceStorage）', () => {
  let dir: string;
  let storage: ServiceStorage;
  let logs: string[];

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-service-storage-'));
    logs = [];
    storage = await createServiceStorage({ dataDir: dir, logger: (line) => logs.push(line) });
  });

  afterAll(() => {
    destroyDatabase();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    logs.length = 0;
  });

  it('任务全文：落库 + 读回（completed 带输出全文）', () => {
    storage.persistTask({
      id: 'task-1',
      characterId: 'char-1',
      prompt: '干活',
      status: 'completed',
      output: '干完了：这是输出全文',
      createdAt: 1,
      startedAt: 2,
      endedAt: 3,
    });

    expect(storage.readTaskOutput('task-1')).toBe('干完了：这是输出全文');
    expect(countRows('character_tasks')).toBe(1);
  });

  it('任务全文：库里没有这条时返回 null（绝不编造）', () => {
    expect(storage.readTaskOutput('task-does-not-exist')).toBeNull();
  });

  it('对话消息：落库 + 读回（时间正序：user 在前）', () => {
    storage.persistChatMessage({ characterId: 'char-2', role: 'user', text: '在吗', sessionRef: null });
    storage.persistChatMessage({ characterId: 'char-2', role: 'assistant', text: '在', sessionRef: 'sess-9' });

    const messages = storage.loadChatMessages('char-2', 50);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: 'user', content: '在吗' });
    expect(messages[1]).toMatchObject({ role: 'assistant', content: '在', sessionRef: 'sess-9' });
  });

  it('对话历史：beforeId 游标向前翻页（取更早的一段）', () => {
    storage.persistChatMessage({ characterId: 'char-3', role: 'user', text: '一', sessionRef: null });
    storage.persistChatMessage({ characterId: 'char-3', role: 'user', text: '二', sessionRef: null });
    storage.persistChatMessage({ characterId: 'char-3', role: 'user', text: '三', sessionRef: null });

    const all = storage.loadChatMessages('char-3', 50);
    expect(all).toHaveLength(3);
    const earlier = storage.loadEarlierChatMessages('char-3', all[2].id, 50);
    expect(earlier.map((row) => row.content)).toEqual(['一', '二']);
  });

  it('经验事件：落库 + 读回；level_up 行的 delta 强制 0', () => {
    storage.persistExpEvent({
      characterId: 'char-4',
      delta: 5,
      reason: 'chat_round',
      level: null,
      createdAt: 10,
    });
    storage.persistExpEvent({ characterId: 'char-4', delta: 7, reason: 'level_up', level: 2, createdAt: 11 });

    const rows = getDatabase()
      .getDatabase()
      .prepare('SELECT reason, delta, level FROM exp_events WHERE character_id = ? ORDER BY id')
      .all('char-4') as Array<{ reason: string; delta: number; level: number | null }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ reason: 'chat_round', delta: 5, level: null });
    // level_up 是里程碑行：delta 恒 0（语义收敛在一处）。
    expect(rows[1]).toMatchObject({ reason: 'level_up', delta: 0, level: 2 });
  });

  it('守卫：坏形状一律拒（不写库 + 记一行警告）', () => {
    const before = countRows('character_tasks');

    storage.persistTask({
      id: 'task-bad',
      characterId: 'char-1',
      prompt: '干活',
      status: 'not-a-status' as never,
      output: '',
      createdAt: 1,
      startedAt: null,
      endedAt: null,
    });

    expect(countRows('character_tasks')).toBe(before);
    expect(logs.some((line) => line.includes('bad status'))).toBe(true);
  });

  it('守卫：非 level_up 行带 level 被拒；消息角色词表外被拒', () => {
    const beforeExp = countRows('exp_events');
    const beforeChat = countRows('character_chat_messages');

    storage.persistExpEvent({
      characterId: 'char-5',
      delta: 1,
      reason: 'chat_round',
      level: 3,
      createdAt: 12,
    });
    storage.persistChatMessage({
      characterId: 'char-5',
      role: 'narrator' as never,
      text: '越权角色',
      sessionRef: null,
    });

    expect(countRows('exp_events')).toBe(beforeExp);
    expect(countRows('character_chat_messages')).toBe(beforeChat);
    expect(logs.some((line) => line.includes('level only allowed on level_up rows'))).toBe(true);
    expect(logs.some((line) => line.includes('bad role'))).toBe(true);
  });

  it('组合根接线：storage 端口给出即接管经验事件落库口', () => {
    resetBus();
    const service = createStratixService({ store: createStore(), storage });
    const created = service.character.createCharacter({
      name: '存储测试角色',
      agentKind: 'claude-code',
      skinId: 'skin-default',
    });
    expect(created.ok).toBe(true);
    const characterId = created.ok ? created.character.id : '';

    const before = countRows('exp_events');
    emitWorldEvent({
      type: 'exp.gained',
      characterId,
      source: 'chat_round',
      amount: 3,
    });

    expect(countRows('exp_events')).toBe(before + 1);

    service.stop();
    resetBus();
  });
});
