/**
 * 文件职责：world-sync 传输层的**内存 duplex socket**（task_082 单测替身）——
 *   一对内存 socket 互为对端：A.send(text) → B 收到 'message'；B.send(text) → A 收到。
 * 输入：端点/会话发来的文本帧。
 * 输出：对端收到的帧（recorded）+ 本端 'message' / 'close' / 'error' / 'pong' 事件。
 * 禁止事项：
 *   1. 起真端口 / 连真 TCP —— 本替身只覆盖传输层逻辑（收发、清理、心跳），不覆盖网络栈；
 *   2. 偷偷替被测代码兜底 —— 例如自动回 pong（可关：autoPong = false 模拟死链）。
 *
 * why 需要它：world-sync 的收发/清理/心跳逻辑必须能在**不起真端口**的前提下被单测覆盖
 * （CI 上起端口慢且不稳；端口纪律另见任务说明）。
 */

import type { WorldSyncSocket } from '../../session';

/** 内存 socket（实现 WorldSyncSocket 的窄接口）。 */
export class MemorySocket implements WorldSyncSocket {
  /** 连接状态（1 = OPEN，3 = CLOSED）。 */
  readyState = 1;

  /** 对端（createDuplexPair 配好）。 */
  peer: MemorySocket | null = null;

  /** 本端发出的文本帧。 */
  readonly sent: string[] = [];

  /** 本端收到的文本帧。 */
  readonly received: string[] = [];

  /** 是否自动回 pong（false = 模拟死链）。 */
  autoPong = true;

  /** 被 terminate 的次数（观测「踢死链」用）。 */
  terminateCount = 0;

  /** 关闭时用的状态码（观测「版本不兼容就断开」用）。 */
  closeCode: number | null = null;

  /** 事件监听表。 */
  private readonly listeners = new Map<string, Set<(...args: any[]) => void>>();

  on(event: string, listener: (...args: any[]) => void): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }

  send(data: string): void {
    if (this.readyState !== 1) return;
    this.sent.push(data);
    this.peer?.receive(data);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closeCode = code ?? null;
    // 对端也要看到断开（真实 WS 的 FIN 语义：两端都会收到 'close'）。
    this.peer?.receiveClose(code, reason);
    this.emit('close', code, reason);
  }

  /** 对端关闭 → 本端收到 'close'（不再往回传，避免来回弹）。 */
  receiveClose(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.closeCode = code ?? null;
    this.emit('close', code, reason);
  }

  terminate(): void {
    this.terminateCount += 1;
    this.close();
  }

  ping(): void {
    if (!this.autoPong) return;
    queueMicrotask(() => {
      if (this.readyState === 1) this.emit('pong', Buffer.alloc(0));
    });
  }

  /** 收到对端发来的文本帧。 */
  receive(data: string): void {
    if (this.readyState !== 1) return;
    this.received.push(data);
    this.emit('message', Buffer.from(data, 'utf-8'));
  }

  /** 触发一个事件。 */
  emit(event: string, ...args: any[]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const listener of Array.from(set)) listener(...args);
  }

  /** 收到的消息（已解析 JSON）。 */
  messages<T = Record<string, unknown>>(): T[] {
    return this.received.map((raw) => JSON.parse(raw) as T);
  }

  /** 收到的某类型消息。 */
  messagesOfType<T = Record<string, unknown>>(type: string): T[] {
    return this.messages<T>().filter(
      (message) => (message as { type?: unknown }).type === type
    );
  }
}

/** 一对互为对端的内存 socket。 */
export interface DuplexPair {
  /** 客户端侧（测试驱动它）。 */
  readonly client: MemorySocket;
  /** 服务端侧（交给端点 accept）。 */
  readonly server: MemorySocket;
}

/** 造一对互为对端的内存 socket。 */
export function createDuplexPair(): DuplexPair {
  const client = new MemorySocket();
  const server = new MemorySocket();
  client.peer = server;
  server.peer = client;
  return { client, server };
}

/** 让出若干轮（等微任务 + 定时器回调跑完）。 */
export function flush(times = 3): Promise<void> {
  let chain = Promise.resolve();
  for (let i = 0; i < times; i += 1) {
    chain = chain.then(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  }
  return chain;
}

/** 等一小段时间（ms）—— 给节流窗口 / 超时探针留出真实时间。 */
export function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
