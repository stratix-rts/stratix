/**
 * 单测：摄像机交互策略（world/camera/camera-nav.ts，task_079）。
 * 覆盖验收标准中的「缩放有边界」「边界回弹」「跟随/解除/回全景可用」：
 *   - 用户缩放区间 0.6-1.6x（越界即夹住）；
 *   - 全景位姿：整个战场装进视口；
 *   - 橡皮筋：越界量按阻力外显、内侧拖拽时恒为 0；
 *   - 双击判定：同单位 + 时间窗口内 + 位移不超容差；
 *   - 控制器：橡皮筋偏移只影响视觉 scroll，位姿（上报真相）始终在边界内。
 *
 * 这些模块刻意零 Phaser 依赖，故在 jest 的 node 环境直接跑。
 */

import {
  CameraController,
  USER_ZOOM_LIMITS,
  clampUserZoom,
  isDoubleClick,
  overviewPose,
  rubberBandDisplay,
  rubberBandOffset,
  zoomWithUserLimits,
  type CameraPose,
  type Viewport,
} from '../camera';

const BOUNDS = { x: 0, y: 0, width: 3200, height: 2400 };
const VIEWPORT: Viewport = { width: 1600, height: 900 };

describe('用户缩放区间（0.6-1.6x）', () => {
  test('区间取自唯一事实源', () => {
    expect(USER_ZOOM_LIMITS.minZoom).toBe(0.6);
    expect(USER_ZOOM_LIMITS.maxZoom).toBe(1.6);
  });

  test('向上缩放：逐格放大，到 1.6 即夹住', () => {
    let pose: CameraPose = { center: { x: 1600, y: 1200 }, zoom: 1 };
    for (let i = 0; i < 20; i += 1) {
      pose = { ...pose, zoom: zoomWithUserLimits(pose, 1.12) };
    }
    expect(pose.zoom).toBeCloseTo(1.6, 6);
  });

  test('向下缩放：逐格缩小，到 0.6 即夹住（缩放边界有回弹 = 硬夹住）', () => {
    let pose: CameraPose = { center: { x: 1600, y: 1200 }, zoom: 1 };
    for (let i = 0; i < 20; i += 1) {
      pose = { ...pose, zoom: zoomWithUserLimits(pose, 1 / 1.12) };
    }
    expect(pose.zoom).toBeCloseTo(0.6, 6);
  });

  test('全景态（zoom < 0.6）滚轮缩放时缓缓爬回区间，不「啪」地跳到 0.6', () => {
    const overview = overviewPose(VIEWPORT, BOUNDS);
    expect(overview.zoom).toBeLessThan(0.6);
    const zoomed = zoomWithUserLimits(overview, 1.12);
    expect(zoomed).toBeGreaterThan(overview.zoom);
    expect(zoomed).toBeLessThan(0.6);
  });

  test('clampUserZoom：非有限值落到下限；下界不高于当前缩放', () => {
    expect(clampUserZoom(Number.NaN)).toBe(0.6);
    expect(clampUserZoom(0.1, 0.1)).toBe(0.1);
    expect(clampUserZoom(9, 1)).toBe(1.6);
  });
});

describe('全景位姿（ESC 回全景）', () => {
  test('整个战场装进视口：按短边等比取缩放，中心落在战场正中', () => {
    const pose = overviewPose(VIEWPORT, BOUNDS);
    // min(1600/3200, 900/2400) = 0.375
    expect(pose.zoom).toBeCloseTo(0.375, 6);
    expect(pose.center.x).toBeCloseTo(1600, 6);
    expect(pose.center.y).toBeCloseTo(1200, 6);
  });

  test('视口够大时全景缩放 > 1（按硬护栏夹紧，不越界）', () => {
    const pose = overviewPose({ width: 6400, height: 4800 }, BOUNDS);
    expect(pose.zoom).toBeGreaterThan(1);
    expect(pose.zoom).toBeLessThanOrEqual(3);
  });
});

describe('橡皮筋：边界回弹', () => {
  test('内侧拖拽：越界量恒为 0（相机照常跟手）', () => {
    // 合法范围内的目标点：钳制后与目标相同 → 差值为 0（没有越界可外显）。
    const inside = { x: 1500, y: 1100 };
    expect(rubberBandOffset(inside, { ...inside })).toEqual({ x: 0, y: 0 });
  });

  test('越界拖拽：越界量 = 目标点 − 钳制点，只在越界的那一轴非零', () => {
    const offset = rubberBandOffset({ x: -200, y: 1200 }, { x: 0, y: 1200 });
    expect(offset.x).toBe(-200);
    expect(offset.y).toBe(0);
  });

  test('外显位移按阻力折算（拉得动，但到不了边界外）', () => {
    const display = rubberBandDisplay({ x: 100, y: -50 });
    expect(display.x).toBeCloseTo(28, 6);
    expect(display.y).toBeCloseTo(-14, 6);
  });

  test('外显位移有上限（一次长拖不会把相机拽出半张地图）', () => {
    const display = rubberBandDisplay({ x: 100_000, y: -100_000 });
    expect(display.x).toBe(120);
    expect(display.y).toBe(-120);
  });

  test('控制器：橡皮筋偏移只动视觉 scroll，位姿（上报真相）始终在边界内', () => {
    const camera = { scrollX: 0, scrollY: 0, width: 1000, height: 800, zoom: 1 };
    const controller = new CameraController(camera, {
      viewport: () => ({ width: 1000, height: 800 }),
      worldBounds: { x: 0, y: 0, width: 2000, height: 1000 },
    });
    // 拖到左边界外：位姿被钳回 x=500（半视口宽 500）
    controller.apply({ center: { x: -300, y: 500 }, zoom: 1 });
    expect(controller.current.center.x).toBe(500);

    controller.setOvershoot({ x: -20, y: 0 });
    expect(camera.scrollX).toBe(500 - 20 - 500);
    // 位姿没变 → 上报真相没变
    expect(controller.current.center.x).toBe(500);

    controller.clearOvershoot();
    expect(camera.scrollX).toBe(500 - 500);
  });
});

describe('双击判定（双击单位 = 跟随镜头）', () => {
  const base = { unitId: 'u1', timeMs: 1000, x: 100, y: 100 };

  test('同单位 + 窗口内 + 位移小 → 双击', () => {
    expect(isDoubleClick(base, { ...base, timeMs: 1200 })).toBe(true);
  });

  test('不同单位 → 不是双击', () => {
    expect(isDoubleClick(base, { ...base, unitId: 'u2', timeMs: 1050 })).toBe(false);
  });

  test('超出时间窗口（>320ms）→ 不是双击', () => {
    expect(isDoubleClick(base, { ...base, timeMs: 1000 + 400 })).toBe(false);
  });

  test('位移超容差（>8px）→ 不是双击（两次独立的点击）', () => {
    expect(isDoubleClick(base, { ...base, timeMs: 1050, x: 140 })).toBe(false);
  });

  test('没有上一次点击 → 不是双击', () => {
    expect(isDoubleClick(null, base)).toBe(false);
  });
});
