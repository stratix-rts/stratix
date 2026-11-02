/**
 * 文件职责：**长会话压缩的阈值配置**（@since v3.48，task_106 / v3.2b-B7）——
 *   env `SX_SESSION_COMPRESS_THRESHOLD` → core/session 的压缩阈值（事件条数）。
 * 方案来源：docs/SESSION-PLAN.md §8「压缩规则版先行（eventCount>阈值，默认 200，
 *   env SX_SESSION_COMPRESS_THRESHOLD）」。
 * 输入：环境变量里的**原始串**（渲染层经 preload 白名单通道，service 进程经 process.env）。
 * 输出：合法的阈值（事件条数；>= 1）。
 * 禁止事项：
 *   1. 在这里读 core 之外的状态 —— 本模块只做「原始串 → 阈值」的解析（纯函数，可单测）；
 *   2. 悄悄把坏值夹成另一个数 —— 配错了就**回落缺省**（200）并在返回值里如实反映，
 *      别让人以为阈值已经按自己配的值生效了（错配比不配更难查）；
 *   3. 在 core 里读 env —— core 零 IO（env 是 IO）；阈值由组合根注入 core。
 *
 * why 阈值住在 app 层：core 只认契约（manager 的 compressThreshold 选项），
 *   「这个部署环境把阈值设成多少」是**部署口径**，归 app / 组合根。
 *
 * @since v3.48，task_106（v3.2b-B7）。
 */

import { DEFAULT_SESSION_COMPRESS_THRESHOLD } from '../../core/session';

/** 压缩阈值的环境变量名（渲染层 preload 白名单与 service 进程共用这一个键）。 */
export const SESSION_COMPRESS_THRESHOLD_ENV = 'SX_SESSION_COMPRESS_THRESHOLD';

/**
 * 原始串 → 压缩阈值。
 *
 * 口径：非空且是 >= 1 的整数才认；否则回落缺省（DEFAULT_SESSION_COMPRESS_THRESHOLD = 200）。
 * why 不夹成 0 / 负数：阈值 <= 0 意味着"每条事件都触发折叠" —— 那是配错，不是意图。
 */
export function resolveSessionCompressThreshold(raw: string | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_SESSION_COMPRESS_THRESHOLD;
  const text = raw.trim();
  if (text === '') return DEFAULT_SESSION_COMPRESS_THRESHOLD;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_SESSION_COMPRESS_THRESHOLD;
  return parsed;
}

/**
 * 从环境变量里取压缩阈值。
 *
 * @param env 环境变量来源；缺省 = 进程 env（渲染层读不到 → 缺省阈值）。
 */
export function sessionCompressThresholdFromEnv(
  env?: Record<string, string | undefined>
): number {
  const source =
    env ?? (typeof process !== 'undefined' ? (process.env as Record<string, string | undefined>) : undefined);
  return resolveSessionCompressThreshold(source?.[SESSION_COMPRESS_THRESHOLD_ENV]);
}
