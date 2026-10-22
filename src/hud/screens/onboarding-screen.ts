/**
 * 文件职责：首启向导屏 Web Component（`<strat-onboarding-screen>`）—— 四步引导：
 *   ① 扫描报告（WorldState.detectedAgents：已装高亮 + tier 标签）
 *   ② 逐个已装 agent 起名 + 随机皮肤（可换）
 *   ③ 人设生成（4 题问答拼装 persona 模板，预览可直接改）
 *   ④ 确认 → 逐个 character.create → 完成事件。
 *   来源：.long-run-agent/tasks/task_025.md「hud 首启向导屏」。
 *   依赖：task_022（detectedAgents）、task_021（character.create 建档口径）、task_024（皮肤库）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力，与 screens / panels 同口径）；WorldState 快照。
 * 输出：Shadow DOM 向导屏（覆盖层，z-index 50，与 main-screen 的 .hud-sub-screen 同规范）；
 *   交互 → HudCommand（character.create / ui.navigate）；完成 → 自定义 DOM 事件 `onboarding-complete`。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态
 *      （纯常量 / 纯函数的 import 例外：core/types 的词表与上限、core/character 的模板与长度口径，
 *       理由同 character-catalog —— 同一口径不许在两处各判一次）；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token（本文件不含任何色值字面量）；
 *   4. 渲染未经转义的用户数据 —— 角色名与人设都是自由文本，一律走 escapeHtml；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）；
 *   6. 自己改 mount 接线 —— 挂载接线由 app 侧首启逻辑负责（task_026）。
 *
 * ★ 四步的数据流（一眼看清谁在哪儿改的）：
 *   - 扫描结果（core 广播）→ 扫描报告行；
 *   - 可建档名单（已装 ∩ AGENT_KINDS）→ 第二步的起名条目（名字默认取 agent 显示名）；
 *   - 皮肤由皮肤库抽签器给（可注入 skinSource，测试可确定性复现）；
 *   - 问卷答案 → 人设模板（core 默认模板打底 + 各题 fragment），预览可改，改过之后不再被答案覆盖；
 *   - 确认页 → 逐条 character.create → 完成事件。
 *
 * 挂载接线（@since v3.9，task_026 已接）：本屏只提供 mountOnboardingScreen 工厂，
 *   何时挂载由 app 层决定（app/main/onboarding-host.ts：WorldState.characters 为空
 *   且探到已装 agent 时挂；开发期 STRATIX_ONBOARDING_FORCE=1 每次启动都挂）。
 *   宿主靠两个 DOM 事件收起覆盖层：onboarding-complete（建档完成）/ onboarding-skipped（用户跳过）。
 */

import { getSkin, randomSkin, resolveAccent, type SkinDefinition, type SkinId } from '../../core/theme/skin-registry';
import type { AgentKind, WorldState } from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { defineStratButton, escapeHtml, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import {
  DETECTION_STATUS_LABELS,
  NAME_ERROR_MESSAGES,
  ONBOARDING_STEPS,
  PERSONA_ERROR_MESSAGES,
  PERSONA_QUESTIONS,
  STEP_LABELS,
  TIER_LABELS,
  agentKindLabel,
  buildPersona,
  findDuplicateNames,
  missingPersonaAnswers,
  resolveBindableKinds,
  resolveScanRows,
  resolveScanStatus,
  validateAgentName,
  validatePersona,
  type OnboardingIdentity,
  type OnboardingScanRow,
  type OnboardingStep,
  type PersonaAnswers,
} from './onboarding-catalog';

export const ONBOARDING_SCREEN_TAG = 'strat-onboarding-screen';

/** 向导走完时派发的 DOM 事件（冒泡 + composed，宿主据此收起覆盖层）。 */
export const ONBOARDING_COMPLETE_EVENT = 'onboarding-complete';

/**
 * 用户跳过引导时派发的 DOM 事件（冒泡 + composed）。
 * @since v3.9（task_026）：覆盖层由 app 层挂载（app/main/onboarding-host.ts），
 *   宿主需要知道"用户跳过了"才能收起覆盖层 —— 只发 ui.navigate 的话宿主无从分辨
 *   "跳过"与"别的组件导航回主屏"。
 */
export const ONBOARDING_SKIPPED_EVENT = 'onboarding-skipped';

/** 完成事件的载荷：实际建了哪些角色。 */
export interface OnboardingCompleteDetail {
  readonly created: readonly {
    readonly kind: AgentKind;
    readonly name: string;
    readonly skinId: SkinId;
  }[];
}

/** 本屏需要的最小能力面：只要"发命令"与"订阅状态"，与 screens / panels 同一约定。 */
export type OnboardingScreenDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/**
 * 皮肤抽签源（可注入）。
 * 默认走 skin-registry 的模块级 randomSkin（一轮内不重复）；测试注入固定种子源即可复现。
 */
export type SkinSource = () => SkinDefinition;

/**
 * 屏内可变的身份条目。
 * why 不直接用 OnboardingIdentity：那份是**对外只读**的渲染模型，屏内改名 / 换肤需要就地改。
 */
interface MutableIdentity {
  kind: AgentKind;
  label: string;
  name: string;
  skinId: SkinId;
}

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratOnboardingScreenElement extends HTMLElement {
  /** 注入的适配器；connected 之前或之后设置都生效。 */
  adapter: OnboardingScreenDeps | null;
  /** 皮肤抽签源；null = 走皮肤库默认抽签。 */
  skinSource: SkinSource | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 当前步骤。 */
  readonly step: OnboardingStep;
  /** 当前起名 / 皮肤清单。 */
  readonly identities: readonly OnboardingIdentity[];
  /** 当前人设文本（预览区可改后的值）。 */
  readonly persona: string;
  /** 当前错误提示（key → 文案）。 */
  readonly errors: Readonly<Record<string, string>>;
  /** 扫描报告行。 */
  readonly scanRows: readonly OnboardingScanRow[];
  /** 前进一步（校验不通过则原地报错，不前进）。 */
  next(): void;
  /** 后退一步。 */
  back(): void;
  /** 完成建档（发命令 + 派发完成事件）。 */
  submit(): void;
}

/** 步骤条的显示：当前步 / 已走过的步 / 未到的步。 */
function stepState(step: OnboardingStep, current: OnboardingStep): 'done' | 'active' | 'todo' {
  if (step === current) return 'active';
  return ONBOARDING_STEPS.indexOf(step) < ONBOARDING_STEPS.indexOf(current) ? 'done' : 'todo';
}

/**
 * 屏内样式表。
 * why 全部走 var(--srf-*) 且**不写兜底色值**：token 由皮肤样式表提供（8 套皮肤都定义齐了
 * 30 个 token，见 hud/theme/__tests__/skin-tokens.test.ts），写兜底色值等于把旧皮肤钉死在第一套。
 */
const ONBOARDING_STYLE = `
  :host { all: initial; display: block; position: absolute; inset: 0; z-index: 50; }
  .screen {
    display: grid;
    grid-template-rows: auto 1fr auto;
    height: 100%;
    min-height: 0;
    background: var(--srf-bg);
    color: var(--srf-text);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-md);
    line-height: var(--srf-line-height);
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--srf-spacing-sm);
    flex-wrap: wrap;
    padding: var(--srf-spacing-sm) var(--srf-spacing-md);
    background: var(--srf-panel);
    border-bottom: var(--srf-border-width) solid var(--srf-border);
  }
  .title { font-size: var(--srf-font-size-lg); }
  .stepper { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; list-style: none; margin: 0; padding: 0; }
  .step { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
  .step[data-state="active"] { color: var(--srf-accent); font-weight: 600; }
  .step[data-state="done"] { color: var(--srf-success); }
  .body {
    display: grid;
    gap: var(--srf-spacing-md);
    align-content: start;
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
    padding: var(--srf-spacing-md);
    overflow: auto;
  }
  .group {
    display: grid;
    gap: var(--srf-spacing-sm);
    padding: var(--srf-spacing-md);
    background: var(--srf-panel);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
  }
  .group-name { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); letter-spacing: 0.04em; }
  .summary { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
  .rows { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--srf-spacing-xs); }
  .row {
    display: flex;
    align-items: center;
    gap: var(--srf-spacing-sm);
    flex-wrap: wrap;
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    background: var(--srf-panel-elevated);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    font-size: var(--srf-font-size-sm);
  }
  .row[data-installed="true"] { border-color: var(--srf-accent); }
  .row-name { font-weight: 600; }
  .meta { color: var(--srf-text-muted); }
  .chip {
    color: var(--srf-warn);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    padding: 0 var(--srf-spacing-xs);
  }
  .identity {
    display: grid;
    gap: var(--srf-spacing-xs);
    padding: var(--srf-spacing-sm);
    background: var(--srf-panel-elevated);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
  }
  .identity-head { display: flex; align-items: center; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
  .identity-label { font-weight: 600; }
  /* 徽标色走 token：皮肤库给的 accent 覆写 --srf-badge-accent，本文件不含色值字面量。 */
  .badge { display: inline-block; width: 12px; height: 12px; border-radius: 50%; background: var(--srf-badge-accent); }
  .skin-name { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
  .input, .textarea {
    background: var(--srf-bg);
    color: var(--srf-text);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-md);
    line-height: var(--srf-line-height);
  }
  .textarea { resize: vertical; width: 100%; box-sizing: border-box; }
  .error { color: var(--srf-danger); font-size: var(--srf-font-size-sm); }
  .error[hidden] { display: none; }
  .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
  .hint { color: var(--srf-warn); font-size: var(--srf-font-size-sm); }
  .question {
    margin: 0;
    display: grid;
    gap: var(--srf-spacing-xs);
    padding: var(--srf-spacing-sm);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
  }
  .question-prompt { color: var(--srf-text); font-size: var(--srf-font-size-sm); }
  .options { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
  .option { display: inline-flex; align-items: center; gap: var(--srf-spacing-xs); font-size: var(--srf-font-size-sm); }
  .persona {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-sm);
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--srf-spacing-sm);
    padding: var(--srf-spacing-sm) var(--srf-spacing-md);
    background: var(--srf-panel);
    border-top: var(--srf-border-width) solid var(--srf-border);
  }
`;

/** 工厂：注册 `<strat-onboarding-screen>`。幂等（与 defineCharacterScreen 同一约定）。 */
export function defineOnboardingScreen(): typeof HTMLElement {
  defineStratButton();
  if (customElements.get(ONBOARDING_SCREEN_TAG)) {
    return customElements.get(ONBOARDING_SCREEN_TAG) as unknown as typeof HTMLElement;
  }

  class OnboardingScreen extends HTMLElement implements StratOnboardingScreenElement {
    private _adapter: OnboardingScreenDeps | null = null;
    private _skinSource: SkinSource | null = null;
    private _state: WorldState | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    private _step: OnboardingStep = 'scan';
    private _identities: MutableIdentity[] = [];
    private _answers: Record<string, string> = {};
    /** 人设草稿（预览区可改）。初值 = core 的默认人设模板（没答任何题时的底线）。 */
    private _persona = buildPersona({});
    /** 用户是否手改过人设：改过之后答案变化不再覆盖它。 */
    private _personaDirty = false;
    /** 错误提示：key → 文案。 */
    private _errors = new Map<string, string>();
    /** 已提交（防重复发命令）。 */
    private _submitted = false;
    /** 上次渲染时的扫描结果签名（避免无关广播反复重画扫描步）。 */
    private _lastScanSignature: string | null = null;

    get adapter(): OnboardingScreenDeps | null { return this._adapter; }
    set adapter(value: OnboardingScreenDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get skinSource(): SkinSource | null { return this._skinSource; }
    set skinSource(value: SkinSource | null) {
      this._skinSource = value;
    }

    get step(): OnboardingStep { return this._step; }
    get identities(): readonly OnboardingIdentity[] { return this._identities; }
    get persona(): string { return this._persona; }
    get errors(): Readonly<Record<string, string>> {
      return Object.fromEntries(this._errors.entries());
    }
    get scanRows(): readonly OnboardingScanRow[] { return resolveScanRows(this._state); }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已记过键，而那时还没有内容可画
      this._lastScanSignature = null;
      this.bindAdapter();
      this.refresh();
    }

    disconnectedCallback(): void {
      this.releaseAdapter();
    }

    refresh(): void {
      // 只有扫描步会因为 core 广播而重画；后面几步正在填表，重画会打断输入（焦点丢失）。
      if (this._step !== 'scan') return;
      const signature = this.scanSignature();
      if (signature === this._lastScanSignature) return;
      this._lastScanSignature = signature;
      this.renderStep();
    }

    /** 扫描结果签名：只含影响扫描报告显示的字段（core 每次广播都是全量的，不能每次都重画）。 */
    private scanSignature(): string {
      // 前缀标出"有没有收到广播"：还没收到广播与"广播了但一个都没探到"是两种文案，签名必须能区分。
      const prefix = this._state ? 's' : 'n';
      const rows = resolveScanRows(this._state)
        .map((row) => `${row.kind}:${row.installed}:${row.status}:${row.tier}:${row.version}`)
        .join('|');
      return `${prefix}|${rows}`;
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

    // —— 步骤流转 ——
    next(): void {
      switch (this._step) {
        case 'scan':
          this.syncIdentities();
          this._step = 'identity';
          break;
        case 'identity':
          if (!this.validateIdentities()) return;
          this._step = 'persona';
          break;
        case 'persona':
          if (!this.validatePersonaStep()) return;
          this._step = 'confirm';
          break;
        case 'confirm':
          this.submit();
          return;
      }
      this.renderStep();
    }

    back(): void {
      const index = ONBOARDING_STEPS.indexOf(this._step);
      if (index <= 0) return;
      this._step = ONBOARDING_STEPS[index - 1] as OnboardingStep;
      this.renderStep();
    }

    /** 跳过引导：回主屏（宿主也可监听 ui.navigate 自行收起覆盖层）。 */
    skip(): void {
      // 派发跳过事件：宿主据此收起覆盖层（app/main/onboarding-host.ts）。
      this.dispatchEvent(new CustomEvent(ONBOARDING_SKIPPED_EVENT, { bubbles: true, composed: true }));
      this._adapter?.dispatch({ type: 'ui.navigate', screen: 'main' });
    }

    /** 完成建档：逐个 character.create → 完成事件 → 回主屏。 */
    submit(): void {
      if (this._submitted) return;
      // 兜底校验：确认页之前走过身份校验，但用户可能退回去改坏 —— 这里再拦一道。
      if (!this.validateIdentities()) {
        this._step = 'identity';
        this.renderStep();
        return;
      }
      this._submitted = true;
      const persona = this._persona.trim();
      const created = this._identities.map((identity) => ({
        kind: identity.kind,
        name: identity.name,
        skinId: identity.skinId,
      }));
      for (const identity of this._identities) {
        this._adapter?.dispatch({
          type: 'character.create',
          name: identity.name,
          agentKind: identity.kind,
          skinId: identity.skinId,
          ...(persona.length > 0 ? { persona } : {}),
        });
      }
      this.dispatchEvent(new CustomEvent<OnboardingCompleteDetail>(ONBOARDING_COMPLETE_EVENT, {
        bubbles: true,
        composed: true,
        detail: { created },
      }));
      this._adapter?.dispatch({ type: 'ui.navigate', screen: 'main' });
      this.renderStep();
    }

    // —— 身份（起名 + 皮肤）——
    /**
     * 同步起名清单：按当前可建档名单重建。
     * 已存在的条目保留（用户改过的名字不能丢），名单里新增的补默认名与随机皮肤，消失的移除。
     */
    private syncIdentities(): void {
      const kinds = resolveBindableKinds(this._state);
      const existing = new Map(this._identities.map((item) => [item.kind, item] as const));
      this._identities = kinds.map((kind) => {
        const previous = existing.get(kind);
        if (previous) return previous;
        return {
          kind,
          label: agentKindLabel(kind),
          name: agentKindLabel(kind),
          skinId: this.pickSkin(),
        };
      });
    }

    /** 抽一套皮肤（默认走皮肤库；注入 skinSource 时用注入的）。 */
    private pickSkin(): SkinId {
      const source = this._skinSource ?? ((): SkinDefinition => randomSkin());
      return source().id;
    }

    /** 换肤：给指定 agent 抽下一套。 */
    private reroll(kind: string): void {
      const target = this._identities.find((item) => item.kind === kind);
      if (!target) return;
      target.skinId = this.pickSkin();
      this.renderStep();
    }

    /** 改名（输入框实时输入）。 */
    private setName(kind: string, name: string): void {
      const target = this._identities.find((item) => item.kind === kind);
      if (!target) return;
      target.name = name;
      // 名字改了就把这条的错误提示撤掉（别让旧报错挂在已经改好的输入框下面）。
      this.setError(`name:${kind}`, null);
    }

    /** 校验全部名字（空 / 超长 / 重复）。 */
    private validateIdentities(): boolean {
      const names = this._identities.map((item) => item.name);
      const duplicated = new Set(findDuplicateNames(names));
      let ok = true;
      for (const identity of this._identities) {
        const result = validateAgentName(identity.name);
        if (result.ok && duplicated.has(result.value)) {
          this.setError(`name:${identity.kind}`, NAME_ERROR_MESSAGES['duplicate-name']);
          ok = false;
          continue;
        }
        if (!result.ok) {
          this.setError(`name:${identity.kind}`, NAME_ERROR_MESSAGES[result.code ?? 'empty-name']);
          ok = false;
          continue;
        }
        identity.name = result.value;
        this.setError(`name:${identity.kind}`, null);
      }
      return ok;
    }

    // —— 人设 ——
    /** 记录一个答案；用户没手改过人设时同步刷新预览。 */
    private answer(questionId: string, optionId: string): void {
      this._answers[questionId] = optionId;
      this.setError(`answer:${questionId}`, null);
      if (!this._personaDirty) {
        this._persona = buildPersona(this.answersSnapshot());
        this.syncPersonaField();
      }
    }

    /** 用户手改人设：记为脏，之后答案变化不再覆盖。 */
    private setPersona(text: string): void {
      this._persona = text;
      this._personaDirty = true;
      this.setError('persona', null);
    }

    private answersSnapshot(): PersonaAnswers {
      return { ...this._answers };
    }

    /** 校验人设步：题目答全 + 人设不超长。 */
    private validatePersonaStep(): boolean {
      let ok = true;
      for (const questionId of missingPersonaAnswers(this.answersSnapshot())) {
        this.setError(`answer:${questionId}`, '这一题还没选');
        ok = false;
      }
      const persona = validatePersona(this._persona);
      if (!persona.ok) {
        this.setError('persona', PERSONA_ERROR_MESSAGES[persona.code ?? 'persona-too-long']);
        ok = false;
      } else {
        this._persona = persona.value;
        this.setError('persona', null);
      }
      return ok;
    }

    // —— 错误提示 ——
    /**
     * 写一条错误提示并同步到 DOM。
     * why 直接改 DOM 而不是整块重画：重画会把用户正在输入的输入框换掉（焦点丢失、输入法中断）。
     */
    private setError(key: string, message: string | null): void {
      if (message === null) this._errors.delete(key);
      else this._errors.set(key, message);
      const root = this.shadowRoot;
      if (!root) return;
      const node = root.querySelector(`[data-error-key="${key}"]`);
      if (!node) return;
      node.textContent = message ?? '';
      if (message) node.removeAttribute('hidden');
      else node.setAttribute('hidden', '');
    }

    // —— 交互 ——
    private onClick(ev: Event): void {
      const target = ev.target as HTMLElement | null;
      if (!target?.closest) return;
      const action = target.closest('[data-action]');
      if (!action) return;
      switch (action.getAttribute('data-action')) {
        case 'next':
          this.next();
          return;
        case 'back':
          this.back();
          return;
        case 'submit':
          this.submit();
          return;
        case 'skip':
          this.skip();
          return;
        case 'reroll':
          this.reroll(action.getAttribute('data-kind') ?? '');
          return;
        default:
          return;
      }
    }

    private onInput(ev: Event): void {
      const target = ev.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!target?.getAttribute) return;
      const field = target.getAttribute('data-field');
      if (field === 'name') {
        this.setName(target.getAttribute('data-kind') ?? '', target.value);
        return;
      }
      if (field === 'persona') {
        this.setPersona(target.value);
      }
    }

    private onChange(ev: Event): void {
      const target = ev.target as HTMLInputElement | null;
      if (!target?.getAttribute) return;
      if (target.getAttribute('data-field') !== 'answer') return;
      this.answer(target.getAttribute('data-question') ?? '', target.value);
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;

      root.innerHTML = `
        <style>${ONBOARDING_STYLE}</style>
        <div class="screen" part="screen">
          <div class="topbar">
            <span class="title">首启向导</span>
            <ol class="stepper" data-role="stepper">${this.renderStepper()}</ol>
            <div class="topbar-actions">
              <${STRAT_BUTTON_TAG} label="跳过引导" variant="default" data-action="skip"></${STRAT_BUTTON_TAG}>
            </div>
          </div>
          <div class="body" data-role="body"></div>
          <div class="footer" data-role="footer"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 事件委托绑在外壳上：内容区每次重渲染都重建，绑在内容上会随重渲染反复泄漏（perf 硬约束）。
        root.addEventListener('click', (ev: Event) => this.onClick(ev));
        root.addEventListener('strat-button-click', (ev: Event) => this.onClick(ev));
        root.addEventListener('input', (ev: Event) => this.onInput(ev));
        root.addEventListener('change', (ev: Event) => this.onChange(ev));
      }
    }

    private renderStepper(): string {
      return ONBOARDING_STEPS.map((step) => {
        const state = stepState(step, this._step);
        return `<li class="step" data-role="step" data-step="${step}" data-state="${state}">${escapeHtml(STEP_LABELS[step])}</li>`;
      }).join('');
    }

    private renderStep(): void {
      const root = this.shadowRoot;
      if (!root) return;
      const stepper = root.querySelector('[data-role="stepper"]');
      if (stepper) stepper.innerHTML = this.renderStepper();

      const body = root.querySelector('[data-role="body"]');
      if (body) body.innerHTML = this.renderBody();

      const footer = root.querySelector('[data-role="footer"]');
      if (footer) footer.innerHTML = this.renderFooter();
    }

    private renderBody(): string {
      switch (this._step) {
        case 'scan':
          return this.renderScan();
        case 'identity':
          return this.renderIdentity();
        case 'persona':
          return this.renderPersona();
        case 'confirm':
          return this.renderConfirm();
        default:
          return '';
      }
    }

    /** ① 扫描报告。 */
    private renderScan(): string {
      const rows = resolveScanRows(this._state);
      const installed = rows.filter((row) => row.installed).length;
      const bindable = resolveBindableKinds(this._state).length;
      const status = resolveScanStatus(this._state);
      const list =
        rows.length === 0
          ? `<div class="empty" data-role="scan-empty">${this._state ? '还没探测到本机 agent：确认 PATH 里装了 CLI 后重进向导' : '正在等扫描结果…'}</div>`
          : `<ul class="rows">${rows.map((row) => this.renderScanRow(row)).join('')}</ul>`;
      // 扫描没跑完时的提醒：检测是逐条推送的，此刻点下一步只会给**已探到的** agent 建档。
      const pendingHint = status.complete
        ? ''
        : `<div class="hint" data-role="scan-pending">扫描还没结束：现在继续只会为已探到的 agent 建档（可以回到这一步补齐）</div>`;
      return `
        <div class="group" data-group="scan">
          <div class="group-name">扫描报告</div>
          <div class="summary" data-role="scan-status" data-complete="${status.complete}">${escapeHtml(status.text)}</div>
          <div class="summary" data-role="scan-summary">探测到 ${rows.length} 个 agent · 确认已装 ${installed} 个 · 可建档 ${bindable} 个</div>
          ${pendingHint}
          ${list}
        </div>
      `;
    }

    private renderScanRow(row: OnboardingScanRow): string {
      const version = row.version ? `v${row.version}` : '版本未知';
      const chip = row.bindable ? '' : '<span class="chip" data-role="only-probe">仅探测</span>';
      return `
        <li class="row" data-role="scan-row" data-kind="${escapeHtml(row.kind)}"
            data-installed="${row.installed}" data-bindable="${row.bindable}">
          <span class="row-name">${escapeHtml(row.label)}</span>
          <span class="tier" data-role="tier">${escapeHtml(TIER_LABELS[row.tier])}</span>
          <span class="status" data-role="status">${escapeHtml(DETECTION_STATUS_LABELS[row.status])}</span>
          <span class="meta">${escapeHtml(version)}</span>
          ${chip}
        </li>
      `;
    }

    /** ② 起名 + 皮肤。 */
    private renderIdentity(): string {
      if (this._identities.length === 0) {
        return `
          <div class="group" data-group="identity">
            <div class="group-name">起名与皮肤</div>
            <div class="empty" data-role="identity-empty">没有可建档的已装 agent：装好一个 T1 agent（Claude Code / Codex / OpenCode / Kimi / OpenClaw）后再回来</div>
          </div>
        `;
      }
      const rows = this._identities.map((identity) => this.renderIdentityRow(identity)).join('');
      return `
        <div class="group" data-group="identity">
          <div class="group-name">起名与皮肤</div>
          ${rows}
        </div>
      `;
    }

    private renderIdentityRow(identity: MutableIdentity): string {
      const skinLabel = getSkin(identity.skinId)?.label ?? identity.skinId;
      const error = this._errors.get(`name:${identity.kind}`) ?? '';
      const errorAttr = error ? '' : 'hidden';
      return `
        <div class="identity" data-role="identity" data-kind="${escapeHtml(identity.kind)}">
          <div class="identity-head">
            <span class="identity-label">${escapeHtml(identity.label)}</span>
            <span class="badge" data-role="skin-badge" style="--srf-badge-accent: ${resolveAccent(identity.skinId)}"></span>
            <span class="skin-name" data-role="skin-label">${escapeHtml(skinLabel)}</span>
            <${STRAT_BUTTON_TAG} label="换一套皮肤" variant="default" data-action="reroll" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
          </div>
          <input class="input" type="text" data-role="name-input" data-field="name" data-kind="${escapeHtml(identity.kind)}"
                 value="${escapeHtml(identity.name)}" placeholder="给这个 agent 起个名字">
          <div class="error" data-role="name-error" data-error-key="name:${escapeHtml(identity.kind)}" ${errorAttr}>${escapeHtml(error)}</div>
        </div>
      `;
    }

    /** ③ 人设生成。 */
    private renderPersona(): string {
      const questions = PERSONA_QUESTIONS.map((question) => {
        const options = question.options.map((option) => {
          const checked = this._answers[question.id] === option.id ? 'checked' : '';
          return `
            <label class="option">
              <input type="radio" name="persona-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}"
                     data-role="option" data-field="answer" data-question="${escapeHtml(question.id)}" ${checked}>
              <span>${escapeHtml(option.label)}</span>
            </label>
          `;
        }).join('');
        const error = this._errors.get(`answer:${question.id}`) ?? '';
        const errorAttr = error ? '' : 'hidden';
        return `
          <fieldset class="question" data-role="question" data-question="${escapeHtml(question.id)}">
            <legend class="question-prompt">${escapeHtml(question.prompt)}</legend>
            <div class="options">${options}</div>
            <div class="error" data-role="answer-error" data-error-key="answer:${escapeHtml(question.id)}" ${errorAttr}>${escapeHtml(error)}</div>
          </fieldset>
        `;
      }).join('');

      const personaError = this._errors.get('persona') ?? '';
      const personaErrorAttr = personaError ? '' : 'hidden';
      return `
        <div class="group" data-group="persona">
          <div class="group-name">人设生成</div>
          ${questions}
          <div class="group-name">预览（可以直接改）</div>
          <textarea class="textarea" rows="8" data-role="persona-input" data-field="persona">${escapeHtml(this._persona)}</textarea>
          <div class="error" data-role="persona-error" data-error-key="persona" ${personaErrorAttr}>${escapeHtml(personaError)}</div>
        </div>
      `;
    }

    /** ④ 确认。 */
    private renderConfirm(): string {
      if (this._identities.length === 0) {
        return `
          <div class="group" data-group="confirm">
            <div class="group-name">确认建档</div>
            <div class="empty" data-role="confirm-empty">没有可建档的角色：直接完成即可结束向导</div>
          </div>
        `;
      }
      const rows = this._identities.map((identity) => {
        const skinLabel = getSkin(identity.skinId)?.label ?? identity.skinId;
        return `
          <li class="row" data-role="summary-row" data-kind="${escapeHtml(identity.kind)}">
            <span class="row-name">${escapeHtml(identity.name)}</span>
            <span class="meta">${escapeHtml(identity.label)}</span>
            <span class="meta" data-role="summary-skin">${escapeHtml(skinLabel)}</span>
          </li>
        `;
      }).join('');
      return `
        <div class="group" data-group="confirm">
          <div class="group-name">确认建档</div>
          <ul class="rows">${rows}</ul>
          <div class="group-name">人设</div>
          <pre class="persona" data-role="persona-preview">${escapeHtml(this._persona)}</pre>
        </div>
      `;
    }

    private renderFooter(): string {
      const back =
        this._step === 'scan'
          ? ''
          : `<${STRAT_BUTTON_TAG} label="上一步" variant="default" data-action="back"></${STRAT_BUTTON_TAG}>`;
      const primary =
        this._step === 'confirm'
          ? `<${STRAT_BUTTON_TAG} label="完成建档" variant="primary" data-action="submit"${this._submitted ? ' disabled' : ''}></${STRAT_BUTTON_TAG}>`
          : `<${STRAT_BUTTON_TAG} label="下一步" variant="primary" data-action="next"></${STRAT_BUTTON_TAG}>`;
      return `${back}${primary}`;
    }

    /** 把组件内的答案重新算成人设并写回预览框（不重画整屏，保住输入焦点）。 */
    private syncPersonaField(): void {
      const field = this.shadowRoot?.querySelector('[data-role="persona-input"]') as HTMLTextAreaElement | null;
      if (field) field.value = this._persona;
    }
  }

  customElements.define(ONBOARDING_SCREEN_TAG, OnboardingScreen);
  return OnboardingScreen as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂：本仓库屏 / 面板的统一装配口径（与 mountCharacterScreen 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 * 挂载时机由 app 侧首启逻辑决定（app/main/onboarding-host.ts）。
 */
export function mountOnboardingScreen(deps: OnboardingScreenDeps, host: HTMLElement): () => void {
  defineOnboardingScreen();
  const element = document.createElement(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}
