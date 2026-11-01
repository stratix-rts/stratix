/**
 * 文件职责：工具入参读取器 —— 把裸 JSON 参数读成强类型值，非法即 `invalid_arguments`。
 * 输入：handler 收到的裸参数对象（args）与字段名。
 * 输出：string / number / boolean / string[] / 子对象，或抛 McpToolError('invalid_arguments')。
 * 禁止事项：
 *   1. 在这里做业务判断 —— 本文件只判**形状与范围**（类型、枚举、上下界），不判业务合法性
 *      （角色在不在档、任务能不能取消那些归各工具自己判）；
 *   2. 静默兜底 —— 字段给了但类型不对必须报错，不能悄悄当缺省处理
 *      （模型拿到「默认值」却不知道参数被忽略了，是最难查的一类错）；
 *   3. 复制 schema 的默认值到多处 —— 缺省值在 schema 里写一次，这里只做「缺省回落」的读取。
 */

import { McpToolError } from './envelope';

type Args = Readonly<Record<string, unknown>>;

function invalid(message: string, hint?: string): McpToolError {
  return new McpToolError('invalid_arguments', message, hint ? { hint } : undefined);
}

/** 必填字符串（trim 后非空）。 */
export function requireString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== 'string') {
    throw invalid(`参数 ${key} 必须是字符串`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw invalid(`参数 ${key} 不能为空`);
  }
  return trimmed;
}

/** 选填字符串（给了必须是字符串；空串按缺省处理 —— 客户端常把空串当"没给"）。 */
export function optionalString(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw invalid(`参数 ${key} 必须是字符串`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** 选填字符串或显式 null（mission_id 这类"可清空"的字段用）。 */
export function optionalStringOrNull(args: Args, key: string): string | null | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw invalid(`参数 ${key} 必须是字符串或 null`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** 选填布尔（缺省回落 given 默认值）。 */
export function optionalBoolean(args: Args, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') {
    throw invalid(`参数 ${key} 必须是布尔值`);
  }
  return value;
}

/** 选填整数（给了必须在整数范围内且落在 [min, max] 闭区间内）。 */
export function optionalInteger(
  args: Args,
  key: string,
  bounds: { readonly min?: number; readonly max?: number }
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw invalid(`参数 ${key} 必须是整数`);
  }
  if (bounds.min !== undefined && value < bounds.min) {
    throw invalid(`参数 ${key} 不能小于 ${bounds.min}`);
  }
  if (bounds.max !== undefined && value > bounds.max) {
    throw invalid(`参数 ${key} 不能大于 ${bounds.max}`);
  }
  return value;
}

/** 选填字符串数组（每项必须是非空字符串）。 */
export function optionalStringArray(args: Args, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw invalid(`参数 ${key} 必须是字符串数组`);
  }
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim().length === 0) {
      throw invalid(`参数 ${key}[${index}] 必须是非空字符串`);
    }
    return item.trim();
  });
}

/** 选填对象（子结构参数，如 filters）。 */
export function optionalObject(
  args: Args,
  key: string
): Readonly<Record<string, unknown>> | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`参数 ${key} 必须是对象`);
  }
  return value as Readonly<Record<string, unknown>>;
}

/** 选填枚举值（给了必须在给定词表内）。 */
export function optionalEnum<T extends string>(
  args: Args,
  key: string,
  allowed: readonly T[]
): T | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw invalid(`参数 ${key} 只能是：${allowed.join(' / ')}`);
  }
  return value as T;
}

/** 码点长度（不是 UTF-16 长度 —— 契约里的长度上限一律按码点算）。 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

/** 按码点截断（保头截尾），超出时尾部补省略号。 */
export function truncateText(text: string, maxCodePoints: number): string {
  const points = [...text];
  if (points.length <= maxCodePoints) return text;
  return `${points.slice(0, Math.max(0, maxCodePoints - 1)).join('')}…`;
}
