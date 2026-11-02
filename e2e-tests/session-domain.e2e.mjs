#!/usr/bin/env node
/**
 * 文件职责：**会话域验收剧本**（v3.2a S7 / task_097）——
 *   把 v3.2a 会话域（S1~S6）的主张落成一条**可重复执行**的 node 脚本：
 *     ① 起 service（gateway 单进程：执行环 + 存储 + HTTP/MCP + world-sync 端点）；
 *     ② 互聊开场 → 外部 agent 经 MCP 看见 peer_chat 会话（active）；
 *     ③ 制造回合超时（静默 CLI 替身）→ 会话显式转 interrupted + 落一条 interrupt 事件；
 *     ④ 派单跑完 → task_run 会话随终态 closed（全量事件化口径：task_105 起
 *        事件流含 task_started / step / output_tail / completed）；
 *     ⑤ 事件历史经 REST 分页可查（中断前后齐全）；world-sync 快照含 sessions（面板数据源）；
 *     ⑥ 收干净：只杀自己拉起的 pid，退出后不留孤儿。
 *
 * 验收语义见 docs/SESSION-PLAN.md；任务清单见 .long-run-agent/tasks/task_097.md。
 *
 * ★ 端口与进程纪律（硬约束，与 service-resident.e2e.mjs 同一口径）：
 *   - 用户的 dev 实例占着 7523 / 7524 / 9222 —— 本剧本**一个都不碰**，全部走备用端口
 *     （service 7817 / 状态 WS 7818）；
 *   - 清理**只杀自己拉起的 pid**（连同它自己的后代树）—— 全程不 pkill / pgrep 按进程名扫杀；
 *   - 数据目录用临时目录（每次跑都是干净世界 → 可重复执行）。
 *
 * 禁止事项：
 *   1. mock 核心链路 —— 唯一替身是**最末端那一跳**：
 *      ① echo 型 fake CLI adapter（派单用，service-resident/fake-cli.ts 那一支）；
 *      ② 静默 CLI adapter（互聊用，session-domain/peer-cli.ts）——
 *         它只让子进程「跑着但不说话」，**超时判定 / 杀进程树 / 错误码 / 中断记账 / 状态迁移全是真链路**；
 *   2. 真开 Electron —— HUD 侧只断言 world-sync 快照（面板的数据源即这份快照）；
 *   3. 引入新依赖 —— 只用 node 内置（fetch / WebSocket / child_process / net / fs）。
 *
 * 用法：
 *   node e2e-tests/session-domain.e2e.mjs            # 默认：替身模式（确定性）
 *   node e2e-tests/session-domain.e2e.mjs --keep     # 保留临时目录（排查用）
 *
 * @since v3.2a S7（task_097）。
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  RESERVED_PORTS,
  createObserver,
  descendantsOf,
  isAlive,
  killTree,
  launch,
  liveSpawned,
  log,
  mcpCall,
  must,
  portFree,
  printSummary,
  psTable,
  waitFor,
} from './lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

/** 仓库内的可执行文件（不经 npx —— 少一层进程与解析开销）。 */
const bin = (name) => path.join(REPO, 'node_modules', '.bin', name);

// ============================================================================
// 端口与常量（全部备用端口；用户实例的 7523 / 7524 / 9222 一个都不碰）
// ============================================================================

const SERVICE_PORT = Number(process.env.SX_SERVICE_PORT || 7817);
const SERVICE_WS_PORT = Number(process.env.SX_WS_PORT || 7818);
/** world-sync 协议路径（契约见 src/stratix-gateway/api/websocket/world-sync/protocol.ts）。 */
const WORLD_SYNC_PATH = '/ws/world-sync';
/**
 * 互聊回合超时（ms）—— 下界 10s（resolvePeerTurnTimeoutMs 的钳位）。
 * why 要给足 10s：太短会让「会话开场（active）」的观察窗口窄到抓不住
 * （active 只存在于第一回合跑完之前）。
 */
const PEER_TURN_TIMEOUT_MS = Number(process.env.STRATIX_PEER_TURN_TIMEOUT_MS || 10_000);
/** 静默子进程的命令行标记（收尾清点孤儿用；与 peer-cli.ts 同一常量）。 */
const SILENT_CLI_MARKER = 'STRATIX_E2E_SILENT';

// ============================================================================
// 小工具
// ============================================================================

/** 读一段 REST JSON（失败即抛 —— 读路径出错要看得见）。 */
async function restGet(pathname, query = {}) {
  const url = new URL(`http://127.0.0.1:${SERVICE_PORT}${pathname}`);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok || body?.success !== true) {
    throw new Error(`REST ${pathname} 失败：HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.data;
}

/** 会话列表里挑一条（按 kind + 状态筛）。 */
function pickSession(list, { kind, status }) {
  return (list?.sessions?.items ?? []).find(
    (item) => item.kind === kind && (status === undefined || item.status === status)
  );
}

/** 会话 id 集合（world-sync 快照里比对的用）。 */
function sessionIds(snapshot) {
  return new Set((snapshot?.sessions ?? []).map((item) => item.id));
}

// ============================================================================
// 剧本主体
// ============================================================================

async function main() {
  const argv = process.argv.slice(2);
  const keepTmp = argv.includes('--keep');
  const tmpDirs = [];

  log('开始：会话域验收（替身模式，确定性）');
  log(`端口：service=${SERVICE_PORT} statusWS=${SERVICE_WS_PORT}`);

  // ── 步骤 0：前置检查（端口空闲 + 不碰用户端口）──
  for (const port of [SERVICE_PORT, SERVICE_WS_PORT]) {
    if (RESERVED_PORTS.has(port)) {
      throw new Error(`拒绝使用用户实例占用的端口：${port}`);
    }
    if (!(await portFree(port))) {
      throw new Error(`端口 ${port} 被占用（换端口或先收掉占用者）`);
    }
  }
  log('前置检查通过：备用端口空闲，未触碰 7523 / 7524 / 9222');

  let observer = null;

  try {
    // ══ 步骤 1：起 service（单进程：执行环 + 存储 + MCP + world-sync）══
    const serviceDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-e2e-session-'));
    tmpDirs.push(serviceDataDir);
    const service = launch(
      'service',
      bin('tsx'),
      [path.join(HERE, 'session-domain', 'service-process.ts')],
      {
        cwd: REPO,
        env: {
          SX_SERVICE_PORT: String(SERVICE_PORT),
          SX_WS_PORT: String(SERVICE_WS_PORT),
          SX_DATA_DIR: serviceDataDir,
          // 互聊回合超时（走产品口径的覆盖链：环境变量 → resolvePeerTurnTimeoutMs → deps）。
          STRATIX_PEER_TURN_TIMEOUT_MS: String(PEER_TURN_TIMEOUT_MS),
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
      'service 进程起来了（gateway 单进程，备用端口）',
      ready.pid > 0 && isAlive(ready.pid) && ready.port === SERVICE_PORT,
      `pid=${ready.pid} port=${ready.port} peerTimeout=${ready.peerTurnTimeoutMs}ms`
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
      'e2e-session-observer'
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
        const data = await mcpCall('stratix_registry', {}, SERVICE_PORT);
        return data.agents.some((agent) => agent.installed) ? data : false;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    const installed = registry.agents.filter((agent) => agent.installed);
    const agentKind =
      installed.find((agent) => agent.kind === 'claude-code')?.kind ?? installed[0].kind;
    log(`检出可用 agent：${installed.map((a) => `${a.kind}@${a.version ?? '?'}`).join(', ')}`);

    // ══ 步骤 4：建两个角色（真命令、真落地：character.create → 角色 + 战场单位）══
    const stamp = String(Date.now()).slice(-6);
    const nameA = `E2E互聊甲${stamp}`;
    const nameB = `E2E互聊乙${stamp}`;
    for (const name of [nameA, nameB]) {
      await observer.sendCommand({
        type: 'character.create',
        name,
        agentKind,
        skinId: 'skin-default',
      });
    }
    const roster = await waitFor(
      '两个角色都在名册里',
      async () => {
        const data = await mcpCall('stratix_registry', {}, SERVICE_PORT);
        const a = data.characters.find((c) => c.name === nameA);
        const b = data.characters.find((c) => c.name === nameB);
        return a && b ? { a, b } : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 }
    );
    must(
      '两个角色建档并绑定 agent（互聊守门的前提）',
      roster.a.agent_kind === agentKind && roster.b.agent_kind === agentKind,
      `${roster.a.name}/${roster.b.name} → ${agentKind}`
    );

    // ══ 步骤 5：互聊开场 → MCP session_list 看得见 peer_chat（active）══
    const topic = 'E2E 会话域验收议题：超时也要留痕';
    const peerResponse = await fetch(`http://127.0.0.1:${SERVICE_PORT}/e2e/peer-chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: roster.a.id, b: roster.b.id, topic, rounds: 1 }),
    });
    const peerBody = await peerResponse.json();
    must(
      '互聊已开场（测试夹具受理，回合超时按覆盖链生效）',
      peerResponse.ok && peerBody.ok === true && peerBody.timeoutMs === PEER_TURN_TIMEOUT_MS,
      `timeoutMs=${peerBody.timeoutMs}`
    );

    const opening = await waitFor(
      'peer_chat 会话出现在 session_list',
      async () => {
        const data = await mcpCall('stratix_session_list', { kind: 'peer_chat' }, SERVICE_PORT);
        const item = pickSession(data, { kind: 'peer_chat' });
        return item ? data : false;
      },
      { timeoutMs: 30_000, intervalMs: 150 }
    );
    const peerSession = pickSession(opening, { kind: 'peer_chat' });
    must(
      '互聊开场可见：MCP session_list 里有 peer_chat 且 active',
      peerSession.status === 'active',
      `session=${peerSession.id} status=${peerSession.status} title=${peerSession.title}`
    );
    must(
      'peer_chat 会话参与者是互聊双方（开场即建会话）',
      peerSession.participants.length === 2 &&
        peerSession.participants.includes(roster.a.id) &&
        peerSession.participants.includes(roster.b.id),
      `participants=${peerSession.participants.join(',')}`
    );

    // ══ 步骤 6：回合超时 → 会话显式 interrupted ══
    const interrupted = await waitFor(
      'peer_chat 转 interrupted',
      async () => {
        const data = await mcpCall('stratix_session_list', { kind: 'peer_chat' }, SERVICE_PORT);
        const item = pickSession(data, { kind: 'peer_chat', status: 'interrupted' });
        return item ? data : false;
      },
      { timeoutMs: 90_000, intervalMs: 300 }
    );
    const interruptedSession = pickSession(interrupted, { kind: 'peer_chat', status: 'interrupted' });
    must(
      '互聊超时 → 会话显式 interrupted（不再是静默丢失）',
      interruptedSession.status === 'interrupted',
      `session=${interruptedSession.id} status=${interruptedSession.status}`
    );

    // ══ 步骤 7：MCP session_get —— 事件流含中断标记 ══
    const detail = await mcpCall(
      'stratix_session_get',
      { session_id: interruptedSession.id },
      SERVICE_PORT
    );
    const events = detail.events.items;
    const types = events.map((event) => event.type);
    must(
      'MCP session_get 读得到事件流（含中断标记）',
      detail.session.status === 'interrupted' && types.includes('interrupt'),
      `events=${types.join(',')}`
    );
    must(
      '事件流齐全：created → message（议题）→ interrupt',
      types[0] === 'created' && types.includes('message') && types.includes('interrupt'),
      `seq=${events.map((e) => e.seq).join(',')} types=${types.join(',')}`
    );
    const interruptEvent = events.find((event) => event.type === 'interrupt');
    const interruptReason = String(interruptEvent?.payload?.reason ?? '');
    must(
      'interrupt 事件带中断原因（超时可归因）',
      interruptReason.includes('timeout'),
      `reason=${interruptReason.slice(0, 80)}`
    );

    // ══ 步骤 8：REST 事件分页（中断前后齐全 + 游标翻页）══
    const restAll = await restGet(`/api/storage/sessions/${encodeURIComponent(interruptedSession.id)}/events`, {
      limit: 50,
    });
    const restTypes = restAll.events.map((event) => event.type);
    must(
      'REST 读事件流：中断前后齐全（created/message/interrupt）',
      restTypes.includes('created') && restTypes.includes('message') && restTypes.includes('interrupt'),
      `events=${restTypes.join(',')}`
    );
    const restWindow = await restGet(
      `/api/storage/sessions/${encodeURIComponent(interruptedSession.id)}/events`,
      { limit: 2 }
    );
    must(
      'REST 分页取窗口：最新两条是 message + interrupt',
      restWindow.events.length === 2 &&
        restWindow.events[0].type === 'message' &&
        restWindow.events[1].type === 'interrupt',
      `window=${restWindow.events.map((e) => `${e.seq}:${e.type}`).join(',')}`
    );
    const restCursor = await restGet(
      `/api/storage/sessions/${encodeURIComponent(interruptedSession.id)}/events`,
      { beforeSeq: restWindow.events[0].seq, limit: 10 }
    );
    must(
      'REST 游标翻页：中断之前的事件也能翻到',
      restCursor.events.length >= 1 && restCursor.events[0].type === 'created',
      `cursor=${restCursor.events.map((e) => `${e.seq}:${e.type}`).join(',')}`
    );

    // ══ 步骤 9：派单跑完 → task_run 会话随终态 closed（全量事件化）══
    const assigned = await mcpCall(
      'stratix_task_assign',
      { character: roster.a.id, prompt: '请原样回复：会话域验收通过。' },
      SERVICE_PORT
    );
    const finished = await waitFor(
      '任务跑到终态',
      async () => {
        const data = await mcpCall(
          'stratix_task_status',
          { task_id: assigned.task_id, include_output: false },
          SERVICE_PORT
        );
        return ['completed', 'failed', 'cancelled'].includes(data.status) ? data : false;
      },
      { timeoutMs: 120_000, intervalMs: 500 }
    );
    must(
      '任务 completed（执行走 fake CLI adapter：真链路 + 末端替身）',
      finished.status === 'completed',
      `task=${assigned.task_id} status=${finished.status}`
    );

    const taskSessions = await waitFor(
      'task_run 会话出现',
      async () => {
        const data = await mcpCall('stratix_session_list', { kind: 'task_run' }, SERVICE_PORT);
        const item = pickSession(data, { kind: 'task_run' });
        return item ? data : false;
      },
      { timeoutMs: 30_000, intervalMs: 300 }
    );
    const taskSession = pickSession(taskSessions, { kind: 'task_run' });
    must(
      'task_run 会话随终态 closed',
      taskSession.status === 'closed' && taskSession.ref_id === assigned.task_id,
      `session=${taskSession.id} status=${taskSession.status} ref=${taskSession.ref_id}`
    );
    const taskDetail = await mcpCall(
      'stratix_session_get',
      { session_id: taskSession.id },
      SERVICE_PORT
    );
    const taskTypes = taskDetail.events.items.map((event) => event.type);
    must(
      'task_run 会话事件：执行路径埋点齐全（created → task_started → step → output_tail → completed → closed）',
      ['created', 'task_started', 'step', 'output_tail', 'completed', 'closed'].every((type) =>
        taskTypes.includes(type)
      ),
      `events=${taskTypes.join(',')}`
    );

    // ══ 步骤 10：world-sync 快照含 sessions（HUD 会话面板的数据源）══
    await observer.probeSeq();
    const snapshot = observer.state.lastSnapshot;
    const ids = sessionIds(snapshot);
    must(
      'world-sync 快照含 sessions（面板数据源）',
      ids.has(interruptedSession.id) && ids.has(taskSession.id),
      `sessions=${ids.size} 条（含 peer_chat 与 task_run）`
    );
    const snapPeer = (snapshot.sessions ?? []).find((item) => item.id === interruptedSession.id);
    must(
      '快照里的 peer_chat 状态与库里一致（interrupted）',
      snapPeer?.status === 'interrupted',
      `snapshotStatus=${snapPeer?.status}`
    );

    // ══ 步骤 11：互聊的静默子进程已被看门狗收掉（不留孤儿）══
    const rows = psTable();
    const tree = descendantsOf(service.pid, rows);
    const silentAlive = tree.filter((pid) => {
      const row = rows.find((item) => item.pid === pid);
      return row ? row.args.includes(SILENT_CLI_MARKER) : false;
    });
    must(
      '超时后静默子进程已被回收（看门狗杀进程树，不留孤儿）',
      silentAlive.length === 0,
      `service 树 ${tree.length} 个后代，静默子进程 ${silentAlive.length} 个`
    );

    // ══ 步骤 12：收干净（只杀自己拉起的 pid）══
    await killTree(service.pid, { label: 'service' });
    if (observer) observer.close();

    const leftovers = liveSpawned();
    must(
      '剧本拉起的进程全部收干净（无孤儿）',
      leftovers.length === 0,
      leftovers.map((r) => `${r.label}:${r.pid}`).join(', ') || '无残留'
    );
    log('收尾完成：只回收了本剧本拉起的 pid，用户实例未受影响');
  } finally {
    // 兜底：无论成败都把本剧本拉起的东西收掉（只按 pid）。
    if (observer) observer.close();
    for (const record of [...liveSpawned()].reverse()) {
      await killTree(record.pid, { label: record.label });
    }
    if (!keepTmp) {
      for (const dir of tmpDirs) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    } else {
      log(`--keep：临时目录保留在 ${tmpDirs.join(', ')}`);
    }
    printSummary('PASS（会话域：互聊超时可见可查）');
  }
}

main()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error('[e2e] 剧本失败：', error?.stack ?? error);
    process.exitCode = 1;
  });
