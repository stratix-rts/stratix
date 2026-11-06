/**
 * 文件职责：角色屏 Web Component（`<strat-character-screen>`）—— 角色（养成）总览屏：
 *   单选单位的角色详情卡 + 编组内单位↔角色关联列表 + 全部角色养成总览卡片。
 *   数值模型来自 core/progression（task_040 起的等级曲线；旧 SharedSkillStore 的
 *   level/experience/addExperience 语义提炼为纯函数，本屏只渲染、绝不重算阈值）。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级 + D3「角色提示词保留；技能树砍；数值系统保留」
 *        + §6 Phase 2「character 屏先落 persona 编辑 + level/exp 展示位」。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力，与 screens / panels 同口径）；WorldState 快照。
 * 输出：Shadow DOM 角色面板；交互 → HudCommand（只有 ui.navigate）；经验增长 → 自定义 DOM 事件钩子。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态
 *      （唯一例外是 **import core/progression 的纯函数与常量**（经 character-catalog）去渲染进度条阈值：
 *       数值裁决只在 core 一处存在，见 character-catalog 文件头）；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 本地改角色数值 —— 等级/经验只认 core 广播的 WorldState.characters，本屏一改就发命令等回广播；
 *   5. 渲染未经转义的用户数据 —— 角色名与提示词（persona）都是自由文本，一律走 escapeHtml；
 *   6. 泄漏监听器 / 定时器 —— disconnectedCallback 必须退订并清 timer（perf 硬约束）；
 *   7. 自己改 mount 接线 —— 本屏尚未被 main-screen 挂载（见文件末 TODO(v3.task_019)）。
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
 * ★ 形象编辑面板（@since v3.20，task_041）：
 *   本屏原是纯展示屏（除导航外不发任何业务命令）—— 但形象编辑是「创建后」路径的唯一合法入口
 *   （向导是创建前，不受解锁约束），故在本屏的角色详情位下方加最小编辑面板：
 *   预览 canvas（appearance-preview-port 注入）+ 部件选择器 + 重随机 + 保存。
 *   面板职责边界：
 *     - 等级过滤 / 角标 / 受限重随机 / toast 文案全在 appearance-unlock-catalog（纯函数）；
 *     - 保存发 HudCommand 'character.appearance.update'（core 不判解锁，见 types.ts 命令注释）；
 *     - 预览与选择器数据全经 port（hud 不认识 world，铁律不变）；
 *     - 草稿仅存在元素内存（_editDraft）：未保存的改动不落库、不广播；重渲染（经验变动等）
 *       不会丢草稿，但切换单位（换编辑对象）会重置。
 *
 * ★ 角色编辑中心（@since v3.35，task_059）：向导后的持续编辑入口 —— 041 的形象面板升级为
 *   三 tab 统一编辑面板（档案：改名；人设：全文编辑 + 预设重套；形象：041 面板原样迁入）：
 *     - 缺省 tab = 'appearance'：041 面板行为不变（老入口直接落形象编辑）；
 *     - 档案 tab：改名发 'character.name.update'（core 同一次 setState 刷档案 + 战场单位名）；
 *       非空 / 超长 / 重名（除自己）在本地前置校验给即时反馈，core 仍是最终裁决（竞态走 Notice）；
 *       上下文注入开关不迁入 —— 它已住在 agent-panel 角色卡（task_053），两处共存会漂移，
 *       本 tab 只留一句指路说明（「共存注明」口径）；
 *     - 人设 tab：全文编辑（043「预览可直接改」同款取舍：分节头留在正文里，编辑面只有一块
 *       textarea + 只读分节概览条）；预设重套用 persona-presets 的 presetsForKind（按角色 kind
 *       推荐排序）；脏保护 = 人设未保存时切 tab / 返回主屏被拦 + 提示（保存或放弃后放行）；
 *       保存发 'character.persona.update'，广播回读一致后清草稿 + 点亮「下次对话生效」轻提示
 *       （toast 的屏内替身：屏不碰组合根的 toast-host，反馈面只在自己 shadow DOM 里）；
 *     - 人设 / 改名草稿与形象草稿同口径：仅内存、换编辑对象（切换单位）即重置。
 *
 * ★ 成长看板（@since v3.36，task_061）：编辑中心第四 tab「成长」+ 全场总览排行（角色卡区）。
 *   数据全部经注入的 GrowthStatsPort（app 层 exp-record.ts 的 makeGrowthStatsPort 同构注入，
 *   hud 不 import app）：overview（全场活跃度 + 六态任务计数）/ expEvents（近 30 天经验事件）/
 *   recentTasks（终态任务）。时序聚合与排行是 growth-catalog 的纯函数，曲线画布是
 *   growth-chart 组件（纯 canvas，无依赖，057 minimap 同范式）。空数据准则：每个区块
 *   无数据一律引导语（「派一个试试」等），不空白、不编造。
 *
 * 挂载接线：TODO(v3.task_019) —— 本屏目前只提供 mountCharacterScreen 工厂，
 *   尚未接进 main-screen / hud-dev-entry（由 task_019 的屏位路由接线任务统一挂载，避免两个任务同时改同一处壳）。
 */

// 纯函数 / 常量的跨层 import（与 onboarding-catalog 同一例外口径：core/character 的校验真相不另抄一份）。
import { PERSONA_MAX_LEN } from '../../core/character/persona';
import { hasDuplicateCharacterName } from '../../core/character/profile';
import type { CharacterView } from '../../core/types';
import {
  appearancePartVariant,
  MAX_CHARACTER_NAME_LEN,
  type AppearanceBodyType,
  type WorldState,
} from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import { defineEmptyState, EMPTY_STATE_TAG } from '../components/empty-state/empty-state';
// 成长曲线 canvas 组件（纯展示；时序聚合在上面的 growth-catalog，本屏只喂数据）。
import {
  defineStratGrowthChart,
  GROWTH_CHART_TAG,
  type StratGrowthChartElement,
} from '../components/growth-chart/growth-chart';
import { MOTION_REDUCED_CSS } from '../theme/motion-tokens';
import { defineStratButton, escapeHtml, STRAT_BUTTON_TAG } from '../widgets/strat-button';

import type { AppearancePreviewPort } from './appearance-preview-port';
import {
  lockedCategoryBadge,
  mergeUnlockedRoll,
} from './appearance-unlock-catalog';
import {
  characterSignature,
  personaSectionSummary,
  resolveCharacterModel,
  resolveFocusedCharacter,
  type CharacterCardModel,
  type CharacterLinkModel,
  type CharacterScreenModel,
} from './character-catalog';
// 成长看板（@since v3.36，task_061）：纯函数目录 + 视图模型形状（数据经 GrowthStatsPort 注入）。
import {
  buildExpSeries,
  buildGrowthTimeline,
  buildHeatmap,
  extractMilestones,
  formatRelative,
  GROWTH_RANK_MODES,
  rankCharacters,
  successRate,
  type GrowthExpEvent,
  type GrowthOverviewRow,
  type GrowthRankMode,
  type GrowthStatsPort,
  type GrowthTaskInput,
} from './growth-catalog';
import { cloneAppearance } from './onboarding-catalog';
import { PERSONA_PRESETS, presetsForKind } from './persona-presets';

export const CHARACTER_SCREEN_TAG = 'strat-character-screen';

/** 经验增长 DOM 事件名（world 侧像素动画将来订阅它）。 */
export const EXP_GAINED_EVENT = 'character-exp-gained';

/** 经验条高亮持续时长（ms）。到期自动摘 .pulse 类，一个定时器即可（perf：同类动画合并）。 */
export const EXP_PULSE_MS = 600;

/** 人设保存成功轻提示的存活时长（ms）：读完一句话的节奏（与 toast-host 的 TOAST_TTL_MS 同档）。 */
export const PERSONA_SAVED_HINT_MS = 4000;

/**
 * 编辑中心的四个 tab（@since v3.35，task_059：档案 / 人设 / 形象；@since v3.36，task_061 增成长）：
 * 成长 tab = 角色成长看板（exp 曲线 / 任务分布 / 活动热力 / 履历时间线，数据经 growthPort 注入）。
 */
export type CharacterEditorTab = 'profile' | 'persona' | 'appearance' | 'growth';

/** tab 定义（渲染序即声明序：档案 / 人设 / 形象 / 成长）。 */
const EDITOR_TABS: readonly { readonly id: CharacterEditorTab; readonly label: string }[] = [
  { id: 'profile', label: '档案' },
  { id: 'persona', label: '人设' },
  { id: 'appearance', label: '形象' },
  { id: 'growth', label: '成长' },
];

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
  /**
   * 形象预览端口（@since v3.20，task_041）：形象编辑面板的依赖（预览 / 选择器数据 / 随机）。
   * 缺省 null = 面板降级成一句「形象预览没接上」，屏照常可用（与向导同口径：没接端口不是错误）。
   */
  appearancePort: AppearancePreviewPort | null;
  /**
   * 成长看板数据口（@since v3.36，task_061）：「成长」tab（exp 曲线 / 任务分布 / 热力 /
   * 时间线）与全场总览排行的数据源。缺省 null = 各区块降级成引导语（与 appearancePort
   * 同口径：没接端口不是错误，屏照常可用）。
   */
  growthPort: GrowthStatsPort | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 最近一次派生出的视图模型。 */
  readonly model: CharacterScreenModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
  /**
   * 某角色的形象编辑草稿（测试观察口；未初始化 / 不是当前编辑对象 → null）。
   * why 暴露：草稿是纯内存态，测试要断言「受限重随机没碰未解锁类别」这类行为只能从这看。
   */
  appearanceDraftOf(characterId: string): import('../../core/types').CharacterAppearance | null;
  /**
   * 当前激活的编辑 tab（@since v3.35，task_059；测试观察口 —— 切换是纯内存态，DOM 只看 active 类）。
   */
  readonly activeEditorTab: CharacterEditorTab;
  /**
   * 某角色的人设草稿（@since v3.35，task_059；测试观察口 —— 脏保护 / 预设覆写只能从这观察）。
   * text = textarea 当前全文（未编辑时 = 广播 persona）；dirty = 与已落库 persona 有差异。
   * 不是当前编辑对象 / 未初始化 → null。
   */
  personaDraftOf(characterId: string): { readonly text: string; readonly dirty: boolean } | null;
  /**
   * 全场总览快照（@since v3.36，task_061；测试观察口）：overview() 最近一次成功取回的行；
   * 未接端口 / 尚未取回 / 取取失败 → null。
   */
  readonly growthOverviewRows: readonly GrowthOverviewRow[] | null;
  /**
   * 某角色的成长明细（@since v3.36，task_061；测试观察口）：近窗经验事件 + 近期终态任务。
   * 未加载过该角色 → null（与缓存缺席同判，空数组的「无事件」语义留给渲染层引导语）。
   */
  growthDetailOf(characterId: string): { readonly events: readonly GrowthExpEvent[]; readonly tasks: readonly GrowthTaskInput[] } | null;
  /** 当前排行模式（@since v3.36，task_061；测试观察口）。 */
  readonly growthRankMode: GrowthRankMode;
}

/** 工厂：注册 `<strat-character-screen>`。幂等（与 defineSettingsScreen 同一约定）。 */
export function defineCharacterScreen(): typeof HTMLElement {
  defineStratButton();
  defineStratGrowthChart();
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

    // —— 形象编辑面板状态（@since v3.20，task_041）——
    private _appearancePort: AppearancePreviewPort | null = null;
    /** 当前编辑对象的角色 id（草稿的 key：切换单位 = 重置草稿）。 */
    private _editCharacterId: string | null = null;
    /** 编辑草稿（仅内存，未保存不落库）。 */
    private _editDraft: import('../../core/types').CharacterAppearance | null = null;
    /** 预览画布宿主：跨重渲染存活（换掉元素 = Phaser 画布被从 DOM 摘走，画面黑掉，同向导口径）。 */
    private _canvasHost: HTMLDivElement | null = null;
    /** 最近一次推给 port 的草稿（引用比较：部件逐项变更用不可变替换，避免重渲染重复合成）。 */
    private _lastPreviewedDraft: import('../../core/types').CharacterAppearance | null = null;
    /** whenReady 是否已问过（一次挂载只问一次；就绪后强制重画一次拿新变体清单）。 */
    private _appearanceReadyAsked = false;
    /** 编辑面板的临时错误文案（随机形象抽不出等；null = 不显示）。 */
    private _appearanceError: string | null = null;

    // —— 编辑中心状态（@since v3.35，task_059）——
    /** 激活 tab；缺省 'appearance'：041 面板行为不变（老入口直接落形象编辑）。 */
    private _editorTab: CharacterEditorTab = 'appearance';

    // —— 成长看板状态（@since v3.36，task_061）——
    /** 数据口（注入件；null = 全部区块引导语降级）。 */
    private _growthPort: GrowthStatsPort | null = null;
    /** overview() 最近一次成功快照（null = 未取到：未接 / 失败时保留旧值，首取失败为 null）。 */
    private _growthRows: readonly GrowthOverviewRow[] | null = null;
    /** overview 是否已判定不可用（端口在但持续取回 null —— 非 Electron / IPC 故障，文案降级用）。 */
    private _growthUnavailable = false;
    /** overview 在途标记 + 完成时刻（节流：TTL 内不重取，同 taskStats 的「打开时刷一次」口径）。 */
    private _overviewLoading = false;
    private _overviewLoadedAt = 0;
    /** 单角色明细缓存（key = characterId；tab 激活时重拉，期间复用）。 */
    private _growthEvents = new Map<string, readonly GrowthExpEvent[]>();
    private _growthTasks = new Map<string, readonly GrowthTaskInput[]>();
    /** 明细在途的角色 id（防同角色并发重拉；null = 空闲）。 */
    private _growthLoadingId: string | null = null;
    /** 聚合桶的「今天」基准（明细到达时刻定格 —— 重渲染不漂桶，纯函数可复算）。 */
    private _growthNowMs: number | null = null;
    /** 全场总览排行键（等级 / 经验 / 完成率 / 活跃度；纯展示态，跨重渲染保留）。 */
    private _rankMode: GrowthRankMode = 'level';
    /** 人设草稿所属角色 id（换编辑对象即重置，与形象草稿同口径）。 */
    private _personaCharacterId: string | null = null;
    /** 人设草稿全文（null = 未编辑，textarea 显示广播 persona）。仅内存，未保存不落库。 */
    private _personaText: string | null = null;
    /** 保存待确认：发出 persona.update 后置位，广播回读一致时清位 + 点亮「下次对话生效」。 */
    private _personaSavePending = false;
    /** 人设保存成功的轻提示文案（null = 不显示；toast 的屏内替身，见文件头）。 */
    private _personaSavedHint: string | null = null;
    /** 轻提示的自动消失定时器（卸载必清，perf 硬约束）。 */
    private _personaHintTimer: ReturnType<typeof setTimeout> | null = null;
    /** 脏保护提示文案（人设有未保存修改时的拦截提示；null = 无）。 */
    private _personaWarn: string | null = null;
    /** 改名草稿所属角色 id（换编辑对象即重置）。 */
    private _nameCharacterId: string | null = null;
    /** 改名草稿（null = 未编辑，输入框显示广播 name）。 */
    private _nameDraft: string | null = null;
    /** 改名的本地错误文案（非空 / 超长 / 重名前置校验；null = 不显示）。 */
    private _nameError: string | null = null;

    get adapter(): CharacterScreenDeps | null { return this._adapter; }
    set adapter(value: CharacterScreenDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get appearancePort(): AppearancePreviewPort | null { return this._appearancePort; }
    set appearancePort(value: AppearancePreviewPort | null) {
      // 端口换了（换实例 / 换桩）：预览宿主与草稿随之失效，重置后再重画。
      this._appearancePort = value;
      this._editCharacterId = null;
      this._editDraft = null;
      this._canvasHost = null;
      this._lastPreviewedDraft = null;
      this._appearanceError = null;
      this.refresh();
    }

    get growthPort(): GrowthStatsPort | null { return this._growthPort; }
    set growthPort(value: GrowthStatsPort | null) {
      // 端口换了：快照 / 缓存 / 不可用标记全部重置（旧端口的数据不 Guaranteed 同源），
      // 下一次渲染重拉（与 appearancePort 同口径：换桩 = 换真相源）。
      this._growthPort = value;
      this._growthRows = null;
      this._growthUnavailable = false;
      this._overviewLoading = false;
      this._overviewLoadedAt = 0;
      this._growthEvents.clear();
      this._growthTasks.clear();
      this._growthLoadingId = null;
      this._growthNowMs = null;
      this.refresh();
    }

    get growthOverviewRows(): readonly GrowthOverviewRow[] | null { return this._growthRows; }

    get growthRankMode(): GrowthRankMode { return this._rankMode; }

    growthDetailOf(characterId: string): { readonly events: readonly GrowthExpEvent[]; readonly tasks: readonly GrowthTaskInput[] } | null {
      if (!this._growthEvents.has(characterId) && !this._growthTasks.has(characterId)) return null;
      return {
        events: this._growthEvents.get(characterId) ?? [],
        tasks: this._growthTasks.get(characterId) ?? [],
      };
    }

    appearanceDraftOf(characterId: string): import('../../core/types').CharacterAppearance | null {
      return this._editCharacterId === characterId ? this._editDraft : null;
    }

    get activeEditorTab(): CharacterEditorTab { return this._editorTab; }

    personaDraftOf(characterId: string): { readonly text: string; readonly dirty: boolean } | null {
      if (this._personaCharacterId !== characterId) return null;
      const focus = resolveFocusedCharacter(this._state);
      return { text: this._personaText ?? focus?.persona ?? '', dirty: this.isPersonaDirty() };
    }

    get lastState(): WorldState | null { return this._state; }
    get model(): CharacterScreenModel { return resolveCharacterModel(this._state); }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      // 统一空态组件（task_136）：先注册再渲染（幂等，重复 define 不抛）。
      defineEmptyState();
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
      // 形象编辑面板（task_041）：镜像向导的卸载口径 —— 销毁预览实例（Phaser 不泄漏；
      // port 对象 destroy 后仍可 attach 重建，与向导共享同一实例不冲突）+ 清草稿 / 宿主 / 就绪标记。
      this._appearancePort?.destroy();
      this._editCharacterId = null;
      this._editDraft = null;
      this._canvasHost = null;
      this._lastPreviewedDraft = null;
      this._appearanceReadyAsked = false;
      this._appearanceError = null;
      // 编辑中心（task_059）：清人设 / 改名草稿与轻提示定时器（镜像形象草稿的卸载口径）。
      this.clearPersonaHintTimer();
      this._personaSavedHint = null;
      this._personaCharacterId = null;
      this._personaText = null;
      this._personaSavePending = false;
      this._personaWarn = null;
      this._nameCharacterId = null;
      this._nameDraft = null;
      this._nameError = null;
      // 成长看板（task_061）：缓存清空（在途回调被 isConnected 守门，卸载后不再重画）。
      this._growthEvents.clear();
      this._growthTasks.clear();
      this._growthLoadingId = null;
      this._overviewLoading = false;
    }

    refresh(): void {
      const key = characterSignature(this._state);
      if (key === this._lastRenderKey) return;
      this._lastRenderKey = key;
      // 经验差值在 renderBody 里就地比对（diffExperience 先算后写观测表），这里只负责重画。
      this.renderBody();
    }

    /** 清键强制重画（形象编辑面板的草稿变更 / 素材就绪不走签名，需要显式触发）。 */
    private forceRerender(): void {
      this._lastRenderKey = null;
      this.refresh();
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
      // 脏保护（task_059）：人设有未保存修改时拦一道（提示在屏上，保存 / 放弃后放行）。
      if (this.isPersonaDirty()) {
        this._personaWarn = '人设有未保存的修改：请先「保存人设」或「放弃修改」';
        this.forceRerender();
        return;
      }
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
            padding: var(--srf-spacing-sm) var(--srf-spacing-lg);
            background: var(--srf-panel);
            border-bottom: var(--srf-border-width) solid var(--srf-border);
          }
          .title { font-size: var(--srf-font-size-lg); font-weight: var(--srf-font-weight-semibold); }
          .topbar-actions { display: flex; gap: var(--srf-spacing-sm); }
          .body {
            display: grid;
            gap: var(--srf-spacing-lg);
            align-content: start;
            max-width: 960px;
            width: 100%;
            box-sizing: border-box;
            margin: 0 auto;
            padding: var(--srf-spacing-lg);
            overflow: auto;
            scrollbar-width: thin;
            scrollbar-color: var(--srf-border-strong) transparent;
          }
          .body::-webkit-scrollbar { width: var(--srf-spacing-sm); }
          .body::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
          .group {
            display: grid;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-lg);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
          }
          .group-name, .growth-section-name { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); font-weight: var(--srf-font-weight-semibold); letter-spacing: 0.04em; }
          .group[data-group="focus"] { border-color: var(--srf-accent); }
          .summary { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
          .cards { display: grid; gap: var(--srf-spacing-md); grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
          .card {
            display: grid;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-md);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            transition: border-color var(--srf-motion-hover), box-shadow var(--srf-motion-hover);
          }
          .card:hover { border-color: var(--srf-border-strong); }
          .card[data-focused="true"] { border-color: var(--srf-accent); box-shadow: var(--srf-shadow); }
          .card-name { font-weight: var(--srf-font-weight-semibold); }
          .card-meta { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .level { color: var(--srf-accent); font-size: var(--srf-font-size-sm); font-weight: var(--srf-font-weight-semibold); }
          .bar { height: var(--srf-spacing-sm); background: var(--srf-panel); border: var(--srf-border-width) solid var(--srf-border); border-radius: var(--srf-radius-pill); overflow: hidden; }
          .bar-fill { height: 100%; background: var(--srf-accent); transition: background var(--srf-motion-panel); }
          .card[data-maxed="true"] .bar-fill, .bar[data-pulse="true"] .bar-fill { background: var(--srf-success); }
          .persona { color: var(--srf-text); font-size: var(--srf-font-size-sm); white-space: pre-wrap; overflow-wrap: anywhere; }
          .persona:empty { display: none; }
          .links { display: grid; gap: var(--srf-spacing-xs); }
          .link {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-size: var(--srf-font-size-sm);
          }
          .link[data-bound="false"] { color: var(--srf-text-muted); }
          .link-level { color: var(--srf-accent); }
          .empty { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); padding: var(--srf-spacing-lg); text-align: center; border: var(--srf-border-width) dashed var(--srf-border); border-radius: var(--srf-radius); }
          .hint, .appearance-error { font-size: var(--srf-font-size-sm); }
          .hint { color: var(--srf-warn); }
          .appearance-layout { display: grid; grid-template-columns: 160px minmax(0, 1fr); gap: var(--srf-spacing-lg); }
          .appearance-canvas-slot { display: flex; justify-content: center; padding: var(--srf-spacing-sm); }
          .appearance-canvas { width: 128px; height: 128px; border: var(--srf-border-width) solid var(--srf-border); border-radius: var(--srf-radius); background: var(--srf-panel-elevated); overflow: hidden; }
          .appearance-controls { display: grid; gap: var(--srf-spacing-sm); align-content: start; }
          .appearance-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--srf-spacing-sm); }
          .appearance-field { display: grid; gap: var(--srf-spacing-xs); font-size: var(--srf-font-size-sm); }
          .appearance-field-name { display: flex; align-items: baseline; gap: var(--srf-spacing-xs); color: var(--srf-text-muted); }
          .appearance-field select, .persona-textarea, .name-input {
            font-family: inherit;
            font-size: var(--srf-font-size-sm);
            color: var(--srf-text);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            transition: border-color var(--srf-motion-hover), box-shadow var(--srf-motion-hover);
          }
          .appearance-field select:hover, .persona-textarea:hover, .name-input:hover { border-color: var(--srf-border-strong); }
          .appearance-field select:focus-visible, .persona-textarea:focus-visible, .name-input:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .appearance-field[data-locked="true"] select { opacity: 0.45; cursor: not-allowed; }
          .lock-badge { color: var(--srf-warn); }
          .appearance-actions { display: flex; gap: var(--srf-spacing-sm); flex-wrap: wrap; }
          .appearance-error { color: var(--srf-danger); }
          .editor-tabs { display: flex; gap: var(--srf-spacing-xs); flex-wrap: wrap; }
          .editor-tab, .preset-chip, .rank-chip {
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            font-family: inherit;
            font-size: var(--srf-font-size-sm);
            color: var(--srf-text-muted);
            background: var(--srf-panel);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            cursor: pointer;
            transition: color var(--srf-motion-hover), background var(--srf-motion-hover), border-color var(--srf-motion-hover);
          }
          .editor-tab:hover, .preset-chip:hover, .rank-chip:hover { color: var(--srf-text); border-color: var(--srf-border-strong); }
          .editor-tab:active, .preset-chip:active, .rank-chip:active { background: var(--srf-panel-elevated); }
          .editor-tab:focus-visible, .preset-chip:focus-visible, .rank-chip:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          .editor-tab[data-active="true"] { color: var(--srf-accent); border-color: var(--srf-accent); font-weight: var(--srf-font-weight-semibold); }
          .editor-tab[data-dirty="true"]::after { content: " •"; color: var(--srf-warn); }
          .editor-tab-body { display: grid; gap: var(--srf-spacing-sm); }
          .persona-sections { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
          .persona-sections.muted { opacity: 0.8; }
          .persona-textarea { width: 100%; min-height: 220px; resize: vertical; box-sizing: border-box; background: var(--srf-panel-elevated); line-height: var(--srf-line-height); }
          .preset-row { display: flex; gap: var(--srf-spacing-xs); flex-wrap: wrap; align-items: center; }
          .preset-label { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          .preset-chip.recommended { border-color: var(--srf-accent); }
          .saved-hint { color: var(--srf-success); font-size: var(--srf-font-size-sm); }
          .growth-section { display: grid; gap: var(--srf-spacing-sm); }
          .rank-row { display: flex; gap: var(--srf-spacing-xs); flex-wrap: wrap; }
          .rank-chip { background: var(--srf-panel-elevated); padding-block: var(--srf-spacing-xxs); }
          .rank-chip[data-active="true"] { color: var(--srf-text); border-color: var(--srf-accent); background: var(--srf-panel); }
          .card-stats { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); overflow-wrap: anywhere; }
          .card-stats.muted { opacity: 0.8; }
          .task-dist { display: flex; gap: var(--srf-spacing-xs); flex-wrap: wrap; }
          .task-seg { font-size: var(--srf-font-size-xs); padding: var(--srf-spacing-xxs) var(--srf-spacing-xs); border-radius: var(--srf-radius-pill); border: var(--srf-border-width) solid var(--srf-border); }
          .task-seg[data-seg="queued"], .task-seg[data-seg="cancelled"] { color: var(--srf-text-muted); }
          .task-seg[data-seg="running"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          .task-seg[data-seg="awaiting"] { color: var(--srf-warn); border-color: var(--srf-warn); }
          .task-seg[data-seg="completed"] { color: var(--srf-success); border-color: var(--srf-success); }
          .task-seg[data-seg="failed"] { color: var(--srf-danger); border-color: var(--srf-danger); }
          .heat-row { display: flex; gap: var(--srf-spacing-xs); }
          .heat-cell { width: 26px; height: 26px; border-radius: var(--srf-radius); border: var(--srf-border-width) solid var(--srf-border); background: var(--srf-panel-elevated); }
          .heat-cell[data-heat="1"] { background: color-mix(in srgb, var(--srf-accent) 25%, var(--srf-panel-elevated)); }
          .heat-cell[data-heat="2"] { background: color-mix(in srgb, var(--srf-accent) 50%, var(--srf-panel-elevated)); }
          .heat-cell[data-heat="3"] { background: color-mix(in srgb, var(--srf-accent) 75%, var(--srf-panel-elevated)); }
          .heat-cell[data-heat="4"] { background: var(--srf-accent); }
          .growth-timeline { display: grid; gap: var(--srf-spacing-xs); }
          .tl-entry {
            display: grid;
            grid-template-columns: 110px minmax(0, 1fr);
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            background: var(--srf-panel-elevated);
            border-radius: var(--srf-radius);
            border-left: var(--srf-spacing-xxs) solid var(--srf-border);
            font-size: var(--srf-font-size-sm);
          }
          .tl-entry[data-kind="created"] { border-left-color: var(--srf-accent); }
          .tl-entry[data-kind="levelUp"] { border-left-color: var(--srf-warn); }
          .tl-entry[data-kind="task"] { border-left-color: var(--srf-success); }
          .tl-when { color: var(--srf-text-muted); font-family: var(--srf-font-mono); font-size: var(--srf-font-size-xs); white-space: nowrap; }
          .tl-what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .name-field { display: grid; gap: var(--srf-spacing-xs); font-size: var(--srf-font-size-sm); max-width: 320px; }
          .name-input { background: var(--srf-panel-elevated); }
        ${MOTION_REDUCED_CSS}
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
        // 形象编辑面板（task_041）的 select 走 change（change 才意味着用户选定了，不响应每次按键）。
        root.addEventListener('change', (ev: Event) => this.onChange(ev));
        // 编辑中心（task_059）：人设 textarea / 改名输入框走 input（草稿即时入内存，不重画不打断输入）。
        root.addEventListener('input', (ev: Event) => this.onInput(ev));
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
      if (target.closest('[data-role="chat"]')) {
        this.openChat();
        return;
      }
      // 编辑中心（task_059）：tab 切换（脏保护在 switchEditorTab 里拦）。
      const tabButton = target.closest('[data-role="editor-tab"]');
      if (tabButton) {
        const tab = tabButton.getAttribute('data-tab');
        if (tab === 'profile' || tab === 'persona' || tab === 'appearance' || tab === 'growth') {
          this.switchEditorTab(tab);
        }
        return;
      }
      // 成长看板（task_061）：全场总览排行键切换（纯展示态，切了就重排）。
      const rankChip = target.closest('[data-action="growth-rank"]');
      if (rankChip) {
        const mode = rankChip.getAttribute('data-mode');
        if ((GROWTH_RANK_MODES as readonly { readonly id: GrowthRankMode }[]).some((m) => m.id === mode)) {
          this._rankMode = mode as GrowthRankMode;
          this.forceRerender();
        }
        return;
      }
      if (target.closest('[data-action="apply-persona-preset"]')) {
        const chip = target.closest('[data-action="apply-persona-preset"]');
        this.applyPersonaPreset(chip?.getAttribute('data-preset-id') ?? '');
        return;
      }
      if (target.closest('[data-action="save-persona"]')) {
        this.savePersona();
        return;
      }
      if (target.closest('[data-action="discard-persona"]')) {
        this.discardPersona();
        return;
      }
      if (target.closest('[data-action="rename-character"]')) {
        this.renameCharacter();
        return;
      }
      // 形象编辑面板（task_041）：strat-button 的两个动作位。
      if (target.closest('[data-action="randomize-appearance"]')) {
        this.randomizeAppearance();
        return;
      }
      if (target.closest('[data-action="save-appearance"]')) this.saveAppearance();
    }

    /** 编辑中心（task_059）：输入类草稿入内存。不重画（重画会把光标 / 焦点打断）。 */
    private onInput(ev: Event): void {
      const target = ev.target as HTMLInputElement | HTMLTextAreaElement | null;
      if (!target || typeof target.value !== 'string') return;
      const focus = resolveFocusedCharacter(this._state);
      if (!focus) return;
      this.ensureEditorTarget(focus);

      if (target.matches('[data-role="persona-textarea"]')) {
        this._personaText = target.value;
        // 脏标记直接写在 tab 钮上（不整屏重画；下次自然重画时渲染逻辑同源）。
        const tabButton = this.shadowRoot?.querySelector<HTMLElement>(
          '[data-role="editor-tab"][data-tab="persona"]'
        );
        if (tabButton) tabButton.setAttribute('data-dirty', this.isPersonaDirty() ? 'true' : 'false');
        return;
      }

      if (target.matches('[data-role="name-input"]')) {
        this._nameDraft = target.value;
      }
    }

    /** 形象编辑面板的 select 变更：体型 / 部件（task_041）。 */
    private onChange(ev: Event): void {
      const target = ev.target as HTMLSelectElement | null;
      if (!target || typeof target.value !== 'string') return;
      const draft = this._editDraft;
      if (!draft) return;

      if (target.matches('[data-field="body-type"]')) {
        const bodyType = target.value as AppearanceBodyType;
        // 不可变替换：草稿引用变了，预览的引用比较才能感知（见 syncAppearanceCanvas）。
        this._editDraft = { ...draft, bodyType };
        // 体型换了 → 部件清单可能变（某些部位只支持一种体型），重画编辑区。
        this.forceRerender();
        return;
      }

      if (target.matches('[data-field="appearance-part"]')) {
        const category = target.getAttribute('data-category');
        if (!category) return;
        // 未解锁类别的 select 是 disabled：真有变更进来（理论不可能）也不改 —— 防御而非信任。
        const level = resolveFocusedCharacter(this._state)?.level ?? 1;
        if (lockedCategoryBadge(category, level) !== null) return;
        const parts = { ...draft.parts };
        if (target.value) parts[category] = target.value;
        else delete parts[category];
        this._editDraft = { ...draft, parts };
        this.refreshEditorError(null);
        // 不整屏重画（重画会把用户正在操作的下拉换掉）：直接把新草稿推给预览。
        if (this._appearancePort && this._editDraft) {
          this._lastPreviewedDraft = this._editDraft;
          this._appearancePort.preview(this._editDraft);
        }
      }
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="body"]');
      if (!root || !box) return;

      // 保存回读（task_059）：广播的 persona 与待确认草稿一致 → 清草稿 + 点亮「下次对话生效」。
      // 放在渲染前：本次重画就要看到清位后的 textarea 与提示。
      this.reconcilePersonaSave();
      const model = this.model;
      const gains = this.diffExperience(model.cards);
      // 形象编辑面板的预览画布宿主跨重渲染存活（同向导口径）：先摘出，重画后放回。
      this._canvasHost?.remove();
      box.innerHTML = this.renderFocus(model) + this.renderEditorCenter() + this.renderLinks(model) + this.renderCards(model);
      this.syncAppearanceCanvas();
      // 成长看板（task_061）：曲线画布喂数据（元素刚重建，setData 即画）+ 节流拉取数据。
      this.syncGrowthChart();
      this.ensureGrowthData();
      this.applyPulse(gains);
    }

    // —— 编辑中心（@since v3.35，task_059：三 tab 统一编辑面板）——

    /**
     * 编辑目标切换时重置人设 / 改名草稿（与形象草稿同口径：换对象 = 丢草稿 ——
     * 老草稿跟新角色对不上，留着只会把张三的人设写进李四）。
     */
    private ensureEditorTarget(focus: CharacterView): void {
      if (this._personaCharacterId !== focus.id) {
        this._personaCharacterId = focus.id;
        this._personaText = null;
        this._personaSavePending = false;
        this._personaWarn = null;
      }
      if (this._nameCharacterId !== focus.id) {
        this._nameCharacterId = focus.id;
        this._nameDraft = null;
        this._nameError = null;
      }
    }

    /** 人设草稿是否脏（与广播 persona 比对；trim 后比较 —— core 落库的就是 trim 后版本）。 */
    private isPersonaDirty(): boolean {
      if (this._personaText === null) return false;
      const focus = resolveFocusedCharacter(this._state);
      return focus !== null && this._personaText.trim() !== focus.persona;
    }

    /** tab 切换（脏保护：人设未保存时拦一道，保存 / 放弃后放行）。 */
    private switchEditorTab(tab: CharacterEditorTab): void {
      if (tab === this._editorTab) return;
      if (this.isPersonaDirty()) {
        this._personaWarn = '人设有未保存的修改：请先「保存人设」或「放弃修改」';
        this.forceRerender();
        return;
      }
      // 成长 tab（task_061）：重进重拉明细（打开看板 = 现取，缓存只在停留期间复用 ——
      // 与 taskStats 的「打开时刷一次」同口径，期间的新事件下次打开再读）。
      if (tab === 'growth') {
        const focus = resolveFocusedCharacter(this._state);
        if (focus) {
          this._growthEvents.delete(focus.id);
          this._growthTasks.delete(focus.id);
        }
        this._growthNowMs = null;
      }
      this._editorTab = tab;
      this._personaWarn = null;
      this._nameError = null;
      this.forceRerender();
    }

    /** 编辑中心整组（tab 栏 + 当前 tab 内容）；无编辑对象（未单选 / 未关联）不渲染。 */
    private renderEditorCenter(): string {
      const focus = resolveFocusedCharacter(this._state);
      if (!focus) return '';
      this.ensureEditorTarget(focus);
      const tabs = EDITOR_TABS.map(({ id, label }) => {
        const active = id === this._editorTab;
        return `<button type="button" class="editor-tab" data-role="editor-tab" data-tab="${id}" data-active="${active}" data-dirty="${id === 'persona' && this.isPersonaDirty() ? 'true' : 'false'}" aria-selected="${active}">${label}</button>`;
      }).join('');
      const body =
        this._editorTab === 'profile'
          ? this.renderProfileTab(focus)
          : this._editorTab === 'persona'
            ? this.renderPersonaTab(focus)
            : this._editorTab === 'growth'
              ? this.renderGrowthTab(focus)
              : this.renderAppearanceEditor();
      return `
        <div class="group" data-group="character-editor">
          <div class="group-name">角色编辑 · ${escapeHtml(focus.name)}</div>
          <div class="editor-tabs" role="tablist">${tabs}</div>
          ${body}
        </div>
      `;
    }

    /** 档案 tab：改名（上下文注入开关不迁入 —— 已住 agent-panel 角色卡，此处只指路）。 */
    private renderProfileTab(focus: CharacterView): string {
      const draft = this._nameDraft ?? focus.name;
      const error = this._nameError;
      return `
        <div class="editor-tab-body" data-tab-body="profile">
          <label class="name-field">
            <span class="appearance-field-name">名字</span>
            <input type="text" class="name-input" data-role="name-input" value="${escapeHtml(draft)}">
          </label>
          <div class="appearance-actions">
            <${STRAT_BUTTON_TAG} label="改名" variant="primary" data-action="rename-character"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="appearance-error" data-role="name-error" ${error ? '' : 'hidden'}>${escapeHtml(error ?? '')}</div>
          <div class="summary">改名立即生效：档案与战场单位同步刷新。上下文注入开关在战场角色卡（agent 面板）上，本处不重复。</div>
        </div>
      `;
    }

    /** 人设 tab：分节概览（只读）+ 全文 textarea + 预设重套 + 脏保护 + 保存 / 放弃。 */
    private renderPersonaTab(focus: CharacterView): string {
      const draft = this._personaText ?? focus.persona;
      // 只读分节概览：分节头留在正文里（全文编辑口径，043「预览可直接改」同款取舍）。
      const sections = personaSectionSummary(focus.persona);
      const sectionStrip =
        sections.length > 0
          ? `<div class="persona-sections" data-role="persona-sections">分节：${sections.map(escapeHtml).join(' · ')}</div>`
          : '<div class="persona-sections muted" data-role="persona-sections">自由文本（无分节结构）</div>';
      const presets = presetsForKind(focus.agentKind ?? '');
      const chips = presets
        .map(
          (entry) =>
            `<button type="button" class="preset-chip${entry.recommended ? ' recommended' : ''}" data-action="apply-persona-preset" data-preset-id="${escapeHtml(entry.preset.id)}">${escapeHtml(entry.preset.name)}${entry.recommended ? '（推荐）' : ''}</button>`
        )
        .join('');
      const warn = this._personaWarn
        ? `<div class="appearance-error" data-role="persona-warn">${escapeHtml(this._personaWarn)}</div>`
        : '';
      const hint = this._personaSavedHint
        ? `<div class="saved-hint" data-role="persona-saved-hint">${escapeHtml(this._personaSavedHint)}</div>`
        : '';
      return `
        <div class="editor-tab-body" data-tab-body="persona">
          ${sectionStrip}
          <textarea class="persona-textarea" data-role="persona-textarea" rows="14" spellcheck="false">${escapeHtml(draft)}</textarea>
          <div class="preset-row"><span class="preset-label">重套预设：</span>${chips}</div>
          ${warn}${hint}
          <div class="appearance-actions">
            <${STRAT_BUTTON_TAG} label="保存人设" variant="primary" data-action="save-persona"></${STRAT_BUTTON_TAG}>
            <${STRAT_BUTTON_TAG} label="放弃修改" variant="default" data-action="discard-persona"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="summary">保存后下次对话生效（进行中的对话仍用旧人设）。</div>
        </div>
      `;
    }

    // —— 成长看板（@since v3.36，task_061）——

    /** overview 节流窗口：TTL 内不重取（打开屏 / 切排行时最多一次现取，之后复用快照）。 */
    private static readonly GROWTH_OVERVIEW_TTL_MS = 60_000;

    /**
     * 节流拉取：overview（TTL 门控）+ 当前编辑对象的明细（成长 tab 激活且无缓存时）。
     * fire-and-forget：取回后 forceRerender（growth 数据不在 WorldState 签名里，必须显式触发）；
     * 卸载后不重画（isConnected 守门）。失败保留旧快照（null 结果只标记不可用，不清已取到的数据）。
     */
    private ensureGrowthData(): void {
      const port = this._growthPort;
      if (!port) return;
      const now = Date.now();
      // 重取门控：成功后 TTL 内不重取；首取失败（持续 null）不再无限重拉 —— 首败即停
      //（_growthUnavailable 置位，文案降级「未接上」；只有换端口才重新尝试 —— 否则每次
      // forceRerender 后果 Overview 又是 null → 又重拉 → 死循环）。
      const overviewStale =
        this._growthRows === null ? !this._growthUnavailable : now - this._overviewLoadedAt > CharacterScreen.GROWTH_OVERVIEW_TTL_MS;
      if (!this._overviewLoading && overviewStale) {
        this._overviewLoading = true;
        void port
          .overview()
          .then((rows) => {
            this._overviewLoading = false;
            this._overviewLoadedAt = Date.now();
            // 首败才置不可用（已有快照时刷新失败 → 保留旧快照继续展示，旧数据比误导性强）。
            this._growthUnavailable = rows === null && this._growthRows === null;
            if (rows !== null) this._growthRows = rows;
            if (this.isConnected) this.forceRerender();
          })
          .catch(() => {
            this._overviewLoading = false;
            this._growthUnavailable = true;
          });
      }
      if (this._editorTab !== 'growth') return;
      const focus = resolveFocusedCharacter(this._state);
      if (!focus || this._growthLoadingId === focus.id || this._growthEvents.has(focus.id)) return;
      this._growthLoadingId = focus.id;
      const characterId = focus.id;
      void Promise.all([port.expEvents(characterId), port.recentTasks(characterId)])
        .then(([events, tasks]) => {
          this._growthLoadingId = null;
          // 桶基准定格在数据到达时刻：重渲染不再漂桶（纯函数复算同一批桶）。
          this._growthNowMs = Date.now();
          if (events !== null) this._growthEvents.set(characterId, events);
          if (tasks !== null) this._growthTasks.set(characterId, tasks);
          if (this.isConnected) this.forceRerender();
        })
        .catch(() => {
          this._growthLoadingId = null;
        });
    }

    /** 折线画布喂数据：元素每次重渲染重建，重建后 setData 即重画（无跨渲染态）。 */
    private syncGrowthChart(): void {
      const chart = this.shadowRoot?.querySelector<StratGrowthChartElement>('[data-role="growth-chart"]');
      if (!chart) return;
      const focus = resolveFocusedCharacter(this._state);
      if (!focus) return;
      const events = this._growthEvents.get(focus.id);
      if (!events || events.length === 0) return;
      const nowMs = this._growthNowMs ?? Date.now();
      chart.setData(buildExpSeries(events, nowMs), extractMilestones(events));
    }

    /**
     * 成长 tab：上部 exp 折线（近 30 天 + 升级里程碑标记）/ 中部任务状态分布条（六态色块 + 计数）/
     * 下部近 7 天活动热力（日粒度）/ 末尾履历时间线（建档 + 升级 + 终态任务）。
     * 空数据准则：各区块无数据一律引导语，不空白不造假。
     */
    private renderGrowthTab(focus: CharacterView): string {
      const nowMs = this._growthNowMs ?? Date.now();
      const detail = this.growthDetailOf(focus.id);
      const events = detail?.events ?? [];
      const tasks = detail?.tasks ?? [];
      const row = this._growthRows?.find((r) => r.characterId === focus.id) ?? null;
      const counts = row?.taskCounts ?? null;
      const taskTotal = counts
        ? counts.queued + counts.running + counts.awaiting + counts.completed + counts.failed + counts.cancelled
        : 0;

      // 上部：经验曲线（空事件 → 引导语；有事件才画 —— 全零折线不算「成长记录」）。
      const curveSection =
        events.length === 0
          ? `<${EMPTY_STATE_TAG} data-role="growth-curve-empty">还没有成长记录：完成任务或对话拿到经验后，这里会长出曲线</${EMPTY_STATE_TAG}>`
          : `<${GROWTH_CHART_TAG} data-role="growth-chart"></${GROWTH_CHART_TAG}>`;

      // 中部：任务状态分布条（六态色块 + 计数；零计数态不占位 —— 色块只报实有）。
      const distSection =
        !counts || taskTotal === 0
          ? `<${EMPTY_STATE_TAG} data-role="growth-tasks-empty">还没有任务记录，派一个试试</${EMPTY_STATE_TAG}>`
          : `<div class="task-dist" data-role="growth-task-dist">${([
              ['queued', '排队', counts.queued],
              ['running', '执行', counts.running],
              ['awaiting', '待批', counts.awaiting],
              ['completed', '完成', counts.completed],
              ['failed', '失败', counts.failed],
              ['cancelled', '取消', counts.cancelled],
            ] as const)
              .filter(([, , n]) => n > 0)
              .map(([key, label, n]) => `<span class="task-seg" data-seg="${key}">${label} ${n}</span>`)
              .join('')}</div>`;

      // 下部：近 7 天活动热力（日粒度；强度按当日事件数 / 窗口峰值分五档）。
      const heat = buildHeatmap(events, nowMs);
      const heatMax = Math.max(0, ...heat.map((cell) => cell.count));
      const heatSection =
        heatMax === 0
          ? `<${EMPTY_STATE_TAG} data-role="growth-heat-empty">近 7 天暂无活动：派任务或聊一轮就会点亮</${EMPTY_STATE_TAG}>`
          : `<div class="heat-row" data-role="growth-heat">${heat
              .map((cell) => {
                const level = Math.max(1, Math.ceil((cell.count / heatMax) * 4));
                return `<span class="heat-cell" data-count="${cell.count}" data-heat="${level}" title="${cell.count} 次活动"></span>`;
              })
              .join('')}</div>`;

      // 末尾：履历时间线（建档锚点来自 overview 行的 createdAt；无档案行则从升级 / 任务起笔）。
      const timeline = buildGrowthTimeline(row?.createdAt ?? null, events, tasks);
      const timelineSection =
        timeline.length === 0
          ? `<${EMPTY_STATE_TAG} data-role="growth-timeline-empty">暂无履历：完成第一个任务，这里会记下每一步</${EMPTY_STATE_TAG}>`
          : `<div class="growth-timeline" data-role="growth-timeline">${timeline
              .map(
                (entry) =>
                  `<div class="tl-entry" data-kind="${entry.kind}"><span class="tl-when">${escapeHtml(formatRelative(entry.atMs, nowMs))}</span><span class="tl-what" title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</span></div>`
              )
              .join('')}</div>`;

      return `
        <div class="editor-tab-body" data-tab-body="growth">
          <div class="growth-section">
            <div class="growth-section-name">经验曲线（近 30 天 · 升级标记）</div>
            ${curveSection}
          </div>
          <div class="growth-section">
            <div class="growth-section-name">任务状态分布</div>
            ${distSection}
          </div>
          <div class="growth-section">
            <div class="growth-section-name">近 7 天活动</div>
            ${heatSection}
          </div>
          <div class="growth-section">
            <div class="growth-section-name">履历时间线</div>
            ${timelineSection}
          </div>
        </div>
      `;
    }

    /** 预设重套：预设覆写草稿（显式动作 = 用户要求的替换，043 同口径）；未保存前不落库。 */
    private applyPersonaPreset(presetId: string): void {
      const focus = resolveFocusedCharacter(this._state);
      if (!focus) return;
      const preset = PERSONA_PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      this.ensureEditorTarget(focus);
      this._personaText = preset.persona;
      this._personaSavePending = false;
      this._personaWarn = null;
      this.forceRerender();
    }

    /** 保存人设：前置校验（空 / 超长）→ 发 character.persona.update；回读在 reconcilePersonaSave。 */
    private savePersona(): void {
      const focus = resolveFocusedCharacter(this._state);
      const draft = this._personaText;
      if (!focus || draft === null) return;
      // 无实质变更不白跑一趟（core 侧同值不广播，pending 会永远挂着）。
      if (!this.isPersonaDirty()) return;
      if (draft.trim().length === 0) {
        this._personaWarn = '人设不能为空（想换风格可直接重套预设）';
        this.forceRerender();
        return;
      }
      if (draft.length > PERSONA_MAX_LEN) {
        this._personaWarn = `人设过长（上限 ${PERSONA_MAX_LEN} 字符）`;
        this.forceRerender();
        return;
      }
      this._personaSavePending = true;
      this._personaWarn = null;
      this._adapter?.dispatch({ type: 'character.persona.update', characterId: focus.id, prompt: draft });
      this.forceRerender();
    }

    /** 放弃修改：草稿归零（textarea 回到广播 persona），脏保护解除。 */
    private discardPersona(): void {
      this._personaText = null;
      this._personaSavePending = false;
      this._personaWarn = null;
      this.forceRerender();
    }

    /**
     * 保存回读：待确认的保存一旦落库（广播 persona 与草稿 trim 后一致）→ 清草稿 + 点亮提示。
     * why 不在 savePersona 里直接点亮：命令被拒（竞态 / 内部错误）时提示会撒谎；
     *   广播回读是唯一能证明「真写进去了」的信号（与形象面板「状态即真相」同一纪律）。
     */
    private reconcilePersonaSave(): void {
      if (!this._personaSavePending) return;
      const focus = resolveFocusedCharacter(this._state);
      if (!focus || this._personaText === null) return;
      if (focus.persona !== this._personaText.trim()) return;
      this._personaSavePending = false;
      this._personaText = null; // 草稿归位：textarea 显示广播真相
      this._personaWarn = null;
      this.showPersonaSavedHint();
    }

    /** 点亮「下次对话生效」轻提示（toast 的屏内替身；定时自动隐藏）。 */
    private showPersonaSavedHint(): void {
      this._personaSavedHint = '人设已保存，下次对话生效';
      this.clearPersonaHintTimer();
      this._personaHintTimer = setTimeout(() => {
        this._personaHintTimer = null;
        this._personaSavedHint = null;
        if (!this.isConnected) return;
        // 只改 DOM 不整屏重画（与 refreshEditorError 同口径）。
        const node = this.shadowRoot?.querySelector<HTMLElement>('[data-role="persona-saved-hint"]');
        if (node) node.remove();
      }, PERSONA_SAVED_HINT_MS);
    }

    private clearPersonaHintTimer(): void {
      if (this._personaHintTimer !== null) {
        clearTimeout(this._personaHintTimer);
        this._personaHintTimer = null;
      }
    }

    /** 改名：前置校验（非空 / 超长 / 重名除自己，与 core 同口径）→ 发 character.name.update。 */
    private renameCharacter(): void {
      const focus = resolveFocusedCharacter(this._state);
      if (!focus) return;
      this.ensureEditorTarget(focus);
      const name = (this._nameDraft ?? focus.name).trim();
      const fail = (message: string): void => {
        this._nameError = message;
        this.forceRerender();
      };
      if (name.length === 0) {
        fail('名字不能为空');
        return;
      }
      if (Array.from(name).length > MAX_CHARACTER_NAME_LEN) {
        fail(`名字不能超过 ${MAX_CHARACTER_NAME_LEN} 个字`);
        return;
      }
      // 重名前置校验（本地即时反馈，与 core 同一份纯函数；豁免自己 —— 改大小写写法是合法改名）。
      // core 仍是最终裁决：快照与命令有时间差，竞态下由 Notice 兑底。
      if (hasDuplicateCharacterName(this._state?.characters ?? [], name, focus.id)) {
        fail('已存在同名角色，请换一个名字');
        return;
      }
      this._nameError = null;
      this._nameDraft = null; // 清草稿：广播回来后输入框显示新名字（签名含 name，必然重画）
      this._adapter?.dispatch({ type: 'character.name.update', characterId: focus.id, name });
      this.forceRerender();
    }

    // —— 形象编辑面板（@since v3.20，task_041）——

    /** 草稿初始化（切换单位时重置）：有外观拷贝外观，无外观问端口预设（创建前没选过形象的补一个）。 */
    private ensureEditDraft(focus: CharacterView): import('../../core/types').CharacterAppearance | null {
      if (this._editCharacterId !== focus.id) {
        this._editCharacterId = focus.id;
        // 预设也要深拷贝：端口实现可能缓存同一份对象（品牌预设查表），草稿是可变的 ——
        // 不拷会把用户未保存的改动漏进端口的缓存。
        const preset = this._appearancePort?.preset(focus.agentKind ?? '') ?? null;
        this._editDraft = focus.appearance
          ? cloneAppearance(focus.appearance)
          : preset
            ? cloneAppearance(preset)
            : null;
        this._appearanceError = null;
      }
      return this._editDraft;
    }

    /** 素材就绪后强制重画一次（变体清单可能从空变满）；一次挂载只问一次，避免微任务循环。 */
    private askAppearanceReady(): void {
      const port = this._appearancePort;
      if (!port || this._appearanceReadyAsked) return;
      this._appearanceReadyAsked = true;
      void port.whenReady().then(() => {
        if (!this.isConnected) return;
        const focus = resolveFocusedCharacter(this._state);
        if (focus && this._editCharacterId === focus.id && this._editDraft === null && !focus.appearance) {
          const preset = port.preset(focus.agentKind ?? '');
          this._editDraft = preset ? cloneAppearance(preset) : null;
        }
        this.forceRerender();
      });
    }

    /** 编辑面板整组（无 focus 角色 / 无端口 / 无草稿各有各的空态文案，不编数据）。 */
    private renderAppearanceEditor(): string {
      const focus = resolveFocusedCharacter(this._state);
      if (!focus) return '';
      if (!this._appearancePort) {
        return `
          <div class="group" data-group="appearance-edit">
            <div class="group-name">形象编辑</div>
            <div class="empty" data-role="appearance-unavailable">形象预览没接上：编辑形象需要形象服务</div>
          </div>
        `;
      }
      this.askAppearanceReady();
      const draft = this.ensureEditDraft(focus);
      if (!draft) {
        return `
          <div class="group" data-group="appearance-edit">
            <div class="group-name">形象编辑</div>
            <div class="empty" data-role="appearance-loading">素材还没加载出来，稍候会自动补上（重进本屏也可）</div>
          </div>
        `;
      }
      const error = this._appearanceError;
      return `
        <div class="group" data-group="appearance-edit">
          <div class="group-name">形象编辑 · Lv.${focus.level}</div>
          <div class="appearance-layout">
            <div class="appearance-canvas-slot" data-role="appearance-canvas-slot"></div>
            <div class="appearance-controls">
              <div class="appearance-fields" data-role="appearance-fields">${this.renderAppearanceControls(draft, focus.level)}</div>
              <div class="appearance-actions">
                <${STRAT_BUTTON_TAG} label="重随机" variant="default" data-action="randomize-appearance"></${STRAT_BUTTON_TAG}>
                <${STRAT_BUTTON_TAG} label="保存形象" variant="primary" data-action="save-appearance"></${STRAT_BUTTON_TAG}>
              </div>
              <div class="appearance-error" data-role="appearance-error" ${error ? '' : 'hidden'}>${escapeHtml(error ?? '')}</div>
            </div>
          </div>
        </div>
      `;
    }

    /** 选择器（体型 + 全量类别，未解锁灰显 + 角标 —— 需求①）。 */
    private renderAppearanceControls(draft: import('../../core/types').CharacterAppearance, level: number): string {
      const port = this._appearancePort;
      if (!port) return '';
      // 编辑路径用全量类别（listAllCategories，task_041）；端口没实现该可选能力则退回向导五类。
      const categories = port.listAllCategories?.(draft.bodyType) ?? port.listCategories(draft.bodyType);

      const bodyTypeOptions = port.bodyTypes
        .map((type) => `<option value="${escapeHtml(type)}"${type === draft.bodyType ? ' selected' : ''}>${escapeHtml(type)}</option>`)
        .join('');
      const bodyTypeField = `
        <label class="appearance-field" data-locked="false">
          <span class="appearance-field-name">体型</span>
          <select data-field="body-type" data-role="body-type">${bodyTypeOptions}</select>
        </label>
      `;

      const partFields = categories
        .map((info) => {
          const badge = lockedCategoryBadge(info.category, level);
          const locked = badge !== null;
          const value = appearancePartVariant(draft.parts[info.category] ?? '');
          const options = [
            // 草稿里有值但清单里没有（素材未就绪 / 体型不支持）→ 保留当前值可见，不假装它不存在。
            ...(value && !info.variants.includes(value) ? [value] : []),
            ...info.variants,
          ]
            .map(
              (variant) =>
                `<option value="${escapeHtml(variant)}"${variant === value ? ' selected' : ''}>${escapeHtml(variant || '（无）')}</option>`
            )
            .join('');
          return `
            <label class="appearance-field" data-category="${escapeHtml(info.category)}" data-locked="${locked}">
              <span class="appearance-field-name">${escapeHtml(info.name)}${badge ? ` <span class="lock-badge" data-role="lock-badge">${escapeHtml(badge)}</span>` : ''}</span>
              <select data-field="appearance-part" data-category="${escapeHtml(info.category)}"${locked ? ' disabled' : ''}>${options}</select>
            </label>
          `;
        })
        .join('');

      return bodyTypeField + partFields;
    }

    /** 画布宿主归位 + 推预览（引用比较：草稿没换不重复合成）。 */
    private syncAppearanceCanvas(): void {
      const port = this._appearancePort;
      const draft = this._editDraft;
      const slot = this.shadowRoot?.querySelector('[data-role="appearance-canvas-slot"]');
      if (!port || !draft || !slot) return;
      if (!this._canvasHost) {
        this._canvasHost = document.createElement('div');
        this._canvasHost.className = 'appearance-canvas';
      }
      if (this._canvasHost.parentElement !== slot) slot.appendChild(this._canvasHost);
      // attach 幂等（同一宿主无副作用；宿主被挪回树里也确保实例指着它 —— 同向导口径）。
      port.attach(this._canvasHost);
      if (this._lastPreviewedDraft !== draft) {
        this._lastPreviewedDraft = draft;
        port.preview(draft);
      }
    }

    /** 受限重随机（需求②）：roll 只把已解锁类别并入草稿，未解锁类别保持现值。 */
    private randomizeAppearance(): void {
      const port = this._appearancePort;
      const draft = this._editDraft;
      const focus = resolveFocusedCharacter(this._state);
      if (!port || !draft || !focus) return;
      const roll = port.randomizeNormal();
      if (!roll) {
        this.refreshEditorError('素材还没加载出来，随机形象暂不可用');
        return;
      }
      this._appearanceError = null;
      this._editDraft = mergeUnlockedRoll(draft, roll, focus.level);
      this.forceRerender();
    }

    /** 保存形象（需求①的落地动作）：发 HudCommand，落库与否由 core 裁决。 */
    private saveAppearance(): void {
      const focus = resolveFocusedCharacter(this._state);
      const draft = this._editDraft;
      if (!focus || !draft) return;
      this._adapter?.dispatch({
        type: 'character.appearance.update',
        characterId: focus.id,
        appearance: draft,
      });
    }

    /** 编辑面板的错误提示位（直接改 DOM，不整屏重画）。 */
    private refreshEditorError(message: string | null): void {
      this._appearanceError = message;
      const node = this.shadowRoot?.querySelector<HTMLElement>('[data-role="appearance-error"]');
      if (!node) return;
      node.textContent = message ?? '';
      node.hidden = message === null;
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
      // 全场总览（task_061）：排行键切换（等级 / 经验 / 完成率 / 活跃度）+ 按键排序的排行卡。
      // 无角色时仍是引导语（排行没有候选可排，不画空壳）。统计行降级口径见 renderCardStats。
      if (model.cards.length === 0) {
        return `
          <div class="group" data-group="cards">
            <div class="group-name">全场总览</div>
            <${EMPTY_STATE_TAG} data-role="cards-empty">尚无角色档案：建好角色后，这里会显示全部角色</${EMPTY_STATE_TAG}>
          </div>
        `;
      }
      const chips = GROWTH_RANK_MODES.map(
        ({ id, label }) =>
          `<button type="button" class="rank-chip" data-action="growth-rank" data-mode="${id}" data-active="${id === this._rankMode}">${label}</button>`
      ).join('');
      const rankedCards = this.rankCards(model);
      return `
        <div class="group" data-group="cards">
          <div class="group-name">全场总览 · 排行</div>
          <div class="rank-row" data-role="rank-modes">${chips}</div>
          <div class="cards">${rankedCards.map((card) => this.renderCard(card, false)).join('')}</div>
          ${overflow}
        </div>
      `;
    }

    /** 按 _rankMode 重排卡片（WorldState.characters 参与排序，卡片模型按 id 对位回填 ——
     *  排序真相源在 growth-catalog 的 rankCharacters，这里只做模型对位，不另写比较器）。 */
    private rankCards(model: CharacterScreenModel): readonly CharacterCardModel[] {
      const characters = this._state?.characters ?? [];
      const ranked = rankCharacters(characters, this._growthRows, this._rankMode);
      const byId = new Map(model.cards.map((card) => [card.id, card] as const));
      const ordered: CharacterCardModel[] = [];
      for (const entry of ranked) {
        const card = byId.get(entry.character.id);
        if (card) ordered.push(card);
      }
      return ordered;
    }

    /** 卡片上的成长统计行（task_061）：对话 / 任务计数 + 完成率 + 最近活跃；降级三档 ——
     *  未接端口 / 取不可用 → 「未接上」；未取到（在途 / 首取失败）→「读取中」；无终态 → 完成率「—」。 */
    private renderCardStats(cardId: string): string {
      if (!this._growthPort || this._growthUnavailable) {
        return '<span class="card-stats muted" data-role="card-stats">成长统计未接上</span>';
      }
      if (this._growthRows === null) {
        return '<span class="card-stats muted" data-role="card-stats">统计读取中…</span>';
      }
      const row = this._growthRows.find((r) => r.characterId === cardId) ?? null;
      if (!row) {
        return '<span class="card-stats muted" data-role="card-stats">暂无统计</span>';
      }
      const rate = successRate(row.taskCounts);
      const rateText = rate === null ? '完成率 —' : `完成率 ${Math.round(rate * 100)}%`;
      const activeText = row.lastActiveAt === null ? '未见活动' : `活跃 ${formatRelative(row.lastActiveAt, Date.now())}`;
      return `<span class="card-stats" data-role="card-stats">对话 ${row.chatCount} · 任务 ${row.taskCount} · ${rateText} · ${activeText}</span>`;
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
          ${this.renderCardStats(card.id)}
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
 * @since v3.20（task_041）追加 options.appearance：形象预览端口（形象编辑面板用），
 *   缺省不注入 —— 面板降级成提示语，屏照常可用（既有调用方零改动）。
 */
export interface MountCharacterScreenOptions {
  readonly appearance?: AppearancePreviewPort;
  /** 成长看板数据口（@since v3.36，task_061）；null/缺省 = 引导语降级。 */
  readonly growth?: GrowthStatsPort | null;
}

export function mountCharacterScreen(
  deps: CharacterScreenDeps,
  host: HTMLElement,
  options: MountCharacterScreenOptions = {}
): () => void {
  defineCharacterScreen();
  const element = document.createElement(CHARACTER_SCREEN_TAG) as StratCharacterScreenElement;
  element.adapter = deps;
  if (options.appearance) element.appearancePort = options.appearance;
  if (options.growth) element.growthPort = options.growth;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订 + 清定时器 + 销毁预览实例，订阅与计时随之释放。
  return () => { element.remove(); };
}