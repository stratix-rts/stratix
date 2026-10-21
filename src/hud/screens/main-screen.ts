/**
 * 文件职责：HUD 主屏壳 —— 一个挂载容器，把核心 HUD 区块组织起来（status / actions / log placeholder），
 *   通过事件桥把组件交互翻译成 HudCommand。组件本层不直连 core/bus。
 *   屏位路由（@since v3.6）：依据 WorldState.currentScreen 切换 main / settings / character
 *   三屏之一的渲染；status-screen 不占独立屏位，仍以"主屏 .body 区块"形态挂载，
 *   跳转出去走 ui.navigate，落到 store.currentScreen 后由本屏切换渲染。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级。
 * 输入：父容器（mount 时传入 DOM 节点）；总线适配器（dispatch 入口）。
 * 输出：渲染到父容器的 DOM；交互通过 strat-button-click / 等事件触发 adapter.dispatch。
 * 禁止事项：
 *   1. import 任何 src/world/、src/stratix-rts/、vue/react/pinia —— 铁律；
 *   2. 直接 emitCommand —— 全部走注入的 adapter（事件 → adapter.dispatch）；
 *   3. 写死颜色 / 边框 —— 全部引用 --srf-* 变量；
 *   4. 跨屏业务态 —— 本屏不持有业务态，只持有"当前选中皮肤 / 当前屏位"等纯展示态；
 *      当前屏位以 core 广播的 WorldState.currentScreen 为单一口径（status-screen 同源）。
 *
 * 屏位路由约定（@since v3.6，本任务接线）：
 *   - currentScreen 为 undefined / 'main' 时：渲染主屏布局（命令面板 + agent 侧栏 + 状态屏 + 日志抽屉）；
 *   - 'settings' 时：替换内容区为 settings-screen（settings 自带返回按钮 → ui.navigate(main)）；
 *   - 'character' 时：替换内容区为 character-screen（character 自带返回按钮 → ui.navigate(main)）；
 *   - 'chat' 由 core 解释为"打开聊天抽屉"，不入 currentScreen（见 core/types.ts 注释），
 *     故本屏不为此分支 —— chat-drawer 仍由原协议自治。
 *   why 用 replace 而非 overlay：sub-screen 自身带 topbar + body + 返回按钮，
 *     若仍渲染主屏 topbar/抽屉会出现双 topbar 与抽屉占视野；直接换内容区更稳。
 */

import type { WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { mountAgentPanel } from '../panels/agent-panel';
import { mountCommandPanel } from '../panels/command-panel';
import { mountLogDrawer } from '../panels/log-drawer';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import { mountCharacterScreen } from './character-screen';
import { mountSettingsScreen } from './settings-screen';
import { mountStatusScreen } from './status-screen';

/** currentScreen 缺省回落（与读取 WorldState.currentScreen 的各处共用）。 */
const DEFAULT_SCREEN: WorldState['currentScreen'] = 'main';

/** 渲染判定用的窄类型：屏位路由只关心这四个值的差异。 */
type CurrentScreen = 'main' | 'settings' | 'character';

function resolveCurrentScreen(state: WorldState | null): CurrentScreen {
  const screen = state?.currentScreen ?? DEFAULT_SCREEN;
  // 'chat' 由 core/types 注释说明不由 currentScreen 承载；runtime 也不会写它进来 —— 落到 'main'。
  return screen === 'settings' || screen === 'character' ? screen : 'main';
}

export const MAIN_SCREEN_TAG = 'strat-main-screen';

export interface MainScreenHandle {
  /** 把渲染出口挂到指定 DOM 节点；返回 unmount 闭包。 */
  mount(host: HTMLElement): () => void;
  /** 当前激活主题（只读，方便测试断言）。 */
  readonly currentThemeId: 'default' | 'pixel';
}

/** 工厂：构造 main-screen 句柄；接受一个已建好的 bus-adapter（依赖注入）。 */
export function createMainScreen(adapter: HudBusAdapter): MainScreenHandle {
  defineStratButton();
  let currentTheme: 'default' | 'pixel' = 'default';

  const renderTo = (host: HTMLElement): () => void => {
    let currentScreen: CurrentScreen = 'main';
    /** 子屏挂载闭包（卸 sub-screen 时调用；null = 当前没挂任何子屏）。 */
    let unmountSubScreen: (() => void) | null = null;
    /** 主屏布局内各组件的挂载闭包（拆解 / 重建主布局时同步生命周期）。 */
    let unmountMain: (() => void) | null = null;
    /** core 订阅闭包（订阅 WorldState.currentScreen 变化）；只在 mount 期间存在。 */
    let unsubscribeState: (() => void) | null = null;

    const renderMain = (): void => {
      // 已挂的 sub-screen 必须先卸（进 main 时也要走这一步 —— 同屏重复也算 changed 边界）。
      if (unmountSubScreen) {
        unmountSubScreen();
        unmountSubScreen = null;
      }
      if (unmountMain) {
        // 已经是 main 时仍走这里（renderMain 自身幂等）：先拆再装，节点身份会变（屏内容全换）。
        // 主屏布局是壳 + 子组件的集合，拆掉才能清干净。
        unmountMain();
        unmountMain = null;
      }
      host.innerHTML = `
      <style>
        :host { all: initial; }
        .root {
          display: grid;
          grid-template-rows: auto 1fr auto auto;
          height: 100%;
          background: var(--srf-bg, #0f1116);
          color: var(--srf-text, #e6e9ef);
          font-family: var(--srf-font-ui, sans-serif);
          font-size: var(--srf-font-size-md, 14px);
        }
        .topbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: var(--srf-spacing-sm, 8px) var(--srf-spacing-md, 12px);
          background: var(--srf-panel, #181c25);
          border-bottom: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
        }
        .title { font-size: var(--srf-font-size-lg, 16px); color: var(--srf-text, #e6e9ef); }
        .actions { display: flex; gap: var(--srf-spacing-sm, 8px); }
        .body { padding: var(--srf-spacing-md, 12px); overflow: auto; }
        .columns {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 320px);
          gap: var(--srf-spacing-md, 12px);
          align-items: start;
        }
        .footer {
          padding: var(--srf-spacing-sm, 8px) var(--srf-spacing-md, 12px);
          background: var(--srf-panel, #181c25);
          border-top: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
          color: var(--srf-text-muted, #9aa3b2);
          font-size: var(--srf-font-size-sm, 12px);
        }
        /* 日志抽屉贴在主区底部、可折叠：不抢战斗视野，收起时只留一行标题栏。 */
        .drawer-slot { padding: 0 var(--srf-spacing-md, 12px) var(--srf-spacing-md, 12px); }
        /* 态势屏跟在两栏之下：不另开屏位（契约 ScreenId 里没有 status），作为主屏的一个区块挂载。 */
        .status-slot { margin-top: var(--srf-spacing-md, 12px); }
      </style>
      <div class="root" part="root">
        <div class="topbar">
          <span class="title">Stratix HUD</span>
          <div class="actions">
            <${STRAT_BUTTON_TAG} label="切换像素风" variant="default" data-role="theme"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="打开聊天" variant="default" data-role="chat"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="看角色" variant="default" data-role="character"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="去设置" variant="primary" data-role="settings"></${STRAT_BUTTON_TAG}>
          </div>
        </div>
        <div class="body" data-role="body">
          <div class="columns">
            <div data-role="command-panel"></div>
            <div data-role="agent-panel"></div>
          </div>
          <div class="status-slot" data-role="status-screen"></div>
        </div>
        <div class="drawer-slot" data-role="log-drawer"></div>
        <div class="footer">
          皮肤: <span data-role="theme-tag">default</span> · 单元: <span data-role="unit-count">0</span>
        </div>
      </div>
    `;

      const onThemeClick = (): void => {
        const next = currentTheme === 'default' ? 'pixel' : 'default';
        currentTheme = next;
        adapter.dispatch({ type: 'theme.set', themeId: next });
        const tag = host.querySelector('[data-role="theme-tag"]');
        if (tag) tag.textContent = next;
      };
      const onSettingsClick = (): void => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'settings' });
      };
      const onCharacterClick = (): void => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'character' });
      };
      const onChatClick = (): void => {
        // 'chat' 由 core 解释为打开聊天抽屉（见 types.ts ScreenId 注释）；不进 currentScreen。
        adapter.dispatch({ type: 'ui.navigate', screen: 'chat' });
      };

      const buttons = host.querySelectorAll<HTMLElement>(STRAT_BUTTON_TAG);
      const themeBtn = buttons.item(0);
      const chatBtn = buttons.item(1);
      const charBtn = buttons.item(2);
      const setBtn = buttons.item(3);

      const themeHandler = (e: Event): void => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-role="theme"]')) onThemeClick();
        else if (target?.closest('[data-role="chat"]')) onChatClick();
        else if (target?.closest('[data-role="character"]')) onCharacterClick();
        else if (target?.closest('[data-role="settings"]')) onSettingsClick();
      };
      host.addEventListener('strat-button-click', themeHandler);

      // 命令面板：唯一命令入口。注入同一个 adapter —— 与顶栏按钮共用一条派发通道，
      // 不给面板另开总线口子。必须在 host.innerHTML 之后挂（容器节点得先存在）。
      const panelHost = host.querySelector<HTMLElement>('[data-role="command-panel"]');
      const unmountPanel = panelHost ? mountCommandPanel(adapter, panelHost) : null;

      // Agent 侧栏：选中单位的业务态。与命令面板共用同一个 adapter —— 两条派发通道合成一条。
      const agentHost = host.querySelector<HTMLElement>('[data-role="agent-panel"]');
      const unmountAgentPanel = agentHost ? mountAgentPanel(adapter, agentHost) : null;

      // 日志抽屉：纯展示，不发命令 —— 只把同一个 adapter 的 subscribe 能力给它。
      const drawerHost = host.querySelector<HTMLElement>('[data-role="log-drawer"]');
      const unmountDrawer = drawerHost ? mountLogDrawer(adapter, drawerHost) : null;

      // 态势屏：同为纯展示区块（指标卡 / 系统状态 / 最近事件全由 WorldState 派生），
      // 复用同一个 adapter —— 它唯一的出口是导航 ui.navigate，不发任何业务命令。
      const statusHost = host.querySelector<HTMLElement>('[data-role="status-screen"]');
      const unmountStatus = statusHost ? mountStatusScreen(adapter, statusHost) : null;

      const unsubscribe = adapter.subscribe((state) => {
        const counter = host.querySelector('[data-role="unit-count"]');
        if (counter) counter.textContent = String(state.units.length);
      });

      // 主屏布局内所有挂载闭包打包到一个闭包里：renderScreen 拆主屏布局时一次性释放。
      unmountMain = () => {
        unsubscribe();
        unmountDrawer?.();
        unmountStatus?.();
        unmountAgentPanel?.();
        unmountPanel?.();
        host.removeEventListener('strat-button-click', themeHandler);
        // 这里不置空 host.innerHTML —— renderMain 自身会立刻重写。
      };

      void themeBtn; void chatBtn; void charBtn; void setBtn;
    };

    const renderSettings = (): void => {
      if (unmountMain) {
        unmountMain();
        unmountMain = null;
      }
      host.innerHTML = '';
      const subHost = document.createElement('div');
      subHost.style.height = '100%';
      host.appendChild(subHost);
      // settings-screen 自带 topbar + 返回按钮 → ui.navigate(main)。
      unmountSubScreen = mountSettingsScreen(adapter, subHost);
      currentScreen = 'settings';
    };

    const renderCharacter = (): void => {
      if (unmountMain) {
        unmountMain();
        unmountMain = null;
      }
      host.innerHTML = '';
      const subHost = document.createElement('div');
      subHost.style.height = '100%';
      host.appendChild(subHost);
      // character-screen 自带 topbar + 返回按钮 → ui.navigate(main) 或 ui.navigate(chat) 打开聊天抽屉。
      unmountSubScreen = mountCharacterScreen(adapter, subHost);
      currentScreen = 'character';
    };

    const renderScreen = (state: WorldState | null): void => {
      const next = resolveCurrentScreen(state);
      if (next === currentScreen && (next === 'main' ? unmountMain !== null : unmountSubScreen !== null)) {
        // 同屏重复广播，跳过重渲；perf：屏位无变更不刷 DOM。
        return;
      }
      currentScreen = next;
      if (next === 'main') renderMain();
      else if (next === 'settings') renderSettings();
      else renderCharacter();
    };

    // 初次渲染：若 adapter 已挂载（dev 入口顺序），用其最新快照；否则按 main 兜底显示。
    renderScreen(adapter.latest);
    // 之后跟着 core 广播的 currentScreen 走：每次 main / settings / character 切换都重渲对应屏。
    unsubscribeState = adapter.subscribe((state) => renderScreen(state));

    return () => {
      unsubscribeState?.();
      unsubscribeState = null;
      unmountMain?.();
      unmountMain = null;
      unmountSubScreen?.();
      unmountSubScreen = null;
      host.innerHTML = '';
    };
  };

  return {
    mount: renderTo,
    get currentThemeId() { return currentTheme; },
  };
}
