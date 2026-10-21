#!/usr/bin/env node

/**
 * 冒烟脚本：core/agent-link ↔ stratix-gateway 协议的真实联通验证。
 *
 * 用法：npm run smoke:agent-link
 *
 * 为什么需要它：单测里的对端是内存实现的（快、确定），但真正会崩的地方在**真实 socket 上**——
 *   地址拼错、握手头带不上、代理路由不匹配、帧在网络上被截断。
 * 本脚本起一个**按现网协议实现的本地网关桩**（HTTP 路由 + WS 代理路由，形状对齐
 * src/stratix-gateway/api/routes/openclaw.ts 与 GatewayOpenClawAdapter），
 * 再让 core/agent-link 走完整条链路：命令 → 建链 → 对话往返 → 掉线自动重连 → 关闭。
 *
 * 预期输出（成功时逐条打印，最后一行 SMOKE PASS）：
 *   [1] link.open → connecting → connected
 *   [2] chat.send 往返 → outbound/inbound 两条消息进 WorldState.messages
 *   [3] 对端主动断开 → reconnecting → connected（退避重连）
 *   [4] link.close → closing → closed，/disconnect 被调用
 *
 * 与真实网关联调（需要真实 OpenClaw 实例时）：
 *   1) npm run dev:backend                      # 起 stratix-gateway（端口 3010）
 *   2) 把本脚本的 START_GATEWAY_STUB 换成 false、AGENT_ENDPOINT 指向真实 OpenClaw 地址
 *   3) npm run smoke:agent-link -- --external   # 见文件末尾的分支说明
 */

import http from 'http';
import { WebSocketServer, type WebSocket } from 'ws';

import { emitCommand } from '../src/core/bus';
import { createAgentLinkManager, createGatewayTransport } from '../src/core/agent-link';
import { createCoreRuntime } from '../src/core/runtime';
import { createStore } from '../src/core/store';
import type { AgentLinkManager } from '../src/core/agent-link';
import type { WorldState } from '../src/core/types';

const PORT = Number(process.env.SMOKE_PORT ?? 3399);
const AGENT_ENDPOINT = process.env.SMOKE_AGENT_ENDPOINT ?? 'http://127.0.0.1:18080';

const steps: string[] = [];

function log(step: string): void {
  steps.push(step);
  console.log(`  ✓ ${step}`);
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 等到条件成立（带超时）——冒烟脚本里比固定 sleep 稳，不会因机器慢而误报。 */
async function waitUntil(label: string, predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await wait(25);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

// ============================================================================
// 网关桩：HTTP 控制面 + WS 代理数据面（形状对齐现网，只读参考未改动）
// ============================================================================

interface GatewayStub {
  readonly url: string;
  readonly proxies: Map<string, number>; // proxyKey → 当前存活的 WS 连接数
  /** 累计 WS 接入次数（同一 proxyKey 重连也累计）——重连是否真的发生，看这个数。 */
  readonly connectionCount: number;
  readonly disconnectCalls: number;
  /** 主动掐断当前所有 WS 连接（模拟代理掉线）。 */
  dropConnections(code?: number, reason?: string): void;
  close(): Promise<void>;
}

async function startGatewayStub(): Promise<GatewayStub> {
  const proxies = new Map<string, number>();
  const sockets = new Set<WebSocket>();
  const state = { disconnectCalls: 0, connectionCount: 0 };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
    const reply = (code: number, message: string, data: unknown = null): void => {
      res.writeHead(code === 200 ? 200 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code, message, data, requestId: `req_${Date.now()}` }));
    };

    if (url.pathname === '/api/stratix/openclaw/connect' && req.method === 'POST') {
      reply(200, 'OpenClaw connection configured', {
        endpoint: AGENT_ENDPOINT,
        connected: true,
        proxyKey: AGENT_ENDPOINT.replace(/[^a-zA-Z0-9]/g, '_'),
      });
      return;
    }
    if (url.pathname === '/api/stratix/openclaw/ws-connect' && req.method === 'POST') {
      reply(200, 'Connected successfully', {
        endpoint: AGENT_ENDPOINT,
        connected: true,
        deviceId: 'device_smoke0001',
      });
      return;
    }
    if (url.pathname === '/api/stratix/openclaw/disconnect' && req.method === 'POST') {
      state.disconnectCalls += 1;
      reply(200, 'OpenClaw connection removed', { endpoint: AGENT_ENDPOINT });
      return;
    }
    if (url.pathname === '/api/stratix/openclaw/test') {
      reply(200, 'OpenClaw reachable', { endpoint: AGENT_ENDPOINT, success: true });
      return;
    }
    reply(404, 'not found');
  });

  // 数据面：/api/stratix/openclaw/proxy/:proxyKey/ws
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const match = /^\/api\/stratix\/openclaw\/proxy\/([A-Za-z0-9_]+)\/ws$/.exec(new URL(request.url ?? '', 'http://x').pathname);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const proxyKey = match[1];
      state.connectionCount += 1;
      proxies.set(proxyKey, (proxies.get(proxyKey) ?? 0) + 1);
      sockets.add(ws);
      console.log(`    [gateway] WS 已接入 proxyKey=${proxyKey} clientId=${new URL(request.url ?? '', 'http://x').searchParams.get('clientId')}`);
      ws.on('message', (raw) => {
        const frame = JSON.parse(String(raw)) as { type?: string; requestId?: string; message?: string };
        console.log(`    [agent]   ← ${String(raw).slice(0, 160)}`);
        if (frame.type === 'text' && frame.requestId) {
          // 对话应答：与 GatewayOpenClawAdapter 期望的 response 帧同构
          ws.send(JSON.stringify({ type: 'response', requestId: frame.requestId, message: `echo:${frame.message}` }));
          // 再补一条主动事件：远端消息 + 状态（聊天抽屉与单位状态靠它刷新）
          ws.send(
            JSON.stringify({
              type: 'event',
              event: 'agent.message',
              payload: { text: `任务已受理：${frame.message}`, author: 'writer', sessionKey: 'sess_smoke_1' },
            })
          );
          ws.send(JSON.stringify({ type: 'event', event: 'agent.status', payload: { status: 'busy' } }));
        }
      });
      ws.on('close', () => sockets.delete(ws));
    });
  });

  await new Promise<void>((resolve) => server.listen(PORT, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${PORT}`,
    proxies,
    get connectionCount(): number {
      return state.connectionCount;
    },
    get disconnectCalls(): number {
      return state.disconnectCalls;
    },
    dropConnections: (code = 1011, reason = 'OpenClaw connection lost'): void => {
      sockets.forEach((socket) => socket.close(code, reason));
      sockets.clear();
    },
    close: async (): Promise<void> => {
      sockets.forEach((socket) => socket.terminate());
      sockets.clear();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

// ============================================================================
// 冒烟主流程
// ============================================================================

async function main(): Promise<void> {
  console.log(`[smoke] 起网关桩：127.0.0.1:${PORT}，模拟 agent 端点：${AGENT_ENDPOINT}`);
  const gateway = await startGatewayStub();

  const store = createStore();
  // 真实 transport：HTTP 控制面 + 全局 WebSocket（Node 22+ 自带，不引新依赖）
  const transport = createGatewayTransport({ baseUrl: gateway.url, timeoutMs: 3000 });
  const manager: AgentLinkManager = createAgentLinkManager({ transport, store, timing: { requestTimeoutMs: 3000 } });
  const runtime = createCoreRuntime({ store, agentLink: manager });
  const stopRuntime = runtime.start();

  const phaseOf = (): string => manager.list()[0]?.phase ?? 'none';
  const snapshot = (): WorldState => store.getState();

  try {
    // 1) 命令开局（走真实 HudCommand 通道，与 HUD 的调用路径一致）
    console.log('\n[1] HudCommand link.open → 建链');
    emitCommand({ type: 'link.open', kind: 'openclaw', endpoint: AGENT_ENDPOINT, displayName: 'Smoke Agent' });
    await waitUntil('link connected', () => phaseOf() === 'connected');
    const link = manager.list()[0];
    log(`会话已连接：id=${link.id} agentId=${link.agentId} endpoint=${link.endpoint}（已脱敏）`);
    log(`网关桩记录的 WS 接入次数：${gateway.connectionCount}`);

    // 2) 对话往返（命令 + 真实网络帧）
    console.log('\n[2] HudCommand chat.send → 往返');
    emitCommand({ type: 'chat.send', text: 'ping', linkId: link.id });
    await waitUntil('reply stored', () => snapshot().messages.length >= 2);
    snapshot().messages.forEach((m) => log(`消息 ${m.direction === 'inbound' ? '←' : '→'} [${m.author}] ${m.text}`));
    log(`会话键已回写：${manager.get(link.id)?.sessionId}`);

    // 3) 掉线自动重连（退避）：以"网关桩累计接入次数从 1 涨到 2"作为重连确实发生的证据
    console.log('\n[3] 对端主动断开 → 自动重连');
    const before = gateway.connectionCount;
    gateway.dropConnections();
    await waitUntil('reconnected', () => phaseOf() === 'connected' && gateway.connectionCount > before, 8000);
    log(`重连后仍 connected，会话键保持：${manager.get(link.id)?.sessionId}`);
    log(`累计 WS 接入次数：${before} → ${gateway.connectionCount}`);

    // 4) 关闭（命令 + 销户请求）
    console.log('\n[4] HudCommand link.close → 关闭');
    emitCommand({ type: 'link.close', linkId: link.id });
    await waitUntil('link closed', () => phaseOf() === 'closed');
    await wait(200);
    log(`会话已关闭，网关桩收到 /disconnect 次数：${gateway.disconnectCalls}`);
    log(`WorldState.links 仍保留视图（便于 HUD 显示历史）：phase=${snapshot().links[0]?.phase}`);
  } finally {
    stopRuntime();
    await manager.dispose();
    await gateway.close();
  }

  console.log(`\nSMOKE PASS（${steps.length} 项检查通过）`);
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error('\nSMOKE FAIL');
    console.error(error);
    process.exit(1);
  }
);