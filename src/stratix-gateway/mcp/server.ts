/**
 * 文件职责：MCP server 实例装配（协议层）—— JSON-RPC 2.0 的方法分发与工具调用路由。
 * 输入：JSON-RPC 请求帧（stdio 与 HTTP 两种传输喂进来的是同一份帧）。
 * 输出：JSON-RPC 响应帧（成功 result / 协议级 error）或 null（通知类请求不回包）。
 * 禁止事项：
 *   1. 引入 MCP SDK 或任何 npm 依赖 —— 协议面手写实现（零新增依赖是本批验收项）；
 *   2. 在协议层做业务判断 —— 业务失败一律走信封 + isError，协议层只管"帧对不对、方法在不在"；
 *   3. 吞掉未知方法 —— 未知方法回 -32601（静默忽略会让 client 一直等一个不会来的响应）；
 *   4. 让传输层各写一套分发 —— stdio 与 HTTP 必须共用本文件（§4.4：stdio 跑通的行为 HTTP 必须一样）；
 *   5. 在本文件里拉数据面依赖 —— 协议层不认识 core / SQLite，状态从哪来由组合根注入；
 *   6. 把未捕获异常包成 internal_error 信封 —— 崩溃不是业务失败：未捕获异常一律回
 *      JSON-RPC -32603（业务失败只有工具主动抛的 McpToolError 才算数）。
 */

import { McpToolError, toToolResult } from './envelope';
import { buildToolRegistry, type ToolRegistry } from './registry';
import { characterCreateTool, characterDeleteTool, characterEditTool } from './tools/character';
import { chatSendTool } from './tools/chat';
import { missionCreateTool, missionCancelTool, missionCheckpointTool, missionConfirmTool, missionStatusTool } from './tools/mission';
import { registryTool } from './tools/registry';
import { sessionGetTool, sessionInterruptTool, sessionListTool, sessionResumeTool, sessionForkTool } from './tools/session';
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
  /** 工具注册表；缺省 = 全套十九件工具（按清单位次注册）。 */
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
 * 工具面（十九件，按**清单位次**注册 —— tools/list 的返回序与之一致）。
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
  missionConfirmTool, //   §2.14（mission 域写面：放行一条待确认的编组任务）
  missionCancelTool, //    §2.15（mission 域写面：撤掉一条没开工的编组任务）
  chatSendTool, //         §2.7
  registryTool, //         §2.8
  sessionListTool, //      §2.10（session 域新开，排在既有九件之后）
  sessionGetTool, //       §2.11
  sessionInterruptTool, //  §2.12（session 域写面：中断一条在办会话）
  sessionResumeTool, //     §2.13（session 域写面：恢复一条被中断的互聊会话 = 续跑）
  sessionForkTool, //       （session 域写面：从某条事件处分叉出一条新会话 —— 实现已上线，规范条目待补）
  characterCreateTool, //  §2.16（character 域新开：名册供给 —— 建档即上场）
  characterDeleteTool, // §2.17（character 域写面：名册清理 —— 删除角色，usage 中角色即消失）
  characterEditTool, //   §2.18（character 域写面：名册维护 —— 改名 / 改人设 / 切上下文开关）
];

function success(id: JsonRpcId, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

/**
 * JSON-RPC error 帧（协议级失败的标准形状）。
 * why 导出：传输层与宿主装配点也要吐同一形状的帧 —— MCP 端点上**任何**失败都必须长成
 * JSON-RPC error，绝不能漏出宿主框架自己的裸错误体（docs/MCP-SPEC.md §4.4 传输层错误信封）。
 */
export function jsonRpcError(
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

/**
 * 畸形 JSON 的错误帧 —— stdio 与 HTTP 共用同一份语义（code 一致、data 形状一致）。
 * why message 按来源分两种说法：stdio 收到的是"一行"，HTTP 收到的是"一个请求体" ——
 * 说清"是哪段文本不合法"比统一一句"解析失败"更有用（task_132 / N3）。
 */
export function jsonRpcParseError(source: 'body' | 'line', detail: string): JsonRpcResponse {
  return jsonRpcError(
    null,
    JSON_RPC_ERRORS.parseError,
    source === 'body' ? '请求体不是合法 JSON（解析失败）' : '输入行不是合法 JSON（解析失败）',
    {
      detail,
      hint:
        source === 'body'
          ? '把完整的一帧 JSON-RPC 发过来（请求体可能被截断，或引号/逗号多了一个）'
          : 'stdin 一行一帧：每行必须是完整的一帧 JSON',
    }
  );
}

/** 收到的 JSON 值的类型名（给 agent 看的白话词表）。 */
function describeJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** 非法帧的判读结果：为什么这不是一帧合法的 JSON-RPC 2.0 请求。 */
interface InvalidFrame {
  /** 面向人的一句话：什么错了 + 为什么。 */
  readonly message: string;
  /** 机器可读的细节：收到的是什么 / 错在哪 / 怎么改。 */
  readonly data: {
    readonly received: string;
    readonly reason: string;
    readonly hint: string;
  };
}

/**
 * 判读一帧到底哪里不合法（task_132 / N3）。
 *
 * why 不再只回一句"帧不是合法的 JSON-RPC 2.0 请求"：
 *   - 空 body 与"JSON 数组"都被压成 received:"object"，agent 拿到的信息是**假的**
 *     （它会以为收到的是一个对象帧），排障方向直接被带偏；
 *   - 分型不变（仍走 -32600 Invalid Request），只把"为什么"说准。
 *
 * 返回 null = 这是一帧合法请求。
 */
function describeInvalidRequest(payload: unknown): InvalidFrame | null {
  if (payload === undefined || payload === null) {
    return {
      message: '请求体是空的，不是 JSON-RPC 2.0 请求帧',
      data: {
        received: payload === null ? 'null' : 'empty',
        reason: '没有请求体',
        hint: 'POST 一帧完整的 JSON-RPC 2.0 请求（jsonrpc / method / id）',
      },
    };
  }
  if (Array.isArray(payload)) {
    return {
      message: '请求体是一个 JSON 数组，不是 JSON-RPC 2.0 请求帧',
      data: {
        received: 'array',
        reason: '一帧 = 一个 JSON 对象；本端点不接批量请求（JSON-RPC 2.0 的批量形态）',
        hint: '把数组里的那一帧单独发出来（一次一帧）',
      },
    };
  }
  if (typeof payload !== 'object') {
    return {
      message: `请求体不是 JSON-RPC 2.0 请求帧（收到 ${describeJsonType(payload)}）`,
      data: {
        received: describeJsonType(payload),
        reason: '请求帧必须是 JSON 对象',
        hint: '一帧的形状：{"jsonrpc":"2.0","method":"...","id":1}',
      },
    };
  }

  const candidate = payload as Partial<JsonRpcRequest>;
  if (candidate.jsonrpc !== '2.0') {
    const missing = candidate.jsonrpc === undefined;
    return {
      message: missing
        ? '请求帧缺 jsonrpc 字段（JSON-RPC 2.0 要求 "jsonrpc": "2.0"）'
        : `请求帧的 jsonrpc 字段必须是 "2.0"（本次收到 ${JSON.stringify(candidate.jsonrpc)}）`,
      data: {
        received: 'object',
        reason: missing ? '缺 jsonrpc 字段' : 'jsonrpc 字段不是 "2.0"',
        hint: '把 jsonrpc 改成 "2.0"（协议版本号固定是这个字符串）',
      },
    };
  }
  if (typeof candidate.method !== 'string') {
    const missing = candidate.method === undefined;
    return {
      message: missing
        ? '请求帧缺 method 字段（JSON-RPC 2.0 要求 method 是方法名字符串）'
        : `请求帧的 method 字段必须是方法名字符串（本次收到 ${describeJsonType(candidate.method)}）`,
      data: {
        received: 'object',
        reason: missing ? '缺 method 字段' : 'method 字段不是字符串',
        hint: '填一个方法名：initialize / ping / tools/list / tools/call',
      },
    };
  }
  if (candidate.id !== undefined && candidate.id !== null) {
    const idType = typeof candidate.id;
    if (idType !== 'string' && idType !== 'number') {
      return {
        message: `请求帧的 id 字段类型非法（只允许 string / number / null，本次收到 ${describeJsonType(candidate.id)}）`,
        data: {
          received: 'object',
          reason: 'id 字段类型非法',
          hint: 'id 用字符串或数字；通知类请求（不期待回包）不带 id',
        },
      };
    }
  }
  return null;
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
            : jsonRpcError(id, JSON_RPC_ERRORS.invalidParams, 'tools/call 缺少工具名', {
                hint: 'params.name 传工具名字符串；用 tools/list 查当前可用的工具名',
              });
        }
        const tool = registry.getTool(params.name);
        if (!tool) {
          // 工具名不存在 = 参数级错误 → JSON-RPC error（不进 isError 信封）。
          return isNotification
            ? null
            : jsonRpcError(id, JSON_RPC_ERRORS.invalidParams, `未知工具「${params.name}」`, {
                hint: `用 tools/list 查当前可用的工具名（注册表 ${registry.size} 件）`,
              });
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
          // 未捕获异常（工具没主动抛 McpToolError 的那种崩溃）→ 协议层 -32603。
          // why 不套 internal_error 信封：那个码是工具**主动判定**的内部失败（端口未接、
          // 命令没人接管）；把崩溃也报成它，等于把"没跑起来"说成"业务上拒绝"，
          // agent 会照着业务语义去重试/改参数，而不是查服务端日志（docs/MCP-SPEC.md §4.4）。
          if (isNotification) return null;
          const message = error instanceof Error ? error.message : String(error);
          return jsonRpcError(id, JSON_RPC_ERRORS.internalError, 'Internal error', {
            detail: message,
            hint: '这是服务端崩溃（不是业务拒绝）：查 gateway 进程日志确认原因，别改参数重试',
          });
        }
      }
      default:
        return isNotification
          ? null
          : jsonRpcError(id, JSON_RPC_ERRORS.methodNotFound, `未知方法「${request.method}」`, {
              hint: '本端点支持的方法：initialize / ping / tools/list / tools/call（通知类：notifications/initialized / notifications/cancelled）',
            });
    }
  };

  const handlePayload = async (payload: unknown): Promise<JsonRpcResponse | null> => {
    const invalid = describeInvalidRequest(payload);
    if (invalid) {
      return jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, invalid.message, invalid.data);
    }
    return handleRequest(payload as JsonRpcRequest);
  };

  return {
    handlePayload,
    handleLine: async (line: string): Promise<string | null> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        return JSON.stringify(
          jsonRpcParseError(
            'line',
            `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
          )
        );
      }
      const response = await handlePayload(parsed);
      return response === null ? null : JSON.stringify(response);
    },
  };
}

/**
 * 装配默认 server（十九件工具 + 调用方给的数据面端口）。
 * host 由组合根注入（生产 = context.ts 的 createCoreMcpHost；单测 = 隔离的 store / dispatcher）。
 */
export function createDefaultMcpServer(host: McpHost): McpServer {
  return createMcpServer({ host, registry: buildToolRegistry(DEFAULT_MCP_TOOLS) });
}
