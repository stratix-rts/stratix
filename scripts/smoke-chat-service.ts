#!/usr/bin/env node

/**
 * 脚本：真机跑一次角色对话回路（task_035）。
 *
 * 用法：npm run smoke:chat-service
 *
 * 与 scripts/smoke-cli-transport.ts 的分工：那个打的是 transport 层（adapter + runtime + 进程工厂）；
 * 这个打的是**服务层全链路** —— chat-service 的守门（detectedAgents 放行）/ persona 首发拼装 /
 * 流式转发 / finalize 收束 / session id 回写，transport 用真 claude（node 直连，不经 IPC ——
 * IPC 那一跳只在 Electron 里有意义，node 里同一份服务代码 + 同一个 createTransportFor 更纯）。
 *
 * 跳过规则（不算失败）：`claude --version` 拉不起来（未装），或对话轮里撞上额度/网络层拒绝
 * （MiniMax 代理 429 一类）—— 打印 SKIP 原因，退出码 0。
 */

import { exec } from 'node:child_process';

import { createTransportFor } from '../src/app/services/cli-transport';
import { createChatService, DEFAULT_CHAT_ROUND_TIMEOUT_MS } from '../src/app/services/chat-service';

/** 探测本机 claude 可用性；拉得起来返回版本串，否则 null。 */
function probeClaude(): Promise<string | null> {
  return new Promise((resolve) => {
    exec('claude --version', { timeout: 15_000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

interface RoundReport {
  readonly bubbles: string[];
  replyText: string;
  finalized: boolean;
  sendingBalance: number;
}

async function main(): Promise<void> {
  const version = await probeClaude();
  if (!version) {
    console.log('[chat-smoke] SKIP：本机 claude 不可用（未安装或 --version 超时）。');
    return;
  }
  console.log(`[chat-smoke] claude 探测通过：${version}`);

  const report: RoundReport = { bubbles: [], replyText: '', finalized: false, sendingBalance: 0 };
  const persisted: Array<[string, string]> = [];
  const service = createChatService({
    view: {
      addMessage: (message) => {
        report.bubbles.push(`${message.role}${message.error ? '/error' : ''}: ${message.text}`);
      },
      appendStream: (chunk) => {
        report.replyText += chunk;
      },
      finalizeStream: () => {
        report.finalized = true;
      },
      setSending: (sending) => {
        report.sendingBalance += sending ? 1 : -1;
      },
    },
    getState: () => ({
      characters: [
        {
          id: 'smoke-char',
          name: '冒烟员',
          persona: '冷静务实的工程助手，回答保持简短。',
          level: 1,
          experience: 0,
          agentKind: 'claude-code',
          skinId: null,
          externalSessionId: null,
        },
      ],
      // 守门按真检测的字段形状造（installed=true 才放行）。
      detectedAgents: [
        {
          kind: 'claude-code',
          tier: 'T1',
          installed: true,
          status: 'installed',
          version,
          path: null,
        },
      ],
    }),
    createTransport: (kind) => createTransportFor(kind),
    persistSessionId: (characterId, sessionId) => {
      persisted.push([characterId, sessionId]);
    },
    timeoutMs: Math.min(DEFAULT_CHAT_ROUND_TIMEOUT_MS, 120_000),
  });

  console.log('[chat-smoke] 发送：请只回复两个字：pong');
  await service.send('smoke-char', '请只回复两个字：pong');

  if (report.bubbles.length > 0) {
    console.log(`[chat-smoke] 气泡：${report.bubbles.join(' | ')}`);
  }
  console.log(`[chat-smoke] 回复：${report.replyText}`);
  console.log(`[chat-smoke] finalize=${report.finalized} sending平衡=${report.sendingBalance} 回写=${persisted.length}`);

  const combined = report.bubbles.join(' ') + report.replyText;
  const unavailable = /429|rate.?limit|额度|quota|payment|overloaded/i.test(combined);
  if (unavailable) {
    console.log('[chat-smoke] SKIP：claude 链路不可用（额度/网络层拒绝），按任务口径不算失败。');
    return;
  }

  const failures: string[] = [];
  if (!report.finalized) failures.push('未 finalize');
  if (report.sendingBalance !== 0) failures.push(`setSending 未对称（balance=${report.sendingBalance}）`);
  if (report.replyText.length === 0) failures.push('零文本回复');
  if (persisted.length !== 1) failures.push(`session 回写次数=${persisted.length}（应为 1）`);
  if (!/pong/i.test(report.replyText)) failures.push('回复里没有 pong');

  if (failures.length > 0) {
    console.error(`[chat-smoke] FAIL：${failures.join('；')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[chat-smoke] PASS：守门→persona 拼装→流式→finalize→session 回写 全链路 OK。');
}

void main().catch((error) => {
  console.error('[chat-smoke] 脚本异常：', error);
  process.exitCode = 1;
});
