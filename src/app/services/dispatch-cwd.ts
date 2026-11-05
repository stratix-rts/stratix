/**
 * 文件职责：**派发链 cwd 的唯一取值点**（@since v3.44，task_166 / docs/DESIGN-workspace.md §8 M0-02）。
 *
 * 口径：task-service / chat-service 发起一轮 CLI 派发时，把 **cwd** 填进 `SpawnOptions`；
 *   取值 = **活跃实例的项目根**（不可变绝对路径）。
 *
 * ============ dsh 双面向（§8 M0-02 行的权威口径）============
 *   - **用 dsh 哪块**：dsh 的 session 归属按 `header.cwd` 判定（不可变绝对路径，
 *     `packages/core/session/src/types.ts:106`）⇒ Stratix 侧「一个 instance 一个 path」
 *     与之同构 —— 子进程跑在哪个目录，决定这轮会话归哪个副本。
 *   - **暴露给 dsh 哪个面**：**事件订阅面** —— cwd 决定 session 归属；
 *     归属错了，宿主看到的就不是「这个副本的会话」。
 *
 * ============ 为什么单独一个模块（不散落在两个 service 里）============
 *   cwd 的**取值规则**只应有一份：task-service 与 chat-service 各写一遍，
 *   迟早一边改了另一边没改（派发链两处都要 cwd 时必然分叉）。
 *   本模块只做一件事：把「派发时该用哪个目录」这件事收到一处；
 *   端口（provider）由组合根注入，缺省实现恒 undefined。
 *
 * ============ M0 阶段的行为（行为不变）============
 *   S6b（接活跃实例注册表）未落地 ⇒ provider 缺省返回 undefined
 *   ⇒ 填进 SpawnOptions 的 cwd 仍是 undefined ⇒ 子进程继承宿主进程 cwd
 *   ⇒ **与今天逐字节一致**（本条只铺管道，不改行为）。
 *
 * 与 M0-01（cli-transport 的 `CwdProvider` 端口）的关系：两者是**同一个供给问题的两层**——
 *   本层填 `SpawnOptions.cwd`（派发层说「这轮跑在哪个目录」），
 *   transport 层可用自己的 provider 覆盖（spawn 层说「进程 cwd 就该是什么」）。
 *   M0 之下两层都拿不到值 ⇒ 行为一致。
 *
 * @since v3.44（task_166）
 */

import type { CwdProvider } from './cli-transport/transport';

/**
 * 派发链的 cwd 供给口：给出**活跃实例的项目根**；给不出（未接 S6b / 无活跃实例）时返回 undefined。
 *
 * 形状与 cli-transport 的 `CwdProvider` 同（无参、给一个绝对路径或 undefined）——
 *   同一份供给源可以同时喂这两层，故用别名而非另立一个同构类型。
 */
export type DispatchCwdProvider = CwdProvider;

/**
 * 缺省派发 cwd 供给实现：恒返回 `undefined`（= 继承当前进程 cwd）。
 * why 单独导出而不是「没传就不调」：让「缺省行为」有**唯一一份真相**，可被单测钉住
 *   （与 cli-transport 的 `defaultCwdProvider` 同一手法）。
 */
export const defaultDispatchCwdProvider: DispatchCwdProvider = (): string | undefined => undefined;

/**
 * 取派发 cwd（**唯一取值点**）。
 *
 * why 吞错降级：cwd 是「增强」不是「依赖」—— 供给口坏了不该让整轮派发失败
 *   （照旧继承进程 cwd，与今天一致）。
 *
 * @param provider cwd 供给口。
 * @param logger 日志口（缺省静默）；供给口抛错时记一条。
 * @returns 工作目录绝对路径；给不出 / 供给口抛错 ⇒ undefined。
 */
export function resolveDispatchCwd(
  provider: DispatchCwdProvider,
  logger?: (line: string) => void
): string | undefined {
  try {
    return provider();
  } catch (error) {
    logger?.(`[dispatch-cwd] cwdProvider 失败：${describe(error)}`);
    return undefined;
  }
}

/** 把任意异常转成一句话。 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
