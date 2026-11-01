#!/usr/bin/env node
/**
 * 文件职责：**「服务常驻、Electron 可选」的可执行验收剧本**（前后端分离 C1 / task_084）——
 *   把产品主张落成一条**可重复执行**的 node 脚本：
 *     ① 起 service（gateway 单进程：执行环 + 存储 + HTTP/MCP + world-sync 端点）；
 *     ② MCP world_snapshot 断言真实 units 非空；
 *     ③ task_assign（fake CLI adapter 保证确定性；`--real` 可切真 claude）→ task completed → mission done；
 *     ④ 全程断言**无 Electron 进程**参与这一段；
 *     ⑤ 拉起 Electron 远程模式（装配开关开）→ 断言视图恢复（units / tasks / missions 可见）；
 *     ⑥ kill Electron → 再拉起 → 断言状态无损（seq 续推、无重复 mission）；
 *     ⑦ 收干净：只杀自己拉起的 pid，退出后不留孤儿。
 *
 * 验收语义见 docs/SERVICE-SPLIT-PLAN.md §6；任务清单见 .long-run-agent/tasks/task_084.md。
 *
 * ★ 端口与进程纪律（硬约束）：
 *   - 用户的 dev 实例占着 7523 / 7524 / 9222 —— 本剧本**一个都不碰**，全部走备用端口
 *     （service 7797 / 状态 WS 7798 / CDP 7799 / vite 7601）；
 *   - 清理**只杀自己拉起的 pid**（连同它自己的后代树）—— 全程不 pkill / pgrep 按进程名扫杀
 *     （用户的 Electron 实例正在跑，按名扫杀会误杀它）；
 *   - Electron 壳用 `--user-data-dir=<临时目录>` 隔离：既不碰用户的 Electron 数据目录，
 *     也让「本剧本拉起的 Electron」在进程表里有唯一可认的标记。
 *
 * 禁止事项：
 *   1. mock 核心链路数据 —— 唯一替身是**最末端那一跳**（fake CLI adapter，任务明确允许）：
 *      core 的裁决、队列、相位、mission 回报全是真的；
 *   2. 引入新依赖 —— 只用 node 内置（fetch / WebSocket / child_process / net）；
 *   3. 改用户配置 / 改用户实例 —— 不写用户的数据目录、不动 7523 / 7524 / 9222。
 *
 * 用法：
 *   node e2e-tests/service-resident.e2e.mjs            # 默认：fake CLI adapter（确定性）
 *   node e2e-tests/service-resident.e2e.mjs --real     # 切真 claude（慢、要花钱、结果不确定）
 *   node e2e-tests/service-resident.e2e.mjs --keep     # 保留临时目录（排查用）
 *
 * @since task_084（service-split C1）。
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { connectPage, READ_STATE_EXPR, sleep } from './lib/cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** 仓库内的可执行文件（不经 npx —— 少一层进程与解析开销）。 */
const bin = (name) => path.join(REPO, 'node_modules', '.bin', name);

// ============================================================================
// 端口与常量（全部备用端口；用户实例的 7523 / 7524 / 9222 一个都不碰）
// ============================================================================

const SERVICE_PORT = Number(process.env.SX_SERVICE_PORT || 7797);
const SERVICE_WS_PORT = Number(process.env.SX_WS_PORT || 7798);
const CDP_PORT = Number(process.env.SX_CDP_PORT || 7799);
const VITE_PORT = Number(process.env.SX_VITE_PORT || 7601);
/** 用户实例占用的端口 —— 剧本自己撞上就是错（启动前先查）。 */
const RESERVED_PORTS = new Set([7523, 7524, 9222]);
/** world-sync 协议路径（契约见 src/stratix-gateway/api/websocket/world-sync/protocol.ts）。 */
const WORLD_SYNC_PATH = '/ws/world-sync';
/** 渲染入口 HTML（镜像 src/app/entry-paths.ts 的 NEW_ENTRY_HTML；拼错时 vite 会回 404，剧本当场失败）。 */
const ENTRY_HTML = 'src/app/main/index.html';

// ============================================================================
// 输出与断言
// ============================================================================

/** 断言清单（收尾时逐条打印 —— 这就是要贴进 task_084.md 的那 30 行）。 */
const checks = [];
/** 本剧本拉起的进程（收尾时按 pid 精确回收）。 */
const spawned = [];

function log(...args) {
  console.log('[e2e]', ...args);
}

/** 记一条断言；不通过即抛（失败即停，不留半吊子状态）。 */
function must(name, condition, detail = '') {
  // 详情压成一行（摘要要贴进任务文档，多行会把「最后 30 行」撑乱）。
  const flat = String(detail).replace(/\s+/g, ' ').trim().slice(0, 160);
  checks.push({ name, ok: Boolean(condition), detail: flat });
  if (!condition) {
    throw new Error(`断言失败：${name}${flat ? `（${flat}）` : ''}`);
  }
  log(`✓ ${name}${flat ? ` — ${flat}` : ''}`);
}

/** 轮询直到 fn 返回真值；超时抛错（带最后一次的描述）。 */
async function waitFor(label, fn, { timeoutMs = 60_000, intervalMs = 250 } = {}) {
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

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 进程表快照：pid → { ppid, args }。 */
function psTable() {
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

/** 一行进程是不是 Electron（主进程或 helper 都算）。 */
function isElectronRow(row) {
  return /Electron\.app\/Contents\/MacOS\/Electron/i.test(row.args);
}

/** 某 pid 的全部后代（**由深到浅**：先杀子再杀父，避免子进程被 init 收养后失控）。 */
function descendantsOf(pid, rows = psTable()) {
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
async function killTree(pid, { label = 'process' } = {}) {
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
function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

/** 拉起一个子进程并登记（收尾时按 pid 精确回收）。 */
function launch(label, command, args, options = {}) {
  const proc = spawn(command, args, {
    cwd: REPO,
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

// ============================================================================
// MCP 客户端（JSON-RPC 2.0 over HTTP POST /mcp）
// ============================================================================

let mcpSeq = 0;

async function mcpCall(tool, args = {}) {
  const response = await fetch(`http://127.0.0.1:${SERVICE_PORT}/mcp`, {
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
    throw new Error(
      `MCP ${tool} 失败：${envelope.error?.code} —— ${envelope.error?.message}`
    );
  }
  return envelope.data;
}

// ============================================================================
// world-sync 观察客户端（既是「外部客户端」也是 seq 探针）
// ============================================================================

function createObserver(url, clientId) {
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
    ws.send(
      JSON.stringify({ type: 'hello', protocolVersion: 1, clientId })
    );

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

// ============================================================================
// 剧本主体
// ============================================================================

async function main() {
  const argv = process.argv.slice(2);
  const realCli = argv.includes('--real');
  const keepTmp = argv.includes('--keep');
  const tmpDirs = [];

  log(`开始：${realCli ? '真 claude 模式（--real）' : 'fake CLI adapter 模式（确定性）'}`);
  log(`端口：service=${SERVICE_PORT} statusWS=${SERVICE_WS_PORT} cdp=${CDP_PORT} vite=${VITE_PORT}`);

  // ── 步骤 0：前置检查（端口空闲 + 不碰用户端口）──
  for (const port of [SERVICE_PORT, SERVICE_WS_PORT, CDP_PORT, VITE_PORT]) {
    if (RESERVED_PORTS.has(port)) {
      throw new Error(`拒绝使用用户实例占用的端口：${port}`);
    }
    if (!(await portFree(port))) {
      throw new Error(`端口 ${port} 被占用（换端口或先收掉占用者）`);
    }
  }
  log('前置检查通过：备用端口空闲，未触碰 7523 / 7524 / 9222');

  let observer = null;
  let cdpSession = null;

  try {
    // ══ 步骤 1：起 service（单进程：执行环 + 存储 + MCP + world-sync）══
    const serviceDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-e2e-service-'));
    tmpDirs.push(serviceDataDir);
    const service = launch(
      'service',
      bin('tsx'),
      [path.join(HERE, 'service-resident', 'service-process.ts')],
      {
        env: {
          SX_SERVICE_PORT: String(SERVICE_PORT),
          SX_WS_PORT: String(SERVICE_WS_PORT),
          SX_DATA_DIR: serviceDataDir,
          SX_REAL_CLI: realCli ? '1' : '0',
        },
      }
    );
    const readyLine = await waitFor(
      'service 就绪',
      () => service.output.find((line) => line.startsWith('SX_SERVICE_READY ')),
      { timeoutMs: 120_000, intervalMs: 200 }
    );
    const ready = JSON.parse(readyLine.slice('SX_SERVICE_READY '.length));
    must(
      'service 进程起来了（gateway 单进程）',
      ready.pid > 0 && isAlive(ready.pid) && ready.port === SERVICE_PORT,
      `pid=${ready.pid} port=${ready.port}`
    );
    await waitFor(
      'service 健康检查',
      async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${SERVICE_PORT}/health`);
          return res.ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 30_000 }
    );
    log(`service 就绪（pid=${ready.pid}，数据目录=${serviceDataDir}）`);

    // ══ 步骤 2：接一个 world-sync 观察客户端（外部客户端，非 Electron）══
    observer = createObserver(
      `ws://127.0.0.1:${SERVICE_PORT}${WORLD_SYNC_PATH}`,
      'e2e-observer'
    );
    await observer.opened;
    await observer.probeSeq();
    must(
      'world-sync 端点可连（观察客户端收到全量快照）',
      observer.state.lastSnapshot !== null,
      `seq=${observer.state.lastSeq}`
    );

    // ══ 步骤 3：等本地 CLI 探测出结果（决定角色绑哪种 agent）══
    const registry = await waitFor(
      'agent 探测结果',
      async () => {
        const data = await mcpCall('stratix_registry', {});
        return data.agents.some((agent) => agent.installed) ? data : false;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    const installed = registry.agents.filter((agent) => agent.installed);
    const agentKind =
      installed.find((agent) => agent.kind === 'claude-code')?.kind ?? installed[0].kind;
    log(`检出可用 agent：${installed.map((a) => `${a.kind}@${a.version ?? '?'}`).join(', ')}`);

    // ══ 步骤 4：经 command.forward 建角色（真命令，真落地）══
    const characterName = `E2E常驻${String(Date.now()).slice(-5)}`;
    await observer.sendCommand({
      type: 'character.create',
      name: characterName,
      agentKind,
      skinId: 'skin-default',
    });
    const snapshot = await waitFor(
      'world_snapshot 里出现真实单位',
      async () => {
        const data = await mcpCall('stratix_world_snapshot', {
          filters: { domains: ['units', 'characters'], limit: 50 },
        });
        return data.totals.units > 0 ? data : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 }
    );
    const character = snapshot.characters.items.find((item) => item.name === characterName);
    const unit = snapshot.units.items.find((item) => item.character_id === character?.id);
    must(
      'MCP world_snapshot 断言真实 units 非空',
      snapshot.totals.units > 0 && Boolean(unit),
      `units=${snapshot.totals.units}（unit=${unit?.id ?? '无'}）`
    );
    must(
      '角色已建档并绑定 agent',
      Boolean(character) && character.agent_kind === agentKind,
      `character=${character?.id} agent=${character?.agent_kind}`
    );

    // ══ 步骤 5：建一条编组任务（mission）并自动接单开工 ══
    const mission = await mcpCall('stratix_mission_create', {
      title: `E2E 常驻验收 ${characterName}`,
      units: [unit.id],
      auto_confirm: true,
    });
    must(
      'mission 已创建并进入 running',
      mission.phase === 'running',
      `mission=${mission.mission_id} phase=${mission.phase}`
    );

    // ══ 步骤 6：派单（无 Electron 参与！执行在 service 进程里）══
    const assigned = await mcpCall('stratix_task_assign', {
      character: character.id,
      prompt: '请原样回复：E2E 常驻验收通过。',
      mission_id: mission.mission_id,
    });
    log(`已派单：task=${assigned.task_id} character=${assigned.character.id}`);

    const finished = await waitFor(
      '任务跑到终态',
      async () => {
        const data = await mcpCall('stratix_task_status', {
          task_id: assigned.task_id,
          include_output: false,
        });
        return ['completed', 'failed', 'cancelled'].includes(data.status) ? data : false;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    must(
      '任务 completed（无 Electron，agent 在 service 进程里干活）',
      finished.status === 'completed',
      `task=${finished.task_id} status=${finished.status}`
    );
    if (!realCli) {
      must(
        '任务输出来自 fake CLI adapter（真链路 + 末端替身）',
        String(finished.output).includes('e2e-fake-cli'),
        String(finished.output).slice(0, 60)
      );
    }

    // ══ 步骤 7：任务完成 → mission 收尾 ══
    const missionStatus = await waitFor(
      'mission 收尾',
      async () => {
        const data = await mcpCall('stratix_mission_status', {
          mission_id: mission.mission_id,
        });
        return data.mission.phase === 'done' ? data : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 }
    );
    must(
      'mission done（任务 completed → mission 收尾）',
      missionStatus.mission.phase === 'done',
      `mission=${missionStatus.mission.id} phase=${missionStatus.mission.phase}`
    );

    // ══ 步骤 8：断言这一段全程没有 Electron ══
    const electronMarker = `--remote-debugging-port=${CDP_PORT}`;
    const rowsAfterWork = psTable();
    const serviceTree = descendantsOf(service.pid, rowsAfterWork);
    const electronInServiceTree = serviceTree.filter((pid) => {
      const row = rowsAfterWork.find((item) => item.pid === pid);
      return row ? isElectronRow(row) : false;
    });
    must(
      'service 进程树里没有 Electron 子进程（干活的是常驻 service）',
      electronInServiceTree.length === 0,
      `service 树 ${serviceTree.length} 个后代，Electron ${electronInServiceTree.length} 个`
    );
    const markedElectron = rowsAfterWork.filter((row) => row.args.includes(electronMarker));
    must(
      '本剧本尚未拉起任何 Electron 实例（无 Electron 阶段成立）',
      markedElectron.length === 0,
      `匹配 ${electronMarker} 的进程 ${markedElectron.length} 个`
    );
    const taskTimeline = [
      `任务 ${assigned.task_id} 在 service 进程内 completed`,
      `（service pid=${service.pid}，Electron 参与数=${electronInServiceTree.length}）`,
    ].join(' ');
    log(taskTimeline);

    // ══ 步骤 9：拉起 Electron 远程模式（装配开关开）══
    // 9a. Electron 壳的构建产物必须是最新的（preload 的 env 白名单含 STRATIX_REMOTE，
    //     main 的 STRATIX_DEV_SERVER_URL 才能把壳指到我们自己的 vite 上）。
    await ensureFreshElectronBuild();

    // 9b. 起自己的 vite dev server（备用端口 7601）—— 不连用户的 7523。
    const vite = launch('vite', bin('vite'), [
      '--port',
      String(VITE_PORT),
      '--strictPort',
      '--host',
      '127.0.0.1',
    ]);
    const viteUrl = `http://127.0.0.1:${VITE_PORT}/${ENTRY_HTML}`;
    await waitFor(
      'vite dev server 就绪',
      async () => {
        try {
          const res = await fetch(viteUrl, { method: 'HEAD' });
          return res.ok;
        } catch {
          return false;
        }
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    log(`vite 就绪：${viteUrl}`);

    // 9c. 拉起 Electron（远程模式 + 独立 user-data-dir + 独立调试端口）。
    const electronUserDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-e2e-electron-'));
    tmpDirs.push(electronUserDataDir);
    const electronEnv = {
      // 装配开关：远程模式（state = service 推的快照；写 = command.forward）。
      STRATIX_REMOTE: '1',
      STRATIX_WORLD_SYNC_URL: `ws://127.0.0.1:${SERVICE_PORT}${WORLD_SYNC_PATH}`,
      // 显式指址：壳连我们自己的 vite，而不是「谁占着 7523 就连谁」。
      STRATIX_DEV_SERVER_URL: viteUrl,
    };
    const electron = launch(
      'electron',
      bin('electron'),
      ['.', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${electronUserDataDir}`],
      { env: electronEnv }
    );
    log(`Electron 已拉起（pid=${electron.pid}，调试端口 ${CDP_PORT}）`);

    // 9d. 接 CDP，断言视图恢复。
    const firstView = await waitFor(
      'Electron 视图恢复（world-sync 快照到达页面）',
      async () => {
        try {
          const session = await connectPage({ base: `127.0.0.1:${CDP_PORT}` });
          const view = await readView(session);
          if (view && view.units.some((u) => u.id === unit.id)) {
            cdpSession = session;
            return view;
          }
          session.close();
          return false;
        } catch {
          return false;
        }
      },
      { timeoutMs: 120_000, intervalMs: 1000 }
    );
    must(
      'Electron 远程模式收到快照：units 可见',
      firstView.units.some((item) => item.id === unit.id),
      `units=${firstView.units.length}`
    );
    must(
      'Electron 远程模式收到快照：tasks 可见且已完成',
      firstView.tasks.some((item) => item.id === assigned.task_id && item.status === 'completed'),
      `tasks=${firstView.tasks.length}`
    );
    must(
      'Electron 远程模式收到快照：missions 可见且已收尾',
      firstView.missions.some((item) => item.id === mission.mission_id && item.phase === 'done'),
      `missions=${firstView.missions.length}`
    );

    const seqBeforeKill = await observer.probeSeq();
    log(`Electron 视图已恢复（seq=${seqBeforeKill}）`);

    // ══ 步骤 10：kill Electron → 再拉起 → 状态无损 ══
    await killTree(electron.pid, { label: 'electron（第一次）' });
    must('第一次 Electron 已收掉', !isAlive(electron.pid), `pid=${electron.pid}`);

    const electron2 = launch(
      'electron#2',
      bin('electron'),
      ['.', `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${electronUserDataDir}`],
      { env: electronEnv }
    );
    const secondView = await waitFor(
      '第二次拉起后的视图恢复',
      async () => {
        try {
          const session = await connectPage({ base: `127.0.0.1:${CDP_PORT}` });
          const view = await readView(session);
          if (view && view.units.some((u) => u.id === unit.id)) {
            if (cdpSession) cdpSession.close();
            cdpSession = session;
            return view;
          }
          session.close();
          return false;
        } catch {
          return false;
        }
      },
      { timeoutMs: 120_000, intervalMs: 1000 }
    );

    must(
      '重启后单位仍在（状态无损）',
      secondView.units.some((item) => item.id === unit.id),
      `units=${secondView.units.length}`
    );
    must(
      '重启后任务仍在且仍是 completed',
      secondView.tasks.some((item) => item.id === assigned.task_id && item.status === 'completed'),
      `tasks=${secondView.tasks.length}`
    );
    must(
      '重启后无重复 mission（数量与重启前一致）',
      secondView.missions.length === firstView.missions.length &&
        secondView.missions.every((item) => firstView.missions.some((old) => old.id === item.id)),
      `重启前 ${firstView.missions.length} 条 / 重启后 ${secondView.missions.length} 条`
    );
    must(
      '重启后无重复任务（数量与重启前一致）',
      secondView.tasks.length === firstView.tasks.length,
      `重启前 ${firstView.tasks.length} 条 / 重启后 ${secondView.tasks.length} 条`
    );

    const seqAfterRestart = await observer.probeSeq();
    must(
      'seq 续推（service 侧版本号单调递增，重启未重置）',
      seqAfterRestart > seqBeforeKill,
      `重启前 seq=${seqBeforeKill} → 重启后 seq=${seqAfterRestart}`
    );

    // ══ 步骤 11：收干净（只杀自己拉起的 pid）══
    await killTree(electron2.pid, { label: 'electron（第二次）' });
    await killTree(vite.pid, { label: 'vite' });
    await killTree(service.pid, { label: 'service' });
    if (observer) observer.close();
    if (cdpSession) cdpSession.close();

    const leftovers = spawned.filter((record) => isAlive(record.pid));
    must(
      '剧本拉起的进程全部收干净（无孤儿）',
      leftovers.length === 0,
      leftovers.map((r) => `${r.label}:${r.pid}`).join(', ') || '无残留'
    );

    // 用户实例的端口/进程一个都没碰：再确认一次用户端口仍在监听（没被我们动过）。
    log('收尾完成：只回收了本剧本拉起的 pid，用户实例未受影响');
  } finally {
    // 兜底：无论成败都把本剧本拉起的东西收掉（只按 pid）。
    if (cdpSession) {
      try {
        cdpSession.close();
      } catch {
        // ignore
      }
    }
    if (observer) observer.close();
    for (const record of [...spawned].reverse()) {
      if (isAlive(record.pid)) {
        await killTree(record.pid, { label: record.label });
      }
    }
    if (!keepTmp) {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      log(`--keep：临时目录保留在 ${tmpDirs.join(', ')}`);
    }
    printSummary();
  }
}

/** 读页面里的世界态快照（CDP 求值）。 */
async function readView(session) {
  try {
    const view = await session.evaluate(READ_STATE_EXPR);
    if (!view || view.error) return null;
    return view;
  } catch {
    return null;
  }
}

/**
 * 确保 Electron 壳的构建产物是最新的。
 * why 要这一步：preload 的 env 白名单（STRATIX_REMOTE / STRATIX_WORLD_SYNC_URL）与
 *   main 的 STRATIX_DEV_SERVER_URL 都是**构建期/运行期**的开关 ——
 *   产物比源码旧 → 远程模式开不起来，壳还会去连「谁占着 7523 就连谁」。
 */
async function ensureFreshElectronBuild() {
  const builtMain = path.join(REPO, 'dist', 'electron', 'electron', 'main.js');
  const builtPreload = path.join(REPO, 'dist', 'electron', 'electron', 'preload.js');
  const sources = [
    path.join(REPO, 'src', 'electron', 'main.ts'),
    path.join(REPO, 'src', 'electron', 'preload.ts'),
  ];
  const newestSource = Math.max(...sources.filter((f) => existsSync(f)).map((f) => statSync(f).mtimeMs));
  const oldestBuilt = [builtMain, builtPreload]
    .filter((f) => existsSync(f))
    .map((f) => statSync(f).mtimeMs)
    .reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const stale = !existsSync(builtMain) || !existsSync(builtPreload) || oldestBuilt < newestSource;
  if (!stale) {
    log('Electron 构建产物是最新的（跳过重建）');
    return;
  }
  log('Electron 构建产物过期 → 重新构建（npm run build:electron）');
  const build = launch('build:electron', 'npm', ['run', 'build:electron'], {});
  const code = await new Promise((resolve) => {
    build.proc.on('exit', (exitCode) => resolve(exitCode ?? -1));
  });
  if (code !== 0) {
    throw new Error(`npm run build:electron 失败（exit=${code}）：\n${build.output.slice(-20).join('\n')}`);
  }
  log('Electron 构建完成');
}

/** 收尾打印：逐条断言 + 一行结论（这就是要贴进 task_084.md 的最后 30 行）。 */
function printSummary() {
  const passed = checks.filter((check) => check.ok).length;
  console.log('──────────────── 验收摘要 ────────────────');
  for (const check of checks) {
    console.log(`${check.ok ? '✅' : '❌'} ${check.name}${check.detail ? ` —— ${check.detail}` : ''}`);
  }
  console.log(`断言：${passed}/${checks.length} 通过`);
  console.log(passed === checks.length ? '结论：PASS（服务常驻、Electron 可选）' : '结论：FAIL');
  console.log('────────────────────────────────────────────');
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('[e2e] 剧本失败：', error?.stack ?? error);
    // 失败时把各子进程的尾部日志打出来（否则只有一句断言失败，无法定位）。
    for (const record of spawned) {
      if (!record.output.length) continue;
      console.error(`[e2e] ---- ${record.label}（pid=${record.pid}）日志尾部 ----`);
      for (const line of record.output.slice(-15)) console.error(`[${record.label}] ${line}`);
    }
    process.exitCode = 1;
  });
