/**
 * 文件职责：MCP 的 HTTP 传输 —— 把 JSON-RPC 帧映射到 POST /mcp（Streamable HTTP 的请求-响应形态）。
 * 输入：express 请求（原始字节 + 头）+ 一个 McpServer 实例。
 * 输出：HTTP 响应（JSON-RPC 帧；通知类请求回 202 空体）。
 * 禁止事项：
 *   1. 在这里做业务判断 —— 与 stdio 共用同一份 server.ts，本文件只做"收帧 → 交 server → 回帧"；
 *   2. 把错误处理成 HTTP 5xx —— 协议级失败也是 JSON-RPC 帧（HTTP 200 + error 对象），
 *      否则 client 只会看到一句"Internal Server Error"，丢掉错误码；
 *   3. 无上限地收 body —— 入参体量有界（工具参数都是短文本），body 上限收口在 1mb；
 *   4. 绑到 0.0.0.0 —— 工作台数据面只对本机开放（绑定由宿主 app 负责，本文件不碰监听地址）；
 *   5. 让 body 读取失败冒到宿主框架的错误处理器 —— 读 body 失败必须在本文件里读成
 *      JSON-RPC 帧（id=null），绝不能变成宿主框架的裸 {"code":500}；
 *   6. 把"被拒的原因"说成别的原因（task_132 / N3）—— 文案必须与**真实触发条件**一一对应：
 *      Content-Type 不对就说 Content-Type，不说"帧不合法"；body 是空的就说"body 是空的"，
 *      不说"收到一个 object"。说错的文案会把 agent 的排障方向带偏。
 *
 * why 本文件自带 body 解析器：宿主 app 也有一个全局 express.json()，但它**先**解析的话，
 * 畸形 JSON 会在到达本路由之前就抛错 → 跳过 /mcp 路由 → 落到 app 级错误处理器（裸 500）。
 * 故本路由必须挂在宿主全局解析器**之前**，由本文件自己解析并自己兜住解析错误
 * （docs/MCP-SPEC.md §4.4 传输层错误信封）。
 *
 * why 收**原始字节**而不是直接用 express.json()：只有拿到原始字节，才能分清三种被拒的原因 ——
 * "请求体是空的" / "Content-Type 不对（body 压根没被当 JSON 读）" / "body 是 JSON 数组"。
 * express.json() 会把这三种统统压成同一个空对象，于是错误文案只能说"帧不是合法的
 * JSON-RPC 请求"—— 而帧其实是对的（task_132 / N3 的复测证据）。
 */

import { raw, Router, type NextFunction, type Request, type Response } from 'express';

import { JSON_RPC_ERRORS, jsonRpcError, jsonRpcParseError, type McpServer } from '../server';

/** 请求体上限（1mb）—— 工具入参都是短文本，超大 body 一律拒。 */
const BODY_LIMIT = '1mb';

/** 本端点只收 JSON 帧 —— Content-Type 必须是这一族。 */
const EXPECTED_CONTENT_TYPE = 'application/json';

/**
 * Accept 头是否接受得下我们回的帧（本端点只回 JSON，不推 SSE）。
 * why 缺 Accept 时不拦：简单客户端（curl / 脚本）常省这个头，拦它只会误伤。
 * why 显式点名了别的类型才拦：`Accept: text/plain` 说明调用方**要的不是 JSON**，
 * 回一帧 JSON 给它等于没听见 —— 这时要说清"本端点只回 JSON"，而不是让它对着
 * 一帧看不懂的 JSON 干瞪眼（task_132 / N3 的同款毛病：拒了要说清为什么被拒）。
 */
function acceptsJsonFrame(header: string | undefined): boolean {
  if (!header) return true;
  const types = header.split(',').map((part) => (part.split(';')[0] ?? '').trim().toLowerCase());
  return types.some(
    (type) =>
      type === 'application/json' || type === '*/*' || type === 'application/*'
  );
}

/** body 读取失败的类型标记（body-parser 的约定）。 */
const PAYLOAD_TOO_LARGE = 'entity.too.large';
const ENCODING_UNSUPPORTED = 'encoding.unsupported';

/** 异常的简要描述（只取 message，不带堆栈 —— 堆栈是服务端的事，不进协议帧）。 */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Content-Type 的媒体类型部分（小写、去掉参数）；缺头 → null。 */
function mediaTypeOf(header: string | undefined): string | null {
  if (!header) return null;
  const media = (header.split(';')[0] ?? '').trim().toLowerCase();
  return media.length > 0 ? media : null;
}

/** Content-Type 的 charset 参数（缺省 utf-8）。 */
function charsetOf(header: string | undefined): string {
  const matched = header ? /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(header) : null;
  return matched ? (matched[1] ?? '').trim().toLowerCase() : 'utf-8';
}

/**
 * 顶层必须是 JSON 对象或数组（**strict 口径**，与 body-parser 的 json() 一致）。
 * why 保留 strict：裸标量（`123` / `"x"` / `true`）在原实现里走的是 **-32700 解析失败**，
 * 不是 -32600 帧不合法 —— 改口径等于改了错误码分型（task_118 的分型不许动）。
 * why 单独一个分支而不是一句"解析失败"：裸标量**是**合法 JSON，只是顶层形状不对 ——
 * 文案说"不是合法 JSON"就是把事实说反了（task_132 / N3 的同款毛病）。
 */
function isJsonContainer(value: unknown): boolean {
  return typeof value === 'object' && value !== null;
}

/**
 * body 读取失败 → JSON-RPC 错误码。
 * why 分档：body 超限是调用方的问题（-32600，请求本身不合法）；其余一律 -32603。
 * 分型与 task_118 一致，本任务只改文案不改分型。
 */
function mapBodyError(error: unknown): { code: number; message: string; hint: string } {
  const type = (error as { type?: unknown } | null | undefined)?.type;
  if (type === PAYLOAD_TOO_LARGE) {
    return {
      code: JSON_RPC_ERRORS.invalidRequest,
      message: `请求体超过 ${BODY_LIMIT} 上限`,
      hint: '把请求体拆小后重发（一帧 JSON-RPC 只带一帧请求）',
    };
  }
  if (type === ENCODING_UNSUPPORTED) {
    return {
      code: JSON_RPC_ERRORS.internalError,
      message: '请求体的 Content-Encoding 不受支持',
      hint: '去掉 Content-Encoding 头，或改成 identity / gzip',
    };
  }
  return {
    code: JSON_RPC_ERRORS.internalError,
    message: 'Internal error',
    hint: '查服务端日志确认传输层异常；同样的请求重发一次多半还是失败',
  };
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
  // 收原始字节（不限 content-type —— content-type 由本文件自己判并给出准确文案）。
  router.use(raw({ limit: BODY_LIMIT, type: () => true }));

  router.post('/', async (req: Request, res: Response) => {
    try {
      const bodyText = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';

      // ① 请求体为空 —— 没有帧可言，说"空"而不是"帧不合法"。
      if (bodyText.trim().length === 0) {
        res.status(200).json(
          jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, '请求体为空：没有可解析的 JSON-RPC 帧', {
            received: 'empty',
            hint: 'POST 一帧完整的 JSON-RPC 2.0 请求体，并把 Content-Type 设成 application/json',
          })
        );
        return;
      }

      // ② Content-Type —— 本端点只收 application/json。**帧本身可能是合法的**，
      //    拒的是"这帧没被当 JSON 读"，所以必须说清是 Content-Type 的问题（task_132 / N3）。
      const contentType = req.headers['content-type'];
      const mediaType = mediaTypeOf(contentType);
      if (mediaType !== EXPECTED_CONTENT_TYPE) {
        res.status(200).json(
          jsonRpcError(
            null,
            JSON_RPC_ERRORS.invalidRequest,
            mediaType === null
              ? '请求缺少 Content-Type 头（本端点只收 application/json）'
              : `请求的 Content-Type 应为 ${EXPECTED_CONTENT_TYPE}（本次收到 ${mediaType}）`,
            {
              expected_content_type: EXPECTED_CONTENT_TYPE,
              received_content_type: mediaType,
              hint: '把请求头改成 Content-Type: application/json 后重发同一帧',
            }
          )
        );
        return;
      }

      // ③ Accept —— 本端点只回 JSON 帧。显式点名了别的类型就说清"只回 JSON"，
      //    缺 Accept 不拦（简单客户端常省这个头）。
      const acceptHeader = req.headers.accept;
      if (!acceptsJsonFrame(acceptHeader)) {
        res.status(200).json(
          jsonRpcError(null, JSON_RPC_ERRORS.invalidRequest, '请求的 Accept 头未包含 application/json（本端点只回 JSON 帧）', {
            expected_accept: 'application/json',
            received_accept: acceptHeader ?? null,
            hint: '把 Accept 改成 application/json（或 application/json, text/event-stream）后重发',
          })
        );
        return;
      }

      // ④ 字符集 —— JSON 报文按 UTF-8 解析（与 body-parser 的 charset 口径一致：
      //    只有显式声明成非 utf-* 才拒；缺省按 utf-8 走）。
      const charset = charsetOf(contentType);
      if (charset.slice(0, 4) !== 'utf-') {
        res.status(200).json(
          jsonRpcError(null, JSON_RPC_ERRORS.internalError, '请求体声明的字符集不受支持（JSON 报文按 UTF-8 解析）', {
            detail: `unsupported charset "${charset}"`,
            received_charset: charset,
            hint: '把 Content-Type 的 charset 改成 utf-8，或直接去掉 charset 参数',
          })
        );
        return;
      }

      // ⑤ 解析 JSON —— 畸形/截断的报文一律 -32700（id=null）。
      let parsed: unknown;
      try {
        parsed = JSON.parse(bodyText);
      } catch (error) {
        res.status(200).json(
          jsonRpcParseError('body', `JSON 解析失败：${describeError(error)}`)
        );
        return;
      }
      // ⑤b strict 口径：顶层必须是对象或数组。裸标量（`123` / `"x"` / `true` / `null`）**是**合法 JSON，
      //     只是顶层形状不对 —— 文案与"畸形 JSON"分开说（错误码与原实现一致，分型不变）。
      if (!isJsonContainer(parsed)) {
        res.status(200).json(
          jsonRpcError(null, JSON_RPC_ERRORS.parseError, '严格解析失败：请求体顶层必须是 JSON 对象或数组（本次是裸标量）', {
            detail: `请求体顶层必须是 JSON 对象或数组（本次收到 ${parsed === null ? 'null' : typeof parsed}）`,
            hint: '发一帧 JSON-RPC 请求对象（{"jsonrpc":"2.0","method":"...","id":1}），不要发裸标量',
          })
        );
        return;
      }

      // ⑥ 交给协议层（帧合不合法、方法在不在、工具在不在 —— 都是 server.ts 的事）。
      const response = await server.handlePayload(parsed);
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
          hint: '这是服务端崩溃（不是业务拒绝）：查 gateway 进程日志确认原因，别改参数重试',
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
        'MCP 端点只接受 POST（JSON-RPC 帧）；第一期不提供 SSE 推送端点',
        { hint: '用 POST 把一帧 JSON-RPC 2.0 请求发过来（Content-Type: application/json）' }
      )
    );
  });

  // 传输层最后一道网：body 读取失败（超限 / 编码不支持）或任何漏网的异常 → 一律 JSON-RPC 帧。
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const mapped = mapBodyError(error);
    res.status(200).json(jsonRpcError(null, mapped.code, mapped.message, {
      detail: describeError(error),
      hint: mapped.hint,
    }));
  });

  return router;
}
