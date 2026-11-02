/**
 * 文件职责：HUD ↔ core 的唯一通信网关。订阅 core 广播的 WorldState（驱动渲染）；
 *   把 HUD 用户操作打包成 HudCommand 发回 core；同时在本地拦截 `theme.set` 直接落皮肤（避免
 *   走过 core 再回到 hud 的回路）。
 *   来源：docs/REFACTOR_PLAN_V3.md §1 通信铁律 + §3 主题 token 体系。
 * 输入：core/bus 的三个通道 —— onState / emitCommand；以及 theme-controller 的 apply。
 * 输出：浏览器 DOM 渲染（通过订阅者）；core 总线出 command 与 state 事件。
 * 禁止事项：
 *   1. import 任何 src/world/、src/stratix-rts/、vue/react/pinia —— 铁律；
 *   2. 直接持有 WorldState 之外的可变状态 —— 业务态归 core，hud 只缓存最近一次以备未挂载期回放；
 *   3. 双向直连 —— hud 侧只通过本适配器收发，不允许组件直接 `emitCommand`；
 *   4. 资源泄漏 —— mount() 必须返回 unmount，所有监听器订阅都挂在这个 unmount 上销毁。
 *
 * 设计要点：
 *   - 工厂函数 + 依赖注入：核心逻辑可单测；生产代码用 `createCoreBridgeAdapter` 接 core/bus；
 *   - dispatch 是组件入口；theme.set 由本地主题控制器消费（避免与 core 形成来回回路）；
 *   - mount()/unmount() 是生命周期入口；未 mount 时 dispatch 仍可调用，但 state 不会送达。
 */

import type { Unsubscribe } from '../../core/bus';
import { emitCommand, onState } from '../../core/bus';
import type { HudCommand, WorldState } from '../../core/types';
import { demoMode } from '../theme/demo-mode';
import type { ThemeController, ThemeId } from '../theme/theme-controller';

/** 适配器依赖注入接口：把 core/bus 的 mitt 订阅函数抽出来，便于单测纯逻辑。 */
export interface HudBridgeDeps {
  /** 订阅 state 广播；返回退订函数。生产=core/bus.onState；单测=jest.fn。 */
  readonly onState: (handler: (state: WorldState) => void) => Unsubscribe;
  /** 发送 HudCommand；生产=core/bus.emitCommand。 */
  readonly emitCommand: (command: HudCommand) => void;
  /** 本地落皮肤控制器；适配器只在收到 `theme.set` 时调它。 */
  readonly applyTheme: (themeId: ThemeId) => void;
}

/** 适配器对外暴露的最小 API。 */
export interface HudBusAdapter {
  /** HUD 内部唯一入口：把组件操作打包成命令发出。theme.set 会先落皮肤再广播。 */
  dispatch(command: HudCommand): void;
  /** 订阅最新 WorldState；mount 前后都可调用，未 mount 的回调会在 mount 后立即拿到缓存快照。 */
  subscribe(handler: (state: WorldState) => void): Unsubscribe;
  /** 启动 state 订阅；重复调用是 no-op；返回 unmount 闭包。 */
  mount(): () => void;
  /** 读取最近一次收到的 state；用于组件初始化渲染与 mount 后回放。 */
  readonly latest: WorldState | null;
}

/**
 * 构造 HUD ↔ core 适配器。
 * 默认依赖：直接连 core/bus，单测用第一个重载。
 */
export function createHudBusAdapter(
  partial: Partial<HudBridgeDeps> & { readonly themeController: ThemeController }
): HudBusAdapter {
  const deps: HudBridgeDeps = {
    onState: partial.onState ?? onState,
    emitCommand: partial.emitCommand ?? emitCommand,
    applyTheme: partial.themeController.apply.bind(partial.themeController),
  };

  let latest: WorldState | null = null;
  const subscribers = new Set<(state: WorldState) => void>();
  let coreUnsub: Unsubscribe | null = null;
  let mounted = false;

  const fanout = (state: WorldState): void => {
    latest = state;
    subscribers.forEach((h) => h(state));
  };

  const rehydrate = (handler: (state: WorldState) => void): void => {
    if (latest) handler(latest);
  };

  const dispatch = (command: HudCommand): void => {
    // 本地落皮肤：避免 'theme.set' 走完 core 又被 hud 监听回来的回路，
    // 直接在 adapter 入口消费即可；同时仍 emit 给 core 让它记账（后续任务可能用到）。
    if (command.type === 'theme.set') {
      deps.applyTheme(command.themeId);
      // 换皮肤后重算演示模式的字号覆盖（@since v3.3，task_110）：各皮肤的基准字号不同，
      // 「+30%」是相对放大 —— 基准换了，覆盖必须跟着重算，否则字号会停在旧皮肤的口径上。
      demoMode.refreshTypography();
    }
    deps.emitCommand(command);
  };

  const subscribe = (handler: (state: WorldState) => void): Unsubscribe => {
    subscribers.add(handler);
    rehydrate(handler);
    return () => { subscribers.delete(handler); };
  };

  const mount = (): (() => void) => {
    if (!mounted) {
      coreUnsub = deps.onState(fanout);
      mounted = true;
    }
    return () => {
      if (coreUnsub) { coreUnsub(); coreUnsub = null; }
      subscribers.clear();
      mounted = false;
    };
  };

  return {
    dispatch,
    subscribe,
    mount,
    get latest() { return latest; },
  };
}
