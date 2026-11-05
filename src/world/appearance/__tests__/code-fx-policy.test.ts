/**
 * 单测：代码路由特效的预算护栏（world/appearance/code-fx-policy.ts）。
 * 覆盖：面积准入、并发准入、渲染频率自适应、超预算挤实例、离屏判定。
 * 依赖：纯逻辑，零 Phaser。
 *
 * @since v3.3（task_162）
 */

import { CODE_FX_METRICS } from '../../../core/theme/visual-spec';
import {
  admitCodeFx,
  isCodeFxOnScreen,
  nextRenderHz,
  shouldEvictForBudget,
  type CodeFxBudget,
} from '../code-fx-policy';

/** 用唯一事实源（core/theme/visual-spec.ts）铺一份预算。 */
const BUDGET: CodeFxBudget = {
  maxConcurrent: CODE_FX_METRICS.maxConcurrent,
  maxCanvasAreaPx: CODE_FX_METRICS.maxCanvasAreaPx,
  renderHz: CODE_FX_METRICS.renderHz,
  minRenderHz: CODE_FX_METRICS.minRenderHz,
  frameBudgetMs: CODE_FX_METRICS.frameBudgetMs,
  offscreenMarginPx: CODE_FX_METRICS.offscreenMarginPx,
};

describe('准入裁决', () => {
  test('面积在限内且没满 → 放行', () => {
    expect(admitCodeFx(10_880, 0, BUDGET)).toEqual({ admitted: true, reason: 'ok' });
  });

  test('面积超限 → 永远不播（成本与面积成正比，放进来就是白烧 CPU）', () => {
    const over = BUDGET.maxCanvasAreaPx + 1;
    expect(admitCodeFx(over, 0, BUDGET)).toEqual({
      admitted: false,
      reason: 'area-too-large',
    });
  });

  test('面积刚好等于上限 → 放行（限是闭区间）', () => {
    expect(admitCodeFx(BUDGET.maxCanvasAreaPx, 0, BUDGET).admitted).toBe(true);
  });

  test('并发满 → 挤掉最老的一条再播', () => {
    const admission = admitCodeFx(1000, BUDGET.maxConcurrent, BUDGET);
    expect(admission.admitted).toBe(false);
    expect(admission.reason).toBe('concurrency-full');
  });

  test('面积超限优先于并发满（两者都超时报面积 —— 那是根因）', () => {
    const admission = admitCodeFx(BUDGET.maxCanvasAreaPx + 1, 99, BUDGET);
    expect(admission.reason).toBe('area-too-large');
  });
});

describe('渲染频率自适应', () => {
  test('超预算 → 降一档', () => {
    expect(nextRenderHz(30, BUDGET.frameBudgetMs + 0.1, BUDGET)).toBe(15);
  });

  test('超预算也不许跌破下限（再低就不像动画了）', () => {
    expect(nextRenderHz(15, 100, BUDGET)).toBe(BUDGET.minRenderHz);
    expect(nextRenderHz(BUDGET.minRenderHz, 100, BUDGET)).toBe(BUDGET.minRenderHz);
  });

  test('宽裕（不到预算的一半）→ 升回目标档', () => {
    expect(nextRenderHz(15, BUDGET.frameBudgetMs / 4, BUDGET)).toBe(30);
    expect(nextRenderHz(30, BUDGET.frameBudgetMs / 4, BUDGET)).toBe(30);
  });

  test('刚好在预算中段 → 不动（避免来回抖）', () => {
    expect(nextRenderHz(30, BUDGET.frameBudgetMs * 0.75, BUDGET)).toBe(30);
  });
});

describe('超预算挤实例', () => {
  test('降到最低频率还超预算 → 该挤了', () => {
    expect(shouldEvictForBudget(BUDGET.frameBudgetMs + 1, BUDGET.minRenderHz, BUDGET)).toBe(true);
  });

  test('还在降频途中 → 不挤（先降频）', () => {
    expect(shouldEvictForBudget(BUDGET.frameBudgetMs + 1, 30, BUDGET)).toBe(false);
  });

  test('没超预算 → 不挤', () => {
    expect(shouldEvictForBudget(1, BUDGET.minRenderHz, BUDGET)).toBe(false);
  });
});

describe('离屏判定', () => {
  const view = { x: 0, y: 0, right: 800, bottom: 600 };

  test('视口内 → 可见', () => {
    expect(isCodeFxOnScreen(400, 300, view, 96)).toBe(true);
  });

  test('视口外（超出留边）→ 不可见（该停算、该回收）', () => {
    expect(isCodeFxOnScreen(2000, 300, view, 96)).toBe(false);
    expect(isCodeFxOnScreen(400, 1200, view, 96)).toBe(false);
  });

  test('刚出视口但在留边内 → 仍算可见（别在边缘上抖动）', () => {
    expect(isCodeFxOnScreen(800 + 50, 300, view, 96)).toBe(true);
    expect(isCodeFxOnScreen(800 + 200, 300, view, 96)).toBe(false);
  });

  test('视口还没算出来（尺寸为 0）→ 一律算可见（首帧误杀的坑不踩）', () => {
    expect(isCodeFxOnScreen(9999, 9999, { x: 0, y: 0, right: 0, bottom: 0 }, 96)).toBe(true);
    expect(isCodeFxOnScreen(400, 300, null, 96)).toBe(true);
    expect(isCodeFxOnScreen(400, 300, undefined, 96)).toBe(true);
  });
});
