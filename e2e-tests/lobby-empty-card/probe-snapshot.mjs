/**
 * 探针：连上**运行中的** service（默认 7524）的 world-sync 通道，抓第一份全量快照，
 * 把「大厅卡片数据链」的关键字段原样打印出来。
 *
 * why 不碰用户的 Electron：world-sync 是公开协议端点（只读观察）⇒ 新开一条连接即可，
 *   不影响用户窗口、不改任何状态。
 *
 * 用法：node e2e-tests/lobby-empty-card/probe-snapshot.mjs [port]
 */
import WebSocket from 'ws';

const port = Number(process.argv[2] ?? 7524);
const url = `ws://127.0.0.1:${port}/ws/world-sync`;

const ws = new WebSocket(url);
let done = false;

function finish(code) {
  if (done) return;
  done = true;
  try {
    ws.close();
  } catch {
    /* 关不掉就算了 */
  }
  process.exit(code);
}

const timer = setTimeout(() => {
  console.error('[probe] 超时：8s 内没收到快照');
  finish(1);
}, 8000);

ws.on('open', () => {
  console.log(`[probe] 已连上 ${url}`);
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: 2, clientId: 'probe-lobby-empty-card' }));
});

ws.on('message', (raw) => {
  let msg;
  try {
    msg = JSON.parse(String(raw));
  } catch {
    console.log('[probe] 非 JSON 帧:', String(raw).slice(0, 200));
    return;
  }
  if (msg.type !== 'snapshot') {
    console.log('[probe] 收到其它消息:', JSON.stringify(msg).slice(0, 300));
    return;
  }
  clearTimeout(timer);
  const state = msg.state ?? {};
  console.log('================ SNAPSHOT ================');
  console.log('seq                       =', msg.seq);
  console.log('有 activeInstanceId 字段吗 =', Object.prototype.hasOwnProperty.call(state, 'activeInstanceId'));
  console.log('activeInstanceId 值       =', JSON.stringify(state.activeInstanceId));
  console.log('projectInstances 数量     =', Array.isArray(state.projectInstances) ? state.projectInstances.length : '(字段缺失)');
  console.log('projectInstances           =', JSON.stringify(state.projectInstances, null, 2));
  console.log('units 数量                =', Array.isArray(state.units) ? state.units.length : '(字段缺失)');
  console.log('顶层字段名                 =', Object.keys(state).sort().join(', '));
  console.log('==========================================');
  finish(0);
});

ws.on('error', (err) => {
  clearTimeout(timer);
  console.error('[probe] 连接失败:', err.message);
  finish(1);
});
