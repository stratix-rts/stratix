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
 *   4. 本地改偏好值 —— 开关的当前值只认 core 广播的 WorldState.settings，本屏一改就发命令等回广播
 *      （本地乐观更新会让"点了没反应"变得不可排查，而 core 判非法时还会回一条 Notice）；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）。
 *
 * 三组设置各自的真相源（why 这么分，混在一起就会出现"两个真相"）：
 *   - 外观：皮肤**只经 theme.set**，由 hud/bridge/bus-adapter 本地落 token（见 theme-controller）。
 *     契约里没有回读通道（core 侧 theme.set 目前只记账，见 core/runtime.ts TODO），
 *     所以本屏保留一份**纯展示态** themeId 供高亮当前项 —— 与 main-screen 同一口径，
 *     绝不用它当真相（真相同在 DOM 上的 token 上，单测直接断言 token 切换）。
 *   - 偏好：唯一真相是 core 的 WorldState.settings（契约可选字段，缺省回落 DEFAULT_SETTINGS）。
 *   - 危险区：破坏性动作，一律两步确认（先点按钮、再点确认）才发命令。
 *
 * 语言显示：只读。当前契约没有 locale 字段（core/types.ts 未定义语言域），
 * 本屏只如实显示"当前版本内置的语言"，不编造可切换的下拉 ——
 * TODO(v3.i18n): 语言落地后由 core 提供 settings.locale，此处改为可选并复用 settings.set 的同一落库路径。
 *
 * 渲染策略（perf，与 command-panel / agent-panel / mission-confirm 同一口径）：
 *   core 每次状态变更都全量广播，本屏用 settingsSignature 判重 —— 只有偏好值变了才重绘，
 *   单位 / 任务 / 日志的变动一律不触发本屏重渲染。
 *
 * 本屏不渲染任何用户输入（所有文案都是契约内的静态标签），因此不需要 HTML 转义函数。
 */

import {
  DEFAULT_SETTINGS,
  STRATIX_CONTEXT_TOGGLE_KEY,
  type BooleanPreferenceKey,
  type SettingsView,
  type WorldState,
} from '../../core/types';
import type { HudBusAdapter } from '../bridge/bus-adapter';
import type { ThemeId } from '../theme/theme-controller';
import { defineStratButton, STRAT_BUTTON_TAG } from '../widgets/strat-button';

export const SETTINGS_SCREEN_TAG = 'strat-settings-screen';

/** 本屏需要的最小能力面：只要"发命令"与"订阅状态"，与 panels 同一约定。 */
export type SettingsScreenDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

// ============================================================================
// 词表（静态标签集中一处：渲染与单测共用同一份，不各写一套中文）
// ============================================================================

/** 可选皮肤。取值与 hud/theme 的 ThemeId 一一对应，切换靠 HudCommand theme.set。 */
export const SKIN_OPTIONS: readonly { id: ThemeId; label: string; hint: string }[] = [
  { id: 'default', label: '现代', hint: '圆角与细边框的默认皮肤' },
  { id: 'pixel', label: '像素', hint: '直角硬边框的像素皮肤' },
];

/** 偏好开关的展示元数据。key 与契约 BooleanPreferenceKey 对齐 —— 改词表必须先改 core/types.ts。 */
export const PREFERENCE_ROWS: readonly {
  key: BooleanPreferenceKey;
  label: string;
  hint: string;
}[] = [
  { key: 'soundEnabled', label: '音效', hint: '操作与事件反馈音' },
  { key: 'notificationsEnabled', label: '通知提示', hint: '新任务、连接状态等横幅提示' },
];

/** 危险区动作 id。与 HudCommand 的 selection.reset / cache.clear 一一对应（派发时原样当 type 用）。 */
export type DangerActionId = 'selection.reset' | 'cache.clear';

export const DANGER_ACTIONS: readonly {
  id: DangerActionId;
  label: string;
  buttonLabel: string;
  hint: string;
}[] = [
  {
    id: 'selection.reset',
    label: '重置编组',
    buttonLabel: '重置编组',
    hint: '清空当前选择集（当前多选编组）。不影响任务与角色数据。',
  },
  {
    id: 'cache.clear',
    label: '清理缓存',
    buttonLabel: '清理缓存',
    hint: '丢弃本地缓存数据。缓存层落地前该命令在 core 侧为空处理。',
  },
];

/** 语言只读展示值。TODO(v3.i18n)：语言域落地后由 core 提供，这里不再硬编码。 */
export const LANGUAGE_LABEL = '简体中文';

// ============================================================================
// 派生模型（纯函数，可脱离 DOM 单测）
// ============================================================================

/** 危险区确认态。null = 没有任何一行在等二次确认。 */
export type PendingDanger = DangerActionId | null;

export interface SettingsScreenModel {
  /** 当前皮肤（纯展示态，真相同 DOM token —— 见文件头说明）。 */
  readonly themeId: ThemeId;
  /** 偏好当前值：WorldState.settings 缺省时回落契约默认值。 */
  readonly preferences: SettingsView;
  /** 正在等二次确认的危险动作。 */
  readonly pending: PendingDanger;
}

/** 读取偏好：契约里 settings 是可选字段，缺省回落 DEFAULT_SETTINGS（两侧共用同一个默认值）。 */
export function resolvePreferences(state: WorldState | null): SettingsView {
  return state?.settings ?? DEFAULT_SETTINGS;
}

export function resolveSettings(state: WorldState | null, themeId: ThemeId): SettingsScreenModel {
  return { themeId, preferences: resolvePreferences(state), pending: null };
}

/**
 * 渲染判重签名（O(偏好项数)，纯字符串拼接）。
 * 只含影响本屏显示的东西：两条偏好值。单位 / 任务 / 日志变动一律不触发本屏重绘。
 */
export function settingsSignature(state: WorldState | null): string {
  const prefs = resolvePreferences(state);
  return `${prefs.soundEnabled}|${prefs.notificationsEnabled}`;
}

/** 自定义元素的对外形状（测试与挂载方按它断言）。 */
export interface StratSettingsScreenElement extends HTMLElement {
  /** 注入的适配器；connected 之前或之后设置都生效。 */
  adapter: SettingsScreenDeps | null;
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
    private _themeId: ThemeId = 'default';
    private _pending: PendingDanger = null;
    private _lastRenderKey: string | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _listenersBound = false;

    get adapter(): SettingsScreenDeps | null { return this._adapter; }
    set adapter(value: SettingsScreenDeps | null) {
      this._adapter = value;
      this.bindAdapter();
      this.refresh();
    }

    get lastState(): WorldState | null { return this._state; }
    get currentThemeId(): ThemeId { return this._themeId; }
    get model(): SettingsScreenModel {
      return { themeId: this._themeId, preferences: resolvePreferences(this._state), pending: this._pending };
    }

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
      this._lastRenderKey = null;
    }

    refresh(): void {
      const key = `${settingsSignature(this._state)}|${this._themeId}|${this._pending ?? ''}`;
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
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // —— 交互 → HudCommand ——
    /** 皮肤：只发 theme.set，落 token 由 hud/bridge/bus-adapter 在入口处完成（不经 core 绕一圈）。 */
    private selectTheme(themeId: ThemeId): void {
      if (themeId === this._themeId) return;
      this._themeId = themeId;
      this._adapter?.dispatch({ type: 'theme.set', themeId });
      this.refresh();
    }

    /** 偏好开关：只发 settings.set；新值一律按 core 广播回填，本屏不预改。 */
    private togglePreference(key: BooleanPreferenceKey): void {
      const prefs = resolvePreferences(this._state);
      this._adapter?.dispatch({ type: 'settings.set', key, value: !prefs[key] });
    }

    /** 危险动作第一步：进入确认态（不发命令）。同组再点别的行则改确认目标。 */
    private armDanger(id: DangerActionId): void {
      this._pending = id;
      this.refresh();
    }

    /** 危险动作第二步：确认后才发命令，随后立刻退出确认态。 */
    private fireDanger(id: DangerActionId): void {
      this._pending = null;
      this._adapter?.dispatch({ type: id });
      this.refresh();
    }

    private cancelDanger(): void {
      this._pending = null;
      this.refresh();
    }

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
          .body {
            display: grid;
            gap: var(--srf-spacing-md, 12px);
            align-content: start;
            /* 单列、限宽居中：设置项是长阅读文本，多列会把标签与控件拉得过散 */
            grid-template-columns: minmax(0, 1fr);
            max-width: 760px;
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
          .group[data-group="danger"] { border-color: var(--srf-danger, #e06c75); }
          .row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            align-items: center;
            gap: var(--srf-spacing-sm, 8px);
            padding: var(--srf-spacing-sm, 8px);
            background: var(--srf-panel-elevated, #20262f);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
          }
          .row-text { display: grid; gap: var(--srf-spacing-xs, 4px); min-width: 0; }
          .row-label { font-weight: 600; }
          .row-hint { color: var(--srf-text-muted, #9aa3b2); font-size: var(--srf-font-size-sm, 12px); }
          .row-ctl { display: flex; align-items: center; gap: var(--srf-spacing-sm, 8px); }
          button.ctl {
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-md, 12px);
            background: transparent;
            color: var(--srf-text, #e6e9ef);
            border: var(--srf-border-width, 1px) solid var(--srf-border-strong, #3a4252);
            border-radius: var(--srf-radius, 6px);
            font-family: var(--srf-font-ui, sans-serif);
            font-size: var(--srf-font-size-sm, 12px);
            cursor: pointer;
          }
          button.ctl:hover { border-color: var(--srf-accent, #6ea8ff); }
          button.ctl[data-skin][data-active="true"] {
            color: var(--srf-accent, #6ea8ff);
            border-color: var(--srf-accent, #6ea8ff);
          }
          button.ctl[data-skin][data-active="false"] { color: var(--srf-text-muted, #9aa3b2); }
          button.ctl[role="switch"][aria-checked="true"] {
            color: var(--srf-success, #6fcf97);
            border-color: var(--srf-success, #6fcf97);
          }
          button.ctl[data-danger], button.ctl[data-danger-confirm] {
            color: var(--srf-danger, #e06c75);
            border-color: var(--srf-danger, #e06c75);
          }
          .readonly {
            padding: var(--srf-spacing-xs, 4px) var(--srf-spacing-md, 12px);
            color: var(--srf-text-muted, #9aa3b2);
            border: var(--srf-border-width, 1px) solid var(--srf-border, #2a313d);
            border-radius: var(--srf-radius, 6px);
            font-size: var(--srf-font-size-sm, 12px);
          }
          .confirm { display: inline-flex; align-items: center; gap: var(--srf-spacing-xs, 4px); }
        </style>
        <div class="screen" part="screen">
          <div class="topbar">
            <span class="title">设置</span>
            <${STRAT_BUTTON_TAG} label="返回主屏" variant="default" data-role="back"></${STRAT_BUTTON_TAG}>
          </div>
          <div class="body" data-role="body"></div>
        </div>
      `;

      if (!this._listenersBound) {
        this._listenersBound = true;
        // 事件委托绑在外壳上：内容区是重建的，绑在每行上会随重渲染反复泄漏（perf 硬约束）。
        // 两类事件都要委托：原生控件发 click，strat-button 发的是 strat-button-click。
        root.addEventListener('click', (ev: Event) => this.onClick(ev));
        root.addEventListener('strat-button-click', (ev: Event) => this.onClick(ev));
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

      const pref = target.closest<HTMLElement>('button[data-pref]');
      if (pref) {
        const key = pref.getAttribute('data-pref');
        if (isPreferenceKey(key)) this.togglePreference(key);
        return;
      }

      // 上下文注入全局开关（task_053）：localStorage 直写 + 本屏重画（不进总线 ——
      // app 层 provider 读同一键；为什么不是 settings.set 见 core/types.ts 键常量注释）。
      const contextToggle = target.closest<HTMLElement>('button[data-context-toggle]');
      if (contextToggle) {
        const next = !readContextToggle();
        writeContextToggle(next);
        this.renderBody();
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
      }
    }

    private renderBody(): void {
      const root = this.shadowRoot;
      const box = root?.querySelector('[data-role="body"]');
      if (!root || !box) return;

      const prefs = resolvePreferences(this._state);
      const sections: string[] = [
        this.renderAppearance(),
        this.renderPreferences(prefs),
        this.renderDanger(),
      ];
      box.innerHTML = sections.join('');
    }

    private renderAppearance(): string {
      const skins = SKIN_OPTIONS.map(
        (skin) => `
          <button type="button" class="ctl" data-skin="${skin.id}" data-active="${skin.id === this._themeId}"
                  title="${skin.hint}">${skin.label}</button>`
      ).join('');

      return `
        <div class="group" data-group="appearance">
          <div class="group-name">外观</div>
          <div class="row">
            <div class="row-text">
              <span class="row-label">皮肤</span>
              <span class="row-hint">整屏 token 一起切换，组件零改动</span>
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

    private renderPreferences(prefs: SettingsView): string {
      const rows = PREFERENCE_ROWS.map((row) => {
        const on = prefs[row.key];
        return `
          <div class="row" data-pref-row="${row.key}">
            <div class="row-text">
              <span class="row-label">${row.label}</span>
              <span class="row-hint">${row.hint}</span>
            </div>
            <div class="row-ctl">
              <button type="button" class="ctl" role="switch" aria-checked="${on}"
                      data-pref="${row.key}">${on ? '开' : '关'}</button>
            </div>
          </div>
        `;
      }).join('');

      // 上下文注入全局开关（task_053）：localStorage 落地（不进 WorldState / 广播 ——
      // 只在本机渲染进程生效的增强项开关，取舍见 core/types.ts 的键常量注释）。
      // 状态每次从 localStorage 现读（不存第二份真相；无 localStorage 环境视为开）。
      const contextOn = readContextToggle();
      const contextRow = `
        <div class="row" data-pref-row="__context__">
          <div class="row-text">
            <span class="row-label">上下文注入</span>
            <span class="row-hint">对话 / 任务首发附带战场现状（角色级开关在侧栏角色卡）</span>
          </div>
          <div class="row-ctl">
            <button type="button" class="ctl" role="switch" aria-checked="${contextOn}"
                    data-context-toggle="1">${contextOn ? '开' : '关'}</button>
          </div>
        </div>
      `;

      return `
        <div class="group" data-group="preferences">
          <div class="group-name">偏好</div>
          ${rows}
          ${contextRow}
        </div>
      `;
    }

    private renderDanger(): string {
      const rows = DANGER_ACTIONS.map((action) => {
        const armed = this._pending === action.id;
        const confirm = armed
          ? `<span class="confirm" data-role="confirm-${action.id}">
               <span class="readonly">确认？</span>
               <button type="button" class="ctl" data-danger-confirm="${action.id}">确认</button>
               <button type="button" class="ctl" data-danger-cancel="${action.id}">取消</button>
             </span>`
          : `<button type="button" class="ctl" data-danger="${action.id}">${action.buttonLabel}</button>`;
        return `
          <div class="row" data-danger-row="${action.id}">
            <div class="row-text">
              <span class="row-label">${action.label}</span>
              <span class="row-hint">${action.hint}</span>
            </div>
            <div class="row-ctl">${confirm}</div>
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

/** 偏好键收窄：DOM 上的 data-pref 是外部输入，必须校验后才当契约键用（不猜、不静默吞）。 */
function isPreferenceKey(value: string | null): value is BooleanPreferenceKey {
  return PREFERENCE_ROWS.some((row) => row.key === value);
}

/**
 * 上下文注入全局开关的 localStorage 读写（task_053）。为什么直接读 localStorage 而不走
 * settings.set：这个开关只在本机渲染进程内生效（不进 WorldState / 广播），键常量
 * STRATIX_CONTEXT_TOGGLE_KEY 冻结在 core（写入方 = 本屏，读取方 = app 层 provider）。
 * 存储 API 异常（隐私模式 / 无 jsdom）→ 读作开、写丢弃（默认开，不绑架可用性）。
 */
function readContextToggle(): boolean {
  try {
    return localStorage.getItem(STRATIX_CONTEXT_TOGGLE_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeContextToggle(enabled: boolean): void {
  try {
    localStorage.setItem(STRATIX_CONTEXT_TOGGLE_KEY, enabled ? '1' : '0');
  } catch {
    // 写不进去就算了：下次读仍回落默认开。
  }
}

function isDangerActionId(value: string | null): value is DangerActionId {
  return DANGER_ACTIONS.some((action) => action.id === value);
}

/**
 * 挂载工厂：本仓库屏 / 面板的统一装配口径（与 mountMissionConfirm 一致）——
 *   建元素、注入 adapter、挂进容器，返回 unmount 闭包。
 */
export function mountSettingsScreen(deps: SettingsScreenDeps, host: HTMLElement): () => void {
  defineSettingsScreen();
  const element = document.createElement(SETTINGS_SCREEN_TAG) as StratSettingsScreenElement;
  element.adapter = deps;
  host.appendChild(element);
  // 移除元素会触发 disconnectedCallback → 退订，订阅随之释放。
  return () => { element.remove(); };
}