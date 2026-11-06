/**
 * 单测：**特效路由**（world/objects/fx-router.ts）——
 *   代码路由优先，播不成**静默**回落 sheet 路由（DESIGN-asset-pipelines.md §1.3）。
 *
 * 覆盖：
 *   ① 效果缺失（代码源没注册）→ sheet 兜底，**不抛异常**；
 *   ② 代码路由自己拒播（面积超限 / 并发满 / 效果炸了）→ sheet 兜底，演出不少；
 *   ③ 代码路由炸了（抛异常）→ 仍然 sheet 兜底，异常不许冒到战场；
 *   ④ reduced-motion → 不播代码路由（走 sheet）；
 *   ⑤ 一切就绪 → 走代码路由，**且不重复播 sheet**（一场演出只播一次）。
 *
 * 依赖：纯编排（回调注入），零 Phaser。
 *
 * @since v3.3（task_194 / AP-04）
 */

import { FxRouter } from '../fx-router';

/** 一次路由的旁路记录（谁被叫了）。 */
interface RouteTrace {
  readonly codeCalls: string[];
  readonly sheetCalls: string[];
}

/** 造一个路由 + 旁路记录。 */
function makeRouter(
  options: {
    readonly hasCodeSource?: boolean;
    readonly reducedMotion?: boolean;
    readonly codePlay?: (codeKind: string, x: number, y: number) => boolean;
  } = {},
): { router: FxRouter; trace: RouteTrace } {
  const trace: RouteTrace = { codeCalls: [], sheetCalls: [] };
  const router = new FxRouter({
    codePlay: (codeKind, x, y) => {
      trace.codeCalls.push(`${codeKind}@${x},${y}`);
      return options.codePlay ? options.codePlay(codeKind, x, y) : true;
    },
    sheetPlay: (sheetKind) => {
      trace.sheetCalls.push(sheetKind);
      return true;
    },
    hasCodeSource: () => options.hasCodeSource ?? true,
    reducedMotion: () => options.reducedMotion ?? false,
  });
  return { router, trace };
}

describe('特效路由：静默回落（效果缺失 ⇒ sheet 兜底，不弹错不少演）', () => {
  test('效果缺失（代码源没注册）→ 走 sheet，代码路由一次都没被叫', () => {
    const { router, trace } = makeRouter({ hasCodeSource: false });

    const decision = router.play('levelUp', 100, 200);

    expect(decision).toEqual({ route: 'sheet', reason: 'no-code-source' });
    expect(trace.codeCalls).toEqual([]);
    expect(trace.sheetCalls).toEqual(['levelUp']);
  });

  test('代码路由自己拒播 → 走 sheet（演出不少：sheet 照样播了）', () => {
    const { router, trace } = makeRouter({ codePlay: () => false });

    const decision = router.play('levelUp', 100, 200);

    expect(decision).toEqual({ route: 'sheet', reason: 'code-refused' });
    expect(trace.codeCalls).toEqual(['heal@100,200']);
    expect(trace.sheetCalls).toEqual(['levelUp']);
  });

  test('代码路由抛异常 → 仍然走 sheet，异常不冒到战场', () => {
    const { router, trace } = makeRouter({
      codePlay: () => {
        throw new Error('效果炸了');
      },
    });

    let decision: ReturnType<FxRouter['play']> | null = null;
    expect(() => {
      decision = router.play('levelUp', 100, 200);
    }).not.toThrow();

    expect(decision).toEqual({ route: 'sheet', reason: 'code-refused' });
    expect(trace.sheetCalls).toEqual(['levelUp']);
  });
});

describe('特效路由：reduced-motion 不播代码路由', () => {
  test('开了 reduced-motion → 走 sheet，代码路由一次都没被叫', () => {
    const { router, trace } = makeRouter({ reducedMotion: true });

    const decision = router.play('levelUp', 100, 200);

    expect(decision).toEqual({ route: 'sheet', reason: 'reduced-motion' });
    expect(trace.codeCalls).toEqual([]);
    expect(trace.sheetCalls).toEqual(['levelUp']);
  });

  test('开关是**现取**的：中途打开 ⇒ 下一次就改走 sheet', () => {
    let reduced = false;
    const trace: RouteTrace = { codeCalls: [], sheetCalls: [] };
    const router = new FxRouter({
      codePlay: (codeKind) => {
        trace.codeCalls.push(codeKind);
        return true;
      },
      sheetPlay: (sheetKind) => {
        trace.sheetCalls.push(sheetKind);
        return true;
      },
      hasCodeSource: () => true,
      reducedMotion: () => reduced,
    });

    expect(router.play('levelUp', 1, 1).route).toBe('code');
    reduced = true;
    expect(router.play('levelUp', 1, 1).route).toBe('sheet');

    expect(trace.codeCalls).toEqual(['heal']);
    expect(trace.sheetCalls).toEqual(['levelUp']);
  });
});

describe('特效路由：通用演出留 sheet / 就绪走代码', () => {
  test('没有分流规则的 kind → 直接 sheet（代码路由一次都没被叫）', () => {
    const { router, trace } = makeRouter();

    const decision = router.play('celebrate', 10, 20);

    expect(decision).toEqual({ route: 'sheet', reason: 'no-route' });
    expect(trace.codeCalls).toEqual([]);
    expect(trace.sheetCalls).toEqual(['celebrate']);
  });

  test('一切就绪 → 走代码路由，且**不重复播 sheet**（一场演出只播一次）', () => {
    const { router, trace } = makeRouter();

    const decision = router.play('levelUp', 100, 200);

    expect(decision).toEqual({ route: 'code', reason: 'code' });
    expect(trace.codeCalls).toEqual(['heal@100,200']);
    expect(trace.sheetCalls).toEqual([]);
  });
});
