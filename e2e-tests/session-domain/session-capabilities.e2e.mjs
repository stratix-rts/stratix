#!/usr/bin/env node
/**
 * 文件职责：**会话域六能力验收剧本**（v3.2b-B9 / task_108）——
 *   把 v3.2b 落地的六项能力（resume / fork / task_run 全量事件化 / 长会话压缩 /
 *   @会话引用 / 自动起名）逐条落成**可重复执行**的 node 剧本：
 *     ① 互聊超时中断 → 恢复续聊 → 续聊**继续产出新事件**（resume）；
 *     ② 从事件流中间点 fork → 新会话事件条数正确 → 新会话可 resume（fork）；
 *     ③ 派单跑完 → task_run 会话事件齐全（started / step / output_tail / completed）；
 *     ④ 事件灌超阈值 → 压缩触发 → 读面返回「摘要 + 近期」（include_raw 可展开原段）；
 *     ⑤ 互聊议题里的 `@session_<id>` → 注入可见 + 留痕（type=reference 事件）；
 *     ⑥ 自动起名（规则模式）生效。
 *
 * ★ 与既有剧本（e2e-tests/session-domain/session-domain.e2e.mjs = v3.2a S7）的关系：
 *   两支共用同一个 service 夹具（e2e-tests/session-domain/service-process.ts）与同一套
 *   进程纪律；本剧本**另起端口、另起数据目录**，故可与老剧本各自独立跑，互不干扰。
 *
 * ★ 端口与进程纪律（硬约束，与另两支剧本同一口径）：
 *   - 用户的 dev 实例占着 7523 / 7524 / 9222 —— 本剧本**一个都不碰**，全部走备用端口
 *     （service 7827 / 状态 WS 7828）；
 *   - 清理**只杀自己拉起的 pid**（连同它自己的后代树）—— 全程不 pkill / pgrep 按进程名扫杀；
 *   - 数据目录用临时目录（每次跑都是干净世界 → 可重复执行）。
 *
 * 禁止事项：
 *   1. mock 核心链路 —— 唯一替身是**最末端那一跳**：CLI 二进制
 *      （静默 / 回显两支，都在 e2e-tests/session-domain/peer-cli.ts）；
 *      被测的六项能力（超时判定 / 状态迁移 / 事件记账 / 折叠 / 引用解析 / 起名）
 *      **一行都没被替身掉**；
 *   2. 真开 Electron —— HUD 侧只断言 world-sync 快照与 MCP / REST 读面；
 *   3. 引入新依赖 —— 只用 node 内置（fetch / WebSocket / child_process / net / fs）。
 *
 * 用法：
 *   node e2e-tests/session-domain/session-capabilities.e2e.mjs            # 默认：替身模式（确定性）
 *   node e2e-tests/session-domain/session-capabilities.e2e.mjs --keep     # 保留临时目录（排查用）
 *
 * @since v3.2b-B9（task_108）。
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
} from '../lib/service-harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

/** 仓库内的可执行文件（不经 npx —— 少一层进程与解析开销）。 */
const bin = (name) => path.join(REPO, 'node_modules', '.bin', name);

// ============================================================================
// 端口与常量（全部备用端口；用户实例的 7523 / 7524 / 9222 一个都不碰）
// ============================================================================

const SERVICE_PORT = Number(process.env.SX_SERVICE_PORT || 7827);
const SERVICE_WS_PORT = Number(process.env.SX_WS_PORT || 7828);
/** world-sync 协议路径（契约见 src/stratix-gateway/api/websocket/world-sync/protocol.ts）。 */
const WORLD_SYNC_PATH = '/ws/world-sync';
/**
 * 互聊回合超时（ms）—— 下界 10s（resolvePeerTurnTimeoutMs 的钳位）。
 * why 10s：这场互聊就是要**超时**（验「超时即中断」），太短会抓不住开场那一下 active。
 */
const PEER_TURN_TIMEOUT_MS = Number(process.env.STRATIX_PEER_TURN_TIMEOUT_MS || 10_000);
/**
 * 长会话压缩阈值（事件条数）—— 用小值加速折叠（env `SX_SESSION_COMPRESS_THRESHOLD`）。
 * why 需要它：折叠的**保留窗**是 50 条（产品口径，不可配），所以「超阈值」只是门槛，
 *   真正折起来仍要 50+ 条原文 —— 阈值给小值能让剧本更快跨过门槛。
 */
const COMPRESS_THRESHOLD = Number(process.env.SX_SESSION_COMPRESS_THRESHOLD || 10);
/** 灌进长会话的消息条数（> 50 才能越过保留窗、真的折起来）。 */
const SEED_EVENT_COUNT = 60;
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

/** POST 一条测试专用路由（夹具路由；失败即抛）。 */
async function postFixture(pathname, body) {
  const response = await fetch(`http://127.0.0.1:${SERVICE_PORT}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`夹具路由 ${pathname} 失败：HTTP ${response.status} ${JSON.stringify(payload).slice(0, 200)}`);
  }
  return payload;
}

/** GET 一条测试专用路由。 */
async function getFixture(pathname) {
  const response = await fetch(`http://127.0.0.1:${SERVICE_PORT}${pathname}`);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`夹具路由 ${pathname} 失败：HTTP ${response.status}`);
  }
  return payload;
}

/** 列一类会话（MCP session_list）。 */
async function listSessions(kind) {
  const data = await mcpCall('stratix_session_list', { kind, limit: 100 }, SERVICE_PORT);
  return data.sessions.items;
}

/** 读一条会话的明细 + 事件流（MCP session_get）。 */
async function getSession(sessionId, extra = {}) {
  return mcpCall('stratix_session_get', { session_id: sessionId, ...extra }, SERVICE_PORT);
}

/** 事件流里的事件类型序列。 */
const typesOf = (detail) => detail.events.items.map((event) => event.type);

/** 事件流里某类型的事件。 */
const eventsOfType = (detail, type) => detail.events.items.filter((event) => event.type === type);

/** 一组会话 id（认「哪些是新建的」用）。 */
const idSet = (items) => new Set(items.map((item) => item.id));

/** 新出现的会话（按 id 差集认，不靠标题猜 —— 标题会被截断、也可能重复）。 */
function newSession(items, beforeIds) {
  return items.find((item) => !beforeIds.has(item.id)) ?? null;
}

// ============================================================================
// 剧本主体
// ============================================================================

async function main() {
  const argv = process.argv.slice(2);
  const keepTmp = argv.includes('--keep');
  const tmpDirs = [];

  log('开始：会话域六能力验收（替身模式，确定性）');
  log(`端口：service=${SERVICE_PORT} statusWS=${SERVICE_WS_PORT}`);
  log(`压缩阈值：SX_SESSION_COMPRESS_THRESHOLD=${COMPRESS_THRESHOLD}`);

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
    // ══ 步骤 1：起 service（单进程：执行环 + 存储 + MCP + world-sync + 互聊夹具）══
    const serviceDataDir = await mkdtemp(path.join(os.tmpdir(), 'stratix-e2e-caps-'));
    tmpDirs.push(serviceDataDir);
    const service = launch(
      'service',
      bin('tsx'),
      [path.join(HERE, 'service-process.ts')],
      {
        cwd: REPO,
        env: {
          SX_SERVICE_PORT: String(SERVICE_PORT),
          SX_WS_PORT: String(SERVICE_WS_PORT),
          SX_DATA_DIR: serviceDataDir,
          // 互聊回合超时（走产品口径的覆盖链：环境变量 → resolvePeerTurnTimeoutMs → deps）。
          STRATIX_PEER_TURN_TIMEOUT_MS: String(PEER_TURN_TIMEOUT_MS),
          // 长会话压缩阈值（小值加速折叠；解析在 app/services/session-compress-config.ts）。
          SX_SESSION_COMPRESS_THRESHOLD: String(COMPRESS_THRESHOLD),
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
      `pid=${ready.pid} port=${ready.port} peerTimeout=${ready.peerTurnTimeoutMs}ms compress=${ready.compressThreshold}`
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

    // ══ 步骤 2：world-sync 观察客户端 + 两个角色（互聊守门的前提）══
    observer = createObserver(
      `ws://127.0.0.1:${SERVICE_PORT}${WORLD_SYNC_PATH}`,
      'e2e-caps-observer'
    );
    await observer.opened;
    await observer.probeSeq();
    must(
      'world-sync 端点可连（观察客户端收到全量快照）',
      observer.state.lastSnapshot !== null,
      `seq=${observer.state.lastSeq}`
    );

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

    const stamp = String(Date.now()).slice(-6);
    const nameA = `E2E能力甲${stamp}`;
    const nameB = `E2E能力乙${stamp}`;
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

    // ══ 能力 1：互聊超时中断 → 恢复 → 续聊继续产出新事件 ══
    // 替身切到**静默**模式：回合跑着但不说话 → 看门狗超时 → 会话显式 interrupted。
    await postFixture('/e2e/peer-mode', { mode: 'silent' });
    const beforePeer1 = idSet(await listSessions('peer_chat'));
    const peerAccepted = await postFixture('/e2e/peer-chat', {
      a: roster.a.id,
      b: roster.b.id,
      topic: '能力1：超时中断后能不能续上',
      rounds: 1,
    });
    must(
      '互聊开场（静默替身：回合跑着但不说话）',
      peerAccepted.ok === true && peerAccepted.timeoutMs === PEER_TURN_TIMEOUT_MS,
      `timeoutMs=${peerAccepted.timeoutMs}`
    );
    const peer1 = await waitFor(
      'peer_chat 会话出现',
      async () => newSession(await listSessions('peer_chat'), beforePeer1),
      { timeoutMs: 30_000, intervalMs: 150 }
    );
    must(
      '互聊开场即建会话（active）',
      peer1.status === 'active',
      `session=${peer1.id} status=${peer1.status}`
    );

    const interrupted1 = await waitFor(
      'peer_chat 转 interrupted（回合超时）',
      async () => {
        const items = await listSessions('peer_chat');
        return items.find((item) => item.id === peer1.id && item.status === 'interrupted') ?? false;
      },
      { timeoutMs: 90_000, intervalMs: 300 }
    );
    must(
      '互聊超时 → 会话显式 interrupted（不再是静默丢失）',
      interrupted1.status === 'interrupted',
      `session=${interrupted1.id} status=${interrupted1.status}`
    );
    const beforeResume = await getSession(peer1.id);
    const interruptEvent = eventsOfType(beforeResume, 'interrupt')[0];
    must(
      '中断留痕：interrupt 事件带原因（超时可归因）',
      Boolean(interruptEvent) && String(interruptEvent.payload?.reason ?? '').includes('timeout'),
      `reason=${String(interruptEvent?.payload?.reason ?? '').slice(0, 60)}`
    );
    const messagesBefore = eventsOfType(beforeResume, 'message').length;

    // 恢复：切到**回显**模式（回合能正常收束）→ 触发互聊引擎的续聊恢复
    //   （生产里 `session.resume` 命令的落点就是 agent-chat-service.resume，见 main-entry.ts）。
    // why 轮询：上一场讨论的收尾（引擎单飞解除）与「会话转 interrupted」只差几毫秒 ——
    //   busy 时如实重试，不当成失败。
    await postFixture('/e2e/peer-mode', { mode: 'echo' });
    const resumed = await waitFor(
      '恢复续聊',
      async () => {
        const outcome = await postFixture('/e2e/peer-resume', { sessionId: peer1.id });
        if (outcome.ok === true) return outcome;
        if (outcome.code === 'busy') return false; // 上一场还没收干净 → 稍后再试
        throw new Error(`恢复续聊被拒：${outcome.code ?? '-'} ${outcome.reason ?? ''}`);
      },
      { timeoutMs: 90_000, intervalMs: 500 }
    );
    must(
      '恢复续聊成功（回灌上文 + 重启轮转）',
      resumed.ok === true && resumed.sessionId === peer1.id && resumed.replayedMessages > 0,
      `code=${resumed.code ?? '-'} replayed=${resumed.replayedMessages ?? '-'} reason=${resumed.reason}`
    );
    const afterResume = await getSession(peer1.id);
    const resumedEvent = eventsOfType(afterResume, 'resumed')[0];
    must(
      '恢复留痕：resumed 事件在事件流里（状态从 interrupted 翻回 active 的那一步）',
      Boolean(resumedEvent),
      `types=${typesOf(afterResume).join(',')}`
    );
    const messagesAfter = eventsOfType(afterResume, 'message').length;
    must(
      '续聊继续产出新事件（恢复之后又落了新的发言事件）',
      messagesAfter > messagesBefore + 1,
      `message 事件 ${messagesBefore} → ${messagesAfter}`
    );
    must(
      '续聊走完轮数 → 会话收尾（closed）',
      afterResume.session.status === 'closed' && typesOf(afterResume).includes('closed'),
      `status=${afterResume.session.status} types=${typesOf(afterResume).join(',')}`
    );

    // ══ 能力 2：fork atSeq 中间点 → 新会话事件数正确 → 新会话可 resume ══
    const sourceDetail = await getSession(peer1.id);
    // 中间点：取「有对话事实」的那个 seq（message / round / interrupt 才是分叉会继承的那几种）。
    const forkable = sourceDetail.events.items.filter(
      (event) => ['message', 'round', 'interrupt'].includes(event.type)
    );
    const atSeq = forkable[0].seq;
    const expectedCopied = forkable.filter((event) => event.seq <= atSeq).length;
    const forked = await mcpCall(
      'stratix_session_fork',
      { session_id: peer1.id, at_seq: atSeq },
      SERVICE_PORT
    );
    must(
      'MCP session_fork 落地：截止 seq 与复制条数如实回读',
      forked.source_session_id === peer1.id &&
        forked.at_seq === atSeq &&
        forked.copied_count === expectedCopied,
      `atSeq=${forked.at_seq} copied=${forked.copied_count} 期望 copied=${expectedCopied}`
    );
    const forkDetail = await getSession(forked.session_id);
    must(
      '分叉会话的事件条数正确（created + 复制的对话事件 + forked）',
      forkDetail.session.event_count === expectedCopied + 2 &&
        forkDetail.events.items.length === expectedCopied + 2,
      `event_count=${forkDetail.session.event_count} 期望=${expectedCopied + 2}`
    );
    must(
      '分叉会话的生命周期正确（新会话自己的 created + 末尾一条 forked 记来源）',
      typesOf(forkDetail)[0] === 'created' &&
        typesOf(forkDetail).at(-1) === 'forked' &&
        eventsOfType(forkDetail, 'forked')[0].payload?.sourceSessionId === peer1.id,
      `types=${typesOf(forkDetail).join(',')}`
    );
    must(
      '分叉不继承源会话的标题（是新会话，标题带分叉标记）',
      forkDetail.session.title !== sourceDetail.session.title &&
        forkDetail.session.title.includes('分叉'),
      `source=${sourceDetail.session.title} fork=${forkDetail.session.title}`
    );

    // 新会话可 resume：先打断（显式中断）→ 再恢复（core 级恢复：翻状态位 + 记 resumed）。
    const interruptedFork = await mcpCall(
      'stratix_session_interrupt',
      { session_id: forked.session_id },
      SERVICE_PORT
    );
    must(
      '分叉会话可被中断（进入可恢复的前置态）',
      interruptedFork.status === 'interrupted',
      `session=${interruptedFork.session_id} status=${interruptedFork.status}`
    );
    const resumedFork = await mcpCall(
      'stratix_session_resume',
      { session_id: forked.session_id },
      SERVICE_PORT
    );
    must(
      'MCP session_resume 落地：分叉会话回到 active',
      resumedFork.status === 'active' && resumedFork.previous_status === 'interrupted',
      `session=${resumedFork.session_id} status=${resumedFork.status}`
    );
    const forkResumed = await getSession(forked.session_id);
    must(
      '分叉会话的恢复也留痕（事件流里有 resumed）',
      typesOf(forkResumed).includes('resumed'),
      `types=${typesOf(forkResumed).join(',')}`
    );

    // ══ 能力 3：task_run 执行 → 事件序列齐全 ══
    const assigned = await mcpCall(
      'stratix_task_assign',
      { character: roster.a.id, prompt: '请原样回复：会话域六能力验收通过。' },
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
    const taskSessions = await listSessions('task_run');
    const taskSession = taskSessions.find((item) => item.ref_id === assigned.task_id);
    must(
      'task_run 会话随终态 closed（会话是任务实体的生命周期镜像）',
      Boolean(taskSession) && taskSession.status === 'closed',
      `session=${taskSession?.id ?? '-'} status=${taskSession?.status ?? '-'} ref=${taskSession?.ref_id ?? '-'}`
    );
    const taskDetail = await getSession(taskSession.id);
    const taskTypes = typesOf(taskDetail);
    must(
      'task_run 事件序列齐全（created → task_started → step → output_tail → completed → closed）',
      ['created', 'task_started', 'step', 'output_tail', 'completed', 'closed'].every((type) =>
        taskTypes.includes(type)
      ),
      `events=${taskTypes.join(',')}`
    );
    must(
      'task_started 事件带着任务 id（面板上一眼认得出是哪单）',
      eventsOfType(taskDetail, 'task_started')[0]?.payload?.taskId === assigned.task_id,
      `taskId=${eventsOfType(taskDetail, 'task_started')[0]?.payload?.taskId}`
    );

    // ══ 能力 4：事件灌超阈值 → 压缩触发 → 读面返回「摘要 + 近期」══
    const seeded = await postFixture('/e2e/session/seed', {
      count: SEED_EVENT_COUNT,
      kind: 'peer_chat',
      participants: [roster.a.id, roster.b.id],
      topic: '能力4：长会话压缩',
    });
    must(
      '长会话数据就绪（走真实写面灌事件，事件条数越过保留窗）',
      seeded.ok === true && seeded.eventCount > SEED_EVENT_COUNT,
      `session=${seeded.sessionId} eventCount=${seeded.eventCount}`
    );
    const compressedView = await getSession(seeded.sessionId, { limit: 200 });
    must(
      '压缩触发：会话折叠过（读面标了 compressed + 折叠区间）',
      compressedView.events.compressed === true &&
        compressedView.events.compressed_ranges.length > 0,
      `ranges=${JSON.stringify(compressedView.events.compressed_ranges)}`
    );
    const range = compressedView.events.compressed_ranges[0];
    const summaryEvent = eventsOfType(compressedView, 'compressed').at(-1);
    must(
      '压缩摘要事件在默认视图里（老段被一条摘要盖住）',
      Boolean(summaryEvent) && summaryEvent.payload.fromSeq === range.from_seq,
      `summary fromSeq=${summaryEvent?.payload?.fromSeq} toSeq=${summaryEvent?.payload?.toSeq} folded=${summaryEvent?.payload?.foldedCount}`
    );
    must(
      '压缩摘要有内容（规则版摘要：首末摘要 + 折叠条数）',
      Boolean(summaryEvent) &&
        summaryEvent.payload.foldedCount > 0 &&
        String(summaryEvent.payload.firstSummary ?? '').length > 0 &&
        String(summaryEvent.payload.lastSummary ?? '').length > 0,
      `foldedCount=${summaryEvent?.payload?.foldedCount}`
    );
    const coveredRaw = compressedView.events.items.filter(
      (event) =>
        event.type !== 'compressed' && event.seq >= range.from_seq && event.seq <= range.to_seq
    );
    const recentRaw = compressedView.events.items.filter((event) => event.type === 'message');
    must(
      '默认视图 = 摘要 + 近期原文（被折叠的老原文不出现）',
      coveredRaw.length === 0 && recentRaw.length > 0,
      `被折叠原文可见 ${coveredRaw.length} 条；近期原文 ${recentRaw.length} 条`
    );
    must(
      '默认视图比全量少（折叠确实生效，不是全量透传）',
      compressedView.events.items.length < compressedView.events.total,
      `可见 ${compressedView.events.items.length} / 全量 ${compressedView.events.total}`
    );
    const rawView = await getSession(seeded.sessionId, { limit: 200, include_raw: true });
    const rawCovered = rawView.events.items.filter(
      (event) =>
        event.type !== 'compressed' && event.seq >= range.from_seq && event.seq <= range.to_seq
    );
    must(
      'include_raw 展开原段（老原文一条不少）',
      rawCovered.length === range.to_seq - range.from_seq + 1 &&
        rawView.events.items.length > compressedView.events.items.length,
      `展开后可见 ${rawView.events.items.length} 条，其中被折叠段 ${rawCovered.length} 条`
    );
    const restView = await restGet(
      `/api/storage/sessions/${encodeURIComponent(seeded.sessionId)}/events`,
      { limit: 200 }
    );
    must(
      'REST 读面同一口径（默认也是摘要 + 近期，与 MCP 共用一份路由）',
      restView.events.some((event) => event.type === 'compressed') &&
        !restView.events.some(
          (event) =>
            event.type !== 'compressed' &&
            event.seq >= range.from_seq &&
            event.seq <= range.to_seq
        ),
      `rest 可见 ${restView.events.length} 条`
    );

    // ══ 能力 5：@session 引用 → 注入可见 + 留痕 ══
    const beforePeer2 = idSet(await listSessions('peer_chat'));
    const topic2 = `请参考 @session_${seeded.sessionId} 里的结论继续讨论`;
    const peer2Accepted = await postFixture('/e2e/peer-chat', {
      a: roster.a.id,
      b: roster.b.id,
      topic: topic2,
      rounds: 1,
    });
    must(
      '带 @session 引用的互聊开场',
      peer2Accepted.ok === true,
      `topic=${topic2.slice(0, 40)}…`
    );
    const peer2 = await waitFor(
      '引用互聊的会话出现',
      async () => newSession(await listSessions('peer_chat'), beforePeer2),
      { timeoutMs: 30_000, intervalMs: 150 }
    );
    // why 等「注入块出现」而不是「有 message 事件」：议题本身也落一条 message 事件
    //   （那是用户说的话），真正的证据是**agent 那侧的发言里带着引用块**。
    const peer2Detail = await waitFor(
      '引用互聊的事件流落齐（注入块进了 agent 的输入）',
      async () => {
        const detail = await getSession(peer2.id);
        const injectedText = detail.events.items.some(
          (event) =>
            event.type === 'message' &&
            String(event.payload?.text ?? '').includes('【引用会话')
        );
        if (injectedText) return detail;
        if (detail.session.status === 'closed') {
          throw new Error('互聊已收束，但事件流里没有注入块（引用没进 agent 的输入）');
        }
        return false;
      },
      { timeoutMs: 60_000, intervalMs: 300 }
    );
    const referenceEvent = eventsOfType(peer2Detail, 'reference')[0];
    must(
      '引用留痕：事件流里有 type=reference 事件，指向被引用的会话',
      Boolean(referenceEvent) && referenceEvent.payload?.targetSessionId === seeded.sessionId,
      `target=${referenceEvent?.payload?.targetSessionId ?? '-'} 期望=${seeded.sessionId}`
    );
    const injected = peer2Detail.events.items
      .filter((event) => event.type === 'message')
      .map((event) => String(event.payload?.text ?? ''))
      .find((text) => text.includes('【引用会话'));
    must(
      '注入可见：被引用的会话内容进了 agent 的输入（发言原文里看得见引用块）',
      Boolean(injected) && injected.includes(seeded.sessionId),
      injected
        ? injected.slice(injected.indexOf('【引用会话'), injected.indexOf('【引用会话') + 60)
        : '未找到引用块'
    );

    // ══ 能力 6：自动起名（规则模式）生效 ══
    const titles = await getFixture('/e2e/titles');
    must(
      '起名实现是规则版（无 LLM 配置 → 规则版；确定性、可复现）',
      titles.providerId === 'rules' && titles.calls.length > 0,
      `provider=${titles.providerId} 调用 ${titles.calls.length} 次`
    );
    const peer2Fresh = await getSession(peer2.id);
    const peer2Title = peer2Fresh.session.title;
    const matched = titles.calls.find((call) => call.title === peer2Title);
    must(
      '起名生效：会话标题就是规则版算出来的那一条（互聊：<议题>，≤20 字）',
      Boolean(matched) &&
        peer2Title.startsWith('互聊：') &&
        peer2Title.length <= 20 &&
        peer2Title.length >= 12,
      `title=${peer2Title}`
    );

    // ══ 步骤 N：面板数据源一致（world-sync 快照含这几条会话）══
    await observer.probeSeq();
    const snapshotIds = new Set(
      (observer.state.lastSnapshot?.sessions ?? []).map((item) => item.id)
    );
    must(
      'world-sync 快照含这几条会话（面板数据源与库一致）',
      snapshotIds.has(peer1.id) &&
        snapshotIds.has(forked.session_id) &&
        snapshotIds.has(taskSession.id) &&
        snapshotIds.has(seeded.sessionId),
      `快照 sessions=${snapshotIds.size} 条`
    );

    // ══ 步骤 N+1：收干净（只杀自己拉起的 pid）══
    const rows = psTable();
    const tree = descendantsOf(service.pid, rows);
    const silentAlive = tree.filter((pid) => {
      const row = rows.find((item) => item.pid === pid);
      return row ? row.args.includes(SILENT_CLI_MARKER) : false;
    });
    must(
      '静默子进程已被看门狗回收（不留孤儿）',
      silentAlive.length === 0,
      `service 树 ${tree.length} 个后代，静默子进程 ${silentAlive.length} 个`
    );

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
    printSummary('PASS（会话域六能力：resume / fork / task_run 事件化 / 压缩 / @引用 / 起名）');
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
