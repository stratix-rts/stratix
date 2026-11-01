/**
 * 单测：CLI 传输层运行时（app/services/cli-transport/runtime.ts，@since v3.8 / task_023）。
 *
 * 覆盖四块：
 *   1. 抽象契约 —— 内置 adapter 齐备、事件词汇表固定；
 *   2. 运行时 —— 喂样例 stdout 流，断言事件序列（message / tool_use / session / done）；
 *   3. 取消与超时 —— AbortSignal → killTree（**整个进程树**）→ error 事件；
 *   4. 真机杀树 —— 用真实 child_process 起一个带孙进程的 shell，取消后孙进程必须死。
 *
 * 假 stdout 流 = 注入桩（见 helpers/fake-process.ts）；真机往返另有 claude 真跑的一次验证。
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { AGENT_KINDS } from '../../core/types';
import {
  createClaudeAdapter,
  createCodexAdapter,
  createDshAdapter,
  createKimiAdapter,
  createNodeProcessFactory,
  createOpenclawAdapter,
  createOpencodeAdapter,
  createCliTransport,
  verifyAdapterRoster,
  type CliAdapter,
  type TransportEvent,
} from '../services/cli-transport';
import { collect, createFakeProcessFactory } from './helpers/fake-process';

// ============================================================================
// 1. 抽象契约
// ============================================================================

describe('CliTransport 抽象', () => {
  test('内置 adapter 齐备，且与 core 的 AGENT_KINDS 一一对应', () => {
    const { ok, missing } = verifyAdapterRoster();
    expect(missing).toEqual([]);
    expect(ok).toBe(true);
    expect(AGENT_KINDS).toHaveLength(6);
  });

  test('每家 adapter 都声明了自己的 kind / binary / 输出形态', () => {
    const cases: readonly [CliAdapter, string, string][] = [
      [createClaudeAdapter(), 'claude-code', 'claude'],
      [createCodexAdapter(), 'codex', 'codex'],
      [createOpencodeAdapter({ probeServe: async () => ({ ok: false, url: null }) }), 'opencode', 'opencode'],
      [createKimiAdapter(), 'kimi', 'kimi'],
      [createOpenclawAdapter(), 'openclaw', 'openclaw'],
      [createDshAdapter(), 'dsh', 'npx'],
    ];
    for (const [adapter, kind, binary] of cases) {
      expect(adapter.kind).toBe(kind);
      expect(adapter.binary).toBe(binary);
    }
  });
});

// ============================================================================
// 2. 运行时：样例 stdout 流 → 事件序列
// ============================================================================

describe('runtime：样例 stdout 流 → 事件序列', () => {
  test('claude：system/assistant/user/result 四类事件翻译正确', async () => {
    const lines = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-abc' }),
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '我看一下目录' },
            { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a\nb' }] },
      }),
      JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: '我看一下目录' }),
    ];
    const fake = createFakeProcessFactory({ stdout: lines });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('列目录'));

    expect(events.map((event) => event.type)).toEqual([
      'session',
      'message',
      'tool_use',
      'tool_result',
      'done',
    ]);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'sess-abc' });
    expect(events[1]).toEqual({ type: 'message', text: '我看一下目录' });
    expect(events[2]).toMatchObject({ type: 'tool_use', tool: 'Bash', id: 't1' });
    expect(events[3]).toMatchObject({ type: 'tool_result', id: 't1', text: 'a\nb' });
    // done 带最终文本与会话 id（会话 id 原样透传，供 AgentProfile.externalSessionId 用）。
    expect(events[4]).toEqual({
      type: 'done',
      exitCode: 0,
      text: '我看一下目录',
      sessionId: 'sess-abc',
    });
  });

  test('codex：新格式（item.*）事件翻译正确', async () => {
    const lines = [
      JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }),
      JSON.stringify({ type: 'item.started', item: { id: 'i0', type: 'command_execution', command: 'ls' } }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i0', type: 'command_execution', aggregated_output: 'a\nb\n', exit_code: 0 },
      }),
      JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '完成' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 2 } }),
    ];
    const fake = createFakeProcessFactory({ stdout: lines });
    const transport = createCliTransport(createCodexAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('列目录'));

    expect(events.map((event) => event.type)).toEqual([
      'session',
      'tool_use',
      'tool_result',
      'message',
      'done',
    ]);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'th-1' });
    expect(events[3]).toEqual({ type: 'message', text: '完成' });
  });

  test('codex：旧格式（msg.* 信封）也认（版本切换不能整轮静默）', async () => {
    const lines = [
      JSON.stringify({ id: '0', msg: { type: 'session_configured', session_id: 'legacy-1' } }),
      JSON.stringify({ id: '1', msg: { type: 'exec_command_begin', command: ['bash', '-lc', 'ls'], call_id: 'c1' } }),
      JSON.stringify({ id: '2', msg: { type: 'exec_command_end', call_id: 'c1', stdout: 'a\n', exit_code: 0 } }),
      JSON.stringify({ id: '3', msg: { type: 'agent_message', message: '完成' } }),
    ];
    const fake = createFakeProcessFactory({ stdout: lines });
    const transport = createCliTransport(createCodexAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('列目录'));

    expect(events.map((event) => event.type)).toEqual([
      'session',
      'tool_use',
      'tool_result',
      'message',
      'done',
    ]);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'legacy-1' });
    expect(events[3]).toEqual({ type: 'message', text: '完成' });
  });

  test('opencode：文本 part 与工具事件都认', async () => {
    const lines = [
      JSON.stringify({ type: 'text', timestamp: 1, sessionID: 'ses-1', text: '你好' }),
      JSON.stringify({
        type: 'tool',
        sessionID: 'ses-1',
        part: { id: 'p1', type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'ok' } },
      }),
    ];
    const fake = createFakeProcessFactory({ stdout: lines });
    const transport = createCliTransport(
      createOpencodeAdapter({ probeServe: async () => ({ ok: false, url: null }) }),
      { factory: fake.factory }
    );

    const events = await collect(transport.spawn('你好'));

    expect(events.map((event) => event.type)).toEqual([
      'session',
      'message',
      'tool_use',
      'tool_result',
      'done',
    ]);
    expect(events[1]).toEqual({ type: 'message', text: '你好' });
  });

  test('opencode：CLI 自报的错误转成 error 事件（不再补 done）', async () => {
    const lines = [
      JSON.stringify({
        type: 'error',
        timestamp: 1,
        sessionID: 'ses-1',
        error: { name: 'APIError', data: { message: 'Model is unavailable.' } },
      }),
    ];
    const fake = createFakeProcessFactory({ stdout: lines });
    const transport = createCliTransport(
      createOpencodeAdapter({ probeServe: async () => ({ ok: false, url: null }) }),
      { factory: fake.factory }
    );

    const events = await collect(transport.spawn('你好'));

    expect(events.map((event) => event.type)).toEqual(['session', 'error']);
    expect(events[1]).toMatchObject({ code: 'cli_error', message: 'Model is unavailable.' });
  });

  test('kimi：纯文本输出整段作为一条 message（不逐行拆）', async () => {
    const fake = createFakeProcessFactory({ stdout: ['pong', '第二行', '第三行'] });
    const transport = createCliTransport(createKimiAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('回复 pong'));

    expect(events.map((event) => event.type)).toEqual(['message', 'done']);
    expect(events[0]).toEqual({ type: 'message', text: 'pong\n第二行\n第三行' });
  });

  test('openclaw：pretty-print 的 JSON 整段解（不是 JSONL）', async () => {
    const doc = JSON.stringify(
      { payloads: [{ text: 'pong' }], meta: { sessionId: 'oc-1', durationMs: 12 } },
      null,
      2
    );
    const fake = createFakeProcessFactory({ stdout: doc.split('\n') });
    const transport = createCliTransport(createOpenclawAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('回复 pong'));

    expect(events.map((event) => event.type)).toEqual(['session', 'message', 'done']);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'oc-1' });
    expect(events[1]).toEqual({ type: 'message', text: 'pong' });
  });

  test('kimi：stderr 收尾提示行的会话 id → session 事件先于 done，done 带上 id（task_055）', async () => {
    // 真机形状：stdout 是整段回答文本，stderr 尾行带 resume 提示（成功/失败轮都打）。
    const fake = createFakeProcessFactory({
      stdout: ['pong'],
      stderr: ['To resume this session: kimi -r 1303b488-0da8-4870-817e-40ed13a45143'],
    });
    const transport = createCliTransport(createKimiAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('回复 pong'));

    expect(events).toEqual([
      { type: 'message', text: 'pong' },
      { type: 'session', sessionId: '1303b488-0da8-4870-817e-40ed13a45143' },
      { type: 'done', exitCode: 0, text: 'pong', sessionId: '1303b488-0da8-4870-817e-40ed13a45143' },
    ]);
  });

  test('kimi：非 0 退出但 stderr 带会话 id —— session 事件照常上送（失败轮的会话也建立了）', async () => {
    const fake = createFakeProcessFactory({
      stdout: ['Authorization failed.'],
      stderr: ['', 'To resume this session: kimi -r 79ffbdd1-4e9d-402e-94fb-93c783d6541a'],
      exitCode: 1,
    });
    const transport = createCliTransport(createKimiAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('回复 pong'));

    // message（错误文本整段）→ session（stderr 收割，先于 error）→ error（非 0 退出收尾）。
    expect(events.map((event) => event.type)).toEqual(['message', 'session', 'error']);
    expect(events[1]).toEqual({ type: 'session', sessionId: '79ffbdd1-4e9d-402e-94fb-93c783d6541a' });
    expect(events[2]).toMatchObject({ type: 'error', code: 'nonzero_exit' });
  });

  test('非 0 退出：stderr 尾巴进 error 事件（不留空白错误信息）', async () => {
    const fake = createFakeProcessFactory({ stderr: ['boom: 模型不可用'], exitCode: 1 });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('你好'));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', code: 'nonzero_exit' });
    expect((events[0] as { message: string }).message).toContain('boom');
  });
});

// ============================================================================
// 3. 取消与超时
// ============================================================================

describe('runtime：AbortSignal → 终止进程树', () => {
  test('取消：killTree 被调用，且流以 error{aborted} 收尾', async () => {
    const controller = new AbortController();
    // autoClose: false —— 进程一直不结束，只有取消能收掉它。
    const fake = createFakeProcessFactory({ autoClose: false });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    const collected: TransportEvent[] = [];
    const pumping = (async (): Promise<void> => {
      for await (const event of transport.spawn('你好', { signal: controller.signal })) {
        collected.push(event);
      }
    })();

    // 等传输真的拉起了进程再取消（否则取消发生在 spawn 之前，测不到 kill 路径）。
    await waitFor(() => fake.calls.length === 1);
    controller.abort();
    await pumping;

    expect(fake.kills).toEqual(['SIGTERM']);
    expect(collected.map((event) => event.type)).toEqual(['error']);
    expect(collected[0]).toMatchObject({ type: 'error', code: 'aborted' });
  });

  test('取消信号在 spawn 前就已 aborted：立刻终止，不产生任何输出事件', async () => {
    const controller = new AbortController();
    controller.abort();
    const fake = createFakeProcessFactory({ autoClose: false });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('你好', { signal: controller.signal }));

    expect(fake.kills).toEqual(['SIGTERM']);
    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]).toMatchObject({ code: 'aborted' });
  });

  test('超时：走同一条终止路径，只是错误码是 timeout', async () => {
    const fake = createFakeProcessFactory({ autoClose: false });
    const transport = createCliTransport(createClaudeAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('你好', { timeoutMs: 20 }));

    expect(fake.kills).toEqual(['SIGTERM']);
    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]).toMatchObject({ code: 'timeout' });
  });
});

// ============================================================================
// 4. 真机杀树（真实 child_process）
// ============================================================================

describe('真机：杀进程树（孙进程必须一起死）', () => {
  const isPosix = process.platform !== 'win32';

  (isPosix ? test : test.skip)(
    '取消后孙进程被一并终止（只杀直接子进程会留下孤儿）',
    async () => {
      const pidFile = path.join(os.tmpdir(), `stratix-killtree-${process.pid}.pid`);
      const factory = createNodeProcessFactory();
      const controller = new AbortController();

      // shell 自己拉一个 sleep 孙进程，然后把孙进程 pid 写文件。
      const handle = factory(
        '/bin/sh',
        ['-c', `sleep 30 & echo $! > ${pidFile}; wait`],
        {}
      );

      const grandchildPid = await waitForPidFile(pidFile);
      expect(grandchildPid).toBeGreaterThan(0);
      expect(isAlive(grandchildPid)).toBe(true);

      handle.killTree('SIGTERM');

      // 等信号送达（进程回收有延迟，轮询一小会儿）。
      await waitFor(() => !isAlive(grandchildPid), 3000);

      expect(isAlive(grandchildPid)).toBe(false);
      expect(controller.signal.aborted).toBe(false); // 取消信号与杀树是两回事
      fs.rmSync(pidFile, { force: true });
    },
    15000
  );
});

// ============================================================================
// 小工具
// ============================================================================

/** 轮询直到条件成立（超时抛错）。 */
async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('等待条件超时');
}

/** 读 pid 文件里的孙进程 pid。 */
async function waitForPidFile(file: string): Promise<number> {
  let pid = 0;
  await waitFor(() => {
    if (!fs.existsSync(file)) return false;
    const text = fs.readFileSync(file, 'utf-8').trim();
    pid = Number(text);
    return Number.isFinite(pid) && pid > 0;
  });
  return pid;
}

/** 进程还活着吗（signal 0 只做存在性检查，不真的发信号）。 */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
