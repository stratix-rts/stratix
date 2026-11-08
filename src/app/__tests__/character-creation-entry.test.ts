/**
 * 集成测试：**新建角色三入口 → 建档向导必挂**（@since v3.3，task_226）。
 *
 * 依据：docs/DESIGN-character-creation.md §3.A（入口层无条件挂向导）与 §3.B（角色中心 CTA）。
 * 场景取**最坏情况**：0 角色 + detectedAgents 为空（agent 扫描未完成 / 零结果）。
 *   why 必须是这个场景：CC-B2 的根因就是「入口处一次定生死」—— service 侧检测逐条广播，
 *   用户点按钮的那一瞬间状态里可能一个 agent 都还没有。入口若因此拒绝挂向导，
 *   用户点「新建角色」就毫无反应（更糟：退到 0 角色的角色中心死胡同）。
 *   故口径：**入口只负责把面板挂起来**，能不能建由向导的扫描步自己呈现。
 *
 * 装配与生产同构：真的 onboarding host + 真的三个 HUD 入口
 *   （战场空态 CTA / 主屏顶栏「＋ 角色」/ 角色中心「＋ 新建角色」）。
 *   接线方式照抄组合根（app/main/main-entry.ts）：HUD 派事件 / 回调 → openCharacterWizard → reopen({force:true})。
 *
 * @jest-environment jsdom
 */

import { createStore } from '../../core/store';
import type { HudCommand, WorldState } from '../../core/types';
import { createHudBusAdapter } from '../../hud/bridge/bus-adapter';
import { mountBattlefieldEmpty } from '../../hud/components/battlefield-empty/battlefield-empty';
import { CHARACTER_CREATE_EVENT, mountCharacterScreen } from '../../hud/screens/character-screen';
import { createMainScreen } from '../../hud/screens/main-screen';
import { ONBOARDING_SCREEN_TAG } from '../../hud/screens/onboarding-screen';
import type { ThemeController, ThemeId } from '../../hud/theme/theme-controller';

import { createOnboardingHost } from '../main/onboarding-host';

/** 主题控制器桩：不落皮肤（本测试只关心入口 → 向导的接线）。 */
function stubThemeController(): ThemeController {
  return {
    apply: (_id: ThemeId) => undefined,
    get current(): ThemeId | null { return null; },
    subscribe: () => () => undefined,
  };
}

/** 0 角色 + 0 个探到的 agent（= 扫描竞态最坏情况）。 */
function makeState(): WorldState {
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

/**
 * 点一个 HUD 控件。
 * why 对 `<strat-button>` 要点它影子里的真 `<button>`：strat-button 把 click 拦在自己内部
 *   （stopPropagation）再派 `strat-button-click` —— 直接 host.click() 不会触发那条链，
 *   与真实用户点击（落在内部 button 上）不等价。
 */
function clickWidget(node: HTMLElement): void {
  if (node.tagName.toLowerCase() === 'strat-button') {
    const inner = node.shadowRoot?.querySelector<HTMLButtonElement>('button');
    if (!inner) throw new Error('strat-button 内部按钮未渲染');
    inner.click();
    return;
  }
  node.click();
}

interface Assembly {
  /** 当前挂着的向导屏（未挂 = null）。 */
  wizard(): HTMLElement | null;
  /** 入口一：战场空态 CTA「新建角色」。 */
  clickBattlefieldEmptyCta(): void;
  /** 入口二：主屏顶栏「＋ 角色」。 */
  clickMainTopbarCreate(): void;
  /** 入口三：角色中心（子屏）空态 CTA「＋ 新建角色」。 */
  clickCharacterCenterCta(): void;
  /** 入口四：角色中心子屏顶栏常驻「＋ 新建角色」。 */
  clickCharacterCenterTopbar(): void;
  unmount(): void;
}

/** 按组合根（main-entry.ts）的口径把三个入口接到**真的** onboarding host 上。 */
function assemble(): Assembly {
  const hudRoot = document.createElement('div');
  document.body.appendChild(hudRoot);
  const overlayHost = document.createElement('div');
  document.body.appendChild(overlayHost);

  const commands: HudCommand[] = [];
  const store = createStore(makeState());
  const adapter = createHudBusAdapter({
    themeController: stubThemeController(),
    onState: (handler) => store.subscribe(handler),
    emitCommand: (command) => { commands.push(command); },
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

  const characterScreen = characterHost.querySelector('strat-character-screen') as HTMLElement | null;

  const clickIn = (host: HTMLElement, selector: string): void => {
    const node = host.querySelector<HTMLElement>(selector);
    if (!node) throw new Error(`控件未渲染: ${selector}`);
    clickWidget(node);
  };

  return {
    wizard: () => overlayHost.querySelector(ONBOARDING_SCREEN_TAG),
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
    unmount: () => {
      hudRoot.removeEventListener(CHARACTER_CREATE_EVENT, onCharacterCreate);
      unmountCharacter();
      unmountScreen();
      emptyHandle.unmount();
      onboarding.dispose();
      unmountAdapter();
      hudRoot.remove();
      overlayHost.remove();
    },
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('新建角色入口（task_226）：0 角色 + 0 agent 时向导必挂', () => {
  test('入口一：战场空态 CTA → 向导挂上', () => {
    const a = assemble();
    expect(a.wizard()).toBeNull();

    a.clickBattlefieldEmptyCta();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('入口二：主屏顶栏「＋ 角色」→ 向导挂上', () => {
    const a = assemble();

    a.clickMainTopbarCreate();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('入口三：角色中心空态 CTA → 向导挂上', () => {
    const a = assemble();

    a.clickCharacterCenterCta();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('入口四：角色中心子屏顶栏常驻钮 → 向导挂上', () => {
    const a = assemble();

    a.clickCharacterCenterTopbar();

    expect(a.wizard()).not.toBeNull();
    a.unmount();
  });

  test('连续点多次 → 向导始终在（入口可达，不是一次性的）', () => {
    const a = assemble();

    a.clickBattlefieldEmptyCta();
    expect(a.wizard()).not.toBeNull();
    a.clickMainTopbarCreate();
    expect(a.wizard()).not.toBeNull();
    a.clickCharacterCenterCta();
    expect(a.wizard()).not.toBeNull();

    a.unmount();
  });
});
