/**
 * 文件职责：**生产代码路由特效源**的装配（@since v3.3，task_194 / AP-04）——
 *   把 pixelfx 的效果模块装成 world 层认的 CodeFxSource，登记进 game.registry。
 *
 * ★ 这一层是「pixelfx 加载失败 ⇒ 静默回落 sheet 路由」的落地点（DESIGN §1.3）：
 *   效果模块用**动态 import** 取 —— 取不到（chunk 没打出来 / 网络失败 / 模块形状不对），
 *   这里**静默跳过**那个 kind ⇒ 战场的代码路由就没有这个源 ⇒
 *   路由自动改走 sheet 路由（演出不少、不弹错）。
 *   why 不静态 import：静态 import 失败 = 整个入口 bundle 起不来（白屏）——
 *   那不是「降级」，那是「炸」。降级必须是**能继续跑**的那种。
 *
 * ★ 只列 runtime-only 效果（162 §5.1 判据 1）：
 *   - 'heal'（holy/heal-aoe）：皮肤联动调色板 + 每实例随机 seed 变体 —— sheet 给不了；
 *   - 其余五个触点（庆祝 / 上场 / 下场 / 报错 / 指令）是通用演出 ⇒ 留 sheet（见
 *     world/appearance/code-fx-routing.ts 的分流表）。
 *
 * 禁止事项：
 *   1. import world 的其它实现 —— 这里只 import world 的**契约**（CodeFxSource 类型）与键名；
 *   2. 在这里写死色值 —— 调色板槽位（角色名）由 world 层按皮肤 token 热读解析；
 *   3. 把效果清单写成「全部 pixelfx 效果」—— 注册了没有触点的效果 = 死代码。
 */

import type { FxPaletteRole } from '../../core/theme/fx-palette';
import type { CodeFxSource } from '../../world/objects/code-fx-layer';

import { toCodeFxSource, type PixelfxEffectModule } from './fx-code-pixelfx';

/** 一个待装配的代码路由特效源（效果模块怎么取 + 怎么适配）。 */
export interface CodeFxSourceSpec {
  /** 语义 kind（与分流表 codeKind 对齐）。 */
  readonly kind: string;
  /** 上屏缩放（1 = 原生像素尺寸；与同名 sheet 的 scale 对齐 ⇒ 回落时长相一致）。 */
  readonly scale: number;
  /** 该效果用到的调色板槽位（按顺序取色）。 */
  readonly paletteRoles: readonly FxPaletteRole[];
  /** 效果模块的取法（动态 import —— 失败时静默跳过这个 kind）。 */
  readonly load: () => Promise<unknown>;
}

/**
 * 生产代码路由的效果清单。
 *
 * why 只有一条：目前唯一「需要运行时变体」的战场触点是角色升级（见分流表）。
 *   升级光环的光效颜色随皮肤走（运行时调色板）、每次升级的随机分布都不同（运行时 seed）——
 *   这两样 sheet 路由都给不了（sheet 的调色板与 seed 是烘死的）。
 */
export const PRODUCTION_CODE_FX_SPECS: readonly CodeFxSourceSpec[] = [
  {
    kind: 'heal',
    // 与 levelUp sheet 同 scale（0.4）⇒ 代码路由与回落路由的长相一致（"不少演"）。
    scale: 0.4,
    // 治疗光环：暗绿 → 亮绿 → 白（8 槽位，与 heal-aoe 的 GREEN ramp 等长）。
    paletteRoles: ['success', 'success', 'success', 'success', 'success', 'accent', 'text', 'text'],
    load: () => import('pixelfx/fx/holy/heal-aoe'),
  },
];

/**
 * 装配生产代码路由的特效源。
 *
 * 逐个 try/catch：**任何一个效果加载失败都只少它自己那一路**（⇒ 该 kind 回落 sheet），
 * 不影响其它效果，也不抛异常（生产链路不允许因为一个特效炸掉整个启动）。
 *
 * @param specs 待装配的效果清单（缺省 = 生产清单）。
 * @returns 装配好的特效源（可能为空 —— 空 = 全走 sheet 路由）。
 */
export async function loadProductionCodeFxSources(
  specs: readonly CodeFxSourceSpec[] = PRODUCTION_CODE_FX_SPECS,
): Promise<readonly CodeFxSource[]> {
  const sources: CodeFxSource[] = [];
  for (const spec of specs) {
    try {
      const mod = await spec.load();
      sources.push(
        toCodeFxSource(mod as PixelfxEffectModule, {
          kind: spec.kind,
          scale: spec.scale,
          paletteRoles: spec.paletteRoles,
        }),
      );
    } catch {
      // 静默：加载失败 / 模块形状不对 ⇒ 这个 kind 没有代码源 ⇒ 战场自动回落 sheet 路由。
    }
  }
  return sources;
}
