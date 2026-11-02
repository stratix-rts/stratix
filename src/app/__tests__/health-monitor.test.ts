/**
 * 单元测试：agent 健康监测服务（app/services/health-monitor.ts，task_054，@since v3.30）。
 *
 * 覆盖规格⑤的判定面（全部注入打桩，不碰真探测 / 真落库 —— 服务本身零 IO，天然可测）：
 *   1. 防抖判定：1 次失败不判离线 / 连续 2 次判 / 恢复 1 次即回 / 事件与落库各翻转一次；
 *   2. exit 异常记数：nonzero_exit / timeout 记 unhealthy、aborted（用户中断）不记；
 *   3. 周期回路：小间隔 + 打桩 probe → tick 自喂快照（串起 probe→防抖→事件全链）；
 *   4. 边界：非 T1 kind 不判、probe 抛错本轮跳过（计数不动）、无 probe 口 start 空转。
 */

import type { DetectedAgent, WorldEvent } from '../../core/types';
import {
  createHealthMonitor,
  DEFAULT_HEALTH_PROBE_INTERVAL_MS,
  HEALTH_MONITORED_KINDS,
  HEALTH_OFFLINE_FAILURE_THRESHOLD,
  isHealthMonitoredKind,
  isUnhealthyTransportExit,
  probeResultHealthy,
} from '../services/health-monitor';
import type { AgentHealthEventInsert } from '../services/persistence/agent-health-dao';
import type { TransportErrorCode } from '../services/cli-transport/transport';

// ============================================================================
// 夹具
// ============================================================================

function snapshot(kind: DetectedAgent['kind'], status: DetectedAgent['status'], tier: DetectedAgent['tier'] = 'T1'): DetectedAgent {
  return {
    kind,
    tier,
    installed: status === 'installed',
    status,
    version: '1.0.0',
    path: '/bin/cli',
  };
}

interface MonitorHarness {
  readonly events: WorldEvent[];
  readonly persisted: AgentHealthEventInsert[];
  readonly monitor: ReturnType<typeof createHealthMonitor>;
}

function makeMonitor(overrides: Partial<Parameters<typeof createHealthMonitor>[0]> = {}): MonitorHarness {
  const events: WorldEvent[] = [];
  const persisted: AgentHealthEventInsert[] = [];
  const monitor = createHealthMonitor({
    emit: (event) => events.push(event),
    persistEvent: (insert) => persisted.push(insert),
    ...overrides,
  });
  return { events, persisted, monitor };
}

// ============================================================================
// 常量面
// ============================================================================

describe('常量（规格：常量集中）', () => {
  test('探测周期缺省 60s；防抖阈值 2；监测面 = T1 那几家', () => {
    expect(DEFAULT_HEALTH_PROBE_INTERVAL_MS).toBe(60_000);
    expect(HEALTH_OFFLINE_FAILURE_THRESHOLD).toBe(2);
    expect(HEALTH_MONITORED_KINDS).toEqual([
      'claude-code',
      'codex',
      'opencode',
      'kimi',
      'openclaw',
      'dsh',
    ]);
  });
});

// ============================================================================
// 纯判定
// ============================================================================

describe('probeResultHealthy：探测结果健康判定', () => {
  test('只有 installed 算健康（not-installed / timeout / failed 都是失败）', () => {
    expect(probeResultHealthy(snapshot('claude-code', 'installed'))).toBe(true);
    expect(probeResultHealthy(snapshot('claude-code', 'not-installed'))).toBe(false);
    expect(probeResultHealthy(snapshot('claude-code', 'timeout'))).toBe(false);
    expect(probeResultHealthy(snapshot('claude-code', 'failed'))).toBe(false);
  });
});

describe('isUnhealthyTransportExit：exit 码异常判定', () => {
  test('非 0 且非用户 abort 才记；aborted 是正常生命周期', () => {
    expect(isUnhealthyTransportExit('aborted')).toBe(false);
    expect(isUnhealthyTransportExit('nonzero_exit')).toBe(true);
    expect(isUnhealthyTransportExit('timeout')).toBe(true);
    expect(isUnhealthyTransportExit('cli_error')).toBe(true);
    expect(isUnhealthyTransportExit('spawn_failed')).toBe(true);
  });
});

// ============================================================================
// 防抖判定（规格⑤：1 次失败不判 / 2 次判 / 恢复 1 次即回）
// ============================================================================

describe('ingestProbeRound：在线/离线防抖', () => {
  test('1 次失败不判离线（单次失败是噪音，不广播不落库）', () => {
    const h = makeMonitor();
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout')]);
    expect(h.monitor.isOnline('claude-code')).toBe(true);
    expect(h.events).toEqual([]);
    expect(h.persisted).toEqual([]);
  });

  test('连续 2 次失败判离线：agent.offline 事件 + offline 落库各一次', () => {
    const h = makeMonitor();
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout')]);
    h.monitor.ingestProbeRound([snapshot('claude-code', 'not-installed')]);
    expect(h.monitor.isOnline('claude-code')).toBe(false);
    expect(h.events).toEqual([{ type: 'agent.offline', kind: 'claude-code' }]);
    expect(h.persisted.map((p) => p.event)).toEqual(['offline']);
  });

  test('夹一次成功就清零：失败→成功→失败→失败 才判离线（防抖数连续而不是累计）', () => {
    const h = makeMonitor();
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout')]); // 失败 1
    h.monitor.ingestProbeRound([snapshot('claude-code', 'installed')]); // 清零
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout')]); // 失败 1（不是 3）
    expect(h.monitor.isOnline('claude-code')).toBe(true);
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout')]); // 失败 2 → 判
    expect(h.monitor.isOnline('claude-code')).toBe(false);
    expect(h.events.filter((e) => e.type === 'agent.offline')).toHaveLength(1);
  });

  test('离线后 1 次成功即恢复：agent.online 事件 + online 落库；此后成功不再重复发', () => {
    const h = makeMonitor();
    h.monitor.ingestProbeRound([snapshot('claude-code', 'failed')]);
    h.monitor.ingestProbeRound([snapshot('claude-code', 'failed')]);
    expect(h.monitor.isOnline('claude-code')).toBe(false);
    h.monitor.ingestProbeRound([snapshot('claude-code', 'installed')]);
    expect(h.monitor.isOnline('claude-code')).toBe(true);
    h.monitor.ingestProbeRound([snapshot('claude-code', 'installed')]);
    expect(h.events).toEqual([
      { type: 'agent.offline', kind: 'claude-code' },
      { type: 'agent.online', kind: 'claude-code' },
    ]);
    expect(h.persisted.map((p) => p.event)).toEqual(['offline', 'online']);
  });

  test('已离线时重复失败不重复广播（幂等）', () => {
    const h = makeMonitor();
    for (let i = 0; i < 5; i += 1) h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout')]);
    expect(h.events).toHaveLength(1);
  });

  test('多 kind 同轮各判各的（互不串味）；非 T1 kind 不判', () => {
    const h = makeMonitor();
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout'), snapshot('kimi', 'timeout'), snapshot('gemini', 'timeout')]);
    h.monitor.ingestProbeRound([snapshot('claude-code', 'timeout'), snapshot('kimi', 'installed'), snapshot('gemini', 'timeout')]);
    expect(h.monitor.isOnline('claude-code')).toBe(false);
    expect(h.monitor.isOnline('kimi')).toBe(true);
    // gemini（T2）没有执行链路：永远不判离线（下面 events 断言它没进判定面）。
    expect(h.events).toEqual([{ type: 'agent.offline', kind: 'claude-code' }]);
  });
});

// ============================================================================
// transport exit 异常（规格：非 0 且非 abort 记一次 unhealthy）
// ============================================================================

describe('recordTransportFailure：exit 异常审计', () => {
  test.each<TransportErrorCode>(['nonzero_exit', 'timeout', 'cli_error', 'spawn_failed'])(
    '%s → unhealthy 计数 +1 并落一条审计',
    (code) => {
      const h = makeMonitor();
      h.monitor.recordTransportFailure('claude-code', code);
      expect(h.monitor.unhealthyCount('claude-code')).toBe(1);
      expect(h.persisted).toEqual([
        { kind: 'claude-code', event: 'unhealthy', createdAt: expect.any(Number) },
      ]);
      // unhealthy 不改在线位（掉线只认探测，单一真相）。
      expect(h.monitor.isOnline('claude-code')).toBe(true);
      expect(h.events).toEqual([]);
    }
  );

  test('aborted（用户中断）不记；exit 异常可累计', () => {
    const h = makeMonitor();
    h.monitor.recordTransportFailure('claude-code', 'aborted');
    expect(h.monitor.unhealthyCount('claude-code')).toBe(0);
    h.monitor.recordTransportFailure('claude-code', 'nonzero_exit');
    h.monitor.recordTransportFailure('claude-code', 'timeout');
    expect(h.monitor.unhealthyCount('claude-code')).toBe(2);
    expect(h.persisted).toHaveLength(2);
  });

  test('persistEvent 回调抛错不炸监测（审计是旁路）', () => {
    const h = makeMonitor({
      persistEvent: () => {
        throw new Error('落库口炸了');
      },
      logger: () => {},
    });
    expect(() => h.monitor.recordTransportFailure('claude-code', 'nonzero_exit')).not.toThrow();
    expect(h.monitor.unhealthyCount('claude-code')).toBe(1);
  });
});

// ============================================================================
// 周期回路（小间隔 + 打桩 probe，串起 probe→ingest→事件全链）
// ============================================================================

describe('start：周期探测回路', () => {
  test('定时器按 intervalMs 喂轮次：两轮失败后判离线，恢复轮回在线；stop 停表', async () => {
    let round = 0;
    const h = makeMonitor({
      intervalMs: 5,
      probe: () => {
        round += 1;
        return Promise.resolve(round < 3 ? [snapshot('claude-code', 'timeout')] : [snapshot('claude-code', 'installed')]);
      },
    });
    const stop = h.monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 60));
    stop();

    // 链路全串：probe → ingest → 防抖 → 事件。两轮失败先判离线（收到 agent.offline），
    // 第三轮起恢复（收到 agent.online，恢复 1 次即回）。
    expect(h.events).toEqual([
      { type: 'agent.offline', kind: 'claude-code' },
      { type: 'agent.online', kind: 'claude-code' },
    ]);
    expect(h.monitor.isOnline('claude-code')).toBe(true);

    const after = h.events.length;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(h.events).toHaveLength(after); // 停表后不再有事件
  });

  test('probe 抛错：本轮跳过，计数不动（IPC 断了不是 agent 的锅）', async () => {
    const h = makeMonitor({
      intervalMs: 5,
      probe: () => Promise.reject(new Error('ipc gone')),
      logger: () => {},
    });
    const stop = h.monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    stop();
    expect(h.events).toEqual([]); // 未知 ≠ 失败：绝不因此判离线
  });

  test('probe resolve null（无数据轮）不计；无 probe 口 start 返回空停函数（非 Electron 退化）', async () => {
    const h = makeMonitor({ intervalMs: 5, probe: () => Promise.resolve(null) });
    const stop = h.monitor.start();
    await new Promise((resolve) => setTimeout(resolve, 20));
    stop();
    expect(h.events).toEqual([]);

    const idle = makeMonitor();
    const stopIdle = idle.monitor.start();
    expect(typeof stopIdle).toBe('function');
    stopIdle(); // 不抛即过
  });
});

// ============================================================================
// task_056：自定义注册同座监测（探测周期含 custom probe，规格④）
// ============================================================================

describe('task_056 自定义注册的健康监测', () => {
  test('isHealthMonitoredKind：内置 T1 ∪ custom:<id> 形态；T2/词表外仍不监测', () => {
    expect(isHealthMonitoredKind('claude-code')).toBe(true);
    expect(isHealthMonitoredKind('custom:myagent')).toBe(true);
    expect(isHealthMonitoredKind('custom:another-1')).toBe(true);
    expect(isHealthMonitoredKind('gemini')).toBe(false); // T2：没有执行链路
    expect(isHealthMonitoredKind('custom:not/a-slug')).toBe(false); // 形状不合法（斜杠）≠ 注册段
    expect(isHealthMonitoredKind('custom:')).toBe(false); // 空段不算
  });

  test('ingestProbeRound：自定义注册行参与离线防抖（阈值轮 timeout → agent.offline）', () => {
    const h = makeMonitor();
    for (let i = 0; i < HEALTH_OFFLINE_FAILURE_THRESHOLD; i += 1) {
      h.monitor.ingestProbeRound([snapshot('custom:myagent' as DetectedAgent['kind'], 'timeout')]);
    }
    expect(h.events).toEqual([
      expect.objectContaining({ type: 'agent.offline', kind: 'custom:myagent' }),
    ]);
    expect(h.persisted).toEqual([
      expect.objectContaining({ kind: 'custom:myagent', event: 'offline' }),
    ]);
  });

  test('注册探活恢复（installed）→ agent.online；失败计数同内置清零口径', () => {
    const h = makeMonitor();
    for (let i = 0; i < HEALTH_OFFLINE_FAILURE_THRESHOLD; i += 1) {
      h.monitor.ingestProbeRound([snapshot('custom:myagent' as DetectedAgent['kind'], 'timeout')]);
    }
    h.monitor.ingestProbeRound([snapshot('custom:myagent' as DetectedAgent['kind'], 'installed')]);
    expect(h.events).toEqual([
      expect.objectContaining({ type: 'agent.offline', kind: 'custom:myagent' }),
      expect.objectContaining({ type: 'agent.online', kind: 'custom:myagent' }),
    ]);
  });
});
