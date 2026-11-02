/**
 * 单测：地面层的纯几何口径（world/objects/ground-layout.ts，task_078）。
 * 覆盖：
 *   - 格网：步距 64px，横纵都覆盖整个战场边界；
 *   - 四角刻度：四个角各两条 L 形线段 + 四个坐标标签。
 *
 * @since v3.3（task_086）扫描光带的用例随效果一起迁到 HUD 侧
 *   （hud/__tests__/scan-band.test.ts）—— 它现在是屏幕空间效果，不再是世界坐标几何。
 *
 * @jest-environment node
 */

import {
  GROUND_GRID_STEP,
  cornerLabels,
  cornerTickSegments,
  gridSegments,
} from '../objects/ground-layout';

const BOUNDS = { x: 0, y: 0, width: 3200, height: 2400 };

describe('格网：深色格网 64px', () => {
  test('步距为 64px，横纵各覆盖整个战场', () => {
    expect(GROUND_GRID_STEP).toBe(64);
    const segments = gridSegments(BOUNDS);
    const verticals = segments.filter((segment) => segment.x1 === segment.x2);
    const horizontals = segments.filter((segment) => segment.y1 === segment.y2);
    // 3200/64 + 1 = 51 条竖线；2400/64 + 1 = 38 条横线（末位有余数也补一条）。
    expect(verticals.length).toBe(Math.floor(BOUNDS.width / GROUND_GRID_STEP) + 1);
    expect(horizontals.length).toBe(Math.floor(BOUNDS.height / GROUND_GRID_STEP) + 1);
    for (const segment of verticals) {
      expect(segment.y1).toBe(BOUNDS.y);
      expect(segment.y2).toBe(BOUNDS.y + BOUNDS.height);
    }
  });

  test('相邻竖线间距 = 步距', () => {
    const verticals = gridSegments(BOUNDS).filter((segment) => segment.x1 === segment.x2);
    expect(verticals[1].x1 - verticals[0].x1).toBe(GROUND_GRID_STEP);
  });
});

describe('四角坐标刻度', () => {
  test('四个角各两条 L 形线段', () => {
    const segments = cornerTickSegments(BOUNDS);
    expect(segments).toHaveLength(8);
    for (const segment of segments) {
      const onLeft = segment.x1 === BOUNDS.x || segment.x2 === BOUNDS.x;
      const onRight = segment.x1 === BOUNDS.x + BOUNDS.width || segment.x2 === BOUNDS.x + BOUNDS.width;
      const onTop = segment.y1 === BOUNDS.y || segment.y2 === BOUNDS.y;
      const onBottom = segment.y1 === BOUNDS.y + BOUNDS.height || segment.y2 === BOUNDS.y + BOUNDS.height;
      expect(onLeft || onRight || onTop || onBottom).toBe(true);
    }
  });

  test('四个角的坐标标签', () => {
    const labels = cornerLabels(BOUNDS);
    expect(labels.map((label) => label.text)).toEqual(['0,0', '3200,0', '0,2400', '3200,2400']);
  });
});
