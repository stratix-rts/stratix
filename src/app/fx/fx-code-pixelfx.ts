/**
 * 文件职责：**pixelfx 效果 → Stratix 代码路由特效源**的适配器（@since v3.3，task_162；
 *   @since v3.3 task_194 / AP-04 从 dev 入口搬进生产链路）。
 *
 *   这一层把 pixelfx 的 API 形状（createFx / createFrame / composite）翻译成
 *   world 层认的那套契约（CodeFxSource / CodeFxHandle）——
 *   world 层不认 pixelfx，也不该认（外部库的知识只留在适配器里）。
 *
 * ★ 为什么适配器住在 app 而不是 world：
 *   ① pixelfx 是**第三方库**（MIT、vendor 进仓，见 task_191 / AP-01）——
 *      world 层不该认识它的形状，适配器是唯一接触点；
 *   ② app 层是唯一同时认识 hud 与 world 的地方（组合根口径），适配器要碰两边时住这儿最自然。
 *
 * ★ 为什么从 dev 搬上来（task_194 / AP-04）：
 *   评审结论（docs/research/pixelfx-runtime-poc.md §5.3）里最硬的前置条件
 *   ——「pixelfx 的分发方式」—— 已由 task_191 / AP-01 解决（源码 vendor 进仓，
 *   别名指仓内，构建只打入口图）。剩下的落地条件（生产接线 / 降级兜底 / reduced-motion）
 *   由 task_194 关闭 ⇒ 代码路由不再是 dev 专属能力，适配器随之进生产。
 *
 * 禁止事项：
 *   1. 把 pixelfx 的类型漏进 world 层 —— world 只认 CodeFxSource 契约；
 *   2. 在适配器里写死色值 —— 调色板一律从 options.palette 进来（皮肤热读的结果）。
 */

import {
  clearFrame,
  composite,
  createFrame,
  createFx,
  type PixelfxFrame,
} from 'pixelfx';

import type { FxPaletteRole } from '../../core/theme/fx-palette';
import type { CodeFxOptions, CodeFxSource } from '../../world/objects/code-fx-layer';

/** pixelfx 效果模块的形状（本仓只用到这些字段）。 */
export interface PixelfxEffectModule {
  readonly meta: {
    readonly name: string;
    readonly size: readonly [number, number];
    readonly origin: readonly [number, number];
    readonly duration: number;
    readonly loop: boolean;
    readonly fps: number;
    readonly actor?: number;
  };
}

/** 适配参数。 */
export interface PixelfxAdapterOptions {
  /** 语义 kind（契约里只说「要什么演出」，不出现库里的效果名）。 */
  readonly kind: string;
  /** 上屏缩放（1 = 原生像素尺寸）。 */
  readonly scale: number;
  /** 该效果用到的调色板槽位（按顺序取色）。 */
  readonly paletteRoles: readonly FxPaletteRole[];
  /** 传给效果的额外选项（如 reach / aim）。 */
  readonly extraOptions?: Readonly<Record<string, unknown>>;
}

/**
 * 把一个 pixelfx 效果模块适配成代码路由特效源。
 *
 * @param mod pixelfx 效果模块。
 * @param options 适配参数。
 * @returns Stratix 侧的特效源。
 */
export function toCodeFxSource(
  mod: PixelfxEffectModule,
  options: PixelfxAdapterOptions,
): CodeFxSource {
  const [width, height] = mod.meta.size;
  const [originX, originY] = mod.meta.origin;
  return {
    kind: options.kind,
    width,
    height,
    originX,
    originY,
    durationMs: Math.round(mod.meta.duration * 1000),
    loop: mod.meta.loop === true,
    scale: options.scale,
    paletteRoles: options.paletteRoles,
    create: (createOptions: CodeFxOptions) => {
      // ★ 帧的原点 = **画布左上角 (0,0)**，不是效果原点。
      // why：帧原点是「画布左上角在 world 里的位置」，效果原点是「效果被放置到哪」——
      //   两者混起来，效果就会被画到画布角上、还被裁掉大半（实测 hit-spark 掉了 90% 像素）。
      //   烘焙链（vendor/pixelfx 的 fxlib）用的正是 createFrame(w, h, 0, 0) 这套口径，
      //   代码路由必须与它一致，否则同一效果两条路由画出来的东西对不上
      //   （见 tests/asset-pipeline/fx-dual-route-consistency.test.ts 的双路由一致性测试）。
      //   效果原点的落位由 createFx 的 x/y 决定（= 画布里的 originX/originY），
      //   与 CodeFxLayer 的 setOrigin(originX / width, originY / height) 对得上。
      const frame: PixelfxFrame = createFrame(width, height, 0, 0);
      const fx = createFx(mod, {
        x: originX,
        y: originY,
        palette: createOptions.palette,
        seed: createOptions.seed,
        flip: createOptions.flip,
        angle: createOptions.angle,
        ...(options.extraOptions ?? {}),
      });
      return {
        update(dtMs: number): void {
          fx.update(dtMs / 1000);
        },
        render(rgba: Uint8ClampedArray): void {
          clearFrame(frame);
          fx.draw(frame);
          // bg = null：透明底（与一期 sheet 路由的 sheet 帧同一口径）。
          composite(frame, rgba, null);
        },
        get done(): boolean {
          return fx.done();
        },
      };
    },
  };
}
