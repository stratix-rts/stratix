/**
 * 文件职责：**⌘K 命令面板**（@since v3.9，task_150）—— 全应用键盘可达的「动作入口」。
 *
 * ============ 交付对象 ============
 *   给「每天用 8 小时的操作员」的礼物：任何动作**两击键盘**可达，手不离键盘。
 *   ⌘K / Ctrl+K 全局唤起 → 输两个字模糊命中 → ↑↓ 选 → Enter 执行。
 *
 * ============ 为什么命令定义不写在这里 ============
 *   命令的**定义**（id / 标题 / 别名 / 分组 / 动作 / 可用性）在共享注册表
 *   （hud/lib/command-registry.ts）—— 底栏 composer 与本面板**共用一份事实源**。
 *   本组件只负责：把注册表画成列表、把键击变成动作、焦点与层级纪律。
 *
 * 输入：注册表（命令清单）+ 注入的 adapter（派发 + 订阅状态）+ 用户键击。
 * 输出：Shadow DOM 浮层；执行 → HudCommand → adapter.dispatch；宿主动作 → app-actions。
 *
 * 禁止事项：
 *   1. import world/、phaser、app/、任何 UI 库 —— 铁律；
 *   2. 直接 import core/bus —— 派发一律经注入的 adapter；
 *   3. 硬编码颜色 / 字体 / 边框 / 圆角 —— 视觉一律引用 --srf-* token（双皮肤同源）；
 *   4. 写死 z-index —— 走 146 刻度表（zVar('modal')）与浮层登记表；
 *   5. 泄漏监听器 —— disconnectedCallback 必须退订（perf 硬约束）。
 *
 * ============ 层级与 ESC 语义（@since v3.9，task_146）============
 *   本面板是**全屏弹窗**（焦点面）→ 登记进遮挡栈（modal 档），于是：
 *     · ESC 由遮挡控制器**统一路由到栈顶**（R4）—— 面板下面还有对话框时，
 *       第一次 ESC 关本面板、第二次才关对话框（顺序按栈，不抢）。
 *     · 四角常驻件在面板开着时降对比 + 禁点（R1）—— 焦点面就该压住背景。
 *   本组件自己的 Escape 处理会 stopPropagation —— 避免「遮挡栈关一次、本地又关一次」的双关。
 *
 * ============ 键盘优先细节 ============
 *   ① 唤起时焦点**直接进搜索框**（不用再按一下 Tab）；
 *   ② 执行后焦点**回原位**（原位可聚焦才回 —— 回不去就留在原地，不乱跳）；
 *   ③ Tab **不逃逸**（focus trap：面板内循环，Shift+Tab 反向）；
 *   ④ ↑↓ 选、Enter 执行、Esc 关闭（Esc 语义见上）。
 *
 * ============ 不可用命令 ============
 *   灰态 + **原因**（复用 task_148 的死按钮语言：灰按钮必须解释自己为什么灰）。
 *   原因由注册表的 `unavailable` 给出（判 WorldState），或由 app-actions 给出（没人接）。
 */

import type { WorldState } from '../../../core/types';
import type { HudBusAdapter } from '../../bridge/bus-adapter';
import { runAppAction } from '../../lib/app-actions';
import {
  APP_COMMANDS,
  APP_COMMAND_GROUP_LABELS,
  filterAppCommands,
  groupAppCommands,
  resolveAppCommands,
  sortByRecentUsage,
  type AppCommandContext,
  type AppCommandSpec,
} from '../../lib/command-registry';
import { getDraftTitle } from '../../lib/draft-store';
import {
  browserStorage,
  readRecentCommands,
  rememberCommand,
  type RecentCommandsStorage,
} from '../../lib/recent-commands';
// 命令清单文案（help）—— 与底栏 composer 的 help **同一份**（同一份词表，同一段文案）。
import { cliHelpText } from '../../panels/command-registry';
import { zVar } from '../../theme/layer-tokens';
import { MOTION_CLASS, MOTION_COMPONENT_CSS, installMotionTokens } from '../../theme/motion-tokens';
import { NEW_TASK_OPEN_EVENT } from '../new-task-dialog/new-task-dialog';

export const COMMAND_PALETTE_TAG = 'strat-command-palette';

/** 遮挡登记口（与 shortcut-manager 的端口同一形状 —— 组件只认「开 / 关」这一个动作）。 */
export interface CommandPaletteOcclusionPort {
  openModal(id: string, requestClose?: () => void): void;
  closeModal(id: string): void;
}

/** 面板需要的最小能力面。 */
export type CommandPaletteDeps = Pick<HudBusAdapter, 'dispatch' | 'subscribe'>;

/** 本面板在遮挡栈里的 id（登记用）。 */
export const COMMAND_PALETTE_OCCLUSION_ID = 'command-palette';

/** 面板对外形状（测试与挂载方按它断言）。 */
export interface StratCommandPaletteElement extends HTMLElement {
  adapter: CommandPaletteDeps | null;
  /** 遮挡登记口（ESC 统一路由到栈顶 + 四角降对比禁点）。 */
  occlusion: CommandPaletteOcclusionPort | null;
  /** 打开面板（焦点进搜索框）。 */
  open(): void;
  /** 关闭面板（焦点回原位）。 */
  close(): void;
  /** 当前是否打开。 */
  readonly isOpen: boolean;
  /** 当前可见的命令 id（按渲染顺序）。 */
  readonly visibleCommandIds: readonly string[];
  /** 当前选中的下标（-1 = 没选）。 */
  readonly selectedIndex: number;
  /** 当前搜索词。 */
  readonly query: string;
}

/** HTML 文本转义（标题含用户可写内容 —— 必须转义）。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c] as string);
}

/** 读当前激活的皮肤 id（'default' | 'pixel' | null = 读不到）—— 与 command-panel 同一口径。 */
function readActiveThemeId(): 'default' | 'pixel' | null {
  const nodes = Array.from(document.querySelectorAll<HTMLStyleElement>('style[data-srf-theme]'));
  const active = nodes.find((node) => !node.disabled);
  const id = active?.getAttribute('data-srf-theme');
  if (id === 'pixel') return 'pixel';
  if (id === 'default') return 'default';
  return null;
}

/**
 * 工厂：注册 `<strat-command-palette>`。幂等（重复 register 返回已注册构造器）。
 */
export function defineCommandPalette(): typeof HTMLElement {
  if (customElements.get(COMMAND_PALETTE_TAG)) {
    return customElements.get(COMMAND_PALETTE_TAG) as unknown as typeof HTMLElement;
  }

  class CommandPalette extends HTMLElement implements StratCommandPaletteElement {
    private _adapter: CommandPaletteDeps | null = null;
    private _occlusion: CommandPaletteOcclusionPort | null = null;
    private _state: WorldState | null = null;
    private _unsubscribe: (() => void) | null = null;
    private _open = false;
    private _query = '';
    private _selected = 0;
    private _recent: string[] = [];
    private _storage: RecentCommandsStorage | null = null;
    /** 打开前的焦点（关闭时回原位）。 */
    private _restoreFocus: HTMLElement | null = null;
    /** 回执（执行结果的即时反馈；面板内一行，不走 toast —— toast 是跨面板的顶层面）。 */
    private _status = '';

    // —— 属性面 ——
    get adapter(): CommandPaletteDeps | null { return this._adapter; }
    set adapter(value: CommandPaletteDeps | null) {
      this._adapter = value;
      this.bindAdapter();
    }

    get occlusion(): CommandPaletteOcclusionPort | null { return this._occlusion; }
    set occlusion(value: CommandPaletteOcclusionPort | null) { this._occlusion = value; }

    get isOpen(): boolean { return this._open; }
    get query(): string { return this._query; }
    get selectedIndex(): number { return this._selected; }

    get visibleCommandIds(): readonly string[] {
      return this.flat().map((c) => c.spec.id);
    }

    connectedCallback(): void {
      if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
      installMotionTokens();
      this._storage = browserStorage();
      this._recent = readRecentCommands(this._storage);
      this.renderChrome();
      // ★ 落一次关闭态（@since v3.9，task_152）：render() 才是唯一给遮罩 / 面板打上 hidden 的地方。
      //   只 renderChrome() 的话，遮罩是**可见且铺满全屏**的（pointer-events:auto）——
      //   于是「关着的命令面板」把整个页面罩住：全屏发暗 + 所有点击被它吃掉
      //   （用户实测的「模态框遮挡页面 / 糊屏」）。
      this.render();
      // 全局 ⌘K 监听挂在 window 上（不在影子树里 —— 焦点在哪都能唤起）。
      window.addEventListener('keydown', this.onGlobalKeydown);
      this.bindAdapter();
    }

    disconnectedCallback(): void {
      window.removeEventListener('keydown', this.onGlobalKeydown);
      this.releaseAdapter();
      this._open = false;
      this._restoreFocus = null;
    }

    // —— 订阅 ——
    private bindAdapter(): void {
      if (!this.isConnected || !this._adapter || this._unsubscribe) return;
      this._unsubscribe = this._adapter.subscribe((state) => {
        this._state = state;
        if (this._open) this.renderList();
      });
    }

    private releaseAdapter(): void {
      if (!this._unsubscribe) return;
      this._unsubscribe();
      this._unsubscribe = null;
    }

    // —— 全局 ⌘K ——
    /**
     * ⌘K / Ctrl+K 全局唤起。
     * why **输入态也生效**：⌘K 是「换个地方干活」的逃逸键 —— 用户正在底栏写提示词时
     *   按 ⌘K 去执行别的动作，不该被「输入框聚焦」拦住（那正是最需要逃逸的时刻）。
     * why 用 window 监听：焦点在哪儿都能收到（影子树 / 画布 / 输入框都一样）。
     */
    private readonly onGlobalKeydown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'k') return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      event.preventDefault();
      if (this._open) this.close();
      else this.open();
    };

    // —— 开合 ——
    open(): void {
      if (this._open) return;
      this._open = true;
      this._query = '';
      this._selected = 0;
      this._status = '';
      // 记住原位焦点（关闭时回原位 —— 「手不离键盘」的最后一环）。
      const active = document.activeElement;
      this._restoreFocus = active instanceof HTMLElement ? active : null;
      // 登记进遮挡栈（ESC 统一路由到栈顶 + 四角降对比禁点）。
      this._occlusion?.openModal(COMMAND_PALETTE_OCCLUSION_ID, () => { this.close(); });
      this.render();
      // 焦点直接进搜索框（唤起即可打字）。
      const input = this.shadowRoot?.querySelector<HTMLInputElement>('[data-role="search"]');
      input?.focus();
      input?.select();
    }

    close(): void {
      if (!this._open) return;
      this._open = false;
      this.render();
      // 焦点回原位（原位还在文档里且可聚焦才回 —— 回不去就不乱跳）。
      const target = this._restoreFocus;
      this._restoreFocus = null;
      if (target && target.isConnected) {
        try {
          target.focus();
        } catch {
          // 元素不可聚焦（已 disabled / 已移除）→ 忽略（留在原地比跳到 body 好）。
        }
      }
      this._occlusion?.closeModal(COMMAND_PALETTE_OCCLUSION_ID);
    }

    // —— 数据 ——
    private context(): AppCommandContext {
      return { state: this._state, draftTitle: getDraftTitle() };
    }

    /**
     * 当前结果（分组后的**渲染序**）。
     *
     * why 分组结果就是唯一一份顺序：渲染、↑↓ 选择、Enter 执行全都读它 ——
     *   一旦「渲染序」与「扁平序」分家，高亮会指错条目（高亮 A、执行 B）。
     * why 最近使用单独成组放在最前（空查询时）：高频动作该在第一屏第一行，
     *   Raycast / Linear 的同一口径；带查询时不置顶分组（用户要的是「找得到」）。
     */
    private groups(): ReturnType<typeof groupAppCommands> {
      const matched = filterAppCommands(APP_COMMANDS, this._query);
      const ordered = sortByRecentUsage(matched, this._recent);
      const resolved = resolveAppCommands(ordered, this.context());
      const query = this._query.trim();
      if (query.length > 0 || this._recent.length === 0) return groupAppCommands(resolved);

      const recentSet = new Set(this._recent);
      const recentItems = resolved.filter((r) => recentSet.has(r.spec.id));
      if (recentItems.length === 0) return groupAppCommands(resolved);
      const rest = resolved.filter((r) => !recentSet.has(r.spec.id));
      return [
        { id: 'recent' as const, label: APP_COMMAND_GROUP_LABELS.recent, items: recentItems },
        ...groupAppCommands(rest),
      ];
    }

    /** 扁平的执行列表（顺序 = 分组顺序 = 渲染顺序 —— 三者同源）。 */
    private flat(): ReturnType<typeof resolveAppCommands> {
      return this.groups().flatMap((group) => group.items);
    }

    // —— 执行 ——
    /**
     * 执行一条命令。
     * 构造不出来 / 动作没人接 → **不假装成功**（给回执说明原因）。
     */
    private execute(spec: AppCommandSpec): void {
      const ctx = this.context();
      const resolved = resolveAppCommands([spec], ctx)[0];
      if (!resolved || !resolved.enabled) {
        this.setStatus(`「${spec.title}」此刻不可用：${resolved?.reason ?? '条件不满足'}`);
        return;
      }
      const action = spec.action;
      switch (action.kind) {
        case 'dispatch': {
          this._adapter?.dispatch(action.command);
          this.finish(spec, `已执行「${spec.title}」`);
          return;
        }
        case 'dispatch-built': {
          const command = action.build(ctx);
          if (!command) {
            this.setStatus(`「${spec.title}」此刻构造不出命令（条件不满足）`);
            return;
          }
          this._adapter?.dispatch(command);
          this.finish(spec, `已执行「${spec.title}」`);
          return;
        }
        case 'theme': {
          this._adapter?.dispatch({ type: 'theme.set', themeId: action.themeId });
          this.finish(spec, `已切换到${action.themeId === 'pixel' ? '像素风' : '现代风'}`);
          return;
        }
        case 'theme-toggle': {
          const before = readActiveThemeId();
          const target: 'default' | 'pixel' = before === 'pixel' ? 'default' : 'pixel';
          this._adapter?.dispatch({ type: 'theme.set', themeId: target });
          this.finish(spec, `已切换到${target === 'pixel' ? '像素风' : '现代风'}`);
          return;
        }
        case 'new-task': {
          const title = ctx.draftTitle.trim();
          this.dispatchEvent(
            new CustomEvent(NEW_TASK_OPEN_EVENT, {
              bubbles: true,
              composed: true,
              detail: { title },
            })
          );
          this.finish(spec, '已打开新建任务对话框');
          return;
        }
        case 'help': {
          // 命令清单：**不关面板**（清单就在眼前，看完接着找）。
          this._status = cliHelpText();
          this.renderList();
          return;
        }
        case 'app-action': {
          const ok = runAppAction(action.id);
          if (!ok) {
            this.setStatus(`「${spec.title}」此刻不可用：当前环境未接入该动作`);
            return;
          }
          this.finish(spec, `已执行「${spec.title}」`);
          return;
        }
      }
    }

    /** 执行成功：记最近使用 + 关面板 + 回原位。 */
    private finish(spec: AppCommandSpec, message: string): void {
      this._recent = rememberCommand(this._storage, spec.id);
      this._status = message;
      this.close();
    }

    /** 写回执（面板瞬时态）。 */
    private setStatus(text: string): void {
      this._status = text;
      this.renderList();
    }

    // —— 渲染 ——
    private renderChrome(): void {
      const root = this.shadowRoot;
      if (!root) return;
      root.innerHTML = `
        <style>
          ${MOTION_COMPONENT_CSS}
          :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${zVar('modal')}; }
          .backdrop {
            position: absolute;
            inset: 0;
            background: var(--srf-backdrop);
            pointer-events: auto;
          }
          /* 关闭态必须真的不画（@since v3.9，task_152）：
             面板自己带 display:grid（作者样式）—— 作者样式压过 UA 的 [hidden]{display:none}，
             光打 hidden 属性不够，得显式压一条 display:none。
             遮罩同理（两条一起写：谁先长出 display 都不会漏）。 */
          .backdrop[hidden],
          .panel[hidden] {
            display: none;
          }
          .panel {
            position: absolute;
            /* 居中偏上：⌘K 面板是「临时出现的第二个脑」—— 放在视线自然落点（略高于正中）。 */
            top: 14vh;
            left: 50%;
            transform: translateX(-50%);
            width: min(620px, 92vw);
            max-height: 70vh;
            display: grid;
            grid-template-rows: auto minmax(0, 1fr) auto;
            background: var(--srf-panel);
            color: var(--srf-text);
            border: var(--srf-border-width) solid var(--srf-border);
            border-radius: var(--srf-radius);
            box-shadow: var(--srf-shadow-lg);
            pointer-events: auto;
            overflow: hidden;
          }
          .search-row {
            display: grid;
            grid-template-columns: auto 1fr;
            align-items: center;
            gap: var(--srf-spacing-sm);
            padding: var(--srf-spacing-sm) var(--srf-spacing-md);
            border-bottom: var(--srf-border-width) solid var(--srf-border);
          }
          .search-icon { color: var(--srf-text-muted); font-size: var(--srf-font-size-sm); }
          input.search {
            width: 100%;
            box-sizing: border-box;
            padding: var(--srf-spacing-xs) 0;
            background: transparent;
            color: var(--srf-text);
            border: none;
            outline: none;
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-lg);
          }
          input.search::placeholder { color: var(--srf-text-muted); }
          .list {
            overflow-y: auto;
            padding: var(--srf-spacing-xs) var(--srf-spacing-xs);
            scrollbar-width: thin;
          }
          .group-name {
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-xs);
            font-weight: var(--srf-font-weight-semibold);
            letter-spacing: 0.04em;
          }
          button.item {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: center;
            gap: var(--srf-spacing-sm);
            width: 100%;
            text-align: left;
            padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
            background: transparent;
            color: var(--srf-text);
            border: var(--srf-border-width) solid transparent;
            border-radius: var(--srf-radius);
            font-family: var(--srf-font-ui);
            font-size: var(--srf-font-size-sm);
            cursor: pointer;
          }
          button.item:hover:not(:disabled) { background: var(--srf-panel-elevated); }
          button.item:focus-visible { outline: var(--srf-border-width) solid var(--srf-accent); outline-offset: var(--srf-spacing-xxs); }
          button.item[data-selected="true"] {
            border-color: var(--srf-accent);
            background: var(--srf-panel-elevated);
          }
          button.item:disabled { color: var(--srf-text-disabled); cursor: not-allowed; opacity: 0.7; }
          .item-title { font-weight: var(--srf-font-weight-semibold); }
          .item-reason { color: var(--srf-text-disabled); font-size: var(--srf-font-size-xs); }
          .item-shortcut { color: var(--srf-text-muted); font-size: var(--srf-font-size-xs); }
          button.item:disabled .item-shortcut { color: var(--srf-text-disabled); }
          .foot {
            display: grid;
            gap: var(--srf-spacing-xxs);
            padding: var(--srf-spacing-xs) var(--srf-spacing-md);
            border-top: var(--srf-border-width) solid var(--srf-border);
            color: var(--srf-text-muted);
            font-size: var(--srf-font-size-xs);
          }
          .status { color: var(--srf-text-muted); white-space: pre-wrap; overflow-y: auto; max-height: 30vh; }
        </style>
        <div class="backdrop" data-role="backdrop"></div>
        <div class="panel ${MOTION_CLASS.enter}" data-role="panel" role="dialog" aria-modal="true" aria-label="命令面板">
          <div class="search-row">
            <span class="search-icon" aria-hidden="true">⌘</span>
            <input
              class="search"
              data-role="search"
              type="text"
              spellcheck="false"
              autocomplete="off"
              placeholder="输入命令…（↑↓ 选择 · Enter 执行 · Esc 关闭）"
              aria-label="搜索命令"
            />
          </div>
          <div class="list" data-role="list"></div>
          <div class="foot">
            <span class="status" data-role="status"></span>
            <span data-role="hint">⌘K 开关 · ↑↓ 选择 · Enter 执行</span>
          </div>
        </div>
      `;

      // 搜索：只改瞬时态 + 重画列表（外壳不重建，输入时焦点不丢）。
      root.addEventListener('input', (ev: Event) => {
        const target = ev.target as HTMLInputElement | null;
        if (!target || target.dataset.role !== 'search') return;
        this._query = target.value;
        this._selected = 0;
        this.renderList();
      });

      // 面板内键位：Esc / ↑↓ / Enter / Tab（focus trap）。
      root.addEventListener('keydown', ((ev: KeyboardEvent) => this.onPaletteKeydown(ev)) as EventListener);

      // 点条目 = 执行（鼠标也留着 —— 键盘优先不等于键盘唯一）。
      root.addEventListener('click', (ev: Event) => {
        const target = ev.target as HTMLElement | null;
        const host = target?.closest?.('[data-command]') as HTMLElement | null;
        const id = host?.getAttribute('data-command');
        if (!id) return;
        const spec = APP_COMMANDS.find((c) => c.id === id);
        if (!spec) return;
        if (host?.hasAttribute('disabled')) return;
        this.execute(spec);
      });

      // 点遮罩 = 关闭（与 ESC 同一条路）。
      const backdrop = root.querySelector('[data-role="backdrop"]');
      backdrop?.addEventListener('click', () => { this.close(); });
    }

    /** 面板内键位处理。 */
    private onPaletteKeydown(ev: KeyboardEvent): void {
      if (!this._open) return;
      switch (ev.key) {
        case 'Escape': {
          // 自己关自己，并**阻断冒泡** —— 遮挡栈的 ESC 路由不要重复关一次。
          ev.preventDefault();
          ev.stopPropagation();
          this.close();
          return;
        }
        case 'ArrowDown':
        case 'ArrowUp': {
          ev.preventDefault();
          this.moveSelection(ev.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        case 'Enter': {
          ev.preventDefault();
          const flat = this.flat();
          const chosen = flat[this._selected];
          if (chosen) this.execute(chosen.spec);
          return;
        }
        case 'Tab': {
          // focus trap：Tab 在面板内循环，不逃逸到背景。
          ev.preventDefault();
          this.trapFocus(ev.shiftKey);
          return;
        }
        default:
          return;
      }
    }

    /** ↑↓ 移动选择（跳过不可用项 —— 键盘不该停在灰按钮上）。 */
    private moveSelection(delta: number): void {
      const flat = this.flat();
      if (flat.length === 0) return;
      let index = this._selected;
      for (let step = 0; step < flat.length; step += 1) {
        index = (index + delta + flat.length) % flat.length;
        if (flat[index]?.enabled) break;
      }
      this._selected = index;
      this.renderList();
      this.scrollSelectedIntoView();
    }

    /** focus trap：面板内可聚焦元素之间循环。 */
    private trapFocus(backward: boolean): void {
      const focusables = this.focusableItems();
      if (focusables.length === 0) {
        this.shadowRoot?.querySelector<HTMLInputElement>('[data-role="search"]')?.focus();
        return;
      }
      const active = this.shadowRoot?.activeElement ?? null;
      const index = focusables.indexOf(active as HTMLElement);
      const next = backward
        ? (index <= 0 ? focusables.length - 1 : index - 1)
        : (index === -1 || index === focusables.length - 1 ? 0 : index + 1);
      focusables[next]?.focus();
    }

    /** 面板内可聚焦元素（搜索框 + 可见条目按钮）。 */
    private focusableItems(): HTMLElement[] {
      const root = this.shadowRoot;
      if (!root) return [];
      const search = root.querySelector<HTMLElement>('[data-role="search"]');
      const items = Array.from(root.querySelectorAll<HTMLElement>('button.item:not(:disabled)'));
      return search ? [search, ...items] : items;
    }

    /** 把选中项滚进可视区（长列表里眼睛要跟得上）。 */
    private scrollSelectedIntoView(): void {
      const root = this.shadowRoot;
      const selected = root?.querySelector<HTMLElement>('button.item[data-selected="true"]');
      // typeof 守卫：jsdom 没实现 scrollIntoView（单测环境不滚屏，滚不了也不该炸）。
      if (selected && typeof selected.scrollIntoView === 'function') {
        selected.scrollIntoView({ block: 'nearest' });
      }
    }

    /** 重画整个浮层（开合时）。 */
    private render(): void {
      const root = this.shadowRoot;
      if (!root) return;
      const backdrop = root.querySelector<HTMLElement>('[data-role="backdrop"]');
      const panel = root.querySelector<HTMLElement>('[data-role="panel"]');
      const hidden = !this._open;
      if (backdrop) backdrop.hidden = hidden;
      if (panel) panel.hidden = hidden;
      if (hidden) {
        const status = root.querySelector<HTMLElement>('[data-role="status"]');
        if (status) status.textContent = '';
        return;
      }
      const search = root.querySelector<HTMLInputElement>('[data-role="search"]');
      if (search && search.value !== this._query) search.value = this._query;
      this.renderList();
    }

    /** 重画列表（分组标题 + 条目 + 灰态原因）。 */
    private renderList(): void {
      const root = this.shadowRoot;
      const list = root?.querySelector<HTMLElement>('[data-role="list"]');
      const status = root?.querySelector<HTMLElement>('[data-role="status"]');
      if (!root || !list) return;
      if (status) status.textContent = this._status;

      const groups = this.groups();
      const flat = this.flat();
      if (flat.length === 0) {
        list.innerHTML = `<div class="item-reason" data-role="empty">没有匹配的命令</div>`;
        return;
      }
      // 扁平下标 → 条目下标（↑↓ 选择按扁平列表走，渲染按分组走 —— 两套下标要能对上）。
      let cursor = 0;
      list.innerHTML = groups
        .map((group) => {
          const items = group.items
            .map((item) => {
              const index = cursor;
              cursor += 1;
              return this.renderItem(item.spec.id, item.enabled, item.reason ?? '', index, item.spec.shortcut);
            })
            .join('');
          return `<div class="group-name">${escapeHtml(group.label)}</div>${items}`;
        })
        .join('');
    }

    /** 单个条目。 */
    private renderItem(
      id: string,
      enabled: boolean,
      reason: string,
      index: number,
      shortcut?: string
    ): string {
      const spec = APP_COMMANDS.find((c) => c.id === id);
      const title = spec?.title ?? id;
      const selected = index === this._selected;
      const hint = enabled ? (shortcut ?? '') : reason;
      return `
        <button
          type="button"
          class="item"
          data-command="${escapeHtml(id)}"
          data-selected="${selected ? 'true' : 'false'}"
          ${enabled ? '' : 'disabled'}
          title="${escapeHtml(enabled ? (shortcut ?? '') : reason)}"
        >
          <span class="item-title">${escapeHtml(title)}</span>
          <span class="item-shortcut">${escapeHtml(hint)}</span>
        </button>
      `;
    }
  }

  customElements.define(COMMAND_PALETTE_TAG, CommandPalette);
  return CommandPalette as unknown as typeof HTMLElement;
}

/**
 * 挂载工厂（与本仓库面板统一装配口径）：建元素 → 注入 adapter / occlusion → 挂进容器，
 * 返回 unmount 闭包。
 */
export function mountCommandPalette(
  deps: CommandPaletteDeps,
  host: HTMLElement,
  options: { readonly occlusion?: CommandPaletteOcclusionPort | null } = {}
): () => void {
  defineCommandPalette();
  const element = document.createElement(COMMAND_PALETTE_TAG) as StratCommandPaletteElement;
  element.occlusion = options.occlusion ?? null;
  element.adapter = deps;
  host.appendChild(element);
  return () => { element.remove(); };
}
