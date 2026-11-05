/**
 * 文件职责：**pixelfx 库的运行时类型声明**（@since v3.3，task_162）。
 *
 * why 需要它：pixelfx 是**仓外**的库（兄弟目录 ../pixelfx，MIT、零依赖），
 *   没有随包发布的 .d.ts；而本仓的 tsc 要能编译引用它的 dev 入口。
 *   这里声明本仓**实际用到的那几个 API**（不是全库）——
 *   声明面越小，与上游漂移的风险越小；上游改了签名，编译期就会报错提醒。
 *
 * why 不用 `paths` 映射到 ../pixelfx：那样 tsc 会真的去读仓外的 .js（allowJs 关着 → 报错），
 *   而且 tsc-alias 会把 require('pixelfx') 改写成机器相关的相对路径 → 产物不可移植。
 *   声明成 ambient module 则：编译期零外部依赖、产物里 require('pixelfx') 原样保留（dev 入口专用）。
 *
 * 禁止事项：
 *   1. 把本声明扩成「全库 API 的镜像」—— 只声明用到的那几个；
 *   2. 改上游库来迁就本声明 —— 声明跟着上游改。
 */

declare module 'pixelfx' {
  /** 一帧：w×h 像素，原点在 (ox, oy)。color = 不透明像素，light = 加色辉光。 */
  export interface PixelfxFrame {
    w: number;
    h: number;
    ox: number;
    oy: number;
    color: Uint32Array;
    light: Uint32Array;
  }

  /** 建一帧缓冲。 */
  export function createFrame(w: number, h: number, ox?: number, oy?: number): PixelfxFrame;
  /** 清空一帧缓冲。 */
  export function clearFrame(frame: PixelfxFrame): PixelfxFrame;
  /** 把一个效果模块变成一个活的实例。 */
  export function createFx(
    mod: unknown,
    options?: Record<string, unknown>,
  ): {
    update(dt: number): void;
    draw(frame: PixelfxFrame, layer?: 'back' | 'front'): void;
    stop(): void;
    done(): boolean;
  };
  /** 合成到 RGBA 字节缓冲（bg = null 表示透明底）。 */
  export function composite(
    frame: PixelfxFrame,
    out: Uint8ClampedArray,
    bg?: number | Uint32Array | null,
    lightK?: number,
  ): Uint8ClampedArray;
}

declare module 'pixelfx/fx/*' {
  /** 效果模块的元数据（尺寸 / 原点 / 时长 / 循环）。 */
  export const meta: {
    name: string;
    size: [number, number];
    origin: [number, number];
    duration: number;
    loop: boolean;
    fps: number;
    options?: Record<string, unknown>;
    actor?: number;
  };
  /** 建一个效果实例（内部状态机）。 */
  export function create(options: unknown): unknown;
}
