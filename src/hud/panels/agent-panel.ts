/**
 * 文件职责：Agent 侧栏 Web Component（`<strat-agent-panel>`）—— 合并旧 AgentPanel（英雄列表/状态分组）
 *   与 AgentPowerPanel（能力评估）的**唯一 Agent 侧栏**：展示当前选中单位的业务态
 *   （名称 / 状态 / 任务 / 能力六维 / 成长数值），并把用户操作变成 HudCommand 经注入的 adapter 派发。
 *   视图模型派生与命令构造全在 agent-catalog.ts（纯逻辑），本文件只负责把模型画成 Shadow DOM。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 panels/ 层级；语义提取自 src/components/AgentPanel.vue
 *   与 src/components/AgentPowerPanel.vue（只读参考，未复制任何实现）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力就够）。
 * 输出：Shadow DOM 侧栏；点击 → HudCommand → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、@/stratix-rts、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token
 *      （唯一的内联样式是能力进度条的 width，它是数据不是设计，契约已把数值夹到 0–100）；
 *   4. 在本地维护"当前选中单位"—— 形态（空/单选/编组）一律现算自 WorldState.selection；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订，否则元素反复挂卸会累积订阅（perf 硬约束）。
 *
 * 渲染策略（perf，与 command-panel 同一口径）：core 每次状态变更都全量广播，
 *   侧栏用 agentPanelSignature 判重，签名不变就跳过重渲染；外壳只在挂载时建一次。
 *
 * @since v3.17（task_038）追加：派任务表单 + 队列读数。
 *   - 表单挂在外壳（chrome，建一次），不在 body 里 —— body 随签名重建，textarea 里的半截输入
 *     会被一次无关广播冲掉；表单开合/草稿是面板本地瞬时态（同 chat-drawer 的 draft 口径），
 *     不是业务真相，不进 core。提交 → buildTaskAssignCommand → adapter.dispatch（命令端口）。
 *   - 队列读数（当前任务摘要 40 字 + 排队数）随详情模型渲染，签名已覆盖任务变化。
 */

import { MAX_TASK_PROMPT_LEN, type HudCommand, type WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';

import type { AgentPanelAction, AgentPanelModel, CapabilityBar, UnitDetailModel, UnitRowModel } from './agent-catalog';
import { agentPanelSignature, buildAgentCommand, buildTaskAssignCommand, resolveAgentPanel } from './agent-catalog';

export const AGENT_PANEL_TAG = 'strat-agent-panel';

/** 面板需要的最小能力面：只要"发命令"与"订阅状态"，与 command-panel 同一约定。 */
export type AgentPanelDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratAgentPanelElement extends HTMLElement {
  /** 注入的适配器；在 connected 之前或之后设置都生效。 */
  adapter: AgentPanelDeps | null;
  /** 强制重算重渲染（注入新 state 后可手动调用）。 */
  refresh(): void;
  /** 当前形态（测试断言单选/编组联动用）。 */
  readonly mode: AgentPanelModel['mode'];
  /** 当前渲染出的单位 id：单选=1 个，编组=渲染出的行，空=0。 */
  readonly visibleUnitIds: readonly string[];
  /** 最近一次渲染用的视图模型（派生结果已缓存，读取零成本）。 */
  readonly model: AgentPanelModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
}

/** HTML 文本转义。单位名 / 任务标题含用户输入，必须转义后才进 innerHTML。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/**
 * 工厂：注册 `<strat-agent-panel>`。
 * 幂等（与 defineStratButton / defineCommandPanel 同约定）：重复 register 返回已注册构造器，不抛错。
 */
export function defineAgentPanel(): typeof HTMLElement {
  if (customElements.get(AGENT_PANEL_TAG)) {
    return customElements.get(AGENT_PANEL_TAG) as unknown as typeof HTMLElement;
  }

  class AgentPanel extends HTMLElement implements StratAgentPanelElement {
    private _adapter: AgentPanelDeps | null = null;
    private _state: WorldState | null = null;
    private _model: AgentPanelModel = resolveAgentPanel(null);
    private _lastSignature: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;
    /** 派任务表单的本地瞬时态（task_038）：开着时指向哪个单位/角色；关闭时均为 null。 */
    private _formUnitId: string | null = null;
    private _formCharacterId: string | null = null;

    // —— 属性面 ——
    get adapter(): AgentPanelDeps | null { return this._adapter; }
    set adapter(value: AgentPanelDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get mode(): AgentPanelModel['mode'] { return this._model.mode; }
    get model(): AgentPanelModel { return this._model; }
    get lastState(): WorldState | null { return this._state; }

    get visibleUnitIds(): readonly string[] {
      if (this._model.mode === 'single') return this._model.detail ? [this._model.detail.id] : [];
      if (this._model.mode === 'group') return this._model.rows.map((r) => r.id);
      return [];
    }

    connectedCallback(): void {
      // 幂等：hot-reload / 反复挂卸会重复进入，必须能安全重建。
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已把签名记下，
      // 而那时还没有 shadowRoot、列表根本没画 —— 不清掉这次就会被判重跳过。
      this._lastSignature = null;
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      // 资源必须可清理：不退订的话，反复挂卸会把订阅堆成 O(n)，且元素已不在文档里仍在收广播。
      this.releaseAdapter();
      this._lastSignature = null;
    }

    refresh(): void {
      const signature = agentPanelSignature(this._state);
      if (signature === this._lastSignature) return;
      this._lastSignature = signature;
      this._model = resolveAgentPanel(this._state);
      this.renderBody();
      this.reconcileTaskForm();
    }

    /**
     * 表单与选择集对账（task_038）：表单开着的单位不再是当前单选详情（切了人/进了编组/清空），
     * 或单位换了关联角色 → 表单自动收起。开着且目标没变 → 不碰（打字中不重置草稿）。
     */
    private reconcileTaskForm(): void {
      if (!this._formCharacterId) return;
      const detail = this._model.mode === 'single' ? this._model.detail : null;
      const stillOnTarget =
        detail !== null &&
        detail.id === this._formUnitId &&
        (detail.characterId ?? null) === this._formCharacterId;
      if (!stillOnTarget) this.closeTaskForm();
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

    // —— 命令派发 ——
    /** 行/按钮上的 data-action + data-unit → HudCommand → adapter.dispatch。构造不出来就不发。 */
    private runAction(action: AgentPanelAction, unitId: string): void {
      if (!this._adapter) return;
      const command: HudCommand | null = buildAgentCommand(action, unitId);
      if (!command) return;
      this._adapter.dispatch(command);
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
            gap: var(--srf-spacing-sm, 8px);
            padding: var(--srf-spacing-md, 12px);
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-md, 14px);
            line-height: var(--srf-line-height, 1.4);
          }
          .head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--srf-spacing-sm, 8px); }
          .title { font-size: var(--srf-font-size-lg, 16px); }
          .summary { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .empty { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .detail, .group { display: grid; gap: var(--srf-spacing-sm, 8px); }
          .detail-head { display: flex; align-items: center; gap: var(--srf-spacing-sm, 8px); }
          .unit-name { font-size: var(--srf-font-size-lg, 16px); font-weight: 600; }
          .badge {
            padding: 0 var(--srf-spacing-sm, 8px);
            border-radius: var(--srf-radius, 6px);
            font-size: var(--srf-font-size-sm, 12px);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            color: var(--srf-text-muted, #9aa3b2);
          }
          .badge[data-status="busy"] { color: var(--srf-accent, #6ea8ff); border-color: var(--srf-accent, #6ea8ff); }
          .badge[data-status="error"] { color: var(--srf-danger, #e06c75); border-color: var(--srf-danger, #e06c75); }
          .badge[data-status="offline"] { color: var(--srf-text-disabled, #5a6373); }
          .facts { display: grid; gap: var(--srf-spacing-xs, 4px); margin: 0; }
          .fact { display: grid; grid-template-columns: 4em 1fr; gap: var(--srf-spacing-sm, 8px); }
          .fact dt { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .fact dd { margin: 0; font-size: var(--srf-font-size-sm, 12px); }
          .section-name {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
            letter-spacing: 0.04em;
          }
          .bars { display: grid; gap: var(--srf-spacing-xs, 4px); }
          .bar { display: grid; grid-template-columns: 3em 1fr 2.5em; align-items: center; gap: var(--srf-spacing-sm, 8px); }
          .bar-label, .bar-value { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .bar-value { text-align: right; }
          .bar-track {
            height: var(--srf-spacing-xs, 4px);
            background: var(--srf-panel-elevated, #20262f);
            border-radius: var(--srf-radius, 6px);
            overflow: hidden;
          }
          /* width 是数据（core 算好的维度分，契约已夹到 0–100），不是设计 token，故走内联。 */
          .bar-fill { display: block; height: 100%; background: var(--srf-accent, #6ea8ff); }
          .row {
            display: grid;
            grid-template-columns: 1fr auto auto;
            gap: var(--srf-spacing-xs, 4px);
            align-items: center;
            padding: var(--srf-spacing-xs, 4px);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel-elevated, #20262f);
          }
          .row-main {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-sm, 8px);
            text-align: left;
            background: none;
            border: none;
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          .row-main:hover { color: var(--srf-accent-hover, #8fbaff); }
          .row-meta { color: var(--srf-text-muted, #9aa3b2); }
          button.action {
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel, #181c25);
            color: var(--srf-text, #e6e9ef);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.action:hover { border-color: var(--srf-accent, #6ea8ff); color: var(--srf-accent, #6ea8ff); }
          .actions { display: flex; gap: var(--srf-spacing-sm, 8px); }
          .queue-badge {
            color: var(--srf-warn, #f0c674);
            font-size: var(--srf-font-size-sm, 12px);
            margin-left: var(--srf-spacing-xs, 4px);
          }
          /* 派任务表单（task_038）：挂在外壳里，不随 body 重建 —— 草稿不被广播冲掉 */
          .task-form {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
          }
          .task-form[hidden] { display: none; }
          .task-form-title {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .task-input {
            width: 100%;
            box-sizing: border-box;
            resize: vertical;
            min-height: 3em;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            line-height: var(--srf-line-height, 1.4);
          }
          .task-input:focus { outline: none; border-color: var(--srf-accent, #6ea8ff); }
          .task-form-actions { display: flex; gap: var(--srf-spacing-sm, 8px); justify-content: flex-end; }
        </style>
        <div class="panel" part="panel">
          <div class="head">
            <span class="title">Agent</span>
            <span class="summary" data-role="summary">等待世界状态…</span>
          </div>
          <div class="body" data-role="body"></div>
          <div class="task-form" data-role="task-form" hidden>
            <div class="task-form-title">派任务 · <span data-role="task-form-name"></span></div>
            <textarea
              class="task-input"
              data-role="task-input"
              rows="3"
              maxlength="${MAX_TASK_PROMPT_LEN}"
              placeholder="要它做什么？一段话描述（Ctrl+Enter 派发）"
            ></textarea>
            <div class="task-form-actions">
              <button type="button" class="action" data-action="task-submit">派发</button>
              <button type="button" class="action" data-action="task-cancel">取消</button>
            </div>
          </div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;

        // 行/按钮点击：data-action + data-unit 上的目录坐标 → HudCommand。
        // 表单动作（task-open/submit/cancel）是本地瞬时态，先拦截，不进命令构造。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const host = target?.closest?.('[data-action]') as HTMLElement | null;
          const action = host?.getAttribute('data-action');
          if (!action || !host) return;
          switch (action) {
            case 'task-open':
              this.openTaskForm(host.getAttribute('data-character'));
              return;
            case 'task-submit':
              this.submitTaskForm();
              return;
            case 'task-cancel':
              this.closeTaskForm();
              return;
            default:
              break;
          }
          const unitId = host.getAttribute('data-unit');
          if (!unitId) return;
          this.runAction(action as AgentPanelAction, unitId);
        });

        // Ctrl/Cmd + Enter 在 textarea 里直接派发（表单快捷提交，不占用全局键盘）。Shift+Enter 留给换行。
        const input = root.querySelector('[data-role="task-input"]');
        input?.addEventListener('keydown', (ev: Event) => {
          const key = (ev as KeyboardEvent).key;
          const withModifier = (ev as KeyboardEvent).ctrlKey || (ev as KeyboardEvent).metaKey;
          if (withModifier && key === 'Enter') {
            ev.preventDefault();
            this.submitTaskForm();
          }
        });
      }
    }

    // —— 派任务表单（task_038）：本地瞬时态，开/关/提交三条路径 ——

    private openTaskForm(characterId: string | null): void {
      if (!characterId) return; // 没关联角色的单位没有任务可派（按钮也不会渲染）
      const detail = this._model.mode === 'single' ? this._model.detail : null;
      if (!detail) return;
      this._formUnitId = detail.id;
      this._formCharacterId = characterId;

      const root = this.shadowRoot;
      const form = root?.querySelector('[data-role="task-form"]') as HTMLElement | null;
      const name = root?.querySelector('[data-role="task-form-name"]') as HTMLElement | null;
      const input = root?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      if (!form || !input) return;
      if (name) name.textContent = detail.name;
      input.value = '';
      form.hidden = false;
      input.focus();
    }

    private submitTaskForm(): void {
      const characterId = this._formCharacterId;
      if (!characterId || !this._adapter) return;
      const input = this.shadowRoot?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      const command = buildTaskAssignCommand(characterId, input?.value ?? '');
      if (!command) return; // 空指令不发（表单保持开着，用户接着写）
      this._adapter.dispatch(command);
      this.closeTaskForm();
    }

    private closeTaskForm(): void {
      this._formUnitId = null;
      this._formCharacterId = null;
      const root = this.shadowRoot;
      const form = root?.querySelector('[data-role="task-form"]') as HTMLElement | null;
      const input = root?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      if (form) form.hidden = true;
      if (input) input.value = '';
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="body"]');
      const summary = root?.querySelector('[data-role="summary"]');
      if (!box) return;
      if (summary) summary.textContent = this._model.summary;

      switch (this._model.mode) {
        case 'empty':
          box.innerHTML = `<div class="empty" data-role="empty">在战场上点选单位，这里显示它的业务态</div>`;
          return;
        case 'single':
          box.innerHTML = this._model.detail ? this.renderDetail(this._model.detail) : '';
          return;
        case 'group':
          box.innerHTML = this.renderGroup();
          return;
      }
    }

    private renderDetail(detail: UnitDetailModel): string {
      const growth = detail.growth
        ? `${escapeHtml(detail.growth.name)} · Lv.${detail.growth.level} · EXP ${detail.growth.experience}`
        : '未关联角色';
      const mission = detail.mission
        ? `${escapeHtml(detail.mission.title)} · ${escapeHtml(detail.mission.phaseLabel)}`
        : '无在办任务';
      // 队列读数（task_038）：当前任务摘要（≤40 字）+ 排队数（如 +2）；没在办任务 = 空闲。
      const queue = detail.taskQueue.summary
        ? `${escapeHtml(detail.taskQueue.summary)}${
            detail.taskQueue.waiting > 0
              ? `<span class="queue-badge" data-role="queue-badge">+${detail.taskQueue.waiting}</span>`
              : ''
          }`
        : '空闲';
      // 派任务入口（task_038）：只给关联了角色的单位 —— task.assign 的载荷是 characterId。
      const assignButton = detail.characterId
        ? `<button type="button" class="action" data-action="task-open" data-unit="${escapeHtml(detail.id)}" data-character="${escapeHtml(detail.characterId)}">派任务</button>`
        : '';

      return `
        <div class="detail" data-role="detail" data-unit="${escapeHtml(detail.id)}">
          <div class="detail-head">
            <span class="unit-name" data-role="unit-name">${escapeHtml(detail.name)}</span>
            <span class="badge" data-role="status" data-status="${escapeHtml(detail.statusTone)}">${escapeHtml(detail.statusLabel)}</span>
          </div>
          <dl class="facts">
            <div class="fact"><dt>战力</dt><dd data-role="power">${detail.power}</dd></div>
            <div class="fact"><dt>任务</dt><dd data-role="mission">${mission}</dd></div>
            <div class="fact"><dt>成长</dt><dd data-role="growth">${growth}</dd></div>
            ${detail.characterId ? `<div class="fact"><dt>队列</dt><dd data-role="task-queue">${queue}</dd></div>` : ''}
          </dl>
          ${this.renderCapabilities(detail)}
          <div class="actions">
            <button type="button" class="action" data-action="focus" data-unit="${escapeHtml(detail.id)}">聚焦</button>
            ${assignButton}
            <button type="button" class="action" data-action="remove" data-unit="${escapeHtml(detail.id)}">移出选择</button>
          </div>
        </div>
      `;
    }

    /** 能力区：core 未给 capabilities 时显示「未评估」，绝不用 power 冒充六维。 */
    private renderCapabilities(detail: UnitDetailModel): string {
      if (!detail.capabilities) {
        return `
          <div class="detail">
            <div class="section-name">能力</div>
            <div class="empty" data-role="capabilities">未评估</div>
          </div>
        `;
      }
      const bars = detail.capabilities.bars.map((bar) => this.renderBar(bar)).join('');
      return `
        <div class="caps">
          <div class="section-name">能力 · <span data-role="cap-level">${escapeHtml(detail.capabilities.level)} ${detail.capabilities.overall}</span></div>
          <div class="bars" data-role="capabilities">${bars}</div>
        </div>
      `;
    }

    private renderBar(bar: CapabilityBar): string {
      return `
        <div class="bar" data-cap="${escapeHtml(bar.key)}">
          <span class="bar-label">${escapeHtml(bar.label)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${bar.value}%"></span></span>
          <span class="bar-value">${bar.value}</span>
        </div>
      `;
    }

    private renderGroup(): string {
      const rows = this._model.rows.map((row) => this.renderRow(row)).join('');
      const overflow = this._model.overflow > 0
        ? `<div class="empty" data-role="overflow">还有 ${this._model.overflow} 个已选单位未列出</div>`
        : '';
      return `<div class="group" data-role="group">${rows}${overflow}</div>`;
    }

    private renderRow(row: UnitRowModel): string {
      const mission = row.missionTitle ? ` · ${escapeHtml(row.missionTitle)}` : '';
      return `
        <div class="row" data-unit="${escapeHtml(row.id)}">
          <button type="button" class="row-main" data-action="inspect" data-unit="${escapeHtml(row.id)}" title="查看详情">
            <span class="badge" data-status="${escapeHtml(row.statusTone)}">${escapeHtml(row.statusLabel)}</span>
            <span class="row-name">${escapeHtml(row.name)}</span>
            <span class="row-meta">战力 ${row.power}${mission}</span>
          </button>
          <button type="button" class="action" data-action="focus" data-unit="${escapeHtml(row.id)}">聚焦</button>
          <button type="button" class="action" data-action="remove" data-unit="${escapeHtml(row.id)}">移出编组</button>
        </div>
      `;
    }
  }

  customElements.define(AGENT_PANEL_TAG, AgentPanel);
  return AgentPanel as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库面板的统一装配口径（与 main-screen / command-panel 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 * 选它而不是让调用方自己 createElement，是为了把"注册 + 注入 + 退订"三件事收在一处。
 */
export function mountAgentPanel(deps: AgentPanelDeps, host: HTMLElement): () => void {
  defineAgentPanel();
  const element = document.createElement(AGENT_PANEL_TAG) as StratAgentPanelElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}