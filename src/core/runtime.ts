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
 */

import type { AgentLinkManager } from './agent-link';
import { emitState, onCommand, onWorldEvent, type Unsubscribe } from './bus';
import { createCharacterManager, type CharacterManager } from './character';
import { createMissionManager, type MissionManager } from './mission';
import { createTaskManager, type TaskManager } from './task';
import type { CoreStore } from './store';
import { worldStore } from './store';
import type { HudCommand, WorldEvent } from './types';
import type { SelectionAction } from './unit/selection';
import { applySelectionAction } from './unit/selection';

/** 未落地的消息来自哪一侧(dev 观测面板与单测据此区分来源)。 */
export type UnhandledChannel = 'command' | 'world';

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
      // @since v3.3 任务域:命令翻译只在 core/mission 里有一份(manager 负责转状态机动作 + 写库 + 报错)
      case 'mission.create':
        mission.createMission({ title: command.title, unitIds: command.unitIds });
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
      // @since v3.6 角色提示词写入:落到 character manager(不再走 onUnhandled)。
      // 合法性与 trim 由 core/character/persona.ts 校验;被拒走 Notice(manager 内部完成)。
      case 'character.persona.update':
        character.updatePersona(command.characterId, command.prompt);
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
      // @since v3.16 角色任务派发(task_037):落到 task manager(不再走 onUnhandled)。
      // prompt 合法性与角色在档由 manager 裁决;agent 绑定 / 检出的守门在 app 层 task-service
      // 出队时做(不满足 → failTask 直达 failed,状态里看得见原因)。
      case 'task.assign':
        task.assignTask({ characterId: command.characterId, prompt: command.prompt });
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
      default:
        // selection.box:core 不持有坐标,算不出命中集合(判定在 world 侧),交给上报方补 id;
        // camera.moved:WorldState 契约里没有相机字段(core/types.ts 冻结版),暂不做业务处理;
        // unit.position(@since v3.12,task_033):位置真相在 world,core 状态机不消费坐标 --
        //   本事件的消费者是 app 层持久化订阅者(落 unit_positions 表,防抖写),
        //   这里显式接地(不进 onUnhandled),否则正常运行时每次落位都会报一次"未处理"噪音。
        // task.queued / started / completed / failed(@since v3.16,task_037):core/task 的
        //   manager 发出的生命周期事件,消费者是 app 层 task-service(出队执行)与任务落库订阅者,
        //   core 状态机不消费 -- 同 unit.position 惯例显式接地,不进 onUnhandled。
        // exp.gained（@since v3.18，task_039）：app 层发射的经验事件，消费者是 app 层
        //   progression-service（task_040）：经 character manager 累加进 WorldState.characters、
        //   升级则广播 level.up。core 状态机不消费（不写 WorldState），同惯例显式接地 ——
        //   否则每次任务收尾 / 对话轮都会报一次「未处理」噪音。
        // level.up（@since v3.19，task_040）：progression-service 发出的升级广播，消费者是
        //   UI 反馈（041 的解锁提示 / toast 等）；等级真相在 characters 里且已先行落库，
        //   core 状态机不消费 —— 同惯例显式接地，不进 onUnhandled。
        if (event.type === 'unit.position') return;
        if (event.type === 'exp.gained') return;
        if (event.type === 'level.up') return;
        if (event.type.startsWith('task.')) return;
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