/**
 * 文件职责：MCP server 的类型契约 —— JSON-RPC 2.0 帧、工具注册项（ToolSpec）、数据面端口（McpHost）。
 * 输入：无（纯类型文件，运行期零依赖）。
 * 输出：server.ts / registry.ts / envelope.ts / tools/* 共用的类型定义。
 * 禁止事项：
 *   1. 在本文件里放运行期逻辑 —— 它只是契约；
 *   2. 让 McpHost 依赖具体传输（stdio / HTTP）—— 传输层只负责收发帧，工具语义与传输无关
 *      （docs/MCP-SPEC.md §4.4：两种模式共享同一份注册表与 handler）；
 *   3. 引入任何 npm 依赖 —— MCP 协议面手写实现，零新增依赖是本批验收项；
 *   4. 在这里复制 core 的状态形状 —— 世界态只有 core/types.ts 一份真相，本文件只引用它。
 */

import type { HudCommand, WorldState } from '../../core/types';

/** JSON-RPC 2.0 的请求 id。缺省（无 id）= 通知，按协议不回响应。 */
export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: '2.0';
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

/**
 * JSON Schema 属性（子集：MCP 工具 inputSchema 用得上的一组关键字）。
 * why 只列这一组：schema 是**契约**，多写一个关键字就多一份将来要守的约定；
 * 需要的关键字不在表里时，先想清楚是不是该换表达（过滤器用对象 + 各自描述，不用万能参数）。
 */
export interface JsonSchemaProperty {
  readonly type?: string | readonly string[];
  readonly description?: string;
  readonly enum?: readonly string[];
  readonly items?: JsonSchemaProperty;
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly maxItems?: number;
  readonly default?: unknown;
}

export interface JsonSchemaObject {
  readonly type: string;
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
  readonly [key: string]: unknown;
}

/** 工具返回的内容块（第一期只用文本块 —— 见 docs/MCP-SPEC.md §0.3：只做 tools，不做 resources/prompts）。 */
export interface McpTextContent {
  readonly type: 'text';
  readonly text: string;
}

/**
 * 工具调用结果（MCP 约定的形状）。
 * isError = true 表示**业务失败**（信封 ok=false）；协议级/参数级失败走 JSON-RPC error，不带 isError
 * （docs/MCP-SPEC.md §2.0 返回信封约定）。
 */
export interface ToolCallResult {
  readonly content: readonly McpTextContent[];
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}

/** 工具 handler 的签名：入参（已过 schema 校验的裸对象）+ 数据面端口 → 工具结果。 */
export type ToolHandler = (
  args: Readonly<Record<string, unknown>>,
  host: McpHost
) => Promise<ToolCallResult> | ToolCallResult;

/**
 * 工具注册项（docs/MCP-SPEC.md §4.1 ToolSpec）。
 * 新增工具 = 注册一条，不改既有工具。
 */
export interface ToolSpec {
  /** `stratix_<域>_<动词>_<资源>`，全局唯一，snake_case。 */
  readonly name: string;
  /** 域前缀（world / task / mission / chat / 无域）；仅用于分组与文档，不参与路由。 */
  readonly domain?: string;
  /** 动作词（受控词表，见 §4.2）。 */
  readonly verb?: string;
  /** 工具说明 —— 四要素齐备（何时用 / 何时不用 / 边界 / 错误），见附录 B。 */
  readonly description: string;
  /** 入参 schema（JSON Schema）。 */
  readonly inputSchema: JsonSchemaObject;
  /** 实现：把参数翻译成既有命令 / 服务调用，返回信封。 */
  readonly handler: ToolHandler;
  /** 本工具可能返回的错误码子集（必须 ⊆ 附录 A 总表）。 */
  readonly errors: readonly McpErrorCode[];
  /** 是否只读（只读工具可被客户端缓存、可并发调用）。 */
  readonly readOnly: boolean;
}

/** MCP 错误码（附录 A 总表的机器可读子集，本批只用到其中一部分）。 */
export type McpErrorCode =
  | 'invalid_arguments'
  | 'unknown_character'
  | 'character_unbound'
  | 'agent_not_installed'
  | 'character_offline'
  | 'chat_busy'
  | 'task_not_found'
  | 'task_not_cancellable'
  | 'task_capacity_exceeded'
  | 'mission_not_found'
  | 'mission_capacity_exceeded'
  | 'illegal_transition'
  | 'internal_error';

/**
 * 数据面端口（MCP 侧对 core 总线与状态的**唯一**依赖面）。
 *
 * why 是端口而不是直接 import core/store：工具语义与「状态从哪来、命令往哪投」解耦，
 * 单测可注入隔离的 store / dispatcher；生产实现见 context.ts（core 总线 + core store）。
 * 三个方法对应三条既有通路，**不新增任何状态通道**（docs/MCP-SPEC.md §3.1）。
 */
export interface McpHost {
  /** 只读：当前世界态快照（WorldState 投影）。 */
  readonly getWorldState: () => WorldState;
  /** 写：投递一条 HudCommand 到 core 总线（由 core runtime 裁决与落库）。 */
  readonly dispatchCommand: (command: HudCommand) => void;
  /** 只读：取任务输出**全文**（SQLite 投影）；取不到返回 null（此时回摘要）。 */
  readonly readTaskOutput?: (taskId: string) => Promise<string | null>;
}
