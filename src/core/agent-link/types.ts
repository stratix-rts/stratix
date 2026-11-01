/**
 * 文件职责：core/agent-link 的域类型 —— 建立会话所需的参数、会话向上层抛的事件、可持久化快照。
 *   契约侧的类型（AgentLinkView / AgentMessageView / AgentLinkPhase / UnitStatus）全部来自
 *   core/types.ts（总线唯一事实源），本文件只做**加法**：core 契约里不该出现的传输细节、事件语义放这里。
 * 输入：无（纯类型）。
 * 输出：AgentLinkOpenParams、AgentLinkSessionEvent、AgentLinkSnapshot、AgentLinkViewFilter 等。
 * 禁止事项：
 *   1. 重复定义 core/types.ts 已有的类型 —— 两份词表必然漂移；
 *   2. 出现 any —— 跨模块的形状必须可静态穷尽；
 *   3. 引用 socket / WebSocket / DOM 类型 —— core 零渲染依赖。
 *
 * 层次划分：types.ts（形状） → protocol.ts（编解码） → transport.ts（端口） → session.ts（状态机）
 *          → manager.ts（多会话 + 状态投影）。上层只 import 本文件与 core/types.ts。
 */

import type { AgentLinkKind, AgentLinkPhase, AgentMessageView, UnitStatus } from '../types';

// ============================================================================
// 建立 / 恢复会话的参数
// ============================================================================

export interface AgentLinkOpenParams {
  /** 本地会话 id；缺省由 manager 生成（link_1、link_2…）。恢复会话时必须沿用旧 id。 */
  readonly linkId?: string;
  readonly kind: AgentLinkKind;
  /** 远端 agent 端点（OpenClaw 服务地址）。**会脱敏后才进 WorldState**。 */
  readonly endpoint: string;
  /** 展示名；缺省用脱敏端点。 */
  readonly displayName?: string;
  /** 网关账号标识，缺省 'stratix'（与现网 POST /ws-connect 默认值一致）。 */
  readonly accountId?: string;
  readonly apiKey?: string;
  /** 指定远端 agent（OpenClaw 多 agent 场景）。 */
  readonly agentId?: string;
  /** 恢复用：带上原会话键即接上原上下文（现网语义：sessionKey/sessionId 每次调用透传）。 */
  readonly sessionId?: string | null;
}

/** 可持久化快照：应用重启后用它恢复会话。**刻意不含 apiKey** —— 凭据不入快照，由上层密钥库注入。 */
export interface AgentLinkSnapshot {
  readonly linkId: string;
  readonly kind: AgentLinkKind;
  readonly endpoint: string;
  readonly displayName: string;
  readonly accountId: string;
  readonly agentId: string | null;
  readonly sessionId: string | null;
}

// ============================================================================
// 会话事件（session → manager 的唯一出口）
// ============================================================================

export type AgentLinkSessionEvent =
  /** 相位迁移。reason 是人话原因，直接进 Notice 文本。 */
  | { readonly type: 'phase'; readonly phase: AgentLinkPhase; readonly previous: AgentLinkPhase; readonly reason: string | null; readonly at: number }
  /** 远端消息回传（聊天抽屉的数据源）。 */
  | { readonly type: 'message'; readonly message: AgentMessageView }
  /** 远端状态回传（回写到同 id 的 UnitView；单位不存在时只广播事件不建单位）。 */
  | { readonly type: 'status'; readonly agentId: string | null; readonly status: UnitStatus; readonly at: number }
  /** 会话级错误：进 lastError 并推 error 级 Notice。 */
  | { readonly type: 'error'; readonly message: string; readonly at: number; readonly retryable: boolean }
  /** 握手中拿到的远端标识（agentId / sessionId），manager 据此更新视图。 */
  | { readonly type: 'identity'; readonly agentId: string | null; readonly sessionId: string | null; readonly at: number }
  /** 未归一的远端事件原样透传（协议演进留口：不识别的数据不许被静默吃掉）。 */
  | { readonly type: 'raw'; readonly event: string; readonly data: unknown };

export type AgentLinkSessionListener = (event: AgentLinkSessionEvent) => void;

// ============================================================================
// 查询
// ============================================================================

/** 会话列表过滤条件（agent-panel 筛选用）。全不填 = 全部。 */
export interface AgentLinkViewFilter {
  readonly phase?: AgentLinkPhase;
  readonly kind?: AgentLinkKind;
}