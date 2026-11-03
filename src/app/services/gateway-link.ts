/**
 * 文件职责：**网关（service / stratix-gateway）连通性监测**（@since v3.6，task_114）——
 *   HUD 的全局断连横幅的**唯一判定方**：周期探一次网关的 `/health`，把「在线 / 断连」
 *   推给订阅者（横幅）。判定收敛在一个服务里，与 health-monitor（agent 进程健康）同一纪律：
 *   散开判迟早漂移（A 处 1 次失败就亮、B 处 2 次才亮，用户看到两个矛盾的答案）。
 * 输入：网关 HTTP 基址 + 探测口（fetch，缺省全局）+ 周期（缺省 2s）。
 * 输出：GatewayLinkPort（实现 hud/components/gateway-banner 的端口契约）：
 *   `online`（同步读）/ `subscribe(handler)`（订阅变化）/ `refresh()`（立刻探一次 —— 重试按钮）。
 * 禁止事项：
 *   1. 往 HUD 反向 import 运行时（只 import 端口**类型** —— 类型不产生运行时依赖）；
 *   2. 探测失败时抛错 —— 探活失败就是「断连」，不是一个异常（横幅要的是结论，不是栈）；
 *   3. 无限增长的历史 —— 本服务**不留**历史（只留当前态），订阅者集合随退订收缩；
 *   4. 叠加重入的探测 —— 单飞：上一轮没回就不叠第二轮（perf：资源必须封顶）；
 *   5. 留下定时器 / 未清的 Abort —— stop() 清定时器，每次探测清自己的超时定时器。
 *
 * ============ 为什么需要「探活」而不是「等事件」 ============
 *   本地直连模式下（dev 默认形态）浏览器页与网关之间**没有常驻连接**：
 *   世界状态在页内本地裁决，agent 会话由页内 CLI 进程跑，网关只提供**按需 REST**
 *   （会话历史 / 当日回放 / 智能体清单 …）。于是「网关进程死了」这件事在总线上一条事件都没有 ——
 *   右栏态势屏的「网关连接」行读的是 **agent-link 会话相位**，没有会话时它恒为「未连接」，
 *   与网关死活无关（所以不能拿它当网关连通性的信号）。
 *   能判网关生死的只有一个事实：**它的 HTTP 端点还在不在**。故这里探 `/health`
 *   （网关自带的零副作用健康端点，GET，响应 ~200 字节）。
 *   周期 2s：验收要求「杀网关后 3s 内出横幅」—— 探测周期必须显著小于 3s；
 *   2s 是「快到能感知」与「别把 CPU/网络打满」的折中（每秒 1 次 GET /health，负载可忽略）。
 *
 * @since v3.6，task_114。
 */

import type { GatewayLinkPort } from '../../hud/components/gateway-banner/gateway-banner';

import { DEFAULT_SESSION_HISTORY_BASE_URL } from './session-history/session-history';

/** 网关健康端点路径（网关侧 app.get('/health')，零副作用）。 */
export const GATEWAY_HEALTH_PATH = '/health';

/** 探测周期（ms）。why 2s：验收口径是「3s 内出横幅」，周期必须明显小于它。 */
export const DEFAULT_GATEWAY_PROBE_INTERVAL_MS = 2_000;

/** 单次探测超时（ms）。why 1.5s：小于周期 —— 超时的探测不能拖住下一轮。 */
export const DEFAULT_GATEWAY_PROBE_TIMEOUT_MS = 1_500;

/** 监测服务依赖（全部可注入 —— 单测不打真端口）。 */
export interface GatewayLinkDeps {
  /** 网关 HTTP 基址（缺省本机 7524）；远程模式从 world-sync 端点换协议得出。 */
  readonly baseUrl?: string;
  /** 探测周期（ms）。 */
  readonly intervalMs?: number;
  /** 单次探测超时（ms）。 */
  readonly timeoutMs?: number;
  /** 探测口（缺省全局 fetch）。 */
  readonly fetchImpl?: typeof fetch;
}

/** 监测服务对外形状（比端口多一个 start/stop —— 生命周期归组合根管）。 */
export interface GatewayLinkMonitor extends GatewayLinkPort {
  /** 开始周期探测（幂等）；返回停止闭包（= stop）。 */
  start(): () => void;
  /** 停止周期探测（清定时器 —— 资源必须可清理）。 */
  stop(): void;
}

/**
 * 造网关连通性监测服务。
 *
 * 初始态取「在线」：首帧不知道网关死活，先不闪一条横幅 ——
 *   第一轮探测（start 时立刻跑）会在几百毫秒内给出真结论。
 */
export function createGatewayLinkMonitor(deps: GatewayLinkDeps = {}): GatewayLinkMonitor {
  const baseUrl = (deps.baseUrl ?? DEFAULT_SESSION_HISTORY_BASE_URL).replace(/\/+$/, '');
  const intervalMs = deps.intervalMs ?? DEFAULT_GATEWAY_PROBE_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GATEWAY_PROBE_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const healthUrl = `${baseUrl}${GATEWAY_HEALTH_PATH}`;

  let online = true;
  /** 在飞的那一轮探测（单飞：同一时刻只有一次请求）。 */
  let pending: Promise<boolean> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const handlers = new Set<(online: boolean) => void>();

  /** 状态翻转才通知（不变不通知 —— 避免每轮探测都让横幅重绘）。 */
  const setOnline = (next: boolean): void => {
    if (next === online) return;
    online = next;
    for (const handler of [...handlers]) handler(online);
  };

  /** 探一次（成功 = 2xx；失败/超时 = 断连）。 */
  const probeOnce = async (): Promise<boolean> => {
    const controller = new AbortController();
    // Abort 与 clearTimeout 必须成对（perf：每次探测不留悬挂定时器）。
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(healthUrl, { method: 'GET', signal: controller.signal });
      return response.ok;
    } catch {
      // 探活失败 = 断连（不是一个异常 —— 横幅要的是结论）。
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  /** 探一次并落状态（并发调用共用同一轮 —— 单飞）。 */
  const runProbe = async (): Promise<boolean> => {
    if (pending) return pending;
    const own = probeOnce();
    pending = own;
    try {
      return await own;
    } finally {
      if (pending === own) pending = null;
    }
  };

  /** 一轮探测：拿到结论就翻状态（不改就不动 HUD）。 */
  const tick = (): void => {
    void runProbe().then(
      (ok) => setOnline(ok),
      () => setOnline(false),
    );
  };

  const monitor: GatewayLinkMonitor = {
    get online(): boolean {
      return online;
    },

    subscribe(handler: (online: boolean) => void): () => void {
      handlers.add(handler);
      handler(online);
      return () => {
        handlers.delete(handler);
      };
    },

    async refresh(): Promise<boolean> {
      const ok = await runProbe();
      setOnline(ok);
      return ok;
    },

    start(): () => void {
      if (timer !== null) return monitor.stop;
      tick(); // 先探一轮（不等一个周期才给结论 —— 启动即给真话）
      timer = setInterval(tick, intervalMs);
      return monitor.stop;
    },

    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };

  return monitor;
}
