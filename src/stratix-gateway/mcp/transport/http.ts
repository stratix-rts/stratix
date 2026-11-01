/**
 * 文件职责：MCP 的 HTTP 传输 —— 把 JSON-RPC 帧映射到 POST /mcp（Streamable HTTP 的请求-响应形态）。
 * 输入：express 请求体（一帧 JSON-RPC）+ 一个 McpServer 实例。
 * 输出：HTTP 响应（JSON-RPC 帧；通知类请求回 202 空体）。
 * 禁止事项：
 *   1. 在这里做业务判断 —— 与 stdio 共用同一份 server.ts，本文件只做"收帧 → 交 server → 回帧"；
 *   2. 把错误处理成 HTTP 5xx —— 协议级失败也是 JSON-RPC 帧（HTTP 200 + error 对象），
 *      否则 client 只会看到一句"Internal Server Error"，丢掉错误码；
 *   3. 无上限地收 body —— 入参体量有界（工具参数都是短文本），body 上限收口在 1mb；
 *   4. 绑到 0.0.0.0 —— 工作台数据面只对本机开放（绑定由宿主 app 负责，本文件不碰监听地址）。
 */

import { json, Router, type Request, type Response } from 'express';

import type { McpServer } from '../server';

/** 请求体上限（1mb）—— 工具入参都是短文本，超大 body 一律拒。 */
const BODY_LIMIT = '1mb';

/**
 * 造一个挂载到 /mcp 的 express 路由。
 * 用法：app.use('/mcp', createMcpHttpRouter(server));
 */
export function createMcpHttpRouter(server: McpServer): Router {
  const router = Router();
  router.use(json({ limit: BODY_LIMIT }));

  router.post('/', async (req: Request, res: Response) => {
    let response;
    try {
      response = await server.handlePayload(req.body);
    } catch (error) {
      // 兜底：协议层已把工具错误转成信封，走到这里说明是框架级意外 —— 仍以 JSON-RPC 帧回。
      res.status(200).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
      return;
    }

    if (response === null) {
      // 通知类请求：按协议无响应体，回 202 表示已受理。
      res.status(202).end();
      return;
    }
    res.status(200).json(response);
  });

  router.get('/', (_req: Request, res: Response) => {
    // 第一期不实现 SSE 推送流（MCP 是请求-响应模型，实时流靠轮询快照，见 §0.3）。
    res.status(405).json({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32600,
        message: 'MCP 端点只接受 POST（JSON-RPC 帧）；第一期不提供 SSE 推送端点',
      },
    });
  });

  return router;
}
