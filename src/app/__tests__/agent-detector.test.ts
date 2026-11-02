/**
 * 单测：本地 CLI agent 检测器（app/services/agent-detector.ts，@since v3.8 / task_022）。
 *
 * 覆盖四块：
 *   1. 名单自检 —— 代码里的 T1-T3 名单与契约词表一致（项数 / 分层 / 二进制名唯一）；
 *   2. 单项探测三态 —— 已装 / 未装 / 超时（注入假 execFn，**不真调外部二进制**）；
 *   3. 整轮探测 —— 逐条回调、不等全部结束（不阻塞启动）；
 *   4. 状态落地 —— 结果并入 WorldState.detectedAgents，并**经 core 既有 emit 通道**广播。
 *
 * 另有一组「接线守门」：Electron 主进程 / preload / 正式入口三处靠读源码文本断言，
 * 因为它们分别跑在 electron 与浏览器里，jest(node env) 无法执行到（沿用 main-layout.test.ts 的做法）。
 */

import * as fs from 'fs';
import * as path from 'path';

import { onState, resetBus } from '../../core/bus';
import { createCoreRuntime } from '../../core/runtime';
import { createStore } from '../../core/store';
import { DETECTABLE_AGENT_KINDS, type DetectedAgent, type WorldState } from '../../core/types';
import {
  AGENT_DETECTION_TARGETS,
  detectAgent,
  detectAllAgents,
  mergeDetectedAgents,
  verifyAgentRoster,
  type AgentDetectionTarget,
  type ExecFn,
  type ExecOutcome,
} from '../services/agent-detector';

const APP_DIR = path.join(__dirname, '..');
const MAIN_ENTRY = path.join(APP_DIR, 'main', 'main-entry.ts');
const ELECTRON_MAIN = path.join(APP_DIR, '..', 'electron', 'main.ts');
const ELECTRON_PRELOAD = path.join(APP_DIR, '..', 'electron', 'preload.ts');

// ============================================================================
// 夹具
// ============================================================================

interface ExecCall {
  readonly command: string;
  readonly args: readonly string[];
}

/**
 * 假 execFn：按调用逐条决策。
 * why 要能「永不返回」：超时这一态没法用"慢一点"来稳定复现（CI 上慢多少是不确定的），
 * 只能让执行器压根不resolve，由检测器自己的兜底计时判超时。
 */
function makeFakeExec(
  handler: (call: ExecCall) => ExecOutcome | 'hang'
): { readonly execFn: ExecFn; readonly calls: ExecCall[] } {
  const calls: ExecCall[] = [];
  const execFn: ExecFn = (command, args) => {
    const call: ExecCall = { command, args: [...args] };
    calls.push(call);
    const outcome = handler(call);
    if (outcome === 'hang') return new Promise<ExecOutcome>(() => { /* 永不 settle */ });
    return Promise.resolve(outcome);
  };
  return { execFn, calls };
}

/** 名单里取一项（取不到就说明名单坏了，测试直接失败得有声）。 */
function targetOf(kind: string): AgentDetectionTarget {
  const found = AGENT_DETECTION_TARGETS.find((target) => target.kind === kind);
  if (!found) throw new Error(`名单里没有 ${kind}`);
  return found;
}

const CLAUDE = targetOf('claude-code');

/** 造一个只用于本文件的合成目标（不污染真实名单）。 */
function syntheticTarget(kind: string, binary: string): AgentDetectionTarget {
  return { kind: kind as AgentDetectionTarget['kind'], tier: 'T3', binary, versionArgs: ['--version'] };
}

// ============================================================================
// 1. 名单
// ============================================================================

describe('检测名单（与 docs/AGENT-MATRIX.md 对齐）', () => {
  test('名单自检通过：kind 齐全、无重复、与契约词表一致', () => {
    const { ok, problems } = verifyAgentRoster();
    expect(problems).toEqual([]);
    expect(ok).toBe(true);
  });

  test('T1-T3 全量 12 项，分层分布 6 / 4 / 2', () => {
    expect(AGENT_DETECTION_TARGETS).toHaveLength(12);
    const byTier = (tier: string): number =>
      AGENT_DETECTION_TARGETS.filter((target) => target.tier === tier).length;
    expect(byTier('T1')).toBe(6);
    expect(byTier('T2')).toBe(4);
    expect(byTier('T3')).toBe(2);
  });

  test('名单覆盖契约词表 DETECTABLE_AGENT_KINDS 的每一个种类', () => {
    const kinds = AGENT_DETECTION_TARGETS.map((target) => target.kind);
    expect([...kinds].sort()).toEqual([...DETECTABLE_AGENT_KINDS].sort());
  });

  test('二进制名唯一（两个 agent 抢同一个 binary = 探测会互相顶掉）', () => {
    const binaries = AGENT_DETECTION_TARGETS.map((target) => target.binary);
    expect(new Set(binaries).size).toBe(binaries.length);
  });
});

// ============================================================================
// 2. 单项探测三态
// ============================================================================

describe('detectAgent：已装 / 未装 / 超时 三态', () => {
  test('已装：which 找到路径 + 版本命令给出版本', async () => {
    const { execFn, calls } = makeFakeExec((call) => {
      if (call.command === 'which') return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      if (call.command === '/usr/local/bin/claude') {
        return { code: 0, stdout: '2.0.14 (Claude Code)\n', stderr: '' };
      }
      return { code: 127, stdout: '', stderr: '' };
    });

    const result = await detectAgent(CLAUDE, { execFn, whichCommand: 'which' });

    expect(result).toEqual({
      kind: 'claude-code',
      tier: 'T1',
      installed: true,
      status: 'installed',
      version: '2.0.14',
      path: '/usr/local/bin/claude',
    });
    // 两条命令：which + 版本（版本用解析出的绝对路径，避免 PATH 歧义）
    expect(calls.map((call) => call.command)).toEqual(['which', '/usr/local/bin/claude']);
    expect(calls[0].args).toEqual(['claude']);
    expect(calls[1].args).toEqual(['--version']);
  });

  test('已装但版本命令失败：仍算装（path 已确认），version 为 null', async () => {
    const { execFn } = makeFakeExec((call) => {
      if (call.command === 'which') return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      return { code: 1, stdout: '', stderr: 'boom' };
    });

    const result = await detectAgent(CLAUDE, { execFn, whichCommand: 'which' });

    expect(result.installed).toBe(true);
    expect(result.status).toBe('installed');
    expect(result.version).toBeNull();
    expect(result.path).toBe('/usr/local/bin/claude');
  });

  test('未装：which 非 0 退出 → not-installed，且不再跑版本命令', async () => {
    const { execFn, calls } = makeFakeExec(() => ({ code: 1, stdout: '', stderr: '' }));

    const result = await detectAgent(CLAUDE, { execFn, whichCommand: 'which' });

    expect(result.installed).toBe(false);
    expect(result.status).toBe('not-installed');
    expect(result.version).toBeNull();
    expect(result.path).toBeNull();
    expect(calls).toHaveLength(1);
  });

  test('超时（which 阶段挂住）：判 timeout，且不误判成"未装"', async () => {
    const { execFn } = makeFakeExec(() => 'hang');

    const result = await detectAgent(CLAUDE, { execFn, whichCommand: 'which', timeoutMs: 20 });

    expect(result.status).toBe('timeout');
    expect(result.installed).toBe(false);
    expect(result.path).toBeNull();
  });

  test('超时（版本阶段挂住）：which 已成功 → 仍算装，版本未知', async () => {
    const { execFn } = makeFakeExec((call) => {
      if (call.command === 'which') return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
      return 'hang';
    });

    const result = await detectAgent(CLAUDE, { execFn, whichCommand: 'which', timeoutMs: 20 });

    expect(result.status).toBe('timeout');
    expect(result.installed).toBe(true);
    expect(result.path).toBe('/usr/local/bin/claude');
    expect(result.version).toBeNull();
  });

  test('执行器自己报告超时（timedOut 标记）也判 timeout，不当成"未装"', async () => {
    const { execFn } = makeFakeExec(() => ({ code: 143, stdout: '', stderr: '', timedOut: true }));

    const result = await detectAgent(CLAUDE, { execFn, whichCommand: 'which' });

    expect(result.status).toBe('timeout');
    expect(result.installed).toBe(false);
  });
});

// ============================================================================
// 3. 整轮探测
// ============================================================================

describe('detectAllAgents：逐条探测、逐条回调', () => {
  test('每探测完一项立刻回调，顺序与名单一致', async () => {
    const seen: DetectedAgent[] = [];
    const { execFn } = makeFakeExec(() => ({ code: 1, stdout: '', stderr: '' }));
    const targets = [
      syntheticTarget('claude-code', 'claude'),
      syntheticTarget('codex', 'codex'),
      syntheticTarget('opencode', 'opencode'),
    ];

    const results = await detectAllAgents({
      execFn,
      targets,
      onResult: (result) => seen.push(result),
      logger: () => { /* 单测里不打日志 */ },
    });

    expect(seen.map((result) => result.kind)).toEqual(['claude-code', 'codex', 'opencode']);
    expect(results).toHaveLength(3);
  });

  test('不等全部结束就出第一条（不阻塞启动）', async () => {
    const seen: string[] = [];
    let release: () => void = () => { /* 占位 */ };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let callCount = 0;
    const execFn: ExecFn = async () => {
      callCount += 1;
      if (callCount === 2) await gate; // 第二项卡住
      return { code: 1, stdout: '', stderr: '' };
    };
    const targets = [
      syntheticTarget('claude-code', 'claude'),
      syntheticTarget('codex', 'codex'),
      syntheticTarget('opencode', 'opencode'),
    ];

    let settled = false;
    const pending = detectAllAgents({
      execFn,
      targets,
      onResult: (result) => seen.push(result.kind),
      logger: () => { /* 单测里不打日志 */ },
    }).then((results) => {
      settled = true;
      return results;
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(seen).toEqual(['claude-code']); // 第一条已出
    expect(settled).toBe(false); // 整体还没结束

    release();
    const results = await pending;
    expect(seen).toEqual(['claude-code', 'codex', 'opencode']);
    expect(results).toHaveLength(3);
  });

  test('取消信号：不再开始下一项（退出前必须能停）', async () => {
    const controller = new AbortController();
    const seen: string[] = [];
    const { execFn } = makeFakeExec(() => {
      controller.abort(); // 第一项探测途中取消
      return { code: 1, stdout: '', stderr: '' };
    });

    const results = await detectAllAgents({
      execFn,
      targets: [
        syntheticTarget('claude-code', 'claude'),
        syntheticTarget('codex', 'codex'),
      ],
      onResult: (result) => seen.push(result.kind),
      logger: () => { /* 单测里不打日志 */ },
      signal: controller.signal,
    });

    expect(seen).toEqual(['claude-code']);
    expect(results).toHaveLength(1);
  });
});

// ============================================================================
// 4. 状态落地与广播
// ============================================================================

describe('检测结果 → WorldState.detectedAgents', () => {
  test('并入状态并经 core 既有 emit 通道广播给两侧', async () => {
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();
    const received: WorldState[] = [];
    const off = onState((state) => received.push(state));

    try {
      const { execFn } = makeFakeExec((call) => {
        if (call.command === 'which') return { code: 0, stdout: '/usr/local/bin/claude\n', stderr: '' };
        return { code: 0, stdout: '2.0.14\n', stderr: '' };
      });
      const results = await detectAllAgents({
        execFn,
        targets: [CLAUDE],
        onResult: () => { /* 逐条回调由 store 写入侧消费 */ },
        logger: () => { /* 单测里不打日志 */ },
      });

      store.setDetectedAgents(results);

      expect(received.length).toBeGreaterThan(0);
      const last = received[received.length - 1];
      expect(last.detectedAgents).toHaveLength(1);
      expect(last.detectedAgents?.[0]).toMatchObject({
        kind: 'claude-code',
        tier: 'T1',
        installed: true,
        status: 'installed',
        version: '2.0.14',
      });
    } finally {
      off();
      stop();
      resetBus();
    }
  });

  test('同内容重复写入不重复广播（重复扫描不该把两侧白白重渲染一遍）', () => {
    const store = createStore();
    const runtime = createCoreRuntime({ store });
    const stop = runtime.start();
    const received: WorldState[] = [];
    const off = onState((state) => received.push(state));

    try {
      const snapshot: DetectedAgent[] = [
        {
          kind: 'claude-code',
          tier: 'T1',
          installed: true,
          status: 'installed',
          version: '2.0.14',
          path: '/usr/local/bin/claude',
        },
      ];
      store.setDetectedAgents(snapshot);
      const afterFirst = received.length;
      store.setDetectedAgents(snapshot);
      expect(received.length).toBe(afterFirst);
    } finally {
      off();
      stop();
      resetBus();
    }
  });

  test('mergeDetectedAgents：同 kind 覆盖，新 kind 追加（快照只有一份真相）', () => {
    const first: DetectedAgent = {
      kind: 'claude-code',
      tier: 'T1',
      installed: false,
      status: 'not-installed',
      version: null,
      path: null,
    };
    const updated: DetectedAgent = { ...first, installed: true, status: 'installed', version: '2.0.14' };
    const other: DetectedAgent = { ...first, kind: 'codex' };

    const merged = mergeDetectedAgents(mergeDetectedAgents([first], updated), other);

    expect(merged).toHaveLength(2);
    expect(merged[0].status).toBe('installed');
    expect(merged[0].version).toBe('2.0.14');
    expect(merged[1].kind).toBe('codex');
  });
});

// ============================================================================
// 5. 接线守门（electron / 渲染入口跑不到的部分，读源码断言）
// ============================================================================

describe('接线守门：主进程探测 → IPC → 渲染层并入状态', () => {
  test('Electron 主进程起检测、把快照推给渲染层、并提供快照 IPC', () => {
    const source = fs.readFileSync(ELECTRON_MAIN, 'utf-8');
    expect(source).toContain('startAgentDetection');
    expect(source).toContain("'agent:detected:update'");
    expect(source).toContain("'agent:detected:snapshot'");
    expect(source).toContain('mergeDetectedAgents');
  });

  test('preload 暴露 agentDetection（snapshot + onUpdate）', () => {
    const source = fs.readFileSync(ELECTRON_PRELOAD, 'utf-8');
    expect(source).toContain('agentDetection');
    expect(source).toContain("'agent:detected:update'");
    expect(source).toContain("'agent:detected:snapshot'");
  });

  test('正式入口订阅检测并写进 core 状态', () => {
    const source = fs.readFileSync(MAIN_ENTRY, 'utf-8');
    expect(source).toContain('agentDetection');
    expect(source).toContain('setDetectedAgents');
  });
});
