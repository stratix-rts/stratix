/**
 * 单测：**导演取景框（L3）的纯逻辑**（world/objects/director-frame.ts）。
 *
 * 覆盖验收标准：
 *   - 导演模式开启 → 中屏出现取景框；关闭 → 收掉（开关状态可观测）；
 *   - 取景框框的是**中屏**（战场画面区），不是整块画布（要避开 HUD 的顶栏 / 左右栏 / 底栏）；
 *   - 四角是**括号**（8 段短线），不是一圈会遮挡内容的整边框。
 *
 * 纯逻辑（零 Phaser）→ node 环境直接打。
 */

import type { ViewportSize } from '../../core/types';
import { DIRECTOR_FRAME_METRICS, STAGE_METRICS, TOPBAR_METRICS } from '../theme';

import {
  DirectorFrameBoard,
  directorFrameSegments,
  stageRect,
} from '../objects/director-frame';

const VIEWPORT: ViewportSize = { width: 1600, height: 900 };

describe('取景框开关（DirectorFrameBoard）', () => {
  test('默认关闭；开启后可见', () => {
    const board = new DirectorFrameBoard();
    expect(board.visible).toBe(false);
    expect(board.setEnabled(true)).toBe(true);
    expect(board.visible).toBe(true);
  });

  test('重复设置同一状态不改（渲染层可据此跳过重绘）', () => {
    const board = new DirectorFrameBoard();
    board.setEnabled(true);
    expect(board.setEnabled(true)).toBe(false);
    expect(board.setEnabled(false)).toBe(true);
    expect(board.setEnabled(false)).toBe(false);
    expect(board.visible).toBe(false);
  });
});

describe('中屏矩形（stageRect）', () => {
  test('上边让开顶栏，左边让开左栏，下边让开底栏', () => {
    const rect = stageRect(VIEWPORT);
    const { gapPx } = STAGE_METRICS;
    expect(rect.y).toBe(TOPBAR_METRICS.heightPx + gapPx);
    expect(rect.x).toBe(Math.min(VIEWPORT.width * STAGE_METRICS.leftRailRatio, STAGE_METRICS.leftRailMaxPx) + gapPx);
    const expectedBottom =
      VIEWPORT.height - (Math.min(VIEWPORT.height * STAGE_METRICS.bottomBarRatio, STAGE_METRICS.bottomBarMaxPx) + gapPx);
    expect(rect.y + rect.height).toBe(expectedBottom);
  });

  test('右边让开右栏', () => {
    const rect = stageRect(VIEWPORT);
    const expectedRight =
      VIEWPORT.width - (Math.min(VIEWPORT.width * STAGE_METRICS.rightRailRatio, STAGE_METRICS.rightRailMaxPx) + STAGE_METRICS.gapPx);
    expect(rect.x + rect.width).toBe(expectedRight);
  });

  test('视口很小也留得下一块可视区（不把框画没了）', () => {
    const rect = stageRect({ width: 120, height: 90 });
    expect(rect.width).toBeGreaterThan(0);
    expect(rect.height).toBeGreaterThan(0);
  });
});

describe('四角括号（directorFrameSegments）', () => {
  test('每个角两条线，共 8 段', () => {
    const rect = stageRect(VIEWPORT);
    const segments = directorFrameSegments(rect, DIRECTOR_FRAME_METRICS.cornerSizePx);
    expect(segments).toHaveLength(8);
  });

  test('四个角都落在矩形角上（不越界）', () => {
    const rect = stageRect(VIEWPORT);
    const size = DIRECTOR_FRAME_METRICS.cornerSizePx;
    const segments = directorFrameSegments(rect, size);
    const xs = segments.flatMap((segment) => [segment.from.x, segment.to.x]);
    const ys = segments.flatMap((segment) => [segment.from.y, segment.to.y]);
    expect(Math.min(...xs)).toBeCloseTo(rect.x, 6);
    expect(Math.max(...xs)).toBeCloseTo(rect.x + rect.width, 6);
    expect(Math.min(...ys)).toBeCloseTo(rect.y, 6);
    expect(Math.max(...ys)).toBeCloseTo(rect.y + rect.height, 6);
  });

  test('每段的长度不超过括号边长', () => {
    const rect = stageRect(VIEWPORT);
    const size = DIRECTOR_FRAME_METRICS.cornerSizePx;
    for (const segment of directorFrameSegments(rect, size)) {
      expect(Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y)).toBeLessThanOrEqual(size + 1e-6);
    }
  });
});
