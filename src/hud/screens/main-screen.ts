/**
 * 文件职责：HUD 主屏壳 —— 一个挂载容器，把核心 HUD 区块组织起来（status / actions / log placeholder），
 *   通过事件桥把组件交互翻译成 HudCommand。组件本层不直连 core/bus。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级。
 * 输入：父容器（mount 时传入 DOM 节点）；总线适配器（dispatch 入口）。
 * 输出：渲染到父容器的 DOM；交互通过 strat-button-click / 等事件触发 adapter.dispatch。
 * 禁止事项：
 *   1. import 任何 src/world/、src/stratix-rts/、vue/react/pinia —— 铁律；
 *   2. 直接 emitCommand —— 全部走注入的 adapter（事件 → adapter.dispatch）；
 *   3. 写死颜色 / 边框 —— 全部引用 --srf-* 变量；
 *   4. 跨屏状态 —— 本屏不持有业务态，只持有"当前选中皮肤 / 显示滚动日志"等纯展示态。
 *
 * 后续任务会在 panels/ 下加 chat-drawer 等，本屏负责骨架与路由接线。
 */

import type { HudBusAdapter } from '../bridge/bus-adapter';
import { mountAgentPanel } from '../panels/agent-panel';
import { mountCommandPanel } from '../panels/command-panel';
import { mountLogDrawer } from '../panels/log-drawer';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

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
      </style>
      <div class="root" part="root">
        <div class="topbar">
          <span class="title">Stratix HUD</span>
          <div class="actions">
            <${STRAT_BUTTON_TAG} label="切换像素风" variant="default"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="去设置" variant="primary"></${STRAT_BUTTON_TAG}>
          </div>
        </div>
        <div class="body" data-role="body">
          <div class="columns">
            <div data-role="command-panel"></div>
            <div data-role="agent-panel"></div>
          </div>
          <p>主屏骨架就绪。后续任务将在此插入 chat-drawer。</p>
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
    const onNavClick = (): void => {
      adapter.dispatch({ type: 'ui.navigate', screen: 'settings' });
    };

    const buttons = host.querySelectorAll<HTMLElement>(STRAT_BUTTON_TAG);
    const themeBtn = buttons.item(0);
    const navBtn = buttons.item(1);
    const themeHandler = (e: Event): void => { if (e.target === themeBtn) onThemeClick(); };
    const navHandler = (e: Event): void => { if (e.target === navBtn) onNavClick(); };
    host.addEventListener('strat-button-click', themeHandler);
    host.addEventListener('strat-button-click', navHandler);

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

    const unsubscribe = adapter.subscribe((state) => {
      const counter = host.querySelector('[data-role="unit-count"]');
      if (counter) counter.textContent = String(state.units.length);
    });

    return () => {
      unmountDrawer?.();
      unmountAgentPanel?.();
      unmountPanel?.();
      host.removeEventListener('strat-button-click', themeHandler);
      host.removeEventListener('strat-button-click', navHandler);
      unsubscribe();
      host.innerHTML = '';
    };
  };

  return {
    mount: renderTo,
    get currentThemeId() { return currentTheme; },
  };
}
