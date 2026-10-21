/**
 * 文件职责：HelloLoop 联调页的 **HUD 侧操作面板** —— 用真实的 strat-button 组件 + 真实的
 *   hud bus-adapter 把「点按钮 → 发 HudCommand(unit.select)」这条链走通，并把回读到的
 *   WorldState 选择集实时显示出来（人眼可验的闭环证据）。
 *   本文件刻意做成独立模块而不是塞进 dev-entry：dev-entry 要 import phaser 与 css，jest 跑不动；
 *   面板本身零依赖（只用 hud 层已有的公开出口），集成测试才能对**同一份实现**断言，而不是另写一份假的。
 *   方案来源：docs/REFACTOR_PLAN_V3.md §6 Phase 1「联调验收：hello loop」。
 * 输入：挂载容器（mount 时传入）、HudBusAdapter（发命令的唯一入口）、可选的初始单位清单（只用于排按钮）。
 * 输出：面板 DOM；按钮点击经 adapter.dispatch 变成 HudCommand；state 回读刷新数据行。
 * 禁止事项：
 *   1. import world / phaser —— 面板属于 HUD 侧，铁律：hud ↔ world 互不引用；
 *   2. 直接 import core/bus 的 emitCommand —— HUD 一律经注入的 adapter 发命令；
 *   3. 在本地维护选择集 —— 面板只**显示** WorldState，判断权在 core 状态机；
 *   4. 写死颜色 / 字体 —— 视觉一律引用 --srf-* token（与 hud/theme 的换肤体系一致）。
 */

import type { HudCommand, UnitView, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../../hud/bridge/bus-adapter';
import { defineStratButton, STRAT_BUTTON_TAG } from '../../hud/widgets/strat-button';

/** 面板注入的最小能力：只要"发命令"与"订阅状态"两件事，其余一律由 adapter 兜住。 */
export type HelloLoopPanelDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

export interface HelloLoopPanelHandle {
  /** 挂到指定容器；返回 unmount 闭包（解绑监听 + 清空 DOM）。 */
  mount(host: HTMLElement): () => void;
  /** 最近一次收到的选择集（供测试断言面板读到的是真状态）。 */
  readonly lastSelection: readonly string[];
}

export interface HelloLoopPanelOptions {
  /** 只影响按钮排布：告诉面板有哪些单位可选，不产生任何状态（状态真相仍来自 WorldState）。 */
  readonly units?: readonly UnitView[];
}

/** 单元 id → 按钮文案；保持短标签，dev 页一眼能扫完。 */
function labelOf(unit: UnitView): string {
  return `${unit.name}（${unit.id}）`;
}

/** 状态行文案：一行看清 core 广播了什么。 */
function describeState(state: WorldState | null): string {
  if (!state) return 'state: （尚未收到广播）';
  const ids = state.selection.unitIds;
  return [
    `state: 单位 ${state.units.length} · 选择 [${ids.join(', ') || '空'}] · revision ${state.selection.revision}`,
  ].join('\n');
}

export function createHelloLoopPanel(
  deps: HelloLoopPanelDeps,
  options: HelloLoopPanelOptions = {}
): HelloLoopPanelHandle {
  defineStratButton();

  let lastSelection: readonly string[] = [];

  const renderTo = (host: HTMLElement): (() => void) => {
    const units = options.units ?? [];
    host.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          display: grid;
          gap: var(--srf-spacing-sm, 8px);
          padding: var(--srf-spacing-md, 12px);
          background: var(--srf-panel, #181c25);
          border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
          color: var(--srf-text, #e6e9ef);
          font-family: var(--srf-font-ui, sans-serif);
          font-size: var(--srf-font-size-sm, 12px);
        }
        .hint { margin: 0; color: var(--srf-text-muted, #9aa3b2); line-height: var(--srf-line-height, 1.5); }
        .row { display: flex; flex-wrap: wrap; gap: var(--srf-spacing-sm, 8px); align-items: center; }
        .row-title { color: var(--srf-text-muted, #9aa3b2); min-width: 92px; }
        .state { margin: 0; color: var(--srf-accent, #6ea8ff); font-family: var(--srf-font-mono, monospace); white-space: pre; }
      </style>
      <div class="panel" part="panel">
        <p class="hint">
          HUD 按钮 → HudCommand → core 选择状态机 → WorldState → world 场景高亮。
          下面按钮全部是真实的 strat-button，点击经 hud bus-adapter 发出 unit.select。
        </p>
        <div class="row" data-role="row-set">
          <span class="row-title">选中（set）</span>
          ${units.map((u) => `<${STRAT_BUTTON_TAG} label="${labelOf(u)}" variant="primary" data-unit="${u.id}" data-mode="set"></${STRAT_BUTTON_TAG}>`).join('')}
        </div>
        <div class="row" data-role="row-toggle">
          <span class="row-title">切换（toggle）</span>
          ${units.map((u) => `<${STRAT_BUTTON_TAG} label="${labelOf(u)}" data-unit="${u.id}" data-mode="toggle"></${STRAT_BUTTON_TAG}>`).join('')}
        </div>
        <div class="row">
          <span class="row-title">清空</span>
          <${STRAT_BUTTON_TAG} label="清空选择" data-role="clear"></${STRAT_BUTTON_TAG}>
        </div>
        <pre class="state" data-role="state">state: （尚未收到广播）</pre>
      </div>
    `;

    const stateLine = host.querySelector('[data-role="state"]');

    // HUD 交互的唯一出口：DOM 事件 → HudCommand，不直接碰 bus
    const onButtonClick = (event: Event): void => {
      const button = event.target as HTMLElement | null;
      if (!button || button.tagName.toLowerCase() !== STRAT_BUTTON_TAG) return;

      if (button.getAttribute('data-role') === 'clear') {
        deps.dispatch({ type: 'unit.select', unitIds: [], mode: 'set' });
        return;
      }
      const unitId = button.getAttribute('data-unit');
      if (!unitId) return;
      const mode = button.getAttribute('data-mode') === 'toggle' ? 'toggle' : 'set';
      const command: HudCommand = { type: 'unit.select', unitIds: [unitId], mode };
      deps.dispatch(command);
    };

    const unsubscribe = deps.subscribe((state) => {
      lastSelection = state.selection.unitIds;
      if (stateLine) stateLine.textContent = describeState(state);
    });

    host.addEventListener('strat-button-click', onButtonClick);

    return () => {
      host.removeEventListener('strat-button-click', onButtonClick);
      unsubscribe();
      host.innerHTML = '';
      lastSelection = [];
    };
  };

  return {
    mount: renderTo,
    get lastSelection() { return lastSelection; },
  };
}