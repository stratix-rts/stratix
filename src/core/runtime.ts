/**
 * 文件职责：core 运行时 —— 把「状态机」与「总线」接成一条闭环：
 *   store 变更 → state 广播给 world / hud；HudCommand / WorldEvent → 选择状态机 → store。
 *   Phase 1 三件套（types / bus / store+unit）各自可用但互不相连，本文件是它们之间唯一的接线。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §6 Phase 1「HUD 按钮 → command → core → state → 场景」。
 * 输入：core/bus 的 command / world 两个通道；core/store 的订阅回调。
 * 输出：WorldState 广播（state 通道）；store 里的选择集变更。
 * 禁止事项：
 *   1. import world / hud / phaser / vue —— core 是依赖图的底层，渲染细节一律不许上浮（架构扫描项）；
 *   2. 持有第二份状态 —— 业务真相只在 store，本文件只做「事件 → 状态机 → store」的三段翻译；
 *   3. 静默吞掉看不懂的事件 —— 未落地的命令/事件一律转交 onUnhandled，dev 入口用它打观测面板；
 *   4. 一次用户操作打多次 state —— 动作 + 对账合并在同一次 setState 里（perf：广播有成本）；
 *   5. 在这里算坐标 —— core 不持有单位位置，框选命中判定在 world/objects/unit-registry.ts；
 *   6. 在这里 emitState 之外再开广播口 —— state 通道的唯一出口就是本文件的 store 订阅，
 *      子模块（agent-link）只写 store，由本文件统一广播，避免一次变更广播两遍。
 *
 * @since v3.1 外部 agent 连接（core/agent-link）接入：manager 注入本运行时后，
 *   link.open / link.resume / link.reconnect / link.close 与 chat.send 由 manager 消费；
 *   未注入 manager 时这些命令照旧走 onUnhandled（默认单例行为不变，单测基线不破）。
 */

import type { AgentLinkManager } from './agent-link';
import { emitState, onCommand, onWorldEvent, type Unsubscribe } from './bus';
import type { CoreStore } from './store';
import { worldStore } from './store';
import type { HudCommand, WorldEvent } from './types';
import type { SelectionAction } from './unit/selection';
import { applySelectionAction } from './unit/selection';

/** 未落地的消息来自哪一侧（dev 观测面板与单测据此区分来源）。 */
export type UnhandledChannel = 'command' | 'world';

export interface CoreRuntimeOptions {
  /** 状态持有者；默认用 store.ts 的 worldStore 单例（两侧共用同一份世界态）。 */
  readonly store?: CoreStore;
  /**
   * 外部 agent 连接管理器（@since v3.1）。
   * why 是"注入"而不是内部 new：构造它需要 transport（真实 IO 依赖），而 runtime 必须保持零 IO；
   * 注入后由本运行时负责随 start/stop 一起起停，卸载时连接一并关闭（资源必须可清理）。
   */
  readonly agentLink?: AgentLinkManager;
  /**
   * 尚未实现的命令 / 事件出口。
   * why 需要它：契约已冻结（§5），Phase 2 的 mission.* / chat.send / ui.navigate 等还没落地，
   * 直接 switch 落空会让"没接上"和"接上了但没反应"长得一模一样，排查成本极高。
   */
  readonly onUnhandled?: (channel: UnhandledChannel, payload: HudCommand | WorldEvent) => void;
}

export interface CoreRuntime {
  readonly store: CoreStore;
  /** 接通闭环；返回 stop 闭包。重复 start 是 no-op（返回同一个 stop，不会叠加订阅）。 */
  start(): () => void;
  /** 当前是否已接通（供 dev 入口与单测断言）。 */
  readonly running: boolean;
}

/** 点击是否按"加选 / 取消选"处理：Shift / Ctrl / ⌘ 任一按下即加选，与 RTS 惯例一致。 */
function isAdditiveClick(mods: { shift: boolean; ctrl: boolean; meta: boolean }): boolean {
  return mods.shift || mods.ctrl || mods.meta;
}

/**
 * 把一次选择变更写进 store：应用动作后立刻与已知单位对账，合并成**一次** setState。
 * why 要对账：HUD / world 都有可能发来已经消失的单位 id（快照与输入天然存在时间差），
 * 悬空 id 留在选择集里会让"编组 = 多选集合"失去意义（core/unit/group.ts 直接取选择集当成员）。
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
  const reportUnhandled = options.onUnhandled ?? ((): void => { /* 默认不打扰；dev 入口与单测会注入 */ });

  /**
   * @since v3.1 这五条命令由 agent-link 消费（它自己订阅同一通道）。
   * runtime 这里**不转发**——转发会让同一命令被处理两次（重复建链、重复发消息）。
   * 识别出来只为把它们从 unhandled 里摘掉；未注入 manager 时它们仍按未落地处理。
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
        // HudCommand 的 mode 只有 set / toggle，与选择状态机的动作同名，直接映射，不做二次翻译
        applySelection(store, { type: command.mode, unitIds: command.unitIds });
        return;
      default:
        if (isAgentLinkCommand(command)) return; // agent-link 已订阅处理
        // TODO(v3.Phase2): mission.assign / mission.confirm / character.persona.update /
        //                 ui.navigate / theme.set（theme.set 由 hud bridge 本地消费，
        //                 core 侧只记账，记账形态定了再落这里）
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
        // selection.box：core 不持有坐标，算不出命中集合（判定在 world 侧），交给上报方补 id；
        // camera.moved：WorldState 契约里没有相机字段（core/types.ts 冻结版），暂不做业务处理
        reportUnhandled('world', event);
    }
  };

  let stop: (() => void) | null = null;

  const start = (): (() => void) => {
    if (!stop) {
      const offs: Unsubscribe[] = [
        // 状态一变就广播：这是 core → world / hud 的唯一出口，两侧都不许直接读 store
        store.subscribe(emitState),
        onCommand(handleCommand),
        onWorldEvent(handleWorldEvent),
      ];
      // @since v3.1 agent-link 与总线同生共死：连接是外部资源，运行时停了就必须关（资源必须可清理）
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
 * 默认单例：应用根（dev 入口 / 未来的 Electron 渲染入口）启动它一次即可。
 * 单测请用 createCoreRuntime({ store: createStore() }) 隔离，构造本身没有副作用。
 */
export const coreRuntime: CoreRuntime = createCoreRuntime();