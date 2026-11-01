/**
 * 文件职责：**service 侧存储归一的 node 冒烟脚本**（前后端分离 A3 / task_079）——
 *   在纯 node 环境里验证「SQLite 由 service 进程独占写 + 读 API 只读」这条链路：
 *     ① 三个落库点真写进一个**临时目录里的真 SQLite 文件**（任务全文 / chat / exp_events）；
 *     ② 关库重开（重开即从文件读回）→ 数据真的落盘了，不是只在内存里；
 *     ③ 读 API 闭环：起一个 express（挂 /api/storage 路由）→ 先写后读，HTTP 返回**真数据**；
 *     ④ 收干净：关 HTTP 服务 + 关库 + 删临时目录（不残留句柄 / 定时器）。
 * 输入：无（自足脚本；临时目录自己建自己删）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. mock 数据 —— 这里必须落**真** SQLite（临时目录里的真文件，关库重开能读回）；
 *   2. 引渲染层 / 宿主层依赖 —— 本脚本必须能 `tsx` 直跑；
 *   3. 碰用户真实数据目录 —— 一律在 os.tmpdir 下建临时目录（跑完删掉）；
 *   4. 留残余句柄 —— 跑完必须能正常退出（否则证明资源没收干净）。
 *
 * 跑法：npx tsx scripts/smoke-storage.ts
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import express from 'express';
import type { Server } from 'http';

import type { PersistedChatMessage } from '../src/app/services/persistence/chat-history-dao';
import { createTopicCachePersister } from '../src/app/services/stratix-context';
import { createStorageRoutes } from '../src/stratix-gateway/api/routes/storage';
import { createServiceStorage, type ServiceStorage } from '../src/stratix-gateway/service/storage';
import { destroyDatabase, getDatabase } from '../src/stratix-database';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`[smoke-storage] 断言失败：${message}`);
    process.exit(1);
  }
}

/** 读一条计数（自报家门：直接从库里数行 —— 证明落的是库，不是内存里的假象）。 */
function countRows(table: string): number {
  const row = getDatabase()
    .getDatabase()
    .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
    .get() as { n?: number } | undefined;
  return Number(row?.n ?? 0);
}

/** 起一个只挂 storage 读路由的 express（端口 0 = 随机空闲端口），返回 { server, port }。 */
async function startStorageServer(storage: ServiceStorage): Promise<{ server: Server; port: number }> {
  const app = express();
  app.use('/api/storage', createStorageRoutes(storage));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : 0;
  return { server, port: boundPort };
}

async function main(): Promise<void> {
  // ===== 临时目录（真 SQLite 文件；跑完删掉）=====
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-storage-smoke-'));
  console.log(`[smoke-storage] 临时数据目录：${dataDir}`);

  const taskId = 'smoke-task-001';
  const characterId = 'smoke-char-001';

  // ===== ① 三个落库点真写 =====
  const storage = await createServiceStorage({ dataDir });

  storage.persistTask({
    id: taskId,
    characterId,
    prompt: '在 service 进程里落一条任务全文',
    status: 'completed',
    output: '任务输出全文：这一步的完整产出都在这里。',
    createdAt: Date.now(),
    startedAt: Date.now(),
    endedAt: Date.now(),
  });

  // chat 落库口与渲染侧 contextPersister.persist 同语义（话题缓存包一层）。
  const chatPersister = createTopicCachePersister(storage.persistChatMessage);
  chatPersister.persist({ characterId, role: 'user', text: '你好', sessionRef: null });
  chatPersister.persist({ characterId, role: 'assistant', text: '你好，我在。', sessionRef: 'sess-1' });
  assert(
    chatPersister.lastTopicFor(characterId)?.text === '你好',
    '话题缓存照旧工作（contextPersister.persist 语义一致）'
  );

  storage.persistExpEvent({
    characterId,
    delta: 3,
    reason: 'chat_round',
    level: null,
    createdAt: Date.now(),
  });
  storage.persistExpEvent({
    characterId,
    delta: 0,
    reason: 'level_up',
    level: 2,
    createdAt: Date.now(),
  });

  // 同进程读回（证明写进去了）。
  assert(storage.readTaskOutput(taskId) === '任务输出全文：这一步的完整产出都在这里。', '任务全文读回一致');
  const messages = storage.loadChatMessages(characterId, 50);
  assert(messages.length === 2, `对话消息读回 2 条（实得 ${messages.length}）`);
  assert(messages[0]?.content === '你好', '对话消息按时间正序（user 在前）');
  assert(messages[1]?.sessionRef === 'sess-1', '对话消息的会话回执落库');
  assert(countRows('character_tasks') === 1, 'character_tasks 落库 1 行');
  assert(countRows('character_chat_messages') === 2, 'character_chat_messages 落库 2 行');
  assert(countRows('exp_events') === 2, 'exp_events 落库 2 行');
  console.log('[smoke-storage] 三个落库点写入 ok（任务全文 / chat / exp_events）');

  // ===== ② 关库重开 → 数据真的落盘（不是内存假象）=====
  destroyDatabase(); // close() 内部会 save() 落盘
  const reopened = await createServiceStorage({ dataDir });
  assert(
    reopened.readTaskOutput(taskId) === '任务输出全文：这一步的完整产出都在这里。',
    '重开库后任务全文仍在（真落盘）'
  );
  assert(reopened.loadChatMessages(characterId, 50).length === 2, '重开库后对话历史仍在（真落盘）');
  assert(countRows('exp_events') === 2, '重开库后经验事件仍在（真落盘）');
  const dbFile = path.join(dataDir, 'stratix.db.sqlite');
  assert(fs.existsSync(dbFile), `库文件落在临时目录（${dbFile}）`);
  assert(fs.statSync(dbFile).size > 0, '库文件非空');
  console.log(`[smoke-storage] 落盘验证 ok（${dbFile}）`);

  // ===== ③ 读 API 闭环：先写后读，HTTP 返回真数据 =====
  const { server, port } = await startStorageServer(reopened);
  try {
    const outputResponse = await fetch(`http://127.0.0.1:${port}/api/storage/tasks/${taskId}/output`);
    assert(outputResponse.status === 200, `读 API 返回 200（实得 ${outputResponse.status}）`);
    const outputBody = (await outputResponse.json()) as {
      success?: boolean;
      data?: { taskId?: string; output?: string | null };
    };
    assert(outputBody.success === true, '读 API 返回 success');
    assert(outputBody.data?.output === '任务输出全文：这一步的完整产出都在这里。', '读 API 返回真数据（任务全文）');

    const chatResponse = await fetch(`http://127.0.0.1:${port}/api/storage/chat/${characterId}`);
    assert(chatResponse.status === 200, `读 API 返回 200（实得 ${chatResponse.status}）`);
    const chatBody = (await chatResponse.json()) as {
      success?: boolean;
      data?: { messages?: PersistedChatMessage[] };
    };
    assert(chatBody.success === true, '读 API 返回 success');
    assert(chatBody.data?.messages?.length === 2, '读 API 返回真数据（对话历史 2 条）');

    // 分页：beforeId 游标向前翻页（取首条之前的窗口 = 空）。
    const pageResponse = await fetch(
      `http://127.0.0.1:${port}/api/storage/chat/${characterId}?beforeId=${chatBody.data?.messages?.[0]?.id ?? 1}`
    );
    const pageBody = (await pageResponse.json()) as { data?: { messages?: unknown[] } };
    assert((pageBody.data?.messages?.length ?? -1) === 0, '分页游标生效（beforeId 之前无更早消息）');
    console.log('[smoke-storage] 读 API 闭环 ok（先写后读 → 真数据）');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ===== ④ 收干净 =====
  destroyDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
  assert(!fs.existsSync(dataDir), '临时目录已清理');
  console.log('[smoke-storage] 收干净 ok');

  console.log('[smoke-storage] OK');
}

void main();
