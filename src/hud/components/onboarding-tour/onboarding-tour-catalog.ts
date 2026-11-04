/**
 * 文件职责：轻引导三步的**词表 + 目标解析**（@since v3.8，task_139）。
 *   与组件（onboarding-tour.ts）分开：组件只管"挖洞 + 气泡"，这里管"指哪、说什么"。
 * 输入：DOM（目标元素解析口 —— 元素不在就退成居中气泡，流程不中断）。
 * 输出：ONBOARDING_TOUR_STEPS（供组合根挂载轻引导）。
 * 禁止事项：① import core / world / app；② 开发者口径文案（人话优先）。
 */

import type { OnboardingTourStep } from './onboarding-tour';

/** 在 shadow 树里找元素（querySelector 不穿 shadow —— 这里手写一遍）。 */
function inShadow(tag: string, selector: string): Element | null {
  const host = document.querySelector(tag);
  return host?.shadowRoot?.querySelector(selector) ?? null;
}

/** 可见性判定：在 DOM 里且盒高 > 0（藏起来的东西不配当 spotlight 目标）。 */
function visible(element: Element | null): Element | null {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? element : null;
}

/** 「新建角色」按钮（战场空态上的那个 —— 0 单位时才有）。 */
function createCharacterButton(): Element | null {
  return visible(inShadow('strat-battlefield-empty', '[data-role="action-create"]'));
}

/**
 * 三步词表：① 点命令行试试 → ② 新建一个角色 → ③ 看战场态势。
 * why 第二步有两个目标：战场空着时「新建角色」按钮就在眼前（直接指它）；
 *   已有单位时那个按钮不在 → 退指顶栏「更多」（「看角色」入口在那里面）——
 *   两个都指不到就退成居中气泡（宁可少个洞，不可指错地方）。
 */
export const ONBOARDING_TOUR_STEPS: readonly OnboardingTourStep[] = [
  {
    id: 'command',
    title: '先试试命令行',
    text: '底部的输入框敲一句，回车就能执行 —— 这是最快看到战场变化的方式。',
    target: () => visible(document.querySelector('[data-role="command-panel"]')),
  },
  {
    id: 'character',
    title: '建一个角色',
    text: () =>
      createCharacterButton()
        ? '角色是战场上干活的单位。点「新建角色」建一个，它会立刻上场。'
        : '角色是战场上干活的单位。顶栏「更多」里选「看角色」，就能建一个。',
    target: () => createCharacterButton() ?? visible(document.querySelector('[data-role="overflow"]')),
  },
  {
    id: 'situation',
    title: '看战场态势',
    text: '右下角的小地图是战场全貌：单位在哪、镜头在哪，一眼看到。',
    target: () => visible(document.querySelector('strat-minimap')),
  },
];
