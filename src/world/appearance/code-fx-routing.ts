/**
 * 文件职责：**代码路由 ↔ sheet 路由的分流裁决**（@since v3.3，task_194 / AP-04）—— 纯逻辑，零 Phaser。
 *
 * ★ 为什么要有这一层（DESIGN-asset-pipelines.md §1.3「生产接线」）：
 *   代码路由（运行时逐像素算）与 sheet 路由（烘好的图）是**两条互斥的路**，
 *   生产战场的每个特效触点都必须**当场裁决**走哪条 —— 裁决口径只有一处，
 *   才不会出现「有的触点走代码、有的走 sheet，而回落规则各写一套」的漂移。
 *
 * 分流判据（沿用 162 评审 docs/research/pixelfx-runtime-poc.md §5.1，三条按顺序问）：
 *   1. 需不需要**运行时变体**（flip / angle / seed / 皮肤联动调色板）？不需要 ⇒ 留 sheet；
 *   2. 画布面积 ≤ 40,960 px？超 ⇒ 留 sheet；
 *   3. 同屏同时最多 2 条？会高峰爆 ⇒ 留 sheet。
 *
 * 路由表（CODE_FX_ROUTES）**只列通过判据 1 的 runtime-only 效果**：
 *   - levelUp → 'heal'（holy/heal-aoe）：光效颜色随皮肤走（运行时调色板）+ 每实例随机 seed 变体；
 *     面积 34,816 px（在 40,960 护栏内）；回落 = **同一个效果**的烘焙图（levelUp sheet）—— 演出不少。
 *   通用演出（celebrate / spawn / despawn / error / command）**不在表里** ⇒ 永远走 sheet
 *   （它们静态、无变体需求，sheet 的 GPU 合成成本几乎为零）。
 *
 * 禁止事项：
 *   1. import phaser —— 本模块是纯裁决（node 单测直接跑）；
 *   2. import app / hud —— 铁律：world 只认 core；
 *   3. 在这里写「怎么播」—— 那是 objects/fx-router.ts 与各特效层的活。
 */

import type { SpriteFxKind } from './fx-atlas';

/** 一条分流规则：某个 sheet kind 在生产里改走代码路由，回落仍是同一个 sheet kind。 */
export interface CodeFxRoute {
  /** sheet 侧的语义 kind（战场触点认的 kind）。 */
  readonly sheetKind: SpriteFxKind;
  /** 代码路由侧的语义 kind（效果源注册表里的 kind）。 */
  readonly codeKind: string;
}

/**
 * 生产分流表 —— **只列 runtime-only 效果**（判据 1 通过的）。
 *
 * why 只有一条：目前生产战场唯一「需要运行时变体」的触点是角色升级 ——
 *   升级光效要跟着皮肤走（运行时调色板），且每次升级的随机分布都不一样（运行时 seed 变体）。
 *   其余五个触点（庆祝 / 上场 / 下场 / 报错 / 指令）都是通用演出：静态、无变体需求、
 *   面积大或高频 —— 按判据 1 留在 sheet（162 §5.2「永远留 sheet」）。
 *
 * why 回落是**同一个 sheet kind**而不是别的：升级光环的 sheet 与代码路由是**同一个效果**
 *   （holy/heal-aoe，同 origin / 同 scale）—— 回落时用户看到的演出与代码路由一致，
 *   只是少了随机变体。这才是「不少演」（DESIGN §1.3）。
 */
export const CODE_FX_ROUTES: readonly CodeFxRoute[] = [
  { sheetKind: 'levelUp', codeKind: 'heal' },
];

/** 分流裁决的理由（dev 观测 / 单测断言用）。 */
export type FxRouteReason =
  /** 走代码路由。 */
  | 'code'
  /** 这个 kind 没有分流规则（通用演出 → 留 sheet）。 */
  | 'no-route'
  /** 有分流规则，但代码路由的效果源没注册（pixelfx 没加载 / 效果模块缺失）。 */
  | 'no-code-source'
  /** 用户要求减少动效 ⇒ 不播代码路由（沿用 world/motion.ts 口径）。 */
  | 'reduced-motion'
  /** 代码路由自己拒播（面积超限 / 并发满 / 效果实现炸了）⇒ 回落 sheet。 */
  | 'code-refused';

/** 分流裁决的结果。 */
export interface FxRouteDecision {
  /** 走哪条路。 */
  readonly route: 'code' | 'sheet';
  /** 为什么这么走。 */
  readonly reason: FxRouteReason;
}

/** 找一条分流规则（按 sheet kind）。 */
export function findCodeFxRoute(sheetKind: SpriteFxKind): CodeFxRoute | null {
  return CODE_FX_ROUTES.find((route) => route.sheetKind === sheetKind) ?? null;
}

/** 分流裁决的入参（纯数据 —— 便于穷举断言）。 */
export interface FxRouteRequest {
  /** 有没有分流规则（这个 kind 在不在路由表里）。 */
  readonly hasRoute: boolean;
  /** 代码路由的效果源注册了吗（pixelfx 加载失败 / 效果缺失 ⇒ 没有）。 */
  readonly hasCodeSource: boolean;
  /** 用户是否要求减少动效。 */
  readonly reducedMotion: boolean;
}

/**
 * 分流裁决：这条触点该走代码路由还是 sheet 路由。
 *
 * 口径（按顺序问）：
 *   1. 没有分流规则 ⇒ sheet（通用演出留 sheet）；
 *   2. 有规则但效果源没注册 ⇒ sheet（静默回落：pixelfx 没加载 / 效果模块缺失）；
 *   3. 用户要求减少动效 ⇒ sheet（不播代码路由）；
 *   4. 其余 ⇒ code（代码路由优先，播不成由调用方回落 sheet）。
 *
 * @param request 裁决入参。
 * @returns 裁决结果。
 */
export function decideFxRoute(request: FxRouteRequest): FxRouteDecision {
  if (!request.hasRoute) return { route: 'sheet', reason: 'no-route' };
  if (!request.hasCodeSource) return { route: 'sheet', reason: 'no-code-source' };
  if (request.reducedMotion) return { route: 'sheet', reason: 'reduced-motion' };
  return { route: 'code', reason: 'code' };
}
