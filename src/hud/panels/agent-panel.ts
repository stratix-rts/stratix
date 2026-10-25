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
 * @since v3.23（task_047）队列区升级完整列表：读数行下渲染该角色全部在办 + 最近终态任务，
 *   每条带状态徽标；**取消按钮仅 queued**（running 不强杀 —— 点不到就是提示），**重派按钮
 *   仅 failed**（buildTaskAssignCommand 同 prompt 派新任务，不复用旧 id）。列表随签名重建，
 *   与 body 同一生命周期（无输入态，重画无丢失）。
 * @since v3.26（task_050）派发表单增「交给谁」选择器：缺省「自动（推荐）」+ 全体已绑定角色的
 *   候选人卡片（kind 徽标 / 忙闲实时 / 推荐角标在第一位）；推荐排序与理由短语来自
 *   task-assign-catalog 纯函数（历史成功率快照经 deps.taskStats 注入，打开时刷新一次，
 *   不做实时订阅）；目标在忙时表单提示排队预计（队列长度 × 历史均值，无历史「未知」）。
 *   承接人卡片的重画走自己的判重签名（覆盖全体角色的忙闲，比面板签名宽 —— 面板签名只看
 *   选中单位，别的角色排队变化也该实时反映在卡片上）。提交时手动选择 > 自动推荐解析 >
 *   表单角色（038 行为兜底），指定承接人经 targetCharacterId 落 core 校验直达目标队列。
 */

import { MAX_TASK_PROMPT_LEN, type AgentKind, type CharacterView, type HudCommand, type WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';

import type {
  AgentPanelAction,
  AgentPanelModel,
  CapabilityBar,
  TaskApprovalModel,
  TaskQueueItemModel,
  UnitDetailModel,
  UnitRowModel,
} from './agent-catalog';
import {
  agentPanelSignature,
  buildAgentCommand,
  buildTaskApproveCommand,
  buildTaskAssignCommand,
  buildTaskCancelCommand,
  buildTaskRejectCommand,
  resolveAgentPanel,
} from './agent-catalog';
import {
  buildQueueEstimateHint,
  recommendAssignees,
  resolveAutoTarget,
  type AssigneeModel,
  type CharacterTaskStatInput,
  type TaskStatsProvider,
} from './task-assign-catalog';
// 流水线模式（task_051）：目录纯函数 + 实时 feed 注入口。hud 不 import world/app ——
// 站态读数只经 deps.pipelines 注入面（架构注见 pipeline-catalog 文件头）。
import {
  buildPipelineCard,
  buildPipelineStartCommand,
  CUSTOM_PIPELINE_STATIONS,
  PIPELINE_PRESETS,
  type PipelineCardModel,
  type PipelineFeedInput,
  type PipelineFormInput,
} from './pipeline-catalog';
import { agentKindLabel } from '../screens/onboarding-catalog';

export const AGENT_PANEL_TAG = 'strat-agent-panel';

/** 面板需要的最小能力面：只要"发命令"与"订阅状态"，与 command-panel 同一约定。
 * @since v3.26（task_050）可选 taskStats：历史成功率快照提供口（派发推荐用，表单打开时取一次）。
 * @since v3.27（task_051）可选 pipelines：流水线站态实时读数口（发起后的卡片渲染用；
 *   app 层 pipeline-service.feed 与之同构注入，站态不进 WorldState —— 见 pipeline-catalog）。 */
export type AgentPanelDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'> & {
  readonly taskStats?: TaskStatsProvider;
  readonly pipelines?: PipelineFeedInput;
};

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
    /** 「交给谁」选择（task_050）：null = 自动（推荐，缺省）；否则为选中的承接人角色 id。 */
    private _formTarget: string | null = null;
    /** 历史任务统计快照（task_050，app 层缓存）：表单打开时刷新一次；null = 无（中性降级）。 */
    private _taskStats: readonly CharacterTaskStatInput[] | null = null;
    /** 统计刷新去重（打开期间上一次还没回来就不叠加请求）。 */
    private _statsRefreshing = false;
    /** 承接人列表的判重签名（表单开着时每次广播都会走更新口，签名不变不重建卡片）。 */
    private _lastAssigneeSignature: string | null = null;
    /** 表单模式（task_051）：single = 单任务（缺省）；pipeline = 流水线（预设/自定义两站）。 */
    private _formMode: 'single' | 'pipeline' = 'single';
    /** 流水线预设选择（task_051）：预设 id；'custom' = 自定义两站；null = 还没选。 */
    private _formPresetId: string | null = null;
    /** 流水线实时 feed 退订器（task_051，与 _unsubscribe 同生命周期，挂卸不堆订阅）。 */
    private _pipelineUnsub: (() => void) | null = null;
    /** 最近一次渲染的流水线卡片模型（task_051；空数组 = 无线，容器隐藏）。 */
    private _pipelineCards: readonly PipelineCardModel[] = [];

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
      // 承接人列表（task_050）：签名比面板宽（覆盖全体角色的忙闲，面板签名只看选中单位）——
      // 表单开着时先走自己的判重更新，再进面板签名闸，否则「别的角色排队变化」这类广播会被
      // 面板签名拦下、卡片忙闲读数停在前一帧（违反「忙闲实时」）。
      if (this._formCharacterId) this.updateAssignees();
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
      // 流水线实时 feed（task_051）：与状态订阅同生命周期。站态不进 WorldState（架构注见
      // pipeline-catalog 文件头），卡片的实时更新只走这条注入面；退订在 releaseAdapter 对齐。
      const pipelines = this._adapter.pipelines;
      if (pipelines && !this._pipelineUnsub) {
        this._pipelineUnsub = pipelines.subscribe(() => this.renderPipelines());
        this.renderPipelines();
      }
    }

    private releaseAdapter(): void {
      if (this._pipelineUnsub) {
        this._pipelineUnsub();
        this._pipelineUnsub = null;
      }
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
          /* 队列完整列表（task_047）：读数行下的每条任务（徽标 + 摘要 + 按钮） */
          .task-list {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            margin-top: var(--srf-spacing-xs, 4px);
          }
          .task-item {
            display: grid;
            grid-template-columns: auto 1fr auto;
            gap: var(--srf-spacing-xs, 4px);
            align-items: center;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel-elevated, #20262f);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .task-badge {
            padding: 0 var(--srf-spacing-xs, 4px);
            border-radius: var(--srf-radius, 6px);
            font-size: var(--srf-font-size-sm, 12px);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            color: var(--srf-text-muted, #9aa3b2);
            white-space: nowrap;
          }
          .task-badge[data-task-status="running"] { color: var(--srf-accent, #6ea8ff); border-color: var(--srf-accent, #6ea8ff); }
          .task-badge[data-task-status="awaiting_approval"] { color: var(--srf-warn, #f0c674); border-color: var(--srf-warn, #f0c674); }
          .task-badge[data-task-status="failed"] { color: var(--srf-danger, #e06c75); border-color: var(--srf-danger, #e06c75); }
          .task-badge[data-task-status="cancelled"] { color: var(--srf-text-disabled, #5a6373); }
          .task-summary {
            color: var(--srf-text, #e6e9ef);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }
          .task-item-actions { display: flex; gap: var(--srf-spacing-xs, 4px); }
          /* 审批卡（task_049）：计划全文 + 批准 / 驳回。warn 色边框区分于普通列表 ——
             它在等用户裁决，不是普通任务状态。plan 限高滚动：计划可能很长，卡片不能无限撑开侧栏 */
          .approval-card {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            margin-top: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-sm, 8px);
            border: var(--srf-border-width, 1px) solid var(--srf-warn, #f0c674);
            border-radius: var(--srf-radius, 6px);
            background: var(--srf-panel-elevated, #20262f);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .approval-head {
            color: var(--srf-warn, #f0c674);
            font-weight: 600;
          }
          .approval-summary {
            margin-left: var(--srf-spacing-xs, 4px);
            color: var(--srf-text-muted, #9aa3b2);
            font-weight: 400;
          }
          .approval-plan {
            margin: 0;
            max-height: 220px;
            overflow: auto;
            padding: var(--srf-spacing-xs, 4px);
            background: var(--srf-panel, #181c25);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            line-height: var(--srf-line-height, 1.4);
            white-space: pre-wrap;
            word-break: break-word;
          }
          .approval-actions { display: flex; gap: var(--srf-spacing-sm, 8px); justify-content: flex-end; }
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
          /* 「交给谁」选择器（task_050）：自动卡 + 候选人卡纵列。选中态用 token 边框强调，
             不用底色填充 —— 卡片已有一层 panel-elevated，再叠填充会吞掉层次 */
          .assignee-list {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
          }
          .assignee {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            text-align: left;
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          .assignee:hover { border-color: var(--srf-accent, #6ea8ff); }
          .assignee.selected { border-color: var(--srf-accent, #6ea8ff); }
          .assignee-head {
            display: flex;
            align-items: center;
            gap: var(--srf-spacing-sm, 8px);
          }
          .assignee-name { font-weight: 600; }
          .assignee-kind {
            color: var(--srf-text-muted, #9aa3b2);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            padding: 0 var(--srf-spacing-xs, 4px);
          }
          .assignee-busy { margin-left: auto; }
          .assignee-busy[data-busy="idle"] { color: var(--srf-accent, #6ea8ff); }
          .assignee-busy[data-busy="busy"] { color: var(--srf-warn, #f0c674); }
          .assignee-reco {
            color: var(--srf-accent, #6ea8ff);
            border: var(--srf-border-width, 1px) solid var(--srf-accent, #6ea8ff);
            border-radius: var(--srf-radius, 6px);
            padding: 0 var(--srf-spacing-xs, 4px);
          }
          .assignee-reason {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .queue-hint {
            color: var(--srf-warn, #f0c674);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .queue-hint[hidden] { display: none; }
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
          /* 流水线模式与卡片（task_051） */
          .form-modes { display: flex; gap: var(--srf-spacing-xs, 4px); }
          .mode-toggle {
            flex: 1;
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text-muted, #9aa3b2);
            padding: var(--srf-spacing-xs, 4px) 0;
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          .mode-toggle[data-active="true"] {
            border-color: var(--srf-accent, #6ea8ff);
            color: var(--srf-text, #e6e9ef);
          }
          .pipeline-presets { display: grid; gap: var(--srf-spacing-xs, 4px); }
          .pipeline-presets[hidden], .pipeline-custom[hidden] { display: none; }
          .preset {
            display: grid;
            gap: 2px;
            text-align: left;
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            cursor: pointer;
          }
          .preset:hover { border-color: var(--srf-accent, #6ea8ff); }
          .preset.selected { border-color: var(--srf-accent, #6ea8ff); }
          .preset-label { font-weight: 600; }
          .preset-desc {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .station {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-xs, 4px) 0;
          }
          .station-head {
            color: var(--srf-text-muted, #9aa3b2);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .station-select {
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .station-input {
            width: 100%;
            box-sizing: border-box;
            resize: vertical;
            min-height: 2.5em;
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel, #181c25);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            color: var(--srf-text, #e6e9ef);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            line-height: var(--srf-line-height, 1.4);
          }
          .station-input:focus { outline: none; border-color: var(--srf-accent, #6ea8ff); }
          .pipelines { display: grid; gap: var(--srf-spacing-xs, 4px); padding: var(--srf-spacing-xs, 4px) 0; }
          .pipelines[hidden] { display: none; }
          .pipeline-card {
            display: grid;
            gap: var(--srf-spacing-xs, 4px);
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .pipeline-head { display: flex; align-items: center; gap: var(--srf-spacing-xs, 4px); }
          .pipeline-name { font-weight: 600; }
          .pipeline-status { margin-left: auto; }
          .pipeline-status[data-tone="ok"] { color: var(--srf-ok, #7ed491); }
          .pipeline-status[data-tone="bad"] { color: var(--srf-danger, #e0706e); }
          .pipeline-status[data-tone="active"] { color: var(--srf-accent, #6ea8ff); }
          .pipeline-status[data-tone="pending"], .pipeline-status[data-tone="skip"] { color: var(--srf-text-muted, #9aa3b2); }
          .pipeline-stations { display: flex; flex-direction: column; gap: 2px; }
          .station-row { display: flex; align-items: center; gap: var(--srf-spacing-xs, 4px); }
          .station-index { color: var(--srf-text-muted, #9aa3b2); }
          .station-title { color: var(--srf-text, #e6e9ef); }
          .station-badge { margin-left: auto; }
          .station-badge[data-tone="ok"] { color: var(--srf-ok, #7ed491); }
          .station-badge[data-tone="bad"] { color: var(--srf-danger, #e0706e); }
          .station-badge[data-tone="active"] { color: var(--srf-accent, #6ea8ff); }
          .station-badge[data-tone="pending"], .station-badge[data-tone="skip"] { color: var(--srf-text-muted, #9aa3b2); }
        </style>
        <div class="panel" part="panel">
          <div class="head">
            <span class="title">Agent</span>
            <span class="summary" data-role="summary">等待世界状态…</span>
          </div>
          <div class="body" data-role="body"></div>
          <div class="pipelines" data-role="pipelines" hidden></div>
          <div class="task-form" data-role="task-form" hidden>
            <div class="task-form-title">派任务 · <span data-role="task-form-name"></span></div>
            <!-- 模式切换（task_051）：单任务（038 缺省）↔ 流水线（预设/自定义两站）。
                 两套控件的显示互斥在 setFormMode 里收口，这里只是骨架。 -->
            <div class="form-modes">
              <button type="button" class="mode-toggle" data-action="form-mode-single">单任务</button>
              <button type="button" class="mode-toggle" data-action="form-mode-pipeline">流水线</button>
            </div>
            <div class="assignee-list" data-role="assignee-list"></div>
            <div class="queue-hint" data-role="queue-hint" hidden></div>
            <div class="pipeline-presets" data-role="pipeline-presets" hidden></div>
            <div class="pipeline-custom" data-role="pipeline-custom" hidden></div>
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
        // 队列列表动作（task-queue-cancel / task-reassign，task_047）走命令端口，一并拦截分流。
        root.addEventListener('click', (ev: Event) => {
          const target = ev.target as HTMLElement | null;
          const host = target?.closest?.('[data-action]') as HTMLElement | null;
          const action = host?.getAttribute('data-action');
          if (!action || !host) return;
          switch (action) {
            case 'task-open':
              this.openTaskForm(host.getAttribute('data-character'));
              return;
            case 'task-target': {
              // 手动指定承接人（task_050）：点候选人卡 → 选中态切换 + 排队预计提示跟着换。
              const target = host.getAttribute('data-character');
              if (target && this._formCharacterId) {
                this._formTarget = target;
                this.renderAssignees();
              }
              return;
            }
            case 'task-target-auto':
              // 切回「自动（推荐）」（task_050）：清掉手动选择，提交时按推荐排序解析。
              if (this._formCharacterId) {
                this._formTarget = null;
                this.renderAssignees();
              }
              return;
            case 'task-submit':
              // 提交按模式分流（task_051）：单任务走 038 路径；流水线走预设/自定义构造。
              if (this._formMode === 'pipeline') this.submitPipelineForm();
              else this.submitTaskForm();
              return;
            case 'task-cancel':
              this.closeTaskForm();
              return;
            case 'form-mode-single':
              this.setFormMode('single');
              return;
            case 'form-mode-pipeline':
              this.setFormMode('pipeline');
              return;
            case 'pipeline-preset': {
              // 预设选择（task_051）：选中态切换；'custom' = 自定义两站（另一套控件显形）。
              const presetId = host.getAttribute('data-preset');
              if (presetId) {
                this._formPresetId = presetId;
                this.renderPipelineFormSections();
              }
              return;
            }
            case 'task-queue-cancel': {
              // 排队取消（task_047）：按钮只对 queued 条目渲染；真被拒（相位恰好刚变）时
              // core 发 Notice 提示（running → 「先停止」/ 终态 → 「无需取消」），这里不重复分支。
              const cancelCommand = buildTaskCancelCommand(host.getAttribute('data-task'));
              if (cancelCommand && this._adapter) this._adapter.dispatch(cancelCommand);
              return;
            }
            case 'task-approve': {
              // 计划批准（task_049）：同 session 续执行的驱动在 core → app 事件链，
              // 这里只发命令。相位裁决在状态机（仅 awaiting）；真被拒时 core 发 Notice。
              const approveCommand = buildTaskApproveCommand(host.getAttribute('data-task'));
              if (approveCommand && this._adapter) this._adapter.dispatch(approveCommand);
              return;
            }
            case 'task-reject': {
              // 计划驳回（task_049）：failed(rejected) 收尾，计划留在库里存档。
              const rejectCommand = buildTaskRejectCommand(host.getAttribute('data-task'));
              if (rejectCommand && this._adapter) this._adapter.dispatch(rejectCommand);
              return;
            }
            case 'task-reassign': {
              // 失败重派（task_047）：同 prompt 派一条新任务（复用 buildTaskAssignCommand，
              // 不复用旧 id —— 重派是显式动作的新任务）。prompt 全文从模型取（摘要截断不作载荷）。
              const item = this.findTaskItem(host.getAttribute('data-task'));
              const reassignCommand = item ? buildTaskAssignCommand(this._formCharacterId ?? this.currentDetailCharacterId(), item.prompt) : null;
              if (reassignCommand && this._adapter) this._adapter.dispatch(reassignCommand);
              return;
            }
            case 'context-toggle': {
              // 角色级上下文注入开关（task_053）：按钮态 = 当前广播值，点击取反发命令。
              // 落库 / 广播都在 core（manager.updateContextEnabled），面板等签名回来重画。
              const characterId = host.getAttribute('data-character');
              const enabled = host.getAttribute('data-enabled') === '1';
              if (characterId && this._adapter) {
                this._adapter.dispatch({
                  type: 'character.contextEnabled.update',
                  characterId,
                  enabled: !enabled,
                });
              }
              return;
            }
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
      // 「交给谁」回缺省（自动）：上次表单的手动选择不跨表单存活（每次派发都是新决策）。
      this._formTarget = null;

      const root = this.shadowRoot;
      const form = root?.querySelector('[data-role="task-form"]') as HTMLElement | null;
      const name = root?.querySelector('[data-role="task-form-name"]') as HTMLElement | null;
      const input = root?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      if (!form || !input) return;
      if (name) name.textContent = detail.name;
      input.value = '';
      form.hidden = false;
      // 模式回缺省（task_051）：上次表单的模式/预设选择不跨表单存活（每次派发都是新决策）。
      this.setFormMode('single');
      // 先画列表（同步：拿着上一份统计快照立即有读数），再异步刷新统计（task_050 ⑤：
      // 打开时刷新即可，不做实时订阅 —— 回来后清签名重画一次，成功率/预计随之更新）。
      this.renderAssignees();
      this.refreshTaskStats();
      input.focus();
    }

    private submitTaskForm(): void {
      const characterId = this._formCharacterId;
      if (!characterId || !this._adapter) return;
      const input = this.shadowRoot?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      // 承接人解析（task_050）：手动选择优先；自动 = 推荐排序第一位；两者都拿不到（无状态/
      // 无候选）退回表单角色（038 行为）。提交时重算而非复用上一次渲染的列表 ——
      // 签名闸可能刚拦掉一次广播，用旧排序会派给「上一帧的推荐人」。
      const assignees = recommendAssignees(this._state, this._taskStats);
      const target = this._formTarget ?? resolveAutoTarget(assignees, null) ?? characterId;
      const command = buildTaskAssignCommand(characterId, input?.value ?? '', target);
      if (!command) return; // 空指令不发（表单保持开着，用户接着写）
      this._adapter.dispatch(command);
      this.closeTaskForm();
    }

    private closeTaskForm(): void {
      this._formUnitId = null;
      this._formCharacterId = null;
      this._formTarget = null;
      this._formMode = 'single';
      this._formPresetId = null;
      this._lastAssigneeSignature = null; // 下次开表单强制重画（清掉旧列表与提示）
      const root = this.shadowRoot;
      const form = root?.querySelector('[data-role="task-form"]') as HTMLElement | null;
      const input = root?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      if (form) form.hidden = true;
      if (input) input.value = '';
    }

    // —— 流水线模式（task_051）：模式切换 / 控件显隐 / 提交 ——

    /**
     * 模式切换：单任务（038 的承接人列表）↔ 流水线（预设 + 自定义两站）。控件显隐互斥
     * 收口在这里，两套控件都常驻外壳（不随 body 重建 —— 草稿与选择不被广播冲掉）。
     */
    private setFormMode(mode: 'single' | 'pipeline'): void {
      if (this._formMode === mode && mode === 'single') return;
      this._formMode = mode;
      if (mode === 'single') this._formPresetId = null;
      if (mode === 'pipeline' && !this._formPresetId) this._formPresetId = PIPELINE_PRESETS[0]?.id ?? null;
      // 模式切换时议题语义不变（{{task}} 的源文本），textarea 草稿保留。
      const input = this.shadowRoot?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      if (input) input.placeholder = mode === 'pipeline' ? '流水线议题：一段话描述要解决的问题（{{task}} 的源文本）' : '要它做什么？一段话描述（Ctrl+Enter 派发）';
      this.renderPipelineFormSections();
    }

    /** 流水线控件显隐与内容（预设列表 / 自定义两站 / 单任务侧的承接人列表互斥）。 */
    private renderPipelineFormSections(): void {
      const root = this.shadowRoot;
      const assigneeList = root?.querySelector('[data-role="assignee-list"]') as HTMLElement | null;
      const presets = root?.querySelector('[data-role="pipeline-presets"]') as HTMLElement | null;
      const custom = root?.querySelector('[data-role="pipeline-custom"]') as HTMLElement | null;
      if (!presets || !custom) return;
      const pipelineMode = this._formMode === 'pipeline';
      if (assigneeList) assigneeList.hidden = pipelineMode;
      presets.hidden = !pipelineMode;
      custom.hidden = !(pipelineMode && this._formPresetId === 'custom');
      if (!pipelineMode) return;

      // 预设列表：3 个预设 + 自定义（常量驱动 —— 改 pipeline-catalog 的 PIPELINE_PRESETS 即生效）。
      presets.innerHTML = [
        ...PIPELINE_PRESETS.map(
          (preset) => `<button type="button" class="preset${this._formPresetId === preset.id ? ' selected' : ''}" data-action="pipeline-preset" data-preset="${preset.id}">
            <span class="preset-label">${escapeHtml(preset.label)}</span>
            <span class="preset-desc">${escapeHtml(preset.description)}</span>
          </button>`
        ),
        `<button type="button" class="preset${this._formPresetId === 'custom' ? ' selected' : ''}" data-action="pipeline-preset" data-preset="custom">
          <span class="preset-label">自定义两站</span>
          <span class="preset-desc">自选两个角色，各写一段指令模板</span>
        </button>`,
      ].join('');

      // 自定义两站：角色下拉（在档且有 agentKind 的角色）× 模板 textarea。打开时构建一次：
      // 站位选择不随广播重建（打字中的草稿不能被冲掉）；角色档案极少边角变化，取舍见
      // pipeline-catalog 文件头「不做实时推荐」注。
      if (custom.hidden) return;
      const characters = (this._state?.characters ?? []).filter(
        (character): character is CharacterView & { agentKind: AgentKind } => character.agentKind != null
      );
      const options = characters
        .map((character) => `<option value="${escapeHtml(character.id)}">${escapeHtml(character.name)}（${escapeHtml(agentKindLabel(character.agentKind ?? ''))}）</option>`)
        .join('');
      custom.innerHTML = Array.from({ length: CUSTOM_PIPELINE_STATIONS }, (_, index) => `
        <div class="station">
          <span class="station-head">第 ${index + 1} 站${index > 0 ? '（可用 {{prev_output}} 引上一站全文）' : ''}</span>
          <select class="station-select" data-role="pipeline-station-character" data-station="${index}">
            <option value="">选角色…</option>
            ${options}
          </select>
          <textarea class="station-input" data-role="pipeline-station-template" data-station="${index}" rows="2"
            placeholder="${index > 0 ? '指令模板，如：请校对：\n{{prev_output}}' : '指令模板，如：请实现：\n{{task}}'}"></textarea>
        </div>`).join('');
    }

    /** 流水线提交（task_051）：读表单态 → buildPipelineStartCommand → dispatch。 */
    private submitPipelineForm(): void {
      if (!this._adapter) return;
      const root = this.shadowRoot;
      const input = root?.querySelector('[data-role="task-input"]') as HTMLTextAreaElement | null;
      const stations = Array.from(root?.querySelectorAll('[data-role="pipeline-station-character"]') ?? []);
      const templates = Array.from(root?.querySelectorAll('[data-role="pipeline-station-template"]') ?? []);
      const custom = Array.from({ length: CUSTOM_PIPELINE_STATIONS }, (_, index) => ({
        characterId: (stations[index] as HTMLSelectElement | undefined)?.value || null,
        promptTemplate: (templates[index] as HTMLTextAreaElement | undefined)?.value ?? '',
      }));
      const form: PipelineFormInput = {
        presetId: this._formPresetId,
        custom,
        issue: input?.value ?? '',
      };
      const command = buildPipelineStartCommand(form);
      if (!command) return; // 构造不出来不发（表单保持开着：议题空 / 预设没选 / 自定义缺项）
      this._adapter.dispatch(command);
      this.closeTaskForm();
    }

    /**
     * 流水线卡片渲染（task_051）：feed 通知驱动（不进 refresh 的签名闸 —— 站态不在
     * WorldState 里，状态广播永远看不到它）。空快照隐藏容器；卡片 = 站序 + 相位徽标。
     */
    private renderPipelines(): void {
      const root = this.shadowRoot;
      const host = root?.querySelector('[data-role="pipelines"]') as HTMLElement | null;
      const feed = this._adapter?.pipelines;
      if (!host) return;
      const runs = feed?.snapshot() ?? null;
      if (!runs || runs.length === 0) {
        this._pipelineCards = [];
        host.hidden = true;
        host.innerHTML = '';
        return;
      }
      this._pipelineCards = runs.map((run) => buildPipelineCard(run));
      host.hidden = false;
      host.innerHTML = this._pipelineCards
        .map((card) => `<div class="pipeline-card" data-pipeline="${escapeHtml(card.id)}">
          <div class="pipeline-head">
            <span class="pipeline-name">${escapeHtml(card.name)}</span>
            <span class="pipeline-status" data-tone="${card.statusBadge.tone}">${escapeHtml(card.statusBadge.icon)} ${escapeHtml(card.statusBadge.label)}</span>
          </div>
          <div class="pipeline-stations">
            ${card.steps
              .map(
                (step) => `<div class="station-row">
                  <span class="station-index">${step.index + 1}</span>
                  <span class="station-title">${escapeHtml(step.title)}</span>
                  <span class="station-badge" data-tone="${step.badge.tone}">${escapeHtml(step.badge.icon)} ${escapeHtml(step.badge.label)}</span>
                </div>`
              )
              .join('')}
          </div>
        </div>`)
        .join('');
    }

    // —— 「交给谁」选择器（task_050）：候选人卡片 + 排队预计提示 ——

    /** 广播到达时的更新口（判重）：承接人签名变了才重建卡片，否则零成本直过。 */
    private updateAssignees(): void {
      const signature = this.assigneeSignature();
      if (signature === null || signature === this._lastAssigneeSignature) return;
      this._lastAssigneeSignature = signature;
      this.renderAssignees();
    }

    /** 承接人签名：全体角色的忙闲/档案/单位态（面板签名只看选中单位，这里必须看全体）。 */
    private assigneeSignature(): string | null {
      if (!this._state || !this._formCharacterId) return null;
      const state = this._state;
      return [
        state.characters.map((c) => `${c.id}:${c.name}:${c.agentKind ?? ''}`).join('|'),
        (state.tasks ?? []).map((t) => `${t.characterId}:${t.status}`).join('|'),
        state.units.map((u) => `${u.characterId ?? ''}:${u.status}`).join('|'),
      ].join('#');
    }

    /** 重建候选人卡片与排队提示（不含 textarea —— 那是外壳节点，重建会丢草稿）。 */
    private renderAssignees(): void {
      const root = this.shadowRoot;
      const list = root?.querySelector('[data-role="assignee-list"]') as HTMLElement | null;
      const hint = root?.querySelector('[data-role="queue-hint"]') as HTMLElement | null;
      if (!list || !this._state) return;
      const assignees = recommendAssignees(this._state, this._taskStats);
      list.innerHTML =
        assignees.length === 0
          ? '<div class="assignee-reason">暂无已绑定 agent 的角色，将派给当前角色</div>'
          : this.renderAssigneeCards(assignees);
      // 排队预计：目标（手动选中的 / 自动推荐解析出的）在忙才显示 —— 全忙自动模式必然命中；
      // 手动选中忙人同理（用户该知道这单要排多久）。空闲目标没什么可估，不占空间。
      const targetId = this.effectiveTargetId(assignees);
      const targetModel = assignees.find((candidate) => candidate.characterId === targetId) ?? null;
      const hintText = targetModel ? buildQueueEstimateHint(targetModel, this._taskStats) : null;
      if (hint) {
        hint.hidden = hintText === null;
        hint.textContent = hintText ?? '';
      }
      // 本方法被直接调用的三处（开表单 / 手动选择 / 统计到达）都不经过判重闸：
      // 自己把签名记上，避免下一广播多一次冗余重建。
      this._lastAssigneeSignature = this.assigneeSignature();
    }

    /** 当前生效目标：手动选择 ?? 自动推荐 ?? 表单角色（后两者在卡片渲染与提交解析共用）。 */
    private effectiveTargetId(assignees: readonly AssigneeModel[]): string | null {
      return this._formTarget ?? resolveAutoTarget(assignees, this._formCharacterId);
    }

    private renderAssigneeCards(assignees: readonly AssigneeModel[]): string {
      const auto = assignees[0];
      const autoCard = `<button type="button" class="assignee${this._formTarget === null ? ' selected' : ''}" data-action="task-target-auto">
          <span class="assignee-head">
            <span class="assignee-name">自动（推荐）</span>
          </span>
          <span class="assignee-reason">${auto ? `→ ${escapeHtml(auto.name)}：${escapeHtml(auto.reason)}` : '暂无候选，派给当前角色'}</span>
        </button>`;
      const cards = assignees.map(
        (candidate) => `<button type="button" class="assignee${this._formTarget === candidate.characterId ? ' selected' : ''}" data-action="task-target" data-character="${escapeHtml(candidate.characterId)}">
          <span class="assignee-head">
            ${candidate.recommended ? '<span class="assignee-reco">推荐</span>' : ''}
            <span class="assignee-name">${escapeHtml(candidate.name)}</span>
            <span class="assignee-kind">${escapeHtml(candidate.kindLabel)}</span>
            <span class="assignee-busy" data-busy="${candidate.idle ? 'idle' : 'busy'}">${candidate.idle ? '空闲' : `排队 ${candidate.activeCount}`}</span>
          </span>
          <span class="assignee-reason">${escapeHtml(candidate.reason)}</span>
        </button>`
      );
      return `${autoCard}${cards.join('')}`;
    }

    /** 历史统计刷新（task_050 ⑤）：打开时取一次；去重防叠加；失败静默降级（中性值/未知）。 */
    private refreshTaskStats(): void {
      const provider = this._adapter?.taskStats;
      if (!provider || this._statsRefreshing) return;
      this._statsRefreshing = true;
      void provider()
        .then((stats) => {
          this._taskStats = stats;
          // 统计不在忙闲签名里：清签名强制重画一次（成功率读数 / 排队预计要跟上）。
          this._lastAssigneeSignature = null;
          if (this._formCharacterId) this.updateAssignees();
        })
        .catch(() => {
          // 取不到统计不拦表单：旧快照继续用，没有就中性降级。
        })
        .finally(() => {
          this._statsRefreshing = false;
        });
    }

    // —— 队列列表（task_047）：条目检索与渲染 ——

    /** 当前单选详情关联的角色 id（重派载荷用；非单选 / 无角色为 null）。 */
    private currentDetailCharacterId(): string | null {
      const detail = this._model.mode === 'single' ? this._model.detail : null;
      return detail?.characterId ?? null;
    }

    /** 按任务 id 从最近一次渲染的模型里找列表条目（重派要拿 prompt 全文）。 */
    private findTaskItem(taskId: string | null): TaskQueueItemModel | null {
      if (!taskId) return null;
      const detail = this._model.mode === 'single' ? this._model.detail : null;
      return detail?.taskQueue.items.find((item) => item.id === taskId) ?? null;
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
      // 队列完整列表（task_047）：在办全显 + 最近终态，每条带徽标与动作按钮。只要该角色
      // 有任务就渲染列表 —— queued 条目必须可见（否则取消按钮不可达），读数行只是速览。
      const taskList = detail.characterId && detail.taskQueue.items.length > 0
        ? `<div class="task-list" data-role="task-list">${detail.taskQueue.items
            .map((item) => this.renderTaskItem(item))
            .join('')}</div>`
        : '';
      // 审批卡（task_049）：awaiting_approval 任务才有 —— 计划全文 + 批准 / 驳回。
      // 放在队列列表之前：审批门占着执行位，它就是此刻关于这个角色最重要的一件事。
      const approvalCard = detail.approval ? this.renderTaskApproval(detail.approval) : '';
      // 派任务入口（task_038）：只给关联了角色的单位 —— task.assign 的载荷是 characterId。
      const assignButton = detail.characterId
        ? `<button type="button" class="action" data-action="task-open" data-unit="${escapeHtml(detail.id)}" data-character="${escapeHtml(detail.characterId)}">派任务</button>`
        : '';
      // 上下文注入开关钮（task_053）：只给关联了角色的单位（开关是角色级属性）。
      // 状态随 growth.contextEnabled（广播真相）；点击发 HudCommand，core 写状态 →
      // 签名含 contextEnabled → 重画（本地不存第二份真相，与队列按钮同一纪律）。
      const contextToggle = detail.growth
        ? `<button type="button" class="action" data-action="context-toggle" data-character="${escapeHtml(detail.growth.characterId)}" data-enabled="${detail.growth.contextEnabled ? '1' : '0'}">上下文：${detail.growth.contextEnabled ? '开' : '关'}</button>`
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
          ${approvalCard}
          ${detail.characterId ? taskList : ''}
          ${this.renderCapabilities(detail)}
          <div class="actions">
            <button type="button" class="action" data-action="focus" data-unit="${escapeHtml(detail.id)}">聚焦</button>
            ${assignButton}
            ${contextToggle}
            <button type="button" class="action" data-action="remove" data-unit="${escapeHtml(detail.id)}">移出选择</button>
          </div>
        </div>
      `;
    }

    /** 能力区：core 未给 capabilities 时显示「未评估」，绝不用 power 冒充六维。 */
    /**
     * 审批卡（task_049）：计划全文（pre-wrap 不截断 —— 逐条核对才是审批）+ 批准 / 驳回。
     * 模型只在 awaiting 相位产生（resolveTaskApproval），所以这里不需要条件按钮 ——
     * 卡在 = 可裁决。批准后卡片随相位消失（签名已含队列条目 id:status）。
     */
    private renderTaskApproval(approval: TaskApprovalModel): string {
      return `
        <div class="approval-card" data-role="approval-card" data-task="${escapeHtml(approval.taskId)}">
          <div class="approval-head">计划待审批<span class="approval-summary">${escapeHtml(approval.summary)}</span></div>
          <pre class="approval-plan">${escapeHtml(approval.plan)}</pre>
          <div class="approval-actions">
            <button type="button" class="action" data-action="task-approve" data-task="${escapeHtml(approval.taskId)}">批准</button>
            <button type="button" class="action" data-action="task-reject" data-task="${escapeHtml(approval.taskId)}">驳回</button>
          </div>
        </div>
      `;
    }

    /**
     * 队列列表的一条（task_047）：徽标（相位语义色）+ 摘要（截断）+ 动作按钮。
     * 取消按钮仅 queued（running 不强杀 —— 点不到即提示，core 拒绝时另有 Notice）；
     * 重派按钮仅 failed（completed 已有产出、cancelled 是主动放弃，都无需重派入口）。
     */
    private renderTaskItem(item: TaskQueueItemModel): string {
      const cancel = item.canCancel
        ? `<button type="button" class="action" data-action="task-queue-cancel" data-task="${escapeHtml(item.id)}">取消</button>`
        : '';
      const reassign = item.canReassign
        ? `<button type="button" class="action" data-action="task-reassign" data-task="${escapeHtml(item.id)}">重派</button>`
        : '';
      return `
        <div class="task-item" data-task="${escapeHtml(item.id)}" data-status="${escapeHtml(item.status)}">
          <span class="task-badge" data-task-status="${escapeHtml(item.status)}">${escapeHtml(item.statusLabel)}</span>
          <span class="task-summary" title="${escapeHtml(item.prompt)}">${escapeHtml(item.summary)}</span>
          <span class="task-item-actions">${cancel}${reassign}</span>
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