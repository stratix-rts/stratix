/**
 * 文件职责：**agent 健康监测服务**（task_054，@since v3.30）—— CLI 进程级健康的唯一判定方。
 *   两路数据源汇进同一个防抖状态机，产出 agent.online / agent.offline 事件（runtime 接地写
 *   units.online）+ agent_health_events 落库（崩溃审计 / 恢复统计）：
 *   ① 周期探测：复用 agent-detector 的 T1 异步探测（注入 probe 口 —— 生产 = Electron 主进程
 *      经 IPC 跑真探测，单测注入打桩快照），默认 60s 一轮（DEFAULT_HEALTH_PROBE_INTERVAL_MS）；
 *      连续 2 轮失败（HEALTH_OFFLINE_FAILURE_THRESHOLD）才判离线，一次成功即恢复 —— 防抖
 *      口径：单次失败是噪音（CLI 冷启动慢 / 机器卡），不广播、不灰显；
 *   ② transport 执行期 exit 异常：task-service / chat-service 在 transport error 事件上回调
 *      recordTransportFailure —— 非 0 退出且非用户主动中断（code !== 'aborted'）记一条
 *      unhealthy 落库（审计「它崩过几次」），**不**直接改在线位（掉线只认探测，单一真相）。
 * 输入：注入的 probe（() => Promise<DetectedAgent[] | null>，null/异常 = 本轮放弃）+ emit +
 *   persistEvent（fire-and-forget 落库回调）+ 可配周期（intervalMs）。
 * 输出：agent.online / agent.offline 事件（core/bus 的 world 通道，缺省 emitWorldEvent）；
 *   persistEvent 回调（形状 = agent-health-dao 的插入行）；观察口 isOnline / unhealthyCount。
 * 禁止事项：
 *   1. 直接 spawn 子进程 / import node-exec —— 探测执行归 Electron 主进程（渲染层无
 *      child_process），本服务只持有注入的 probe 口（与 agent-detector 的注入纪律同源）；
 *   2. 在这里写 store / 读 WorldState —— 判定输入只有探测快照与 transport 回调，事件落点
 *      归 runtime 接地（谁写状态只有一处）；
 *   3. 把 transport 异常直接判离线 —— exit 码异常只记 unhealthy 审计；在线位只认探测防抖
 *      （崩溃 ≠ 掉线：CLI 崩了进程可能还在被拉起，探测才是「现在能不能用」的真话）；
 *   4. 对非 T1 kind 做判定 —— 掉线语义只对可绑定角色的 T1 五家成立（见 T1_AGENT_DETECTION_TARGETS）；
 *   5. 引入新依赖 —— core 契约 + agent-detector 的纯类型 + 注入端口，仅此而已。
 *
 * 常量集中（task 规格要求）：周期 / 防抖阈值都在本文件顶部，改行为只动这里。
 *
 * why 判定收敛在一个服务而不是散在 UI：在线位是**全应用共享**的事实（战场灰显 / 角色卡徽标 /
 *   派任务拦截 / 对话拦截 / 恢复 toast 都消费它），必须有单一判定方 —— 散开判迟早漂移
 *   （A 处 1 次失败就灰、B 处 3 次才拦，用户看到两个矛盾的答案）。
 *
 * @since v3.30，task_054。
 */

import { emitWorldEvent } from '../../core/bus';
import type { AgentKind, DetectedAgent, WorldEvent } from '../../core/types';
import { T1_AGENT_DETECTION_TARGETS } from './agent-detector';
import type { TransportErrorCode } from './cli-transport/transport';
import type { AgentHealthEventInsert } from './persistence/agent-health-dao';

// ============================================================================
// 常量（集中：改监测行为只动这里）
// ============================================================================

/** 周期探测缺省间隔（ms）。why 60s：探测 = 逐家 which + --version（每家 ~1s，超时上限 10s）， */
export const DEFAULT_HEALTH_PROBE_INTERVAL_MS = 60_000;

/** 判离线的连续失败轮数（防抖）。why 2：1 次失败是噪音（冷启动 / 机器卡），2 次才是「真掉」。 */
export const HEALTH_OFFLINE_FAILURE_THRESHOLD = 2;

/** 健康监测关注的 kind 集（= T1 五家；从探测名单过滤而来，不另抄词表）。 */
export const HEALTH_MONITORED_KINDS: readonly string[] = T1_AGENT_DETECTION_TARGETS.map(
  (target) => target.kind
);

// ============================================================================
// 纯判定（单测的主战场 —— 不碰服务实例就能把口径钉死）
// ============================================================================

/**
 * 一轮探测里单个 agent 的健康判定：只有 status === 'installed' 算健康。
 * 'not-installed'（二进制没了）/ 'timeout'（--version 十秒不回）/ 'failed'（探测本身炸了）
 * 都算失败 —— 健康语义是「现在能不能用」，超时两次的 CLI 对用户而言就是掉线。
 */
export function probeResultHealthy(agent: DetectedAgent): boolean {
  return agent.status === 'installed';
}

/**
 * transport error 的 exit 码是否记 unhealthy：**非 0 退出且非用户主动中断**。
 * 'aborted' = 用户点了停止（AbortSignal 杀进程树），是正常生命周期不是崩溃；
 * 其余（nonzero_exit / timeout / cli_error / spawn_failed）都是进程级异常，各记一条审计。
 */
export function isUnhealthyTransportExit(code: TransportErrorCode): boolean {
  return code !== 'aborted';
}

// ============================================================================
// 服务
// ============================================================================

export interface HealthMonitorDeps {
  /**
   * 周期探测口：跑一轮 T1 探测并返回快照（生产 = IPC 到主进程真探测）。
   * 缺省 / null = 没有探测面（纯 vite dev、单测直喂 ingestProbeRound）——
   * 服务照常接受 transport 回调（审计照落），只是不自行起周期判定（在线位维持缺省在线）。
   * resolve null = 调用方自认本轮无数据（放弃，不计失败）；reject 同口径（见 tick 的 catch）。
   */
  readonly probe?: () => Promise<readonly DetectedAgent[] | null>;
  /** 事件发射口；缺省 core/bus 的 emitWorldEvent（world 通道，与 task.* / exp.* 同面）。 */
  readonly emit?: (event: WorldEvent) => void;
  /** 健康事件落库回调（fire-and-forget；生产 = agent-health-record 的 persister）。 */
  readonly persistEvent?: (insert: AgentHealthEventInsert) => void;
  /** 探测周期（ms）；缺省 DEFAULT_HEALTH_PROBE_INTERVAL_MS。 */
  readonly intervalMs?: number;
  /** 日志口；缺省静默。 */
  readonly logger?: (line: string) => void;
}

export interface HealthMonitor {
  /** 启动周期探测（无 probe 口则空转）；幂等；返回停止函数（清定时器）。 */
  start(): () => void;
  /**
   * 喂进一整轮探测快照（防抖判定的输入）。一轮 = 每个 T1 kind 各有一个最新结果；
   * 快照里缺席的 kind 视为「本轮没数据」，计数不动（没有数据 ≠ 失败，与检测器的
   * 「未知 ≠ 没装」同一哲学）。生产由 tick 自动喂；单测直接调它钉防抖口径。
   */
  ingestProbeRound(agents: readonly DetectedAgent[]): void;
  /**
   * transport 执行期 exit 异常上报（task-service / chat-service 的 error 事件回调）。
   * 非 aborted → unhealthy 计数 +1 并落一条审计；在线位不动（见文件头禁止事项 3）。
   */
  recordTransportFailure(kind: AgentKind, code: TransportErrorCode): void;
  /** 观察口：该 kind 当前是否在线（判定方自己的账本；缺省 true）。 */
  isOnline(kind: AgentKind): boolean;
  /** 观察口：该 kind 累计 unhealthy 次数（本进程内）。 */
  unhealthyCount(kind: AgentKind): number;
}

export function createHealthMonitor(deps: HealthMonitorDeps = {}): HealthMonitor {
  const emit = deps.emit ?? emitWorldEvent;
  const logger = deps.logger ?? ((): void => { /* 缺省静默 */ });
  const intervalMs = deps.intervalMs ?? DEFAULT_HEALTH_PROBE_INTERVAL_MS;

  /** 连续失败轮数（成功清零）；缺席 = 0。 */
  const consecutiveFailures = new Map<AgentKind, number>();
  /** 已判离线的 kind 集（缺席 = 在线缺省位）；只有真翻转才动它。 */
  const offlineKinds = new Set<AgentKind>();
  /** unhealthy 审计计数（进程内观察口；落库行数才是长期真相）。 */
  const unhealthyCounts = new Map<AgentKind, number>();

  /** 落库回调：异常只记日志（审计不绑架监测回路，与 makeTaskRecordPersister 同一口径）。 */
  const persist = (insert: AgentHealthEventInsert): void => {
    if (!deps.persistEvent) return;
    try {
      deps.persistEvent(insert);
    } catch (error) {
      logger(`[health-monitor] 健康事件落库回调抛错（${insert.kind}/${insert.event}）：${
        error instanceof Error ? error.message : String(error)
      }`);
    }
  };

  const markOffline = (kind: AgentKind): void => {
    offlineKinds.add(kind);
    emit({ type: 'agent.offline', kind });
    persist({ kind, event: 'offline', createdAt: Date.now() });
    logger(`[health-monitor] ${kind} 连续 ${HEALTH_OFFLINE_FAILURE_THRESHOLD} 轮探测失败，判离线`);
  };

  const markOnline = (kind: AgentKind): void => {
    offlineKinds.delete(kind);
    emit({ type: 'agent.online', kind });
    persist({ kind, event: 'online', createdAt: Date.now() });
    logger(`[health-monitor] ${kind} 探测恢复在线`);
  };

  let timer: ReturnType<typeof setInterval> | undefined;

  /** 一轮周期探测：null / 异常 = 本轮放弃（计数不动 —— IPC 断了不是 agent 的锅）。 */
  const tick = (): void => {
    if (!deps.probe) return;
    void deps
      .probe()
      .then((agents) => {
        if (agents) service.ingestProbeRound(agents);
      })
      .catch((error: unknown) => {
        logger(
          `[health-monitor] 探测轮失败（本轮跳过）：${error instanceof Error ? error.message : String(error)}`
        );
      });
  };

  const service: HealthMonitor = {
    start(): (() => void) {
      if (timer !== undefined || !deps.probe) return () => undefined;
      timer = setInterval(tick, intervalMs);
      return () => {
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
      };
    },

    ingestProbeRound(agents: readonly DetectedAgent[]): void {
      for (const agent of agents) {
        if (!HEALTH_MONITORED_KINDS.includes(agent.kind)) continue; // 非 T1：没有执行链路，不判
        const kind = agent.kind as AgentKind; // T1 ⊆ AgentKind（词表包含关系见 core/types.ts）
        if (probeResultHealthy(agent)) {
          consecutiveFailures.set(kind, 0);
          // 恢复即回：一次成功就翻回在线（恢复不用防抖 —— 晚恢复的代价是少干一拍活，
          // 早恢复的代价只是白亮一瞬，两者不对称，宁早勿晚）。
          if (offlineKinds.has(kind)) markOnline(kind);
          continue;
        }
        const failures = (consecutiveFailures.get(kind) ?? 0) + 1;
        consecutiveFailures.set(kind, failures);
        if (failures >= HEALTH_OFFLINE_FAILURE_THRESHOLD && !offlineKinds.has(kind)) markOffline(kind);
      }
    },

    recordTransportFailure(kind: AgentKind, code: TransportErrorCode): void {
      if (!isUnhealthyTransportExit(code)) return; // 用户中断不是崩溃
      unhealthyCounts.set(kind, (unhealthyCounts.get(kind) ?? 0) + 1);
      persist({ kind, event: 'unhealthy', createdAt: Date.now() });
    },

    isOnline(kind: AgentKind): boolean {
      return !offlineKinds.has(kind);
    },

    unhealthyCount(kind: AgentKind): number {
      return unhealthyCounts.get(kind) ?? 0;
    },
  };

  return service;
}
