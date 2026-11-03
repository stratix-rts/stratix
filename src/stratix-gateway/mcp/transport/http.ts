/**
 * 文件职责：MCP 的 HTTP 传输 —— 把 JSON-RPC 帧映射到 POST /mcp（Streamable HTTP 的请求-响应形态）。
 * 输入：express 请求体（一帧 JSON-RPC）+ 一个 McpServer 实例。
 * 输出：HTTP 响应（JSON-RPC 帧；通知类请求回 202 空体）。
 * 禁止事项：
 *   1. 在这里做业务判断 —— 与 stdio 共用同一份 server.ts，本文件只做"收帧 → 交 server → 回帧"；
 *   2. 把错误处理成 HTTP 5xx —— 协议级失败也是 JSON-RPC 帧（HTTP 200 + error 对象），
 *      否则 client 只会看到一句"Internal Server Error"，丢掉错误码；
 *   3. 无上限地收 body —— 入参体量有界（工具参数都是短文本），body 上限收口在 1mb；
 *   4. 绑到 0.0.0.0 —— 工作台数据面只对本机开放（绑定由宿主 app 负责，本文件不碰监听地址）；
 *   5. 让 body 解析失败冒到宿主框架的错误处理器 —— 畸形 JSON 必须在本文件里读成
 *      JSON-RPC -32700 帧（id=null），绝不能变成宿主框架的裸 {"code":500}。
 *
 * why 本文件自带 body 解析器：宿主 app 也有一个全局 express.json()，但它**先**解析的话，
 * 畸形 JSON 会在到达本路由之前就抛错 → 跳过 /mcp 路由 → 落到 app 级错误处理器（裸 500）。
 * 故本路由必须挂在宿主全局解析器**之前**，由本文件自己解析并自己兜住解析错误
 * （docs/MCP-SPEC.md §4.4 传输层错误信封）。
 */

import { json, Router, type NextFunction, type Request, type Response } from 'express';

import { JSON_RPC_ERRORS, jsonRpcError, type McpServer } from '../server';

/** 请求体上限（1mb）—— 工具入参都是短文本，超大 body 一律拒。 */
const BODY_LIMIT = '1mb';

/** body 解析失败的类型标记（body-parser 的约定）。 */
const PARSE_FAILED = 'entity.parse.failed';
const PAYLOAD_TOO_LARGE = 'entity.too.large';

/** 异常的简要描述（只取 message，不带堆栈 —— 堆栈是服务端的事，不进协议帧）。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * body 解析错误 → JSON-RPC 错误码。
 * why 分三档：畸形 JSON 是 -32700（Parse error，帧都读不出来，id 只能为 null）；
 * body 超限是 -32600（Invalid Request，请求本身不合法）；其余一律 -32603。
 */
function mapBodyError(error: unknown): { code: number; message: string } {
  const type = (error as { type?: unknown } | null | undefined)?.type;
  if (type === PARSE_FAILED) {
    return { code: JSON_RPC_ERRORS.parseError, message: 'Parse error' };
  }
  if (type === PAYLOAD_TOO_LARGE) {
    return { code: JSON_RPC_ERRORS.invalidRequest, message: 'Invalid Request' };
  }
  return { code: JSON_RPC_ERRORS.internalError, message: 'Internal error' };
}

/**
 * 造一个挂载到 /mcp 的 express 路由。
 * 用法：app.use('/mcp', createMcpHttpRouter(server));
 *
 * 挂载约束（组合根必须遵守）：**挂在宿主 app 的全局 body 解析器之前** ——
 * 否则畸形 JSON 会被宿主先解析掉，错误就绕过了本文件（见文件头 why）。
 */
export function createMcpHttpRouter(server: McpServer): Router {
  const router = Router();
  router.use(json({ limit: BODY_LIMIT }));

  router.post('/', async (req: Request, res: Response) => {
    try {
      const response = await server.handlePayload(req.body);
      if (response === null) {
        // 通知类请求：按协议无响应体，回 202 表示已受理。
        res.status(202).end();
        return;
      }
      res.status(200).json(response);
    } catch (error) {
      // 兜底：协议层已把工具错误转成信封，走到这里说明是框架级意外 —— 仍以 JSON-RPC 帧回。
      // 绝不允许它冒到宿主 app 的错误处理器（那里只认裸 {"code":500}）。
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(200).json(
        jsonRpcError(null, JSON_RPC_ERRORS.internalError, 'Internal error', {
          detail: describeError(error),
        })
      );
    }
  });

  router.get('/', (_req: Request, res: Response) => {
    // 第一期不实现 SSE 推送流（MCP 是请求-响应模型，实时流靠轮询快照，见 §0.3）。
    res.status(405).json(
      jsonRpcError(
        null,
        JSON_RPC_ERRORS.invalidRequest,
        'MCP 端点只接受 POST（JSON-RPC 帧）；第一期不提供 SSE 推送端点'
      )
    );
  });

  // 传输层最后一道网：body 解析失败（畸形 JSON / 超限）或任何漏网的异常 → 一律 JSON-RPC 帧。
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const mapped = mapBodyError(error);
    res.status(200).json(jsonRpcError(null, mapped.code, mapped.message, {
      detail: describeError(error),
    }));
  });

  return router;
}
