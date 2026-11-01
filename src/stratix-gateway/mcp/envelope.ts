/**
 * 文件职责：返回信封与错误码 —— docs/MCP-SPEC.md 附录 A 的**唯一实现处**。
 * 输入：工具 handler 的返回值（数据载荷）或一次失败（错误码 + 可选覆盖文案）。
 * 输出：统一信封（成功 ok=true / 失败 ok=false + error 四元组）与 MCP 工具结果（isError 标注）。
 * 禁止事项：
 *   1. 新增附录 A 总表以外的错误码 —— 新码须先改规范（§5.4 维护责任：实现与规范同 PR）；
 *   2. 在这里塞业务判断 —— 本文件只管信封形状与错误码元数据（message / retryable / hint）；
 *   3. 把堆栈或内部 id 写进 message —— message 是面向人的一句话，hint 才是面向模型的下一步；
 *   4. 在信封里放裸成功（{ ok: true }）—— 写操作必须带受理回执（标识 + 状态 + 查法）。
 */

import type { McpErrorCode, ToolCallResult } from './types';

/** 失败信封里的错误四元组（附录 A）。 */
export interface McpErrorPayload {
  /** 机器可读错误码（附录 A 总表）。 */
  readonly code: McpErrorCode;
  /** 面向人的一句话（可直接转述给用户）。 */
  readonly message: string;
  /** 同样的输入重试是否可能成功。 */
  readonly retryable: boolean;
  /** 面向模型的下一步（该调什么 / 改什么 / 等什么）。 */
  readonly hint: string;
}

export interface McpSuccessEnvelope<T = unknown> {
  readonly ok: true;
  readonly data: T;
}

export interface McpFailureEnvelope {
  readonly ok: false;
  readonly error: McpErrorPayload;
}

export type McpEnvelope<T = unknown> = McpSuccessEnvelope<T> | McpFailureEnvelope;

/**
 * 错误码元数据表（附录 A 总表的代码侧镜像）。
 * message 是默认文案（工具可按上下文覆盖），hint 是默认的下一步建议。
 */
export const MCP_ERROR_CATALOG: Readonly<Record<McpErrorCode, Omit<McpErrorPayload, 'code'>>> = {
  invalid_arguments: {
    message: '入参不满足工具的约束',
    retryable: false,
    hint: '按工具 description 里的边界改参数后重试',
  },
  unknown_character: {
    message: '未找到该角色的档案',
    retryable: false,
    hint: '用 stratix_registry 查可用的角色 id',
  },
  character_unbound: {
    message: '该角色未绑定 CLI agent',
    retryable: false,
    hint: '先在角色档案里绑定 agent，再派单',
  },
  agent_not_installed: {
    message: '该角色绑定的 CLI 未被检出',
    retryable: false,
    hint: '安装该 CLI 或换一个已装好的角色',
  },
  character_offline: {
    message: '该角色当前离线',
    retryable: true,
    hint: '等 CLI 恢复在线后重试，或换一位在线角色',
  },
  chat_busy: {
    message: '该角色已有对话轮次在跑',
    retryable: true,
    hint: '等这一轮结束后再发',
  },
  task_not_found: {
    message: '任务不存在',
    retryable: false,
    hint: '用 stratix_world_snapshot 确认任务 id',
  },
  task_not_cancellable: {
    message: '任务不在排队相位，无法取消',
    retryable: false,
    hint: '先查 stratix_task_status 看当前相位',
  },
  task_capacity_exceeded: {
    message: '任务队列已满',
    retryable: true,
    hint: '等在办任务收尾后重试',
  },
  mission_not_found: {
    message: '编组任务不存在',
    retryable: false,
    hint: '用 stratix_world_snapshot 确认 mission id',
  },
  mission_capacity_exceeded: {
    message: '编组任务数已满',
    retryable: true,
    hint: '等在办编组任务收尾后重试',
  },
  illegal_transition: {
    message: '状态机拒绝该迁移',
    retryable: false,
    hint: '先查当前相位，再决定下一步动作',
  },
  internal_error: {
    message: '内部异常',
    retryable: true,
    hint: '稍后重试；若持续失败请查服务端日志',
  },
};

/** 成功信封。 */
export function ok<T>(data: T): McpSuccessEnvelope<T> {
  return { ok: true, data };
}

/**
 * 失败信封。message / hint / retryable 可覆盖默认值（覆盖时必须仍取自附录 A 的语义）。
 */
export function fail(
  code: McpErrorCode,
  message?: string,
  overrides?: { readonly retryable?: boolean; readonly hint?: string }
): McpFailureEnvelope {
  const base = MCP_ERROR_CATALOG[code];
  return {
    ok: false,
    error: {
      code,
      message: message ?? base.message,
      retryable: overrides?.retryable ?? base.retryable,
      hint: overrides?.hint ?? base.hint,
    },
  };
}

/**
 * 工具执行期抛出的错误 —— handler 用它表达「业务失败」。
 * server.ts 捕获后转成 isError=true 的失败信封（不进 JSON-RPC error 层）。
 */
export class McpToolError extends Error {
  readonly code: McpErrorCode;
  readonly retryable: boolean;
  readonly hint: string;

  constructor(
    code: McpErrorCode,
    message?: string,
    overrides?: { readonly retryable?: boolean; readonly hint?: string }
  ) {
    const base = MCP_ERROR_CATALOG[code];
    super(message ?? base.message);
    this.name = 'McpToolError';
    this.code = code;
    this.retryable = overrides?.retryable ?? base.retryable;
    this.hint = overrides?.hint ?? base.hint;
  }

  /** 转成失败信封。 */
  toEnvelope(): McpFailureEnvelope {
    return fail(this.code, this.message, { retryable: this.retryable, hint: this.hint });
  }
}

/**
 * 信封 → MCP 工具结果。
 * content 文本块放 JSON 字符串（任何 client 都能读），structuredContent 放结构化信封
 * （支持该字段的 client 直接取用）。业务失败时 isError=true。
 */
export function toToolResult(envelope: McpEnvelope): ToolCallResult {
  const text = JSON.stringify(envelope);
  const content = [{ type: 'text' as const, text }];
  if (envelope.ok) {
    return { content, structuredContent: envelope };
  }
  return { content, isError: true, structuredContent: envelope };
}
