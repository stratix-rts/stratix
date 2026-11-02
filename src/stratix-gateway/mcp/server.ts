/**
 * 文件职责：MCP server 实例装配（协议层）—— JSON-RPC 2.0 的方法分发与工具调用路由。
 * 输入：JSON-RPC 请求帧（stdio 与 HTTP 两种传输喂进来的是同一份帧）。
 * 输出：JSON-RPC 响应帧（成功 result / 协议级 error）或 null（通知类请求不回包）。
 * 禁止事项：
 *   1. 引入 MCP SDK 或任何 npm 依赖 —— 协议面手写实现（零新增依赖是本批验收项）；
 *   2. 在协议层做业务判断 —— 业务失败一律走信封 + isError，协议层只管"帧对不对、方法在不在"；
 *   3. 吞掉未知方法 —— 未知方法回 -32601（静默忽略会让 client 一直等一个不会来的响应）；
 *   4. 让传输层各写一套分发 —— stdio 与 HTTP 必须共用本文件（§4.4：stdio 跑通的行为 HTTP 必须一样）；
 *   5. 在本文件里拉数据面依赖 —— 协议层不认识 core / SQLite，状态从哪来由组合根注入。
 */

import { McpToolError, fail, toToolResult } from './envelope';
import { buildToolRegistry, type ToolRegistry } from './registry';
import { chatSendTool } from './tools/chat';
import { missionCreateTool, missionCheckpointTool, missionStatusTool } from './tools/mission';
import { registryTool } from './tools/registry';
import { sessionGetTool, sessionListTool } from './tools/session';
import { taskAssignTool, taskCancelTool, taskStatusTool } from './tools/task';
import { worldSnapshotTool } from './tools/world';
import type {
  JsonRpcId,
  JsonRpcRequest,
  JsonRpcResponse,
  McpHost,
  ToolSpec,
} from './types';

/** 协议版本（与 MCP 2024-11-05 握手一致；第一期只做 initialize + tools/list + tools/call）。 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';
export const MCP_SERVER_NAME = 'stratix';
export const MCP_SERVER_VERSION = '0.1.0';

/** JSON-RPC 2.0 标准错误码。 */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export interface McpServerOptions {
  /** 数据面端口（读世界态 / 投命令 / 读全文输出 / 读会话 / 跑一轮对话）。 */
  readonly host: McpHost;
  /** 工具注册表；缺省 = 全套十一件工具（按清单位次注册）。 */
  readonly registry?: ToolRegistry;
  /** serverInfo（握手应答里回给 client）。 */
  readonly serverInfo?: { readonly name: string; readonly version: string };
}

export interface McpServer {
  /** 处理一帧（已解析的 JSON）。返回 null = 通知类请求，按协议不回包。 */
  handlePayload(payload: unknown): Promise<JsonRpcResponse | null>;
  /** 供传输层复用的便捷入口：吃原始文本，吐原始文本（null = 不回包）。 */
  handleLine(line: string): Promise<string | null>;
}

/**
 * 工具面（十一件，按**清单位次**注册 —— tools/list 的返回序与之一致）。
 *
 * why 注册序 = 清单序：tools/list 的顺序是**客户端提示词缓存**的一部分，抖动会让缓存失效。
 * 顺序写在每件工具自己的 `order` 字段里（= 工具在清单里的位次），注册表按它排序；
 * 这样顺序是工具的**数据**，而不是「谁在哪个文件里先写的」这种随时会被人挪动的偶然。
 *
 * 位次按**域聚拢**（mission 域的工具挨在一起）；它与规范文档的条目号（§2.x）不再逐一对应 ——
 * 文档条目号按「只加不删」递增（新条目永远追加在末尾），清单位次按域聚拢，两者是两套编号。
 */
export const DEFAULT_MCP_TOOLS: readonly ToolSpec[] = [
  worldSnapshotTool, //    §2.1
  taskAssignTool, //       §2.2
  taskStatusTool, //       §2.3
  taskCancelTool, //       §2.4
  missionCreateTool, //    §2.5
  missionStatusTool, //    §2.6
  missionCheckpointTool, // §2.9（位次插在 mission 域内）
  chatSendTool, //         §2.7
  registryTool, //         §2.8
  sessionListTool, //      §2.10（session 域新开，排在既有九件之后）
  sessionGetTool, //       §2.11
];

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function failure(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** 判断一帧是不是合法的 JSON-RPC 请求。 */
function isRequest(payload: unknown): payload is JsonRpcRequest {
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as Partial<JsonRpcRequest>;
  if (candidate.jsonrpc !== '2.0') return false;
  if (typeof candidate.method !== 'string') return false;
  if (candidate.id !== undefined && candidate.id !== null) {
    const idType = typeof candidate.id;
    if (idType !== 'string' && idType !== 'number') return false;
  }
  return true;
}

/**
 * 装配一个 MCP server。
 * 传输层（stdio / HTTP）只负责收发帧，工具语义与分发逻辑都在这里 —— 两种模式行为必须一致。
 */
export function createMcpServer(options: McpServerOptions): McpServer {
  const registry = options.registry ?? buildToolRegistry(DEFAULT_MCP_TOOLS);
  const serverInfo = options.serverInfo ?? { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION };

  const listTools = (): {
    tools: Array<{ name: string; description: string; inputSchema: unknown }>;
  } => ({
    tools: registry.listTools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  });

  const handleRequest = async (request: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const id: JsonRpcId = request.id ?? null;
    // 通知（无 id）按协议不回包 —— 但动作照做（tools/call 的通知仍会真的派单）。
    const isNotification = request.id === undefined;
    const respond = (result: unknown): JsonRpcResponse | null =>
      isNotification ? null : success(id, result);

    switch (request.method) {
      case 'initialize':
        return respond({
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: { listChanged: false } },
          serverInfo,
        });
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return respond({});
      case 'tools/list':
        return respond(listTools());
      case 'tools/call': {
        const params = (request.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof params.name !== 'string' || params.name.length === 0) {
          return isNotification
            ? null
            : failure(id, JSON_RPC_ERRORS.invalidParams, 'tools/call 缺少工具名');
        }
        const tool = registry.getTool(params.name);
        if (!tool) {
          // 工具名不存在 = 参数级错误 → JSON-RPC error（不进 isError 信封）。
          return isNotification
            ? null
            : failure(id, JSON_RPC_ERRORS.invalidParams, `未知工具「${params.name}」`);
        }
        const toolArgs =
          typeof params.arguments === 'object' &&
          params.arguments !== null &&
          !Array.isArray(params.arguments)
            ? (params.arguments as Readonly<Record<string, unknown>>)
            : {};
        try {
          const result = await tool.handler(toolArgs, options.host);
          return respond(result);
        } catch (error) {
          if (error instanceof McpToolError) {
            // 工具层失败 = 业务失败：走信封 + isError（不进 JSON-RPC error 层）。
            return respond(toToolResult(error.toEnvelope()));
          }
          const message = error instanceof Error ? error.message : String(error);
          return respond(toToolResult(fail('internal_error', message)));
        }
      }
      default:
        return isNotification
          ? null
          : failure(id, JSON_RPC_ERRORS.methodNotFound, `未知方法「${request.method}」`);
    }
  };

  const handlePayload = async (payload: unknown): Promise<JsonRpcResponse | null> => {
    if (!isRequest(payload)) {
      return failure(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        '请求帧不是合法的 JSON-RPC 2.0 请求',
        { received: typeof payload }
      );
    }
    return handleRequest(payload);
  };

  return {
    handlePayload,
    handleLine: async (line: string): Promise<string | null> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        return JSON.stringify(
          failure(null, JSON_RPC_ERRORS.parseError, 'JSON 解析失败', {
            detail: error instanceof Error ? error.message : String(error),
          })
        );
      }
      const response = await handlePayload(parsed);
      return response === null ? null : JSON.stringify(response);
    },
  };
}

/**
 * 装配默认 server（十一件工具 + 调用方给的数据面端口）。
 * host 由组合根注入（生产 = context.ts 的 createCoreMcpHost；单测 = 隔离的 store / dispatcher）。
 */
export function createDefaultMcpServer(host: McpHost): McpServer {
  return createMcpServer({ host, registry: buildToolRegistry(DEFAULT_MCP_TOOLS) });
}
