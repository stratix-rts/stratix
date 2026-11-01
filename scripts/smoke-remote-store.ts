/**
 * 文件职责：**远程 store 的真端口冒烟脚本**（task_083 / 前后端分离 B3）——
 *   起一个备用端口的 HTTP server，挂上 world-sync 端点（B2 产物），用**真实 WebSocket**
 *   连上 `createRemoteStore`（默认连接工厂 —— 单测用内存替身覆盖不到这一条），验证：
 *     ① 连上 → hello → 立刻收到全量 snapshot（store 里塞了真数据）；
 *     ② 发命令 → 收到 command.ack{ok:true}（命令真的落地）；
 *     ③ 断连 → isStale() 转 true 且保留最后一份快照；
 *     ④ 收干净：客户端 / 服务端 / runtime 全关，进程正常退出。
 * 输入：无（自足脚本；用独立 store，不碰真实存档）。
 * 输出：逐条断言 + 一行 OK；任一断言失败即非零退出。
 * 禁止事项：
 *   1. 用 7523 / 7524 / 9222 等**在用端口** —— 本脚本固定用备用端口（默认 7798，可用 REMOTE_STORE_PORT 覆盖）；
 *   2. kill 任何端口 —— 只关自己起的那个 server；
 *   3. 塞假数据证明通路 —— 状态必须经 core 命令落地（回读 store 核对）。
 *
 * 跑法：npx tsx scripts/smoke-remote-store.ts
 */

import http from 'http';

import { emitCommand } from '../src/core/bus';
import { createCoreRuntime } from '../src/core/runtime';
import { createStore } from '../src/core/store';
import { attachWorldSyncEndpoint } from '../src/stratix-gateway/api/websocket/world-sync/endpoint';
import { WORLD_SYNC_PATH } from '../src/stratix-gateway/api/websocket/world-sync/protocol';
import { createRemoteStore } from '../src/app/services/remote-store';

const PORT = Number(process.env.REMOTE_STORE_PORT ?? 7798);

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    console.error(`[smoke-remote-store] 断言失败：${message}`);
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
  console.log(`[smoke-remote-store] listening on 127.0.0.1:${PORT}${WORLD_SYNC_PATH}`);

  const remote = createRemoteStore(`ws://127.0.0.1:${PORT}${WORLD_SYNC_PATH}`);

  // ① hello → 立刻收到 snapshot
  await delay(500);
  assert(remote.isConnected(), '连接已建立');
  assert(remote.getSeq() !== null, '收到 snapshot（有版本号）');
  assert(remote.isStale() === false, '收到快照后视图可信');
  console.log(`[smoke-remote-store] ① hello → snapshot(seq=${remote.getSeq()}) ok`);

  // ② 命令往返 → ack ok + 状态真变了
  const results: Array<{ ok: boolean; seq: number | null }> = [];
  const remote2 = createRemoteStore(`ws://127.0.0.1:${PORT}${WORLD_SYNC_PATH}`, {
    onCommandResult: (result) => results.push({ ok: result.ok, seq: result.seq }),
  });
  await delay(300);
  remote2.emitCommand({ type: 'ui.navigate', screen: 'settings' });
  await delay(500);
  assert(results.length === 1, `收到一条命令回执（实际 ${results.length}）`);
  assert(results[0].ok === true, `命令回执 ok（实际 ${JSON.stringify(results[0])}）`);
  assert(store.getState().currentScreen === 'settings', '状态真的落进了 core store（回读核对）');
  console.log(`[smoke-remote-store] ② forward → ack ok(seq=${results[0].seq}) + 状态落地 ok`);

  // ③ 断连 → stale + 保留最后快照
  remote2.dispose();
  await delay(200);
  assert(remote2.isStale() === true, '断连后视图标记 stale');
  assert(remote2.getState().currentScreen === 'settings', '断连后保留最后一份快照');
  console.log('[smoke-remote-store] ③ 断连 → stale + 保留快照 ok');

  // ④ 收干净
  remote.dispose();
  endpoint.close();
  stopRuntime();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  console.log('[smoke-remote-store] ④ 收干净 ok');
  console.log('[smoke-remote-store] OK');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[smoke-remote-store] 失败：', error);
    process.exit(1);
  });
