/**
 * 文件职责：设置屏 Web Component（`<strat-settings-screen>`）—— 把设置项按「外观 / 偏好 / 危险区」
 *   三组摆开并就地修改：皮肤切换、偏好开关、危险操作。合并语义只读提取自
 *   src/components/RTSSettings.vue 与 src/components/ProviderSettingsModal.vue（未复制任何实现）。
 *   来源：docs/REFACTOR_PLAN_V3.md §2 screens/ 层级（main-screen / settings-screen / character-screen）
 *        + §3「HUD 主题与像素风」+ §4 既有功能映射表「RTSSettings + ProviderSettingsModal → hud/screens/settings」。
 * 输入：注入的 HudBusAdapter（dispatch / subscribe 两个能力，与 panels 同口径）；WorldState 快照。
 * 输出：Shadow DOM 全屏设置面板；交互 → HudCommand → adapter.dispatch。
 * 禁止事项：
 *   1. import world/、phaser、vue、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— HUD 一律经注入的 adapter 发命令与订阅状态；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token；
 *   4. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）。
 *
 * 三组设置各自的真相源（why 这么分，混在一起就会出现"两个真相"）：
 *   - 外观：皮肤**只经 theme.set**，由 hud/bridge/bus-adapter 本地落 token（见 theme-controller）。
 *     @since v3.6（task_115）：**皮肤有回读通道了** —— 真相源是主题控制器（token + localStorage
 *     记忆），adapter 暴露 themeId / subscribeTheme；本屏的高亮直接读它，不再自存一份
 *     （自存那份在「刷新后恢复皮肤」时会和真相对不上 —— 高亮指向旧皮肤，肉眼看着像没切成功）。
 *   - 偏好：**本机持久层（localStorage）** —— 四个开关统一口径，见下「偏好为什么走 localStorage」。
 *   - 危险区：破坏性动作，一律两步确认（先点按钮 → 弹确认框 → 再点确认）才发命令。
 *
 * ★ 偏好为什么走 localStorage（@since v3.6，task_116 —— 死功能 #4 的根因与修法）：
 *   ① **WorldState 是进程内状态，刷新即回默认值** —— 偏好要「刷新后仍保持」，真相必须落在
 *      本机持久层。core 的 WorldState.settings 满足不了这条验收。
 *   ② **core 从未接线 settings.set**：store.setPreference 是 v3.5 就有的落库入口，但命令分发
 *      那一段一直是 TODO —— HUD 派发 settings.set 只换来一条 console 警告「未处理 command」，
 *      界面等不到广播回来，按钮看着就是"点不动"（死功能报告 #4 的原症状）。
 *   ⇒ 偏好四行（通知提示 / 音效 / 上下文注入 / 单位名字）**统一走 localStorage 直写**：
 *      值现读现写（'0' = 关，其余 = 开），写完立刻重画 → 文字在「开 / 关」之间翻转，
 *      刷新后仍是上次那个值。本屏**不再**发 settings.set（发出去也没有消费方）。
 *      键名冻结在 core/types.ts（通知 / 上下文注入 / 单位名字三键）与 hud/sound-engine.ts
 *      （音效总开关与音量 —— 两个读侧都在 HUD 侧，键归声音引擎管），两侧不各抄字面量。
 *
 * ★ 音量为什么接声音引擎（@since v3.6，task_116 —— 死功能 #5 的根因与修法；
 *   @since v3.7，task_130 —— 双键收敛）：
 *   设置页原来的滑条只写 sfx-service 的键（stratix.sfx.volume），
 *   而**演示声音包**（task_083，hud/sound-engine.ts）读的是另一个键（stratix.sound.volume）
 *   —— 拖了滑条，任务完成音还是老音量，看着就像"音量控件是死的"。
 *   ⇒ 音量写声音引擎的键（引擎每次播放现读，写完即生效）。
 *   ★ task_130 收敛：音效服务（task_060）也改读**同一对键**（stratix.sound.enabled /
 *     stratix.sound.volume）—— 收敛前本屏总开关写两把闸、音量写两把闸，读侧用哪个全凭缘分，
 *     迟早两边不一致。老键（stratix.sfx.*）的值由声音引擎的 migrateLegacySoundPreferences
 *     迁到新键，老用户不丢设置。
 *   交互：档位按钮（静音 / 30 / 70 / 100，点击循环）+ 滑条（细调），两者同源同口径，
 *     档位文字与 title 实时同步（悬停即知当前音量）。
 *
 * ★ 危险区为什么用弹窗确认框（@since v3.6，task_116）：
 *   破坏性动作必须"看得见地问一次"。原先的同行内联确认（按钮旁多出「确认？/确认/取消」）太挤，
 *   且点歪就误触。本屏改用与 task_112 新建任务对话框同一套遮挡模式：
 *   全屏遮罩 + 居中确认面板 + ESC 关闭 + 点遮罩关闭（双关闭途径必齐，R4），
 *   确认框登记进遮挡栈（栈顶即当前模态，ESC 只关最上层那个 —— 不会连带把设置屏关掉）。
 *
 * 语言显示：只读。当前契约没有 locale 字段（core/types.ts 未定义语言域），
 * 本屏只如实显示"当前版本内置的语言"，不编造可切换的下拉 ——
 * TODO(v3.i18n): 语言落地后由 core 提供 settings.locale，此处改为可选并复用本屏同一落库路径。
 *
 * 渲染策略（perf，与 command-panel / agent-panel / mission-confirm 同一口径）：
 *   core 每次状态变更都全量广播，本屏用 settingsSignature 判重 —— 只有偏好值变了才重绘，
 *   单位 / 任务 / 日志的变动一律不触发本屏重渲染。
 *
 * 本屏不渲染任何用户输入（所有文案都是契约内的静态标签），因此不需要 HTML 转义函数。
 */

import {
  STRATIX_CONTEXT_TOGGLE_KEY,
  STRATIX_NAMETAGS_TOGGLE_KEY,
  STRATIX_NOTIFICATIONS_TOGGLE_KEY,
  type WorldState,
} from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import type { OcclusionController } from '../layers/occlusion';
// 声音引擎（@since v3.6，task_116 建 / @since v3.7，task_130 收敛）：音量与总开关的**唯一**真源
//   在 hud/sound-engine.ts（键 stratix.sound.volume / stratix.sound.enabled，引擎每次播放现读 ——
//   写完即生效）。音效服务（task_060）与声音引擎（task_083）读的是同一对键 —— 收敛前双键并存，
//   「关掉音效」只关掉一半通路；老键（stratix.sfx.*）值的迁移由 migrateLegacySoundPreferences 负责。
import {
  SOUND_ENABLED_KEY,
  migrateLegacySoundPreferences,
  nextVolumePreset,
  readSoundVolume,
  volumeLabel,
  writeSoundEnabled,
  writeSoundVolume,
} from '../sound-engine';
import type { ThemeId } from '../theme/theme-controller';
import { defineStratButton, escapeHtml, STRAT_BUTTON_TAG } from '../widgets/strat-button';

// 自定义 agent 注册端口（@since v3.32，task_056）：类型 only —— hud 不 import electron（铁律）。
import type { CustomAgentsPort, CustomAgentView } from './custom-agents-port';
import { zVar } from '../theme/layer-tokens';
import { MOTION_REDUCED_CSS } from '../theme/motion-tokens';

export const SETTINGS_SCREEN_TAG = 'strat-settings-screen';

/**
 * 本屏需要的最小能力面：只要"发命令"与"订阅状态"，与 panels 同一约定；
 * 外加皮肤的两件事（@since v3.6，task_115）：读当前皮肤（高亮当前项）+ 订阅皮肤变化
 *   （设置屏开着时用户可能从顶栏 ⋯ 菜单切皮肤，高亮要跟上）。
 */
export type SettingsScreenDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'> &
  Pick<HudBusAdapter, 'themeId' | 'subscribeTheme'>;

// ============================================================================
// 词表（静态标签集中一处：渲染与单测共用同一份，不各写一套中文）
// ============================================================================

/** 可选皮肤。取值与 hud/theme 的 ThemeId 一一对应，切换靠 HudCommand theme.set。 */
export const SKIN_OPTIONS: readonly { id: ThemeId; label: string; hint: string }[] = [
  { id: 'default', label: '现代', hint: '圆角与细边框的默认皮肤' },
  { id: 'pixel', label: '像素', hint: '直角硬边框的像素皮肤' },
];

/** 偏好开关的 id（DOM 上的 data-pref 值）。四个开关统一口径，id 即行标识。 */
export type PreferenceId = 'notificationsEnabled' | 'sfx' | 'context' | 'nametags';

/** 偏好开关的展示元数据 + 存储口径。
 *   why 四行统一走 localStorage（@since v3.6，task_116）：见文件头「偏好为什么走 localStorage」。
 *   storageKey 是本机持久层的键（'0' = 关；无键 / 其它值 = 开）—— DOM 上带出来
 *   （data-storage-key），单测与 e2e 不用猜键名就能断言"写进了哪一格"。 */
export interface PreferenceRowSpec {
  readonly id: PreferenceId;
  readonly label: string;
  readonly hint: string;
  /** localStorage 键（冻结在 core/types.ts 或 hud/sound-engine.ts —— 键的归属方就是它的主人）。 */
  readonly storageKey: string;
  /** 旧版行内属性（data-sfx-toggle / data-context-toggle / data-nametag-toggle）—— 保留兼容，
   *   新代码一律用 data-pref。 */
  readonly legacyAttr?: string;
}

export const PREFERENCE_ROWS: readonly PreferenceRowSpec[] = [
  {
    id: 'notificationsEnabled',
    label: '通知提示',
    hint: '轻提示总开关：任务完成 / 失败 / 审批请求等（关掉后不再弹轻提示）',
    storageKey: STRATIX_NOTIFICATIONS_TOGGLE_KEY,
  },
  {
    id: 'sfx',
    label: '音效',
    hint: '关键事件反馈音（任务完成 / 失败 / 升级 / 审批请求 / agent 掉线）',
    storageKey: SOUND_ENABLED_KEY,
    legacyAttr: 'data-sfx-toggle',
  },
  {
    id: 'context',
    label: '上下文注入',
    hint: '对话 / 任务首发附带战场现状（角色级开关在侧栏角色卡）',
    storageKey: STRATIX_CONTEXT_TOGGLE_KEY,
    legacyAttr: 'data-context-toggle',
  },
  {
    id: 'nametags',
    label: '单位名字',
    hint: '战场单位头顶显示名字与等级（拉远时自动隐藏）',
    storageKey: STRATIX_NAMETAGS_TOGGLE_KEY,
    legacyAttr: 'data-nametag-toggle',
  },
];

/** 危险区动作 id。与 HudCommand 的 selection.reset / cache.clear 一一对应（派发时原样当 type 用）。 */
export type DangerActionId = 'selection.reset' | 'cache.clear';

export interface DangerActionSpec {
  readonly id: DangerActionId;
  readonly label: string;
  readonly buttonLabel: string;
  readonly hint: string;
  /**
   * 命令在 core 侧是否真的落地（@since v3.6，task_116）。
   * false = **不给可点按钮** —— 一个点了没反应的按钮就是假按钮（死功能报告 #19）。
   * 未落地的行照样列出来（附一句实话），但不呈现为可用。
   */
  readonly implemented: boolean;
}

export const DANGER_ACTIONS: readonly DangerActionSpec[] = [
  {
    id: 'selection.reset',
    label: '重置编组',
    buttonLabel: '重置编组',
    hint: '清空当前选择集与已存入的编组槽位（不影响任务、角色与战场单位数据）。',
    implemented: true,
  },
  {
    id: 'cache.clear',
    label: '清理缓存',
    buttonLabel: '清理缓存（未实现）',
    hint: '缓存层尚未落地 —— 该命令目前没有实际处理，故不提供可点按钮。',
    implemented: false,
  },
];

/** 语言只读展示值。TODO(v3.i18n)：语言域落地后由 core 提供，这里不再硬编码。 */
export const LANGUAGE_LABEL = '简体中文';

// ============================================================================
// 派生模型（纯函数，可脱离 DOM 单测）
// ============================================================================

/** 危险区确认态。null = 没有确认框开着。 */
export type PendingDanger = DangerActionId | null;

/** 危险区确认框在遮挡栈里的登记名（与 task_112 新建任务对话框同一模式：栈顶即当前模态）。 */
export const DANGER_CONFIRM_OCCLUSION_ID = 'settings-danger-confirm';

export interface SettingsScreenModel {
  /** 当前皮肤（@since v3.6，task_115：真相同主题控制器 —— 见文件头「三组设置各自的真相源」）。 */
  readonly themeId: ThemeId;
  /** 偏好当前值（四个开关；真相源是本机 localStorage —— 见文件头）。 */
  readonly preferences: Readonly<Record<PreferenceId, boolean>>;
  /** 正在等二次确认的危险动作。 */
  readonly pending: PendingDanger;
}

/** 读一个偏好开关：'0' = 关；无键 / 其它值 / 存储异常 = 开。
 *   why 缺省开：偏好是增强项，缺省关会让"怎么没反应"的排查成本远高于收益
 *   （与声音引擎的 readSoundEnabled 同一口径 —— 四个键的语义一致，读写都收在这里）。 */
export function readPreference(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== '0';
  } catch {
    return true;
  }
}

/** 写一个偏好开关：写 '1' / '0'；写不进去就丢弃（下次读回落缺省开，不绑架可用性）。 */
export function writePreference(storageKey: string, enabled: boolean): void {
  try {
    localStorage.setItem(storageKey, enabled ? '1' : '0');
  } catch {
    // 写不进去就算了：下次读仍回落缺省开。
  }
}

/** 读全部偏好开关的当前值（四个键各读一次 —— 渲染前调一次，不在渲染里反复读）。 */
export function resolvePreferences(): Readonly<Record<PreferenceId, boolean>> {
  // 老键迁移（@since v3.7，task_130）：音效行读的是收敛后的唯一键，老用户机器上的
  //   老键值必须先搬过来，否则这一行会显示"开"而实际是老键里的"关"。
  migrateLegacySoundPreferences();
  const values = {} as Record<PreferenceId, boolean>;
  for (const row of PREFERENCE_ROWS) {
    values[row.id] = readPreference(row.storageKey);
  }
  return values;
}

export function resolveSettings(themeId: ThemeId): SettingsScreenModel {
  return { themeId, preferences: resolvePreferences(), pending: null };
}

/**
 * 渲染判重签名（O(偏好项数)，纯字符串拼接）。
 * 只含影响本屏显示的东西：四个偏好开关的当前值。单位 / 任务 / 日志变动一律不触发本屏重绘。
 *   why 不含 core 状态：偏好真相在本机持久层（localStorage），core 广播与本屏显示无关。
 *   why 含 localStorage 值：本屏之外的写入方（未来的设置同步）改了值也要跟上 —— 一行字符串的代价。
 */
export function settingsSignature(): string {
  migrateLegacySoundPreferences();
  return PREFERENCE_ROWS.map((row) => (readPreference(row.storageKey) ? '1' : '0')).join('');
}

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratSettingsScreenElement extends HTMLElement {
  /** 注入的适配器；connected 之前或之后设置都生效。 */
  adapter: SettingsScreenDeps | null;
  /**
   * 自定义 agent 注册端口（@since v3.32，task_056）：null = 不显示注册管理组。
   * 注册（新增）入口在向导，这里只提供查看与移除（断检测，角色保留）。
   */
  customAgents: CustomAgentsPort | null;
  /**
   * 遮挡控制器（@since v3.6，task_116）：危险区确认框靠它登记进遮挡栈 ——
   *   ESC 只关栈顶（确认框），不会连带把设置屏关掉；遮罩点击关闭同一条路（R4 双关闭途径）。
   *   null = 没有控制器（单测 / 非 Electron 降级）→ 本屏自己挂 ESC 监听兜底。
   */
  occlusion: OcclusionController | null;
  /** 强制重算重渲染。 */
  refresh(): void;
  /** 最近一次派生出的视图模型（pending 取当前确认态）。 */
  readonly model: SettingsScreenModel;
  /** 最近一次收到的 WorldState。 */
  readonly lastState: WorldState | null;
  /** 当前皮肤（纯展示态）。 */
  readonly currentThemeId: ThemeId;
}

/** 工厂：注册 `<strat-settings-screen>`。幂等（与 defineMissionConfirm 同一约定）。 */
export function defineSettingsScreen(): typeof HTMLElement {
  defineStratButton();
  if (customElements.get(SETTINGS_SCREEN_TAG)) {
    return customElements.get(SETTINGS_SCREEN_TAG) as unknown as typeof HTMLElement;
  }

  class SettingsScreen extends HTMLElement implements StratSettingsScreenElement {
    private _adapter: SettingsScreenDeps | null = null;
    private _state: WorldState | null = null;
    private _pending: PendingDanger = null;
    private _lastRenderKey: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    /** 皮肤订阅的退订闭包（@since v3.6，task_115）：皮肤从别处变了 → 高亮跟上。 */
    private _unsubscribeTheme: (() => void) | null = null;
    private _listenersBound = false;
    // 自定义 agent 注册（@since v3.32，task_056）：端口 + 注册行快照（异步拉，拉到后补画）。
    private _customAgents: CustomAgentsPort | null = null;
    private _customRows: readonly CustomAgentView[] = [];
    private _customRowsLoaded = false;
    private _customNotice: string | null = null;
    // 危险区确认框（@since v3.6，task_116）：遮挡控制器 + 自兜底的 ESC 监听。
    private _occlusion: OcclusionController | null = null;
    private _escBound = false;

    get adapter(): SettingsScreenDeps | null { return this._adapter; }
    set adapter(value: SettingsScreenDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get customAgents(): CustomAgentsPort | null { return this._customAgents; }
    set customAgents(value: CustomAgentsPort | null) {
      this._customAgents = value;
      if (value) this.loadCustomAgents();
      else {
        this._customRows = [];
        this._customRowsLoaded = false;
      }
      if (this.isConnected) this.renderBody();
    }

    get occlusion(): OcclusionController | null { return this._occlusion; }
    set occlusion(value: OcclusionController | null) {
      this._occlusion = value;
      // 控制器后到（挂载后才注入）→ 已经在开的确认框补登记进栈（否则 ESC 关不掉它）。
      if (value && this._pending !== null) {
        value.openModal(DANGER_CONFIRM_OCCLUSION_ID, () => this.cancelDanger());
      }
    }

    get lastState(): WorldState | null { return this._state; }
    /**
     * 当前皮肤（@since v3.6，task_115）：真相源是主题控制器（经 adapter 读）——
     *   本屏不再自存一份（自存那份在「刷新后恢复皮肤」时会对不上）。
     *   还没接上 adapter 时按默认皮肤展示（退化路径，不假装知道）。
     */
    get currentThemeId(): ThemeId { return this._adapter?.themeId ?? 'default'; }
    get model(): SettingsScreenModel {
      return { themeId: this.currentThemeId, preferences: resolvePreferences(), pending: this._pending };
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      this.renderChrome();
      // 清键强制首绘：挂载前 adapter setter 那次 refresh 已记过键，而那时还没有内容可画
      this._lastRenderKey = null;
      this.bindAdapter();
      this.refresh();
      this.renderConfirm();
      if (this._customAgents) this.loadCustomAgents();
    }

    disconnectedCallback(): void {
      this.releaseAdapter();
      this.releaseConfirm();
      this._lastRenderKey = null;
    }

    refresh(): void {
      const key = `${settingsSignature()}|${this.currentThemeId}`;
      if (key === this._lastRenderKey) return;
      this._lastRenderKey = key;
      this.renderBody();
    }

    // —— 订阅生命周期 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._adapter || this._unsubscribe) return;
      this._unsubscribe = this._adapter.subscribe((state) => {
        this._state = state;
        this.refresh();
      });
      // 皮肤订阅（@since v3.6，task_115）：设置屏开着时用户可能从顶栏 ⋯ 菜单切皮肤 ——
      //   高亮必须跟上，否则看着像「切了没生效」。
      this._unsubscribeTheme = this._adapter.subscribeTheme(() => this.refresh());
    }

    private releaseAdapter(): void {
      this._unsubscribeTheme?.();
      this._unsubscribeTheme = null;
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // —— 交互 → HudCommand ——
    /**
     * 皮肤：只发 theme.set，落 token 由 hud/bridge/bus-adapter 在入口处完成（不经 core 绕一圈）。
     * @since v3.6（task_115）：本屏**不再自存一份 themeId** —— dispatch 之后主题控制器已是新皮肤，
     *   高亮直接读 adapter.themeId（刷新后恢复的皮肤也自动对得上）。
     */
    private selectTheme(themeId: ThemeId): void {
      if (themeId === this.currentThemeId) return;
      this._adapter?.dispatch({ type: 'theme.set', themeId });
      this.refresh();
    }

    /**
     * 偏好开关：写本机持久层（localStorage）+ 本屏重画（@since v3.6，task_116）。
     *   why 不发 settings.set：core 从未接线那条命令，派发出去只会等不到广播（死功能 #4）；
     *   why 不做"本地乐观更新"：写完 localStorage 立刻**重读**再画 —— 值来自持久层，
     *   不是内存里的临时计数，所以刷新后仍是同一个值（这正是验收要的"刷新后仍保持"）。
     */
    private togglePreference(row: PreferenceRowSpec): void {
      const next = !readPreference(row.storageKey);
      // 音效行走声音引擎的写入口（@since v3.8，task_139）：写完广播一声，
      //   顶栏那个声音钮立刻跟着变（图标 / aria-pressed）—— 以前两处各写各的，
      //   这里改了顶栏不动，看着像"开关没生效"。
      if (row.storageKey === SOUND_ENABLED_KEY) writeSoundEnabled(next);
      else writePreference(row.storageKey, next);
      this.renderBody();
    }

    /**
     * 音量落地（@since v3.6，task_116 建 / @since v3.7，task_130 收敛）：**只写一把闸**。
     *   why 一把：声音引擎（task_083）与音效服务（task_060）现在读**同一个**键
     *   （stratix.sound.volume，0-100 口径）—— 收敛前是两个键（0-100 / 0-1 各一份），
     *   拖滑条只跟着一半变，留下一条"音量控件半截生效"的错觉。
     *   why 写完不重画：滑条正在被拖，重建 DOM 会把这次拖拽掐断（改为就地更新标题与档位文字）。
     */
    private applyVolume(percent: number): number {
      const clamped = Math.min(100, Math.max(0, Math.round(percent)));
      writeSoundVolume(clamped);
      return clamped;
    }

    /** 音量档位按钮：点击 = 切到下一档（静音 → 30 → 70 → 100 → 静音）。
     *   why 有档位而不是只有滑条：小控件上"拖到哪算哪"不可预期，
     *   档位是能被一眼看懂、被一次点击点出来的交互（死功能 #5 的正解）。 */
    private cycleVolume(): void {
      const next = nextVolumePreset(readSoundVolume());
      this.applyVolume(next);
      this.renderBody();
    }

    /**
     * 危险动作第一步：弹确认框（不发命令）。@since v3.6（task_116）：确认框是**遮罩 + 居中面板**
     *   （与 task_112 新建任务对话框同一模式），不再挤在行内 —— 破坏性动作要「看得见地问一次」。
     */
    private armDanger(id: DangerActionId): void {
      this._pending = id;
      this.renderConfirm();
      // 登记进遮挡栈：ESC 由控制器统一路由到栈顶（先关确认框，不连带关设置屏）。
      this._occlusion?.openModal(DANGER_CONFIRM_OCCLUSION_ID, () => this.cancelDanger());
      this.bindEsc();
    }

    /** 危险动作第二步：确认后才发命令，随后立刻退出确认态（设置屏不退出 —— 不莫名退屏）。 */
    private fireDanger(id: DangerActionId): void {
      this.cancelDanger();
      this._adapter?.dispatch({ type: id });
    }

    private cancelDanger(): void {
      this._pending = null;
      this._occlusion?.closeModal(DANGER_CONFIRM_OCCLUSION_ID);
      this.unbindEsc();
      this.renderConfirm();
    }

    /** 卸掉确认框的一切登记（遮罩栈 + ESC 监听）—— 资源必须可清理（perf 硬约束）。 */
    private releaseConfirm(): void {
      this._pending = null;
      this._occlusion?.closeModal(DANGER_CONFIRM_OCCLUSION_ID);
      this.unbindEsc();
      this.renderConfirm();
    }

    /**
     * ESC 兜底监听（确认框开着时）：没有遮挡控制器时也能用键盘取消。
     *   why 兜底而不是只依赖控制器：单测 / 非 Electron 降级路径没有控制器，ESC 不能失灵。
     *   why 挂在 document：焦点可能在按钮上，也可能在面板别处 —— document 才收得到。
     */
    private bindEsc(): void {
      if (this._escBound) return;
      this._escBound = true;
      document.addEventListener('keydown', this.onDocumentKeydown);
    }

    private unbindEsc(): void {
      if (!this._escBound) return;
      this._escBound = false;
      document.removeEventListener('keydown', this.onDocumentKeydown);
    }

    private onDocumentKeydown = (ev: KeyboardEvent): void => {
      // 只在确认框开着时接管 ESC；没开就让设置屏自己的弹窗壳（ESC 关设置屏）处理。
      if (ev.key !== 'Escape' || this._pending === null) return;
      this.cancelDanger();
    };

    private backToMain(): void {
      this._adapter?.dispatch({ type: 'ui.navigate', screen: 'main' });
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
            font-size: var(--srf-font-size-body);
            line-height: var(--srf-line-height-body);
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
          .title { font-size: var(--srf-font-size-title); font-weight: var(--srf-font-weight-semibold); }
          .body {
            display: grid;
            gap: var(--srf-spacing-lg);
            align-content: start;
            grid-template-columns: minmax(0, 1fr);
            max-width: 760px;
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
          .group-name { color: var(--srf-text-muted); font-size: var(--srf-font-size-caption); font-weight: var(--srf-font-weight-semibold); letter-spacing: 0.04em; }
          .group[data-group="danger"] { border-color: var(--srf-danger); }
          .row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: var(--srf-spacing-md);
            padding: var(--srf-spacing-md);
            background: var(--srf-panel-elevated);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
          }
          .row-text { display: grid; gap: var(--srf-spacing-xs); min-width: 0; }
          .row-label { font-weight: var(--srf-font-weight-semibold); }
          .row-hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-caption); }
          .row-ctl { display: flex; align-items: center; gap: var(--srf-spacing-sm); }
          button.ctl {
            padding: var(--srf-spacing-xs) var(--srf-spacing-md);
            background: transparent;
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border-strong);
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-body);
            cursor: pointer;
            transition: color var(--srf-motion-hover), background var(--srf-motion-hover), border-color var(--srf-motion-hover);
          }
          button.ctl:hover { background: var(--srf-panel); border-color: var(--srf-accent); }
          button.ctl:active { color: var(--srf-accent-hover); }
          button.ctl:focus-visible, input.ctl-range:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.ctl:disabled { color: var(--srf-text-disabled); border-color: var(--srf-border); cursor: not-allowed; opacity: 0.65; }
          button.ctl[data-skin][data-active="true"] { color: var(--srf-accent); border-color: var(--srf-accent); }
          button.ctl[data-skin][data-active="false"] { color: var(--srf-text-muted); }
          button.ctl[role="switch"][aria-checked="true"] { color: var(--srf-success); border-color: var(--srf-success); }
          input.ctl-range { width: 110px; accent-color: var(--srf-accent); cursor: pointer; }
          input.ctl-range:disabled { cursor: not-allowed; opacity: 0.5; }
          button.ctl[data-danger], button.ctl[data-danger-confirm] { color: var(--srf-danger); border-color: var(--srf-danger); }
          .readonly {
            padding: var(--srf-spacing-xs) var(--srf-spacing-md);
            color: var(--srf-text-muted);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            font-size: var(--srf-font-size-body);
          }
          /* 危险区确认框（@since v3.6）：全屏遮罩 + 居中面板 —— 与 
             新建任务对话框同一模式（R1 模态 + R4 双关闭途径）。
             why 放影子树里而不是宿主外：本屏就是模态，确认框是它的下一层，宿主外会脱离层级。 */
          .confirm-layer {
            position: fixed;
            inset: 0;
            z-index: ${zVar('max')}; /* 高于 modal shell 与 toast(50)：确认框是当前焦点面 */
            display: flex;
            align-items: center;
            justify-content: center;
            padding: var(--srf-spacing-xl);
            box-sizing: border-box;
            background: var(--srf-backdrop);
          }
          .confirm-layer[hidden] { display: none; }
          .confirm-panel {
            width: min(460px, 92vw);
            display: grid;
            gap: var(--srf-spacing-md);
            padding: var(--srf-spacing-lg);
            background: var(--srf-panel);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-danger);
            border-radius: var(--srf-radius);
            box-shadow: var(--srf-shadow-lg);
          }
          .confirm-title { font-size: var(--srf-font-size-title); font-weight: var(--srf-font-weight-semibold); }
          .confirm-hint { color: var(--srf-text-muted); font-size: var(--srf-font-size-caption); }
          .confirm-actions { display: flex; justify-content: flex-end; gap: var(--srf-spacing-sm); }
        ${MOTION_REDUCED_CSS}
        </style>
        <div class="screen" part="screen">
          <div class="topbar">
            <span class="title">设置</span>
            <${STRAT_BUTTON_TAG} label="返回主屏" variant="default" data-role="back"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="body" data-role="body"></div>
        </div>
        <div class="confirm-layer" data-role="danger-confirm-layer" hidden></div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 事件委托绑在外壳上：内容区是重建的，绑在每行上会随重渲染反复泄漏（perf 硬约束）。
        // 四类事件都要委托：原生控件发 click，strat-button 发的是 strat-button-click，
        // 音量滑条（task_060）发 input（拖动即写，不等 change —— 松手才生效太迟钝），
        // 确认框遮罩发 click（点遮罩 = 取消，R4 的双关闭途径之一）。
        root.addEventListener('click', (ev: Event) => this.onClick(ev));
        root.addEventListener('strat-button-click', (ev: Event) => this.onClick(ev));
        root.addEventListener('input', (ev: Event) => this.onInput(ev));
      }
    }

    /**
     * 危险区确认框的渲染（@since v3.6，task_116）。
     *   独立于 renderBody：确认框是**浮层**，不能被内容区的重绘顺带抹掉。
     */
    private renderConfirm(): void {
      const root = this.shadowRoot;
      const layer = root?.querySelector<HTMLElement>('[data-role="danger-confirm-layer"]');
      if (!root || !layer) return;
      const id = this._pending;
      if (!id) {
        layer.hidden = true;
        layer.innerHTML = '';
        return;
      }
      const action = DANGER_ACTIONS.find((item) => item.id === id);
      layer.hidden = false;
      layer.innerHTML = `
        <div class="confirm-panel" data-role="confirm-${escapeHtml(id)}" role="dialog" aria-modal="true">
          <div class="confirm-title">确认「${escapeHtml(action?.label ?? id)}」？</div>
          <div class="confirm-hint">${escapeHtml(action?.hint ?? '')}</div>
          <div class="confirm-actions">
            <button type="button" class="ctl" data-danger-confirm="${escapeHtml(id)}">确认执行</button>
            <button type="button" class="ctl" data-danger-cancel="${escapeHtml(id)}">取消</button>
          </div>
        </div>
      `;
    }

    /** 滑条输入（task_060 / @since v3.6 task_116 音量改接声音引擎）：音量即拖即写 localStorage。
     *  引擎下次播放现读 —— 无需重画本屏（滑条自己显示着值），也不发命令（localStorage 是唯一真相）。
     *  why 就地更新标题与档位文字而不重画：正在拖的滑条被重建 DOM 替换掉，这次拖拽就断了。 */
    private onInput(ev: Event): void {
      const target = ev.target as HTMLElement | null;
      const slider = target?.closest<HTMLInputElement>('input[data-role="sfx-volume"]');
      if (!slider) return;
      const value = parseFloat(slider.value);
      if (!Number.isFinite(value)) return;
      const clamped = this.applyVolume(value);
      // title 同步更新（音量值就在标题里 —— 悬停即知当前档位）。
      const label = volumeLabel(clamped);
      slider.title = `音量 ${label}`;
      const preset = this.shadowRoot?.querySelector<HTMLElement>('button[data-role="sfx-volume-preset"]');
      if (preset) {
        preset.textContent = label;
        preset.title = `音量 ${label}（点击切换档位）`;
        preset.setAttribute('aria-label', `音量 ${label}`);
      }
    }

    /** 一个 click 可能来自多处（皮肤 chip / 开关 / 危险区两步 / 返回），按 data-* 就近解析。 */
    private onClick(ev: Event): void {
      const target = ev.target as HTMLElement | null;
      if (!target?.closest) return;

      // 返回主屏走 strat-button（顶层导航动作，与 main-screen 同一约定）
      if ((ev as CustomEvent).type === 'strat-button-click' && target.closest('[data-role="back"]')) {
        this.backToMain();
        return;
      }
      if (ev.type !== 'click') return;

      const skin = target.closest<HTMLElement>('button[data-skin]');
      if (skin) {
        const id = skin.getAttribute('data-skin');
        if (id === 'default' || id === 'pixel') this.selectTheme(id);
        return;
      }

      // 音量档位按钮（@since v3.6，task_116）：点击 = 切到下一档（静音/30/70/100），
      //   写完就地重画（档位文字与标题跟着变）—— 不发命令（localStorage 是唯一真相）。
      const preset = target.closest<HTMLElement>('button[data-role="sfx-volume-preset"]');
      if (preset) {
        this.cycleVolume();
        return;
      }

      // 偏好开关（@since v3.6，task_116）：四行统一走 localStorage 直写 —— 一条路径处理，
      // 行与键的对应关系在 PREFERENCE_ROWS 词表里（DOM 上带 data-storage-key 可断言）。
      const pref = target.closest<HTMLElement>('button[data-pref]');
      if (pref) {
        const id = pref.getAttribute('data-pref');
        const row = PREFERENCE_ROWS.find((item) => item.id === id);
        if (row) this.togglePreference(row);
        return;
      }

      // 自定义 agent 注册移除（@since v3.32，task_056）：一行一按钮，直接移（向导/设置两个入口同语义）。
      const customRemove = target.closest<HTMLElement>('button[data-custom-remove]');
      if (customRemove) {
        this.removeCustomAgent(customRemove.getAttribute('data-custom-remove') ?? '');
        return;
      }

      const confirm = target.closest<HTMLElement>('button[data-danger-confirm]');
      if (confirm) {
        const id = confirm.getAttribute('data-danger-confirm');
        if (isDangerActionId(id)) this.fireDanger(id);
        return;
      }

      const cancel = target.closest<HTMLElement>('button[data-danger-cancel]');
      if (cancel) {
        this.cancelDanger();
        return;
      }

      const danger = target.closest<HTMLElement>('button[data-danger]');
      if (danger) {
        const id = danger.getAttribute('data-danger');
        if (isDangerActionId(id)) this.armDanger(id);
        return;
      }

      // 点确认框的遮罩 = 取消（R4 的双关闭途径之一：ESC + 点遮罩）。
      // why 判 target === 遮罩本身：面板里的点击会冒泡上来，不能一并取消。
      const layer = target.closest<HTMLElement>('[data-role="danger-confirm-layer"]');
      if (layer && target === layer) {
        this.cancelDanger();
      }
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="body"]');
      if (!root || !box) return;

      const sections: string[] = [
        this.renderAppearance(),
        this.renderPreferences(),
        // 自定义 agent 注册管理（@since v3.32，task_056）：端口注入了才渲染（非 Electron 降级）。
        ...(this._customAgents ? [this.renderCustomAgents()] : []),
        this.renderDanger(),
      ];
      box.innerHTML = sections.join('');
    }

    // —— 自定义 agent 注册管理（@since v3.32，task_056）——
    /** 拉注册行快照：成功补画（renderBody），失败给只读提示（设置屏不能被注册表卡死）。 */
    private loadCustomAgents(): void {
      const port = this._customAgents;
      if (!port) return;
      void port
        .list()
        .then((result) => {
          this._customRows = result.ok && result.agents ? result.agents : [];
          this._customRowsLoaded = true;
          this._customNotice = result.ok ? null : result.error ?? '读取自定义 agent 列表失败';
        })
        .catch((error: unknown) => {
          this._customRowsLoaded = true;
          this._customNotice = error instanceof Error ? error.message : String(error);
        })
        .finally(() => {
          if (this.isConnected) this.renderBody();
        });
    }

    /** 移除一条注册：断的是检测行（角色档案保留 —— task_056 规格⑤）；成功后重拉列表。 */
    private removeCustomAgent(id: string): void {
      const port = this._customAgents;
      if (!port || id.length === 0) return;
      this._customNotice = '正在移除注册…';
      this.renderBody();
      void port
        .remove(id)
        .then((result) => {
          this._customNotice = result.ok ? null : result.error ?? '移除失败';
        })
        .catch((error: unknown) => {
          this._customNotice = error instanceof Error ? error.message : String(error);
        })
        .finally(() => this.loadCustomAgents());
    }

    private renderCustomAgents(): string {
      const rows = this._customRows;
      const list = !this._customRowsLoaded
        ? '<div class="row-hint">正在读取自定义 agent 列表…</div>'
        : rows.length === 0
          ? '<div class="row-hint">还没有自定义 agent 注册（首启向导的扫描步里添加）</div>'
          : rows
              .map(
                (agent) => `
          <div class="row" data-role="custom-agent-row" data-id="${escapeHtml(agent.id)}">
            <div class="row-text">
              <span class="row-label">${escapeHtml(agent.name)}</span>
              <span class="row-hint">${escapeHtml(agent.probeCmd)} · 解析器 ${agent.outputParser === 'json' ? 'json（提字段）' : 'plain（整段）'}</span>
            </div>
            <div class="row-ctl">
              <button type="button" class="ctl" data-custom-remove="${escapeHtml(agent.id)}">移除注册</button>
            </div>
          </div>`
              )
              .join('');
      const notice = this._customNotice
        ? `<div class="row-hint" data-role="custom-agent-notice">${escapeHtml(this._customNotice)}</div>`
        : '';
      return `
        <div class="group" data-group="custom-agents">
          <div class="group-name">自定义 agent</div>
          <div class="row-hint">移除注册只是不再检测它、也不再派活给它：已建的角色档案保留（不再参与检测与健康监测）。新增注册在首启向导的扫描步。</div>
          ${notice}
          ${list}
        </div>
      `;
    }

    private renderAppearance(): string {
      const skins = SKIN_OPTIONS.map(
        (skin) => `
          <button type="button" class="ctl" data-skin="${skin.id}" data-active="${skin.id === this.currentThemeId}"
                  title="${skin.hint}">${skin.label}</button>`
      ).join('');

      return `
        <div class="group" data-group="appearance">
          <div class="group-name">外观</div>
          <div class="row">
            <div class="row-text">
              <span class="row-label">皮肤</span>
              <span class="row-hint">整屏配色与字号一起切换，界面各处自动跟着变</span>
            </div>
            <div class="row-ctl">${skins}</div>
          </div>
          <div class="row">
            <div class="row-text">
              <span class="row-label">语言</span>
              <span class="row-hint">当前版本仅内置一种语言，多语言尚未落地</span>
            </div>
            <div class="row-ctl"><span class="readonly" data-role="language">${LANGUAGE_LABEL}</span></div>
          </div>
        </div>
      `;
    }

    /**
     * 偏好组（@since v3.6，task_116）：四行统一走 localStorage 直写。
     *   值每次渲染时现读（不存第二份真相）；点击 → 写键 → 重画 → 文字在「开 / 关」之间翻转。
     *   DOM 上带 data-storage-key：单测 / e2e 不用猜键名就能断言"写进了哪一格"。
     */
    private renderPreferences(): string {
      const rows = PREFERENCE_ROWS.map((row) => {
        const on = readPreference(row.storageKey);
        // 音效行多一个音量控件（@since v3.6，task_116）：档位按钮 + 滑条，写声音引擎的音量键。
        const extra = row.id === 'sfx' ? this.renderSfxVolume() : '';
        const legacy = row.legacyAttr ? ` ${row.legacyAttr}="1"` : '';
        return `
          <div class="row" data-pref-row="${row.id}">
            <div class="row-text">
              <span class="row-label">${row.label}</span>
              <span class="row-hint">${row.hint}</span>
            </div>
            <div class="row-ctl">
              ${extra}
              <button type="button" class="ctl" role="switch" aria-checked="${on}"
                      data-pref="${row.id}" data-storage-key="${row.storageKey}"${legacy}>${on ? '开' : '关'}</button>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="group" data-group="preferences">
          <div class="group-name">偏好</div>
          ${rows}
        </div>
      `;
    }

    /**
     * 音效行的音量控件（@since v3.6，task_116）：档位按钮 + 滑条，都写声音引擎的音量键。
     *   why 按钮 + 滑条都要：按钮给"点一下就换一个值"（死功能 #5 的正解），
     *   滑条给"我要 45%"的细调 —— 两者写的是同一个真相源（stratix.sound.volume）。
     */
    private renderSfxVolume(): string {
      const volume = readSoundVolume();
      const label = volumeLabel(volume);
      return `
        <button type="button" class="ctl" data-role="sfx-volume-preset"
                title="音量 ${label}（点击切换档位）" aria-label="音量 ${label}">${label}</button>
        <input type="range" class="ctl-range" min="0" max="100" step="5" value="${volume}"
               data-role="sfx-volume" aria-label="音效音量"
               title="音量 ${label}">
      `;
    }

    private renderDanger(): string {
      const rows = DANGER_ACTIONS.map((action) => {
        // 未落地的命令不给可点按钮（@since v3.6，task_116）：假按钮禁令 ——
        //   一个点了没反应的按钮比没有按钮更糟。行还在，说明白它为什么不能点。
        const ctl = action.implemented
          ? `<button type="button" class="ctl" data-danger="${action.id}">${action.buttonLabel}</button>`
          : `<button type="button" class="ctl" disabled
               title="该命令尚未落地（目前没有实际处理）">${action.buttonLabel}</button>`;
        return `
          <div class="row" data-danger-row="${action.id}">
            <div class="row-text">
              <span class="row-label">${action.label}</span>
              <span class="row-hint">${action.hint}</span>
            </div>
            <div class="row-ctl">${ctl}</div>
          </div>
        `;
      }).join('');

      return `
        <div class="group" data-group="danger">
          <div class="group-name">危险区 · 需二次确认</div>
          ${rows}
        </div>
      `;
    }
  }

  customElements.define(SETTINGS_SCREEN_TAG, SettingsScreen);
  return SettingsScreen as unknown as typeof HTMLElement;
}

/** 危险动作 id 收窄：DOM 上的 data-* 是外部输入，必须校验后才当命令 type 用（不猜、不静默吞）。 */
function isDangerActionId(value: string | null): value is DangerActionId {
  return DANGER_ACTIONS.some((action) => action.id === value);
}

/**
 * 挂载工厂：本仓库屏 / 面板的统一装配口径（与 mountMissionConfirm 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 *   options.occlusion：危险区确认框登记进遮挡栈用（ESC 只关栈顶 —— 不连带关设置屏）。
 */
export function mountSettingsScreen(
  deps: SettingsScreenDeps,
  host: HTMLElement,
  options: {
    readonly customAgents?: CustomAgentsPort | null;
    readonly occlusion?: OcclusionController | null;
  } = {}
): () => void {
  defineSettingsScreen();
  const element = document.createElement(SETTINGS_SCREEN_TAG) as StratSettingsScreenElement;
  element.adapter = deps;
  element.occlusion = options.occlusion ?? null;
  if (options.customAgents) element.customAgents = options.customAgents;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}