/**
 * 文件职责：**首启向导覆盖层的挂载管理**（app 层）—— 决定何时挂、挂了怎么收。
 *   来源：.long-run-agent/tasks/task_026.md「main-entry.ts 首启触发逻辑」。
 *   背景：向导屏（hud/screens/onboarding-screen.ts）只负责屏内四步与事件派发，
 *   "什么时候出现、出现到哪儿、什么时候收起"由 app 层（组合根）负责 —— 屏不自己改 mount 接线。
 * 输入：WorldState 快照（经 evaluate 逐次喂入）+ 注入的 HUD 适配器 + 覆盖层宿主 DOM。
 * 输出：覆盖层 DOM（`<strat-onboarding-screen>`）+ 完成 / 跳过回调。
 * 禁止事项：
 *   1. import world —— app 层只经 core/bus 与 hud 交互，战场那边不归它管；
 *   2. 绕过 adapter 直接 emitCommand —— 一律经注入的 adapter（与 HUD 其余部分同口径）；
 *   3. 重复挂载 —— 一次会话最多挂一次（挂过后即"已结束"，不因后续广播再弹）；
 *   4. 泄漏监听器 —— dispose() 必须移除元素（元素移除 → disconnectedCallback → 退订）。
 */

import type { WorldState } from '../../core/types';
import type { AppearancePreviewPort } from '../../hud/screens/appearance-preview-port';
import type { CustomAgentsPort } from '../../hud/screens/custom-agents-port';
import {
  ONBOARDING_COMPLETE_EVENT,
  ONBOARDING_SKIPPED_EVENT,
  mountOnboardingScreen,
  type OnboardingCompleteDetail,
  type OnboardingScreenDeps,
} from '../../hud/screens/onboarding-screen';

import { shouldStartOnboarding } from './onboarding-trigger';

export interface OnboardingHostOptions {
  /** HUD 适配器（发命令 + 订阅状态）。向导屏只用这两个能力。 */
  readonly deps: OnboardingScreenDeps;
  /** 覆盖层宿主（页面里预留的空容器；向导屏以绝对定位覆盖它）。 */
  readonly host: HTMLElement;
  /**
   * 形象预览端口（@since v3.10）：向导第②步的 canvas 预览与部件选择器靠它。
   * 缺省 = 不带形象功能（屏自己跑得起来，只是没有预览）。
   */
  readonly appearance?: AppearancePreviewPort;
  /**
   * 自定义 agent 注册端口（@since v3.32，task_056）：向导扫描步的「+ 添加自定义 agent」
   * 表单靠它。缺省 = 不带注册功能（屏自己跑得起来，扫描步没有那个入口）。
   */
  readonly customAgents?: CustomAgentsPort | null;
  /** 开发期强制开关（STRATIX_ONBOARDING_FORCE=1）。 */
  readonly force?: boolean;
  /** 引导走完（建档完成）时的回调。 */
  readonly onComplete?: (detail: OnboardingCompleteDetail) => void;
  /** 用户跳过引导时的回调。 */
  readonly onSkip?: () => void;
}

export interface OnboardingHost {
  /** 按最新状态评估是否该挂向导（幂等：已挂 / 已结束都不再动作）。 */
  evaluate(state: WorldState): void;
  /**
   * 重新拉起向导（@since v3.8，task_136）—— 用户从别处（战场空态的「新建角色」）主动要建档时用。
   * why 需要它：向导原本只在"首启"这一次性判定里挂（settled 之后永不再弹），
   *   但"新建角色"是**随时可发起**的动作，不该被首启语义锁死。
   *
   * @since v3.10（task_154）：`force: true` = **用户主动要建档**（顶栏「+ 角色」/ 空态 CTA / ⌘K）——
   *   忽略"已有角色"这道首启门槛（建第 2 个角色同样要向导）。
   *
   * @since v3.3（task_226，设计文档 docs/DESIGN-character-creation.md §3.A）：
   *   `force: true` 时**无条件挂向导**（不再要求「探到可建档的 agent」）。
   *   why：入口处一次定生死是**扫描竞态**的温床 —— service 侧检测是逐条广播的，
   *   用户点按钮的那一瞬间 lastState 可能还没收到任何结果（0 结果 / 扫描中）；
   *   「能不能建」的判定挪进向导的扫描步（它本来就有「正在等扫描结果…」与 0 结果空态，
   *   见 onboarding-screen.ts 的 renderScan），入口只负责把面板挂起来。
   */
  reopen(options?: { readonly force?: boolean }): void;
  /** 当前是否挂着向导。 */
  readonly mounted: boolean;
  /** 用户是否已经结束引导（完成或跳过）—— 结束过就不再弹。 */
  readonly settled: boolean;
  /** 收干净：移除覆盖层（元素移除即触发退订）。 */
  dispose(): void;
}

/**
 * 建一个首启向导覆盖层管理器。
 *
 * 生命周期：
 *   evaluate(state) → 该挂就挂（挂载后向导屏自己订阅状态，扫描报告随之刷新）；
 *   完成 / 跳过 → 收起覆盖层并标记 settled（本次会话不再弹）。
 */
export function createOnboardingHost(options: OnboardingHostOptions): OnboardingHost {
  let unmount: (() => void) | null = null;
  let settled = false;
  /** 最近一次见到的状态（reopen 时按它重新判定 —— 不重新读总线，避免多一份真相）。 */
  let lastState: WorldState | null = null;

  const close = (): void => {
    if (!unmount) return;
    unmount();
    unmount = null;
  };

  /**
   * 真正把向导挂上（挂载 + 收完成/跳过事件）。
   * why 抽出来：首启判定（evaluate）与「用户主动要建档」（reopen({force})）两条路共用同一份挂载逻辑 ——
   *   差别只在**要不要挂**，不在怎么挂。
   */
  const mount = (): void => {
    unmount = mountOnboardingScreen(options.deps, options.host, {
      ...(options.appearance ? { appearance: options.appearance } : {}),
      ...(options.customAgents ? { customAgents: options.customAgents } : {}),
    });

    // 完成 / 跳过事件由向导屏派发（冒泡 + composed，故在宿主上收即可）。
    const handleComplete = (event: Event): void => {
      settled = true;
      close();
      options.onComplete?.((event as CustomEvent<OnboardingCompleteDetail>).detail);
    };
    const handleSkip = (): void => {
      settled = true;
      close();
      options.onSkip?.();
    };
    options.host.addEventListener(ONBOARDING_COMPLETE_EVENT, handleComplete);
    options.host.addEventListener(ONBOARDING_SKIPPED_EVENT, handleSkip);

    // 元素被移除时（dispose）也要摘掉监听器 —— 宿主容器可能比向导屏活得久。
    const previousUnmount = unmount;
    unmount = () => {
      options.host.removeEventListener(ONBOARDING_COMPLETE_EVENT, handleComplete);
      options.host.removeEventListener(ONBOARDING_SKIPPED_EVENT, handleSkip);
      previousUnmount();
    };
  };

  const evaluate = (state: WorldState): void => {
    lastState = state;
    if (settled || unmount) return;
    const should = shouldStartOnboarding({
      characters: state.characters,
      detectedAgents: state.detectedAgents ?? [],
      force: options.force,
    });
    if (!should) return;
    mount();
  };

  return {
    evaluate,
    /**
     * 重新拉起向导（task_136）：清 settled → 按最近状态重判。
     *
     * @since v3.10（task_154）：`force: true`（用户主动要建档）时忽略"已有角色"这道首启门槛。
     *
     * @since v3.3（task_226，设计文档 §3.A）：`force: true` 时**无条件挂** ——
     *   不再要求「探到 ≥1 个可建档的 agent」。why：入口一次定生死 = 扫描竞态温床
     *   （检测逐条广播，点按钮瞬间可能还没结果）；扫描中 / 0 结果由向导的扫描步自己呈现。
     *   非 force 路径（首启判定）行为不变：仍走 evaluate(lastState) 逐条判定。
     */
    reopen: (options) => {
      close();
      settled = false;
      if (options?.force === true) {
        // 主动建档：向导**总是**挂上（哪怕已经有角色、哪怕一个 agent 都还没探到）。
        mount();
        return;
      }
      if (!lastState) return;
      evaluate(lastState);
    },
    get mounted() {
      return unmount !== null;
    },
    get settled() {
      return settled;
    },
    dispose: close,
  };
}
