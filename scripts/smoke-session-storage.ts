/**
 * 文件职责：**会话存储的 node 冒烟脚本**（task_092）—— 在纯 node 环境里验证
 *   「service 独占写 + 读 API 只读」这条链路在会话域上的闭环：
 *     ① persister 真写进一个**临时目录里的真 SQLite 文件**（会话摘要 + 会话事件）；
 *     ② 关库重开（重开即从文件读回）→ 数据真的落盘了，不是只在内存里；
 *     ③ 读 API 闭环：起一个 express（挂 /api/storage 会话路由）→ 先写后读，HTTP 返回**真数据**；
 *     ④ 收干净：关 HTTP 服务 + 关库 + 删临时目录（不残留句柄 / 定时器）。
 * 输入：无（自足脚本；临时目录自己建自己删）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. mock 数据 —— 这里必须落**真** SQLite（临时目录里的真文件，关库重开能读回）；
 *   2. 引渲染层 / 宿主层依赖 —— 本脚本必须能 `tsx` 直跑；
 *   3. 碰用户真实数据目录 —— 一律在 os.tmpdir 下建临时目录（跑完删掉）；
 *   4. 留残余句柄 —— 跑完必须能正常退出（否则证明资源没收干净）。
 *
 * 跑法：
 *   npx tsx scripts/smoke-session-storage.ts            # 自检（写 → 落盘 → 读 API 闭环）
 *   npx tsx scripts/smoke-session-storage.ts --serve 7599  # 起服务并常驻（供外部 curl 打）
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import express from 'express';
import type { Server } from 'http';

import type { SessionEvent, SessionRecord } from '../src/core/session/types';
import { createSessionStorageRoutes } from '../src/stratix-gateway/api/routes/session-storage';
import { createServiceStorage, type ServiceStorage } from '../src/stratix-gateway/service/storage';
import { destroyDatabase, getDatabase } from '../src/stratix-database';
import {
  createSessionPersistenceDao,
  createSessionPersister,
} from '../src/app/services/persistence/session-persister';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`[smoke-session-storage] 断言失败：${message}`);
    process.exit(1);
  }
}

/** 造一条会话摘要（形状同 core/session/types.ts 的 SessionRecord）。 */
function session(patch: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 'session_peer_chat_smoke_1',
    kind: 'peer_chat',
    title: '互聊：侦察北门',
    participants: ['agent-alpha', 'agent-beta'],
    status: 'active',
    createdAt: 1_700_000_000_000,
    lastEventAt: 1_700_000_000_000,
    closedAt: null,
    eventCount: 1,
    ...patch,
  };
}

/** 造一条事件信封（形状同 core/session/types.ts 的 SessionEvent）。 */
function event(patch: Partial<SessionEvent> = {}): SessionEvent {
  return {
    sessionId: 'session_peer_chat_smoke_1',
    seq: 1,
    type: 'created',
    payload: { title: '互聊：侦察北门', participants: ['agent-alpha', 'agent-beta'] },
    createdAt: 1_700_000_000_000,
    ...patch,
  } as SessionEvent;
}

/** 起一个只挂会话读路由的 express（端口 0 = 随机空闲端口），返回 { server, port }。 */
async function startSessionServer(
  storage: ServiceStorage,
  port: number
): Promise<{ server: Server; port: number }> {
  const app = express();
  app.use('/api/storage', createSessionStorageRoutes(storage));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  return { server, port: boundPort };
}

/** 写两条会话 + 若干事件（走 persister → DAO → 真 SQLite）。 */
function seed(persister: ReturnType<typeof createSessionPersister>): void {
  // 会话一：互聊（active，三条事件）。
  persister.persistSession(session());
  persister.persistEvent(event({ seq: 1 }));
  persister.persistEvent(
    event({ seq: 2, type: 'message', payload: { author: 'alpha', text: '在吗' } } as SessionEvent)
  );
  persister.persistEvent(
    event({ seq: 3, type: 'message', payload: { author: 'beta', text: '在' } } as SessionEvent)
  );
  // 会话二：任务执行（已收尾，附 refId）。
  persister.persistSession(
    session({
      id: 'session_task_run_smoke_1',
      kind: 'task_run',
      title: '任务执行：巡北门',
      participants: ['agent-alpha'],
      status: 'closed',
      refId: 'task-smoke-001',
      createdAt: 1_700_000_001_000,
      lastEventAt: 1_700_000_009_000,
      closedAt: 1_700_000_009_000,
      eventCount: 2,
    })
  );
  persister.persistEvent(
    event({
      sessionId: 'session_task_run_smoke_1',
      seq: 1,
      type: 'created',
      payload: { title: '任务执行：巡北门', participants: ['agent-alpha'] },
      createdAt: 1_700_000_001_000,
    })
  );
  persister.persistEvent(
    event({
      sessionId: 'session_task_run_smoke_1',
      seq: 2,
      type: 'closed',
      payload: { reason: '任务完成' },
      createdAt: 1_700_000_009_000,
    })
  );
}

async function main(): Promise<void> {
  const serveArgIndex = process.argv.indexOf('--serve');
  const servePort = serveArgIndex >= 0 ? Number(process.argv[serveArgIndex + 1]) : 0;

  // ===== 临时目录（真 SQLite 文件；跑完删掉）=====
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratix-session-smoke-'));
  console.log(`[smoke-session-storage] 临时数据目录：${dataDir}`);

  // ===== ① persister 真写 =====
  const storage = await createServiceStorage({ dataDir });
  const db = getDatabase().getDatabase();
  const persister = createSessionPersister(createSessionPersistenceDao(db));
  seed(persister);

  // 同进程读回（证明写进去了）。
  const sessions = storage.readSessions({ limit: 50, offset: 0 });
  assert(sessions.length === 2, `会话摘要读回 2 条（实得 ${sessions.length}）`);
  assert(sessions[0]?.id === 'session_task_run_smoke_1', '会话列表按创建时间倒序（新的在前）');
  const events = storage.readSessionEvents('session_peer_chat_smoke_1', { limit: 50 });
  assert(events.length === 3, `会话事件读回 3 条（实得 ${events.length}）`);
  assert(events[0]?.seq === 1 && events[2]?.seq === 3, '事件按 seq 正序返回');
  console.log('[smoke-session-storage] persister 写入 ok（会话摘要 2 条 / 事件 5 条）');

  // ===== ② 关库重开 → 数据真的落盘（不是内存假象）=====
  destroyDatabase(); // close() 内部会 save() 落盘
  const reopened = await createServiceStorage({ dataDir });
  assert(reopened.readSessions({ limit: 50, offset: 0 }).length === 2, '重开库后会话摘要仍在（真落盘）');
  assert(
    reopened.readSessionEvents('session_peer_chat_smoke_1', { limit: 50 }).length === 3,
    '重开库后会话事件仍在（真落盘）'
  );
  console.log('[smoke-session-storage] 落盘验证 ok');

  // ===== ③ 读 API 闭环：先写后读，HTTP 返回真数据 =====
  const { server, port } = await startSessionServer(reopened, servePort);
  const base = `http://127.0.0.1:${port}/api/storage`;
  try {
    const listResponse = await fetch(`${base}/sessions`);
    assert(listResponse.status === 200, `读 API 返回 200（实得 ${listResponse.status}）`);
    const listBody = (await listResponse.json()) as {
      success?: boolean;
      data?: { sessions?: Array<{ id: string; kind: string; status: string }> };
    };
    assert(listBody.success === true, '读 API 返回 success');
    assert(listBody.data?.sessions?.length === 2, '读 API 返回真数据（会话摘要 2 条）');

    const filtered = await fetch(`${base}/sessions?kind=peer_chat&status=active`);
    const filteredBody = (await filtered.json()) as { data?: { sessions?: unknown[] } };
    assert(filteredBody.data?.sessions?.length === 1, '读 API 过滤生效（peer_chat + active 一条）');

    const eventsResponse = await fetch(`${base}/sessions/session_peer_chat_smoke_1/events?limit=2`);
    const eventsBody = (await eventsResponse.json()) as {
      data?: { events?: Array<{ seq: number }> };
    };
    assert(eventsBody.data?.events?.length === 2, '读 API 返回真数据（事件前两条）');

    const pageResponse = await fetch(`${base}/sessions/session_peer_chat_smoke_1/events?beforeSeq=2`);
    const pageBody = (await pageResponse.json()) as { data?: { events?: Array<{ seq: number }> } };
    assert(
      (pageBody.data?.events?.length ?? -1) === 1 && pageBody.data?.events?.[0]?.seq === 1,
      '分页游标生效（beforeSeq 之前只有 seq=1）'
    );
    console.log('[smoke-session-storage] 读 API 闭环 ok（先写后读 → 真数据）');

    if (servePort > 0) {
      // 常驻模式：供外部 curl 打（Ctrl-C 退出）。
      console.log(`[smoke-session-storage] 常驻服务已起：${base}（Ctrl-C 退出）`);
      console.log(
        `[smoke-session-storage] 试试：curl '${base}/sessions?kind=peer_chat&status=active'`
      );
      await new Promise<void>((resolve) => {
        process.on('SIGINT', () => resolve());
        process.on('SIGTERM', () => resolve());
      });
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  // ===== ④ 收干净 =====
  destroyDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
  assert(!fs.existsSync(dataDir), '临时目录已清理');
  console.log('[smoke-session-storage] 收干净 ok');

  console.log('[smoke-session-storage] OK');
}

void main();
