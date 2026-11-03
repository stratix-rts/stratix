/**
 * 单测：**单位联动（Z2b）的纯逻辑**（world/objects/focus-link.ts）
 *   与世界 → 屏幕换算契约（core/camera.ts 的 worldToScreen —— 引导弧线端点靠它）。
 *
 * 覆盖验收标准：
 *   - 焦点裁决：点选锁定 / 再次点击取消 / 改锁 / 空 id 无效 / 主动失焦（失焦 = 取消）；
 *   - 引导弧线：起点锚在 HUD 事件轨（屏幕坐标）、末端是目标单位、800ms 淡入口径；
 *   - 描边呼吸：透明度始终落在 [谷值, 峰值]，且按周期起伏；
 *   - 世界 → 屏幕：相机中心落在屏幕正中、缩放按比例换算（弧线跟随镜头的根据）。
 *
 * 纯逻辑（零 Phaser）→ node 环境直接打。
 */

import { worldToScreen } from '../../core/camera';
import type { CameraState, ViewportSize } from '../../core/types';
import { FOCUS_LINK_METRICS } from '../theme';

import {
  FocusLinkBoard,
  focusLinkArcPoints,
  focusLinkOrigin,
  focusOutlineAlpha,
} from '../objects/focus-link';

const VIEWPORT: ViewportSize = { width: 1600, height: 900 };

describe('焦点裁决（FocusLinkBoard）', () => {
  test('点选一个单位 = 锁定它', () => {
    const board = new FocusLinkBoard();
    const outcome = board.focus('u1');
    expect(outcome).toEqual({ unitId: 'u1', changed: true, cleared: false });
    expect(board.unitId).toBe('u1');
  });

  test('再次点击同一个单位 = 取消锁定（规格「持续到失焦/再次点击」）', () => {
    const board = new FocusLinkBoard();
    board.focus('u1');
    const outcome = board.focus('u1');
    expect(outcome).toEqual({ unitId: null, changed: true, cleared: true });
    expect(board.unitId).toBeNull();
  });

  test('点选另一个单位 = 改锁（不是取消）', () => {
    const board = new FocusLinkBoard();
    board.focus('u1');
    const outcome = board.focus('u2');
    expect(outcome).toEqual({ unitId: 'u2', changed: true, cleared: false });
    expect(board.unitId).toBe('u2');
  });

  test('空 id = 无效点选（不改状态）', () => {
    const board = new FocusLinkBoard();
    const outcome = board.focus('');
    expect(outcome.changed).toBe(false);
    expect(outcome.cleared).toBe(false);
    expect(board.unitId).toBeNull();
  });

  test('主动失焦（clear）= 取消锁定；重复 clear 是空操作', () => {
    const board = new FocusLinkBoard();
    board.focus('u1');
    expect(board.clear()).toEqual({ unitId: null, changed: true, cleared: true });
    expect(board.clear().changed).toBe(false);
    expect(board.unitId).toBeNull();
  });
});

describe('引导弧线的几何', () => {
  test('起点锚在 HUD 事件轨的右缘（屏幕坐标，随视口高度动）', () => {
    const origin = focusLinkOrigin(VIEWPORT);
    const { trackLeftPx, trackWidthPx, trackBottomPx, trackRowPx } = FOCUS_LINK_METRICS.origin;
    expect(origin.x).toBe(trackLeftPx + trackWidthPx);
    expect(origin.y).toBe(VIEWPORT.height - trackBottomPx - trackRowPx / 2);
  });

  test('弧线从起点出发、落在目标点上（首尾闭合）', () => {
    const origin = focusLinkOrigin(VIEWPORT);
    const target = { x: 800, y: 300 };
    const points = focusLinkArcPoints(origin, target);
    expect(points).toHaveLength(FOCUS_LINK_METRICS.arcSegments + 1);
    expect(points[0].x).toBeCloseTo(origin.x, 6);
    expect(points[0].y).toBeCloseTo(origin.y, 6);
    const last = points[points.length - 1];
    expect(last.x).toBeCloseTo(target.x, 6);
    expect(last.y).toBeCloseTo(target.y, 6);
  });

  test('弧线是弧线不是直线：中途至少有一个点偏离两端连线', () => {
    const origin = focusLinkOrigin(VIEWPORT);
    const target = { x: 800, y: 300 };
    const points = focusLinkArcPoints(origin, target);
    const mid = points[Math.floor(points.length / 2)];
    const straightMidY = (origin.y + target.y) / 2;
    expect(Math.abs(mid.y - straightMidY)).toBeGreaterThan(1);
  });

  test('淡入时长是规格钦定的 800ms', () => {
    expect(FOCUS_LINK_METRICS.arcFadeInMs).toBe(800);
  });
});

describe('描边呼吸', () => {
  test('透明度始终落在 [谷值, 峰值] 之间', () => {
    const { outlineMinAlpha, outlineMaxAlpha } = FOCUS_LINK_METRICS;
    for (let now = 0; now <= FOCUS_LINK_METRICS.breathPeriodMs * 2; now += 40) {
      const alpha = focusOutlineAlpha(now, 0.3);
      expect(alpha).toBeGreaterThanOrEqual(outlineMinAlpha);
      expect(alpha).toBeLessThanOrEqual(outlineMaxAlpha);
    }
  });

  test('谷值不是全灭（否则看着像「取消选中」）', () => {
    expect(FOCUS_LINK_METRICS.outlineMinAlpha).toBeGreaterThan(0);
  });

  test('相位偏移会把波形错开（同一时刻不同单位不同步）', () => {
    const now = 1000;
    expect(focusOutlineAlpha(now, 0)).not.toBeCloseTo(focusOutlineAlpha(now, 0.5), 6);
  });
});

describe('世界 → 屏幕换算（core/camera.worldToScreen）', () => {
  const camera: CameraState = { center: { x: 0, y: 0 }, zoom: 1 };

  test('相机中心落在屏幕正中', () => {
    const point = worldToScreen({ x: 0, y: 0 }, camera, VIEWPORT);
    expect(point.x).toBe(VIEWPORT.width / 2);
    expect(point.y).toBe(VIEWPORT.height / 2);
  });

  test('缩放时偏移按倍率放大（但中心仍在屏幕正中）', () => {
    const zoomed: CameraState = { center: { x: 0, y: 0 }, zoom: 2 };
    const point = worldToScreen({ x: 100, y: -50 }, zoomed, VIEWPORT);
    expect(point.x).toBe(VIEWPORT.width / 2 + 200);
    expect(point.y).toBe(VIEWPORT.height / 2 - 100);
    const center = worldToScreen({ x: 0, y: 0 }, zoomed, VIEWPORT);
    expect(center.x).toBe(VIEWPORT.width / 2);
    expect(center.y).toBe(VIEWPORT.height / 2);
  });

  test('镜头移动时同一个世界点跟着走（弧线跟随镜头的根据）', () => {
    const moved: CameraState = { center: { x: 200, y: 0 }, zoom: 1 };
    const point = worldToScreen({ x: 200, y: 0 }, moved, VIEWPORT);
    expect(point.x).toBe(VIEWPORT.width / 2);
    expect(point.y).toBe(VIEWPORT.height / 2);
  });

  test('非法输入兜底（zoom → 1，不出 NaN）', () => {
    const broken: CameraState = { center: { x: Number.NaN, y: 0 }, zoom: Number.NaN };
    const point = worldToScreen({ x: Number.NaN, y: 0 }, broken, VIEWPORT);
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});
