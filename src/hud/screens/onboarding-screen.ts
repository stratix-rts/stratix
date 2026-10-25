/**
 * 文件职责：首启向导屏 Web Component（`<strat-onboarding-screen>`）—— 四步引导：
 *   ① 扫描报告（WorldState.detectedAgents：已装高亮 + tier 标签）
 *   ② 逐个已装 agent 起名 + 随机皮肤（可换）+ **每 agent 独立形象**（@since v3.12，task_032：
 *      默认品牌预设 + 可单独改部件 + 规则化重随机 + 重置默认；canvas 预览走路动画）
 *   ③ 人设生成（预设快速开始 + 4 题问答拼装结构化 persona，预览可直接改 + 脏保护）
 *   ④ 确认 → 逐个 character.create（各带各的 appearance）→ 完成事件。
 *   来源：.long-run-agent/tasks/task_025.md「hud 首启向导屏」；第②步的形象能力见 task_028。
 *   依赖：task_022（detectedAgents）、task_021（character.create 建档口径）、task_024（皮肤库）、
 *   task_027（world/appearance 的 LPC 合成栈，**只经端口消费**）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力，与 screens / panels 同口径）；
 *   WorldState 快照；注入的形象预览端口（AppearancePreviewPort）。
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
 *   - 形象草稿是**每 agent 一份**（@since v3.12，task_032）：`Map<kind, AppearanceDraft>`，
 *     初始值 = 注入端口给的默认形象（品牌预设，独立深拷贝）——屏不认识预设库与随机器，
 *     只发意图（preset / randomizeNormal，见 appearance-preview-port.ts）；
 *   - 问卷答案 → 人设模板（core 默认模板打底 + 各题 fragment），预览可改，改过之后不再被答案覆盖；
 *   - 确认页 → 逐条 character.create（各带各的 appearance）→ 完成事件。
 *
 * ★ 形象预览与"总线隔离"的关系（task_028 的核心约束，task_032 延续）：
 *   hud 不 import world，但第②步要显示真实角色长相。解法是**端口**：
 *   屏只依赖 AppearancePreviewPort（纯接口），实现住在 app 层
 *   （app/services/appearance-preview-service.ts，组合根 main-entry.ts 注入）——
 *   品牌预设（world/appearance/brand-presets）与规则化随机器（appearance-randomizer）
 *   都由端口的实现方接入，屏只拿到注入的 preset/randomizeNormal 两个动作。
 *   于是：屏的单测注入桩即可（不碰真 canvas），真 canvas 的手测归 task_029。
 *
 * 挂载接线（@since v3.9，task_026 已接）：本屏只提供 mountOnboardingScreen 工厂，
 *   何时挂载由 app 层决定（app/main/onboarding-host.ts：WorldState.characters 为空
 *   且探到已装 agent 时挂；开发期 STRATIX_ONBOARDING_FORCE=1 每次启动都挂）。
 *   宿主靠两个 DOM 事件收起覆盖层：onboarding-complete（建档完成）/ onboarding-skipped（用户跳过）。
 */

import { getSkin, randomSkin, resolveAccent, type SkinDefinition, type SkinId } from '../../core/theme/skin-registry';
import {
  appearancePartVariant,
  type AgentKind,
  type CharacterAppearance,
  type WorldState,
} from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { defineStratButton, escapeHtml, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import type {
  AppearanceCategoryInfo,
  AppearancePreviewPort,
} from './appearance-preview-port';
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
  cloneAppearance,
  createAppearanceDrafts,
  findDuplicateNames,
  missingPersonaAnswers,
  resolveBindableKinds,
  resolveScanRows,
  resolveScanStatus,
  validateAgentName,
  validatePersona,
  type AppearanceDraft,
  type OnboardingIdentity,
  type OnboardingScanRow,
  type OnboardingStep,
  type PersonaAnswers,
} from './onboarding-catalog';
import { PERSONA_PRESETS, type PersonaPreset } from './persona-presets';

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
    /** 选定的形象（@since v3.10）；没选 → null。 */
    readonly appearance: CharacterAppearance | null;
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
 * 形象草稿不在这几（@since v3.12，task_032）：所有 agent 的形象统一存在
 * `_appearanceDrafts`（Map<kind, AppearanceDraft>）—— 身份条目的增删与形象草稿的存取解耦。
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
  /**
   * 形象预览端口（@since v3.10）：null = 没接合成器（向导照常能走完，只是没有形象功能）。
   * 注入即生效；断开连接（disconnectedCallback）时屏会 destroy 它 —— Phaser 实例的生命周期归屏。
   */
  appearancePort: AppearancePreviewPort | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 当前步骤。 */
  readonly step: OnboardingStep;
  /** 当前起名 / 皮肤清单。 */
  readonly identities: readonly OnboardingIdentity[];
  /** 当前人设文本（预览区可改后的值）。 */
  readonly persona: string;
  /** 当前生效的预设 id（null = 没用预设 / 已被问卷或重新生成覆盖）。 */
  readonly personaPresetId: string | null;
  /** 人设预览是否处于手改态（脏：问卷重选不再自动覆写，需显式重新生成）。 */
  readonly personaDirty: boolean;
  /** 当前错误提示（key → 文案）。 */
  readonly errors: Readonly<Record<string, string>>;
  /** 扫描报告行。 */
  readonly scanRows: readonly OnboardingScanRow[];
  /** 某个 agent 选定的形象（没有 → null）。 */
  appearanceOf(kind: string): CharacterAppearance | null;
  /** 当前在预览区展示的是哪个 agent（null = 没有）。 */
  readonly previewKind: string | null;
  /** 给当前预览对象抽一套随机形象（规则随机 normal 档；端口没接 / 素材没就绪 → 不动）。 */
  randomizeAppearance(): void;
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
  /* 正在预览的那条：画布只有一块，得让人一眼看出在看谁。 */
  .identity[data-preview="true"] { border-color: var(--srf-accent); }
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
  /* 预设卡片行（@since v3.13，task_043）：横向排列的快速开始入口 */
  .preset-row { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
  .preset-card {
    display: grid;
    gap: var(--srf-spacing-xs);
    justify-items: start;
    text-align: left;
    flex: 0 1 224px;
    padding: var(--srf-spacing-sm);
    background: var(--srf-panel-elevated);
    color: var(--srf-text);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-sm);
    line-height: var(--srf-line-height);
    cursor: pointer;
  }
  .preset-card:hover { border-color: var(--srf-accent); }
  .preset-card[data-selected="true"] { border-color: var(--srf-accent); }
  .preset-name { font-weight: 600; }
  .preset-desc { color: var(--srf-text-muted); }
  .preset-kinds { display: flex; gap: var(--srf-spacing-xs); flex-wrap: wrap; }
  .preset-kind {
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    padding: 0 var(--srf-spacing-xs);
    color: var(--srf-text-muted);
    font-size: var(--srf-font-size-sm);
  }
  .preset-status { color: var(--srf-warn); font-size: var(--srf-font-size-sm); }
  .preset-status[hidden] { display: none; }
  .persona-tools { display: flex; align-items: center; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
  .regenerate {
    background: var(--srf-panel-elevated);
    color: var(--srf-text);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-sm);
    cursor: pointer;
  }
  .regenerate[hidden] { display: none; }
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
  /* 形象预览（@since v3.10）：画布宿主 + 部件选择器 */
  .canvas-slot { display: flex; justify-content: center; padding: var(--srf-spacing-sm); }
  .canvas {
    width: 128px;
    height: 128px;
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    background: var(--srf-panel-elevated);
    overflow: hidden;
  }
  .appearance-actions { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
  .appearance-fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--srf-spacing-sm);
  }
  .field { display: grid; gap: var(--srf-spacing-xs); font-size: var(--srf-font-size-sm); }
  .field-name { color: var(--srf-text-muted); }
  .select {
    background: var(--srf-bg);
    color: var(--srf-text);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-sm);
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
    private _appearancePort: AppearancePreviewPort | null = null;
    private _state: WorldState | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    private _step: OnboardingStep = 'scan';
    private _identities: MutableIdentity[] = [];
    /**
     * 每 agent 一份的形象草稿（@since v3.12，task_032）。
     * key = agent kind；初始值 = 注入端口给的默认形象（品牌预设）的**独立深拷贝**——
     * 预设是共享常量，直接存引用会让"改 A 的形象"写穿预设、连带别的 agent 一起变。
     */
    private _appearanceDrafts = new Map<string, AppearanceDraft>();
    private _answers: Record<string, string> = {};
    /** 人设草稿（预览区可改）。初值 = 没答任何题时的底线形态（只剩行为规则节）。 */
    private _persona = buildPersona({});
    /** 用户是否手改过人设：改过之后答案变化不再覆盖它（显式「按问卷重新生成」才覆盖）。 */
    private _personaDirty = false;
    /** 当前生效的预设 id（null = 问卷/手写模式）。答问卷任一题即退出预设模式。 */
    private _activePreset: string | null = null;
    /** 错误提示：key → 文案。 */
    private _errors = new Map<string, string>();
    /** 已提交（防重复发命令）。 */
    private _submitted = false;
    /** 上次渲染时的扫描结果签名（避免无关广播反复重画扫描步）。 */
    private _lastScanSignature: string | null = null;
    /**
     * 预览区当前展示的是哪个 agent（@since v3.10）。
     * why 需要它：起名清单可能有多个 agent，但画布只有一块 —— 得有个"正在看谁"的约定。
     */
    private _previewKind: string | null = null;
    /**
     * 预览画布的宿主元素（@since v3.10）。
     * why 单独留着：Phaser 的 canvas 是它的子节点，重渲染时若换掉这个元素，
     * 画布就跟着被摘掉（画面直接黑掉）。故重渲染时**搬走同一个元素**再放回去。
     */
    private _canvasHost: HTMLDivElement | null = null;

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

    get appearancePort(): AppearancePreviewPort | null { return this._appearancePort; }
    set appearancePort(value: AppearancePreviewPort | null) {
      const previous = this._appearancePort;
      this._appearancePort = value;
      if (!this.isConnected) return;
      // 换了端口：旧端口的预览实例（Phaser）得收掉 —— 两个实例抢同一块画布会互相覆盖。
      if (previous && previous !== value) previous.destroy();
      this.awaitAppearanceReady();
      this.renderStep();
    }

    get step(): OnboardingStep { return this._step; }
    get identities(): readonly OnboardingIdentity[] { return this._identities; }
    get persona(): string { return this._persona; }
    get personaPresetId(): string | null { return this._activePreset; }
    get personaDirty(): boolean { return this._personaDirty; }
    get errors(): Readonly<Record<string, string>> {
      return Object.fromEntries(this._errors.entries());
    }
    get scanRows(): readonly OnboardingScanRow[] { return resolveScanRows(this._state); }
    get previewKind(): string | null { return this._previewKind; }

    appearanceOf(kind: string): CharacterAppearance | null {
      return this._appearanceDrafts.get(kind) ?? null;
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清签名强制首绘：挂载前 adapter setter 那次 refresh 已记过键，而那时还没有内容可画
      this._lastScanSignature = null;
      this.bindAdapter();
      this.awaitAppearanceReady();
      this.refresh();
    }

    disconnectedCallback(): void {
      this.releaseAdapter();
      // Phaser 实例的生命周期归屏：向导一关，预览就没用了 —— 立刻销毁（perf 硬约束）。
      this._appearancePort?.destroy();
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
          // 进第②步时补一次"素材就绪后回填"：初始化时没取到默认形象的条目等 whenReady 后补上。
          this.awaitAppearanceReady();
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
        // 每 agent 各带各的形象（@since v3.12，task_032）：从各自的草稿里取，没有 → null。
        appearance: this._appearanceDrafts.get(identity.kind) ?? null,
      }));
      for (const identity of this._identities) {
        // 各 agent 的形象草稿（没抽到 → 字段缺省，老档案照旧合法）。
        const appearance = this._appearanceDrafts.get(identity.kind);
        this._adapter?.dispatch({
          type: 'character.create',
          name: identity.name,
          agentKind: identity.kind,
          skinId: identity.skinId,
          ...(persona.length > 0 ? { persona } : {}),
          ...(appearance ? { appearance } : {}),
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

    // —— 身份（起名 + 皮肤 + 形象）——
    /**
     * 同步起名清单：按当前可建档名单重建。
     * 已存在的条目保留（用户改过的名字不能丢），名单里新增的补默认名与随机皮肤，消失的移除。
     * 形象草稿同步维护（@since v3.12，task_032）：新增的 kind 补默认形象（独立深拷贝），
     * 消失的 kind 连草稿一起清（不留死数据）。
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
      // 形象草稿：每个 kind 一份独立深拷贝的默认形象（品牌预设；取不到的等素材就绪后补）。
      const fresh = createAppearanceDrafts(
        kinds.filter((kind) => !this._appearanceDrafts.has(kind)),
        (kind) => this._appearancePort?.preset(kind) ?? null
      );
      for (const [kind, draft] of fresh) this._appearanceDrafts.set(kind, draft);
      // 名单里消失的 kind：草稿一并清掉。
      const liveKinds = kinds as readonly string[];
      for (const kind of [...this._appearanceDrafts.keys()]) {
        if (!liveKinds.includes(kind)) this._appearanceDrafts.delete(kind);
      }
      // 预览对象没了（agent 被移除）→ 预览目标跟着换人。
      if (!this._identities.some((item) => item.kind === this._previewKind)) {
        this._previewKind = this._identities[0]?.kind ?? null;
      }
    }

    /** 抽一套皮肤（默认走皮肤库；注入 skinSource 时用注入的）。 */
    private pickSkin(): SkinId {
      const source = this._skinSource ?? ((): SkinDefinition => randomSkin());
      return source().id;
    }

    /** 当前预览区展示的是哪个 agent（没定 → 第一个）。 */
    private currentPreviewIdentity(): MutableIdentity | null {
      if (this._identities.length === 0) return null;
      const found = this._identities.find((item) => item.kind === this._previewKind);
      return found ?? this._identities[0] ?? null;
    }

    /**
     * 等素材元数据就绪（@since v3.10；@since v3.12 改为补默认形象）。
     * why 要等：无预设的 kind 走规则随机兑底，那要素材元数据；素材没加载出来时取不到。
     * 就绪后给还没有草稿的条目补默认形象，并刷新选择器。
     */
    private awaitAppearanceReady(): void {
      const port = this._appearancePort;
      if (!port) return;
      void port
        .whenReady()
        .then(() => {
          if (!this.isConnected || this._step !== 'identity') return;
          let changed = false;
          for (const identity of this._identities) {
            if (this._appearanceDrafts.has(identity.kind)) continue;
            const preset = port.preset(identity.kind);
            if (!preset) continue;
            this._appearanceDrafts.set(identity.kind, cloneAppearance(preset));
            changed = true;
          }
          if (changed) this.renderStep();
          else this.refreshAppearanceControls();
        })
        .catch(() => {
          // 端口契约：失败也 resolve（降级成空清单）。这里只是兜底 —— 失败时向导照常能走完。
        });
    }

    /** 换肤：给指定 agent 抽下一套。 */
    private reroll(kind: string): void {
      const target = this._identities.find((item) => item.kind === kind);
      if (!target) return;
      target.skinId = this.pickSkin();
      this.renderStep();
    }

    // —— 形象（@since v3.10；@since v3.12 改为每 agent 独立草稿）——
    /** 换预览对象：画布切到另一个 agent 的形象。 */
    private selectPreview(kind: string): void {
      if (!this._identities.some((item) => item.kind === kind)) return;
      this._previewKind = kind;
      this.renderStep();
    }

    /** 给当前预览对象重随机一套形象（对外 API：作用在正在看的那个人上）。 */
    randomizeAppearance(): void {
      const target = this.currentPreviewIdentity();
      if (!target) return;
      this.rerollAppearance(target.kind);
    }

    /**
     * 给某个 agent 重随机形象（「重随机」按钮，规则随机 normal 档，itemId 精确格式）。
     * why 走端口：随机器的规则与素材表都在 world 侧，屏只发意图（铁律）。
     */
    private rerollAppearance(kind: string): void {
      const port = this._appearancePort;
      if (!port) return;
      if (!this._identities.some((item) => item.kind === kind)) return;
      const next = port.randomizeNormal();
      if (!next) {
        this.setError('appearance', '素材还没加载出来，暂时抽不到随机形象');
        return;
      }
      this.setError('appearance', null);
      this._appearanceDrafts.set(kind, cloneAppearance(next));
      this.refreshDraftSurface(kind);
    }

    /** 把某个 agent 的形象重置回品牌默认（「重置为品牌默认」按钮）。 */
    private resetAppearance(kind: string): void {
      const port = this._appearancePort;
      if (!port) return;
      if (!this._identities.some((item) => item.kind === kind)) return;
      const preset = port.preset(kind);
      if (!preset) {
        this.setError('appearance', '素材还没加载出来，暂时取不到默认形象');
        return;
      }
      this.setError('appearance', null);
      this._appearanceDrafts.set(kind, cloneAppearance(preset));
      this.refreshDraftSurface(kind);
    }

    /** 草稿变了：只有"正在预览的那个"需要刷新画面与选择器（其余 agent 的草稿只进表）。 */
    private refreshDraftSurface(kind: string): void {
      if (kind !== this.currentPreviewIdentity()?.kind) return;
      this.refreshAppearanceControls();
      this.syncPreviewSurface();
    }

    /** 改体型（体型变了，可选变体清单也跟着变 → 选择器要重画）。 */
    private setBodyType(raw: string): void {
      const port = this._appearancePort;
      const target = this.currentPreviewIdentity();
      if (!port || !target) return;
      const bodyType = port.bodyTypes.find((item) => item === raw);
      if (!bodyType) return;
      const draft = this._appearanceDrafts.get(target.kind);
      this._appearanceDrafts.set(target.kind, {
        bodyType,
        parts: { ...(draft?.parts ?? {}) },
      });
      this.refreshAppearanceControls();
      this.syncPreviewSurface();
    }

    /** 改某个部位的变体（部件选择器，作用在**当前预览对象**的草稿上）。 */
    private setAppearancePart(category: string, variant: string): void {
      const target = this.currentPreviewIdentity();
      if (!target || !category || !variant) return;
      const draft = this._appearanceDrafts.get(target.kind);
      const bodyType = draft?.bodyType ?? this._appearancePort?.bodyTypes[0] ?? 'male';
      this._appearanceDrafts.set(target.kind, {
        bodyType,
        parts: { ...(draft?.parts ?? {}), [category]: variant },
      });
      this.setError('appearance', null);
      // 只刷新摘要（不重画整个选择器）：重画会把用户正在操作的 select 换掉（焦点丢失）。
      this.refreshAppearanceSummary();
      this.syncPreviewSurface();
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
    /**
     * 记录一个答案。
     * 答题即退出预设模式（预设被问卷结果替换是用户可预期的切换：问卷是主路径）；
     * 用户没手改过人设时同步刷新预览，手改过（脏）则只记答案不覆盖（见「按问卷重新生成」）。
     */
    private answer(questionId: string, optionId: string): void {
      const wasPreset = this._activePreset !== null;
      this._answers[questionId] = optionId;
      this._activePreset = null;
      this.setError(`answer:${questionId}`, null);
      if (wasPreset) this.syncPresetSurfaces();
      if (!this._personaDirty) {
        this._persona = buildPersona(this.answersSnapshot());
        this.syncPersonaField();
      }
    }

    /** 用户手改人设：记为脏（之后答案变化不再自动覆盖），并点亮「按问卷重新生成」。 */
    private setPersona(text: string): void {
      this._persona = text;
      this._personaDirty = true;
      this.setError('persona', null);
      this.syncPresetSurfaces();
    }

    /**
     * 选中预设：问卷清空 + 预览填预设全文 + 标记「已用预设」。
     * 预设选中视为显式覆写（清脏）——手改过的文本会被预设替换，这是用户明确的动作。
     */
    private selectPreset(presetId: string): void {
      const preset = PERSONA_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) return;
      this._answers = {};
      this._activePreset = preset.id;
      this._persona = preset.persona;
      this._personaDirty = false;
      this.setError('persona', null);
      // 预设路径不需要答完问卷：之前因未答被拦的错误一并撒掉。
      for (const question of PERSONA_QUESTIONS) this.setError(`answer:${question.id}`, null);
      this.renderStep();
    }

    /** 「按问卷重新生成」：显式覆写手改文本 = 按当前答卷重算（清脏、退出预设态）。 */
    private regeneratePersona(): void {
      this._persona = buildPersona(this.answersSnapshot());
      this._personaDirty = false;
      this._activePreset = null;
      this.setError('persona', null);
      this.syncPersonaField();
      this.syncPresetSurfaces();
    }

    private answersSnapshot(): PersonaAnswers {
      return { ...this._answers };
    }

    /** 校验人设步：问卷路径要答全；预设路径（预设未被问卷覆盖）本身就是完整人设，免答。人设不超长两路都查。 */
    private validatePersonaStep(): boolean {
      let ok = true;
      if (this._activePreset === null) {
        for (const questionId of missingPersonaAnswers(this.answersSnapshot())) {
          this.setError(`answer:${questionId}`, '这一题还没选');
          ok = false;
        }
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
        case 'randomize-appearance':
          // 每 agent 一份的重随机按钮（卡片上，带 data-kind）。
          this.rerollAppearance(action.getAttribute('data-kind') ?? '');
          return;
        case 'reset-appearance':
          this.resetAppearance(action.getAttribute('data-kind') ?? '');
          return;
        case 'preview-appearance':
          this.selectPreview(action.getAttribute('data-kind') ?? '');
          return;
        case 'select-preset':
          this.selectPreset(action.getAttribute('data-preset') ?? '');
          return;
        case 'regenerate-persona':
          this.regeneratePersona();
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
      const target = ev.target as HTMLInputElement | HTMLSelectElement | null;
      if (!target?.getAttribute) return;
      const field = target.getAttribute('data-field');
      if (field === 'answer') {
        this.answer(target.getAttribute('data-question') ?? '', target.value);
        return;
      }
      // 形象选择器（@since v3.10）：体型 / 部位变体。
      if (field === 'body-type') {
        this.setBodyType(target.value);
        return;
      }
      if (field === 'appearance-part') {
        this.setAppearancePart(target.getAttribute('data-category') ?? '', target.value);
      }
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
      if (body) {
        // 预览画布宿主必须跨重渲染存活：Phaser 的 canvas 挂在它里面，
        // 换掉这个元素 = 把画布一起从 DOM 里摘走（画面直接黑掉）。
        // 故先把老宿主摘出来（元素本身留着），重画后再放回新位置。
        this._canvasHost?.remove();
        body.innerHTML = this.renderBody();
        // 注意读的是**重画之后**的宿主：首次进入第②步时它才被创建（见 renderAppearanceGroup）。
        const slot = body.querySelector('[data-role="appearance-canvas-slot"]');
        if (slot && this._canvasHost) slot.appendChild(this._canvasHost);
      }

      const footer = root.querySelector('[data-role="footer"]');
      if (footer) footer.innerHTML = this.renderFooter();

      this.syncPreviewSurface();
    }

    /**
     * 把预览挂到画布宿主上，并把当前预览对象的形象推给预览服务（@since v3.10）。
     * why 每次重渲染都调：宿主元素可能被搬了位置，重画后要确保实例还指着它。
     */
    private syncPreviewSurface(): void {
      const port = this._appearancePort;
      const canvasHost = this._canvasHost;
      if (!port || !canvasHost || this._step !== 'identity') return;
      port.attach(canvasHost);
      const target = this.currentPreviewIdentity();
      const draft = target ? this._appearanceDrafts.get(target.kind) : undefined;
      if (draft) port.preview(draft);
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

    /** ② 起名 + 皮肤 + 形象。 */
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
        ${this.renderAppearanceGroup()}
      `;
    }

    private renderIdentityRow(identity: MutableIdentity): string {
      const skinLabel = getSkin(identity.skinId)?.label ?? identity.skinId;
      const error = this._errors.get(`name:${identity.kind}`) ?? '';
      const errorAttr = error ? '' : 'hidden';
      // 预览中的那个 agent 标出来（画布只有一块，得让人知道在看谁）。
      const previewing = identity.kind === this.currentPreviewIdentity()?.kind;
      const previewLabel = previewing ? '预览中' : '预览形象';
      return `
        <div class="identity" data-role="identity" data-kind="${escapeHtml(identity.kind)}" data-preview="${previewing}">
          <div class="identity-head">
            <span class="identity-label">${escapeHtml(identity.label)}</span>
            <span class="badge" data-role="skin-badge" style="--srf-badge-accent: ${resolveAccent(identity.skinId)}"></span>
            <span class="skin-name" data-role="skin-label">${escapeHtml(skinLabel)}</span>
            <${STRAT_BUTTON_TAG} label="换一套皮肤" variant="default" data-action="reroll" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="${previewLabel}" variant="default" data-action="preview-appearance" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
          </div>
          <input class="input" type="text" data-role="name-input" data-field="name" data-kind="${escapeHtml(identity.kind)}"
                 value="${escapeHtml(identity.name)}" placeholder="给这个 agent 起个名字">
          <div class="appearance-actions">
            <${STRAT_BUTTON_TAG} label="重随机" variant="default" data-action="randomize-appearance" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="重置为品牌默认" variant="default" data-action="reset-appearance" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="error" data-role="name-error" data-error-key="name:${escapeHtml(identity.kind)}" ${errorAttr}>${escapeHtml(error)}</div>
        </div>
      `;
    }

    /**
     * 形象面板（@since v3.10）：预览画布 + **当前预览对象**的部件选择器。
     * @since v3.12（task_032）：「重随机 / 重置为品牌默认」按钮移到了每个 agent 的卡片上
     * （作用对象跟着 data-kind 走，不再挂在面板上）。
     * why 画布宿主是**占位**：真正的宿主元素由屏长期持有（_canvasHost），
     * 重渲染时搬来搬去 —— 见 renderStep 的注释。
     */
    private renderAppearanceGroup(): string {
      const port = this._appearancePort;
      if (!port) {
        return `
          <div class="group" data-group="appearance">
            <div class="group-name">形象预览</div>
            <div class="empty" data-role="appearance-unavailable">形象预览没接上（没有角色合成器）</div>
          </div>
        `;
      }
      const target = this.currentPreviewIdentity();
      if (!target) {
        return `
          <div class="group" data-group="appearance">
            <div class="group-name">形象预览</div>
            <div class="empty" data-role="appearance-empty">没有可预览的角色</div>
          </div>
        `;
      }
      this._canvasHost = this.ensureCanvasHost();
      const error = this._errors.get('appearance') ?? '';
      const errorAttr = error ? '' : 'hidden';
      return `
        <div class="group" data-group="appearance">
          <div class="group-name">形象预览 · ${escapeHtml(target.label)}</div>
          <div class="canvas-slot" data-role="appearance-canvas-slot"></div>
          <div data-role="appearance-controls">${this.renderAppearanceControls()}</div>
          <div class="error" data-role="appearance-error" data-error-key="appearance" ${errorAttr}>${escapeHtml(error)}</div>
        </div>
      `;
    }

    /** 形象选择器（体型 + 各部位变体下拉）—— 数据源 = 当前预览对象的草稿。 */
    private renderAppearanceControls(): string {
      const port = this._appearancePort;
      const target = this.currentPreviewIdentity();
      if (!port || !target) return '';
      const draft = this._appearanceDrafts.get(target.kind);
      const bodyType = draft?.bodyType ?? port.bodyTypes[0] ?? 'male';
      const categories = port.listCategories(bodyType);
      const bodyTypeField = `
        <label class="field">
          <span class="field-name">体型</span>
          <select class="select" data-role="body-type" data-field="body-type">
            ${port.bodyTypes
              .map(
                (item) =>
                  `<option value="${escapeHtml(item)}"${item === bodyType ? ' selected' : ''}>${escapeHtml(item)}</option>`
              )
              .join('')}
          </select>
        </label>`;
      const partFields = categories.map((category) => this.renderAppearanceField(category)).join('');
      return `
        <div class="appearance-fields">${bodyTypeField}${partFields}</div>
        <div class="summary" data-role="appearance-summary">${escapeHtml(this.appearanceSummary(target))}</div>
      `;
    }

    /** 单个部位的下拉框（变体清单来自注入的端口）。 */
    private renderAppearanceField(category: AppearanceCategoryInfo): string {
      const target = this.currentPreviewIdentity();
      const draft = target ? this._appearanceDrafts.get(target.kind) : undefined;
      const current = draft
        ? appearancePartVariant(draft.parts[category.category] ?? '')
        : '';
      const options =
        category.variants.length === 0
          ? '<option value="">（没有可用素材）</option>'
          : category.variants
              .map(
                (variant) =>
                  `<option value="${escapeHtml(variant)}"${variant === current ? ' selected' : ''}>${escapeHtml(variant)}</option>`
              )
              .join('');
      return `
        <label class="field">
          <span class="field-name">${escapeHtml(category.name)}</span>
          <select class="select" data-role="appearance-part" data-field="appearance-part" data-category="${escapeHtml(category.category)}">
            ${options}
          </select>
        </label>`;
    }

    /** 形象摘要（一行文字，给不方便看画布的人留个说法）。 */
    private appearanceSummary(target: MutableIdentity): string {
      const appearance = this._appearanceDrafts.get(target.kind);
      if (!appearance) return '还没选形象';
      const parts = Object.entries(appearance.parts)
        .map(([category, value]) => `${category}:${appearancePartVariant(value)}`)
        .join(' · ');
      return parts.length > 0 ? `${appearance.bodyType} · ${parts}` : appearance.bodyType;
    }

    /** 拿到（或造出）预览画布宿主元素。 */
    private ensureCanvasHost(): HTMLDivElement {
      if (!this._canvasHost) {
        const host = document.createElement('div');
        host.className = 'canvas';
        host.setAttribute('data-role', 'appearance-canvas');
        this._canvasHost = host;
      }
      return this._canvasHost;
    }

    /** 重画选择器（保留焦点：用户正在操作的那个 select 重画后要还能接着用）。 */
    private refreshAppearanceControls(): void {
      const root = this.shadowRoot;
      const container = root?.querySelector('[data-role="appearance-controls"]');
      if (!root || !container) return;
      const active = root.activeElement as HTMLElement | null;
      const activeField = active?.getAttribute('data-field') ?? null;
      const activeCategory = active?.getAttribute('data-category') ?? null;
      container.innerHTML = this.renderAppearanceControls();
      if (!activeField) return;
      const selector = activeCategory
        ? `[data-field="${activeField}"][data-category="${activeCategory}"]`
        : `[data-field="${activeField}"]`;
      const next = root.querySelector(selector) as HTMLElement | null;
      next?.focus();
    }

    /** 只刷新摘要文字（不重画选择器 —— 重画会把用户正在点的下拉框换掉）。 */
    private refreshAppearanceSummary(): void {
      const node = this.shadowRoot?.querySelector('[data-role="appearance-summary"]');
      const target = this.currentPreviewIdentity();
      if (!node || !target) return;
      node.textContent = this.appearanceSummary(target);
    }

    /** ③ 人设生成（@since v3.13，task_043：预设快速开始 + 问卷 + 可改预览 + 脏保护）。 */
    private renderPersona(): string {
      const presetCards = this.renderPresetCards();
      const presetBadge = this.renderPresetBadge();
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
      const regenerateHidden = this._personaDirty ? '' : 'hidden';
      return `
        <div class="group" data-group="persona">
          <div class="group-name">人设生成</div>
          <div class="group-name">快速开始：选一个预设（可再局部修改）</div>
          <div class="preset-row" data-role="preset-row">${presetCards}</div>
          ${presetBadge}
          ${questions}
          <div class="group-name">预览（可以直接改）</div>
          <textarea class="textarea" rows="8" data-role="persona-input" data-field="persona">${escapeHtml(this._persona)}</textarea>
          <div class="persona-tools">
            <button type="button" class="regenerate" data-role="regenerate-persona" data-action="regenerate-persona" ${regenerateHidden}>按问卷重新生成</button>
            <span class="summary">手改后问卷不再自动覆盖；点它按当前答卷重写预览</span>
          </div>
          <div class="error" data-role="persona-error" data-error-key="persona" ${personaErrorAttr}>${escapeHtml(personaError)}</div>
        </div>
      `;
    }

    /** 预设卡片行：名称 + 一句话说明 + 适配 kind 徽标（'any' → 通用）。 */
    private renderPresetCards(): string {
      return PERSONA_PRESETS.map((preset) => {
        const selected = this._activePreset === preset.id;
        const kinds =
          preset.suitableKinds === 'any'
            ? '<span class="preset-kind">通用</span>'
            : preset.suitableKinds
                .map((kind) => `<span class="preset-kind">${escapeHtml(agentKindLabel(kind))}</span>`)
                .join('');
        return `
          <button type="button" class="preset-card" data-role="preset-card" data-action="select-preset"
                  data-preset="${escapeHtml(preset.id)}" data-selected="${selected}">
            <span class="preset-name">${escapeHtml(preset.name)}</span>
            <span class="preset-desc">${escapeHtml(preset.description)}</span>
            <span class="preset-kinds">${kinds}</span>
          </button>
        `;
      }).join('');
    }

    /** 「已用预设」标记；预设态被手改时附注「已手动修改」。 */
    private renderPresetBadge(): string {
      const preset = this.activePreset();
      if (!preset) {
        return '<div class="preset-status" data-role="persona-preset-badge" hidden></div>';
      }
      const modified = this._personaDirty ? ' · 已手动修改' : '（再答问卷将以问卷结果替换）';
      return `<div class="preset-status" data-role="persona-preset-badge">已用预设：${escapeHtml(preset.name)}${modified}</div>`;
    }

    /** 当前生效的预设对象（id 已失效 → null）。 */
    private activePreset(): PersonaPreset | null {
      if (this._activePreset === null) return null;
      return PERSONA_PRESETS.find((candidate) => candidate.id === this._activePreset) ?? null;
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
            <span class="meta" data-role="summary-appearance">${escapeHtml(this.appearanceSummary(identity))}</span>
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

    /**
     * 同步人设工具面的轻量 DOM（预设徽标 / 重新生成按钮 / 卡片选中态）。
     * why 不重画整屏：答题和手改都发生在输入交互中，重画会丢焦点（与 setError 同一理由）。
     */
    private syncPresetSurfaces(): void {
      const root = this.shadowRoot;
      if (!root) return;
      const badge = root.querySelector('[data-role="persona-preset-badge"]');
      if (badge) {
        const preset = this.activePreset();
        if (!preset) {
          badge.setAttribute('hidden', '');
          badge.textContent = '';
        } else {
          const modified = this._personaDirty ? ' · 已手动修改' : '（再答问卷将以问卷结果替换）';
          badge.textContent = `已用预设：${preset.name}${modified}`;
          badge.removeAttribute('hidden');
        }
      }
      const regenerate = root.querySelector('[data-role="regenerate-persona"]');
      if (regenerate) {
        if (this._personaDirty) regenerate.removeAttribute('hidden');
        else regenerate.setAttribute('hidden', '');
      }
      const cards = Array.from(root.querySelectorAll('[data-role="preset-card"]'));
      for (const card of cards) {
        const selected = card.getAttribute('data-preset') === this._activePreset;
        card.setAttribute('data-selected', String(selected));
      }
    }
  }

  customElements.define(ONBOARDING_SCREEN_TAG, OnboardingScreen);
  return OnboardingScreen as unknown as typeof HTMLElement;
}

/** 挂载选项。 */
export interface OnboardingScreenOptions {
  /**
   * 形象预览端口（@since v3.10）。
   * 缺省 = 不带形象功能（向导照常能走完，只是没有 canvas 预览与部件选择器）。
   * 由组合根（app/main/main-entry.ts）注入 —— 屏自己不认识合成器。
   */
  readonly appearance?: AppearancePreviewPort;
}

/**
 * 挂载工厂：本仓库屏 / 面板的统一装配口径（与 mountCharacterScreen 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 * 挂载时机由 app 侧首启逻辑决定（app/main/onboarding-host.ts）。
 */
export function mountOnboardingScreen(
  deps: OnboardingScreenDeps,
  host: HTMLElement,
  options: OnboardingScreenOptions = {}
): () => void {
  defineOnboardingScreen();
  const element = document.createElement(ONBOARDING_SCREEN_TAG) as StratOnboardingScreenElement;
  element.adapter = deps;
  if (options.appearance) element.appearancePort = options.appearance;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订 + 销毁预览实例，订阅与 Phaser 随之释放。
  return () => { element.remove(); };
}
