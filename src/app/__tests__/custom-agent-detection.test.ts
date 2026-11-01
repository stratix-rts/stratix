/**
 * 文件职责：**自定义 agent 注册的探测**测试（task_056 规格⑥）—— detectCustomAgent /
 *   detectCustomAgents 的三态语义（exit 0 = 在装）、kind / label 拼装、脏命令 fail closed、
 *   整轮节奏（逐条回调 + 取消）。注入假 execFn，不真调外部二进制（与 agent-detector.test.ts
 *   同一手法 —— 探测语义是纯决策，真机往返不在这层验）。
 */

import {
  detectCustomAgent,
  detectCustomAgents,
  type CustomDetectionTarget,
} from '../services/agent-detector';
import type { ExecFn, ExecOutcome } from '../services/agent-detector';
import type { DetectedAgent } from '../../core/types';

interface ExecCall {
  readonly command: string;
  readonly args: readonly string[];
}

/** 假 execFn：按调用逐条决策（与 agent-detector.test.ts 同源手法）。 */
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

function target(overrides: Partial<CustomDetectionTarget> = {}): CustomDetectionTarget {
  return { id: 'myagent', name: 'MyAgent', probeCmd: 'myagent --version', ...overrides };
}

describe('task_056 detectCustomAgent：probeCmd 三态', () => {
  it('exit 0 = 在装：kind = custom:<id>，tier T1，label = 注册名，version / path 恒 null', async () => {
    const { execFn, calls } = makeFakeExec(() => ({ code: 0, stdout: 'myagent 1.2.3\n', stderr: '' }));
    const result = await detectCustomAgent(target(), { execFn });
    expect(result).toEqual<DetectedAgent>({
      kind: 'custom:myagent',
      tier: 'T1',
      installed: true,
      status: 'installed',
      version: null, // probeCmd 不承诺版本语义（内置是 which+version 两步，自定义只有一条命令）
      path: null,
      label: 'MyAgent',
    });
    expect(calls).toEqual([{ command: 'myagent', args: ['--version'] }]); // argv 直切，不经 shell
  });

  it('exit 127 = 确定没装（not-installed）', async () => {
    const { execFn } = makeFakeExec(() => ({ code: 127, stdout: '', stderr: 'command not found' }));
    const result = await detectCustomAgent(target(), { execFn });
    expect(result.installed).toBe(false);
    expect(result.status).toBe('not-installed');
  });

  it('其它非 0 = 探测失败（failed：命令在但没跑成，不算确定没装）', async () => {
    const { execFn } = makeFakeExec(() => ({ code: 2, stdout: '', stderr: 'bad flag' }));
    const result = await detectCustomAgent(target(), { execFn });
    expect(result.installed).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('超时（never-settle 由兜底计时判）：status = timeout', async () => {
    const { execFn } = makeFakeExec(() => 'hang');
    const result = await detectCustomAgent(target(), { execFn, timeoutMs: 20 });
    expect(result.installed).toBe(false);
    expect(result.status).toBe('timeout');
  });

  it('execFn 抛异常（failed，探测面不被坏执行器炸穿）', async () => {
    const execFn: ExecFn = () => Promise.reject(new Error('boom'));
    const result = await detectCustomAgent(target(), { execFn });
    expect(result.installed).toBe(false);
    expect(result.status).toBe('failed');
  });

  it('脏命令（白名单外，库被手改）fail closed：不执行、直接 failed', async () => {
    const { execFn, calls } = makeFakeExec(() => ({ code: 0, stdout: '', stderr: '' }));
    const result = await detectCustomAgent(target({ probeCmd: 'myagent; rm -rf /' }), { execFn });
    expect(result.status).toBe('failed');
    expect(result.installed).toBe(false);
    expect(calls).toHaveLength(0); // 根本没跑 —— 与 adapter 渲染同一 fail-closed 口径
  });

  it('probeCmd 带参数与路径形态：argv 忠实切分', async () => {
    const { execFn, calls } = makeFakeExec(() => ({ code: 0, stdout: '', stderr: '' }));
    await detectCustomAgent(target({ probeCmd: './bin/mytool check --mode=fast' }), { execFn });
    expect(calls).toEqual([{ command: './bin/mytool', args: ['check', '--mode=fast'] }]);
  });
});

describe('task_056 detectCustomAgents：整轮节奏', () => {
  it('逐条探测、逐条回调，顺序稳定；结果数组完整', async () => {
    const { execFn } = makeFakeExec((call) => {
      // 第二个注册故意失败，验证失败行也完整产出结论（不中断整轮）。
      return call.command === 'btool' ? { code: 127, stdout: '', stderr: '' } : { code: 0, stdout: '', stderr: '' };
    });
    const onResults: DetectedAgent[] = [];
    const results = await detectCustomAgents({
      execFn,
      targets: [target(), target({ id: 'btool', name: 'BTool', probeCmd: 'btool --version' })],
      onResult: (result) => onResults.push(result),
    });
    expect(results.map((row) => row.kind)).toEqual(['custom:myagent', 'custom:btool']);
    expect(onResults).toEqual(results); // 回调与返回同序同物
    expect(results[1]?.status).toBe('not-installed');
  });

  it('AbortSignal：取消后不再开始下一项（已跑完的保留）', async () => {
    const controller = new AbortController();
    let executed = 0;
    const { execFn } = makeFakeExec(() => {
      executed += 1;
      return { code: 0, stdout: '', stderr: '' };
    });
    const results = await detectCustomAgents({
      execFn,
      targets: [target(), target({ id: 'btool', name: 'B', probeCmd: 'btool -v' }), target({ id: 'ctool', name: 'C', probeCmd: 'ctool -v' })],
      signal: controller.signal,
      onResult: (result) => {
        if (result.kind === 'custom:myagent') controller.abort(); // 探完第一条就取消
      },
    });
    expect(results.map((row) => row.kind)).toEqual(['custom:myagent']); // 取消点的边界：取消后不再开始下一项
    expect(executed).toBe(1);
  });

  it('空目标列表 = 零开销直过（启动时没注册任何自定义 agent 的常态路径）', async () => {
    const { execFn, calls } = makeFakeExec(() => ({ code: 0, stdout: '', stderr: '' }));
    const results = await detectCustomAgents({ execFn, targets: [] });
    expect(results).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
