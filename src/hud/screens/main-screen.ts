/**
 * 文件职责：HUD 主屏壳 —— 一个挂载容器，把核心 HUD 区块组织起来（顶栏态势摘要 / agent 侧栏 /
 *   命令面板 / 态势总览 / 日志抽屉 / 聊天抽屉），通过事件桥把组件交互翻译成 HudCommand。
 *   组件本层不直连 core/bus。
 *   屏位路由（@since v3.6）：依据 WorldState.currentScreen 切换 main / settings / character
 *   三屏之一的渲染；status-screen 不占独立屏位，仍以"主屏浮动区块"形态挂载，
 *   跳转出去走 ui.navigate，落到 store.currentScreen 后由本屏切换渲染。
 *   布局形态（@since v3.7，task_020）：**RTS 悬浮布局** —— 战场占满视口，HUD 环绕四周悬浮
 *   （顶栏态势摘要 / 左单位竖栏 / 右态势总览+日志抽屉 / 底命令横条），子屏与抽屉覆盖在最上层。
 *   交互铁律：除 HUD 实体面板外，空白区域的 pointer-events 必须穿透到 Phaser 画布
 *   （拖拽平移 / 框选 / 滚轮缩放不被遮挡）—— 容器 pointer-events:none，只有面板开 auto。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级；用户反馈「hud 并没有环绕整个 rts 屏幕」。
 * 输入：父容器（mount 时传入 DOM 节点）；总线适配器（dispatch 入口）。
 * 输出：渲染到父容器的 DOM；交互通过 strat-button-click / 等事件触发 adapter.dispatch。
 * 禁止事项：
 *   1. import 任何 src/world/、src/stratix-rts/、vue/react/pinia —— 铁律；
 *   2. 直接 emitCommand —— 全部走注入的 adapter（事件 → adapter.dispatch）；
 *   3. 写死颜色 / 边框 —— 全部引用 --srf-* 变量；
 *   4. 跨屏业务态 —— 本屏不持有业务态，只持有"当前选中皮肤 / 当前屏位 / 聊天抽屉开合"等纯展示态；
 *      当前屏位以 core 广播的 WorldState.currentScreen 为单一口径（status-screen 同源）。
 *
 * 屏位路由约定（@since v3.6，本任务接线）：
 *   - currentScreen 为 undefined / 'main' 时：渲染主屏布局（命令面板 + agent 侧栏 + 态势总览 + 日志抽屉）；
 *   - 'settings' 时：替换内容区为 settings-screen（settings 自带返回按钮 → ui.navigate(main)）；
 *   - 'character' 时：替换内容区为 character-screen（character 自带返回按钮 → ui.navigate(main)）；
 *   - 'chat' 由 core 解释为"打开聊天抽屉"，不入 currentScreen（见 core/types.ts 注释），
 *     故本屏不为此分支 —— 聊天抽屉以覆盖层形态挂在主屏上，由顶栏按钮开合（纯展示态）。
 *   why 用 replace 而非 overlay：sub-screen 自身带 topbar + body + 返回按钮，
 *   若仍渲染主屏 topbar/抽屉会出现双 topbar 与抽屉占视野；直接换内容区更稳。
 */

import type { WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { mountAgentPanel } from '../panels/agent-panel';
import { mountChatDrawer } from '../panels/chat-drawer';
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

/**
 * 主屏 / 子屏共用的样式表（模块级常量）。
 * why 独立成常量：屏位切换会重写 host.innerHTML，样式必须能跟着一起重挂，否则子屏会裸奔。
 * why 类名带 hud- 前缀：本表是文档级样式表（style 元素不进 shadow DOM），类名不加前缀会与
 * 页面里其它同名词撞车（settings / character 屏在 shadow DOM 内，不受影响，但主屏布局在文档流里）。
 */
const MAIN_SCREEN_STYLE = `
  .hud-root {
    /* why relative 而不是 absolute：挂载方（#hud-root）负责定位，本屏只在其内部排布浮层 ——
       正式入口里 HUD 覆盖整个视口，dev 页里 HUD 只覆盖自己那一栏，两种挂法都不用改本文件。 */
    position: relative;
    width: 100%;
    height: 100%;
    overflow: auto;
    pointer-events: none;
    /* why 容器查询单位（cqh）：浮层尺寸按**容器**高度算，不是视口高度 ——
       正式入口里容器 = 视口，dev 页里容器 = HUD 那一栏，两者都不会把浮层撑出容器。 */
    container-type: size;
    /* HUD 边缘布局的尺寸常量：顶栏 / 底栏高度，四个方向的浮层按它对齐。 */
    --hud-topbar-h: 48px;
    --hud-bottom-h: min(34cqh, 300px);
    --hud-gap: var(--srf-spacing-md, 12px);
    color: var(--srf-text, #e6e9ef);
    font-family: var(--srf-font-ui, sans-serif);
    font-size: var(--srf-font-size-md, 14px);
  }
  /* 悬浮面板通用底：把 --srf-panel 指向半透明 overlay token。
     why 不改面板组件内部：组件一律 var(--srf-panel) 取色，
     在容器上改写这个变量即整体变半透明（组件零改动，符合"不动面板业务"的约束）。 */
  .hud-surface {
    --srf-panel: var(--srf-panel-overlay);
    --srf-panel-elevated: var(--srf-panel-elevated-overlay);
    pointer-events: auto;
  }
  /* 顶栏：态势摘要横条（单位 / 任务 / 会话计数 + 主题切换 + 未读通知角标），贴顶通栏。 */
  .hud-topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    min-height: var(--hud-topbar-h);
    z-index: 30;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--srf-spacing-md, 12px);
    padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-md, 12px);
    background: var(--srf-panel-overlay);
    border-bottom: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
    pointer-events: auto;
  }
  .hud-brand { font-size: var(--srf-font-size-lg, 16px); white-space: nowrap; }
  .hud-stats { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--srf-spacing-md, 12px); flex: 1 1 auto; min-width: 0; }
  .hud-stat { display: flex; align-items: baseline; gap: var(--srf-spacing-xs, 4px); color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); white-space: nowrap; }
  .hud-stat-value { color: var(--srf-text, #e6e9ef); font-size: var(--srf-font-size-md, 14px); font-variant-numeric: tabular-nums; }
  .hud-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--srf-spacing-sm, 8px); }
  /* 未读通知角标：无通知时隐藏（hidden 属性）。 */
  .hud-notice-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    box-sizing: border-box;
    border-radius: 9px;
    background: var(--srf-danger, #e06c75);
    color: var(--srf-bg, #0f1116);
    font-size: var(--srf-font-size-sm, 12px);
    line-height: 18px;
    text-align: center;
  }
  .hud-notice-badge[hidden] { display: none; }
  .hud-theme-tag { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); white-space: nowrap; }
  /* 左栏：选中单位详情，浮动竖栏。 */
  .hud-rail-left {
    position: absolute;
    left: var(--hud-gap);
    top: calc(var(--hud-topbar-h) + var(--hud-gap));
    bottom: calc(var(--hud-bottom-h) + var(--hud-gap));
    width: min(320px, 28vw);
    z-index: 20;
    overflow: auto;
  }
  /* 右栏：态势总览（上）+ 日志抽屉（下），纵向排布互不重叠。 */
  .hud-rail-right {
    position: absolute;
    right: var(--hud-gap);
    top: calc(var(--hud-topbar-h) + var(--hud-gap));
    bottom: calc(var(--hud-bottom-h) + var(--hud-gap));
    width: min(360px, 30vw);
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--hud-gap);
    pointer-events: none;
  }
  .hud-status-slot { flex: 1 1 auto; min-height: 0; overflow: auto; }
  .hud-drawer-slot { flex: 0 0 auto; max-height: 45%; overflow: auto; }
  /* 底栏：命令横条，贴底居中。 */
  .hud-bottom-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--hud-bottom-h);
    z-index: 25;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
    padding: 0 var(--hud-gap) var(--hud-gap);
  }
  .hud-bottom-bar > .hud-surface { width: min(1100px, 100%); height: 100%; overflow: auto; }
  /* 命令横条：把每个分组里的命令按钮排成横排（面板内部布局不动，靠 part 钩子适配）。
     why：面板是竖排列表，直接放进底栏只能露出一半命令；横排后底栏一眼看全。 */
  .hud-bottom-bar strat-command-panel::part(group) {
    grid-auto-flow: column;
    grid-auto-columns: minmax(6.5em, 1fr);
    align-items: start;
  }
  /* 聊天抽屉：最上层覆盖层（默认收起，顶栏「打开聊天」开合）。 */
  .hud-chat-slot {
    position: absolute;
    right: var(--hud-gap);
    top: calc(var(--hud-topbar-h) + var(--hud-gap));
    bottom: calc(var(--hud-bottom-h) + var(--hud-gap));
    width: min(380px, 32vw);
    z-index: 40;
    overflow: auto;
  }
  .hud-chat-slot[hidden] { display: none; }
  /* 子屏（settings / character）：整屏覆盖层，盖住战场。 */
  .hud-sub-screen {
    position: absolute;
    inset: 0;
    z-index: 50;
    pointer-events: auto;
    background: var(--srf-bg, #0f1116);
  }
  /* 紧凑容器（dev 页的 HUD 窄栏 / 窄窗口）：浮层改为纵向堆叠。
     why 容器查询而不是媒体查询：dev 页的 HUD 只占视口的一小栏，视口宽度代表不了它的宽度；
     窄容器里再按视口尺度铺四边浮层，必然互相压住。 */
  @container (max-width: 700px) {
    .hud-topbar { position: static; }
    .hud-rail-left,
    .hud-rail-right,
    .hud-bottom-bar,
    .hud-chat-slot {
      position: static;
      width: auto;
      height: auto;
      max-height: none;
    }
    .hud-bottom-bar { display: block; padding: var(--hud-gap); }
    .hud-bottom-bar > .hud-surface { width: auto; height: auto; overflow: visible; }
  }
`;

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
    /** 聊天抽屉开合（纯展示态；跨主屏重渲保留）。 */
    let chatOpen = false;

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
      <style>${MAIN_SCREEN_STYLE}</style>
      <div class="hud-root" part="root">
        <header class="hud-topbar" data-role="topbar">
          <span class="hud-brand">Stratix</span>
          <div class="hud-stats" data-role="stats">
            <span class="hud-stat">单位 <b class="hud-stat-value" data-role="unit-count">0</b></span>
            <span class="hud-stat">任务 <b class="hud-stat-value" data-role="mission-count">0</b></span>
            <span class="hud-stat">会话 <b class="hud-stat-value" data-role="link-count">0</b></span>
          </div>
          <div class="hud-actions">
            <span class="hud-notice-badge" data-role="notice-badge" hidden title="待处理通知">0</span>
            <${STRAT_BUTTON_TAG} label="切换像素风" variant="default" data-role="theme"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="打开聊天" variant="default" data-role="chat"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="看角色" variant="default" data-role="character"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="去设置" variant="primary" data-role="settings"></${STRAT_BUTTON_TAG}>
            <span class="hud-theme-tag" data-role="theme-tag">default</span>
          </div>
        </header>
        <div class="hud-rail-left hud-surface" data-role="agent-panel"></div>
        <div class="hud-rail-right">
          <div class="hud-status-slot hud-surface" data-role="status-screen"></div>
          <div class="hud-drawer-slot hud-surface" data-role="log-drawer"></div>
        </div>
        <div class="hud-bottom-bar">
          <div class="hud-surface" data-role="command-panel"></div>
        </div>
        <div class="hud-chat-slot hud-surface" data-role="chat-drawer" hidden></div>
      </div>
    `;

      // 计数元素缓存一次：core 每次状态变更都全量广播，逐帧 querySelector 是纯浪费。
      const unitCounter = host.querySelector('[data-role="unit-count"]');
      const missionCounter = host.querySelector('[data-role="mission-count"]');
      const linkCounter = host.querySelector('[data-role="link-count"]');
      const noticeBadge = host.querySelector<HTMLElement>('[data-role="notice-badge"]');
      const chatSlot = host.querySelector<HTMLElement>('[data-role="chat-drawer"]');
      if (chatSlot) chatSlot.hidden = !chatOpen;

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
        // 抽屉开合是本屏的纯展示态（core 不回写 currentScreen='chat'），就地开合覆盖层。
        chatOpen = !chatOpen;
        const slot = host.querySelector<HTMLElement>('[data-role="chat-drawer"]');
        if (slot) slot.hidden = !chatOpen;
      };

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

      // 聊天抽屉：覆盖层形态（默认 hidden），开合由顶栏按钮控制。
      const unmountChat = chatSlot ? mountChatDrawer(adapter, chatSlot) : null;

      const unsubscribe = adapter.subscribe((state) => {
        if (unitCounter) unitCounter.textContent = String(state.units.length);
        if (missionCounter) missionCounter.textContent = String(state.missions.length);
        if (linkCounter) linkCounter.textContent = String(state.links.length);
        if (noticeBadge) {
          const pending = state.notices.length;
          noticeBadge.textContent = String(pending);
          noticeBadge.hidden = pending === 0;
        }
      });

      // 主屏布局内所有挂载闭包打包到一个闭包里：renderScreen 拆主屏布局时一次性释放。
      unmountMain = () => {
        unsubscribe();
        unmountChat?.();
        unmountDrawer?.();
        unmountStatus?.();
        unmountAgentPanel?.();
        unmountPanel?.();
        host.removeEventListener('strat-button-click', themeHandler);
        // 这里不置空 host.innerHTML —— renderMain 自身会立刻重写。
      };
    };

    const renderSettings = (): void => {
      if (unmountMain) {
        unmountMain();
        unmountMain = null;
      }
      host.innerHTML = `<style>${MAIN_SCREEN_STYLE}</style>`;
      const subHost = document.createElement('div');
      subHost.className = 'hud-sub-screen';
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
      host.innerHTML = `<style>${MAIN_SCREEN_STYLE}</style>`;
      const subHost = document.createElement('div');
      subHost.className = 'hud-sub-screen';
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
