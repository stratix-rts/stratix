/**
 * 单测：代码路由 ↔ sheet 路由的**分流裁决**（world/appearance/code-fx-routing.ts）。
 *
 * 覆盖（DESIGN-asset-pipelines.md §1.3 的三条降级口径）：
 *   ① 通用演出不在分流表里 ⇒ 永远留 sheet；
 *   ② 效果源没注册（pixelfx 没加载 / 效果缺失）⇒ 静默回落 sheet；
 *   ③ reduced-motion ⇒ 不播代码路由（沿用 world/motion.ts 的口径）。
 *
 * 依赖：纯逻辑，零 Phaser。
 *
 * @since v3.3（task_194 / AP-04）
 */

import { CODE_FX_ROUTES, decideFxRoute, findCodeFxRoute } from '../code-fx-routing';

/** 通用演出（没有运行时变体需求 ⇒ 按 162 §5.1 判据 1 留 sheet）。 */
const GENERAL_PERFORMANCES = ['celebrate', 'spawn', 'despawn', 'error', 'command'] as const;

describe('分流表（只列 runtime-only 效果）', () => {
  test('角色升级 → 代码路由 heal（皮肤联动调色板 + 运行时变体）', () => {
    expect(findCodeFxRoute('levelUp')).toEqual({ sheetKind: 'levelUp', codeKind: 'heal' });
  });

  test('通用演出一律不在表里（永远走 sheet）', () => {
    for (const kind of GENERAL_PERFORMANCES) {
      expect(findCodeFxRoute(kind)).toBeNull();
    }
  });

  test('表里的每一条都能被查回来（分流表与查表口径是同一份）', () => {
    for (const route of CODE_FX_ROUTES) {
      expect(findCodeFxRoute(route.sheetKind)).toEqual(route);
    }
  });
});

describe('分流裁决', () => {
  test('没有分流规则 → sheet（reason: no-route）', () => {
    expect(decideFxRoute({ hasRoute: false, hasCodeSource: true, reducedMotion: false })).toEqual({
      route: 'sheet',
      reason: 'no-route',
    });
  });

  test('有规则但效果源没注册 → sheet（reason: no-code-source）—— 静默回落的第一种情形', () => {
    expect(decideFxRoute({ hasRoute: true, hasCodeSource: false, reducedMotion: false })).toEqual({
      route: 'sheet',
      reason: 'no-code-source',
    });
  });

  test('reduced-motion → sheet（reason: reduced-motion）—— 不播代码路由', () => {
    expect(decideFxRoute({ hasRoute: true, hasCodeSource: true, reducedMotion: true })).toEqual({
      route: 'sheet',
      reason: 'reduced-motion',
    });
  });

  test('一切就绪 → code（reason: code）', () => {
    expect(decideFxRoute({ hasRoute: true, hasCodeSource: true, reducedMotion: false })).toEqual({
      route: 'code',
      reason: 'code',
    });
  });

  test('判据顺序：没源比 reduced-motion 先判（两者都成立时理由是「没源」）', () => {
    expect(decideFxRoute({ hasRoute: true, hasCodeSource: false, reducedMotion: true }).reason).toBe(
      'no-code-source',
    );
  });
});
