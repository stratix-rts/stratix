/**
 * 单测：**dsh（DeepSeek Harness）adapter**（@since v3.33 / task_088）。
 *
 * 覆盖四块：
 *   1. 拼参数 —— `npx -y @deepseek-ai/dsh --profile headless --json "<task>"`；
 *      **会话 id 原样透传**（`--session-id`，不解释不改写）；
 *   2. 解析 —— 喂实测拿到的 NDJSON 运行事件，断言公共事件序列
 *      （dsh 私有事件 → 公共词汇表 message / tool_use / tool_result / session / error）；
 *   3. 降级 —— 假进程工厂三条路径：正常跑完（done）/ 拉不起来（spawn_failed）/
 *      非 0 退出（nonzero_exit）—— **绝不假成功**；
 *   4. 注册可见性 —— dsh 在 core 词表 / adapter 注册表 / 检测名单 / 显示名里都在
 *      （"注册后 roster 可见 dsh 选项"的代码级验证）。
 *
 * 样例事件来自本机实测（见 .long-run-agent/tasks/task_088.md「契约实测记录」）：
 *   实测到 session / status / final 三类；text / thinking / tool_call / tool_result 四类
 *   形状取自 dsh-headless@0.2.1-rc.5 源码 projectJsonRun（同一份事件投影）。
 */

import { AGENT_KINDS, DETECTABLE_AGENT_KINDS } from '../../core/types';
import { AGENT_DETECTION_TARGETS } from '../services/agent-detector';
import {
  CLI_ADAPTER_FACTORIES,
  createAdapter,
  createDshAdapter,
  createCliTransport,
  parseDshLine,
  verifyAdapterRoster,
  type CliAdapter,
  type ProcessFactory,
  type TransportEvent,
} from '../services/cli-transport';
import { collect, createFakeProcessFactory } from './helpers/fake-process';
import { AGENT_KIND_LABELS } from '../../hud/screens/onboarding-catalog';

// ============================================================================
// 1. 拼参数
// ============================================================================

describe('dsh.buildArgs：headless one-shot 形态', () => {
  test('默认：npx -y <包> --profile headless --json + 任务文本', () => {
    expect(createDshAdapter().buildArgs('回复 pong')).toEqual([
      '-y',
      '@deepseek-ai/dsh',
      '--profile',
      'headless',
      '--json',
      '回复 pong',
    ]);
  });

  test('会话 id 原样透传给 --session-id（放在任务文本之前）', () => {
    const args = createDshAdapter().buildArgs('继续', { sessionId: 'session-abc-123' });
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe('session-abc-123');
    expect(args[args.length - 1]).toBe('继续'); // 任务文本仍是最后一个位置参数
  });

  test('包名 / profile 可覆盖（便于指向内网镜像或别的 profile）', () => {
    const args = createDshAdapter({ packageName: '@mirror/dsh', profile: 'headless-x' }).buildArgs('go');
    expect(args).toEqual(['-y', '@mirror/dsh', '--profile', 'headless-x', '--json', 'go']);
  });

  test('多词 prompt 保持单个 argv 元素（不被拆词）', () => {
    const args = createDshAdapter().buildArgs('run the tests');
    expect(args[args.length - 1]).toBe('run the tests');
    expect(args).toHaveLength(6);
  });
});

// ============================================================================
// 2. 解析（NDJSON 运行事件 → 公共事件词汇表）
// ============================================================================

describe('dsh.parseLine：运行事件 → 公共事件', () => {
  test('session：会话 id 原样透传', () => {
    expect(
      parseDshLine('{"type":"session","sessionId":"session-79c03d31-c08a-4bf4-a59e-661df73cbc91","cwd":"/x"}')
    ).toEqual([{ type: 'session', sessionId: 'session-79c03d31-c08a-4bf4-a59e-661df73cbc91' }]);
  });

  test('text：回答文本 → message', () => {
    expect(parseDshLine('{"type":"text","text":"我先看一下目录"}')).toEqual([
      { type: 'message', text: '我先看一下目录' },
    ]);
  });

  test('thinking：推理块不上送成 message（不是 agent 说的话）', () => {
    expect(parseDshLine('{"type":"thinking","text":"让我想想……"}')).toEqual([]);
  });

  test('tool_call：工具名 + 入参 → tool_use（callId 当工具调用 id）', () => {
    expect(
      parseDshLine('{"type":"tool_call","callId":"c1","tool":"read_file","input":{"path":"a.ts"}}')
    ).toEqual([{ type: 'tool_use', tool: 'read_file', input: { path: 'a.ts' }, id: 'c1' }]);
  });

  test('tool_result：工具回执 → tool_result（工具失败也只是回执，不升格成整轮失败）', () => {
    expect(
      parseDshLine('{"type":"tool_result","callId":"c1","status":"error","result":"ENOENT"}')
    ).toEqual([{ type: 'tool_result', id: 'c1', text: 'ENOENT' }]);
  });

  test('status/turn_end + reason.kind=error → error 事件（cli_error）', () => {
    const line = JSON.stringify({
      type: 'status',
      phase: 'turn_end',
      turn: 1,
      reason: {
        kind: 'error',
        error: { message: 'llm-deepseek: no API key for provider route "deepseek-official"', code: 'MISSING_CREDENTIAL' },
      },
    });
    expect(parseDshLine(line)).toEqual([
      { type: 'error', message: 'llm-deepseek: no API key for provider route "deepseek-official"', code: 'cli_error' },
    ]);
  });

  test('status：进度心跳（turn_start / step_start / step_end）不上送', () => {
    expect(parseDshLine('{"type":"status","phase":"turn_start","turn":1}')).toEqual([]);
    expect(parseDshLine('{"type":"status","phase":"step_start","turn":1,"step":1}')).toEqual([]);
    expect(parseDshLine('{"type":"status","phase":"step_end","turn":1,"step":1}')).toEqual([]);
  });

  test('status/turn_end + reason.kind=completed → 不上送（正常收尾由 runtime 的 done 事件带）', () => {
    expect(parseDshLine('{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}')).toEqual([]);
  });

  test('final：与 text 事件同一段回答，不重复上送（与 claude 的 result 同一口径）', () => {
    expect(parseDshLine('{"type":"final","text":"我先看一下目录"}')).toEqual([]);
  });

  test('顶层 error 事件 → error{cli_error}（实测：未知 --session-id 就是这条）', () => {
    expect(
      parseDshLine(
        '{"type":"error","message":"session \\"session-x\\" does not exist; omit --session-id to start a new Session"}'
      )
    ).toEqual([
      {
        type: 'error',
        message: 'session "session-x" does not exist; omit --session-id to start a new Session',
        code: 'cli_error',
      },
    ]);
  });

  test('非 JSON 行 / 不认识的事件类型 → 跳过（协议演进留口，不崩）', () => {
    expect(parseDshLine('dsh: booting profile...')).toEqual([]);
    expect(parseDshLine('{"type":"brand_new_event","foo":1}')).toEqual([]);
  });
});

// ============================================================================
// 3. 运行时（假进程工厂）：正常 / spawn_failed / 非 0 退出
// ============================================================================

describe('dsh runtime：假进程工厂三条路径', () => {
  const RUN_LINES = [
    '{"type":"session","sessionId":"session-1","cwd":"/x"}',
    '{"type":"status","phase":"turn_start","turn":1}',
    '{"type":"text","text":"我看一下目录"}',
    '{"type":"tool_call","callId":"c1","tool":"read_file","input":{"path":"a.ts"}}',
    '{"type":"tool_result","callId":"c1","status":"completed","result":"ok"}',
    '{"type":"text","text":"目录里有 3 个文件"}',
    '{"type":"final","text":"目录里有 3 个文件"}',
  ];

  test('正常跑完：事件序列 + done（退出码 0 / 最终文本 / 会话 id）', async () => {
    const fake = createFakeProcessFactory({ stdout: RUN_LINES });
    const transport = createCliTransport(createDshAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('列目录'));

    expect(events.map((event) => event.type)).toEqual([
      'session',
      'message',
      'tool_use',
      'tool_result',
      'message',
      'done',
    ]);
    expect(events[0]).toEqual({ type: 'session', sessionId: 'session-1' });
    expect(events[1]).toEqual({ type: 'message', text: '我看一下目录' });
    expect(events[2]).toMatchObject({ type: 'tool_use', tool: 'read_file', id: 'c1' });
    expect(events[3]).toMatchObject({ type: 'tool_result', id: 'c1', text: 'ok' });
    expect(events[5]).toEqual({
      type: 'done',
      exitCode: 0,
      text: '目录里有 3 个文件',
      sessionId: 'session-1',
    });
    // 拉起的命令：npx + 参数（断言 adapter 拼参真的落到 argv 上）
    expect(fake.calls[0].command).toBe('npx');
    expect(fake.calls[0].args).toEqual([
      '-y',
      '@deepseek-ai/dsh',
      '--profile',
      'headless',
      '--json',
      '列目录',
    ]);
  });

  test('拉不起来（npx 不存在）→ error{spawn_failed}，绝不假成功', async () => {
    const throwing: ProcessFactory = () => {
      throw new Error('spawn npx ENOENT');
    };
    const transport = createCliTransport(createDshAdapter(), { factory: throwing });

    const events = await collect(transport.spawn('列目录'));

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0]).toMatchObject({ code: 'spawn_failed' });
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  test('npx 拉不到包（非 0 退出）→ error{nonzero_exit}，绝不假成功', async () => {
    const fake = createFakeProcessFactory({
      stdout: [],
      stderr: ['npm error code E404'],
      exitCode: 1,
    });
    const transport = createCliTransport(createDshAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('列目录'));

    expect(events.map((event) => event.type)).toEqual(['error']);
    expect(events[0]).toMatchObject({ code: 'nonzero_exit' });
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  test('未知 session id（实测：dsh 写顶层 error 事件后 exit 1）→ 两条真错误，不补 done', async () => {
    const lines = [
      '{"type":"error","message":"session \\"session-x\\" does not exist; omit --session-id to start a new Session"}',
    ];
    const fake = createFakeProcessFactory({
      stdout: lines,
      stderr: ['dsh: session "session-x" does not exist; omit --session-id to start a new Session'],
      exitCode: 1,
    });
    const transport = createCliTransport(createDshAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('继续', { sessionId: 'session-x' }));

    expect(events.map((event) => event.type)).toEqual(['error', 'error']);
    expect(events[0]).toMatchObject({ code: 'cli_error' });
    expect(events[1]).toMatchObject({ code: 'nonzero_exit' });
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });

  test('CLI 自报失败（turn_end reason=error）→ error{cli_error} + 非 0 退出，不补 done', async () => {
    // 真机形状（实测）：turn_end 的 reason.error 带 message/code，随后 dsh exit 1。
    const lines = [
      '{"type":"session","sessionId":"session-1","cwd":"/x"}',
      '{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"boom","code":"X"}}}',
      '{"type":"final","text":""}',
    ];
    const fake = createFakeProcessFactory({
      stdout: lines,
      stderr: ['dsh: X: boom'],
      exitCode: 1,
    });
    const transport = createCliTransport(createDshAdapter(), { factory: fake.factory });

    const events = await collect(transport.spawn('列目录'));

    expect(events.map((event) => event.type)).toEqual(['session', 'error', 'error']);
    expect(events[1]).toMatchObject({ type: 'error', message: 'boom', code: 'cli_error' });
    expect(events[2]).toMatchObject({ type: 'error', code: 'nonzero_exit' });
    expect(events.some((event) => event.type === 'done')).toBe(false);
  });
});

// ============================================================================
// 4. 注册可见性（roster 里能看见 dsh）
// ============================================================================

describe('dsh 注册：词表 / adapter 注册表 / 检测名单 / 显示名', () => {
  test('core 词表里有 dsh（内置可绑定 + 可检测）', () => {
    expect(AGENT_KINDS).toContain('dsh');
    expect(DETECTABLE_AGENT_KINDS).toContain('dsh');
  });

  test('adapter 注册表里有 dsh，且注册表覆盖 core 词表全量', () => {
    expect(CLI_ADAPTER_FACTORIES.dsh).toBeDefined();
    const { ok, missing } = verifyAdapterRoster();
    expect(missing).toEqual([]);
    expect(ok).toBe(true);
  });

  test('createAdapter(\'dsh\') 造出的是 dsh adapter（kind / binary / 输出形态）', () => {
    const adapter: CliAdapter = createAdapter('dsh');
    expect(adapter.kind).toBe('dsh');
    expect(adapter.binary).toBe('npx');
    expect(adapter.outputMode).toBe('jsonl');
  });

  test('检测名单里有 dsh（T1，探运行器 npx）', () => {
    const target = AGENT_DETECTION_TARGETS.find((item) => item.kind === 'dsh');
    expect(target).toBeDefined();
    expect(target?.tier).toBe('T1');
    expect(target?.binary).toBe('npx');
  });

  test('显示名有 dsh（roster 上不是裸 kind）', () => {
    expect(AGENT_KIND_LABELS.dsh).toBe('DeepSeek Harness');
  });
});
