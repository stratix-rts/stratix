/**
 * world-sync WebSocket 客户端：连上 Stratix service，订阅全量快照，维护一份**投影**。
 *
 * 契约要点（docs/WORLD-SYNC.md）：
 * - 连接后**第一件事**是发 `hello`，service 用一份全量 `snapshot` 作回答（没有欢迎帧）；
 * - `snapshot` 是广播口径的全量真相，客户端只持有投影，整体覆盖、不做增量合并；
 * - 断连是常态 —— 这里按固定退避重连，重连后重新 `hello` 并整体覆盖。
 *
 * 本客户端**只读**：它不发 `command.forward`，因此不涉及写路径的裁决与回执。
 */

import {
  createHello,
  isProtocolErrorMessage,
  isSnapshotMessage,
  type SnapshotMessage,
  WORLD_SYNC_PROTOCOL_VERSION,
} from './protocol.js';

export interface WorldSyncClientOptions {
  /** 完整 WS 端点 URL（含 path），例如 ws://127.0.0.1:7797/ws/world-sync */
  readonly url: string;
  /** 客户端实例 id（service 侧用作连接日志与广播归属）。 */
  readonly clientId: string;
  /** 协议版本自报值，默认 1。 */
  readonly protocolVersion?: number;
  /** 重连退避基数（毫秒），实际间隔按重试次数线性增长并封顶。 */
  readonly reconnectDelayMs?: number;
  /** 重连退避上限（毫秒）。 */
  readonly maxReconnectDelayMs?: number;
  /** 诊断输出（默认 stderr —— headless profile 把诊断写 stderr，stdout 留给答案）。 */
  readonly log?: (message: string) => void;
}

const DEFAULT_RECONNECT_DELAY_MS = 500;
const DEFAULT_MAX_RECONNECT_DELAY_MS = 5_000;

/**
 * 一条只读的 world-sync 连接。
 *
 * 生命周期：构造 → `start()` → 反复重连直到 `stop()`。
 * 资源纪律：socket 与重连定时器都在 `stop()` 里清掉，不留孤儿。
 */
export class WorldSyncClient {
  private readonly options: WorldSyncClientOptions;
  private socket: WebSocket | null = null;
  private snapshot: SnapshotMessage | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;
  private stopped = true;

  constructor(options: WorldSyncClientOptions) {
    this.options = options;
  }

  /** 开始连接（幂等）。 */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  /** 停止连接并清理定时器；之后不再重连。 */
  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket !== null) {
      const socket = this.socket;
      this.socket = null;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // 关一个已经断掉的 socket 不该把插件带崩 —— 诊断已由 onclose 记过。
      }
    }
  }

  /** 最近一次收到的全量快照；还没有收到过就是 null（= 没有真相，不是「战场为空」）。 */
  getSnapshot(): SnapshotMessage | null {
    return this.snapshot;
  }

  /** 连接是否已经建立且收到过至少一份快照。 */
  isAttached(): boolean {
    return this.snapshot !== null;
  }

  private log(message: string): void {
    const log = this.options.log ?? ((text: string) => console.error(`[stratix-dsh-bridge] ${text}`));
    log(message);
  }

  private connect(): void {
    if (this.stopped) return;
    if (typeof WebSocket === 'undefined') {
      this.log('运行时没有全局 WebSocket（需要 Node >= 22）；放弃连接。');
      return;
    }
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.options.url);
    } catch (error) {
      this.log(`连接失败（${String(error)}），将重试。`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.retries = 0;
      const hello = createHello(this.options.clientId, this.options.protocolVersion ?? WORLD_SYNC_PROTOCOL_VERSION);
      socket.send(JSON.stringify(hello));
      this.log(`已连接 ${this.options.url}，已发送 hello。`);
    };

    socket.onmessage = (event: MessageEvent) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        this.log('收到无法解析的帧，忽略。');
        return;
      }
      if (isSnapshotMessage(parsed)) {
        // 全量覆盖：不做增量合并（docs/WORLD-SYNC.md §1.2）。
        this.snapshot = parsed;
        this.log(`收到 snapshot seq=${parsed.seq}，units=${parsed.state.units?.length ?? 0}。`);
        return;
      }
      if (isProtocolErrorMessage(parsed)) {
        this.log(`协议错误 ${parsed.code}：${parsed.message}`);
        return;
      }
      this.log('收到不认识的帧类型，忽略。');
    };

    socket.onerror = () => {
      this.log('socket 错误，等待关闭后重连。');
    };

    socket.onclose = (event: { code: number }) => {
      this.socket = null;
      if (this.stopped) return;
      this.log(`连接关闭（code=${event.code}），准备重连。`);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== null) return;
    const base = this.options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
    const max = this.options.maxReconnectDelayMs ?? DEFAULT_MAX_RECONNECT_DELAY_MS;
    const delay = Math.min(base * Math.max(1, this.retries), max);
    this.retries += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    // 别让重连定时器拖住宿主进程退出。
    (this.reconnectTimer as { unref?: () => void }).unref?.();
  }
}
