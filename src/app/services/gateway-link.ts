/**
 * 文件职责：**网关（service / stratix-gateway）连通性监测**（@since v3.6，task_114；
 *   @since v3.7，task_127 升级为三级）——
 *   HUD 的全局横幅与态势屏「网关连接」行的**唯一判定方**：周期探一次网关的
 *   ① HTTP 面（`/health`）与 ② 实时通道面（WS），把三级态推给订阅者。
 *   判定收敛在一个服务里，与 health-monitor（agent 进程健康）同一纪律：
 *   散开判迟早漂移（A 处 1 次失败就亮、B 处 2 次才亮，用户看到两个矛盾的答案）。
 * 输入：网关 HTTP 基址 + WS 端点（可注入 fetch / WebSocket 工厂 → 单测不起真端口）+ 周期。
 * 输出：GatewayLinkPort（实现 hud/bridge/gateway-link-port 的端口契约）：
 *   `state`（同步读）/ `subscribe(handler)`（订阅变化）/ `refresh()`（立刻探一次 —— 重试按钮）。
 * 禁止事项：
 *   1. 往 HUD 反向 import 运行时（只 import 端口**类型** —— 类型不产生运行时依赖）；
 *   2. 探测失败时抛错 —— 探活失败就是「不通」，不是一个异常（横幅要的是结论，不是栈）；
 *   3. 无限增长的历史 —— 本服务**不留**历史（只留当前态），订阅者集合随退订收缩；
 *   4. 叠加重入的探测 —— 单飞：上一轮没回就不叠第二轮（perf：资源必须封顶）；
 *   5. 留下定时器 / 未清的 Abort —— stop() 清定时器，每次探测清自己的超时定时器；
 *   6. 在 WS 探测上挂业务订阅 —— 探测连上即立刻关闭（只验「通道通不通」，不消费数据）。
 *
 * ============ 为什么是三级而不是二值 ============
 *   task_127 的复测证据（reports/2026-11-04-stratix-ui-review.md 新发现 #2）：
 *   网关 HTTP 全通（/health 与 /api/storage/sessions 都成功，回放读得出真数据），
 *   但实时通道断开 —— 二值模型只能落进「没连」，于是界面喊「未连接」而回放照放，
 *   用户没法判断「现在到底能不能用」。故拆成三态：
 *     online   —— HTTP 通 且 WS 通：一切正常。
 *     degraded —— HTTP 通、WS 不通：**数据可用**（回放 / 历史 / 名册照常），实时更新不可用。
 *     offline  —— HTTP 不通：网关整体不可达，功能没有数据。
 *
 * ============ 为什么需要「探活」而不是「等事件」 ============
 *   本地直连模式下（dev 默认形态）浏览器页与网关之间**没有常驻连接**：
 *   世界状态在页内本地裁决，agent 会话由页内 CLI 进程跑，网关只提供**按需 REST**
 *   （会话历史 / 当日回放 / 智能体清单 …）。于是「网关进程死了」这件事在总线上一条事件都没有 ——
 *   态势屏原先那行「网关连接」读的是 **agent-link 会话相位**，没有会话时它恒为「未连接」，
 *   与网关死活无关（所以不能拿它当网关连通性的信号）。
 *   能判网关生死的只有一个事实：**它的 HTTP 端点还在不在**。故这里探 `/health`
 *   （网关自带的零副作用健康端点，GET，响应 ~200 字节）。
 *   周期 2s：验收要求「杀网关后 3s 内出横幅」—— 探测周期必须显著小于 3s；
 *   2s 是「快到能感知」与「别把 CPU/网络打满」的折中（每秒 1 次 GET /health，负载可忽略）。
 *
 * @since v3.6，task_114。@since v3.7，task_127（三级态 + WS 面探测）。
 */

import type {
  GatewayConnectionState,
  GatewayLinkPort,
} from '../../hud/bridge/gateway-link-port';

import { DEFAULT_SESSION_HISTORY_BASE_URL } from './session-history/session-history';

/** 网关健康端点路径（网关侧 app.get('/health')，零副作用）。 */
export const GATEWAY_HEALTH_PATH = '/health';

/**
 * 网关实时通道（WS）端点路径 —— 与网关 world-sync 端点同一条路径。
 * why 这里写死而不从 gateway 模块 import：那个模块当前带着**并行任务**留下的类型错误
 *   （core/types.ts 加了 character.delete，协议侧的命令表还没跟上），
 *   import 进来会把那个错误带进应用层与 HUD 侧的编译单元（jest 的 ts-jest 也会因此报错）。
 *   路径与网关侧一致（src/stratix-gateway/api/websocket/world-sync/protocol.ts 的 WORLD_SYNC_PATH）；
 *   网关换路径时两边一起改（这里只是一条探测地址，不参与任何数据面协议）。
 */
export const GATEWAY_WS_PATH = '/ws/world-sync';

/** 探测周期（ms）。why 2s：验收口径是「3s 内出横幅」，周期必须明显小于它。 */
export const DEFAULT_GATEWAY_PROBE_INTERVAL_MS = 2_000;

/** 单次探测超时（ms）。why 1.5s：小于周期 —— 超时的探测不能拖住下一轮。 */
export const DEFAULT_GATEWAY_PROBE_TIMEOUT_MS = 1_500;

/**
 * WS 通道的最小面（浏览器原生 WebSocket 的窄接口）。
 * why 不直接用 DOM 的 WebSocket 类型：本文件要能在 node 环境单测（不引新依赖）。
 */
export interface GatewayWebSocketLike {
  close(): void;
  onopen: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: unknown) => void) | null;
}

/** WS 工厂（单测注入内存替身；缺省全局 WebSocket —— 浏览器与 Node 22+ 都有）。 */
export type GatewayWebSocketCtor = new (url: string) => GatewayWebSocketLike;

/** 监测服务依赖（全部可注入 —— 单测不打真端口）。 */
export interface GatewayLinkDeps {
  /** 网关 HTTP 基址（缺省本机 7524）；远程模式从 world-sync 端点换协议得出。 */
  readonly baseUrl?: string;
  /** 实时通道（WS）端点（缺省由 baseUrl 换协议 + world-sync 路径推出）。 */
  readonly wsUrl?: string;
  /** 探测周期（ms）。 */
  readonly intervalMs?: number;
  /** 单次探测超时（ms）。 */
  readonly timeoutMs?: number;
  /** 探测口（缺省全局 fetch）。 */
  readonly fetchImpl?: typeof fetch;
  /** WS 工厂（缺省全局 WebSocket；单测注入内存替身）。 */
  readonly webSocketImpl?: GatewayWebSocketCtor;
}

/** 监测服务对外形状（比端口多一个 start/stop —— 生命周期归组合根管）。 */
export interface GatewayLinkMonitor extends GatewayLinkPort {
  /** 开始周期探测（幂等）；返回停止闭包（= stop）。 */
  start(): () => void;
  /** 停止周期探测（清定时器 —— 资源必须可清理）。 */
  stop(): void;
}

/** http(s) 基址 → ws(s) 基址（协议换掉，其余不动）。 */
function toWebSocketBase(baseUrl: string): string {
  if (baseUrl.startsWith('https://')) return `wss://${baseUrl.slice('https://'.length)}`;
  if (baseUrl.startsWith('http://')) return `ws://${baseUrl.slice('http://'.length)}`;
  return baseUrl;
}

/**
 * 造网关连通性监测服务（三级态）。
 *
 * 初始态取「在线」：首帧不知道网关死活，先不闪一条横幅 ——
 *   第一轮探测（start 时立刻跑）会在几百毫秒内给出真结论。
 */
export function createGatewayLinkMonitor(deps: GatewayLinkDeps = {}): GatewayLinkMonitor {
  const baseUrl = (deps.baseUrl ?? DEFAULT_SESSION_HISTORY_BASE_URL).replace(/\/+$/, '');
  const wsUrl = deps.wsUrl ?? `${toWebSocketBase(baseUrl)}${GATEWAY_WS_PATH}`;
  const intervalMs = deps.intervalMs ?? DEFAULT_GATEWAY_PROBE_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_GATEWAY_PROBE_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
  const webSocketImpl =
    deps.webSocketImpl ??
    ((globalThis as { WebSocket?: GatewayWebSocketCtor }).WebSocket as GatewayWebSocketCtor);
  const healthUrl = `${baseUrl}${GATEWAY_HEALTH_PATH}`;

  let state: GatewayConnectionState = 'online';
  /** 在飞的那一轮探测（单飞：同一时刻只有一次请求）。 */
  let pending: Promise<GatewayConnectionState> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const handlers = new Set<(state: GatewayConnectionState) => void>();

  /** 状态翻转才通知（不变不通知 —— 避免每轮探测都让横幅重绘）。 */
  const setState = (next: GatewayConnectionState): void => {
    if (next === state) return;
    state = next;
    for (const handler of [...handlers]) handler(next);
  };

  /** 探一次 HTTP（成功 = 2xx；失败/超时 = 不通）。 */
  const probeHttpOnce = async (): Promise<boolean> => {
    const controller = new AbortController();
    // Abort 与 clearTimeout 必须成对（perf：每次探测不留悬挂定时器）。
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(healthUrl, { method: 'GET', signal: controller.signal });
      return response.ok;
    } catch {
      // 探活失败 = 不通（不是一个异常 —— 横幅要的是结论）。
      return false;
    } finally {
      clearTimeout(timeout);
    }
  };

  /**
   * 探一次 WS（连上即算通，随后**立刻关闭**）。
   * why 只验「通道能不能连上」：探测连接不订阅任何数据、不发任何命令 ——
   *   网关侧只是多一条秒级存在的会话（attach 不会推快照，负载可忽略）。
   */
  const probeWsOnce = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      if (!webSocketImpl) {
        resolve(false);
        return;
      }
      let settled = false;
      let socket: GatewayWebSocketLike;
      try {
        socket = new webSocketImpl(wsUrl);
      } catch {
        resolve(false);
        return;
      }
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.onopen = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // 关不掉也不影响结论（已经 settle 了）。
        }
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      socket.onopen = () => finish(true);
      socket.onerror = () => finish(false);
      socket.onclose = () => finish(false);
    });

  /** 两路探测 → 三级态。HTTP 不通 = 离线（WS 结论无意义）；HTTP 通再看 WS。 */
  const probeOnce = async (): Promise<GatewayConnectionState> => {
    const httpOk = await probeHttpOnce();
    if (!httpOk) return 'offline';
    const wsOk = await probeWsOnce();
    return wsOk ? 'online' : 'degraded';
  };

  /** 探一次并落状态（并发调用共用同一轮 —— 单飞）。 */
  const runProbe = async (): Promise<GatewayConnectionState> => {
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
      (next) => setState(next),
      () => setState('offline'),
    );
  };

  const monitor: GatewayLinkMonitor = {
    get state(): GatewayConnectionState {
      return state;
    },

    subscribe(handler: (state: GatewayConnectionState) => void): () => void {
      handlers.add(handler);
      handler(state);
      return () => {
        handlers.delete(handler);
      };
    },

    async refresh(): Promise<GatewayConnectionState> {
      const next = await runProbe();
      setState(next);
      return next;
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
