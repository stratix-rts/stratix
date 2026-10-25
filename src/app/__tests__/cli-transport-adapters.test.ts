/**
 * 单测：五家 CLI adapter（app/services/cli-transport/adapters/*，@since v3.8 / task_023）。
 *
 * 覆盖：
 *   1. 拼参数 —— 各家 headless 命令形态；**会话 id 原样透传**（不进 AgentProfile 前不改写）；
 *   2. 解析 —— 喂样例 JSONL / JSON / 纯文本，断言事件序列（各家私有格式 → 公共事件词汇表）；
 *   3. opencode 的 serve 探测 —— 探测到就 --attach，探测失败就降级（不带 --attach，且**不算错误**）。
 */

import {
  createClaudeAdapter,
  createCodexAdapter,
  createKimiAdapter,
  createOpenclawAdapter,
  createOpencodeAdapter,
  parseClaudeLine,
  parseCodexLine,
  parseKimiOutput,
  parseKimiStderrLine,
  parseOpenclawOutput,
  parseOpencodeLine,
} from '../services/cli-transport';

// ============================================================================
// 1. 拼参数
// ============================================================================

describe('adapter.buildArgs：headless 命令形态', () => {
  test('claude：-p + stream-json + 权限模式', () => {
    const args = createClaudeAdapter().buildArgs('回复 pong');
    expect(args).toEqual([
      '-p',
      '回复 pong',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'bypassPermissions',
    ]);
  });

  test('claude：会话 id 原样透传给 --resume', () => {
    const args = createClaudeAdapter().buildArgs('继续', { sessionId: 'sess-abc' });
    expect(args).toContain('--resume');
    expect(args[args.indexOf('--resume') + 1]).toBe('sess-abc');
  });

  test('codex：exec --json；带会话时走 exec resume <id>', () => {
    expect(createCodexAdapter().buildArgs('回复 pong')).toEqual(['exec', '--json', '回复 pong']);
    const resumed = createCodexAdapter().buildArgs('继续', { sessionId: 'th-1' });
    expect(resumed).toEqual(['exec', '--json', 'resume', 'th-1', '继续']);
  });

  test('opencode：run --format json；带会话时 --session', () => {
    const args = createOpencodeAdapter({ probeServe: async () => ({ ok: false, url: null }) }).buildArgs(
      '回复 pong'
    );
    expect(args).toEqual(['run', '--format', 'json', '回复 pong']);
    const resumed = createOpencodeAdapter({
      probeServe: async () => ({ ok: false, url: null }),
    }).buildArgs('继续', { sessionId: 'ses-1' });
    expect(resumed).toEqual(['run', '--format', 'json', '--session', 'ses-1', '继续']);
  });

  test('kimi：新会话只传 --prompt，忽略旧 yolo/workDir 配置', () => {
    const args = createKimiAdapter({ yolo: true, workDir: '/ignored' }).buildArgs('回复 pong');
    expect(args).toEqual(['--prompt', '回复 pong']);
  });

  test('kimi：恢复会话时 --session 原样透传', () => {
    const resumed = createKimiAdapter().buildArgs('继续', { sessionId: 'session_k-1' });
    expect(resumed).toEqual(['--session', 'session_k-1', '--prompt', '继续']);
  });

  test('openclaw：agent --message --json；带会话时 --session-id', () => {
    expect(createOpenclawAdapter().buildArgs('回复 pong')).toEqual([
      'agent',
      '--message',
      '回复 pong',
      '--json',
    ]);
    const resumed = createOpenclawAdapter().buildArgs('继续', { sessionId: 'oc-1' });
    expect(resumed).toEqual(['agent', '--session-id', 'oc-1', '--message', '继续', '--json']);
  });

  test('openclaw：没有会话 id 时用 --agent 选会话（CLI 要求三选一）', () => {
    const args = createOpenclawAdapter({ agentId: 'ops' }).buildArgs('回复 pong');
    expect(args).toContain('--agent');
    expect(args[args.indexOf('--agent') + 1]).toBe('ops');
  });

  test('openclaw：prepare 无 sessionId 且无 agentId → 生成 uuid 种子（首发即自选 id，task_055）', async () => {
    const adapter = createOpenclawAdapter();
    const prepared = await adapter.prepare?.({});
    expect(prepared?.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/ // uuid v4 形状
    );
    // 生成的 id 落进命令行（runtime 用 prepare 后的 options 调 buildArgs）：
    const args = adapter.buildArgs('你好', prepared ?? {});
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(prepared?.sessionId);
    // 每次生成都是新 id（不共享、不缓存）：
    const again = await adapter.prepare?.({});
    expect(again?.sessionId).not.toBe(prepared?.sessionId);
  });

  test('openclaw：prepare 尊重调用方 —— 有 sessionId 不覆盖；有 agentId 不种 uuid（显式路由）', async () => {
    const adapter = createOpenclawAdapter();
    const prepared = await adapter.prepare?.({ sessionId: 'oc-existing' });
    expect(prepared?.sessionId).toBe('oc-existing');

    const routed = createOpenclawAdapter({ agentId: 'ops' });
    const preparedRouted = await routed.prepare?.({});
    expect(preparedRouted?.sessionId ?? null).toBeNull(); // 不种 uuid
    const args = routed.buildArgs('你好', preparedRouted ?? {});
    expect(args).toContain('--agent');
    expect(args).not.toContain('--session-id');
  });

  test('resume 复核点回归（task_055）：三家旗标拼写与参数顺序不动', () => {
    // claude：--resume <id>（2026-10-25 真机两轮验证：同 session id 命中 + 暗号记忆保留）
    const claude = createClaudeAdapter().buildArgs('继续', { sessionId: 's-uuid' });
    expect(claude.slice(0, 2)).toEqual(['-p', '继续']);
    expect(claude[claude.indexOf('--resume') + 1]).toBe('s-uuid');
    // codex：exec --json resume <id> <prompt>（本机未装 codex，拼写与 --help 文档一致，不臆改）
    expect(createCodexAdapter().buildArgs('继续', { sessionId: 'th-1' })).toEqual([
      'exec', '--json', 'resume', 'th-1', '继续',
    ]);
    // opencode：run --format json --session <id> <prompt>（-s, --session 与 --help 一致）
    expect(
      createOpencodeAdapter({ probeServe: async () => ({ ok: false, url: null }) }).buildArgs('继续', {
        sessionId: 'ses-1',
      })
    ).toEqual(['run', '--format', 'json', '--session', 'ses-1', '继续']);
  });
});

// ============================================================================
// 2. 解析：样例输出 → 公共事件
// ============================================================================

describe('adapter.parse：各家格式 → 公共事件词汇表', () => {
  test('claude：assistant 的 text / tool_use 分别落成 message / tool_use', () => {
    const events = parseClaudeLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '好的' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file: 'a.ts' } },
          ],
        },
      })
    );
    expect(events.map((event) => event.type)).toEqual(['message', 'tool_use']);
    expect(events[0]).toEqual({ type: 'message', text: '好的' });
    expect(events[1]).toMatchObject({ tool: 'Read', id: 't1' });
  });

  test('claude：非 JSON 行（banner）跳过，不当错误', () => {
    expect(parseClaudeLine('Welcome to Claude Code!')).toEqual([]);
    expect(parseClaudeLine('')).toEqual([]);
  });

  test('claude：result 的 is_error 转成 error 事件', () => {
    const events = parseClaudeLine(
      JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '炸了' })
    );
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', code: 'cli_error', message: '炸了' });
  });

  test('codex：新旧两代格式都认（agent_message / 工具调用）', () => {
    const modern = parseCodexLine(
      JSON.stringify({ type: 'item.completed', item: { id: 'i1', type: 'agent_message', text: '完成' } })
    );
    expect(modern).toEqual([{ type: 'message', text: '完成' }]);

    const legacy = parseCodexLine(JSON.stringify({ id: '3', msg: { type: 'agent_message', message: '完成' } }));
    expect(legacy).toEqual([{ type: 'message', text: '完成' }]);
  });

  test('codex：thread.started 的 thread_id 原样透传成会话 id', () => {
    expect(parseCodexLine(JSON.stringify({ type: 'thread.started', thread_id: 'th-9' }))).toEqual([
      { type: 'session', sessionId: 'th-9' },
    ]);
  });

  test('opencode：SDK 事件总线形状（properties.part）也认', () => {
    const events = parseOpencodeLine(
      JSON.stringify({
        type: 'message.part.updated',
        properties: { part: { id: 'p1', type: 'text', text: '你好' } },
      })
    );
    expect(events).toEqual([{ type: 'message', text: '你好' }]);
  });

  test('opencode：工具事件落成 tool_use + tool_result', () => {
    const events = parseOpencodeLine(
      JSON.stringify({
        type: 'tool',
        part: {
          id: 'p1',
          type: 'tool',
          tool: 'bash',
          state: { status: 'completed', input: { command: 'ls' }, output: 'ok' },
        },
      })
    );
    expect(events.map((event) => event.type)).toEqual(['tool_use', 'tool_result']);
    expect(events[0]).toMatchObject({ tool: 'bash' });
    expect(events[1]).toMatchObject({ tool: 'bash', text: 'ok' });
  });

  test('kimi：纯文本解析不出东西时交回 runtime 的整段兜底', () => {
    expect(parseKimiOutput('pong')).toEqual([]);
    expect(parseKimiOutput(JSON.stringify({ text: 'pong' }))).toEqual([{ type: 'message', text: 'pong' }]);
  });

  test('kimi：JSON 容错 —— malformed / 半行 / 错误信封都不炸、不臆造事件（task_055）', () => {
    expect(parseKimiOutput('{"session_id":')).toEqual([]); // 半行 JSON：静默交给文本兜底
    expect(parseKimiOutput('{"result":"pong"}')).toEqual([{ type: 'message', text: 'pong' }]);
    // 错误文本（真机 401 实测形状是纯文本，不是 JSON）：整段交回文本兜底，不炸。
    expect(parseKimiOutput('Error code: 401 - {\'error\': ...}')).toEqual([]);
    expect(parseKimiOutput('')).toEqual([]);
  });

  test('kimi：stderr 兼容 session_ 前缀与裸 uuid；噪声/残行静默跳过', () => {
    expect(parseKimiStderrLine('To resume this session: kimi -r session_1303b488-0da8-4870-817e-40ed13a45143')).toEqual([
      { type: 'session', sessionId: 'session_1303b488-0da8-4870-817e-40ed13a45143' },
    ]);
    // 1.52 时代真机实测行（2026-10-25，kimi 1.48.0）：
    expect(parseKimiStderrLine('To resume this session: kimi -r 1303b488-0da8-4870-817e-40ed13a45143')).toEqual([
      { type: 'session', sessionId: '1303b488-0da8-4870-817e-40ed13a45143' },
    ]);
    // 空行（提示行自带 \n 前缀）与日志噪声：
    expect(parseKimiStderrLine('')).toEqual([]);
    expect(parseKimiStderrLine('WARNING: something verbose')).toEqual([]);
    // 残缺 id（非 uuid）：不产出事件，宁缺毋滥。
    expect(parseKimiStderrLine('To resume this session: kimi -r not-a-uuid')).toEqual([]);
  });

  test('openclaw：信封里的 payloads[].text 落成一条 message', () => {
    const events = parseOpenclawOutput(
      JSON.stringify({ payloads: [{ text: 'pong' }], meta: { sessionId: 'oc-2' } })
    );
    expect(events).toEqual([
      { type: 'session', sessionId: 'oc-2' },
      { type: 'message', text: 'pong' },
    ]);
  });

  test('openclaw：gateway 实测信封（result 包裹）也能解出文本与会话 id（task_055 实证修复）', () => {
    // 2026-10-25 真机形状（openclaw 2026.4.2，openclaw agent --session-id … --json）：
    const envelope = {
      runId: 'd35a43c0-7b1b-4f0f-ad48-d2c13accfd00',
      status: 'ok',
      summary: 'completed',
      result: {
        payloads: [{ text: '蓝鲸号', mediaUrl: null }],
        meta: {
          durationMs: 18924,
          agentMeta: { sessionId: 'stratix-task055-1792943657', provider: 'zai', model: 'glm-5.3' },
          aborted: false,
        },
      },
    };
    expect(parseOpenclawOutput(JSON.stringify(envelope))).toEqual([
      { type: 'session', sessionId: 'stratix-task055-1792943657' },
      { type: 'message', text: '蓝鲸号' },
    ]);
  });

  test('openclaw：result.meta.aborted 同样落成 error（两代信封）', () => {
    const events = parseOpenclawOutput(
      JSON.stringify({ status: 'ok', result: { payloads: [], meta: { aborted: true } } })
    );
    expect(events).toEqual([{ type: 'error', message: 'openclaw 运行被中止', code: 'cli_error' }]);
  });

  test('openclaw：meta.aborted 落成 error 事件', () => {
    const events = parseOpenclawOutput(JSON.stringify({ payloads: [], meta: { aborted: true } }));
    expect(events).toEqual([{ type: 'error', message: 'openclaw 运行被中止', code: 'cli_error' }]);
  });
});

// ============================================================================
// 3. opencode 的 serve 探测与降级
// ============================================================================

describe('opencode：serve 探测 → --attach / 降级', () => {
  test('探测到 serve：命令带 --attach（复用 server 的会话库）', async () => {
    const adapter = createOpencodeAdapter({
      probeServe: async () => ({ ok: true, url: 'http://127.0.0.1:4096' }),
    });
    const prepared = await adapter.prepare?.({});
    expect(prepared?.attachUrl).toBe('http://127.0.0.1:4096');
    expect(adapter.buildArgs('你好', prepared ?? {})).toContain('--attach');
  });

  test('探测失败：降级为不带 --attach 的 run（探测失败不是错误）', async () => {
    const adapter = createOpencodeAdapter({
      probeServe: async () => ({ ok: false, url: null }),
    });
    const prepared = await adapter.prepare?.({});
    expect(prepared?.attachUrl).toBeNull();
    expect(adapter.buildArgs('你好', prepared ?? {})).not.toContain('--attach');
  });

  test('调用方显式给了 attachUrl：不再探测（尊重调用方）', async () => {
    let probed = false;
    const adapter = createOpencodeAdapter({
      probeServe: async () => {
        probed = true;
        return { ok: false, url: null };
      },
    });
    const prepared = await adapter.prepare?.({ attachUrl: 'http://explicit:1234' });
    expect(probed).toBe(false);
    expect(prepared?.attachUrl).toBe('http://explicit:1234');
  });
});
