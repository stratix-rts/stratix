/**
 * 文件职责：任务确认面板 Web Component（`<strat-mission-confirm>`）—— 编组指派后的**待确认队列**，
 *   把 WorldState.missions 画成可点的清单（确认 / 拒绝），点击转成 HudCommand `mission.confirm`。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级 + §5 总线契约；
 *   语义提取自 src/stratix-project/ui/ZoneTaskConfirmPanel.vue（只读参考，未复制任何实现）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力就够）；WorldState 快照。
 * 输出：Shadow DOM 面板；点击 → HudCommand(mission.confirm) → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 在本地判断相位能否确认 —— 可确认与否是 core 的裁决（mission 状态机），
 *      面板只对 phase='pending' 的行渲染按钮；core 若判非法会回一条 Notice，两边不会各说一套；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）。
 *
 * 渲染策略（perf，与 command-panel / agent-panel 同一口径）：core 每次状态变更都全量广播，
 *   面板用 missionConfirmSignature 判重，签名不变就跳过重渲染；外壳只在挂载时建一次。
 *   签名只由「任务相位 + 名单 + 相关单位名」构成：无关单位改名不触发本面板重绘。
 */

import type { ConfirmDecision, MissionPhase, UnitView, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';

export const MISSION_CONFIRM_TAG = 'strat-mission-confirm';

/** 面板需要的最小能力面：只要"发命令"与"订阅状态"，与 command-panel 同一约定。 */
export type MissionConfirmDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 单条任务的行模型。unitNames 已解析成人类可读名字（找不到单位时回落 id，不留空位）。 */
export interface MissionRow {
  readonly id: string;
  readonly title: string;
  readonly phase: MissionPhase;
  /** 参与单位名（顺序同 MissionView.unitIds）。 */
  readonly unitNames: readonly string[];
  /** 指派人数（= unitNames.length，面板按它显示"N 个单位"）。 */
  readonly unitCount: number;
  /** 是否可确认：仅 phase='pending'（待确认）可确认/拒绝，判定权在 core，这里只按契约相位过滤。 */
  readonly decidable: boolean;
}

export interface MissionConfirmModel {
  /** 待确认队列（phase='pending'）：最新的排前面 —— 用户刚发起的那条最可能是他现在要决定的。 */
  readonly pending: readonly MissionRow[];
  /** 在办（confirmed / running），只展示不操作。 */
  readonly active: readonly MissionRow[];
  /** 其余任务（draft / done / cancelled），只读概览。 */
  readonly settled: readonly MissionRow[];
  readonly stats: {
    readonly pending: number;
    readonly active: number;
    readonly done: number;
  };
}

/** 相位的中文标签。词表与 types.ts 的 MissionPhase 一一对应（core 判相位，HUD 只负责念出来）。 */
export const PHASE_LABELS: Readonly<Record<MissionPhase, string>> = {
  draft: '待指派',
  pending: '待确认',
  confirmed: '已接单',
  running: '进行中',
  done: '已完成',
  cancelled: '已取消',
};

/** 名单里最多直接念出的单位名，超出用「等 N 个」收口（面板不做长列表，行高才稳定）。 */
export const MAX_ROW_UNIT_NAMES = 3;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

function unitNameOf(units: readonly UnitView[], id: string): string {
  return units.find((unit) => unit.id === id)?.name ?? id;
}

/**
 * WorldState → 行模型（纯函数，可脱离 DOM 单测）。
 * why 分组而不是按相位列一堆小节：用户在这个面板里只做一个决定 —— 「这条要不要接」，
 * 所以待确认的排在最上面且带按钮，其余（待指派 / 在办 / 已收尾）退成只读概览。
 */
export function resolveMissionConfirm(state: WorldState | null): MissionConfirmModel {
  const units = state?.units ?? [];
  const missions = state?.missions ?? [];

  const rows: MissionRow[] = missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    phase: mission.phase,
    unitNames: mission.unitIds.map((id) => unitNameOf(units, id)),
    unitCount: mission.unitIds.length,
    decidable: mission.phase === 'pending',
  }));

  const pending = rows.filter((row) => row.decidable);
  const active = rows.filter((row) => row.phase === 'confirmed' || row.phase === 'running');
  const activeIds = new Set(active.map((row) => row.id));
  const pendingIds = new Set(pending.map((row) => row.id));

  return {
    pending: pending.slice().reverse(),
    active,
    settled: rows.filter((row) => !pendingIds.has(row.id) && !activeIds.has(row.id)),
    stats: {
      pending: pending.length,
      active: active.length,
      done: rows.filter((row) => row.phase === 'done').length,
    },
  };
}

/**
 * 渲染判重签名（O(任务 + 名单单位)，纯字符串拼接）。
 * 只包含影响本面板显示的东西：任务 id/相位/名单 + 这些单位的**显示名**。
 * 名单之外的单位改名不重绘（避免全局单位列表变动把本面板一起刷一遍）。
 */
export function missionConfirmSignature(state: WorldState | null): string {
  if (!state) return '';
  const names = new Map(state.units.map((unit) => [unit.id, unit.name]));
  return state.missions
    .map((mission) => `${mission.id}:${mission.phase}:${mission.unitIds.join(',')}`)
    .concat(
      Array.from(
        new Set(
          state.missions.flatMap((mission) =>
            mission.unitIds.map((id) => `${id}=${names.get(id) ?? id}`),
          ),
        ),
      ),
    )
    .join('|');
}

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratMissionConfirmElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: MissionConfirmDeps | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 当前渲染出的待确认任务 id（按渲染顺序，最近的在前）。 */
  readonly pendingMissionIds: readonly string[];
  /** 最近一次派生出的视图模型。 */
  readonly model: MissionConfirmModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** 工厂：注册 `<strat-mission-confirm>`。幂等（与 defineCommandPanel 同一约定）。 */
export function defineMissionConfirm(): typeof HTMLElement {
  if (customElements.get(MISSION_CONFIRM_TAG)) {
    return customElements.get(MISSION_CONFIRM_TAG) as unknown as typeof HTMLElement;
  }

  class MissionConfirm extends HTMLElement implements StratMissionConfirmElement {
    private _adapter: MissionConfirmDeps | null = null;
    private _state: WorldState | null = null;
    private _model: MissionConfirmModel = {
      pending: [],
      active: [],
      settled: [],
      stats: { pending: 0, active: 0, done: 0 },
    };
    private _lastSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    get adapter(): MissionConfirmDeps | null { return this._adapter; }
    set adapter(value: MissionConfirmDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get model(): MissionConfirmModel { return this._model; }
    get lastState(): WorldState | null { return this._state; }
    get pendingMissionIds(): readonly string[] { return this._model.pending.map((row) => row.id); }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已记下签名，而那时还没有列表可画
      this._lastSignature = null;
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      this.releaseAdapter();
      this._lastSignature = null;
    }

    refresh(): void {
      const signature = missionConfirmSignature(this._state);
      if (signature === this._lastSignature) return;
      this._lastSignature = signature;
      this._model = resolveMissionConfirm(this._state);
      this.renderRows();
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

    /**
     * 确认 / 拒绝 → HudCommand(mission.confirm)。
     * 一次点击只发一条命令，面板不改任何本地状态：行还在不在、变成什么相位，全等 core 回广播
     * （本地乐观更新会让"点了没反应"变得不可排查，而 core 判非法时还会回 Notice）。
     */
    private decide(missionId: string, decision: ConfirmDecision): void {
      if (!this._adapter) return;
      this._adapter.dispatch({ type: 'mission.confirm', missionId, decision });
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>
          :host { all: initial; }
          .panel {
            display: grid;
            gap: var(--srf-spacing-md);
            padding: var(--srf-spacing-md);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            color: var(--srf-text);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-md);
            line-height: var(--srf-line-height);
          }
          .head, .row-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--srf-spacing-sm); }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .stats { display: flex; gap: var(--srf-spacing-sm); color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .list, .group { display: grid; gap: var(--srf-spacing-sm); }
          .group-name { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); font-weight: var(--srf-font-weight-semibold); letter-spacing: 0.04em; }
          .row {
            display: grid;
            gap: var(--srf-spacing-xs);
            padding: var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
          }
          .row[data-phase="pending"] { border-left: var(--srf-spacing-xxs) solid var(--srf-warn); }
          .row-title { font-weight: var(--srf-font-weight-semibold); }
          .phase {
            padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius-pill);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-xs);
            white-space: nowrap;
          }
          .phase[data-phase="pending"] { color: var(--srf-warn); border-color: var(--srf-warn); }
          .phase[data-phase="running"], .phase[data-phase="confirmed"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          .phase[data-phase="done"] { color: var(--srf-success); border-color: var(--srf-success); }
          .phase[data-phase="cancelled"] { color: var(--srf-danger); border-color: var(--srf-danger); }
          .units { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
          .actions { display: flex; gap: var(--srf-spacing-sm); margin-top: var(--srf-spacing-xs); }
          button.decision {
            padding: var(--srf-spacing-xs) var(--srf-spacing-md);
            background: transparent;
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            cursor: pointer;
            transition: color var(--srf-transition), background var(--srf-transition), border-color var(--srf-transition);
          }
          button.decision:hover { background: var(--srf-panel); border-color: var(--srf-accent); }
          button.decision:active { background: var(--srf-panel-elevated); }
          button.decision:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.decision[data-decision="accept"] { color: var(--srf-success); border-color: var(--srf-success); }
          button.decision[data-decision="reject"] { color: var(--srf-danger); border-color: var(--srf-danger); }
          .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); padding: var(--srf-spacing-lg); text-align: center; border: var(--srf-border-width) dashed var(--srf-border); border-radius: var(--srf-radius); }
        </style>
        <div class="panel" part="panel">
          <div class="head">
            <span class="title">任务确认</span>
            <span class="stats" data-role="stats"></span>
          </div>
          <div class="list" data-role="rows"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 事件委托绑在外壳上：行是重建的，绑在每行上会随重渲染反复泄漏（perf 硬约束）
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const button = target?.closest?.('button[data-mission][data-decision]') as HTMLElement | null;
          const missionId = button?.getAttribute('data-mission');
          const decision = button?.getAttribute('data-decision');
          if (!missionId || (decision !== 'accept' && decision !== 'reject')) return;
          this.decide(missionId, decision);
        });
      }
    }

    private renderRows(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="rows"]');
      if (!root || !box) return;

      const stats = root.querySelector('[data-role="stats"]');
      if (stats) {
        stats.textContent = `待确认 ${this._model.stats.pending} · 在办 ${this._model.stats.active} · 已完成 ${this._model.stats.done}`;
      }

      // 在办 + 已收尾的任务一并列出来：确认完还该看得见"活儿真接了"，否则用户无从判断有没有点错。
      const others: MissionRow[] = [...this._model.active, ...this._model.settled];

      if (this._model.pending.length === 0 && others.length === 0) {
        box.innerHTML = `<div class="empty" data-role="empty">暂无任务。在命令面板发起任务后会出现在这里。</div>`;
        return;
      }

      const sections: string[] = [];
      if (this._model.pending.length > 0) {
        sections.push(
          `<div class="group" data-group="pending">
             <div class="group-name">待确认</div>
             ${this._model.pending.map((row) => this.renderRow(row, true)).join('')}
           </div>`,
        );
      }
      if (others.length > 0) {
        sections.push(
          `<div class="group" data-group="history">
             <div class="group-name">其他任务</div>
             ${others.map((row) => this.renderRow(row, false)).join('')}
           </div>`,
        );
      }
      box.innerHTML = sections.join('');
    }

    private renderRow(row: MissionRow, withActions: boolean): string {
      const names = row.unitNames.slice(0, MAX_ROW_UNIT_NAMES).join('、');
      const overflow = row.unitCount > MAX_ROW_UNIT_NAMES ? ` 等 ${row.unitCount} 个单位` : '';
      const units = row.unitCount > 0 ? `${names}${overflow}` : '未指派单位';
      const actions = withActions
        ? `
          <div class="actions">
            <button type="button" class="decision" data-mission="${escapeHtml(row.id)}" data-decision="accept">确认</button>
            <button type="button" class="decision" data-mission="${escapeHtml(row.id)}" data-decision="reject">拒绝</button>
          </div>`
        : '';
      return `
        <div class="row" data-mission-row="${escapeHtml(row.id)}" data-phase="${escapeHtml(row.phase)}">
          <div class="row-head">
            <span class="row-title">${escapeHtml(row.title)}</span>
            <span class="phase" data-phase="${escapeHtml(row.phase)}">${escapeHtml(PHASE_LABELS[row.phase])}</span>
          </div>
          <div class="units">${escapeHtml(units)}</div>
          ${actions}
        </div>
      `;
    }
  }

  customElements.define(MISSION_CONFIRM_TAG, MissionConfirm);
  return MissionConfirm as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 command-panel / agent-panel 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 */
export function mountMissionConfirm(deps: MissionConfirmDeps, host: HTMLElement): () => void {
  defineMissionConfirm();
  const element = document.createElement(MISSION_CONFIRM_TAG) as StratMissionConfirmElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}