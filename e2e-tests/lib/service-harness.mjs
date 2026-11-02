/**
 * 文件职责：**service 型 e2e 剧本的公用夹具** —— 起服务 / 断言 / 回收进程 / MCP 调用 / world-sync 观察，
 *   供「自起自收」的验收剧本复用（service-resident.e2e.mjs 是它的第一个用户，
 *   session-domain.e2e.mjs 是第二个）。
 * 出口：log / must / waitFor / sleep / 进程工具（isAlive / psTable / descendantsOf / killTree / portFree /
 *   launch）/ mcpCall / createObserver。
 *
 * why 抽出来：这套夹具的**纪律**比代码本身重要（端口不碰用户的、清理只按 pid、不按进程名扫杀）——
 *   抄一份就多一份可能抄错的地方。纪律集中在一处，改一处全体生效。
 *
 * ★ 端口与进程纪律（硬约束，与 service-resident.e2e.mjs 同一口径）：
 *   - 用户的 dev 实例占着 7523 / 7524 / 9222 —— 剧本**一个都不碰**，全部走备用端口；
 *   - 清理**只杀自己拉起的 pid**（连同它自己的后代树）—— 全程不 pkill / pgrep 按进程名扫杀
 *     （用户的 Electron 实例正在跑，按名扫杀会误杀它）；
 *   - 端口占用先查再用（portFree），撞上用户端口直接拒绝开跑。
 *
 * 禁止事项：
 *   1. 在这里放业务断言 —— 本文件只给「怎么问、怎么等、怎么收」的手段；
 *   2. 引入 npm 依赖 —— 只用 node 内置（fetch / WebSocket / child_process / net / fs）；
 *   3. 按进程名扫杀 —— killTree 只按 pid 精确回收。
 */

import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';

/**
 * 用户实例占用的端口 —— 剧本自己撞上就是错（启动前先查）。
 * why 硬编码在这儿：纪律要有一处真相，不能每个剧本各抄一份（抄漏一处就误伤用户实例）。
 */
export const RESERVED_PORTS = new Set([7523, 7524, 9222]);

/** 本剧本拉起的进程（收尾时按 pid 精确回收）。 */
const spawned = [];

// ============================================================================
// 输出与断言
// ============================================================================

/** 打一行过程日志。 */
export function log(...args) {
  console.log('[e2e]', ...args);
}

/** 断言清单（收尾时逐条打印 —— 这就是要贴进任务文档的那 30 行）。 */
export const checks = [];

/**
 * 记一条断言；不通过即抛（失败即停，不留半吊子状态）。
 * @param {string} name 断言名（贴进任务文档的那一行）
 * @param {unknown} condition 判定结果
 * @param {string} [detail] 上下文（压成一行，多行会把「最后 30 行」撑乱）
 */
export function must(name, condition, detail = '') {
  const flat = String(detail).replace(/\s+/g, ' ').trim().slice(0, 160);
  checks.push({ name, ok: Boolean(condition), detail: flat });
  if (!condition) {
    throw new Error(`断言失败：${name}${flat ? `（${flat}）` : ''}`);
  }
  log(`✓ ${name}${flat ? ` — ${flat}` : ''}`);
}

/**
 * 收尾打印：逐条断言 + 一行结论（这就是要贴进任务文档的最后 30 行）。
 * @param {string} conclusion 通过时的结论文案
 */
export function printSummary(conclusion = 'PASS') {
  const passed = checks.filter((check) => check.ok).length;
  console.log('──────────────── 验收摘要 ────────────────');
  for (const check of checks) {
    console.log(`${check.ok ? '✅' : '❌'} ${check.name}${check.detail ? ` —— ${check.detail}` : ''}`);
  }
  console.log(`断言：${passed}/${checks.length} 通过`);
  console.log(passed === checks.length ? `结论：${conclusion}` : '结论：FAIL');
  console.log('────────────────────────────────────────────');
}

/** 睡一会儿（毫秒）。 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 轮询直到 fn 返回真值；超时抛错。
 * @param {string} label 等什么（超时时的报错文案）
 * @param {() => unknown} fn 判定函数（返回真值即过；返回字符串则当作详情带进报错）
 */
export async function waitFor(label, fn, { timeoutMs = 60_000, intervalMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastDetail = '';
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    lastDetail = typeof value === 'string' ? value : '';
    await sleep(intervalMs);
  }
  throw new Error(`等待超时：${label}${lastDetail ? `（${lastDetail}）` : ''}`);
}

// ============================================================================
// 进程与端口工具（只按 pid 精确操作，绝不按进程名扫杀）
// ============================================================================

/** 进程还活着吗。 */
export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 进程表快照：pid → { ppid, args }。 */
export function psTable() {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,args='], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const rows = [];
  for (const line of out.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(/^(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] ?? '' });
  }
  return rows;
}

/** 某 pid 的全部后代（**由深到浅**：先杀子再杀父，避免子进程被 init 收养后失控）。 */
export function descendantsOf(pid, rows = psTable()) {
  const children = new Map();
  for (const row of rows) {
    if (!children.has(row.ppid)) children.set(row.ppid, []);
    children.get(row.ppid).push(row.pid);
  }
  const out = [];
  const walk = (current) => {
    for (const child of children.get(current) ?? []) {
      walk(child);
      out.push(child);
    }
  };
  walk(pid);
  return out;
}

/**
 * 精确收掉一个进程树：只杀「我拉起的 pid」及其后代。
 * 先 SIGTERM（给优雅退出机会），2 秒后仍活着的才 SIGKILL。
 */
export async function killTree(pid, { label = 'process' } = {}) {
  if (!isAlive(pid)) return;
  const rows = psTable();
  const victims = [...descendantsOf(pid, rows), pid];
  for (const victim of victims) {
    try {
      process.kill(victim, 'SIGTERM');
    } catch {
      // 已经退了（竞态）—— 忽略
    }
  }
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && victims.some((v) => isAlive(v))) {
    await sleep(100);
  }
  for (const victim of victims) {
    if (!isAlive(victim)) continue;
    try {
      process.kill(victim, 'SIGKILL');
    } catch {
      // 同上
    }
  }
  await sleep(200);
  log(`已回收 ${label}（pid ${pid}，连同 ${victims.length - 1} 个后代）`);
}

/** 端口是否空闲（在本机 127.0.0.1 上试着 listen 一下）。 */
export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/**
 * 拉起一个子进程并登记（收尾时按 pid 精确回收）。
 * @returns {{label: string, proc: import('node:child_process').ChildProcess, pid: number, output: string[]}}
 */
export function launch(label, command, args, options = {}) {
  const proc = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const record = { label, proc, pid: proc.pid, output: [] };
  spawned.push(record);
  const collect = (chunk) => {
    for (const line of String(chunk).split('\n')) {
      if (line.trim()) record.output.push(line.trim());
    }
    if (record.output.length > 400) record.output.splice(0, record.output.length - 400);
  };
  proc.stdout.on('data', collect);
  proc.stderr.on('data', collect);
  proc.on('exit', (code, signal) => {
    record.exited = { code, signal };
  });
  return record;
}

/** 本次会话拉起过的全部进程记录（收尾清点用）。 */
export function spawnedRecords() {
  return [...spawned];
}

/** 清点：还活着的进程记录（应为 0 —— 无孤儿）。 */
export function liveSpawned() {
  return spawned.filter((record) => isAlive(record.pid));
}

// ============================================================================
// MCP 客户端（JSON-RPC 2.0 over HTTP POST /mcp）
// ============================================================================

let mcpSeq = 0;

/**
 * 调一个 MCP 工具，返回信封里的 data。
 * @param {string} tool 工具名（如 stratix_session_list）
 * @param {object} args 工具入参
 * @param {number} port service 端口
 */
export async function mcpCall(tool, args = {}, port) {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: ++mcpSeq,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  if (!response.ok) {
    throw new Error(`MCP ${tool} 调用失败：HTTP ${response.status}`);
  }
  const frame = await response.json();
  if (frame.error) {
    throw new Error(`MCP ${tool} 返回协议错误：${JSON.stringify(frame.error)}`);
  }
  const envelope = frame.result?.structuredContent;
  if (!envelope) {
    throw new Error(`MCP ${tool} 没有返回信封：${JSON.stringify(frame.result).slice(0, 300)}`);
  }
  if (!envelope.ok) {
    throw new Error(`MCP ${tool} 失败：${envelope.error?.code} —— ${envelope.error?.message}`);
  }
  return envelope.data;
}

// ============================================================================
// world-sync 观察客户端（既是「外部客户端」也是 seq 探针）
// ============================================================================

/**
 * 造一个 world-sync 观察客户端。
 * @param {string} url ws 地址
 * @param {string} clientId 客户端 id
 */
export function createObserver(url, clientId) {
  const ws = new WebSocket(url);
  const state = {
    ws,
    lastSeq: null,
    lastSnapshot: null,
    pending: new Map(),
    waiters: [],
    closed: false,
  };

  const notifyWaiters = () => {
    state.waiters = state.waiters.filter((waiter) => {
      if (state.lastSeq === null || state.lastSeq <= waiter.threshold) return true;
      clearTimeout(waiter.timer);
      waiter.resolve(state.lastSeq);
      return false;
    });
  };

  ws.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message.type === 'snapshot') {
      state.lastSeq = message.seq;
      state.lastSnapshot = message.state;
      notifyWaiters();
      return;
    }
    if (message.type === 'command.ack') {
      const resolver = state.pending.get(message.commandId);
      if (resolver) {
        state.pending.delete(message.commandId);
        clearTimeout(resolver.timer);
        resolver.resolve(message);
      }
    }
  });

  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error(`world-sync 连接失败：${url}`)));
    ws.addEventListener('close', () => {
      state.closed = true;
    });
  });

  const hello = () =>
    ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, clientId }));

  return {
    state,
    opened,
    /** 经 command.forward 发一条 HudCommand，等回执。 */
    async sendCommand(command, { timeoutMs = 15_000 } = {}) {
      await opened;
      const commandId = `e2e-${Date.now()}-${++mcpSeq}`;
      const ack = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          state.pending.delete(commandId);
          reject(new Error(`命令回执超时：${command.type}`));
        }, timeoutMs);
        state.pending.set(commandId, { resolve, reject, timer });
      });
      ws.send(JSON.stringify({ type: 'command.forward', commandId, command }));
      const result = await ack;
      if (!result.ok) {
        throw new Error(
          `命令被拒：${command.type} —— ${result.error?.code} ${result.error?.message}`
        );
      }
      return result;
    },
    /** seq 探针：再发一次 hello，service 会立刻回一份全量快照（带当前 seq）。 */
    async probeSeq({ timeoutMs = 15_000 } = {}) {
      await opened;
      const threshold = state.lastSeq ?? 0;
      const seq = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('seq 探针超时（没等到新快照）'));
        }, timeoutMs);
        state.waiters.push({ threshold, resolve, timer });
        hello();
      });
      return seq;
    },
    close() {
      try {
        ws.close();
      } catch {
        // 已经关了
      }
    },
  };
}
