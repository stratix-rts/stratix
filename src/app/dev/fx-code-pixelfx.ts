/**
 * 文件职责：**pixelfx 效果 → Stratix 代码路由特效源**的适配器（@since v3.3，task_162，dev-only）。
 *
 *   这一层把 pixelfx 的 API 形状（createFx / createFrame / composite）翻译成
 *   world 层认的那套契约（CodeFxSource / CodeFxHandle）——
 *   world 层不认 pixelfx，也不该认（外部库的知识只留在适配器里）。
 *
 * ★ 为什么适配器住在 app/dev 而不是 world：
 *   ① 引入 pixelfx 运行时依赖这件事本身**还没定论**（见评审文档 §5.3 的落地前置条件），
 *      所以适配器不进生产产物 —— 它只在 dev 验收入口里被引用；
 *   ② app 层是唯一同时认识 hud 与 world 的地方（组合根口径），适配器要碰两边时住这儿最自然。
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
      const frame: PixelfxFrame = createFrame(width, height, originX, originY);
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
