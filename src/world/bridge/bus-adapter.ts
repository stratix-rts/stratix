/**
 * 文件职责：world ↔ core 的**双向总线桥**（本任务的核心通信件）。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §2「world/bridge/bus-adapter.ts」。
 * 输入：
 *   - state → 场景：订阅 core/bus 的 state 通道，收到 WorldState 后驱动 WorldScenePort 同步；
 *   - 场景 → core：场景调用本文件返回的 WorldEventSink，桥接层转成 WorldEvent 发回 core；
 *   - world 通道 → 场景（@since v3.17，task_038）：订阅 world 通道上的 task.started /
 *     completed / failed 生命周期事件（core/task 发出，挂在 world 通道 —— 见 types.ts 的取舍注），
 *     筛出这三条转给可选端口钩子 syncTaskEvent，驱动战场工作表现（objects/task-fx*）；
 *   - state 通道 → 场景（@since v3.3，task_078）：missions + tasks 一并转发 syncTasks，
 *     驱动地图上的任务建筑三态与区域点亮（objects/task-building*）；
 *     @since v3.25（task_049）追加转发 task.awaiting_approval（挂起画 ?）与 task.approved
 *     （折算 started —— 批准后回工作环）；
 *   - world 通道 → 场景（@since v3.21，task_045）：同一条订阅还转发 unit.position ——
 *     右击移动时 runtime 把编队终值广播出来，场景据此更新 UnitObject（立即）并 tween（表现）；
 *     @since v3.33（task_057）：再转发 camera.center（HudCommand 同名命令经 core 钳制后的
 *     小地图跳转指令）→ syncCameraCenter，场景把相机对中到目标世界点；
 *     @since v3.3（task_080）：再转发 camera.shake（HudCommand 同名命令经 core 钳制后的
 *     里程碑震动指令）→ syncCameraShake，场景给相机一记小震；
 *     @since v3.37（task_062）：再转发 unit.speaking（app 层 chat-service 流式期间的说话
 *     标志位广播）→ syncUnitSpeaking，场景驱动头顶「···」气泡起止；
 *     @since v3.4（task_092）：再转发 focus.unit（HUD 事件轨条目点击经 core 转发的同名事件）
 *     → syncFocusUnit，场景驱动被点单位的描边高亮与引导弧线。
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
  MissionView,
  Point,
  ReplayBeat,
  SelectionState,
  SoundCue,
  UnitView,
  WorldEvent,
  WorldState,
} from '../../core/types';
import type { DirectorEventKind } from '../camera/director-policy';
import type { TaskFxPhase } from '../objects/task-fx';
import type { SpeechKind } from '../speech-templates';

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
  /**
   * 相机跳转钩子（@since v3.33，task_057）：world 通道上的 camera.center（HudCommand 同名
   * 命令经 core 钳制后的转发形态）转发进场景 —— 小地图点击/拖拽把相机对中到目标世界点。
   * 可选成员：不实现不破编译（同 syncTaskEvent 惯例）；场景侧落位时仍过 camera-math 的
   * 视口钳制（比 core 的点钳制多一层视口半宽，双重钳制同源无害）。
   */
  syncCameraCenter?(x: number, y: number): void;
  /**
   * 镜头震动钩子（@since v3.3，task_080）：world 通道上的 camera.shake（HudCommand 同名命令
   *   经 core 钳制后的转发形态）转发进场景 —— 里程碑大字落下时的一记小震（Phaser 相机 shake）。
   *   可选成员：不实现不破编译（同 syncCameraCenter 惯例）。
   *   why 走 world 通道：震动是**瞬态表现**，既不进 WorldState 也不该由 hud 直接调 world
   *   （铁律）—— 与 camera.center 同一两段式（命令 hud → core，事件 core → world）。
   */
  syncCameraShake?(durationMs: number, intensity: number): void;
  /**
   * 单位说话状态钩子（@since v3.37，task_062）：world 通道上的 unit.speaking
   * （app 层 chat-service 在流式期间发的标志位广播）转发进场景 —— 头顶「···」气泡起止。
   * 可选成员：不实现不破编译（同 syncTaskEvent 惯例）。hud 不直接驱动 world（铁律），
   * 抽屉的流式状态只能经 app 层翻译成世界事件走本通道落地。
   */
  syncUnitSpeaking?(unitId: string, speaking: boolean): void;
  /**
   * 任务全景钩子（@since v3.3，task_078）：state 通道上的 missions + tasks 转发进场景 ——
   * 战场的「任务建筑三态 / 区域点亮」由 core 的任务状态驱动（区域 = 编组任务，建筑 = 角色任务）。
   * 可选成员：不实现不破编译（同上惯例）。
   * why 走 state 通道而不是 world 事件：建筑三态要的是**当前快照**（每条任务的相位），
   * 事件流只给增量、还得自己拼状态 —— 快照口径与 units / selection 一致，少一份真相。
   */
  syncTasks?(missions: readonly MissionView[], tasks: readonly CharacterTask[]): void;
  /**
   * 任务气泡钩子（@since v3.3，task_076）：world 通道上的 task.queued / started / completed / failed
   * 转发进场景 —— 单位头顶冒离线模板气泡（句库见 world/speech-templates.ts）。
   * 可选成员：不实现不破编译（同 syncTaskEvent 惯例）。
   * why 走 world 通道：任务生命周期事件本来就在这条通道上（core/task 发出），
   *   气泡只是这些事件的**表现投影** —— world 只消费不生产（总线铁律）。
   */
  syncTaskSpeech?(task: CharacterTask, kind: SpeechKind): void;
  /**
   * 指定文案气泡钩子（@since v3.3，task_076）：world 通道上的 unit.bubble
   * （world 层当场指挥，原话已定 —— 例如「收到」）转发进场景，按原话冒泡。
   * 可选成员：不实现不破编译（同上惯例）。
   */
  syncUnitBubble?(unitId: string, text: string): void;
  /**
   * 回放节拍钩子（@since v3.3，task_082）：world 通道上的 replay.beat
   * （hud 侧回放控制器发的重演指令）转发进场景 —— 战场按节拍重演当天的事件
   * （化身出现 / 干活 / 插旗 / 冒泡）。
   * 可选成员：不实现不破编译（同上惯例）。
   * why 走 world 通道而不是 state 通道：回放是**瞬态指令**（不进 WorldState，
   *   也不该留在状态快照里 —— 它是"把今天再演一遍"，不是"今天是什么"）。
   */
  syncReplayBeat?(beat: ReplayBeat): void;
  /**
   * 导演模式事件钩子（@since v3.3，task_081）：world 通道上的 task.started / completed / failed
   * 转发进场景 —— 导演控制器据此编排镜头（缓动到事件点 → 停留 → 回全景）。
   * 可选成员：不实现不破编译（同上惯例）。
   * why 复用 task.* 事件而不是新开一条通道：导演关心的正是这三条生命周期事件
   *   （开工 / 完成 / 报错），core/task 本来就在 world 通道上发它们 —— 导演只是这些事件的
   *   **表现投影**（world 只消费不生产，总线铁律）。
   */
  syncDirectorEvent?(task: CharacterTask, kind: DirectorEventKind): void;
  /**
   * 导演模式开关钩子（@since v3.3，task_081）：world 通道上的 camera.director
   * （hud 顶栏「🎬 导演」按钮经 core 转发的落位指令）转发进场景 —— 导演控制器接管 / 交还镜头。
   * 可选成员：不实现不破编译（同上惯例）。
   */
  syncDirectorMode?(enabled: boolean): void;
  /**
   * 单位联动钩子（@since v3.4，task_092）：world 通道上的 focus.unit
   * （HUD 事件轨条目点击 → core 转发的同名事件）转发进场景 —— 被点单位描边高亮
   * （霓虹描边 + 呼吸）+ 左下事件轨到中屏单位的引导弧线。
   * 可选成员：不实现不破编译（同 syncDirectorMode 惯例）。
   * why 走 world 通道：联动是**瞬态表现**（不进 WorldState，与 camera.shake 同口径）——
   *   两段式：命令 hud → core，事件 core → world（总线铁律）。
   * payload 只携单位 id（弧线的屏幕坐标由 world 按自己的相机状态换算）。
   */
  syncFocusUnit?(unitId: string): void;
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
  /**
   * 单位气泡（@since v3.3，task_077）：要求某个单位冒一句话。
   * 走 WorldEvent 的 unit.bubble —— 消费者是气泡系统（task_076）；本任务只发事件，
   * 不自己渲染（接线位见 objects/task-fx-layer.ts 的气泡钩子注释）。
   */
  unitBubble(unitId: string, text: string): void;
  /**
   * 音效钩子（@since v3.3，task_077）：只发事件、**不做音频**（声音包 v3.3-10 消费）。
   * 走 WorldEvent 的 fx.sound。
   */
  soundCue(cue: SoundCue): void;
  /**
   * 导演模式开关回报（@since v3.3，task_081）：world 检测到**手动介入**时调本方法
   *   （enabled=false）—— core 据此把 WorldState.directorEnabled 写回 false 并广播，
   *   HUD 顶栏的「🎬 导演」开关随之熄灭（手动优先，导演让位）。
   * why 走 WorldEvent：world 不能改 core 的状态（铁律），只能发事件 —— 与 camera.moved 同一口径。
   */
  directorMode(enabled: boolean): void;
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
    // 任务全景（task_078）：建筑三态与区域点亮要的是**当前快照**（每条任务的相位），
    // 故随 state 一起转发，而不是等 world 通道的事件增量自己拼状态。
    port.syncTasks?.(state.missions ?? [], state.tasks ?? []);
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
        // 开工气泡（task_076）：任务落到谁头上，谁说一句开工话。
        port.syncTaskSpeech?.(event.task, 'start');
        // 导演镜头（task_081）：开工事件 → 镜头去看事件点。
        port.syncDirectorEvent?.(event.task, 'started');
        break;
      case 'task.completed':
        port.syncTaskEvent?.(event.task, 'completed');
        // 完成气泡（task_076）。
        port.syncTaskSpeech?.(event.task, 'complete');
        // 导演镜头（task_081）。
        port.syncDirectorEvent?.(event.task, 'completed');
        break;
      case 'task.failed':
        port.syncTaskEvent?.(event.task, 'failed');
        // 报错气泡（task_076）。
        port.syncTaskSpeech?.(event.task, 'error');
        // 导演镜头（task_081）：报错还附带红色渐晕脉冲（在导演控制器里触发）。
        port.syncDirectorEvent?.(event.task, 'failed');
        break;
      // 派活气泡（task_076）：任务入队 = 派到人手上 → 「收到新任务」。
      // why task.queued 不进 syncTaskEvent：它还不是「在干活」，不该挂工作环。
      case 'task.queued':
        port.syncTaskSpeech?.(event.task, 'assigned');
        break;
      // 审批门（task_049）：挂起画 ?（黄色问号，驻留到裁决）；批准折算成 started 相位 ——
      // 批准是同一段执行的续段，表现上回到工作环（场景不需要新的相位词）。
      case 'task.awaiting_approval':
        port.syncTaskEvent?.(event.task, 'awaiting_approval');
        break;
      case 'task.approved':
        port.syncTaskEvent?.(event.task, 'started');
        break;
      case 'unit.position':
        // 场景自己上报的落位也会回到这里（同一通道）—— 场景侧幂等，重复应用是 no-op。
        port.syncUnitPosition?.(event.unitId, event.x, event.y);
        break;
      // 小地图跳转（task_057）：core 转发来的相机对中指令 → 场景应用并回发 camera.moved。
      case 'camera.center':
        port.syncCameraCenter?.(event.x, event.y);
        break;
      // 镜头震动（task_080）：里程碑大字的那记小震 → 场景相机 shake（不改 scroll）。
      case 'camera.shake':
        port.syncCameraShake?.(event.durationMs, event.intensity);
        break;
      // 说话气泡（task_062）：chat 流式期间的标志位广播 → 场景头顶气泡起止。
      case 'unit.speaking':
        port.syncUnitSpeaking?.(event.unitId, event.speaking);
        break;
      // 指定文案气泡（task_076）：world 层当场指挥的原话（「收到」「来了来了」）→ 按原话冒泡。
      case 'unit.bubble':
        port.syncUnitBubble?.(event.unitId, event.text);
        break;
      // 回放节拍（task_082）：hud 侧回放控制器发的重演指令 → 战场按节拍重演。
      case 'replay.beat':
        port.syncReplayBeat?.(event.beat);
        break;
      // 导演模式开关（task_081）：core → world 的落位指令（hud 顶栏「🎬 导演」按钮经 core 转发）。
      //   反向也走这一条：world 检测到手动介入时发 enabled=false，core 据此把开关写回并广播。
      case 'camera.director':
        port.syncDirectorMode?.(event.enabled);
        break;
      // 单位联动（task_092）：HUD 事件轨条目点击 → core 转发 → 战场描边 + 引导弧线。
      case 'focus.unit':
        port.syncFocusUnit?.(event.unitId);
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

    unitBubble(unitId: string, text: string): void {
      if (destroyed) return;
      emitWorldEvent({ type: 'unit.bubble', unitId, text });
    },

    soundCue(cue: SoundCue): void {
      if (destroyed) return;
      emitWorldEvent({ type: 'fx.sound', cue });
    },

    directorMode(enabled: boolean): void {
      if (destroyed) return;
      emitWorldEvent({ type: 'camera.director', enabled });
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
