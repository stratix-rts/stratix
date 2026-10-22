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

  const close = (): void => {
    if (!unmount) return;
    unmount();
    unmount = null;
  };

  const evaluate = (state: WorldState): void => {
    if (settled || unmount) return;
    const should = shouldStartOnboarding({
      characters: state.characters,
      detectedAgents: state.detectedAgents ?? [],
      force: options.force,
    });
    if (!should) return;

    unmount = mountOnboardingScreen(options.deps, options.host, {
      ...(options.appearance ? { appearance: options.appearance } : {}),
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

  return {
    evaluate,
    get mounted() {
      return unmount !== null;
    },
    get settled() {
      return settled;
    },
    dispose: close,
  };
}
