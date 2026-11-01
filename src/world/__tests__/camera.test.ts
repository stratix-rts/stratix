/**
 * 单测：相机钳制规则（camera/camera-math.ts + camera/camera-controller.ts）。
 * 覆盖验收标准中的"相机控制逻辑有单测覆盖（边界钳制）"。
 *
 * 注意：这两个模块刻意保持零 Phaser 依赖，因此可以在 jest 的 node 环境下直接跑。
 */

import {
  CameraController,
  clampCameraCenter,
  clampZoom,
  isSamePose,
  normalizeLimits,
  panCameraPose,
  resolveCameraPose,
  zoomCameraPose,
  DEFAULT_ZOOM_LIMITS,
  type Viewport,
} from '../camera';

// 视口 1000×800，世界 2000×1000，起点 (0,0)
const VIEWPORT: Viewport = { width: 1000, height: 800 };
const WORLD = { x: 0, y: 0, width: 2000, height: 1000 };
// zoom=1 时：半视口 x=500、y=400 → x 合法区间 [500,1500]，y 合法区间 [400,600]
const CENTER_AT_1X = { x: 1000, y: 500 };

describe('clampZoom', () => {
  test('区间内原样返回', () => {
    expect(clampZoom(1.5)).toBe(1.5);
  });

  test('低于下限被抬回下限', () => {
    expect(clampZoom(0.01)).toBe(DEFAULT_ZOOM_LIMITS.minZoom);
  });

  test('高于上限被压回上限', () => {
    expect(clampZoom(99)).toBe(DEFAULT_ZOOM_LIMITS.maxZoom);
  });

  test('非有限值一律落到下限，不让相机跳到不可控位置', () => {
    expect(clampZoom(Number.NaN)).toBe(DEFAULT_ZOOM_LIMITS.minZoom);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(DEFAULT_ZOOM_LIMITS.minZoom);
  });

  test('zoom=0 会毁掉整个钳制公式，normalizeLimits 必须挡住', () => {
    expect(normalizeLimits({ minZoom: 0, maxZoom: 2 }).minZoom).toBeGreaterThan(0);
  });

  test('配置写反（min > max）也能收敛成一个可用区间', () => {
    const limits = normalizeLimits({ minZoom: 3, maxZoom: 0.5 });
    expect(limits.minZoom).toBeLessThanOrEqual(limits.maxZoom);
  });
});

describe('clampCameraCenter —— 边界钳制', () => {
  test('中心在世界内时不动', () => {
    expect(clampCameraCenter(CENTER_AT_1X, 1, VIEWPORT, WORLD)).toEqual(CENTER_AT_1X);
  });

  test('越出左边界的中心被拉回边界', () => {
    // 半视口 500 → 左边界中心必须 >= 500
    expect(clampCameraCenter({ x: -9999, y: 500 }, 1, VIEWPORT, WORLD).x).toBe(500);
  });

  test('越出右边界的中心被拉回边界', () => {
    // 右边界中心必须 <= 世界右(2000) - 半视口(500)
    expect(clampCameraCenter({ x: 9999, y: 500 }, 1, VIEWPORT, WORLD).x).toBe(1500);
  });

  test('上下边界同样被钳制（视口在 y 轴比世界矮，合法区间很窄）', () => {
    expect(clampCameraCenter({ x: 1000, y: -100 }, 1, VIEWPORT, WORLD).y).toBe(400);
    expect(clampCameraCenter({ x: 1000, y: 5000 }, 1, VIEWPORT, WORLD).y).toBe(600);
  });

  test('zoom 影响半视口：放大后活动范围收窄', () => {
    // zoom=2 → 半视口 x=250 → 合法区间 [250, 1750]
    const zoomed = clampCameraCenter({ x: 0, y: 500 }, 2, VIEWPORT, WORLD);
    expect(zoomed.x).toBe(250);
  });

  test('视口比世界还大时，该轴锁死在世界正中而不是飘出去', () => {
    // 视口 1000 宽 vs 世界 400 宽：无处可平，x 必须落在世界正中 200
    const smallWorld = { x: 0, y: 0, width: 400, height: 1000 };
    expect(clampCameraCenter({ x: 0, y: 500 }, 1, VIEWPORT, smallWorld).x).toBe(200);
    expect(clampCameraCenter({ x: 99999, y: 500 }, 1, VIEWPORT, smallWorld).x).toBe(200);
  });

  test('视口恰好等于世界：半视口*2 >= 世界尺寸 走正中分支，不会反解出非法区间', () => {
    const sameSize = { x: 0, y: 0, width: 1000, height: 800 };
    expect(clampCameraCenter({ x: 0, y: 0 }, 1, VIEWPORT, sameSize)).toEqual({ x: 500, y: 400 });
  });

  test('世界尺寸非法时贴回起点，不产生 NaN 坐标', () => {
    const broken = { x: 10, y: 20, width: 0, height: 0 };
    const center = clampCameraCenter({ x: 999, y: 999 }, 1, VIEWPORT, broken);
    expect(center).toEqual({ x: 10, y: 20 });
    expect(Number.isNaN(center.x)).toBe(false);
  });

  test('中心坐标为 NaN 时兜底到世界起点', () => {
    const center = clampCameraCenter({ x: Number.NaN, y: Number.NaN }, 1, VIEWPORT, WORLD);
    expect(Number.isNaN(center.x)).toBe(false);
    expect(Number.isNaN(center.y)).toBe(false);
  });

  test('直接调用时自行兜住非法 zoom（不假设上游已 clamp）', () => {
    const center = clampCameraCenter({ x: 0, y: 500 }, Number.NaN, VIEWPORT, WORLD);
    expect(Number.isFinite(center.x)).toBe(true);
  });
});

describe('resolveCameraPose', () => {
  test('先钳 zoom 再钳中心（顺序反了会用错半视口）', () => {
    const pose = resolveCameraPose(
      { center: { x: 0, y: 500 }, zoom: 999 },
      VIEWPORT,
      DEFAULT_ZOOM_LIMITS,
      WORLD
    );
    expect(pose.zoom).toBe(DEFAULT_ZOOM_LIMITS.maxZoom);
    // zoom=3 → 半视口 1000/6 ≈ 166.7 → x 被钳到 ≈166.7
    expect(pose.center.x).toBeCloseTo(1000 / (2 * 3), 5);
  });

  test('非法输入整体收敛成合法位姿', () => {
    const pose = resolveCameraPose(
      { center: { x: Number.NaN, y: Number.POSITIVE_INFINITY }, zoom: Number.NaN },
      VIEWPORT,
      DEFAULT_ZOOM_LIMITS,
      WORLD
    );
    expect(Number.isFinite(pose.center.x)).toBe(true);
    expect(Number.isFinite(pose.center.y)).toBe(true);
    expect(pose.zoom).toBe(DEFAULT_ZOOM_LIMITS.minZoom);
  });
});

describe('panCameraPose / zoomCameraPose', () => {
  test('平移出界后被钳回', () => {
    const pose = panCameraPose({ center: CENTER_AT_1X, zoom: 1 }, -5000, 0, VIEWPORT, DEFAULT_ZOOM_LIMITS, WORLD);
    expect(pose.center.x).toBe(500);
  });

  test('平移量在世界内则精确生效', () => {
    const pose = panCameraPose({ center: CENTER_AT_1X, zoom: 1 }, 100, 50, VIEWPORT, DEFAULT_ZOOM_LIMITS, WORLD);
    expect(pose.center).toEqual({ x: 1100, y: 550 });
  });

  test('缩放倍率被上下限截断', () => {
    const zoomedIn = zoomCameraPose({ center: CENTER_AT_1X, zoom: 1 }, 1000, VIEWPORT, DEFAULT_ZOOM_LIMITS, WORLD);
    expect(zoomedIn.zoom).toBe(DEFAULT_ZOOM_LIMITS.maxZoom);
    const zoomedOut = zoomCameraPose({ center: CENTER_AT_1X, zoom: 1 }, 0.0001, VIEWPORT, DEFAULT_ZOOM_LIMITS, WORLD);
    expect(zoomedOut.zoom).toBe(DEFAULT_ZOOM_LIMITS.minZoom);
  });

  test('非法缩放倍率不改变位姿（仍走钳制返回合法值）', () => {
    const pose = zoomCameraPose({ center: CENTER_AT_1X, zoom: 1 }, 0, VIEWPORT, DEFAULT_ZOOM_LIMITS, WORLD);
    expect(pose.zoom).toBe(1);
  });
});

describe('isSamePose', () => {
  test('逐字段比较，值相同即视为无变化', () => {
    const a = { center: { x: 1, y: 2 }, zoom: 1 };
    expect(isSamePose(a, { center: { x: 1, y: 2 }, zoom: 1 })).toBe(true);
    expect(isSamePose(a, { center: { x: 1.5, y: 2 }, zoom: 1 })).toBe(false);
    expect(isSamePose(a, { center: { x: 1, y: 2 }, zoom: 2 })).toBe(false);
  });
});

describe('CameraController（结构化相机替身，不启动 Phaser）', () => {
  /** Phaser 相机的最小替身：scrollX/scrollY/width/height/zoom 五个可写字段。 */
  function createFakeCamera(width = 1000, height = 800) {
    return { scrollX: 0, scrollY: 0, width, height, zoom: 1 };
  }

  test('构造时就把初始位姿写进相机', () => {
    const camera = createFakeCamera();
    new CameraController(camera, {
      viewport: () => ({ width: camera.width, height: camera.height }),
      worldBounds: WORLD,
      initial: { center: { x: 1000, y: 500 }, zoom: 1 },
    });
    // worldCenter = scrollX + width/2 → scrollX 应为 1000 - 500
    expect(camera.scrollX).toBe(500);
    expect(camera.scrollY).toBe(100);
    expect(camera.zoom).toBe(1);
  });

  test('平移越界被钳制（验收点：边界钳制在控制器上也成立）', () => {
    const camera = createFakeCamera();
    const controller = new CameraController(camera, {
      viewport: () => ({ width: camera.width, height: camera.height }),
      worldBounds: WORLD,
      initial: { center: CENTER_AT_1X, zoom: 1 },
    });

    controller.panBy(-99999, 0);
    expect(controller.current.center.x).toBe(500);
    expect(camera.scrollX).toBe(0);
  });

  test('缩放被上下限钳制并写回相机', () => {
    const camera = createFakeCamera();
    const controller = new CameraController(camera, {
      viewport: () => ({ width: camera.width, height: camera.height }),
      worldBounds: WORLD,
      initial: { center: CENTER_AT_1X, zoom: 1 },
    });

    controller.zoomBy(1000);
    expect(controller.current.zoom).toBe(DEFAULT_ZOOM_LIMITS.maxZoom);
    expect(camera.zoom).toBe(DEFAULT_ZOOM_LIMITS.maxZoom);
  });

  test('位姿无实质变化时不触发 onChange（perf：无变化不重绘不上报）', () => {
    const camera = createFakeCamera();
    const onChange = jest.fn();
    const controller = new CameraController(camera, {
      viewport: () => ({ width: camera.width, height: camera.height }),
      worldBounds: WORLD,
      initial: { center: CENTER_AT_1X, zoom: 1 },
      onChange,
    });

    controller.panBy(-99999, 0); // 第一次越界平移：位姿确实变了
    expect(onChange).toHaveBeenCalledTimes(1);

    controller.panBy(-99999, 0); // 已经在左边界，位姿不变
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('syncViewport 在视口变化后重新收紧边界（resize 场景）', () => {
    const camera = createFakeCamera(1000, 800);
    const controller = new CameraController(camera, {
      viewport: () => ({ width: camera.width, height: camera.height }),
      worldBounds: WORLD,
      initial: { center: { x: 500, y: 500 }, zoom: 1 },
    });
    expect(controller.current.center.x).toBe(500); // 视口 1000 宽时左边界中心就是 500

    // 窗口拉宽到 1600：半视口 800 → 合法区间收窄成 [800,1200]，原本贴边的 500 被推回 800。
    // Phaser 自己不会替我们重算边界，必须显式调用 syncViewport。
    camera.width = 1600;
    controller.syncViewport();
    expect(controller.current.center.x).toBe(800);
    expect(camera.scrollX).toBe(800 - 800);
  });

  test('位姿没变但视口变了 → 仍要重写 scroll（resize 后画面不能偏一边）', () => {
    // @since v3.9（task_026）：窗口尺寸变化时位姿（中心 + 缩放）往往没变，
    // 但 scroll 的换算（center - width/2）跟着视口变 —— 不重写的话相机会停在旧 scroll 上，
    // 战场中心的单位被推到屏幕边缘（用户看不到刚建好的角色）。
    const camera = createFakeCamera(1000, 800);
    const controller = new CameraController(camera, {
      viewport: () => ({ width: camera.width, height: camera.height }),
      worldBounds: WORLD,
      initial: { center: { x: 1000, y: 500 }, zoom: 1 },
    });
    expect(camera.scrollX).toBe(1000 - 500);

    // 视口变窄，位姿本身仍然合法（中心 1000 在 [200,1800] 内）→ 中心不变
    camera.width = 400;
    controller.syncViewport();

    expect(controller.current.center.x).toBe(1000);
    expect(camera.scrollX).toBe(1000 - 200);
  });
});
