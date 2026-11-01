/**
 * task_055 真机验证脚本（一次性，不进测试套件）：
 *   用真实 transport + 真实 kimi / openclaw 进程各跑两轮，验证会话续接链路。
 *   运行：npx ts-node --transpile-only .long-run-agent/tasks/task_055-live.ts
 */
import { createKimiAdapter } from '../../src/app/services/cli-transport/adapters/kimi';
import { createOpenclawAdapter } from '../../src/app/services/cli-transport/adapters/openclaw';
import { createNodeProcessFactory } from '../../src/app/services/cli-transport/node-process';
import { createCliTransport } from '../../src/app/services/cli-transport/runtime';
import type { SpawnOptions, TransportEvent } from '../../src/app/services/cli-transport/transport';

async function run(label: string, adapter: 'kimi' | 'openclaw', prompt: string, options: SpawnOptions): Promise<{ sessionId: string | null; text: string; error: string | null }> {
  const a = adapter === 'kimi' ? createKimiAdapter() : createOpenclawAdapter();
  const transport = createCliTransport(a, { factory: createNodeProcessFactory() });
  let sessionId: string | null = options.sessionId ?? null;
  let text = '';
  let error: string | null = null;
  for await (const event of transport.spawn(prompt, { ...options, timeoutMs: 120_000 })) {
    const e = event as TransportEvent;
    if (e.type === 'session') sessionId = e.sessionId;
    if (e.type === 'done' && e.sessionId) sessionId = e.sessionId;
    if (e.type === 'message') text = e.text;
    if (e.type === 'error') error = e.message;
    console.log(`[${label}] ${e.type}${'sessionId' in e ? ': ' + e.sessionId : ''}${e.type === 'message' ? ': ' + e.text.slice(0, 40).replace(/\n/g, ' ') : ''}${e.type === 'error' ? ': ' + e.message.slice(0, 60) : ''}`);
  }
  return { sessionId, text, error };
}

async function main(): Promise<void> {
  // —— kimi 两轮已完成验证（见报告）：stderr 收割 + resume 同 id 回显 ——

  // —— openclaw：两轮（uuid 生成 + 续接 + 暗号记忆）——
  console.log('===== openclaw round 1（prepare 生成 uuid）=====');
  const o1 = await run('oc-r1', 'openclaw', '这是会话续接测试。请记住暗号：蓝鲸号。只回复两个字：记住了', {});
  console.log(`openclaw r1 → sessionId=${o1.sessionId} text=${o1.text.slice(0, 20)}`);
  if (o1.sessionId) {
    console.log('===== openclaw round 2（--session-id 续接）=====');
    const o2 = await run('oc-r2', 'openclaw', '暗号是什么？只回复暗号本身', { sessionId: o1.sessionId });
    console.log(`openclaw r2 → sessionId=${o2.sessionId} text=${o2.text.slice(0, 20)} 记忆命中=${o2.text.includes('蓝鲸')}`);
  }
}

void main();
