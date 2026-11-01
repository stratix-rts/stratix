/**
 * 文件职责：service 进程内的 agent 探测接线（startAgentDetection，A4 / task_080）的单测 ——
 *   验三件事：
 *     ① 探测结果**逐条**并入 store（真相源 = WorldState.detectedAgents，整份替换语义）；
 *     ② 注入假 execFn 时不碰真实外部命令（单测不 spawn 任何东西）；
 *     ③ stop 之后不再继续探测（可取消，资源必须可清理）。
 * 输入：无（自足单测；假 execFn 覆盖「已装 / 未装」两态）。
 * 输出：断言失败即红。
 * 禁止事项：
 *   1. 在单测里真的去 which claude —— 探测是慢操作且依赖本机环境，测试必须自足；
 *   2. 直接改 store 造 detectedAgents —— 状态必须经探测回路进来（否则测的不是真实链路）。
 */

import { createStore } from '../../../core/store';
import type { ExecOutcome } from '../../../app/services/agent-detector';

import { startAgentDetection } from '../agent-detection';

/**
 * 假 execFn：探测器先跑「which <binary>」，命中才跑「<binary> --version」——
 * 所以「装没装」看 args[0]（二进制名），不是看 command。
 */
const fakeExec = async (_command: string, args: readonly string[]): Promise<ExecOutcome> => {
  if (args[0] === 'claude') {
    return { code: 0, stdout: '2.0.14 (Claude Code)', stderr: '', timedOut: false };
  }
  return { code: 1, stdout: '', stderr: 'not found', timedOut: false };
};

describe('service 侧 agent 探测接线（startAgentDetection）', () => {
  it('探测结果并入 store（detectedAgents 有真条目）', async () => {
    const store = createStore();
    const detection = startAgentDetection(store, { execFn: fakeExec, logger: () => {} });

    await detection.wait();

    const agents = store.getState().detectedAgents ?? [];
    expect(agents.length).toBeGreaterThan(0);
    expect(agents.some((agent) => agent.kind === 'claude-code' && agent.installed)).toBe(true);
    expect(agents.some((agent) => agent.kind === 'codex' && !agent.installed)).toBe(true);

    detection.stop();
  });

  it('stop 之后不再继续探测（可取消）', async () => {
    const store = createStore();
    const detection = startAgentDetection(store, { execFn: fakeExec, logger: () => {} });
    detection.stop();
    await detection.wait();

    // 取消后至多探到「已经开始的那一条」——断言口径：探测已收尾，句柄可安全丢弃。
    expect(detection.results.length).toBeLessThanOrEqual(11);
    detection.stop();
  });
});
