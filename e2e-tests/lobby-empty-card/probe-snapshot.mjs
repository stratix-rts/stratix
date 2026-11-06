/**
 * 探针：连上**运行中的** service（默认 7524）的 world-sync 通道，抓第一份全量快照，
 * 把「大厅卡片数据链」的关键字段原样打印出来。
 *
 * 职责：world-sync 快照探针 —— 只读连上运行中 service 的 `/ws/world-sync`，抓**第一份**全量快照
 *   并打印「大厅卡片数据链」的关键字段（activeInstanceId / projectInstances / units / 顶层字段名），
 *   用来分辨「真相没到位」与「真相到位但没渲染」。**只观察，不写任何状态**。
 *
 * why 不碰用户的 Electron：world-sync 是公开协议端点（只读观察）⇒ 新开一条连接即可，
 *   不影响用户窗口、不改任何状态。
 *
 * 用法：node e2e-tests/lobby-empty-card/probe-snapshot.mjs [port]
 *
 * 输入：命令行参数 `[port]`（world-sync 服务端口，缺省 7524；用法见上方『用法』段）
 *   + 前置条件：该端口上的 service 已在运行、`/ws/world-sync` 可达（**探针自己不起服务**）。
 * 输出：stdout 一份『SNAPSHOT』报告（seq / 有无 activeInstanceId 字段 / 其值 /
 *   projectInstances 数量与全量 JSON / units 数量 / 顶层字段名清单）；非 JSON 帧与
 *   非 snapshot 类型的消息也会打印（便于看协议面上到底出了什么）；
 *   退出码 0 = 收到快照，1 = 8s 内没收到快照或连接失败。
 * 禁止事项：
 *   1. 不许在这个连接上 send 业务写命令（task.assign / project.enter 等；协议握手的
 *      `hello` 帧除外）—— 目标是**用户正在跑的实例**，发写命令就等于替用户改了状态。
 *   2. 不许把「快照里有 activeInstanceId 字段」当成「在大厅」—— 大厅判据是**显式 null**
 *      （字段缺失 ≠ 大厅），否则会把「字段没写」误判成「大厅空卡」。
 *   3. 不许在超时 / 连接失败后反复重连 —— 8s 超时本身就是判据（service 没起要立刻看见），
 *      无限重试会把「没起」拖成一次慢失败。
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
