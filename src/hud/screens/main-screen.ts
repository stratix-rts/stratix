/**
 * 文件职责：HUD 主屏壳 —— 一个挂载容器，把核心 HUD 区块组织起来（顶栏态势摘要 / agent 侧栏 /
 *   命令面板 / 态势总览 / 日志抽屉），通过事件桥把组件交互翻译成 HudCommand。
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
 *   4. 跨屏业务态 —— 本屏不持有业务态，只持有"当前选中皮肤 / 当前屏位"等纯展示态；
 *      当前屏位以 core 广播的 WorldState.currentScreen 为单一口径（status-screen 同源）。
 *
 * 屏位路由约定（@since v3.6，本任务接线）：
 *   - currentScreen 为 undefined / 'main' 时：渲染主屏布局（命令面板 + agent 侧栏 + 态势总览 + 日志抽屉）；
 *   - 'settings' 时：替换内容区为 settings-screen（settings 自带返回按钮 → ui.navigate(main)）；
 *   - 'character' 时：替换内容区为 character-screen（character 自带返回按钮 → ui.navigate(main)）；
 *   - 'chat' 由 core 解释为"打开聊天抽屉"，不入 currentScreen（见 core/types.ts 注释），
 *     故本屏不为此分支 —— 顶栏按钮另发 stratix:chat-open，由组合根打开角色抽屉。
 *   why 用 replace 而非 overlay：sub-screen 自身带 topbar + body + 返回按钮，
 *   若仍渲染主屏 topbar/抽屉会出现双 topbar 与抽屉占视野；直接换内容区更稳。
 */

import type { WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
// 当日回放（@since v3.3，task_082）：底栏时间轴 scrubber（组件 + 控制器口径）。
import { mountDayReplay } from '../components/replay/day-replay';
import type { ReplayController } from '../components/replay/replay-controller';
import { mountAgentPanel, type AgentPanelDeps } from '../panels/agent-panel';
import { mountCommandPanel } from '../panels/command-panel';
import { mountLogDrawer } from '../panels/log-drawer';
import {
  mountSessionPanel,
  SESSION_PANEL_TAG,
  type StratSessionPanelElement,
} from '../panels/session-panel';
import type { SessionHistoryPort } from '../panels/session-catalog';
import type { TaskStatsProvider } from '../panels/task-assign-catalog';
import type { PipelineFeedInput } from '../panels/pipeline-catalog';
// 声音包（@since v3.3，task_083）：顶栏的总开关 + 音量滑条 —— 读写 localStorage
//   （真源在 hud/sound-engine.ts，引擎每次播放现读，这里只做读写与回显）。
import {
  readSoundEnabled,
  readSoundVolume,
  writeSoundEnabled,
  writeSoundVolume,
} from '../sound-engine';
import { demoMode } from '../theme/demo-mode';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import { mountCharacterScreen } from './character-screen';
import type { AppearancePreviewPort } from './appearance-preview-port';
import type { GrowthStatsPort } from './growth-catalog';
import { mountSettingsScreen } from './settings-screen';
import type { CustomAgentsPort } from './custom-agents-port';
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
    position: relative;
    width: 100%;
    height: 100%;
    overflow: auto;
    pointer-events: none;
    container-type: size;
    --hud-topbar-h: 48px;
    --hud-bottom-h: min(34cqh, 300px);
    --hud-gap: var(--srf-spacing-md);
    color: var(--srf-text);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-md);
    scrollbar-width: thin;
    scrollbar-color: var(--srf-border-strong) transparent;
  }
  .hud-root::-webkit-scrollbar { width: var(--srf-spacing-sm); height: var(--srf-spacing-sm); }
  .hud-root::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
  .hud-surface {
    --srf-panel: var(--srf-panel-overlay);
    --srf-panel-elevated: var(--srf-panel-elevated-overlay);
    pointer-events: auto;
  }
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
    gap: var(--srf-spacing-md);
    padding: var(--srf-spacing-xs) var(--srf-spacing-md);
    background: var(--srf-panel-overlay);
    border-bottom: var(--srf-border-width) solid var(--srf-border);
    box-shadow: var(--srf-shadow);
    pointer-events: auto;
  }
  .hud-brand { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-bold); letter-spacing: 0.04em; white-space: nowrap; }
  .hud-stats { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--srf-spacing-lg); flex: 1 1 auto; min-width: 0; }
  .hud-stat { display: flex; align-items: baseline; gap: var(--srf-spacing-xs); color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); white-space: nowrap; }
  .hud-stat-value { color: var(--srf-text); font-size: var(--srf-font-size-md); font-weight: var(--srf-font-weight-semibold); font-variant-numeric: tabular-nums; }
  .hud-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--srf-spacing-sm); }
  .hud-notice-badge {
    min-width: 18px;
    height: 18px;
    padding: 0 var(--srf-spacing-xs);
    box-sizing: border-box;
    border-radius: var(--srf-radius-pill);
    background: var(--srf-danger);
    color: var(--srf-bg);
    font-size: var(--srf-font-size-xs);
    font-weight: var(--srf-font-weight-semibold);
    line-height: 18px;
    text-align: center;
  }
  .hud-notice-badge[hidden] { display: none; }
  .hud-theme-tag { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); white-space: nowrap; }
  /* 音量滑条（@since v3.3，task_083）：顶栏里的声音包音量（0-100）—— 直播时一眼能调。 */
  .hud-volume {
    width: 84px;
    accent-color: var(--srf-accent);
    cursor: pointer;
  }
  .hud-volume:disabled { opacity: 0.4; cursor: not-allowed; }
  .hud-rail-left {
    position: absolute;
    left: var(--hud-gap);
    top: calc(var(--hud-topbar-h) + var(--hud-gap));
    bottom: calc(var(--hud-bottom-h) + var(--hud-gap));
    width: min(320px, 28vw);
    z-index: 20;
    overflow: auto;
  }
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
  .hud-session-slot { flex: 0 0 auto; max-height: 45%; overflow: auto; }
  .hud-bottom-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: var(--hud-bottom-h);
    z-index: 25;
    box-sizing: border-box;
    display: flex;
    /* 回放条（task_082）在上、命令面板在下：底栏改成竖排（列方向 flex）。
       why 挤进底栏而不是另开浮层：命令面板已经占了底部中央，回放条得贴着它才像"同一条时间轴"。 */
    flex-direction: column;
    align-items: center;
    justify-content: flex-end;
    gap: var(--srf-spacing-xs);
    padding: 0 var(--hud-gap) var(--hud-gap);
  }
  .hud-bottom-bar > .hud-surface { width: min(1100px, 100%); flex: 1 1 auto; min-height: 0; overflow: auto; }
  /* 回放条槽位（task_082）：自己接指针事件（底栏其余部分让位给画布）。 */
  .hud-replay-slot {
    width: min(1100px, 100%);
    flex: 0 0 auto;
    pointer-events: auto;
    border-radius: var(--srf-radius, 8px);
    background: var(--srf-panel-overlay);
    border: var(--srf-border-width) solid var(--srf-border);
  }
  .hud-bottom-bar strat-command-panel::part(group) {
    grid-auto-flow: column;
    grid-auto-columns: minmax(6.5em, 1fr);
    align-items: start;
  }
  .hud-sub-screen {
    position: absolute;
    inset: 0;
    z-index: 50;
    pointer-events: auto;
    background: var(--srf-bg);
  }
  @container (max-width: 700px) {
    .hud-topbar { position: static; }
    .hud-rail-left,
    .hud-rail-right,
    .hud-bottom-bar {
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

/**
 * 回放条槽位（@since v3.3，task_082）—— 本屏只认「一个控制器」，不认数据源。
 * controller = null → 挂空条（显示「今天还没有任务记录」，不显示假时间轴）。
 */
export interface ReplaySlotOptions {
  readonly controller: ReplayController | null;
}

export interface MainScreenHandle {
  /** 把渲染出口挂到指定 DOM 节点；返回 unmount 闭包。 */
  mount(host: HTMLElement): () => void;
  /** 当前激活主题（只读，方便测试断言）。 */
  readonly currentThemeId: 'default' | 'pixel';
}

/**
 * 主屏可选依赖（@since v3.20，task_041）：形象预览端口 —— 由组合根（main-entry）注入，
 *   供角色屏的形象编辑面板用（与向导屏共享同一实例；缺省不注入，面板降级成提示语）。
 * @since v3.26（task_050）taskStats：派发推荐的历史统计提供口 —— 透传给 agent-panel 的
 *   「交给谁」选择器（表单打开时取一次；缺省不注入 = 无历史中性降级）。
 * @since v3.27（task_051）pipelines：流水线站态实时读数口 —— 透传给 agent-panel 的
 *   流水线卡片（app 层 pipeline-service.feed 同构注入；缺省不注入 = 面板不显示卡片，
 *   表单仍可发起 —— 只是发起后看不到站序读数）。
 */
export interface MainScreenOptions {
  readonly appearance?: AppearancePreviewPort;
  readonly taskStats?: TaskStatsProvider;
  readonly pipelines?: PipelineFeedInput;
  /**
   * 成长看板数据口（@since v3.36，task_061）：角色屏「成长」tab 与全场总览排行的数据源。
   * 缺省 = 引导语降级（非 Electron 场景），不拆屏可用性。
   */
  readonly growth?: GrowthStatsPort | null;
  /**
   * 自定义 agent 注册端口（@since v3.32，task_056）：设置屏的注册管理组（查看 / 移除，
   * 新增入口在向导）。缺省 = 不显示该组（非 Electron 降级）。
   */
  readonly customAgents?: CustomAgentsPort | null;
  /**
   * 会话历史的读取口（@since v3.43，task_095）—— 会话面板「历史抽屉」的两路真 IO
   *   （角色对话历史 / 会话事件流）。缺省 = 历史读取器未附着（面板如实说明，不显示假数据）。
   */
  readonly sessionHistory?: SessionHistoryPort;
  /**
   * 当日回放（@since v3.3，task_082）—— 底栏时间轴 scrubber 的控制器。
   * 控制器在组合根建（它要 app 层的读取口）；缺省 / controller=null → 回放条显示**空态**
   * （「今天还没有任务记录」—— 观众看得见这条时间轴在哪儿，而不是组件凭空消失）。
   */
  readonly replay?: ReplaySlotOptions | null;
}

/** 工厂：构造 main-screen 句柄；接受一个已建好的 bus-adapter（依赖注入）。 */
export function createMainScreen(adapter: HudBusAdapter, options: MainScreenOptions = {}): MainScreenHandle {
  defineStratButton();
  let currentTheme: 'default' | 'pixel' = 'default';

  const renderTo = (host: HTMLElement): () => void => {
    let currentScreen: CurrentScreen = 'main';
    /** 子屏挂载闭包（卸 sub-screen 时调用；null = 当前没挂任何子屏）。 */
    let unmountSubScreen: (() => void) | null = null;
    /** 主屏布局内各组件的挂载闭包（拆解 / 重建主布局时同步生命周期）。 */
    let unmountMain: (() => void) | null = null;
    /** 演示模式订阅的退订闭包（演示开关变化 → 主屏布局重渲）。 */
    let unsubscribeDemo: (() => void) | null = null;
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
      // 声音包开关与音量（@since v3.3，task_083）：状态真源是 localStorage
      //   （hud/sound-engine.ts 每次播放现读）—— 顶栏只做读写与回显，不存第二份真相。
      const soundVolume = readSoundVolume();
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
            <${STRAT_BUTTON_TAG} label="演示" variant="default" data-role="demo"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="🎬 导演" variant="default" data-role="director"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="🔊 声音" variant="default" data-role="sound"></${STRAT_BUTTON_TAG}>
            <input class="hud-volume" type="range" min="0" max="100" step="5"
                   value="${soundVolume}" data-role="sound-volume"
                   aria-label="音效音量" title="音量 ${soundVolume}%">
            <${STRAT_BUTTON_TAG} label="打开聊天" variant="default" data-role="chat"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="会话面板" variant="default" data-role="sessions"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="看角色" variant="default" data-role="character"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="去设置" variant="primary" data-role="settings"></${STRAT_BUTTON_TAG}>
            <span class="hud-theme-tag" data-role="theme-tag">default</span>
            <span class="hud-theme-tag" data-role="demo-tag">off</span>
            <span class="hud-theme-tag" data-role="director-tag">off</span>
          </div>
        </header>
        <div class="hud-rail-left hud-surface" data-role="agent-panel"></div>
        <div class="hud-rail-right">
          <div class="hud-status-slot hud-surface" data-role="status-screen"></div>
          <div class="hud-session-slot hud-surface" data-role="session-panel"></div>
          <div class="hud-drawer-slot hud-surface" data-role="log-drawer" data-engineering="true"></div>
        </div>
        <div class="hud-bottom-bar">
          <div class="hud-replay-slot" data-role="replay"></div>
          <div class="hud-surface" data-role="command-panel"></div>
        </div>
      </div>
    `;

      // 计数元素缓存一次：core 每次状态变更都全量广播，逐帧 querySelector 是纯浪费。
      const unitCounter = host.querySelector('[data-role="unit-count"]');
      const missionCounter = host.querySelector('[data-role="mission-count"]');
      const linkCounter = host.querySelector('[data-role="link-count"]');
      const noticeBadge = host.querySelector<HTMLElement>('[data-role="notice-badge"]');

      const demoTag = host.querySelector('[data-role="demo-tag"]');
      if (demoTag) demoTag.textContent = demoMode.enabled ? 'on' : 'off';
      // 导演开关（@since v3.3，task_081）：按钮与状态标签都读 core 广播的同一份真相
      //   （WorldState.directorEnabled）—— HUD 不自己存一份「导演开着吗」。
      const directorTag = host.querySelector('[data-role="director-tag"]');
      const directorButton = host.querySelector('[data-role="director"]');
      const directorEnabled = adapter.latest?.directorEnabled === true;
      if (directorTag) directorTag.textContent = directorEnabled ? 'on' : 'off';
      if (directorButton) directorButton.setAttribute('variant', directorEnabled ? 'primary' : 'default');

      // 声音包开关与音量（@since v3.3，task_083）：纯本地展示态 —— 不发 HudCommand、
      //   不进总线（与演示模式同一口径：音效不进 WorldState）。真源是 localStorage，
      //   声音引擎每次播放现读 → 这里改完立即生效，不留第二份真相。
      const soundButton = host.querySelector('[data-role="sound"]');
      const volumeInput = host.querySelector<HTMLInputElement>('[data-role="sound-volume"]');
      /** 把当前开关 / 音量状态回显到顶栏（按钮点亮 + 滑条可用性）。 */
      const applySoundState = (): void => {
        const enabled = readSoundEnabled();
        if (soundButton) soundButton.setAttribute('variant', enabled ? 'primary' : 'default');
        if (volumeInput) volumeInput.disabled = !enabled;
      };
      applySoundState();

      const onThemeClick = (): void => {
        const next = currentTheme === 'default' ? 'pixel' : 'default';
        currentTheme = next;
        adapter.dispatch({ type: 'theme.set', themeId: next });
        const tag = host.querySelector('[data-role="theme-tag"]');
        if (tag) tag.textContent = next;
      };
      const onDemoClick = (): void => {
        // 演示模式是纯本地展示态：不发 HudCommand、不进总线（见 demo-mode.ts 文件头）。
        // 状态变化由 demo-mode 的订阅回调统一触发重渲（工程件显隐 + 顶栏标签）。
        demoMode.toggle();
      };
      const onDirectorClick = (): void => {
        // 导演模式（@since v3.3，task_081）：HUD 只发**开关命令**，绝不直接操控 world（铁律）。
        // 当前态取自 core 广播的 WorldState.directorEnabled（core 是唯一真相）：
        //   用户开 → core 写 true → 广播 → 按钮点亮；
        //   用户在战场上手动碰了镜头 → world 发 camera.director=false → core 写回 false
        //   → 广播 → 按钮熄灭（手动优先，导演让位）。
        const enabled = adapter.latest?.directorEnabled === true;
        adapter.dispatch({ type: 'camera.director', enabled: !enabled });
      };
      const onSoundClick = (): void => {
        // 声音包总开关（@since v3.3，task_083）：直写 localStorage（引擎每次播放现读）——
        //   纯本地展示态，不发 HudCommand、不进总线。缺省开（演示模式默认有声）。
        writeSoundEnabled(!readSoundEnabled());
        applySoundState();
      };
      const onVolumeInput = (): void => {
        // 音量滑条（0-100）：即拖即写 —— 引擎下次播放现读，立即生效。
        if (!volumeInput) return;
        const value = Number.parseInt(volumeInput.value, 10);
        if (!Number.isFinite(value)) return;
        writeSoundVolume(value);
        volumeInput.title = `音量 ${value}%`;
      };
      volumeInput?.addEventListener('input', onVolumeInput);
      const onSettingsClick = (): void => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'settings' });
      };
      const onCharacterClick = (): void => {
        adapter.dispatch({ type: 'ui.navigate', screen: 'character' });
      };
      const onChatClick = (): void => {
        // 'chat' 由 core 解释为打开聊天抽屉（见 types.ts ScreenId 注释）；不进 currentScreen。
        adapter.dispatch({ type: 'ui.navigate', screen: 'chat' });
        const state = adapter.latest;
        const selectedUnitId = state?.selection.unitIds.length === 1 ? state.selection.unitIds[0] : null;
        const characterId = state?.units.find((unit) => unit.id === selectedUnitId)?.characterId ?? undefined;
        host.dispatchEvent(new CustomEvent('stratix:chat-open', {
          bubbles: true,
          detail: { characterId },
        }));
      };

      // 会话面板的元素引用（顶栏「会话面板」钮要能展开/收起它 —— 入口常驻可见）。
      let sessionPanelEl: StratSessionPanelElement | null = null;

      const onSessionsClick = (): void => {
        sessionPanelEl?.toggleCollapsed();
      };

      const themeHandler = (e: Event): void => {
        const target = e.target as HTMLElement | null;
        if (target?.closest('[data-role="theme"]')) onThemeClick();
        else if (target?.closest('[data-role="demo"]')) onDemoClick();
        else if (target?.closest('[data-role="director"]')) onDirectorClick();
        else if (target?.closest('[data-role="sound"]')) onSoundClick();
        else if (target?.closest('[data-role="chat"]')) onChatClick();
        else if (target?.closest('[data-role="sessions"]')) onSessionsClick();
        else if (target?.closest('[data-role="character"]')) onCharacterClick();
        else if (target?.closest('[data-role="settings"]')) onSettingsClick();
      };
      host.addEventListener('strat-button-click', themeHandler);

      // 命令面板：唯一命令入口。注入同一个 adapter —— 与顶栏按钮共用一条派发通道，
      // 不给面板另开总线口子。必须在 host.innerHTML 之后挂（容器节点得先存在）。
      const panelHost = host.querySelector<HTMLElement>('[data-role="command-panel"]');
      const unmountPanel = panelHost ? mountCommandPanel(adapter, panelHost) : null;

      // 当日回放条（@since v3.3，task_082）：底栏上沿的时间轴 scrubber。
      // 组件只被控制器驱动（它自己不读数据）；控制器由组合根注入（它才有读取口）。
      const replayHost = host.querySelector<HTMLElement>('[data-role="replay"]');
      const unmountReplay = replayHost
        ? mountDayReplay(replayHost, { controller: options.replay?.controller ?? null })
        : null;

      // Agent 侧栏：选中单位的业务态。与命令面板共用同一个 adapter —— 两条派发通道合成一条；
      // task_050：可选的历史统计提供口一并注入（派发推荐「交给谁」选择器用）；
      // task_051：可选的流水线实时读数口一并注入（发起后的流水线卡片用）。
      const agentHost = host.querySelector<HTMLElement>('[data-role="agent-panel"]');
      const agentDeps: AgentPanelDeps =
        options.taskStats || options.pipelines
          ? {
              dispatch: (command) => adapter.dispatch(command),
              subscribe: (handler) => adapter.subscribe(handler),
              taskStats: options.taskStats,
              pipelines: options.pipelines,
            }
          : adapter;
      const unmountAgentPanel = agentHost ? mountAgentPanel(agentDeps, agentHost) : null;

      // 日志抽屉：纯展示，不发命令 —— 只把同一个 adapter 的 subscribe 能力给它。
      // 演示模式（@since v3.3，task_110）：日志抽屉是工程件（时间戳 / 来源 / 级别四列），
      //   演示时不挂载 —— 既不占画面也不订阅总线（省一份无谓的订阅）。
      const drawerHost = host.querySelector<HTMLElement>('[data-role="log-drawer"]');
      const unmountDrawer = drawerHost && !demoMode.enabled ? mountLogDrawer(adapter, drawerHost) : null;

      // 会话面板（@since v3.43，task_095）：多会话管理的入口 —— 列表 / kind 筛选 / 状态徽标 /
      //   中断钮（发 session.interrupt）+ 历史抽屉。历史读取口可选（缺省 = 面板说"未附着"）。
      const sessionHost = host.querySelector<HTMLElement>('[data-role="session-panel"]');
      const unmountSession = sessionHost
        ? mountSessionPanel(
            {
              adapter,
              ...(options.sessionHistory ? { history: options.sessionHistory } : {}),
            },
            sessionHost
          )
        : null;
      sessionPanelEl = sessionHost?.querySelector(SESSION_PANEL_TAG) as StratSessionPanelElement | null;

      // 态势屏：同为纯展示区块（指标卡 / 系统状态 / 最近事件全由 WorldState 派生），
      // 复用同一个 adapter —— 它唯一的出口是导航 ui.navigate，不发任何业务命令。
      const statusHost = host.querySelector<HTMLElement>('[data-role="status-screen"]');
      const unmountStatus = statusHost ? mountStatusScreen(adapter, statusHost) : null;

      // 演示模式开关 → 主屏布局重渲（工程件显隐 + 顶栏标签同步）。
      // why 重渲而不是局部改：工程件可能出现在任何面板里，重渲一次最不容易漏。
      unsubscribeDemo?.();
      unsubscribeDemo = demoMode.subscribe(() => renderMain());

      const unsubscribe = adapter.subscribe((state) => {
        if (unitCounter) unitCounter.textContent = String(state.units.length);
        if (missionCounter) missionCounter.textContent = String(state.missions.length);
        if (linkCounter) linkCounter.textContent = String(state.links.length);
        if (noticeBadge) {
          const pending = state.notices.length;
          noticeBadge.textContent = String(pending);
          noticeBadge.hidden = pending === 0;
        }
        // 导演开关回显（task_081）：按钮点亮 / 标签 on-off 都跟 core 广播的同一份真相走。
        if (directorTag) directorTag.textContent = state.directorEnabled ? 'on' : 'off';
        if (directorButton) {
          directorButton.setAttribute('variant', state.directorEnabled ? 'primary' : 'default');
        }
      });

      // 工程件过滤（骨架机制）：标了 data-engineering 的节点在演示模式下隐藏。
      // 各面板后续只需给自己的工程件标这个属性即可接入（无需改本屏）。
      demoMode.filterEngineering(host);

      // 主屏布局内所有挂载闭包打包到一个闭包里：renderScreen 拆主屏布局时一次性释放。
      unmountMain = () => {
        unsubscribe();
        unsubscribeDemo?.();
        unsubscribeDemo = null;
        unmountSession?.();
        unmountDrawer?.();
        unmountStatus?.();
        unmountAgentPanel?.();
        unmountPanel?.();
        unmountReplay?.unmount();
        // 音量滑条的 input 监听（task_083）：随本屏布局一起拆（滑条节点本也会被丢弃，
        //   但显式摘掉更符合本文件的卸载纪律）。
        volumeInput?.removeEventListener('input', onVolumeInput);
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
      unmountSubScreen = mountSettingsScreen(adapter, subHost, {
        customAgents: options.customAgents ?? null,
      });
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
      // @since v3.20（task_041）：形象编辑面板的预览端口随屏位注入（没给 = 面板降级，屏照常可用）。
      unmountSubScreen = mountCharacterScreen(adapter, subHost, {
        appearance: options.appearance,
        growth: options.growth,
      });
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
