#!/usr/bin/env node

/**
 * 脚本：真机跑一次 CLI 传输层的 echo 往返（task_023）。
 *
 * 用法：npm run smoke:cli-transport            # 默认 claude
 *        npm run smoke:cli-transport -- kimi    # 换一家
 *
 * 为什么需要它：单测里跑的是**假** stdout 流（事件序列能稳定复现），
 *   但「真机上 claude 到底吐什么格式的 JSONL、-p 加 --output-format stream-json 会不会报错、
 *   --resume 认不认我们透传的 session id」只有真跑一次才知道。
 *
 * 本脚本走的是**与生产完全相同**的代码路径（同一个 adapter + 同一个 runtime + 同一个 node-process 工厂），
 * 所以这里的输出就是 Electron 主进程接上传输层后会拿到的事件流。
 *
 * 预期输出（本机装了 claude 时）：
 *   [cli-transport] claude-code · binary=claude · args=-p 回复 pong --output-format stream-json ...
 *   [cli-transport] event session  sess-xxxx
 *   [cli-transport] event message  pong
 *   [cli-transport] event done     exitCode=0
 */

import { createTransportFor } from '../src/app/services/cli-transport';
import type { AgentKind } from '../src/core/types';

const KINDS: readonly AgentKind[] = ['claude-code', 'codex', 'opencode', 'kimi', 'openclaw'];

async function main(): Promise<void> {
  const requested = process.argv[2];
  const kind = (requested ?? 'claude-code') as AgentKind;
  if (!KINDS.includes(kind)) {
    console.error(`[cli-transport] 不认识的 agent 种类：${kind}`);
    process.exitCode = 1;
    return;
  }

  const prompt = process.argv[3] ?? '回复 pong';
  // 可选的第 4 个参数：外部会话 id（原样透传给各家 CLI 的 --resume / --session / --session-id）。
  const sessionId = process.argv[4] ?? null;
  const transport = createTransportFor(kind, {}, { logger: (line) => console.log(line) });

  console.log(
    `[cli-transport] ${kind} · binary=${transport.binary} · args=${transport.buildArgs(prompt, { sessionId }).join(' ')}`
  );

  const controller = new AbortController();
  // 兜底超时：真机 CLI 可能卡住（等网络 / 等鉴权）—— 不能让脚本永远挂着。
  const guard = setTimeout(() => {
    console.log('[cli-transport] 超时，主动取消');
    controller.abort();
  }, 120_000);

  let sawDone = false;
  try {
    for await (const event of transport.spawn(prompt, { signal: controller.signal, sessionId })) {
      if (event.type === 'message') {
        console.log(`[cli-transport] event message  ${event.text}`);
      } else if (event.type === 'session') {
        console.log(`[cli-transport] event session  ${event.sessionId}`);
      } else if (event.type === 'tool_use') {
        console.log(`[cli-transport] event tool_use ${event.tool}`);
      } else if (event.type === 'tool_result') {
        console.log(`[cli-transport] event tool_res ${event.tool ?? ''}`);
      } else if (event.type === 'done') {
        sawDone = true;
        console.log(`[cli-transport] event done     exitCode=${event.exitCode} session=${event.sessionId ?? '-'}`);
      } else {
        console.log(`[cli-transport] event error    [${event.code}] ${event.message}`);
      }
    }
  } finally {
    clearTimeout(guard);
  }

  if (!sawDone) {
    console.error('[cli-transport] 没有拿到 done 事件 —— 本轮不算跑通');
    process.exitCode = 1;
    return;
  }
  console.log('[cli-transport] 往返完成');
}

main().catch((error: unknown) => {
  console.error('[cli-transport] 脚本异常：', error);
  process.exitCode = 1;
});
