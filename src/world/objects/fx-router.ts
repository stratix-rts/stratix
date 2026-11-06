/**
 * 文件职责：**特效路由**（@since v3.3，task_194 / AP-04）——
 *   决定一条战场触点走**代码路由**（运行时逐像素算）还是 **sheet 路由**（烘好的图），
 *   并在代码路由**播不成**时静默回落到 sheet 路由。
 *
 * ★ 静默回落是这一层存在的全部理由（DESIGN §1.3）：
 *   「pixelfx 加载失败 / 效果缺失 ⇒ 静默回落 sheet 路由（不弹错不少演）」——
 *   代码路由是**增强**（运行时调色板 + 程序化变体），sheet 路由是**保底**。
 *   任何一种「代码路由用不了」的情形（没源 / 用户要减少动效 / 护栏拒播 / 效果自己炸了），
 *   用户看到的都是**同一场演出**，只是少了变体 —— 不弹错、不少演、不抛异常。
 *
 * 输入：两条路由的播放回调（由场景注入 —— 本层不认识 Phaser，也不认识具体特效层）。
 * 输出：一次裁决（走了哪条路 + 为什么）。
 * 禁止事项：
 *   1. import phaser —— 本层只做编排（回调注入），node 单测直接跑；
 *   2. import app / hud —— 铁律：world 只认 core；
 *   3. 自己抛异常 —— 演出层的失败一律降级成 sheet，不许把异常抛给战场。
 */

import {
  decideFxRoute,
  findCodeFxRoute,
  type CodeFxRoute,
  type FxRouteDecision,
} from '../appearance/code-fx-routing';
import type { SpriteFxKind } from '../appearance/fx-atlas';

/** 路由器的装配口（两条路由各给一个「播不播得出去」的回调）。 */
export interface FxRouterOptions {
  /** 代码路由的播放口（返回 false = 没播成）。 */
  readonly codePlay: (codeKind: string, x: number, y: number) => boolean;
  /** sheet 路由的播放口（返回 false = 没播成）。 */
  readonly sheetPlay: (sheetKind: SpriteFxKind, x: number, y: number) => boolean;
  /** 代码路由的效果源注册了吗（pixelfx 没加载 / 效果模块缺失 ⇒ false）。 */
  readonly hasCodeSource: (codeKind: string) => boolean;
  /** 用户是否要求减少动效（每次现取，不缓存 —— 开关随时能改）。 */
  readonly reducedMotion: () => boolean;
  /** 分流规则表（缺省 = appearance/code-fx-routing.ts 的生产表）。 */
  readonly routes?: readonly CodeFxRoute[];
}

/**
 * 特效路由：代码路由优先，播不成就静默回落 sheet 路由。
 *
 * why 不把两条路由做成一个类：它们是**两个独立的层**（一个逐像素算、一个换纹理帧），
 *   生命周期、护栏、回收各管各的；路由只做「这次走哪条 + 走不通怎么办」的裁决。
 */
export class FxRouter {
  private readonly options: FxRouterOptions;
  /** 上一次裁决（dev 观测用）。 */
  private last: FxRouteDecision | null = null;

  constructor(options: FxRouterOptions) {
    this.options = options;
  }

  /** 上一次裁决（dev 观测用 —— 用来当场证明「回落路径真的走了 sheet」）。 */
  get lastDecision(): FxRouteDecision | null {
    return this.last;
  }

  /**
   * 播一条特效：代码路由优先，播不成静默回落 sheet 路由。
   *
   * @param sheetKind 触点的语义 kind（战场只认这一套 kind —— 两条路由共用）。
   * @param x 挂载点 x（世界坐标）。
   * @param y 挂载点 y（世界坐标）。
   * @returns 裁决结果（走了哪条路 + 为什么）。
   */
  play(sheetKind: SpriteFxKind, x: number, y: number): FxRouteDecision {
    const route = findCodeFxRoute(sheetKind);
    const decision = decideFxRoute({
      hasRoute: route !== null,
      hasCodeSource: route ? this.options.hasCodeSource(route.codeKind) : false,
      reducedMotion: this.options.reducedMotion(),
    });

    if (decision.route === 'code' && route) {
      // 代码路由优先：它自己拒播（面积超限 / 并发满 / 效果炸了）→ 回落 sheet，演出不少。
      // why 再包一层 try/catch：代码路由是「增强」，它炸了也不该把异常抛给战场（本层禁止事项 3）。
      let played = false;
      try {
        played = this.options.codePlay(route.codeKind, x, y);
      } catch {
        played = false;
      }
      if (played) {
        this.last = { route: 'code', reason: 'code' };
        return this.last;
      }
      this.last = { route: 'sheet', reason: 'code-refused' };
      this.options.sheetPlay(sheetKind, x, y);
      return this.last;
    }

    this.last = decision;
    this.options.sheetPlay(sheetKind, x, y);
    return decision;
  }
}
