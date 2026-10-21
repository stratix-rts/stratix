/**
 * 文件职责：角色屏 Web Component（`<strat-character-screen>`）—— 角色（养成）总览屏：
 *   单选单位的角色详情卡 + 编组内单位↔角色关联列表 + 全部角色养成总览卡片。
 *   数值模型来自 core/character/growth（旧 src/stratix-character-creator/core/SharedSkillStore.ts 的
 *   level/experience/addExperience 语义**提炼**为纯函数，本屏只渲染、绝不重算阈值）。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级 + D3「角色提示词保留；技能树砍；数值系统保留」
 *        + §6 Phase 2「character 屏先落 persona 编辑 + level/exp 展示位」。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力，与 screens / panels 同口径）；WorldState 快照。
 * 输出：Shadow DOM 角色面板；交互 → HudCommand（只有 ui.navigate）；经验增长 → 自定义 DOM 事件钩子。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态
 *      （唯一例外是 **import core/character/growth 的纯函数与常量**去渲染进度条阈值：
 *       数值裁决只在 core 一处存在，见 character-catalog 文件头）；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 本地改角色数值 —— 等级/经验只认 core 广播的 WorldState.characters，本屏一改就发命令等回广播；
 *   5. 渲染未经转义的用户数据 —— 角色名与提示词（persona）都是自由文本，一律走 escapeHtml；
 *   6. 泄漏监听器 / 定时器 —— disconnectedCallback 必须退订并清 timer（perf 硬约束）；
 *   7. 自己改 mount 接线 —— 本屏尚未被 main-screen 挂载（见文件末 TODO(v3.task_016)）。
 *
 * 经验增长动画钩子（占位，事件驱动）：
 *   本屏通过**前后两帧快照的经验差**观察到增长（gained > 0）后做两件事：
 *     a) 给该角色的经验条加 .pulse 类（纯 CSS 高亮，EXP_PULSE_MS 后自动摘掉）；
 *     b) 派发冒泡的 DOM 事件 `character-exp-gained`，detail = { characterId, gained, levelUps }。
 *   why 是"钩子"而不是动效本体：像素级增长动画要拿到 canvas / 精灵上下文，
 *   那是 world 层的活；HUD 这一侧先把**事件面**立住（谁涨了多少、升了几级），
 *   等 world 侧动画接入时订阅这个事件即可，不必再改契约。
 *   注意 gained / levelUps 是 HUD 侧观测（相邻两次广播之差），不是 core 的内部计数 ——
 *   真实值以 core/character/manager 的 grantExperience 返回为准。
 *
 * 挂载接线：TODO(v3.task_016) —— 本屏目前只提供 mountCharacterScreen 工厂，
 *   尚未接进 main-screen / hud-dev-entry（由 Phase 3 的入口切换任务统一接线，避免两个任务同时改同一处壳）。
 */

import type { WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { defineStratButton, escapeHtml, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import {
  characterSignature,
  resolveCharacterModel,
  type CharacterCardModel,
  type CharacterLinkModel,
  type CharacterScreenModel,
} from './character-catalog';

export const CHARACTER_SCREEN_TAG = 'strat-character-screen';

/** 经验增长 DOM 事件名（world 侧像素动画将来订阅它）。 */
export const EXP_GAINED_EVENT = 'character-exp-gained';

/** 经验条高亮持续时长（ms）。到期自动摘 .pulse 类，一个定时器即可（perf：同类动画合并）。 */
export const EXP_PULSE_MS = 600;

/** 本屏需要的最小能力面：只要"发命令"与"订阅状态"，与 screens / panels 同一约定。 */
export type CharacterScreenDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 经验增长钩子的载荷。gained / levelUps 为 HUD 侧观测值（见文件头说明）。 */
export interface ExpGainedDetail {
  readonly characterId: string;
  readonly gained: number;
  readonly levelUps: number;
}

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratCharacterScreenElement extends HTMLElement {
  /** 注入的适配器；connected 之前或之后设置都生效。 */
  adapter: CharacterScreenDeps | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 最近一次派生出的视图模型。 */
  readonly model: CharacterScreenModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** 工厂：注册 `<strat-character-screen>`。幂等（与 defineSettingsScreen 同一约定）。 */
export function defineCharacterScreen(): typeof HTMLElement {
  defineStratButton();
  if (customElements.get(CHARACTER_SCREEN_TAG)) {
    return customElements.get(CHARACTER_SCREEN_TAG) as unknown as typeof HTMLElement;
  }

  class CharacterScreen extends HTMLElement implements StratCharacterScreenElement {
    private _adapter: CharacterScreenDeps | null = null;
    private _state: WorldState | null = null;
    private _lastRenderKey: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;
    /** 最近一次各角色的成长观测值（key = characterId）。每次渲染按当前卡片裁剪，长度天然有界。 */
    private _lastGrowth = new Map<string, { readonly experience: number; readonly level: number }>();
    /** 经验条高亮的清理定时器；同一时刻只有一个（重复增长就重新计时）。 */
    private _pulseTimer: ReturnType<typeof setTimeout> | null = null;

    get adapter(): CharacterScreenDeps | null { return this._adapter; }
    set adapter(value: CharacterScreenDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get lastState(): WorldState | null { return this._state; }
    get model(): CharacterScreenModel { return resolveCharacterModel(this._state); }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清键强制首绘：挂载前 adapter setter 那次 refresh 已记过键，而那时还没有内容可画
      this._lastRenderKey = null;
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      this.releaseAdapter();
      this.clearPulseTimer();
      this._lastGrowth.clear();
      this._lastRenderKey = null;
    }

    refresh(): void {
      const key = characterSignature(this._state);
      if (key === this._lastRenderKey) return;
      this._lastRenderKey = key;
      // 经验差值在 renderBody 里就地比对（diffExperience 先算后写观测表），这里只负责重画。
      this.renderBody();
    }

    // —— 订阅生命周期 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._adapter || this._unsubscribe) return;
      this._unsubscribe = this._adapter.subscribe((state) => {
        this._state = state;
        this.refresh();
      });
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // —— 经验增长钩子 ——
    /**
     * 比对本次渲染与上一帧的成长数值，把"涨了"的角色挑出来。
     * 观测表按当前卡片整体重建 —— 已不在屏上的角色（被 core 剔除）随之消失，长度天然有界。
     * 新角色没有上一帧数据 → 不算增长，避免挂载瞬间全体"涨经验"。
     */
    private diffExperience(cards: readonly CharacterCardModel[]): ExpGainedDetail[] {
      const gains: ExpGainedDetail[] = [];
      for (const card of cards) {
        const before = this._lastGrowth.get(card.id);
        if (before && card.growth.experience > before.experience) {
          gains.push({
            characterId: card.id,
            gained: card.growth.experience - before.experience,
            levelUps: card.growth.level - before.level,
          });
        }
      }
      this._lastGrowth = new Map(
        cards.map((card) => [card.id, { experience: card.growth.experience, level: card.growth.level }] as const)
      );
      return gains;
    }

    // —— 交互 → HudCommand ——
    private backToMain(): void {
      this._adapter?.dispatch({ type: 'ui.navigate', screen: 'main' });
    }

    private openChat(): void {
      // 契约语义：ScreenId 里的 'chat' 由 core 解释为"打开聊天抽屉"，不是跳到另一个屏（见 types.ts）。
      this._adapter?.dispatch({ type: 'ui.navigate', screen: 'chat' });
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; display: block; height: 100%; }
          .screen {
            display: grid;
            grid-template-rows: auto 1fr;
            height: 100%;
            min-height: 0;
            background: var(--srf-bg, #0f1116);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-md, 14px);
            line-height: var(--srf-line-height, 1.4);
          }
          .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: var(--srf-spacing-sm, 8px);
            padding: var(--srf-spacing-sm, 8px) var(--srf-spacing-md, 12px);
            background: var(--srf-panel, #181c25);
            border-bottom: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
          }
          .title { font-size: var(--srf-font-size-lg, 16px); }
          .topbar-actions { display: flex; gap: var(--srf-spacing-sm, 8px); }
          .body {
            display: grid;
            gap: var(--srf-spacing-md, 12px);
            align-content: start;
            max-width: 960px;
            width: 100%;
            margin: 0 auto;
            padding: var(--srf-spacing-md, 12px);
            overflow: auto;
          }
          .group {
            display: grid;
            gap: var(--srf-spacing-sm, 8px);
            padding: var(--srf-spacing-md, 12px);
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
          }
          .group-name {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
            letter-spacing: 0.04em;
          }
          .group[data-group="focus"] { border-color: var(--srf-accent, #6ea8ff); }
          .summary { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .cards {
            display: grid;
            gap: var(--srf-spacing-sm, 8px);
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
          }
          .card {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
          }
          .card[data-focused="true"] { border-color: var(--srf-accent, #6ea8ff); }
          .card-name { font-weight: 600; }
          .card-meta {
            display: flex;
            gap: var(--srf-spacing-sm, 8px);
            flex-wrap: wrap;
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .level {
            color: var(--srf-accent, #6ea8ff);
            font-size: var(--srf-font-size-sm, 12px);
            font-weight: 600;
          }
          .bar {
            height: var(--srf-spacing-sm, 8px);
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            overflow: hidden;
          }
          .bar-fill {
            height: 100%;
            background: var(--srf-accent, #6ea8ff);
          }
          .card[data-maxed="true"] .bar-fill { background: var(--srf-success, #6fcf97); }
          /* 经验增长钩子的视觉落点：像素级动画后置（world 层），这里只给一个可测的高亮 */
          .bar[data-pulse="true"] .bar-fill { background: var(--srf-success, #6fcf97); }
          .persona {
            color: var(--srf-text, #e6e9ef);
            font-size: var(--srf-font-size-sm, 12px);
            white-space: pre-wrap;
            overflow-wrap: anywhere;
          }
          .persona:empty { display: none; }
          .links { display: grid; gap: var(--srf-spacing-xs, 4px); }
          .link {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: var(--srf-spacing-sm, 8px);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .link[data-bound="false"] { color: var(--srf-text-muted, #9aa3b2); }
          .link-level { color: var(--srf-accent, #6ea8ff); }
          .empty { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .hint { color: var(--srf-warn, #f0c674); font-size: var(--srf-font-size-sm, 12px); }
        </style>
        <div class="screen" part="screen">
          <div class="topbar">
            <span class="title">角色</span>
            <div class="topbar-actions">
              <${STRAT_BUTTON_TAG} label="打开聊天" variant="default" data-role="chat"></${STRAT_BUTTON_TAG}>
              <${STRAT_BUTTON_TAG} label="返回主屏" variant="primary" data-role="back"></${STRAT_BUTTON_TAG}>
            </div>
          </div>
          <div class="body" data-role="body"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 事件委托绑在外壳上：内容区每次重渲染都重建，绑在内容上会随重渲染反复泄漏（perf 硬约束）。
        root.addEventListener('click', (ev: Event) => this.onClick(ev));
        root.addEventListener('strat-button-click', (ev: Event) => this.onClick(ev));
      }
    }

    /** 一个 click 可能来自顶栏两个按钮；按 data-role 就近解析。 */
    private onClick(ev: Event): void {
      const target = ev.target as HTMLElement | null;
      if (!target?.closest) return;
      if (target.closest('[data-role="back"]')) {
        this.backToMain();
        return;
      }
      if (target.closest('[data-role="chat"]')) this.openChat();
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="body"]');
      if (!root || !box) return;

      const model = this.model;
      const gains = this.diffExperience(model.cards);
      box.innerHTML = this.renderFocus(model) + this.renderLinks(model) + this.renderCards(model);
      this.applyPulse(gains);
    }

    private renderFocus(model: CharacterScreenModel): string {
      if (!model.focus) {
        const why =
          model.mode === 'single'
            ? '该单位未关联角色档案'
            : model.mode === 'group'
              ? '编组下不展开单个角色详情：编组形态看下方关联列表'
              : '未选中单位：选中单个单位即可看它的角色详情';
        return `
          <div class="group" data-group="focus">
            <div class="group-name">角色详情</div>
            <div class="summary">${escapeHtml(model.summary)}</div>
            <div class="empty" data-role="focus-empty">${escapeHtml(why)}</div>
          </div>
        `;
      }
      return `
        <div class="group" data-group="focus">
          <div class="group-name">角色详情</div>
          <div class="summary">${escapeHtml(model.summary)}</div>
          ${this.renderCard(model.focus, true)}
        </div>
      `;
    }

    private renderLinks(model: CharacterScreenModel): string {
      if (model.links.length === 0) {
        return `
          <div class="group" data-group="links">
            <div class="group-name">编组关联</div>
            <div class="empty" data-role="links-empty">未选中任何单位，无关联可看</div>
          </div>
        `;
      }
      const rows = model.links.map((link) => this.renderLink(link)).join('');
      const unbound =
        model.unboundUnits > 0
          ? `<div class="hint" data-role="unbound-hint">编组内有 ${model.unboundUnits} 个单位尚未关联角色</div>`
          : '';
      const overflow =
        model.linkOverflow > 0
          ? `<div class="empty" data-role="link-overflow">还有 ${model.linkOverflow} 个单位未显示</div>`
          : '';
      return `
        <div class="group" data-group="links">
          <div class="group-name">编组关联</div>
          <div class="links">${rows}</div>
          ${unbound}
          ${overflow}
        </div>
      `;
    }

    private renderLink(link: CharacterLinkModel): string {
      const bound = link.characterId !== null;
      const who = bound ? `${escapeHtml(link.characterName ?? '')} · Lv.${link.level ?? 1}` : '未关联角色';
      return `
        <div class="link" data-unit-id="${escapeHtml(link.unitId)}" data-bound="${bound}">
          <span class="link-unit">${escapeHtml(link.unitName)}</span>
          <span class="link-level">${who}</span>
        </div>
      `;
    }

    private renderCards(model: CharacterScreenModel): string {
      const overflow =
        model.cardOverflow > 0
          ? `<div class="empty" data-role="card-overflow">还有 ${model.cardOverflow} 个角色未显示</div>`
          : '';
      const body =
        model.cards.length === 0
          ? `<div class="empty" data-role="cards-empty">尚无角色档案：角色由 core 写入 WorldState.characters 后在此显示</div>`
          : `<div class="cards">${model.cards.map((card) => this.renderCard(card, false)).join('')}</div>`;
      return `
        <div class="group" data-group="cards">
          <div class="group-name">角色养成总览</div>
          ${body}
          ${overflow}
        </div>
      `;
    }

    private renderCard(card: CharacterCardModel, inFocus: boolean): string {
      const growth = card.growth;
      const expText = growth.maxed
        ? `经验 ${growth.experience} · 已满级`
        : `经验 ${growth.experience} · 距下一级 ${growth.toNext ?? 0}`;
      const linked =
        card.linkedUnits.length > 0
          ? `关联单位：${card.linkedUnits.map((name) => escapeHtml(name)).join('、')}`
          : '关联单位：无';
      return `
        <div class="card" data-role="card" data-character-id="${escapeHtml(card.id)}"
             data-focused="${card.focused || inFocus}" data-maxed="${growth.maxed}">
          <span class="card-name">${escapeHtml(card.name)}</span>
          <span class="level">Lv.${growth.level}</span>
          <span class="card-meta"><span data-role="exp">${escapeHtml(expText)}</span><span>${linked}</span></span>
          <div class="bar" data-role="exp-bar" data-pulse="false">
            <div class="bar-fill" style="width: ${growth.percent}%"></div>
          </div>
          <div class="persona" data-role="persona">${escapeHtml(card.persona)}</div>
        </div>
      `;
    }

    /**
     * 派发经验增长钩子：打高亮 + 发 DOM 事件。
     * 定时器只有一个（重复增长重置计时），卸载时清掉（perf：定时器必须可清理）。
     */
    private applyPulse(gains: readonly ExpGainedDetail[]): void {
      if (gains.length === 0) return;
      const root = this.shadowRoot;
      if (!root) return;

      // 按 data-character-id 逐个比对定位卡片（不用 CSS.escape 选择器拼 id：
      // 角色 id 是外部数据，拼进选择器既要转义又容易踩到 jsdom/浏览器的实现差异）。
      const bars = new Map<string, Element>();
      root.querySelectorAll('[data-role="card"]').forEach((card) => {
        const bar = card.querySelector('[data-role="exp-bar"]');
        const id = card.getAttribute('data-character-id');
        if (bar && id !== null) bars.set(id, bar);
      });

      for (const gain of gains) {
        const bar = bars.get(gain.characterId);
        if (bar) bar.setAttribute('data-pulse', 'true');
        this.dispatchEvent(
          new CustomEvent<ExpGainedDetail>(EXP_GAINED_EVENT, {
            bubbles: true,
            composed: true,
            detail: gain,
          })
        );
      }

      this.clearPulseTimer();
      this._pulseTimer = setTimeout(() => {
        root.querySelectorAll('[data-role="exp-bar"]').forEach((bar) => bar.setAttribute('data-pulse', 'false'));
        this._pulseTimer = null;
      }, EXP_PULSE_MS);
    }

    private clearPulseTimer(): void {
      if (this._pulseTimer === null) return;
      clearTimeout(this._pulseTimer);
      this._pulseTimer = null;
    }
  }

  customElements.define(CHARACTER_SCREEN_TAG, CharacterScreen);
  return CharacterScreen as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库屏 / 面板的统一装配口径（与 mountSettingsScreen 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 * TODO(v3.task_016): 由 main-screen / Electron 新入口统一接线挂载。
 */
export function mountCharacterScreen(deps: CharacterScreenDeps, host: HTMLElement): () => void {
  defineCharacterScreen();
  const element = document.createElement(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订 + 清定时器，订阅与计时随之释放。
  return () => { element.remove(); };
}