/**
 * 文件职责：world ↔ core 的**双向总线桥**（本任务的核心通信件）。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §2「world/bridge/bus-adapter.ts」。
 * 输入：
 *   - state → 场景：订阅 core/bus 的 state 通道，收到 WorldState 后驱动 WorldScenePort 同步；
 *   - 场景 → core：场景调用本文件返回的 WorldEventSink，桥接层转成 WorldEvent 发回 core；
 *   - world 通道 → 场景（@since v3.17，task_038）：订阅 world 通道上的 task.started /
 *     completed / failed 生命周期事件（core/task 发出，挂在 world 通道 —— 见 types.ts 的取舍注），
 *     筛出这三条转给可选端口钩子 syncTaskEvent，驱动战场工作表现（objects/task-fx*）。
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
}

/** 场景侧的交互出口：场景调这四个方法，桥接层负责转成 WorldEvent 发给 core。 */
export interface WorldEventSink {
  unitClick(unitId: string, mods: ClickMods): void;
  selectionBox(bounds: Bounds): void;
  cameraMoved(center: Point, zoom: number): void;
  /** 补发被合并窗口吞掉的最后一次相机位姿（拖拽结束 / 滚轮停止时调用）。 */
  flushCamera(): void;
  /**
   * 上报单位落位 / 移动（@since v3.12，task_033）。
   * 桥接层只转发不合并：落位是低频事件（对账时新增才会发），
   * 高频移动的防抖归消费方（app 层持久化订阅者，2-5s 批量落库）。
   */
  unitPosition(unitId: string, x: number, y: number): void;
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

  // task_* 生命周期（@since v3.17，task_038）：core/task 发在 world 通道上的事件筛三条转场景。
  // why 订阅而不是让场景自己接 bus：world 侧进出 core 只有本桥一个口子（铁律），
  //   场景保持"只被驱动"的端口形态 —— 与 state 同一口径，也方便 destroy 一次退订干净。
  // why 在这里 switch 而不是抽个判定函数：event.task 只有在字面量 case 里才被 TS 收窄。
  const unsubscribeTasks = onWorldEvent((event: WorldEvent) => {
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

    selectionBox(bounds: Bounds): void {
      if (destroyed) return;
      emitWorldEvent({ type: 'selection.box', bounds });
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
      unsubscribeTasks();
    },
  };

  return bridge;
}
