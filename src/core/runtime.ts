/**
 * 文件职责:core 运行时 -- 把「状态机」与「总线」接成一条闭环:
 *   store 变更 → state 广播给 world / hud;HudCommand / WorldEvent → 选择状态机 → store。
 *   Phase 1 三件套(types / bus / store+unit)各自可用但互不相连,本文件是它们之间唯一的接线。
 *   方案来源:docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §6 Phase 1「HUD 按钮 → command → core → state → 场景」。
 * 输入:core/bus 的 command / world 两个通道;core/store 的订阅回调。
 * 输出:WorldState 广播(state 通道);store 里的选择集变更。
 * 禁止事项:
 *   1. import world / hud / phaser / vue -- core 是依赖图的底层,渲染细节一律不许上浮(架构扫描项);
 *   2. 持有第二份状态 -- 业务真相只在 store,本文件只做「事件 → 状态机 → store」的三段翻译;
 *   3. 静默吞掉看不懂的事件 -- 未落地的命令/事件一律转交 onUnhandled,dev 入口用它打观测面板;
 *   4. 一次用户操作打多次 state -- 动作 + 对账合并在同一次 setState 里(perf:广播有成本);
 *   5. 在这里算坐标 -- core 不持有单位位置,框选命中判定在 world/objects/unit-registry.ts;
 *   6. 在这里 emitState 之外再开广播口 -- state 通道的唯一出口就是本文件的 store 订阅,
 *      子模块(agent-link / mission)只写 store,由本文件统一广播,避免一次变更广播两遍。
 *
 * @since v3.1 外部 agent 连接(core/agent-link)接入:manager 注入本运行时后,
 *   link.open / link.resume / link.reconnect / link.close 与 chat.send 由 manager 消费;
 *   未注入 manager 时这些命令照旧走 onUnhandled(默认单例行为不变,单测基线不破)。
 * @since v3.3 任务域(core/mission)接入:mission.create / assign / confirm / cancel 由本文件
 *   **直接调用** manager(不像 agent-link 那样由它自己订阅总线)-- 任务域无 IO、无长驻资源,
 *   省掉一次订阅与一层归属判定;写库仍走同一个 store,广播仍走本文件的 store 订阅。
 * @since v3.7 角色建档(core/character/profile.ts + manager.createCharacter)接入:
 *   character.create 由本文件直接调用 character manager(与 persona.update 同一口径)。
 * @since v3.16 角色任务域(core/task,task_037)接入:task.assign 由本文件直接调用
 *   task manager(与 mission 同一口径:任务域无 IO 无长驻资源,四行 case 换一层归属判定不值);
 *   task.queued / started / completed / failed 四条生命周期事件由 manager 发出,本文件在
 *   handleWorldEvent 里显式接地(同 unit.position 惯例)-- 消费者是 app 层 task-service
 *   (出队执行)与任务落库订阅者,不进 onUnhandled。
 * @since v3.23(task_047)追加 task.cancel 命令(排队取消,同口径直调 manager)与
 *   task.cancelled 事件接地(startsWith('task.') 已覆盖,注释补记)。
 * @since v3.25(task_049)追加 task.approve / task.reject 命令(审批门)与
 *   task.awaiting_approval / task.approved 事件接地(同上,startsWith 已覆盖)。
 * @since v3.30(task_054)追加 agent.online / agent.offline 事件接地(app 健康监测的
 *   在线位广播,落点 applyAgentConnectivity 写 units.online);
 *   v3.37(task_062)追加 unit.speaking 接地(app 层 chat-service 的说话标志位广播,
 *   消费者是战场场景 -- 纯瞬态表现,不写 WorldState);
 *   v3.3(task_077)追加 unit.bubble(战场要求单位冒一句话,气泡系统 task_076 消费)与
 *   fx.sound(音效钩子,声音包 v3.3-10 消费)接地 -- 两者都是纯瞬态表现,不写 WorldState。
 * @since v3.33(task_057)追加 camera.center 命令接线:钳制(core/camera.ts 纯函数)后转发
 *   同名 WorldEvent 到 world 通道(消费者是场景相机);world 通道回环的 camera.center 显式接地。
 * @since v3.34(task_058)追加 unit.group.assign / unit.group.recall 命令接线:编组槽位表
 *   (WorldState.selectionGroups)的写入与召回。槽位合法性/幂等/对账语义在 core/unit/group.ts
 *   纯函数;反馈(已存入/召回 N(x 单位)/被拒原因)同一次 setState 里附 Notice(一次操作一次广播)。
 * @since v3.3(task_080)追加 camera.shake 命令接线:钳制(core/camera.ts 的 clampShake)后转发
 *   同名 WorldEvent 到 world 通道(消费者是场景相机);world 通道回环的 camera.shake 显式接地。
 * @since v3.43(task_093)追加 session.interrupt 命令接线:落到 session manager
 *   (core/session,同 mission / task 口径直调);会话域的持久化口由组合根注入
 *   (命令落点与业务侧记账共用同一个 manager 实例)。
 * @since v3.4(task_096)追加 hud.layer.set 命令接线:写 WorldState.infoLayer
 *   (HUD 信息三层级 L1 常驻 / L2 事件 / L3 沉浸)→ state 广播给 HUD 与 world;
 *   层级语义在 core/info-layer.ts 的纯函数里,视觉呈现全在 hud 侧(core 零 DOM)。
 * @since v3.4(task_094)追加 hud.layer.hold 命令接线:写 WorldState.layerHolds
 *   (Z6 沉浸层的演出占用:里程碑大字 / ▶60 秒重演 / 导演取景框)→ store 计数裁决出
 *   有效档(有占用 = L3)→ state 广播给 HUD 与 world;手动档 hud.layer.set 与占用
 *   hud.layer.hold 分开:演出结束后回到手动档。
 * @since v3.4(task_091)追加 focus.unit 命令接线:HUD 事件轨(Z2)条目点击 → 同名 WorldEvent
 *   转发到 world 通道(消费者是世界层:单位描边高亮 + 引导弧线);core 只转发不写 WorldState
 *   (联动是瞬态表现,同 camera.shake 口径);world 通道回环的 focus.unit 显式接地。
 */

import type { AgentLinkManager } from './agent-link';
import { clampShake, clampWorldPoint } from './camera';
import { emitState, emitWorldEvent, onCommand, onWorldEvent, type Unsubscribe } from './bus';
import { createCharacterManager, type CharacterManager } from './character';
import { normalizeInfoLayer, isLayerTrigger } from './info-layer';
import { createMissionManager, type MissionManager } from './mission';
import { createSessionManager, type SessionManager } from './session';
import type { CoreStore } from './store';
import { worldStore } from './store';
import { createTaskManager, type TaskManager } from './task';
import type { PipelineRunnerPort } from './task';
import {
  MAX_CONTROL_GROUP_SLOT,
  MAX_NOTICES,
  MIN_CONTROL_GROUP_SLOT,
  NOTICE_TTL_MS,
  type AgentKind,
  type HudCommand,
  type Notice,
  type NoticeLevel,
  type WorldEvent,
  type WorldState,
} from './types';
import { computeFormationSlots } from './unit/formation';
import {
  assignControlGroup,
  isControlGroupSlot,
  readControlGroupUnitIds,
} from './unit/group';
import type { SelectionAction } from './unit/selection';
import { applySelectionAction } from './unit/selection';

/** 未落地的消息来自哪一侧(dev 观测面板与单测据此区分来源)。 */
export type UnhandledChannel = 'command' | 'world';

/**
 * 会话恢复端口（@since v3.47，task_101 / v3.2b-B2）—— 续跑方的形状。
 *
 * why 只有一个 sessionId：恢复这件事的**全部**判断都在端口实现方（app 层互聊引擎）：
 *   kind 准入 / 参与者是否还在场 / 上文回灌 / 重启轮转 —— core 一概不认（core 零 IO、
 *   不认识角色档案与 transport）。core 只保证"这条命令有人接"。
 */
export type SessionResumePort = (sessionId: string) => void;

export interface CoreRuntimeOptions {
  /** 状态持有者;默认用 store.ts 的 worldStore 单例(两侧共用同一份世界态)。 */
  readonly store?: CoreStore;
  /**
   * 外部 agent 连接管理器(@since v3.1)。
   * why 是"注入"而不是内部 new:构造它需要 transport(真实 IO 依赖),而 runtime 必须保持零 IO;
   * 注入后由本运行时负责随 start/stop 一起起停,卸载时连接一并关闭(资源必须可清理)。
   */
  readonly agentLink?: AgentLinkManager;
  /**
   * 任务域写入面(@since v3.3)。
   * why 可以注入:manager 无 IO 无资源,构造它只为了绑一个 store -- 但单测要能把两段接线
   * (runtime 的命令分发 / mission 的 store 投影)各自隔离,故留注入口子。
   * 默认按本运行时自己的 store 构造,保证命令落到**本运行时**的状态里而不是 worldStore 单例。
   */
  readonly mission?: MissionManager;
  /**
   * 角色域写入面(@since v3.6 接线:character.persona.update 的消费方)。
   * why 注入而非内部 new:与 mission 同一原因 -- 单测要把"命令分发"与"store 投影"两段隔离。
   * 默认按本运行时自己的 store 构造;grantExperience 仍只暴露给程序化入口(无 HudCommand 接线)。
   */
  readonly character?: CharacterManager;
  /**
   * 角色任务域写入面(@since v3.16,task_037)。
   * why 注入而非内部 new:组合根(main-entry)要把**同一个** manager 实例交给 app 层
   * task-service(它负责 transport 执行与相位回报),单测也要能隔离两段接线 --
   * 与 mission / character 同一原因,多一条实例共享的硬需求。
   */
  readonly task?: TaskManager;
  /**
   * 会话域写入面(@since v3.43，task_093 / v3.2a S3)。
   * why 可注入:组合根要把它**同一个实例**交给 app 层各服务(chat / task / agent-link),
   *   让"命令落点"与"业务侧记账"写的是同一份 WorldState.sessions —— 与 mission / task 同一原因。
   * 默认按本运行时自己的 store 构造,保证 session.interrupt 落到**本运行时**的状态里。
   */
  readonly session?: SessionManager;
  /**
   * 多 agent 流水线编排器端口(@since v3.27,task_051)。
   * why 注入:编排执行有 IO(逐站 task.assign 会发事件、落 pipelines 表),core 零 IO
   *   铁律不许内部 new;实现方是 app 层 pipeline-service(runtime 只认 PipelineRunnerPort
   *   形状,不知道它是谁)。未注入时 pipeline.start 按 agent-link 命令同一口径走 onUnhandled。
   *   ★与 task manager 的区别:manager 是 core 写入面,runtime 直调;这里是**端口** --
   *   流水线不是 core 实体(编排态不进 WorldState,见 core/task/pipeline.ts 架构注),
   *   runtime 只做转发,不做翻译。
   */
  readonly pipeline?: PipelineRunnerPort;
  /**
   * 会话恢复端口（@since v3.47，task_101 / v3.2b-B2）。
   * why 是**端口**而不是 core 直调 manager：恢复不只是翻状态位 —— 还要把回灌的上文
   *   重新喂给参与者并重启互聊轮转，那件事在 app 层（互聊引擎，持有 transport 与角色档案）。
   *   core 只做转发（同 pipeline.start 的纪律：core 不认识"互聊怎么跑"）。
   * 未注入时命令按未落地处理（onUnhandled）—— **不假装恢复成功**。
   */
  readonly sessionResume?: SessionResumePort;
  /**
   * 尚未实现的命令 / 事件出口。
   * why 需要它:契约已冻结(§5),Phase 2 之前留了一些尚未接地的命令(chat.send 等);
   * 直接 switch 落空会让"没接上"和"接上了但没反应"长得一模一样,排查成本极高。
   * @since v3.6 已把 ui.navigate / character.persona.update 接线从这里摘除,不再走 onUnhandled。
   */
  readonly onUnhandled?: (channel: UnhandledChannel, payload: HudCommand | WorldEvent) => void;
}

export interface CoreRuntime {
  readonly store: CoreStore;
  /** 接通闭环;返回 stop 闭包。重复 start 是 no-op(返回同一个 stop,不会叠加订阅)。 */
  start(): () => void;
  /** 当前是否已接通(供 dev 入口与单测断言)。 */
  readonly running: boolean;
}

/** 点击是否按"加选 / 取消选"处理:Shift / Ctrl / ⌘ 任一按下即加选,与 RTS 惯例一致。 */
function isAdditiveClick(mods: { shift: boolean; ctrl: boolean; meta: boolean }): boolean {
  return mods.shift || mods.ctrl || mods.meta;
}

/**
 * 重置编组（@since v3.6，task_116）：清空当前选择集 + 清空已存入的编组槽位。
 *
 * why 一次 setState：选择集与编组槽位是同一份「选择语义」的两个面（同一次破坏性动作），
 *   分两次广播会让 HUD 先看到「选集空了、编组还在」的中间态。
 * why 幂等（无变化即零广播）：与 store.setState 的约定一致 —— 重复点「重置编组」不该刷屏。
 */
function applySelectionReset(store: CoreStore): void {
  store.setState((state) => {
    const applied = applySelectionAction(state.selection, { type: 'clear' });
    const groups = state.selectionGroups ?? new Map<number, readonly string[]>();
    const groupsEmpty = groups.size === 0;
    if (!applied.changed && groupsEmpty) return state;
    return {
      ...state,
      selection: applied.next,
      selectionGroups: groupsEmpty ? groups : new Map<number, readonly string[]>(),
    };
  });
}

/**
 * 把一次选择变更写进 store:应用动作后立刻与已知单位对账,合并成**一次** setState。
 * why 要对账:HUD / world 都有可能发来已经消失的单位 id(快照与输入天然存在时间差),
 * 悬空 id 留在选择集里会让"编组 = 多选集合"失去意义(core/unit/group.ts 直接取选择集当成员)。
 */
function applySelection(store: CoreStore, action: SelectionAction): void {
  store.setState((state) => {
    const applied = applySelectionAction(state.selection, action);
    if (!applied.changed) return state;
    const reconciled = applySelectionAction(applied.next, {
      type: 'reconcile',
      knownUnitIds: state.units.map((unit) => unit.id),
    });
    return { ...state, selection: reconciled.next };
  });
}

/** 编组 Notice 的来源标识（hud/log-drawer 的「来源」列按它分组）。 */
const CONTROL_GROUP_NOTICE_SOURCE = 'core/unit';

/** Notice id 序列（进程内单调；与 mission manager 的 createId 同一「前缀+时间+序号」口径）。 */
let controlGroupNoticeSeq = 0;

/**
 * 编组命令的 Notice 附着（@since v3.34，task_058）：把一条 Notice **并进同一次 setState**。
 * why 不走 store.pushNotice：那是独立一次广播，编组命令「状态变更 + 反馈」会打两次 state
 *（违反本文件禁止事项 4「一次用户操作一次广播」的精神）；就地拼接 + 到期过滤 + 截断
 *   与 store.pruneNotices 同一口径（见 store.ts）。
 */
function withControlGroupNotice(
  state: WorldState,
  level: NoticeLevel,
  text: string
): WorldState {
  const at = Date.now();
  const notice: Notice = {
    id: `group-notice_${at}_${++controlGroupNoticeSeq}`,
    level,
    text,
    createdAt: at,
    expiresAt: at + NOTICE_TTL_MS,
    source: CONTROL_GROUP_NOTICE_SOURCE,
  };
  const alive = state.notices.filter((n) => n.expiresAt > at);
  return { ...state, notices: [notice, ...alive].slice(0, MAX_NOTICES) };
}

/**
 * 编组槽位命令的统一落点（@since v3.34，task_058；unit.group.assign / unit.group.recall）。
 *
 * assign：空选择被拒（warn，不清槽位 —— 没人可编就别动它）；同槽同成员幂等（原引用返回，
 *   零广播）；否则写入 id 副本 + info「已存入编组 N（x 单位）」。
 * recall：槽位成员先与在场单位对账（同 unit.select 口径：悬空 id 剔除），再 set 进选择集；
 *   空槽 / 全员离场 → 不动选择集，warn「编组 N 为空」；成功 → info「召回编组 N（x 单位）」
 *   （x 是对账后的实际入列数，不吞差异）。选择集与 Notice 在**同一次** setState 落地。
 */
function applyControlGroupCommand(
  store: CoreStore,
  command: Extract<HudCommand, { type: 'unit.group.assign' | 'unit.group.recall' }>
): void {
  if (!isControlGroupSlot(command.group)) {
    // 越界槽位：不猜、不截断，直接拒（键位表在 hud 侧同源冻结，这里只是第二道闸）。
    store.setState((state) =>
      withControlGroupNotice(
        state,
        'warn',
        `编组槽位必须是 ${MIN_CONTROL_GROUP_SLOT}–${MAX_CONTROL_GROUP_SLOT}`
      )
    );
    return;
  }
  store.setState((state) => {
    if (command.type === 'unit.group.assign') {
      const ids = state.selection.unitIds;
      if (ids.length === 0) {
        return withControlGroupNotice(state, 'warn', `未选中单位，编组 ${command.group} 未变更`);
      }
      const groups = assignControlGroup(state.selectionGroups, command.group, ids);
      if (groups === state.selectionGroups) return state; // 幂等：零广播（与 store 约定一致）
      return withControlGroupNotice(
        { ...state, selectionGroups: groups },
        'info',
        `已存入编组 ${command.group}（${ids.length} 单位）`
      );
    }

    // recall：对账后覆盖选择集；成员一个都不在场就不动选择集。
    const known = new Set(state.units.map((unit) => unit.id));
    const alive = readControlGroupUnitIds(state.selectionGroups, command.group).filter((id) =>
      known.has(id)
    );
    if (alive.length === 0) {
      return withControlGroupNotice(state, 'warn', `编组 ${command.group} 为空`);
    }
    const applied = applySelectionAction(state.selection, { type: 'set', unitIds: alive });
    const nextSelection = applied.changed
      ? applySelectionAction(applied.next, { type: 'reconcile', knownUnitIds: [...known] }).next
      : state.selection;
    return withControlGroupNotice(
      { ...state, selection: nextSelection },
      'info',
      `召回编组 ${command.group}（${nextSelection.unitIds.length} 单位）`
    );
  });
}

/**
 * 右击移动的落位广播（@since v3.21，task_045）。HudCommand 与 WorldEvent 的 unit.move 共用。
 * ★ 位置立即生效于状态，动画只是渲染过渡：core 契约里 UnitView 不含坐标（位置真相在世界层
 *   UnitObject），因此「移动」在 core 侧的表达 = 把编队终值经 unit.position 逐单位广播 ——
 *   世界层收到后立即写进 UnitObject（状态真相即刻更新）再 tween（纯表现）；app 层持久化
 *   订阅者（task_033 防抖落库）消费同一条事件，落库链路自动跟随，无需另行接线。
 * 未知单位静默丢弃（快照与输入有时间差，同 applySelection 的对账口径）；
 * 全被过滤 / 空编队 → 零广播、零状态变化（没有可动的人就不广播）。WorldState 不变 ——
 * 位置不进状态广播（契约铁律），选择集也不因移动而变（RTS 惯例：选中跟着队伍走）。
 */
function applyUnitMove(store: CoreStore, unitIds: readonly string[], x: number, y: number): void {
  const known = new Set(store.getState().units.map((unit) => unit.id));
  const ordered = unitIds.filter((id) => known.has(id));
  for (const slot of computeFormationSlots(ordered, { x, y })) {
    emitWorldEvent({ type: 'unit.position', unitId: slot.unitId, x: slot.x, y: slot.y });
  }
}

/**
 * agent 在线位接地（@since v3.30，task_054）。agent.online / agent.offline 事件的落点：
 * 把**该 kind 名下全部单位**的 online 位写掉（角色 → 单位经 characters.agentKind ↔
 * units.characterId 对账 —— 同 kind 多角色是一次事件批量置位，事件不携 id 列表）。
 *
 * 语义铁律（与 UnitView.online 的契约注一致）：
 *   - 缺省 / true = 在线 —— 所以「写 true」只对 online === false 的单位生效（幂等不广播），
 *     老档 / 未探测 / 没接健康监测的单位永远不会被误伤；
 *   - status（忙闲）不动：掉线时任务忙闲真相保持原值（在跑任务的 failed 收尾归 task 状态机），
 *     online 与 status 正交，不在这里顺手改写；
 *   - 该 kind 没有绑定角色 / 没有单位（空战场）→ 零变化零广播（事件照发，状态不端）。
 */
function applyAgentConnectivity(store: CoreStore, kind: AgentKind, online: boolean): void {
  store.setState((state) => {
    const boundCharacterIds = new Set(
      state.characters.filter((character) => character.agentKind === kind).map((character) => character.id)
    );
    if (boundCharacterIds.size === 0) return state;
    let changed = false;
    const units = state.units.map((unit) => {
      if (!unit.characterId || !boundCharacterIds.has(unit.characterId)) return unit;
      // 缺省即在线：需要变化的只有「离线位不匹配」的单位（幂等，重发同一事件不广播）。
      const stale = online ? unit.online === false : unit.online !== false;
      if (!stale) return unit;
      changed = true;
      return { ...unit, online };
    });
    return changed ? { ...state, units } : state;
  });
}

export function createCoreRuntime(options: CoreRuntimeOptions = {}): CoreRuntime {
  const store = options.store ?? worldStore;
  const agentLink = options.agentLink;
  const mission = options.mission ?? createMissionManager({ store });
  // @since v3.6 角色域写入面:character.persona.update 的落库管道。
  // 与 mission 同一理由 -- manager 无 IO,纯靠 store 投影;不注入口子会让单测无法隔离接线层。
  const character = options.character ?? createCharacterManager({ store });
  // @since v3.16 任务域写入面:task.assign 的落库管道(与 mission / character 同一口径)。
  // 组合根注入同一个实例给 app 层 task-service,保证命令与相位回报写的是同一份状态。
  const task = options.task ?? createTaskManager({ store });
  // @since v3.43(task_093):会话域写入面 —— session.interrupt 的落库管道。
  // 与 mission / task 同一口径:manager 无 IO 无资源,构造它只为了绑一个 store。
  const session = options.session ?? createSessionManager({ store });
  // @since v3.27(task_051)流水线编排器端口:只持引用不构造(见 options.pipeline 注释)。
  const pipeline = options.pipeline;
  // @since v3.47(task_101 / v3.2b-B2)会话恢复端口:只持引用不构造(见 options.sessionResume 注释)。
  const sessionResume = options.sessionResume;
  const reportUnhandled = options.onUnhandled ?? ((): void => { /* 默认不打扰;dev 入口与单测会注入 */ });

  /**
   * @since v3.1 这五条命令由 agent-link 消费(它自己订阅同一通道)。
   * runtime 这里**不转发**--转发会让同一命令被处理两次(重复建链、重复发消息)。
   * 识别出来只为把它们从 unhandled 里摘掉;未注入 manager 时它们仍按未落地处理。
   */
  const isAgentLinkCommand = (command: HudCommand): boolean => {
    switch (command.type) {
      case 'link.open':
      case 'link.resume':
      case 'link.reconnect':
      case 'link.close':
      case 'chat.send':
        return agentLink !== undefined;
      default:
        return false;
    }
  };

  const handleCommand = (command: HudCommand): void => {
    switch (command.type) {
      case 'unit.select':
        // HudCommand 的 mode 只有 set / toggle,与选择状态机的动作同名,直接映射,不做二次翻译
        applySelection(store, { type: command.mode, unitIds: command.unitIds });
        return;
      // @since v3.6(task_116)危险区「重置编组」:设置页确认框点「确认执行」后发这条命令 →
      //   core 清空选择集 + 编组槽位(同一次广播)。此前该命令无人处理,core 只报「未处理 command」。
      //   why 不让 HUD 自己清:铁律是 hud 只发命令、不改 WorldState(否则 HUD 与 world 两侧状态会分叉)。
      case 'selection.reset':
        applySelectionReset(store);
        return;
      // @since v3.21 右击移动(task_045):HUD 入口。编队终值广播见 applyUnitMove ——
      // 位置立即生效于状态(世界层 UnitObject),动画只是渲染过渡;落库链路由 unit.position 自动跟随。
      case 'unit.move':
        applyUnitMove(store, command.unitIds, command.x, command.y);
        return;
      // @since v3.34 编组槽位(task_058):存入/召回统一落点(Notice 同次广播,见 applyControlGroupCommand)。
      case 'unit.group.assign':
      case 'unit.group.recall':
        applyControlGroupCommand(store, command);
        return;
      // @since v3.33 小地图跳转(task_057):钳进世界边界后转发到 world 通道(同名事件)。
      // core 不持有相机状态,不在这里算视口 —— 消费者是场景(bridge 转发 syncCameraCenter,
      // 场景按视口再钳一次后落位并回发 camera.moved)。同 task.* 「core 发出、world 消费」先例。
      case 'camera.center': {
        const clamped = clampWorldPoint({ x: command.x, y: command.y });
        emitWorldEvent({ type: 'camera.center', x: clamped.x, y: clamped.y });
        return;
      }
      // @since v3.3 镜头震动(task_080):里程碑大字的那记小震。钳制(core/camera.ts 的 clampShake:
      //   时长 ≤ 500ms、强度 ≤ 2% 视口)后以同名 WorldEvent 转发到 world 通道 ——
      //   消费者是场景相机(bridge 转发 syncCameraShake)。core 不持有相机状态,只做钳制与转交
      //   (同 camera.center 的两段式:命令是 hud → core 的意向,事件是 core → world 的落位指令)。
      case 'camera.shake': {
        const shake = clampShake(command.durationMs, command.intensity);
        emitWorldEvent({ type: 'camera.shake', durationMs: shake.durationMs, intensity: shake.intensity });
        return;
      }
      // @since v3.3(task_081)导演模式开关:HUD 顶栏「🎬 导演」按钮 → core 写状态
      //   (WorldState.directorEnabled —— 按钮回显的唯一真相) + 以同名 WorldEvent 转发到
      //   world 通道(消费者是战场侧的导演控制器,由它自动订阅任务事件编排镜头)。
      //   core 不持有镜头,只做「记状态 + 转交」(同 camera.center / camera.shake 口径)。
      case 'camera.director': {
        store.setDirectorEnabled(command.enabled);
        emitWorldEvent({ type: 'camera.director', enabled: command.enabled });
        return;
      }
      // @since v3.4(task_091)事件轨点选单位(HUD v3.4 · Z2 事件轨):条目点击 → focus.unit。
      //   core 只做转发(不写 WorldState —— 联动是瞬态表现,同 camera.shake 口径):
      //   以同名 WorldEvent 发到 world 通道,消费者是世界层(task_092:单位描边高亮 +
      //   左下条目到中屏单位的引导弧线)。HUD 绝不直接调 world(铁律)—— 与 camera.center
      //   同一两段式:命令是 hud → core 的意向,事件是 core → world 的落位指令。
      case 'focus.unit': {
        emitWorldEvent({ type: 'focus.unit', unitId: command.unitId });
        return;
      }
      // @since v3.3 任务域:命令翻译只在 core/mission 里有一份(manager 负责转状态机动作 + 写库 + 报错)
      // @since v3.38(task_077):可选 brief / dependsOn 透传 —— 缺省即裸任务,既有构造点零改动。
      case 'mission.create':
        mission.createMission({
          title: command.title,
          unitIds: command.unitIds,
          brief: command.brief,
          dependsOn: command.dependsOn,
        });
        return;
      case 'mission.assign':
        mission.assignMission(command.missionId, command.unitIds);
        return;
      case 'mission.confirm':
        mission.decideMission(command.missionId, command.decision);
        return;
      case 'mission.cancel':
        mission.cancelMission(command.missionId);
        return;
      // @since v3.6(task_120):撤掉一条从未开工的编组任务(draft / pending)—— 不是相位迁移,
      // 是从世界态里移除(不留终态墓碑)。判据在 core/mission/machine.ts 的 canRemoveMission。
      case 'mission.remove':
        mission.removeMission(command.missionId);
        return;
      // @since v3.38(task_077):检查点记账 —— 静默(不发 Notice),终态由 core/mission 裁决并静默拒绝。
      case 'mission.checkpoint':
        mission.checkpointMission(command.missionId, command.note);
        return;
      // @since v3.6 角色提示词写入:落到 character manager(不再走 onUnhandled)。
      // 合法性与 trim 由 core/character/persona.ts 校验;被拒走 Notice(manager 内部完成)。
      case 'character.persona.update':
        character.updatePersona(command.characterId, command.prompt);
        return;
      // @since v3.20 角色形象写入(task_041 形象编辑面板):落到 character manager。
      // 形状合法性由 core/character/profile.ts 的 resolveAppearance 校验(与建档同一口径);
      // ★ 解锁门槛不在 core 判(是编辑 UI 的引导约束,见 types.ts 命令注释);
      // 写入时同步刷新该角色战场单位的外观投影(同一次 setState,战场与档案不漂移)。
      case 'character.appearance.update':
        character.updateAppearance(command.characterId, command.appearance);
        return;
      // @since v3.29 角色级上下文注入开关（task_053，agent-panel 角色卡的「上下文」钮）：
      // 落到 character manager（同 persona.update 口径）；被拒（不在档）走 Notice。
      // 落库由存档协调器顺 characters diff 自动写 context_enabled 列（schema v9）。
      case 'character.contextEnabled.update':
        character.updateContextEnabled(command.characterId, command.enabled);
        return;
      // @since v3.35 角色改名(task_059 编辑中心·档案 tab):落到 character manager。
      // 名字形状由 core/character/profile.ts 的 resolveCharacterName 裁决(与建档同一份);
      // 重名(除自己)由 manager 判(要看状态,error 级 Notice);写入时同步刷新该角色战场
      // 单位的 name 投影(同一次 setState,战场与档案不漂移)。
      case 'character.name.update':
        character.updateName(command.characterId, command.name);
        return;
      // @since v3.7 角色建档(首启引导):落到 character manager(不再走 onUnhandled)。
      // 建档合法性由 core/character/profile.ts 的纯函数裁决;同名冲突 / 条数上限由 manager 判;
      // 落库后由本文件的 store 订阅把整份 WorldState(含 characters)全量广播给两侧。
      case 'character.create':
        character.createCharacter({
          name: command.name,
          agentKind: command.agentKind,
          skinId: command.skinId,
          persona: command.persona,
          appearance: command.appearance,
        });
        return;
      // @since v3.7(task_129) 名册清理:删除角色档案 —— 落到 character manager(不再走 onUnhandled)。
      // 占用判定(在任务中 / 在线)与落库都在 manager 内的一次 setState 里完成;
      // 被拒(不在档 / 占用中)走 Notice(manager 内部完成),状态不变。
      case 'character.delete':
        character.deleteCharacter(command.characterId);
        return;
      // @since v3.16 角色任务派发(task_037):落到 task manager(不再走 onUnhandled)。
      // prompt 合法性与角色在档由 manager 裁决;agent 绑定 / 检出的守门在 app 层 task-service
      // 出队时做(不满足 → failTask 直达 failed,状态里看得见原因)。
      // @since v3.26(task_050):可选 targetCharacterId 透传 —— 指定承接人直达其队列,
      // 在档校验在 manager(不存在 → error Notice);「自动」的择人决策在 HUD 推荐纯函数。
      // @since v3.36(task_076):可选 missionId 原样透传,终态回报由 app 层 task-service 完成。
      case 'task.assign':
        task.assignTask({
          characterId: command.characterId,
          prompt: command.prompt,
          targetCharacterId: command.targetCharacterId,
          missionId: command.missionId,
        });
        return;
      // @since v3.23 排队任务取消(task_047):同口径直调 manager。相位裁决(仅 queued 可取消)
      // 在状态机,拒绝时 manager 发对应 Notice(running → 提示「先停止」;终态 → 无需取消),
      // 结构化结果(TaskCancelOutcome)不回传 —— 命令通道是 fire-and-forget,UI 反馈靠 Notice。
      case 'task.cancel':
        task.cancelTask(command.taskId);
        return;
      // @since v3.25 任务审批门(task_049):批准 / 驳回同口径直调 manager。相位裁决
      // (仅 awaiting_approval 可批准或驳回)在状态机;批准后的续执行驱动在 app 层
      // task-service(它听 task.approved 事件接手 —— core 零 IO);驳回走 task.failed
      // 既有事件面(落库 / 回流 / exp)。UI 的批准 / 驳回按钮只对 awaiting 任务渲染(049)。
      case 'task.approve':
        task.approveTask(command.taskId);
        return;
      case 'task.reject':
        task.rejectTask(command.taskId);
        return;
      // @since v3.43(task_093 / v3.2a S3)会话中断:落到 session manager(与 mission / task 同一口径:
      //   命令直接调 manager,状态裁决在 core/session 的状态机里 —— 已收尾 / 已中断的会话被拒并回 Notice)。
      //   why 需要它:互聊超时此前是"静默丢弃"(会话没了、历史也没了)—— 中断标记让会话可见、可查。
      case 'session.interrupt':
        session.interruptSession(command.sessionId);
        return;
      // @since v3.47(task_101 / v3.2b-B2)会话恢复:转发给注入的**恢复端口**(app 层互聊引擎 ——
      //   它把回灌的上文喂回参与者并重启轮转;core 不跑互聊,只做转发,同 pipeline.start 纪律)。
      //   端口缺席 = 命令没人接管 → 按未落地处理(不假装恢复成功)。
      case 'session.resume':
        if (sessionResume) {
          sessionResume(command.sessionId);
        } else {
          reportUnhandled('command', command);
        }
        return;
      // @since v3.48(task_102 / v3.2b-B3)会话分叉:直调 session manager(与 session.interrupt 同一口径)——
      //   分叉是**纯 core 逻辑**(读事件流 → 复制到 atSeq → 建新会话),不需要 app 层引擎接手,
      //   所以这里没有注入端口(与 resume 不同:resume 要把上文喂回模型、重启轮转,那件事在 app 层)。
      //   源会话全程只读;读不到事件流时 manager 如实拒绝并回 Notice(不编造一条空分叉)。
      case 'session.fork':
        session.fork(command.sessionId, command.atSeq);
        return;
      // @since v3.27(task_051)流水线发起:转交注入的编排器端口(app 层 pipeline-service)。
      // 与 task.* 不同,这里不直调 manager -- 流水线不是 core 实体(见 RuntimeOptions.pipeline
      // 注),runtime 只把命令交给端口。未注入时按未落地处理(agent-link 命令同一口径)。
      case 'pipeline.start':
        if (pipeline) {
          pipeline.runPipeline(command.spec, command.issue);
        } else {
          reportUnhandled('command', command);
        }
        return;
      // @since v3.6 屏位路由:
      //   'main' 与 'chat' 都不入 currentScreen:
      //     - 'main' 是"回主屏"语义,与字段为空等价(缺省回落读取方自管);
      //     - 'chat' 由 core 解释为"打开聊天抽屉"(HUD 抽屉仍由原 chat-drawer 自治),
      //       不写屏位字段就与现有抽屉协议不冲突。
      //   'settings' / 'character' 落到 currentScreen,供 main-screen 据此切换渲染。
      case 'ui.navigate':
        store.setCurrentScreen(command.screen === 'main' || command.screen === 'chat' ? null : command.screen);
        return;
      // @since v3.4（task_096）HUD 信息层级三档:
      //   HUD 的三档开关发这条命令 → core 写 WorldState.infoLayer → state 广播回两侧。
      //   HUD 侧据此降 L1 对比 / 收起 L2（CSS 变量切换）；world 侧据此让位（L3 元素订阅这条广播）。
      //   core 只做「记状态 + 广播」—— 层级语义（哪档降多少）在 core/info-layer.ts 的纯函数里，
      //   视觉呈现全在 hud 侧；core 不认识 DOM（铁律：core 零 IO）。
      case 'hud.layer.set':
        store.setInfoLayer(normalizeInfoLayer(command.layer));
        return;
      // @since v3.6（task_115）皮肤切换接地:
      //   theme.set 的**效果**由 HUD 本地消费 —— token 样式表切换 + localStorage 记忆,
      //   落点在 hud/bridge/bus-adapter 与 hud/theme/theme-controller（皮肤是**每客户端本地**的
      //   展示偏好,token 也在本机 DOM 上,core 无从插手)。
      //   core 这里只做「接地」:显式吞掉这条命令,不再掉进 default 分支报「未处理 command」
      //   （此前每切一次皮肤 console 就多一条警告 —— 死功能排查时的噪音源）。
      //   why 不写进 WorldState:皮肤不进状态机(不进任何 core 逻辑),另立字段 = 第二个真相源
      //   (见 core/types.ts 的「用户偏好」段 —— 契约已冻结这条纪律)。
      case 'theme.set':
        return;
      // @since v3.4（task_094）演出占用 / 释放（Z6 沉浸层接线）:
      //   演出本体（里程碑大字组件 / 回放控制器）发这条命令 → core 记 WorldState.layerHolds
      //   → 重算有效档（有占用 = L3）→ 广播回两侧。
      //   HUD 侧据此降 L1 对比 / 收起 L2；world 侧据此让位（L3 元素订阅这条广播）。
      //   占用语义在 store（计数裁决：三个演出可同时在演，谁先结束谁先放手）。
      //   非法占用源直接忽略（显示密度不该让命令失败 —— 与 normalizeInfoLayer 同一态度）。
      case 'hud.layer.hold':
        if (!isLayerTrigger(command.trigger)) return;
        store.setLayerHold(command.trigger, command.active === true);
        return;
      default:
        if (isAgentLinkCommand(command)) return; // agent-link 已订阅处理
        // theme.set 由 hud bridge 本地消费(见 hud/bridge/bus-adapter),core 侧仅记账;
        // 记账形态尚未定(见 types.ts theme.set 注释),目前命令不进入 core runtime 的 switch。
        reportUnhandled('command', command);
    }
  };

  const handleWorldEvent = (event: WorldEvent): void => {
    switch (event.type) {
      case 'unit.click':
        applySelection(store, {
          type: isAdditiveClick(event.mods) ? 'toggle' : 'set',
          unitIds: [event.unitId],
        });
        return;
      // @since v3.21 框选闭环(task_045):命中判定在世界侧(core 无坐标),上报方把 id 补在事件上 ——
      // 带 id 才落选择集(空数组 = 拖空框/点空地,明确清空);没 id 维持「未处理」观测口径,
      // 与老调用方(dev 观测/合成事件)兼容。Shift = 加选(add),否则覆盖(set)。
      case 'selection.box':
        if (event.unitIds === undefined) {
          reportUnhandled('world', event);
          return;
        }
        applySelection(store, {
          type: event.additive === true ? 'add' : 'set',
          unitIds: event.unitIds,
        });
        return;
      // @since v3.21 战场右击移动(task_045):世界层入口,与 HudCommand unit.move 共用落位逻辑。
      case 'unit.move':
        applyUnitMove(store, event.unitIds, event.x, event.y);
        return;
      // @since v3.3(task_081)导演模式开关(反向通道):world 检测到**手动介入**时发本事件
      //   (enabled=false)→ core 把开关写回 false 并广播(HUD 顶栏按钮随之熄灭)。
      //   手动优先是硬规则(DEMO-PLAN §7):导演模式下主播一碰镜头,导演立刻让位。
      //   HUD 发起的同一条事件也会回到这里 —— 幂等(store 值没变即不广播),不构成回路。
      case 'camera.director':
        store.setDirectorEnabled(event.enabled);
        return;
      // @since v3.30 agent 健康位接地(task_054):app 层 health-monitor 发出的在线/离线广播,
      //   落点 = 该 kind 名下单位的 online 位(见 applyAgentConnectivity;与 unit.move 同为
      //   真正写状态的少数事件 —— 多数事件只显式接地不消费)。忙闲 status 不动(正交语义)。
      case 'agent.online':
        applyAgentConnectivity(store, event.kind, true);
        return;
      case 'agent.offline':
        applyAgentConnectivity(store, event.kind, false);
        return;
      default:
        // camera.moved:WorldState 契约里没有相机字段(core/types.ts 冻结版),不做业务处理。
        //   事件由 world 场景相机回调发出(bus-adapter 合并窗口后上报),消费者是 app 层
        //   main-entry 的小地图视口同步订阅(按 center + zoom 换算视口矩形喂 minimap.setViewport)
        //   -- core 状态机不消费相机位姿,同 unit.position 惯例显式接地,不进 onUnhandled
        //   (否则每次镜头移动/钳制都会报一次「未处理」噪音)。
        // unit.position(@since v3.12,task_033):位置真相在 world,core 状态机不消费坐标 --
        //   本事件的消费者是 app 层持久化订阅者(落 unit_positions 表,防抖写),
        //   这里显式接地(不进 onUnhandled),否则正常运行时每次落位都会报一次"未处理"噪音。
        // task.queued / started / completed / failed(@since v3.16,task_037):core/task 的
        //   manager 发出的生命周期事件,消费者是 app 层 task-service(出队执行)与任务落库订阅者,
        //   core 状态机不消费 -- 同 unit.position 惯例显式接地,不进 onUnhandled。
        // task.cancelled(@since v3.23,task_047):取消事件同面 —— 消费者 task-service 据此从
        //   待执行队列剔除(防「取消与出队同帧」竞态) + 落库订阅者落 cancelled 快照,同接地。
        // task.awaiting_approval / task.approved(@since v3.25,task_049):审批门生命周期事件,
        //   消费者 task-service(挂起占位 / 批准接手续执行)与落库订阅者,同 task.* 接地口径
        //   (startsWith('task.') 已覆盖,这里只补记契约语义)。
        // exp.gained（@since v3.18，task_039）：app 层发射的经验事件，消费者是 app 层
        //   progression-service（task_040）：经 character manager 累加进 WorldState.characters、
        //   升级则广播 level.up。core 状态机不消费（不写 WorldState），同惯例显式接地 ——
        //   否则每次任务收尾 / 对话轮都会报一次「未处理」噪音。
        // level.up（@since v3.19，task_040）：progression-service 发出的升级广播，消费者是
        //   UI 反馈（041 的解锁提示 / toast 等）；等级真相在 characters 里且已先行落库，
        //   core 状态机不消费 —— 同惯例显式接地，不进 onUnhandled。
        if (event.type === 'unit.position') return;
        // camera.center(@since v3.33,task_057):同名 WorldEvent 是 handleCommand 转发出去的
        //   小地图跳转指令,消费者在世界场景(bridge 转发 syncCameraCenter) -- core 发出后
        //   又在 world 通道上回到本订阅一次,这里显式接地(同 unit.position 惯例,不进 onUnhandled)。
        if (event.type === 'camera.center') return;
        // camera.shake(@since v3.3,task_080):同名 WorldEvent 是 handleCommand 转发出去的
        //   里程碑震动指令,消费者在世界场景(bridge 转发 syncCameraShake) -- core 发出后
        //   又在 world 通道上回到本订阅一次,这里显式接地(同 camera.center 惯例,不进 onUnhandled)。
        if (event.type === 'camera.shake') return;
        // focus.unit(@since v3.4,task_091):同名 WorldEvent 是 handleCommand 转发出去的
        //   单位联动指令,消费者是世界层(task_092) -- core 发出后又在 world 通道上回到
        //   本订阅一次,这里显式接地(同 camera.shake 惯例,不进 onUnhandled)。
        if (event.type === 'focus.unit') return;
        if (event.type === 'camera.moved') return;
        if (event.type === 'exp.gained') return;
        if (event.type === 'level.up') return;
        if (event.type.startsWith('task.')) return;
        // pipeline.completed / pipeline.failed(@since v3.27,task_051):app 层 pipeline-service
        //   发出的整线终态广播,消费者是组合根接的 toast(UI 反馈)。core 状态机不消费
        //   (编排态不进 WorldState,见 core/task/pipeline.ts 架构注) -- 同 task.* 惯例显式接地。
        if (event.type.startsWith('pipeline.')) return;
        // unit.speaking(@since v3.37,task_062):app 层 chat-service 发出的「正在说话」标志位广播,
        //   消费者是战场场景(bridge 转发 syncUnitSpeaking -> unit-layer 头顶气泡)。纯瞬态表现,
        //   不写 WorldState(core 状态机不消费) -- 同 unit.position 惯例显式接地,不进 onUnhandled
        //   (否则每轮对话起止都会报一次「未处理」噪音)。
        if (event.type === 'unit.speaking') return;
        // unit.bubble(@since v3.3,task_077):world 层要求某个单位冒一句话(气泡系统 task_076 消费),
        //   纯瞬态表现,不写 WorldState -- 同 unit.speaking 惯例显式接地,不进 onUnhandled
        //   (否则每次下达指令都会报一次「未处理」噪音)。
        if (event.type === 'unit.bubble') return;
        // fx.sound(@since v3.3,task_077):音效钩子(声音包 v3.3-10 消费),战场只发事件不做音频 --
        //   同上,显式接地。
        if (event.type === 'fx.sound') return;
        // replay.beat(@since v3.3,task_082):当日回放的节拍广播,消费者是世界场景
        //   (bridge 转发 syncReplayBeat -> objects/replay-layer 画回放化身)。纯瞬态表现,
        //   不写 WorldState -- 同 unit.bubble 惯例显式接地,不进 onUnhandled
        //   (否则拖一次时间轴就会报一串「未处理」噪音)。
        if (event.type === 'replay.beat') return;
        reportUnhandled('world', event);
    }
  };

  let stop: (() => void) | null = null;

  const start = (): (() => void) => {
    if (!stop) {
      const offs: Unsubscribe[] = [
        // 状态一变就广播:这是 core → world / hud 的唯一出口,两侧都不许直接读 store
        store.subscribe(emitState),
        onCommand(handleCommand),
        onWorldEvent(handleWorldEvent),
      ];
      // @since v3.1 agent-link 与总线同生共死:连接是外部资源,运行时停了就必须关(资源必须可清理)
      const stopAgentLink = agentLink?.start();
      stop = () => {
        offs.forEach((off) => off());
        stopAgentLink?.();
        stop = null;
      };
    }
    return stop;
  };

  return {
    store,
    start,
    get running() { return stop !== null; },
  };
}

/**
 * 默认单例:应用根(dev 入口 / 未来的 Electron 渲染入口)启动它一次即可。
 * 单测请用 createCoreRuntime({ store: createStore() }) 隔离,构造本身没有副作用。
 */
export const coreRuntime: CoreRuntime = createCoreRuntime();