/**
 * 文件职责：首启向导屏 Web Component（`<strat-onboarding-screen>`）—— 四步引导：
 *   ① 扫描报告（WorldState.detectedAgents：已装高亮 + tier 标签）+ **勾选导入**（@since v3.14，task_044：
 *      可导入行默认全选，只有勾选的 agent 进后续步骤与建档）
 *   ② 逐个已装 agent 起名 + 随机皮肤（可换）+ **每 agent 独立形象**（@since v3.12，task_032：
 *      默认品牌预设 + 可单独改部件 + 规则化重随机 + 重置默认；canvas 预览走路动画）
 *   ③ 人设生成（预设快速开始 + 4 题问答拼装结构化 persona，预览可直接改 + 脏保护）——
 *      **per-agent 独立**（@since v3.14，task_044：人设不再全员共用一份，每个 agent 独立
 *      问卷 / 预设 / 脏保护；预设按 kind 推荐排序，专属预设预填）
 *   ④ 确认 → 逐个 character.create（各带各的 appearance **与 persona**）→ 完成事件。
 *   ★ @since v3.14（task_044）逐个配置化：② ③ 两步顶部有共用的 agent 切换条
 *     （kind 徽标 + 名字 + 已配置✓状态），选中哪个配置哪个 —— 向导从「批量填一份」
 *     改为「逐个初始化」，同一时刻只配置当前选中的 agent。
 *   来源：.long-run-agent/tasks/task_025.md「hud 首启向导屏」；形象能力见 task_028 / task_032；
 *     人设 2.0 见 task_043；逐个配置化见 task_044。
 *   依赖：task_022（detectedAgents）、task_021（character.create 建档口径）、task_024（皮肤库）、
 *   task_027（world/appearance 的 LPC 合成栈，**只经端口消费**）。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力，与 screens / panels 同口径）；
 *   WorldState 快照；注入的形象预览端口（AppearancePreviewPort）。
 * 输出：Shadow DOM 向导屏（覆盖层，z-index 取 modal 档，与 main-screen 的 .hud-sub-screen 同规范）；
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
 *   - 扫描结果（core 广播）→ 扫描报告行；可导入行带勾选框（@since v3.14，task_044：
 *     新探到的默认勾上，用户明确取消过的保持取消）；
 *   - 可建档名单（已装 ∩ AGENT_KINDS ∩ 勾选）→ 第二步的起名条目（名字默认取 agent 显示名）；
 *   - 皮肤由皮肤库抽签器给（可注入 skinSource，测试可确定性复现）；
 *   - 形象草稿是**每 agent 一份**（@since v3.12，task_032）：`Map<kind, AppearanceDraft>`，
 *     初始值 = 注入端口给的默认形象（品牌预设，独立深拷贝）——屏不认识预设库与随机器，
 *     只发意图（preset / randomizeNormal，见 appearance-preview-port.ts）；
 *   - 人设草稿也是**每 agent 一份**（@since v3.14，task_044）：`Map<kind, PersonaDraft>`
 *     （问卷答案 + 人设正文 + 脏标记 + 预设 id）—— 初始值：kind 命中专属预设则预填，
 *     否则留空提示「答问卷或选预设」；预设卡片按当前 agent 的 kind 推荐排序；
 *   - 问卷答案 → 人设模板（core 默认模板打底 + 各题 fragment），预览可改，改过之后不再被答案覆盖；
 *   - 确认页 → 逐条 character.create（各带各的 appearance 与 persona）→ 完成事件。
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
  customAgentIdOf,
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
import type { CustomAgentProbeResult, CustomAgentsPort } from './custom-agents-port';
import {
  CUSTOM_AGENT_OUTPUT_PARSERS,
  CUSTOM_AGENT_PROMPT_PLACEHOLDER,
  isAllowedCustomAgentCmd,
  validateCustomAgentDraft,
  MAX_CUSTOM_AGENT_NAME_LEN,
  type CustomAgentOutputParser,
  type CustomAgentValidationCode,
} from '../../core/custom-agent';
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
} from './onboarding-catalog';
import { PERSONA_PRESETS, presetMatchingKind, presetsForKind, type PersonaPreset } from './persona-presets';
import { zVar } from '../theme/layer-tokens';

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

/**
 * 屏内一个 agent 的人设草稿（@since v3.14，task_044）。
 * why 独立成一份：每个 agent 特长不同，人设不再全员共用 —— 问卷答案 / 预设 / 手改脏保护
 * 都是 per-agent 的（与 _appearanceDrafts 同一 Map 模式）。
 */
interface PersonaDraft {
  /** 问卷答案（题目 id → 选项 id）。 */
  answers: Record<string, string>;
  /** 人设正文（预览区可改）。 */
  persona: string;
  /** 手改过吗：改过之后答案变化不再自动覆盖（显式「按问卷重新生成」才覆盖）。 */
  dirty: boolean;
  /** 当前生效的预设 id（null = 问卷 / 手写模式）。答问卷任一题即退出预设模式。 */
  presetId: string | null;
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
  /**
   * 自定义 agent 注册端口（@since v3.32，task_056）：null = 没有注册面（纯 vite dev /
   * 旧环境），扫描步不显示「+ 添加自定义 agent」入口。注入即生效（非 Electron 环境降级）。
   */
  customAgents: CustomAgentsPort | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 当前步骤。 */
  readonly step: OnboardingStep;
  /** 当前起名 / 皮肤清单（= 已装 ∩ 可建档 ∩ 勾选导入，@since v3.14，task_044）。 */
  readonly identities: readonly OnboardingIdentity[];
  /** 扫描步勾选导入的 kind 集合（@since v3.14，task_044）。 */
  readonly selectedKinds: readonly string[];
  /** 当前 **active agent** 的人设文本（预览区可改后的值；@since v3.14，task_044 起 per-agent）。 */
  readonly persona: string;
  /** 某个 agent 的人设草稿文本（@since v3.14，task_044：人设逐 agent 独立）。 */
  personaOf(kind: string): string;
  /** 当前 active agent 生效的预设 id（null = 没用预设 / 已被问卷或重新生成覆盖）。 */
  readonly personaPresetId: string | null;
  /** 当前 active agent 的人设是否处于手改态（脏：问卷重选不再自动覆写，需显式重新生成）。 */
  readonly personaDirty: boolean;
  /** 当前错误提示（key → 文案）。 */
  readonly errors: Readonly<Record<string, string>>;
  /** 扫描报告行。 */
  readonly scanRows: readonly OnboardingScanRow[];
  /** 某个 agent 选定的形象（没有 → null）。 */
  appearanceOf(kind: string): CharacterAppearance | null;
  /** 当前在预览区展示 / 正在配置的是哪个 agent（null = 没有；@since v3.14，task_044 起即切换条的 active agent）。 */
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
  :host { all: initial; display: block; position: absolute; inset: 0; z-index: ${zVar('modal')}; }
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
  /* agent 切换条（@since v3.14）：identity / persona 两步共用，选中谁配置谁。 */
  .switcher { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
  .switcher-tab {
    display: inline-flex;
    align-items: center;
    gap: var(--srf-spacing-xs);
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    background: var(--srf-panel-elevated);
    color: var(--srf-text);
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    font-family: var(--srf-font-ui);
    font-size: var(--srf-font-size-sm);
    cursor: pointer;
  }
  .switcher-tab[data-active="true"] { border-color: var(--srf-accent); }
  .switcher-title { font-weight: 600; }
  .switcher-status { color: var(--srf-text-muted); }
  .switcher-status[data-done="true"] { color: var(--srf-success); }
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
  /* 预设卡片行（@since v3.13）：横向排列的快速开始入口 */
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
  /* 「推荐」角标（@since v3.14）：suitableKinds 点名当前 agent 的预设。 */
  .preset-recommend {
    color: var(--srf-accent);
    border: var(--srf-border-width) solid var(--srf-accent);
    border-radius: var(--srf-radius);
    padding: 0 var(--srf-spacing-xs);
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
  /* 扫描步勾选导入（@since v3.14） */
  .scan-select { display: inline-flex; align-items: center; gap: var(--srf-spacing-xs); cursor: pointer; }
  /* 确认页逐 agent 人设预览（@since v3.14）：默认折叠，摘要行 = 分节头列表。 */
  .persona-details {
    border: var(--srf-border-width) solid var(--srf-border);
    border-radius: var(--srf-radius);
    padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
    font-size: var(--srf-font-size-sm);
  }
  .persona-details summary { cursor: pointer; color: var(--srf-text-muted); }
  .footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: var(--srf-spacing-sm);
    padding: var(--srf-spacing-sm) var(--srf-spacing-md);
    background: var(--srf-panel);
    border-top: var(--srf-border-width) solid var(--srf-border);
  }
  /* 必填项缺失时的原因（@since v3.10，task_154）——
     禁用态的按钮必须**说清为什么**（task_148 的死按钮语言）：灰着不解释 = 死按钮。 */
  .footer-reason {
    flex: 1 1 auto;
    color: var(--srf-warn);
    font-size: var(--srf-font-size-xs);
    text-align: left;
  }
  .footer-reason[hidden] { display: none; }
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
    /**
     * 每 agent 一份的人设草稿（@since v3.14，task_044）。
     * key = agent kind —— 人设不再全员共用一份：每个 agent 的问卷答案 / 预设 / 手改脏保护
     * 都独立（_appearanceDrafts 同模式）。初始值：kind 命中专属预设 → 预填该预设；
     * 否则留空（渲染时提示「答问卷或选预设」）。
     */
    private _personaDrafts = new Map<string, PersonaDraft>();
    /**
     * identity / persona 两步共用的当前 agent（@since v3.14，task_044）。
     * 切换条选中谁就配置谁；identity 步的形象画布也跟着它走（并入原 _previewKind 的职责）。
     */
    private _activeAgentKey: string | null = null;
    /** 扫描步勾选导入的 kind（@since v3.14，task_044）。 */
    private _selectedKinds = new Set<string>();
    /** 见过的可导入 kind：区分「新探到的默认勾选」与「用户明确取消过的保持取消」。 */
    private _knownKinds = new Set<string>();
    /** 错误提示：key → 文案。 */
    private _errors = new Map<string, string>();
    /** 已提交（防重复发命令）。 */
    private _submitted = false;    /** 上次渲染时的扫描结果签名（避免无关广播反复重画扫描步）。 */
    private _lastScanSignature: string | null = null;
    // —— 自定义 agent 注册（@since v3.32，task_056）——
    /** 注册端口注入位；null = 无注册面（扫描步不显示入口）。 */
    private _customAgents: CustomAgentsPort | null = null;
    /** 注册表单开合（默认收起，点「+ 添加」展开）。 */
    private _customFormOpen = false;
    /** 表单收集值（逐 key 存：广播重画扫描步时从它回填，输入不丢）。 */
    private _customDraft: { name: string; probeCmd: string; runCmdTemplate: string; outputParser: CustomAgentOutputParser } = {
      name: '',
      probeCmd: '',
      runCmdTemplate: '',
      outputParser: 'plain',
    };
    /** 「测试」按钮的探测结论回显（null = 还没测）。 */
    private _customProbeResult: CustomAgentProbeResult | null = null;
    /** 「测试 / 注册」在飞（防双击）。 */
    private _customBusy = false;
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

    get customAgents(): CustomAgentsPort | null { return this._customAgents; }
    set customAgents(value: CustomAgentsPort | null) {
      this._customAgents = value;
      // 端口没了（降级）：收起表单，别留下一个点了没反应的入口。
      if (!value) this._customFormOpen = false;
      if (this.isConnected) this.renderStep();
    }

    get step(): OnboardingStep { return this._step; }
    get identities(): readonly OnboardingIdentity[] { return this._identities; }
    get selectedKinds(): readonly string[] { return [...this._selectedKinds]; }
    get persona(): string { return this.activePersonaDraft()?.persona ?? ''; }
    get personaPresetId(): string | null { return this.activePersonaDraft()?.presetId ?? null; }
    get personaDirty(): boolean { return this.activePersonaDraft()?.dirty ?? false; }
    get errors(): Readonly<Record<string, string>> {
      return Object.fromEntries(this._errors.entries());
    }
    get scanRows(): readonly OnboardingScanRow[] { return resolveScanRows(this._state); }
    get previewKind(): string | null { return this._activeAgentKey; }

    appearanceOf(kind: string): CharacterAppearance | null {
      return this._appearanceDrafts.get(kind) ?? null;
    }

    personaOf(kind: string): string {
      return this._personaDrafts.get(kind)?.persona ?? '';
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
        case 'scan': {
          // 勾选同步（新探到的默认勾上）+ 误操作防护：有可导入项却一个没勾 → 拦在原地。
          this.syncSelectionFromScan();
          const bindable = resolveBindableKinds(this._state);
          if (bindable.length > 0 && this._selectedKinds.size === 0) {
            this.setError('scan-selection', '至少勾选一个要导入的 agent（或点「跳过引导」结束）');
            return;
          }
          this.setError('scan-selection', null);
          this.syncIdentities();
          this._step = 'identity';
          // 进第②步时补一次"素材就绪后回填"：初始化时没取到默认形象的条目等 whenReady 后补上。
          this.awaitAppearanceReady();
          break;
        }
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
        // 各 agent 的人设草稿（@since v3.14，task_044）：从各自草稿取；留空 → core 套默认模板。
        const persona = (this._personaDrafts.get(identity.kind)?.persona ?? '').trim();
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
     * 同步起名清单：按「可建档名单 ∩ 勾选导入」重建（@since v3.14，task_044：未勾选的不进名单）。
     * 已存在的条目保留（用户改过的名字不能丢），名单里新增的补默认名与随机皮肤，消失的移除。
     * 形象草稿同步维护（@since v3.12，task_032）：新增的 kind 补默认形象（独立深拷贝），
     * 消失的 kind 连草稿一起清（不留死数据）；人设草稿同理（@since v3.14，task_044）。
     */
    private syncIdentities(): void {
      const kinds = resolveBindableKinds(this._state).filter((kind) => this._selectedKinds.has(kind));
      const existing = new Map(this._identities.map((item) => [item.kind, item] as const));
      // 扫描行的显示名（@since v3.32，task_056）：自定义注册的名字在注册表里，
      // 随检测行的 label 广播进来 —— 起名默认值用注册名，别拿 slug 糊弄用户。
      const rowLabels = new Map(resolveScanRows(this._state).map((row) => [row.kind, row.label] as const));
      this._identities = kinds.map((kind) => {
        const previous = existing.get(kind);
        if (previous) return previous;
        const label = rowLabels.get(kind) ?? agentKindLabel(kind);
        return {
          kind,
          label,
          name: label,
          skinId: this.pickSkin(),
        };
      });
      // 形象草稿：每个 kind 一份独立深拷贝的默认形象（品牌预设；取不到的等素材就绪后补）。
      const fresh = createAppearanceDrafts(
        kinds.filter((kind) => !this._appearanceDrafts.has(kind)),
        (kind) => this._appearancePort?.preset(kind) ?? null
      );
      for (const [kind, draft] of fresh) this._appearanceDrafts.set(kind, draft);
      // 人设草稿：每个勾选的 kind 一份（初始值 = 专属预设预填 / 留空待问卷，见 createPersonaDraft）。
      for (const kind of kinds) {
        if (!this._personaDrafts.has(kind)) this._personaDrafts.set(kind, this.createPersonaDraft(kind));
      }
      // 名单里消失的 kind（被取消勾选 / 卸载）：形象与人设草稿一并清掉（不留死数据）。
      const liveKinds = kinds as readonly string[];
      for (const kind of [...this._appearanceDrafts.keys()]) {
        if (!liveKinds.includes(kind)) this._appearanceDrafts.delete(kind);
      }
      for (const kind of [...this._personaDrafts.keys()]) {
        if (!liveKinds.includes(kind)) this._personaDrafts.delete(kind);
      }
      // 切换条的当前 agent 没了（被取消勾选）→ 换到第一个。
      if (!this._identities.some((item) => item.kind === this._activeAgentKey)) {
        this._activeAgentKey = this._identities[0]?.kind ?? null;
      }
    }

    /** 抽一套皮肤（默认走皮肤库；注入 skinSource 时用注入的）。 */
    private pickSkin(): SkinId {
      const source = this._skinSource ?? ((): SkinDefinition => randomSkin());
      return source().id;
    }

    /** 当前配置 / 预览的是哪个 agent（没定 → 第一个；@since v3.14，task_044 起即切换条的 active agent）。 */
    private currentPreviewIdentity(): MutableIdentity | null {
      if (this._identities.length === 0) return null;
      const found = this._identities.find((item) => item.kind === this._activeAgentKey);
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
    /**
     * 切换条选中某个 agent（@since v3.14，task_044）：identity 步 = 换正在配置 / 预览的形象；
     * persona 步 = 换正在填写的人设草稿。整步重渲染（表单内容随 active agent 整体切换）。
     */
    private selectAgent(kind: string): void {
      if (!this._identities.some((item) => item.kind === kind)) return;
      this._activeAgentKey = kind;
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
      // 名字改了就把这条的错误提示撤掉（别让旧报错挂在已经改好的输入框下面），
      // 并轻量同步切换条上的标题与「已配置」状态（不重画，保住正在输入的焦点）。
      this.setError(`name:${kind}`, null);
      this.refreshSwitcherTab(kind);
      // task_154：名字一变 → 页脚主按钮的可用性与原因跟着变（禁用态要说清为什么）。
      this.refreshFooter();
    }

    /** 校验全部名字（空 / 超长 / 重复）。 */
    private validateIdentities(): boolean {
      const names = this._identities.map((item) => item.name);
      const duplicated = new Set(findDuplicateNames(names));
      let ok = true;
      let firstFailing: string | null = null;
      for (const identity of this._identities) {
        const result = validateAgentName(identity.name);
        if (result.ok && duplicated.has(result.value)) {
          this.setError(`name:${identity.kind}`, NAME_ERROR_MESSAGES['duplicate-name']);
          if (firstFailing === null) firstFailing = identity.kind;
          ok = false;
          continue;
        }
        if (!result.ok) {
          this.setError(`name:${identity.kind}`, NAME_ERROR_MESSAGES[result.code ?? 'empty-name']);
          if (firstFailing === null) firstFailing = identity.kind;
          ok = false;
          continue;
        }
        identity.name = result.value;
        this.setError(`name:${identity.kind}`, null);
      }
      // 逐个配置后出错的卡片可能不在屏上（@since v3.14，task_044）：切到第一个出错的 agent 让用户看见错误。
      if (!ok && firstFailing !== null && firstFailing !== this._activeAgentKey) {
        this._activeAgentKey = firstFailing;
        this.renderStep();
      }
      return ok;
    }

    // —— 人设（@since v3.14，task_044：per-agent 独立草稿，全部作用于当前 active agent）——
    /** 当前 active agent 的人设草稿（没有 → null）。 */
    private activePersonaDraft(): PersonaDraft | null {
      return this._activeAgentKey ? this._personaDrafts.get(this._activeAgentKey) ?? null : null;
    }

    /** 初始化一份人设草稿：kind 命中专属预设 → 预填该预设；否则留空（用户答问卷或选预设）。 */
    private createPersonaDraft(kind: string): PersonaDraft {
      const preset = presetMatchingKind(kind);
      if (preset) {
        return { answers: {}, persona: preset.persona, dirty: false, presetId: preset.id };
      }
      return { answers: {}, persona: '', dirty: false, presetId: null };
    }

    /**
     * 记录一个答案（作用在 active agent 的草稿上）。
     * 答题即退出预设模式（预设被问卷结果替换是用户可预期的切换：问卷是主路径）；
     * 该 agent 没手改过人设时同步刷新预览，手改过（脏）则只记答案不覆盖（见「按问卷重新生成」）。
     */
    private answer(questionId: string, optionId: string): void {
      const kind = this._activeAgentKey;
      const draft = this.activePersonaDraft();
      if (!kind || !draft) return;
      const wasPreset = draft.presetId !== null;
      draft.answers[questionId] = optionId;
      draft.presetId = null;
      this.setError(`answer:${kind}:${questionId}`, null);
      if (wasPreset) this.syncPresetSurfaces();
      if (!draft.dirty) {
        draft.persona = buildPersona({ ...draft.answers });
        this.syncPersonaField();
      }
      this.refreshSwitcherTab(kind);
    }

    /** 用户手改人设：记为脏（之后答案变化不再自动覆盖），并点亮「按问卷重新生成」。 */
    private setPersona(text: string): void {
      const kind = this._activeAgentKey;
      const draft = this.activePersonaDraft();
      if (!kind || !draft) return;
      draft.persona = text;
      draft.dirty = true;
      this.setError(`persona:${kind}`, null);
      this.syncPresetSurfaces();
      this.refreshSwitcherTab(kind);
    }

    /**
     * 选中预设（作用在 active agent 的草稿上）：问卷清空 + 预览填预设全文 + 标记「已用预设」。
     * 预设选中视为显式覆写（清脏）——手改过的文本会被预设替换，这是用户明确的动作。
     */
    private selectPreset(presetId: string): void {
      const kind = this._activeAgentKey;
      const draft = this.activePersonaDraft();
      const preset = PERSONA_PRESETS.find((candidate) => candidate.id === presetId);
      if (!kind || !draft || !preset) return;
      draft.answers = {};
      draft.presetId = preset.id;
      draft.persona = preset.persona;
      draft.dirty = false;
      this.setError(`persona:${kind}`, null);
      // 预设路径不需要答完问卷：之前因未答被拦的错误一并撒掉。
      for (const question of PERSONA_QUESTIONS) this.setError(`answer:${kind}:${question.id}`, null);
      this.renderStep();
    }

    /** 「按问卷重新生成」：显式覆写手改文本 = 按当前答卷重算（清脏、退出预设态）。 */
    private regeneratePersona(): void {
      const kind = this._activeAgentKey;
      const draft = this.activePersonaDraft();
      if (!kind || !draft) return;
      draft.persona = buildPersona({ ...draft.answers });
      draft.dirty = false;
      draft.presetId = null;
      this.setError(`persona:${kind}`, null);
      this.syncPersonaField();
      this.syncPresetSurfaces();
      this.refreshSwitcherTab(kind);
    }

    /** 校验人设步（@since v3.14，task_044：逐 agent 校验）：问卷路径要答全；预设路径免答；长度两路都查。 */
    private validatePersonaStep(): boolean {
      let ok = true;
      let firstFailing: string | null = null;
      for (const identity of this._identities) {
        const draft = this._personaDrafts.get(identity.kind);
        if (!draft) continue;
        if (!this.validatePersonaDraft(identity.kind, draft)) {
          if (firstFailing === null) firstFailing = identity.kind;
          ok = false;
        }
      }
      // 没配置好的 agent 可能不在屏上：切到第一个未配置的，让用户直接看到错误在哪。
      if (!ok && firstFailing !== null && firstFailing !== this._activeAgentKey) {
        this._activeAgentKey = firstFailing;
        this.renderStep();
      }
      return ok;
    }

    /** 校验单个 agent 的人设草稿（返回值 = 合法）：预设路径免答问卷；问卷路径答全；长度两路都查。 */
    private validatePersonaDraft(kind: string, draft: PersonaDraft): boolean {
      let ok = true;
      if (draft.presetId === null) {
        for (const questionId of missingPersonaAnswers(draft.answers)) {
          this.setError(`answer:${kind}:${questionId}`, '这一题还没选');
          ok = false;
        }
      }
      const persona = validatePersona(draft.persona);
      if (!persona.ok) {
        this.setError(`persona:${kind}`, PERSONA_ERROR_MESSAGES[persona.code ?? 'persona-too-long']);
        ok = false;
      } else {
        draft.persona = persona.value;
        this.setError(`persona:${kind}`, null);
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
        case 'select-agent':
          // 切换条选中某个 agent（@since v3.14，task_044）：identity / persona 两步共用。
          this.selectAgent(action.getAttribute('data-kind') ?? '');
          return;
        case 'select-preset':
          this.selectPreset(action.getAttribute('data-preset') ?? '');
          return;
        case 'regenerate-persona':
          this.regeneratePersona();
          return;
        // —— 自定义 agent 注册（@since v3.32，task_056）——
        case 'custom-toggle-form':
          this._customFormOpen = !this._customFormOpen;
          this._customProbeResult = null;
          this.setError('custom-form', null);
          this.renderStep();
          return;
        case 'custom-test-probe':
          this.runCustomProbe();
          return;
        case 'custom-register':
          this.submitCustomRegistration();
          return;
        case 'custom-cancel':
          this._customFormOpen = false;
          this._customProbeResult = null;
          this.setError('custom-form', null);
          this.renderStep();
          return;
        case 'custom-remove':
          this.removeCustomRegistration(action.getAttribute('data-id') ?? '');
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
        return;
      }
      // 自定义注册表单（@since v3.32，task_056）：值只进屏内草稿，不重画（广播重画时从草稿回填）。
      if (field === 'custom-name') {
        this._customDraft.name = target.value;
        return;
      }
      if (field === 'custom-probe-cmd') {
        this._customDraft.probeCmd = target.value;
        return;
      }
      if (field === 'custom-template') {
        this._customDraft.runCmdTemplate = target.value;
        return;
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
      // 扫描步勾选导入（@since v3.14，task_044）：勾选状态存 _selectedKinds，重画时从它取值。
      if (field === 'scan-select') {
        const kind = target.getAttribute('data-kind') ?? '';
        if (kind) {
          if ((target as HTMLInputElement).checked) this._selectedKinds.add(kind);
          else this._selectedKinds.delete(kind);
        }
        this.setError('scan-selection', null);
        this.refreshScanSummary();
        return;
      }
      // 形象选择器（@since v3.10）：体型 / 部位变体。
      if (field === 'body-type') {
        this.setBodyType(target.value);
        return;
      }
      if (field === 'appearance-part') {
        this.setAppearancePart(target.getAttribute('data-category') ?? '', target.value);
        return;
      }
      // 自定义注册表单的解析器下拉（@since v3.32，task_056）。change 才落地（不打断输入节奏）。
      if (field === 'custom-parser') {
        this._customDraft.outputParser = target.value === 'json' ? 'json' : 'plain';
        return;
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

    /** ① 扫描报告（@since v3.14，task_044：可导入行带勾选框，只有勾选的进后续步骤）。 */
    private renderScan(): string {
      // 新探到的可导入 kind 默认勾上（用户明确取消过的保持取消）。
      this.syncSelectionFromScan();
      const rows = resolveScanRows(this._state);
      const installed = rows.filter((row) => row.installed).length;
      const bindable = resolveBindableKinds(this._state);
      const status = resolveScanStatus(this._state);
      const list =
        rows.length === 0
          ? `<div class="empty" data-role="scan-empty">${this._state ? '还没探测到本机 agent：确认 PATH 里装了 CLI 后重进向导' : '正在等扫描结果…'}</div>`
          : `<ul class="rows">${rows.map((row) => this.renderScanRow(row)).join('')}</ul>`;
      // 扫描没跑完时的提醒：检测是逐条推送的，此刻点下一步只会给**已探到的** agent 建档。
      const pendingHint = status.complete
        ? ''
        : `<div class="hint" data-role="scan-pending">扫描还没结束：现在继续只会为已探到的 agent 建档（可以回到这一步补齐）</div>`;
      const selectionSummary = bindable.length > 0
        ? `<div class="summary" data-role="scan-selected-summary">${escapeHtml(this.scanSelectedSummaryText())}</div>`
        : '';
      const selectionError = this._errors.get('scan-selection') ?? '';
      const selectionErrorAttr = selectionError ? '' : 'hidden';
      return `
        <div class="group" data-group="scan">
          <div class="group-name">扫描报告</div>
          <div class="summary" data-role="scan-status" data-complete="${status.complete}">${escapeHtml(status.text)}</div>
          <div class="summary" data-role="scan-summary">探测到 ${rows.length} 个 agent · 确认已装 ${installed} 个 · 可建档 ${bindable.length} 个</div>
          ${selectionSummary}
          ${pendingHint}
          ${list}
          <div class="error" data-role="scan-selection-error" data-error-key="scan-selection" ${selectionErrorAttr}>${escapeHtml(selectionError)}</div>
        </div>
        ${this.renderCustomAgentGroup()}
      `;
    }

    private renderScanRow(row: OnboardingScanRow): string {
      const version = row.version ? `v${row.version}` : '版本未知';
      const chip = row.bindable ? '' : '<span class="chip" data-role="only-probe">仅探测</span>';
      // 勾选框只给「真能导入」的行（已装 ∩ 可建档）；仅探测 / 未确认安装的行没有可勾的东西。
      const selector = row.installed && row.bindable
        ? `<label class="scan-select"><input type="checkbox" data-role="scan-select" data-field="scan-select" data-kind="${escapeHtml(row.kind)}"${this._selectedKinds.has(row.kind) ? ' checked' : ''}><span>导入</span></label>`
        : '';
      // 自定义注册行带「移除注册」（@since v3.32，task_056）：删的是注册行不是角色 ——
      // 已建角色档案保留（kind 还在，只是不再探测）。注册端口不在（降级）时只能看不能删。
      const customId = customAgentIdOf(row.kind);
      const removeButton = customId !== null && this._customAgents
        ? `<${STRAT_BUTTON_TAG} label="移除注册" variant="default" data-action="custom-remove" data-id="${escapeHtml(customId)}"></${STRAT_BUTTON_TAG}>`
        : '';
      return `
        <li class="row" data-role="scan-row" data-kind="${escapeHtml(row.kind)}"
            data-installed="${row.installed}" data-bindable="${row.bindable}">
          ${selector}
          <span class="row-name">${escapeHtml(row.label)}</span>
          <span class="tier" data-role="tier">${escapeHtml(TIER_LABELS[row.tier])}</span>
          <span class="status" data-role="status">${escapeHtml(DETECTION_STATUS_LABELS[row.status])}</span>
          <span class="meta">${escapeHtml(version)}</span>
          ${chip}
          ${removeButton}
        </li>
      `;
    }

    /**
     * 勾选同步：把新探到的可导入 kind 默认勾上。
     * why 记 _knownKinds：区分「第一次见到（默认勾选）」与「用户明确取消过（保持取消）」——
     * 检测是逐条推送的，扫描中途新出现的 kind 不该把用户刚取消的又勾回来。
     */
    private syncSelectionFromScan(): void {
      for (const kind of resolveBindableKinds(this._state)) {
        if (this._knownKinds.has(kind)) continue;
        this._knownKinds.add(kind);
        this._selectedKinds.add(kind);
      }
    }

    /** 扫描步的勾选摘要文案。 */
    private scanSelectedSummaryText(): string {
      const bindable = resolveBindableKinds(this._state);
      const selected = bindable.filter((kind) => this._selectedKinds.has(kind)).length;
      return `勾选导入 ${selected} / ${bindable.length} 个可建档 agent（后续步骤只配置勾选项）`;
    }

    /** 勾选变化后轻量刷新摘要行（不重画整步：勾选框自身的 DOM 状态已经是正确的）。 */
    private refreshScanSummary(): void {
      const node = this.shadowRoot?.querySelector('[data-role="scan-selected-summary"]');
      if (node) node.textContent = this.scanSelectedSummaryText();
    }

    // —— 自定义 agent 注册（@since v3.32，task_056）：扫描步内联表单 ——
    /** 注册表单的错误码 → 内联文案（机器可读码 → 人话，本屏内集中一份）。 */
    private customFormErrorText(code: CustomAgentValidationCode | 'duplicate' | 'port-error', error?: string): string {
      switch (code) {
        case 'empty-name': return '名字不能为空';
        case 'name-too-long': return `名字超过 ${MAX_CUSTOM_AGENT_NAME_LEN} 个字符`;
        case 'empty-id': return '名字里至少要有一个字母或数字（注册 id 由名字派生）';
        case 'empty-probe-cmd': return '探测命令不能为空';
        case 'cmd-too-long': return '命令超过 200 个字符';
        case 'cmd-invalid-chars': return '命令含白名单外字符（只许字母数字、空格与 - _ . / : = @ % + ,）';
        case 'empty-template': return '执行模板不能为空';
        case 'template-missing-prompt': return `执行模板里必须有 ${CUSTOM_AGENT_PROMPT_PLACEHOLDER} 占位符`;
        case 'template-duplicate-prompt': return `执行模板里只能有一个 ${CUSTOM_AGENT_PROMPT_PLACEHOLDER} 占位符`;
        case 'template-no-binary': return '执行模板要以可执行文件名开头';
        case 'unknown-parser': return '解析器只能是 plain 或 json';
        case 'duplicate': return error ?? '注册已存在（名字或 id 重复）';
        default: return error ?? '注册失败，稍后再试';
      }
    }

    /** 扫描步的注册入口组：没注入端口 → 整组不渲染（降级而非报错）。 */
    private renderCustomAgentGroup(): string {
      if (!this._customAgents) return '';
      const open = this._customFormOpen;
      const form = open ? this.renderCustomAgentForm() : '';
      return `
        <div class="group" data-group="custom-agent">
          <div class="group-name">自定义 agent</div>
          <div class="summary">内置清单外的 CLI 手动注册成战场单位：探测命令 exit 0 = 在装；执行模板用 ${escapeHtml(CUSTOM_AGENT_PROMPT_PLACEHOLDER)} 占位对话输入。已注册的行进上面的扫描列表（可勾选导入，配置流程同内置）。</div>
          <${STRAT_BUTTON_TAG} label="${open ? '收起表单' : '+ 添加自定义 agent'}" variant="default" data-action="custom-toggle-form"></${STRAT_BUTTON_TAG}>
          ${form}
        </div>
      `;
    }

    /** 注册表单本体：三输入 + 解析器下拉 + 测试 / 注册 / 取消。值从 _customDraft 回填（广播重画不丢输入）。 */
    private renderCustomAgentForm(): string {
      const draft = this._customDraft;
      const error = this._errors.get('custom-form') ?? '';
      const errorAttr = error ? '' : 'hidden';
      const probe = this._customProbeResult;
      const probeText = probe
        ? probe.ok
          ? `${probe.installed ? '✓ 探测通过（exit 0）' : `✗ 探测未过（exit ${String(probe.exitCode)}）`}${probe.stdout ? `：${probe.stdout.trim().slice(0, 120)}` : probe.stderr ? `：${probe.stderr.trim().slice(0, 120)}` : ''}`
          : `探测失败：${probe.error ?? '未知错误'}`
        : '';
      const probeAttr = probeText ? '' : 'hidden';
      const busy = this._customBusy;
      const parserOptions = CUSTOM_AGENT_OUTPUT_PARSERS.map((parser) => {
        const selected = parser === draft.outputParser ? ' selected' : '';
        const hint = parser === 'plain' ? 'plain（整段输出当回答）' : 'json（提取 text/content/output 字段）';
        return `<option value="${parser}"${selected}>${hint}</option>`;
      }).join('');
      return `
        <div class="identity" data-role="custom-form">
          <label class="option" for="custom-name">名字（注册 id 由名字派生）</label>
          <input class="input" type="text" id="custom-name" data-role="custom-name" data-field="custom-name" value="${escapeHtml(draft.name)}" placeholder="例如 MyAgent">
          <label class="option" for="custom-probe">探测命令（跑一遍 exit 0 = 在装）</label>
          <input class="input" type="text" id="custom-probe" data-role="custom-probe-cmd" data-field="custom-probe-cmd" value="${escapeHtml(draft.probeCmd)}" placeholder="例如 myagent --version">
          <label class="option" for="custom-template">执行模板（${escapeHtml(CUSTOM_AGENT_PROMPT_PLACEHOLDER)} 会被替换成对话输入）</label>
          <input class="input" type="text" id="custom-template" data-role="custom-template" data-field="custom-template" value="${escapeHtml(draft.runCmdTemplate)}" placeholder="例如 myagent ask ${escapeHtml(CUSTOM_AGENT_PROMPT_PLACEHOLDER)}">
          <label class="option" for="custom-parser">输出解析器</label>
          <select class="input" id="custom-parser" data-role="custom-parser" data-field="custom-parser">${parserOptions}</select>
          <div class="appearance-actions">
            <${STRAT_BUTTON_TAG} label="${busy ? '测试中…' : '测试'}" variant="default" data-action="custom-test-probe"${busy ? ' disabled' : ''}></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="${busy ? '注册中…' : '注册'}" variant="primary" data-action="custom-register"${busy ? ' disabled' : ''}></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="取消" variant="default" data-action="custom-cancel"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="hint" data-role="custom-probe-result" ${probeAttr}>${escapeHtml(probeText)}</div>
          <div class="error" data-role="custom-form-error" data-error-key="custom-form" ${errorAttr}>${escapeHtml(error)}</div>
        </div>
      `;
    }

    /** 轻量刷新测试结论节点（不动表单：焦点在输入里，重画会打断输入）。 */
    private refreshCustomProbeResult(): void {
      const node = this.shadowRoot?.querySelector('[data-role="custom-probe-result"]');
      if (!node) return;
      const probe = this._customProbeResult;
      const text = probe
        ? probe.ok
          ? `${probe.installed ? '✓ 探测通过（exit 0）' : `✗ 探测未过（exit ${String(probe.exitCode)}）`}${probe.stdout ? `：${probe.stdout.trim().slice(0, 120)}` : probe.stderr ? `：${probe.stderr.trim().slice(0, 120)}` : ''}`
          : `探测失败：${probe.error ?? '未知错误'}`
        : '';
      if (text) {
        node.removeAttribute('hidden');
        node.textContent = text;
      } else {
        node.setAttribute('hidden', '');
        node.textContent = '';
      }
    }

    /** 跑「测试」：探一遍当前表单里的探测命令，结论回显（不落库）。 */
    private runCustomProbe(): void {
      const port = this._customAgents;
      if (!port || this._customBusy) return;
      // 「测试」只要求探测命令本身合法（名字 / 模板可以先不填 —— 用户可能只想先验命令）；
      // 合法性判据与注册面同一份（core 的白名单纯函数，不另抄口径）。
      const probeCmd = this._customDraft.probeCmd.trim();
      if (!isAllowedCustomAgentCmd(probeCmd)) {
        this.setError('custom-form', '探测命令非法：不能为空、不能超过 200 字符，且只许字母数字、空格与 - _ . / : = @ % + ,');
        this.refreshCustomFormError();
        return;
      }
      this._customBusy = true;
      this.setError('custom-form', null);
      port
        .probe(probeCmd)
        .then((result) => {
          this._customProbeResult = result;
        })
        .catch((error: unknown) => {
          this._customProbeResult = { ok: false, error: error instanceof Error ? error.message : String(error) };
        })
        .finally(() => {
          this._customBusy = false;
          this.refreshCustomProbeResult();
        });
    }

    /** 提交注册：本地校验 → 端口落库 → 成功收表单（新行随检测广播自然出现在扫描列表）。 */
    private submitCustomRegistration(): void {
      const port = this._customAgents;
      if (!port || this._customBusy) return;
      const validation = validateCustomAgentDraft({ ...this._customDraft });
      if (!validation.ok) {
        this.setError('custom-form', this.customFormErrorText(validation.code));
        this.refreshCustomFormError();
        return;
      }
      this._customBusy = true;
      this.setError('custom-form', null);
      port
        .create({ ...validation.draft })
        .then((result) => {
          if (result.ok) {
            // 成功：收表单清草稿；探测行由主进程并入快照广播进来（勾选默认选上，
            // syncSelectionFromScan 的「新探到的默认勾选」口径对自定义行同样适用）。
            this._customFormOpen = false;
            this._customDraft = { name: '', probeCmd: '', runCmdTemplate: '', outputParser: 'plain' };
            this._customProbeResult = null;
            this.renderStep();
          } else if (result.code) {
            this.setError('custom-form', this.customFormErrorText(result.code, result.error));
            this.refreshCustomFormError();
          } else {
            // 主进程侧的查重 / 上限拒了（人话 error）。
            this.setError('custom-form', result.error ?? '注册失败，稍后再试');
            this.refreshCustomFormError();
          }
        })
        .catch((error: unknown) => {
          this.setError('custom-form', error instanceof Error ? error.message : String(error));
          this.refreshCustomFormError();
        })
        .finally(() => {
          this._customBusy = false;
        });
    }

    /** 移除一条注册：断的是检测行，角色档案保留（task_056 规格⑤；扫描行随广播消失）。 */
    private removeCustomRegistration(id: string): void {
      const port = this._customAgents;
      if (!port) return;
      void port
        .remove(id)
        .then((result) => {
          if (!result.ok) {
            this.setError('custom-form', result.error ?? '移除失败');
            this.refreshCustomFormError();
          }
        })
        .catch((error: unknown) => {
          this.setError('custom-form', error instanceof Error ? error.message : String(error));
          this.refreshCustomFormError();
        });
    }

    /** 轻量刷新表单错误节点（不打断输入焦点）。 */
    private refreshCustomFormError(): void {
      const node = this.shadowRoot?.querySelector('[data-role="custom-form-error"]');
      if (!node) return;
      const text = this._errors.get('custom-form') ?? '';
      if (text) {
        node.removeAttribute('hidden');
        node.textContent = text;
      } else {
        node.setAttribute('hidden', '');
        node.textContent = '';
      }
    }

    /** ② 起名 + 皮肤 + 形象（@since v3.14，task_044：逐个配置 —— 切换条 + 当前 agent 的单卡）。 */
    private renderIdentity(): string {
      if (this._identities.length === 0) {
        return `
          <div class="group" data-group="identity">
            <div class="group-name">起名与皮肤</div>
            <div class="empty" data-role="identity-empty">没有勾选导入的已装 agent：回到上一步勾选，或装好一个 T1 agent（Claude Code / Codex / OpenCode / Kimi / OpenClaw）后再回来</div>
          </div>
        `;
      }
      const active = this.currentPreviewIdentity();
      if (!active) return '';
      return `
        ${this.renderAgentSwitcher()}
        <div class="group" data-group="identity">
          <div class="group-name">起名与皮肤</div>
          ${this.renderIdentityRow(active)}
        </div>
        ${this.renderAppearanceGroup()}
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
          <div class="appearance-actions">
            <${STRAT_BUTTON_TAG} label="重随机" variant="default" data-action="randomize-appearance" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="重置为品牌默认" variant="default" data-action="reset-appearance" data-kind="${escapeHtml(identity.kind)}"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="error" data-role="name-error" data-error-key="name:${escapeHtml(identity.kind)}" ${errorAttr}>${escapeHtml(error)}</div>
        </div>
      `;
    }

    /**
     * agent 切换条（@since v3.14，task_044）：identity / persona 两步共用。
     * kind 徽标（皮肤色点 + 显示名）+ 名字 + 已配置✓状态；选中谁配置谁。
     * 「已配置」按当前步骤判定（identity = 名字合法；persona = 预设生效或问卷答全）。
     */
    private renderAgentSwitcher(): string {
      const tabs = this._identities.map((identity) => {
        const active = identity.kind === this._activeAgentKey;
        const done = this.agentConfigured(identity);
        return `
          <button type="button" class="switcher-tab" data-role="agent-tab" data-action="select-agent"
                  data-kind="${escapeHtml(identity.kind)}" data-active="${active}" data-done="${done}">
            <span class="badge" style="--srf-badge-accent: ${resolveAccent(identity.skinId)}"></span>
            <span class="switcher-title" data-role="agent-title">${escapeHtml(this.switcherTitle(identity))}</span>
            <span class="switcher-status" data-role="agent-status" data-done="${done}">${done ? '✓ 已配置' : '未配置'}</span>
          </button>
        `;
      }).join('');
      return `<div class="switcher" data-role="agent-switcher">${tabs}</div>`;
    }

    /** 切换条标题：kind 显示名（用户改过角色名则附在后面，没改就不重复）。 */
    private switcherTitle(identity: MutableIdentity): string {
      const name = identity.name.trim();
      return name && name !== identity.label ? `${identity.label} · ${name}` : identity.label;
    }

    /** 切换条的「已配置」判定（按当前步骤取口径）。 */
    private agentConfigured(identity: MutableIdentity): boolean {
      if (this._step === 'persona') return this.personaConfigured(identity.kind);
      return validateAgentName(identity.name).ok;
    }

    /** 人设步的「已配置」判定：预设生效（免问卷）或问卷答全。 */
    private personaConfigured(kind: string): boolean {
      const draft = this._personaDrafts.get(kind);
      if (!draft) return false;
      if (draft.presetId !== null) return true;
      return missingPersonaAnswers(draft.answers).length === 0;
    }

    /** 轻量刷新切换条某个 tab 的标题与配置状态（不重画整步：保住正在输入的焦点）。 */
    private refreshSwitcherTab(kind: string): void {
      const tab = this.shadowRoot?.querySelector(`[data-role="agent-tab"][data-kind="${kind}"]`);
      const identity = this._identities.find((item) => item.kind === kind);
      if (!tab || !identity) return;
      const title = tab.querySelector('[data-role="agent-title"]');
      if (title) title.textContent = this.switcherTitle(identity);
      const done = this.agentConfigured(identity);
      tab.setAttribute('data-done', String(done));
      const status = tab.querySelector('[data-role="agent-status"]');
      if (status) {
        status.setAttribute('data-done', String(done));
        status.textContent = done ? '✓ 已配置' : '未配置';
      }
    }

    /**
     * 形象面板（@since v3.10）：预览画布 + **当前预览对象**（= 切换条的 active agent，task_044）的部件选择器。
     * @since v3.12（task_032）：「重随机 / 重置为品牌默认」按钮在当前 agent 的卡片上（带 data-kind）。
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

    /**
     * ③ 人设生成（@since v3.13 预设库；@since v3.14，task_044：per-agent 独立草稿 + 切换条 +
     * 预设按 kind 推荐排序；初始无预设 → 人设留空提示答问卷或选预设）。
     */
    private renderPersona(): string {
      if (this._identities.length === 0) {
        return `
          <div class="group" data-group="persona">
            <div class="group-name">人设生成</div>
            <div class="empty" data-role="persona-empty">没有勾选导入的 agent：人设步骤为空，可直接下一步完成</div>
          </div>
        `;
      }
      const active = this.currentPreviewIdentity();
      const draft = active ? this._personaDrafts.get(active.kind) : undefined;
      if (!active || !draft) return '';
      const presetCards = this.renderPresetCards(active.kind, draft);
      const presetBadge = this.renderPresetBadge(draft);
      const questions = PERSONA_QUESTIONS.map((question) => {
        const options = question.options.map((option) => {
          const checked = draft.answers[question.id] === option.id ? 'checked' : '';
          return `
            <label class="option">
              <input type="radio" name="persona-${escapeHtml(question.id)}" value="${escapeHtml(option.id)}"
                     data-role="option" data-field="answer" data-question="${escapeHtml(question.id)}" ${checked}>
              <span>${escapeHtml(option.label)}</span>
            </label>
          `;
        }).join('');
        const error = this._errors.get(`answer:${active.kind}:${question.id}`) ?? '';
        const errorAttr = error ? '' : 'hidden';
        return `
          <fieldset class="question" data-role="question" data-question="${escapeHtml(question.id)}">
            <legend class="question-prompt">${escapeHtml(question.prompt)}</legend>
            <div class="options">${options}</div>
            <div class="error" data-role="answer-error" data-error-key="answer:${escapeHtml(active.kind)}:${escapeHtml(question.id)}" ${errorAttr}>${escapeHtml(error)}</div>
          </fieldset>
        `;
      }).join('');

      const personaError = this._errors.get(`persona:${active.kind}`) ?? '';
      const personaErrorAttr = personaError ? '' : 'hidden';
      const regenerateHidden = draft.dirty ? '' : 'hidden';
      // 初始（无预设未答问卷）人设留空：给个提示指路，别让预览区看着像坏了。
      const emptyHint = draft.persona === ''
        ? '<div class="hint" data-role="persona-hint">还没有人设：答下面的问卷，或从上面的预设里挑一个（也可以直接在预览区手写）</div>'
        : '';
      return `
        ${this.renderAgentSwitcher()}
        <div class="group" data-group="persona">
          <div class="group-name">人设生成 · ${escapeHtml(active.label)}</div>
          <div class="group-name">快速开始：选一个预设（可再局部修改）</div>
          <div class="preset-row" data-role="preset-row">${presetCards}</div>
          ${presetBadge}
          ${questions}
          <div class="group-name">预览（可以直接改）</div>
          ${emptyHint}
          <textarea class="textarea" rows="8" data-role="persona-input" data-field="persona">${escapeHtml(draft.persona)}</textarea>
          <div class="persona-tools">
            <button type="button" class="regenerate" data-role="regenerate-persona" data-action="regenerate-persona" ${regenerateHidden}>按问卷重新生成</button>
            <span class="summary">手改后问卷不再自动覆盖；点它按当前答卷重写预览</span>
          </div>
          <div class="error" data-role="persona-error" data-error-key="persona:${escapeHtml(active.kind)}" ${personaErrorAttr}>${escapeHtml(personaError)}</div>
        </div>
      `;
    }

    /**
     * 预设卡片行（@since v3.14，task_044：按当前 agent 的 kind 排序 ——
     * suitableKinds 点名该 kind 的排前 + 「推荐」角标；'any' 通用预设照常列出）。
     * 名称 + 一句话说明 + 适配 kind 徽标（'any' → 通用）。
     */
    private renderPresetCards(kind: string, draft: PersonaDraft): string {
      return presetsForKind(kind).map(({ preset, recommended }) => {
        const selected = draft.presetId === preset.id;
        const recommendBadge = recommended
          ? '<span class="preset-recommend" data-role="preset-recommend">推荐</span>'
          : '';
        const kinds =
          preset.suitableKinds === 'any'
            ? '<span class="preset-kind">通用</span>'
            : preset.suitableKinds
                .map((suitable) => `<span class="preset-kind">${escapeHtml(agentKindLabel(suitable))}</span>`)
                .join('');
        return `
          <button type="button" class="preset-card" data-role="preset-card" data-action="select-preset"
                  data-preset="${escapeHtml(preset.id)}" data-selected="${selected}">
            <span class="preset-name">${escapeHtml(preset.name)}</span>
            ${recommendBadge}
            <span class="preset-desc">${escapeHtml(preset.description)}</span>
            <span class="preset-kinds">${kinds}</span>
          </button>
        `;
      }).join('');
    }

    /** 「已用预设」标记（active agent 的草稿）；预设态被手改时附注「已手动修改」。 */
    private renderPresetBadge(draft: PersonaDraft): string {
      const preset = draft.presetId === null
        ? null
        : PERSONA_PRESETS.find((candidate) => candidate.id === draft.presetId) ?? null;
      if (!preset) {
        return '<div class="preset-status" data-role="persona-preset-badge" hidden></div>';
      }
      const modified = draft.dirty ? ' · 已手动修改' : '（再答问卷将以问卷结果替换）';
      return `<div class="preset-status" data-role="persona-preset-badge">已用预设：${escapeHtml(preset.name)}${modified}</div>`;
    }

    /** 当前 active agent 生效的预设对象（id 已失效 → null）。 */
    private activePreset(): PersonaPreset | null {
      const draft = this.activePersonaDraft();
      if (!draft || draft.presetId === null) return null;
      return PERSONA_PRESETS.find((candidate) => candidate.id === draft.presetId) ?? null;
    }

    /**
     * ④ 确认（@since v3.14，task_044：只列勾选导入的 agent；每个 agent 一段可折叠人设预览，
     * 摘要行 = 分节头列表，展开看全文）。
     */
    private renderConfirm(): string {
      if (this._identities.length === 0) {
        return `
          <div class="group" data-group="confirm">
            <div class="group-name">确认建档</div>
            <div class="empty" data-role="confirm-empty">没有勾选导入的角色：直接完成即可结束向导</div>
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
      // 逐 agent 的人设预览：默认折叠（分节头列表当摘要），展开看全文 ——
      // 多个 agent 的人设全文加起来很长，全部展开确认页就不可读了。
      const personaBlocks = this._identities.map((identity) => {
        const persona = (this._personaDrafts.get(identity.kind)?.persona ?? '').trim();
        const body = persona.length > 0 ? escapeHtml(persona) : '（空：建档时套用默认模板）';
        return `
          <details class="persona-details" data-role="persona-details" data-kind="${escapeHtml(identity.kind)}">
            <summary data-role="persona-summary">人设 · ${escapeHtml(identity.name)}：${escapeHtml(this.personaSectionSummary(persona))}</summary>
            <pre class="persona" data-role="persona-preview" data-kind="${escapeHtml(identity.kind)}">${body}</pre>
          </details>
        `;
      }).join('');
      return `
        <div class="group" data-group="confirm">
          <div class="group-name">确认建档</div>
          <ul class="rows">${rows}</ul>
          ${personaBlocks}
        </div>
      `;
    }

    /** 人设摘要：分节头列表（如「角色定位 ROLE · 使命 MISSION · …」）；空人设给占位说明。 */
    private personaSectionSummary(persona: string): string {
      const headers = persona
        .split('\n')
        .filter((line) => line.startsWith('# '))
        .map((line) => line.slice(2).trim());
      if (headers.length === 0) return '（空：建档时套用默认模板）';
      return headers.join(' · ');
    }

    private renderFooter(): string {
      const back =
        this._step === 'scan'
          ? ''
          : `<${STRAT_BUTTON_TAG} label="上一步" variant="default" data-action="back"></${STRAT_BUTTON_TAG}>`;
      // 必填校验（@since v3.10，task_154）：名字没起好 → 主按钮**禁用**并给出原因，
      //   而不是让人点下去、再弹一串报错（点前就说清 = 少一轮来回）。
      const reason = this.stepBlockReason();
      const disabled = reason !== null || this._submitted;
      const primary =
        this._step === 'confirm'
          ? `<${STRAT_BUTTON_TAG} label="完成建档" variant="primary" data-action="submit"${disabled ? ' disabled' : ''} title="${escapeHtml(reason ?? '完成建档')}"></${STRAT_BUTTON_TAG}>`
          : `<${STRAT_BUTTON_TAG} label="下一步" variant="primary" data-action="next"${disabled ? ' disabled' : ''} title="${escapeHtml(reason ?? '下一步')}"></${STRAT_BUTTON_TAG}>`;
      const reasonMarkup = `<span class="footer-reason" data-role="footer-reason"${reason ? '' : ' hidden'}>${escapeHtml(reason ?? '')}</span>`;
      return `${reasonMarkup}${back}${primary}`;
    }

    /**
     * 当前步骤的主按钮被什么挡住了（@since v3.10，task_154）：null = 可以走。
     * 口径：起名步 / 确认步要求**每个** agent 都有合法且不重复的名字；
     *   其它步骤（扫描 / 人设）不挡（人设步有它自己的问卷校验）。
     */
    private stepBlockReason(): string | null {
      if (this._step !== 'identity' && this._step !== 'confirm') return null;
      if (this._identities.length === 0) return null;
      const names = this._identities.map((item) => item.name);
      const duplicated = new Set(findDuplicateNames(names));
      for (const identity of this._identities) {
        const result = validateAgentName(identity.name);
        if (!result.ok) return NAME_ERROR_MESSAGES[result.code ?? 'empty-name'];
        if (duplicated.has(result.value)) return NAME_ERROR_MESSAGES['duplicate-name'];
      }
      return null;
    }

    /**
     * 轻量刷新页脚（@since v3.10，task_154）：名字改了 → 主按钮的可用性与原因跟着变。
     * why 不重画整步：正在输入的焦点会丢（与 setError 同一理由）。
     */
    private refreshFooter(): void {
      const footer = this.shadowRoot?.querySelector('[data-role="footer"]');
      if (footer) footer.innerHTML = this.renderFooter();
    }

    /** 把 active agent 的问卷答案重算成人设并写回预览框（不重画整屏，保住输入焦点）。 */
    private syncPersonaField(): void {
      const field = this.shadowRoot?.querySelector('[data-role="persona-input"]') as HTMLTextAreaElement | null;
      const draft = this.activePersonaDraft();
      if (field && draft) field.value = draft.persona;
    }

    /**
     * 同步人设工具面的轻量 DOM（预设徽标 / 重新生成按钮 / 卡片选中态 —— 均为 active agent 的草稿态）。
     * why 不重画整屏：答题和手改都发生在输入交互中，重画会丢焦点（与 setError 同一理由）。
     */
    private syncPresetSurfaces(): void {
      const root = this.shadowRoot;
      if (!root) return;
      const draft = this.activePersonaDraft();
      const badge = root.querySelector('[data-role="persona-preset-badge"]');
      if (badge) {
        const preset = this.activePreset();
        if (!preset || !draft) {
          badge.setAttribute('hidden', '');
          badge.textContent = '';
        } else {
          const modified = draft.dirty ? ' · 已手动修改' : '（再答问卷将以问卷结果替换）';
          badge.textContent = `已用预设：${preset.name}${modified}`;
          badge.removeAttribute('hidden');
        }
      }
      const regenerate = root.querySelector('[data-role="regenerate-persona"]');
      if (regenerate) {
        if (draft?.dirty) regenerate.removeAttribute('hidden');
        else regenerate.setAttribute('hidden', '');
      }
      const cards = Array.from(root.querySelectorAll('[data-role="preset-card"]'));
      for (const card of cards) {
        const selected = card.getAttribute('data-preset') === draft?.presetId;
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
  /**
   * 自定义 agent 注册端口（@since v3.32，task_056）。
   * 缺省 = 扫描步不显示「+ 添加自定义 agent」入口（向导照常能走完）。
   */
  readonly customAgents?: CustomAgentsPort;
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
  if (options.customAgents) element.customAgents = options.customAgents;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订 + 销毁预览实例，订阅与 Phaser 随之释放。
  return () => { element.remove(); };
}
