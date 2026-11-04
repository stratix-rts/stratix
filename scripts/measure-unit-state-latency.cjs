/**
 * 实测脚本：MCP 派任务 → app 内 task 状态 → 单位动画 的全链路延迟（task_142）。
 *
 * 用法：
 *   APP_URL=http://127.0.0.1:7530 node scripts/measure-unit-state-latency.cjs
 *
 * 观测点（三个）：
 *   A. 协议层 —— WS 客户端（ws://127.0.0.1:7524/ws/world-sync）收到含 running 的 snapshot 的时刻
 *   B. 应用层 —— app 页面内 window.__srfApp.snapshot() 看到 running 的时刻（本地投影）
 *   C. 视觉层 —— running 时截屏（reports/shots/task142-latency-working.png）
 *
 * 对照实验：把 APP_URL 指到**本地直连模式**的页（如 http://127.0.0.1:7523/），
 *   同一脚本会显示「页面永远看不到这条任务」—— 证明跨进程数据流只存在于远程模式。
 *
 * 前置条件：gateway 跑在 7524；远程模式页跑在 7530（STRATIX_REMOTE=1）。
 * 不依赖任何新增依赖：playwright + ws 均为既有 devDependency。
 */

const { chromium } = require('playwright');
const WebSocket = require('ws');
const fs = require('fs');

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:7530/';
const WS_URL = process.env.WS_URL ?? 'ws://127.0.0.1:7524/ws/world-sync';
const MCP_URL = process.env.MCP_URL ?? 'http://127.0.0.1:7524/mcp';
const CHARACTER = process.env.CHARACTER_ID ?? 'character_1793750123353_1';
const PROMPT = process.env.PROMPT ?? '回一句「142 延迟测量收到」即可，不要做任何其它事。';

const timeline = [];
let t0 = null;

function mark(name, extra) {
  const at = Date.now();
  const rec = { name, at, sinceAssign: t0 === null ? null : at - t0, ...(extra ?? {}) };
  timeline.push(rec);
  console.log(JSON.stringify(rec));
  return rec;
}

async function mcpCall(name, args) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`mcp error: ${JSON.stringify(json.error)}`);
  const text = json.result?.content?.[0]?.text ?? '';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

(async () => {
  // ---------- 观测点 A：协议层 WS ----------
  const ws = new WebSocket(WS_URL);
  const wsStatus = new Map();
  const wsEvents = [];
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== 'snapshot') return;
    for (const task of msg.state?.tasks ?? []) {
      if (wsStatus.get(task.id) === task.status) continue;
      wsStatus.set(task.id, task.status);
      wsEvents.push(mark('ws.snapshot.taskStatus', { taskId: task.id, status: task.status, seq: msg.seq }));
    }
  });
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: 1, clientId: 'unit-state-latency-probe' }));
  mark('ws.connected');

  // ---------- 浏览器：应用层 + 视觉层 ----------
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.__srfApp), null, { timeout: 20000 });
  mark('app.handleReady');

  // 远程模式下单位由 gateway 快照带来；本地直连模式没有单位（不致命）。
  await page.waitForFunction(
    () => ((window.__srfApp?.snapshot?.().units ?? []).length) > 0,
    null,
    { timeout: 8000 },
  ).catch(() => mark('app.noUnits'));
  mark('app.stateReady');

  // ---------- 派单（MCP，gateway 进程内真跑 CLI） ----------
  t0 = Date.now();
  mark('mcp.assign.call');
  const assignResp = await mcpCall('stratix_task_assign', {
    character: CHARACTER,
    prompt: PROMPT,
    origin: 'script',
  });
  mark('mcp.assign.response', { resp: assignResp });
  const newTaskId = assignResp?.data?.task_id ?? null;

  // ---------- 观测点 B/C ----------
  let seenRunning = null;
  let seenCompleted = null;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const snap = await page.evaluate((taskId) => {
      const s = window.__srfApp.snapshot();
      const task = (s.tasks ?? []).find((x) => x.id === taskId);
      return {
        taskStatus: task ? task.status : null,
        unitStatus: (s.units ?? []).map((u) => ({ id: u.id, status: u.status })),
      };
    }, newTaskId);
    if (snap.taskStatus === 'running' && !seenRunning) {
      seenRunning = mark('app.taskRunning', { taskId: newTaskId, unitStatus: snap.unitStatus });
      await page.screenshot({ path: 'reports/shots/task142-latency-working.png' });
      mark('app.screenshotWorking');
    }
    if (snap.taskStatus === 'completed' && !seenCompleted) {
      seenCompleted = mark('app.taskCompleted', { taskId: newTaskId });
      break;
    }
    await page.waitForTimeout(30);
  }

  const wsRunning =
    wsEvents.find(
      (e) => e.name === 'ws.snapshot.taskStatus' && e.status === 'running' && e.taskId === newTaskId,
    ) ?? null;

  const summary = {
    measuredAt: new Date().toISOString(),
    appUrl: APP_URL,
    newTaskId,
    wsSnapshotRunningMs: wsRunning ? wsRunning.sinceAssign : null,
    appProjectedRunningMs: seenRunning ? seenRunning.sinceAssign : null,
    appProjectedCompletedMs: seenCompleted ? seenCompleted.sinceAssign : null,
    timeline,
  };
  fs.writeFileSync('/tmp/unit-state-latency-timeline.json', JSON.stringify(summary, null, 2));
  console.log('=== SUMMARY ===');
  console.log(
    JSON.stringify({
      newTaskId,
      wsSnapshotRunningMs: summary.wsSnapshotRunningMs,
      appProjectedRunningMs: summary.appProjectedRunningMs,
      appProjectedCompletedMs: summary.appProjectedCompletedMs,
    }),
  );

  await browser.close();
  ws.close();
  process.exit(0);
})().catch((error) => {
  console.error('FAILED', error);
  process.exit(1);
});
