/**
 * 文件职责：**「新建角色」入口装配夹具**（@since v3.3，task_228 · CC-03）。
 *
 * ============ 它是什么 ============
 *   把「新建角色」的**四个入口**（战场空态 CTA / 主屏顶栏「＋ 角色」/ 角色中心空态 CTA /
 *   角色中心子屏顶栏「＋ 新建角色」）与**真的** onboarding host 装到一起 ——
 *   接线方式照抄组合根（src/app/main/main-entry.ts）：HUD 派事件 / 回调 → openCharacterWizard
 *   → `reopen({ force: true })`（task_226 起：force 下向导**总是**挂上）。
 *
 * ============ 为什么抽成共用件 ============
 *   两个测试文件要同一套装配：
 *     · src/app/__tests__/character-creation-entry.test.ts（task_226 落地时的入口回归）；
 *     · src/app/__tests__/character-creation-regression-entry.test.ts（task_228 的 V1-V12 矩阵）。
 *   同一套装配抄两遍 ⇒ 两边一漂移，"入口可达"的结论就不可信了 —— 故提取到本文件共用。
 *
 * ============ 替身边界（只有两处，其余全是真的）============
 *   ① 主题控制器：不落皮肤（本夹具只关心入口 → 向导的接线，不关心配色）；
 *   ② core 侧：命令经**真的** core 总线 → **真的** core runtime → **真的** character manager
 *      （建档落库与单位投影都是真链路，不是测试自己改状态）。
 */

import { emitCommand, resetBus } from '../../../core/bus';
import { createCoreRuntime, type CoreRuntime } from '../../../core/runtime';
import { createStore, type CoreStore } from '../../../core/store';
import type { HudCommand, WorldState } from '../../../core/types';
import { createHudBusAdapter } from '../../../hud/bridge/bus-adapter';
import { mountBattlefieldEmpty } from '../../../hud/components/battlefield-empty/battlefield-empty';
import {
  CHARACTER_CREATE_EVENT,
  mountCharacterScreen,
  type StratCharacterScreenElement,
} from '../../../hud/screens/character-screen';
import { createMainScreen } from '../../../hud/screens/main-screen';
import {
  ONBOARDING_SCREEN_TAG,
  type StratOnboardingScreenElement,
} from '../../../hud/screens/onboarding-screen';
import type { ThemeController, ThemeId } from '../../../hud/theme/theme-controller';

import { createOnboardingHost } from '../../main/onboarding-host';

import { clickWidget } from '../../../hud/__tests__/helpers/shadow-widget';

/** 主题控制器桩：不落皮肤（夹具只关心入口 → 向导的接线）。 */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
    subscribe: () => () => undefined,
  };
}

/** 0 角色 + 0 个探到的 agent（= 扫描竞态最坏情况，用户点按钮的那一瞬间可能一条结果都还没到）。 */
export function makeEmptyState(): WorldState {
  return {
    units: [],
    missions: [],
    selection: { unitIds: [], previewUnitIds: [], revision: 0 },
    characters: [],
    notices: [],
    links: [],
    messages: [],
    detectedAgents: [],
  };
}

/** 装配体（测试拿它点入口、看结果）。 */
export interface CreationAssembly {
  readonly hudRoot: HTMLElement;
  readonly overlayHost: HTMLElement;
  /** 真的 core store（断言角色 / 单位落地看它）。 */
  readonly store: CoreStore;
  /** HUD 派出去的命令（留痕，便于断言"HUD 不发 HudCommand"这类口径）。 */
  readonly commands: HudCommand[];
  /** 当前挂着的向导屏（未挂 = null）。 */
  wizard(): HTMLElement | null;
  /** 当前挂着的向导屏（带类型 —— 走流程要用 next() / submit()）。 */
  wizardScreen(): StratOnboardingScreenElement | null;
  /** 角色中心屏（子屏）。 */
  characterScreen(): StratCharacterScreenElement | null;
  /** 「去新建角色」的唯一通路（= 组合根的 openCharacterWizard；⌘K 的宿主动作也走它）。 */
  openWizard(): void;
  /** 入口一：战场空态 CTA「新建角色」。 */
  clickBattlefieldEmptyCta(): void;
  /** 入口二：主屏顶栏「＋ 角色」。 */
  clickMainTopbarCreate(): void;
  /** 入口三：角色中心（子屏）空态 CTA「＋ 新建角色」。 */
  clickCharacterCenterCta(): void;
  /** 入口四：角色中心子屏顶栏常驻「＋ 新建角色」。 */
  clickCharacterCenterTopbar(): void;
  /** 广播一份新状态（core → HUD 的真实广播链）。 */
  pushState(partial: Partial<WorldState>): void;
  unmount(): void;
}

/** 按组合根（main-entry.ts）的口径把四个入口接到**真的** onboarding host 上。 */
export function assembleCreationFlow(initial?: Partial<WorldState>): CreationAssembly {
  const hudRoot = document.createElement('div');
  document.body.appendChild(hudRoot);
  const overlayHost = document.createElement('div');
  document.body.appendChild(overlayHost);

  const commands: HudCommand[] = [];
  const store = createStore({ ...makeEmptyState(), ...(initial ?? {}) });
  // 真的 core runtime：命令经总线 → runtime → character manager（落库 + 单位投影都是真链路）。
  const runtime: CoreRuntime = createCoreRuntime({ store });
  const stopRuntime = runtime.start();

  const adapter = createHudBusAdapter({
    themeController: stubThemeController(),
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => {
      commands.push(command);
      emitCommand(command);
    },
  });
  const unmountAdapter = adapter.mount();

  const onboarding = createOnboardingHost({
    deps: {
      dispatch: (command) => adapter.dispatch(command),
      subscribe: (handler) => adapter.subscribe(handler),
    },
    host: overlayHost,
  });

  // 「去新建角色」的**唯一**通路（与组合根同一条）。
  const openCharacterWizard = (): void => {
    onboarding.reopen({ force: true });
  };

  // 入口一：战场空态覆盖层（0 单位时亮出「新建角色」）。
  const emptyHandle = mountBattlefieldEmpty(hudRoot, {
    subscribe: (handler) => adapter.subscribe(handler),
    onCreateCharacter: openCharacterWizard,
  });

  // 入口二：主屏顶栏「＋ 角色」（一级入口，注入回调直达向导）。
  const screen = createMainScreen(adapter, { onCreateCharacter: openCharacterWizard });
  const unmountScreen = screen.mount(hudRoot);

  // 入口三 / 四：角色中心（子屏）—— HUD 派 DOM 事件，组合根接线（与战场空态同一装配口径）。
  const characterHost = document.createElement('div');
  hudRoot.appendChild(characterHost);
  const unmountCharacter = mountCharacterScreen(
    {
      dispatch: (command) => adapter.dispatch(command),
      subscribe: (handler) => adapter.subscribe(handler),
    },
    characterHost
  );
  const onCharacterCreate = (): void => {
    openCharacterWizard();
  };
  hudRoot.addEventListener(CHARACTER_CREATE_EVENT, onCharacterCreate);

  // 首帧同步（与 hud 侧夹具同口径：subscribe 不回放首帧）。
  store.patch({});

  const characterScreen = characterHost.querySelector(
    'strat-character-screen'
  ) as StratCharacterScreenElement | null;

  const clickIn = (host: HTMLElement, selector: string): void => {
    const node = host.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`控件未渲染: ${selector}`);
    clickWidget(node);
  };

  return {
    hudRoot,
    overlayHost,
    store,
    commands,
    wizard: () => overlayHost.querySelector(ONBOARDING_SCREEN_TAG),
    wizardScreen: () =>
      overlayHost.querySelector(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement | null,
    openWizard: openCharacterWizard,
    characterScreen: () => characterScreen,
    clickBattlefieldEmptyCta: () => {
      const root = emptyHandle.element.shadowRoot;
      const btn = root?.querySelector<HTMLButtonElement>('[data-role="action-create"]');
      if (!btn) throw new Error('战场空态 CTA 未渲染');
      btn.click();
    },
    clickMainTopbarCreate: () => {
      clickIn(hudRoot, '[data-role="create-character"]');
    },
    clickCharacterCenterCta: () => {
      if (!characterScreen?.shadowRoot) throw new Error('角色中心未挂');
      const btn = characterScreen.shadowRoot.querySelector<HTMLElement>(
        '[data-role="cards-empty"] [data-role="create-character-empty"]'
      );
      if (!btn) throw new Error('角色中心空态 CTA 未渲染');
      clickWidget(btn);
    },
    clickCharacterCenterTopbar: () => {
      if (!characterScreen?.shadowRoot) throw new Error('角色中心未挂');
      const btn = characterScreen.shadowRoot.querySelector<HTMLElement>(
        '.topbar-actions [data-role="create-character"]'
      );
      if (!btn) throw new Error('角色中心顶栏新建钮未渲染');
      clickWidget(btn);
    },
    pushState: (partial) => { store.patch(partial); },
    unmount: () => {
      hudRoot.removeEventListener(CHARACTER_CREATE_EVENT, onCharacterCreate);
      unmountCharacter();
      unmountScreen();
      emptyHandle.unmount();
      onboarding.dispose();
      unmountAdapter();
      stopRuntime();
      // 总线是模块级单例：多个装配体同时活着会互相收到对方的命令 ⇒ 收干净。
      resetBus();
      hudRoot.remove();
      overlayHost.remove();
    },
  };
}
