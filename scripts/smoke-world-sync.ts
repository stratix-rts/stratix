/**
 * 文件职责：world-sync 端点的 **真实端口冒烟脚本**（task_082 / 前后端分离 B2）——
 *   起一个**备用端口**的 HTTP server，挂上 world-sync 端点，用真 `ws` 客户端连上去，验证：
 *     ① 连上 → hello → 立刻收到全量 snapshot（真实 store 数据）；
 *     ② 发 command.forward → 状态真的变了 → 收到 command.ack{ok:true}；
 *     ③ 没人接管的命令 → 收到 command.ack{ok:false, code:'internal_error'}（绝不假装成功）；
 *     ④ 收干净：server / 客户端 / runtime 全部关掉，进程正常退出（不留监听与定时器）。
 * 输入：无（自足脚本；用独立的 store，不碰真实存档）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. 用 7523 / 7524 / 9222 等**在用端口** —— 本脚本固定用备用端口（默认 7797，可用 WS_SYNC_PORT 覆盖）；
 *   2. kill 任何端口 —— 只关自己起的那个 server；
 *   3. 塞假数据证明通路 —— 状态必须经 core 命令落地（回读 store 核对）。
 *
 * 跑法：npx tsx scripts/smoke-world-sync.ts
 */

import http from 'http';

import { WebSocket } from 'ws';

import { emitCommand } from '../src/core/bus';
import { createCoreRuntime } from '../src/core/runtime';
import { createStore } from '../src/core/store';
import { attachWorldSyncEndpoint } from '../src/stratix-gateway/api/websocket/world-sync/endpoint';
import {
  WORLD_SYNC_PATH,
  WORLD_SYNC_PROTOCOL_VERSION,
  type CommandAckMessage,
  type SnapshotMessage,
} from '../src/stratix-gateway/api/websocket/world-sync/protocol';

const PORT = Number(process.env.WS_SYNC_PORT ?? 7797);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`[smoke-world-sync] 断言失败：${message}`);
    process.exit(1);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const store = createStore();
  const runtime = createCoreRuntime({ store });
  const stopRuntime = runtime.start();

  const server = http.createServer((_req, res) => {
    res.writeHead(426).end('upgrade required');
  });
  const endpoint = attachWorldSyncEndpoint(server, { store, dispatch: emitCommand });

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));
  console.log(`[smoke-world-sync] listening on 127.0.0.1:${PORT}${WORLD_SYNC_PATH}`);

  const socket = new WebSocket(`ws://127.0.0.1:${PORT}${WORLD_SYNC_PATH}`);
  const received: Array<Record<string, unknown>> = [];
  socket.on('message', (data) => {
    received.push(JSON.parse(data.toString()) as Record<string, unknown>);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  assert(true, 'WS 连接建立');

  // ① hello → 立刻收到 snapshot
  socket.send(
    JSON.stringify({
      type: 'hello',
      protocolVersion: WORLD_SYNC_PROTOCOL_VERSION,
      clientId: 'smoke-1',
    })
  );
  await delay(200);
  const snapshot = received.find((m) => m.type === 'snapshot') as SnapshotMessage | undefined;
  assert(snapshot !== undefined, 'hello 后收到 snapshot');
  assert(snapshot.seq >= 1, `snapshot 带 seq（实际 ${snapshot.seq}）`);
  assert(Array.isArray(snapshot.state.units), 'snapshot 带全量 state');
  console.log(`[smoke-world-sync] ① hello → snapshot(seq=${snapshot.seq}) ok`);

  // ② 命令往返 → ack ok + 状态真变了
  socket.send(
    JSON.stringify({
      type: 'command.forward',
      commandId: 'smoke-cmd-1',
      command: { type: 'ui.navigate', screen: 'settings' },
    })
  );
  await delay(300);
  const okAck = received.find((m) => m.type === 'command.ack') as CommandAckMessage | undefined;
  assert(okAck !== undefined, '命令回执已到');
  assert(okAck.ok === true, `命令回执 ok（实际 ${JSON.stringify(okAck)}）`);
  assert(store.getState().currentScreen === 'settings', '状态真的落进了 core store（回读核对）');
  console.log(`[smoke-world-sync] ② forward → ack ok(seq=${okAck.seq}) + 状态落地 ok`);

  // ③ 没人接管的命令 → internal_error（不假装成功）
  //   例子用 cache.clear：core runtime 没有这条命令的 case ⇒ 无人接管。
  //   （不再用 unit.focus —— 自 task_218 / IX-05 起它已被 core 接管。）
  socket.send(
    JSON.stringify({
      type: 'command.forward',
      commandId: 'smoke-cmd-2',
      command: { type: 'cache.clear' },
    })
  );
  await delay(6000);
  const acks = received.filter((m) => m.type === 'command.ack') as CommandAckMessage[];
  const failAck = acks.find((m) => m.commandId === 'smoke-cmd-2');
  assert(failAck !== undefined, '超时命令也有回执');
  assert(failAck.ok === false, '超时命令不是成功');
  assert(failAck.error?.code === 'internal_error', `超时回执是 internal_error（实际 ${failAck.error?.code}）`);
  console.log(`[smoke-world-sync] ③ 无人接管 → internal_error ok`);

  // ④ 收干净
  socket.close();
  endpoint.close();
  stopRuntime();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('[smoke-world-sync] ④ 收干净 ok');
  console.log('[smoke-world-sync] OK');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[smoke-world-sync] 失败：', error);
    process.exit(1);
  });
