/**
 * 文件职责：把 camera-math 算好的钳制位姿写进 Phaser 相机，并对外提供平移 / 缩放 / 视口同步入口。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §2「world/camera 镜头控制（平移/缩放/边界）」。
 * 输入：一个结构化相机引用（Phaser.Cameras.Scene2D.Camera 天然满足）、视口尺寸读取函数、世界边界、缩放上下限。
 * 输出：受钳制保护的相机位姿；每次位姿实质变化后触发 onChange 回调（供场景上报 camera.moved）。
 * 禁止事项：
 *   1. import phaser —— 只依赖下面的 CameraTarget 结构类型，保持本文件可在 node 下单测；
 *   2. 在这里重写一遍钳制规则 —— 规则只在 ./camera-math，重复实现必然两边打架；
 *   3. 直接 import core/bus 发事件 —— 上报是 bridge/bus-adapter 的职责，本文件只给回调；
 *   4. 缓存视口尺寸 —— 窗口会变，视口必须每次从相机现读，否则 resize 后边界钳制用的是旧尺寸。
 *
 * ★ 橡皮筋越界（@since v3.3，task_079）：位姿本身**永远**在边界内（钳制不变），
 *   拖拽拉出边界时另有一份「外显偏移」叠加到 scroll 上（setOvershoot）——
 *   位姿是真相（上报 / 小地图框都按它算），偏移只是视觉上的「拉得动但到不了」，
 *   松手回弹时归零。两者分开，就不会出现「相机跑到世界外还要再拉回来」的乱账。
 */

import type { Bounds, Point } from '../../core/types';

import {
  DEFAULT_WORLD_BOUNDS,
  DEFAULT_ZOOM,
  DEFAULT_ZOOM_LIMITS,
  isSamePose,
  panCameraPose,
  resolveCameraPose,
  zoomCameraPose,
  type CameraLimits,
  type CameraPose,
  type Viewport,
} from './camera-math';

/**
 * 相机需要暴露的最小结构面。
 * why 用结构类型而不是 Phaser.Cameras.Scene2D.Camera：类型 import 虽不产生运行时依赖，
 * 但这样连类型层面的耦合也一并去掉，单测可以直接传一个普通对象。
 */
export interface CameraTarget {
  scrollX: number;
  scrollY: number;
  /** 视口像素宽（Phaser 里是相机宽，不是世界宽）。 */
  width: number;
  height: number;
  zoom: number;
}

export interface CameraControllerOptions {
  /** 现读视口尺寸（Phaser 场景传 () => ({ width: this.scale.width, height: this.scale.height })）。 */
  readonly viewport: () => Viewport;
  readonly worldBounds?: Bounds;
  readonly limits?: CameraLimits;
  /** 初始位姿；省略时取世界正中 + DEFAULT_ZOOM。 */
  readonly initial?: CameraPose;
  /** 位姿实质变化时回调（场景在这里转成 camera.moved）。 */
  readonly onChange?: (pose: CameraPose) => void;
}

/**
 * 相机控制器：把 camera-math 钳制后的位姿写进 Phaser 相机，并提供平移 / 缩放 / 视口同步入口。
 * 位姿没有实质变化时不触发 onChange —— 调用方可据此跳过重绘与上报（perf）。
 */
export class CameraController {
  private readonly camera: CameraTarget;
  private readonly options: CameraControllerOptions;
  private readonly limits: CameraLimits;
  private readonly worldBounds: Bounds;
  private pose: CameraPose;
  /** 橡皮筋外显偏移（世界坐标）：拖拽拉出边界时叠加到 scroll 上，松手回弹归零。 */
  private overshoot: Point = { x: 0, y: 0 };

  constructor(camera: CameraTarget, options: CameraControllerOptions) {
    this.camera = camera;
    this.options = options;
    this.limits = options.limits ?? DEFAULT_ZOOM_LIMITS;
    this.worldBounds = options.worldBounds ?? DEFAULT_WORLD_BOUNDS;

    // 初始位姿也要过一遍钳制：世界比视口还小时，不钳制会让开局镜头直接落在世界之外
    const initial: CameraPose =
      options.initial ??
      ({
        center: {
          x: this.worldBounds.x + this.worldBounds.width / 2,
          y: this.worldBounds.y + this.worldBounds.height / 2,
        },
        zoom: DEFAULT_ZOOM,
      } satisfies CameraPose);

    this.pose = resolveCameraPose(initial, options.viewport(), this.limits, this.worldBounds);
    this.writeToCamera(this.pose);
  }

  /** 当前位姿（世界坐标口径的视口中心 + 缩放）。位姿**永远**在边界内。 */
  get current(): CameraPose {
    return this.pose;
  }

  /** 当前**视觉**中心 = 钳制位姿 + 橡皮筋偏移（拖拽越界时两者不同）。 */
  get visualCenter(): Point {
    return { x: this.pose.center.x + this.overshoot.x, y: this.pose.center.y + this.overshoot.y };
  }

  /**
   * 设置橡皮筋外显偏移（世界坐标；task_079 的「边界回弹」）。
   *
   * why 不改位姿：位姿是上报 / 小地图视野框的真相，必须始终在边界内；
   *   偏移只是「拉过头时相机多走的那一点」，松手回弹时归零即可。
   * 不触发 onChange —— 位姿没变，上报的语义也就没变（perf：不制造无意义的上报）。
   */
  setOvershoot(offset: Point): void {
    const x = Number.isFinite(offset.x) ? offset.x : 0;
    const y = Number.isFinite(offset.y) ? offset.y : 0;
    if (x === this.overshoot.x && y === this.overshoot.y) return;
    this.overshoot = { x, y };
    this.writeToCamera(this.pose);
  }

  /** 橡皮筋偏移归零（回弹结束 / 开始新的一次拖拽）。 */
  clearOvershoot(): void {
    this.setOvershoot({ x: 0, y: 0 });
  }

  /** 应用一个外部给定位姿（会被钳制）。 */
  apply(pose: CameraPose): CameraPose {
    return this.commit(resolveCameraPose(pose, this.options.viewport(), this.limits, this.worldBounds));
  }

  /** 以世界坐标为单位平移。 */
  panBy(dx: number, dy: number): CameraPose {
    return this.commit(
      panCameraPose(this.pose, dx, dy, this.options.viewport(), this.limits, this.worldBounds)
    );
  }

  /** 按倍率缩放（>1 拉近）。 */
  zoomBy(factor: number): CameraPose {
    return this.commit(
      zoomCameraPose(this.pose, factor, this.options.viewport(), this.limits, this.worldBounds)
    );
  }

  /**
   * 视口尺寸变化后重新钳制（窗口 resize）。
   * why 需要显式调用：Phaser 会在 resize 时直接改相机宽高，但不会替我们重算边界。
   *
   * why 这里**不**走 commit()：位姿（中心 + 缩放）没变时 commit 会跳过写回，
   *   可视口变了就意味着 scroll 的换算（center - width/2）也变了 —— 不重写的话，
   *   相机会停在按旧视口算出来的 scroll 上，画面整体偏一边（战场中心的单位被推到屏幕边缘）。
   */
  syncViewport(): CameraPose {
    const next = resolveCameraPose(this.pose, this.options.viewport(), this.limits, this.worldBounds);
    const changed = !isSamePose(this.pose, next);
    this.pose = next;
    this.writeToCamera(next);
    if (changed) this.options.onChange?.(next);
    return this.pose;
  }

  /** 钳制 → 写回相机 → 位姿真变了才通知上层（perf：无变化不重绘、不上报）。 */
  private commit(next: CameraPose): CameraPose {
    if (!isSamePose(this.pose, next)) {
      this.pose = next;
      this.writeToCamera(next);
      this.options.onChange?.(next);
    }
    return this.pose;
  }

  /**
   * 世界中心 → Phaser scroll 的换算。
   * why 是 scrollX = center.x - width/2：Phaser 内部定义 midPoint = scrollX + width/2，
   * 且 midPoint 与 zoom 无关（缩放只影响 worldView 的尺寸），所以这里不需要乘除 zoom。
   * 橡皮筋偏移（overshoot）直接叠加在中心上：它是世界坐标的额外位移，
   *   与 zoom 无关（缩放时越界量随之放大是自然的 —— 拉得更远 = 越界更多）。
   */
  private writeToCamera(pose: CameraPose): void {
    this.camera.zoom = pose.zoom;
    this.camera.scrollX = pose.center.x + this.overshoot.x - this.camera.width / 2;
    this.camera.scrollY = pose.center.y + this.overshoot.y - this.camera.height / 2;
  }
}
