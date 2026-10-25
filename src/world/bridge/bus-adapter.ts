/**
 * 文件职责：world ↔ core 的**双向总线桥**（本任务的核心通信件）。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §2「world/bridge/bus-adapter.ts」。
 * 输入：
 *   - state → 场景：订阅 core/bus 的 state 通道，收到 WorldState 后驱动 WorldScenePort 同步；
 *   - 场景 → core：场景调用本文件返回的 WorldEventSink，桥接层转成 WorldEvent 发回 core；
 *   - world 通道 → 场景（@since v3.17，task_038）：订阅 world 通道上的 task.started /
 *     completed / failed 生命周期事件（core/task 发出，挂在 world 通道 —— 见 types.ts 的取舍注），
 *     筛出这三条转给可选端口钩子 syncTaskEvent，驱动战场工作表现（objects/task-fx*）；
 *   - world 通道 → 场景（@since v3.21，task_045）：同一条订阅还转发 unit.position ——
 *     右击移动时 runtime 把编队终值广播出来，场景据此更新 UnitObject（立即）并 tween（表现）。
 * 输出：端口回调（渲染侧）+ bus 的 world 通道（业务侧）。
 * 禁止事项：
 *   1. import phaser 或任何 hud / vue / legacy(stratix-rts) 文件 —— 铁律：world 只认识 core/types 与 core/bus；
 *   2. 缓存 WorldState 或做业务判断 —— 状态真相在 core，本文件只转发，不解释"选择意味着什么"；
 *   3. 泄漏监听器 —— destroy() 必须退订（state 与 task 两条订阅），否则场景每次重启都会多挂一个订阅（perf：资源必须可清理）；
 *   4. 逐帧无节制广播 camera.moved —— 拖拽与滚轮每帧都在动相机，必须合并上报。
 */

import { emitWorldEvent, onState, onWorldEvent } from '../../core/bus';
import type {
  Bounds,
  CharacterTask,
  ClickMods,
  Point,
  SelectionState,
  UnitView,
  WorldEvent,
  WorldState,
} from '../../core/types';
import type { TaskFxPhase } from '../objects/task-fx';

export type { TaskFxPhase } from '../objects/task-fx';

/** 相机事件的最小上报间隔（ms）。窗口内只保留最后一个位姿，等 flush 或下一次放行再发。 */
export const CAMERA_EVENT_INTERVAL_MS = 120;

/** 场景侧需要被 state 驱动的接口（由 BattlefieldScene 实现）。 */
export interface WorldScenePort {
  syncUnits(units: readonly UnitView[]): void;
  syncSelection(selection: SelectionState): void;
  /**
   * 任务生命周期 → 战场表现钩子（@since v3.17，task_038）。
   * 可选成员：老桩 / 单测 port 不实现也不破编译（事件没人接就安静跳过）。
   * 桥接层只转发 task.started / completed / failed 三条；场景负责 characterId → 单位映射
   * （objects/task-fx.ts 的 applyTaskFxEvent）与表现更新（objects/task-fx-layer.ts）。
   */
  syncTaskEvent?(task: CharacterTask, phase: TaskFxPhase): void;
  /**
   * 单位位置同步钩子（@since v3.21，task_045）：world 通道上的 unit.position 转发进场景 ——
   * 右击移动时 runtime 把编队终值广播出来，场景据此更新 UnitObject（位置真相立即生效）
   * 并 tween 过渡（纯渲染）。可选成员：不实现不破编译（同 syncTaskEvent 惯例）。
   * 回环无害：场景自己上报的落位也会走这条转发回来 —— 场景侧应用是幂等的（位置相同即 no-op）。
   */
  syncUnitPosition?(unitId: string, x: number, y: number): void;
}

/** 场景侧的交互出口：场景调这些方法，桥接层负责转成 WorldEvent 发给 core。 */
export interface WorldEventSink {
  unitClick(unitId: string, mods: ClickMods): void;
  /**
   * 框选上报（@since v3.21，task_045：命中判定补全）。bounds 原样上报；
   * hitUnitIds 给了就把命中结果一并补在事件上（core 无坐标算不出命中）—— 空数组也是
   * 有意义的选择（拖空框/点空地 = 清空选择）；additive = Shift 加选。
   */
  selectionBox(bounds: Bounds, hitUnitIds?: readonly string[], additive?: boolean): void;
  cameraMoved(center: Point, zoom: number): void;
  /** 补发被合并窗口吞掉的最后一次相机位姿（拖拽结束 / 滚轮停止时调用）。 */
  flushCamera(): void;
  /**
   * 上报单位落位 / 移动（@since v3.12，task_033）。
   * 桥接层只转发不合并：落位是低频事件（对账时新增才会发），
   * 高频移动的防抖归消费方（app 层持久化订阅者，2-5s 批量落库）。
   */
  unitPosition(unitId: string, x: number, y: number): void;
  /**
   * 右击移动指令（@since v3.21，task_045）：把选中编队移动到目标点（世界坐标）。
   * 走 WorldEvent 的 unit.move（铁律：世界层不发 HudCommand）；runtime 与 HudCommand
   * 的 unit.move 共用同一套编队落位（core/unit/formation）与 unit.position 终值广播。
   */
  unitMove(unitIds: readonly string[], x: number, y: number): void;
}

export interface WorldBridge extends WorldEventSink {
  /** 退订总线。场景 shutdown 时必须调用。 */
  destroy(): void;
}

export interface WorldBridgeOptions {
  /** 时钟注入（默认 Date.now），供单测确定性地推进合并窗口。 */
  readonly now?: () => number;
}

/**
 * 建立 world ↔ core 的双向桥接。
 * why 订阅与构造绑定而不是再给一个 start()：桥接层生命周期 = 场景生命周期，
 * 少一个状态就少一处可能忘记调用的地方；不需要订阅时直接 destroy()。
 */
export function createWorldBridge(
  port: WorldScenePort,
  options: WorldBridgeOptions = {}
): WorldBridge {
  const now = options.now ?? Date.now;

  let destroyed = false;
  // null 表示"还没发过"：首个相机事件必须直接放行。
  // 用 0 当初值只对 Date.now() 这类时间基准成立，换成从 0 起步的注入时钟会把开场位姿吞进合并窗口。
  let lastCameraEmitAt: number | null = null;
  let pendingCamera: { center: Point; zoom: number } | null = null;

  const unsubscribeState = onState((state: WorldState) => {
    if (destroyed) return;
    port.syncUnits(state.units);
    port.syncSelection(state.selection);
  });

  // world 通道 → 场景（@since v3.17，task_038；@since v3.21，task_045 补 unit.position）：
  //   task.* 生命周期（core/task 发出）筛三条转 syncTaskEvent；unit.position（runtime 发出的
  //   右击移动终值，或场景上报的回环）转 syncUnitPosition。
  // why 订阅而不是让场景自己接 bus：world 侧进出 core 只有本桥一个口子（铁律），
  //   场景保持"只被驱动"的端口形态 —— 与 state 同一口径，也方便 destroy 一次退订干净。
  // why 在这里 switch 而不是抽个判定函数：event.task 只有在字面量 case 里才被 TS 收窄。
  const unsubscribeWorldEvents = onWorldEvent((event: WorldEvent) => {
    if (destroyed) return;
    switch (event.type) {
      case 'task.started':
        port.syncTaskEvent?.(event.task, 'started');
        break;
      case 'task.completed':
        port.syncTaskEvent?.(event.task, 'completed');
        break;
      case 'task.failed':
        port.syncTaskEvent?.(event.task, 'failed');
        break;
      case 'unit.position':
        // 场景自己上报的落位也会回到这里（同一通道）—— 场景侧幂等，重复应用是 no-op。
        port.syncUnitPosition?.(event.unitId, event.x, event.y);
        break;
      default:
        break;
    }
  });

  const emitCamera = (center: Point, zoom: number): void => {
    lastCameraEmitAt = now();
    pendingCamera = null;
    emitWorldEvent({ type: 'camera.moved', center, zoom });
  };

  const bridge: WorldBridge = {
    unitClick(unitId: string, mods: ClickMods): void {
      // 场景已 destroy 后的迟到输入直接丢弃：core 收到的事件必须对应一个活着的场景
      if (destroyed) return;
      emitWorldEvent({ type: 'unit.click', unitId, mods });
    },

    selectionBox(bounds: Bounds, hitUnitIds?: readonly string[], additive?: boolean): void {
      if (destroyed) return;
      // 带 id 才补字段：不带 id 的调用保持老事件形状（dev 观测 / 单测夹具原样可见）。
      const event: WorldEvent =
        hitUnitIds === undefined
          ? { type: 'selection.box', bounds }
          : { type: 'selection.box', bounds, unitIds: [...hitUnitIds], additive: additive === true };
      emitWorldEvent(event);
    },

    unitMove(unitIds: readonly string[], x: number, y: number): void {
      if (destroyed) return;
      emitWorldEvent({ type: 'unit.move', unitIds: [...unitIds], x, y });
    },

    unitPosition(unitId: string, x: number, y: number): void {
      if (destroyed) return;
      emitWorldEvent({ type: 'unit.position', unitId, x, y });
    },

    cameraMoved(center: Point, zoom: number): void {
      if (destroyed) return;
      const elapsed = lastCameraEmitAt === null ? Number.POSITIVE_INFINITY : now() - lastCameraEmitAt;
      if (elapsed < CAMERA_EVENT_INTERVAL_MS) {
        // 窗口内不广播，只留最后一个位姿；避免拖拽/滚轮把总线打爆
        pendingCamera = { center, zoom };
        return;
      }
      emitCamera(center, zoom);
    },

    flushCamera(): void {
      if (destroyed || pendingCamera === null) return;
      emitCamera(pendingCamera.center, pendingCamera.zoom);
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      pendingCamera = null;
      unsubscribeState();
      unsubscribeWorldEvents();
    },
  };

  return bridge;
}
