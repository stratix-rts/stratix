/**
 * 文件职责：**阅读列**（Reading Column）—— 会话消息的读面组件（@since v3.9，task_149）。
 *
 * ============ 它解决什么（r5 工作台镜头 7/10）============
 *   ① **消息分野** —— 用户 / agent 回复 / 系统事件，三种视觉身份一眼可辨；
 *   ② **连续分组** —— 同一 agent 连着说的几句合成一组（不每条重复头像/名字）；
 *   ③ **时间线** —— 跨分钟插一条轻分隔条（「14:32」），时间戳默认轻呈现（hover 显形）；
 *   ④ **滚动记忆** —— 面板收起再打开、抽屉开合，回到原处；记忆最近 5 个上下文；
 *   ⑤ **长会话不卡** —— 200+ 消息只渲染可视区 + 缓冲（手写轻方案，零新依赖）。
 *
 * ============ 为什么是「渲染进容器」而不是自定义元素 ============
 *   阅读列要能被**塞进别的 Shadow DOM**（会话面板的抽屉 / 示例会话都在面板里），
 *   嵌套 Shadow DOM 会让外层测试与外层样式都够不着它。渲染进容器 +
 *   作用域前缀类名（`.rc-*`）两头都顾得上：样式不外泄，行也能被外层断言。
 *
 * 输入：一个容器元素 + 一组 ReadingMessage（已归一）。
 * 输出：容器里的读面 DOM（消息行 / 时间分隔条 / 「回到最新」浮标）。
 * 禁止事项：
 *   1. 硬编码颜色 / 字体 / 边框 —— 一律 --srf-* token（双皮肤同源）；
 *   2. 裸 z-index 数字 —— 走刻度表（task_146 的零硬编码纪律）；
 *   3. 编消息 —— 没有就是没有（空态走 136 的统一空态语言）；
 *   4. 在本组件里发命令 —— 动作只回调给宿主（裁决在 core）。
 */

import { enhanceMarkdown, MARKDOWN_CLASS, MARKDOWN_CSS, renderMarkdown } from '../../lib/markdown';
import { zVar } from '../../theme/layer-tokens';
import { MOTION_REDUCED_CSS } from '../../theme/motion-tokens';

import {
  buildPrefix,
  buildReadingTimeline,
  computeReadingWindow,
  createScrollMemory,
  READING_DEFAULT_ROW_HEIGHT,
  READING_VIRTUALIZE_MIN,
  type ReadingMessage,
  type ReadingRow,
  type ScrollMemory,
} from './reading-logic';

/** HTML 转义表（用码点拼，避免源码里出现裸实体串）。 */
const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '&': `${String.fromCharCode(38)}amp;`,
  '<': `${String.fromCharCode(60)}lt;`,
  '>': `${String.fromCharCode(62)}gt;`,
  '"': `${String.fromCharCode(34)}quot;`,
  "'": `${String.fromCharCode(39)}#39;`,
};

/** HTML 文本转义（正文含外部输入，必须转义后才进 innerHTML）。 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPE_MAP[c] ?? c);
}

/** 记忆表按作用域分桶（同一作用域共享一张表 —— 组件重建后记忆还在）。 */
const MEMORY_SCOPES = new Map<string, ScrollMemory>();

/** 取某个作用域的滚动记忆表（懒建，容量有上限）。 */
export function getScrollMemory(scope: string): ScrollMemory {
  const existing = MEMORY_SCOPES.get(scope);
  if (existing) return existing;
  const created = createScrollMemory({ storageKey: `stratix:reading-scroll:${scope}` });
  MEMORY_SCOPES.set(scope, created);
  return created;
}

/** 阅读列的构造选项。 */
export interface ReadingColumnOptions {
  /** 滚动记忆的上下文键（如 'demo' / 'drawer:s-1'）。 */
  readonly contextKey: string;
  /** 记忆表作用域（缺省 'default'）。 */
  readonly memoryScope?: string;
  /** 是否开窗口化（缺省 true —— 长会话要它）。 */
  readonly virtualize?: boolean;
  /** 正文是否按 markdown 渲染（缺省 false）。 */
  readonly markdown?: boolean;
  /** 消息行的 data-role 名（缺省 'rc-message'）。 */
  readonly messageRole?: string;
  /** 正文的 data-role 名（缺省 'rc-text'）。 */
  readonly textRole?: string;
  /** 署名的 data-role 名（缺省 'rc-author'）。 */
  readonly authorRole?: string;
  /** 时间的 data-role 名（缺省 'rc-time'）。 */
  readonly timeRole?: string;
  /** 徽标的 data-role 名（缺省 'rc-badge'）。 */
  readonly badgeRole?: string;
  /** 分隔条的 data-role 名（缺省 'rc-separator'）。 */
  readonly separatorRole?: string;
  /** 动作回调（宿主决定怎么裁决）。 */
  readonly onAction?: (action: string, message: ReadingMessage) => void;
  /** 滚到顶回调（宿主可在这里加载更早的一页）。 */
  readonly onReachTop?: () => void;
}

/**
 * 阅读列。
 *
 * 生命周期：new → setMessages → （可反复） → destroy。
 * why 不用自定义元素：见文件头「为什么是渲染进容器」。
 */
export class ReadingColumn {
  private readonly _container: HTMLElement;
  private readonly _options: ReadingColumnOptions;
  private readonly _memory: ScrollMemory;
  private _messages: readonly ReadingMessage[] = [];
  private _rows: ReadingRow[] = [];
  private readonly _heights = new Map<string, number>();
  private _prefix: number[] = [0];
  private _list!: HTMLElement;
  private _rowsEl!: HTMLElement;
  private _padTop!: HTMLElement;
  private _padBottom!: HTMLElement;
  private _jump!: HTMLButtonElement;
  /** 用户当前是否贴着底部（决定新消息要不要自动跟随）。 */
  private _atBottom = true;
  /** 用户上翻期间攒下的新消息数（浮标上的数字）。 */
  private _pending = 0;
  private _raf = 0;
  private _measurePass = 0;
  private _destroyed = false;
  private _restored = false;

  constructor(container: HTMLElement, options: ReadingColumnOptions) {
    this._container = container;
    this._options = options;
    this._memory = getScrollMemory(options.memoryScope ?? 'default');
    this.buildDom();
  }

  /** 当前消息（只读）。 */
  get messages(): readonly ReadingMessage[] {
    return this._messages;
  }

  /** 当前时间线条目（只读 —— 测试与断言用）。 */
  get rows(): readonly ReadingRow[] {
    return this._rows;
  }

  /** 用户是否贴在底部（"新消息要不要跟随"的状态位）。 */
  get atBottom(): boolean {
    return this._atBottom;
  }

  /** 上翻期间攒下的新消息数。 */
  get pendingCount(): number {
    return this._pending;
  }

  /** 「回到最新」浮标是否可见。 */
  get jumpVisible(): boolean {
    return !this._jump.hidden;
  }

  /** 换一批消息（追加 / 换会话都走这里）。 */
  setMessages(messages: readonly ReadingMessage[]): void {
    if (this._destroyed) return;
    const previous = this._messages;
    const wasAtBottom = this._atBottom;
    this._messages = messages;
    this._rows = buildReadingTimeline(messages);
    this.rebuildPrefix();

    // 新消息计数（只在用户上翻时累计 —— 贴着底部时直接跟随，不算"打扰"）。
    const appended = Math.max(0, messages.length - previous.length);
    if (!wasAtBottom && appended > 0) {
      this._pending += appended;
    }

    this.renderRows();

    if (!this._restored) {
      // 首绘：先按记忆恢复位置（有记忆 = 用户看过这里，别把他拽到底部）。
      if (this.restoreMemory()) return;
      this.scrollToBottom();
      return;
    }
    if (wasAtBottom) {
      this.scrollToBottom();
    } else {
      // 上翻中：新消息只追加在尾部 —— **不动 scrollTop**（内容在下方，不该把人顶走）。
      this.updateJump();
    }
  }

  /** 回到最新（滚到底 + 清掉待读计数）。 */
  scrollToLatest(): void {
    if (this._destroyed) return;
    this._pending = 0;
    this.scrollToBottom();
    this.updateJump();
  }

  /**
   * 按记忆恢复滚动位置（**折叠再展开 / 抽屉开合后**由宿主调用）。
   *
   * why 需要它：折叠时容器变成 display:none —— 浏览器会把滚动位置**清零**，
   *   而这期间并没有 scroll 事件（记忆里那份还是对的）。
   *   所以展开后得主动按记忆把位置放回去。
   */
  restorePosition(): void {
    if (this._destroyed) return;
    const list = this._list;
    if (!list) return;
    if (list.scrollTop > 0) return; // 已经在位置上（别把人挪走）
    const ratio = this._memory.recall(this._options.contextKey);
    if (ratio === null) return;
    const max = list.scrollHeight - list.clientHeight;
    if (max <= 0) return;
    list.scrollTop = ratio * max;
    this._atBottom = this.computeAtBottom();
    this.updateJump();
  }

  /** 卸载（解绑监听器 + 清 DOM）。 */
  destroy(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
    }
    this._container.removeEventListener('click', this.onClick);
    this._container.removeEventListener('scroll', this.onScroll);
    this._container.innerHTML = '';
  }

  // —— DOM ——
  private buildDom(): void {
    injectStyles(this._container);
    this._container.innerHTML = `
      <div class="rc" data-role="rc">
        <div class="rc-list" data-role="rc-list">
          <div class="rc-pad rc-pad-top" data-role="rc-pad-top"></div>
          <div class="rc-rows" data-role="rc-rows"></div>
          <div class="rc-pad rc-pad-bot" data-role="rc-pad-bot"></div>
        </div>
        <button type="button" class="rc-jump" data-role="rc-jump" data-action="rc-jump-latest" hidden>回到最新</button>
      </div>
    `;
    this._list = this._container.querySelector<HTMLElement>('[data-role="rc-list"]')!;
    this._rowsEl = this._container.querySelector<HTMLElement>('[data-role="rc-rows"]')!;
    this._padTop = this._container.querySelector<HTMLElement>('[data-role="rc-pad-top"]')!;
    this._padBottom = this._container.querySelector<HTMLElement>('[data-role="rc-pad-bot"]')!;
    this._jump = this._container.querySelector<HTMLButtonElement>('[data-role="rc-jump"]')!;

    this._container.addEventListener('click', this.onClick);
    this._container.addEventListener('scroll', this.onScroll, true);
  }

  private onClick = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    const holder = target?.closest?.('[data-action]') as HTMLElement | null;
    if (!holder) return;
    const action = holder.getAttribute('data-action');
    if (action === 'rc-jump-latest') {
      this.scrollToLatest();
      return;
    }
    const id = holder.getAttribute('data-rc-id');
    const message = this._messages.find((m) => m.id === id);
    if (!action || !message) return;
    this._options.onAction?.(action, message);
  };

  private onScroll = (event: Event): void => {
    const target = event.target as HTMLElement | null;
    if (target !== this._list) return;
    this._atBottom = this.computeAtBottom();
    if (this._atBottom) this._pending = 0;
    this.updateJump();
    this.saveMemory();
    this.scheduleRender();
    // 滚到顶 = 到头了（宿主可在这里加载更早的一页）。
    if (this._list.scrollTop <= 0) this._options.onReachTop?.();
  };

  /** 是否贴着底部（留 24px 容差 —— 差一点点就算"在底部"）。 */
  private computeAtBottom(): boolean {
    const list = this._list;
    if (!list) return true;
    return list.scrollTop + list.clientHeight >= list.scrollHeight - 24;
  }

  private updateJump(): void {
    const show = !this._atBottom && this._messages.length > 0;
    this._jump.hidden = !show;
    this._jump.textContent = this._pending > 0 ? `回到最新（${this._pending}）` : '回到最新';
  }

  /** 记位置（比例）—— 比例跟内容走，面板高度变了也不会指错地方。 */
  private saveMemory(): void {
    const list = this._list;
    if (!list) return;
    const max = list.scrollHeight - list.clientHeight;
    // 还没排版（高度为 0）时不记 —— 否则会把"位置 0"写回去，把真位置抹掉。
    if (max <= 0) return;
    const ratio = list.scrollTop / max;
    this._memory.remember(this._options.contextKey, ratio);
  }

  /** 从记忆里恢复位置（组件重建后 —— 面板收起再打开 / 抽屉开合）。 */
  private restoreMemory(): boolean {
    if (this._restored) return false;
    this._restored = true;
    const ratio = this._memory.recall(this._options.contextKey);
    if (ratio === null) return false;
    const list = this._list;
    const max = list.scrollHeight - list.clientHeight;
    if (max <= 0) return false;
    list.scrollTop = ratio * max;
    this._atBottom = this.computeAtBottom();
    this.updateJump();
    return true;
  }

  private scrollToBottom(): void {
    const list = this._list;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    this._atBottom = true;
    this._pending = 0;
    this.updateJump();
    this.saveMemory();
  }

  /** 渲染当前窗口。 */
  private renderRows(): void {
    if (this._destroyed) return;
    // 样式兜底重注：容器若是在**挂进 DOM 之后**才拿到（先建后插），第一次注入会落错地方。
    injectStyles(this._container);
    const useWindow =
      this._options.virtualize !== false && this._rows.length > READING_VIRTUALIZE_MIN;
    if (!useWindow) {
      this._padTop.style.height = '0px';
      this._padBottom.style.height = '0px';
      this._rowsEl.innerHTML = this._rows.map((row) => this.renderRow(row)).join('');
    } else {
      const win = computeReadingWindow(
        this._prefix,
        this._list.scrollTop,
        this._list.clientHeight || READING_DEFAULT_ROW_HEIGHT
      );
      this._padTop.style.height = `${win.topPad}px`;
      this._padBottom.style.height = `${win.bottomPad}px`;
      this._rowsEl.innerHTML = this._rows
        .slice(win.start, win.end + 1)
        .map((row) => this.renderRow(row))
        .join('');
    }
    this.enhanceIfNeeded();
    this.measure();
  }

  /** 排期一次重绘（滚动时按帧合并，别每像素都重画）。 */
  private scheduleRender(): void {
    if (this._raf || this._destroyed) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    this._raf = raf(() => {
      this._raf = 0;
      if (this._destroyed) return;
      if (this._options.virtualize === false || this._rows.length <= READING_VIRTUALIZE_MIN) return;
      this.renderRows();
    });
  }

  /** 量高 → 修正前缀表（量到的比估的准）。 */
  private measure(): void {
    const children = Array.from(this._rowsEl.children) as HTMLElement[];
    let changed = false;
    for (const child of children) {
      const key = child.getAttribute('data-rc-key');
      if (!key) continue;
      const height = child.offsetHeight;
      if (height > 0 && this._heights.get(key) !== height) {
        this._heights.set(key, height);
        changed = true;
      }
    }
    if (!changed) return;
    this.rebuildPrefix();
    if (this._options.virtualize !== false && this._rows.length > READING_VIRTUALIZE_MIN) {
      // 占位高度跟着修正后的前缀走（总高保持自洽）。
      const win = computeReadingWindow(
        this._prefix,
        this._list.scrollTop,
        this._list.clientHeight || READING_DEFAULT_ROW_HEIGHT
      );
      this._padTop.style.height = `${win.topPad}px`;
      this._padBottom.style.height = `${win.bottomPad}px`;
    }
  }

  /** 用「已量到的行高 + 估算值」重建前缀偏移表。 */
  private rebuildPrefix(): void {
    const heights = this._rows.map((row) => this._heights.get(row.key) ?? 0);
    this._prefix = buildPrefix(heights, READING_DEFAULT_ROW_HEIGHT);
  }

  private enhanceIfNeeded(): void {
    if (!this._rowsEl.querySelector(`.${MARKDOWN_CLASS}`)) return;
    enhanceMarkdown(this._rowsEl);
  }

  /** 画一行（分隔条或消息）。 */
  private renderRow(row: ReadingRow): string {
    if (row.kind === 'separator') {
      const role = this._options.separatorRole ?? 'rc-separator';
      return `<div class="rc-sep" data-role="${escapeHtml(role)}" data-rc-key="${escapeHtml(row.key)}"><span class="rc-sep-label">${escapeHtml(row.label)}</span></div>`;
    }
    const message = row.message;
    const role = this._options.messageRole ?? 'rc-message';
    const textRole = this._options.textRole ?? 'rc-text';
    const authorRole = this._options.authorRole ?? 'rc-author';
    const timeRole = this._options.timeRole ?? 'rc-time';
    const badgeRole = this._options.badgeRole ?? 'rc-badge';
    const tone = message.tone ?? 'normal';
    const asMarkdown = message.markdown ?? this._options.markdown ?? false;
    const textHtml = asMarkdown
      ? renderMarkdown(message.text)
      : escapeHtml(message.text).replace(/\n/g, '<br/>');

    const avatar = row.opensGroup && message.role !== 'system'
      ? `<span class="rc-avatar" data-role="rc-avatar" aria-hidden="true">${escapeHtml(Array.from(message.author)[0] ?? '·')}</span>`
      : '';
    const badgeHtml = message.badge
      ? `<span class="rc-badge" data-role="${escapeHtml(badgeRole)}">${escapeHtml(message.badge)}</span>`
      : '';
    // 组首那条挂「署名 + 徽标」；组内续条只挂徽标（不重复署名 / 头像）。
    const head = row.opensGroup
      ? `<div class="rc-head" data-role="rc-head">
          <span class="rc-author" data-role="${escapeHtml(authorRole)}">${escapeHtml(message.author)}</span>
          ${badgeHtml}
        </div>`
      : badgeHtml
        ? `<div class="rc-head rc-head-solo" data-role="rc-head">${badgeHtml}</div>`
        : '';
    const action = message.action
      ? `<button type="button" class="rc-action" data-action="${escapeHtml(message.action.action)}" data-rc-id="${escapeHtml(message.id)}"${message.action.title ? ` title="${escapeHtml(message.action.title)}"` : ''}${extraAttrs(message.action.attrs)}>${escapeHtml(message.action.label)}</button>`
      : '';

    return `<div class="rc-msg" data-role="${escapeHtml(role)}" data-rc-role="${escapeHtml(message.role)}" data-rc-key="${escapeHtml(row.key)}" data-rc-id="${escapeHtml(message.id)}" data-tone="${escapeHtml(tone)}" data-opens-group="${row.opensGroup ? 'true' : 'false'}">
      ${avatar}
      <div class="rc-main">
        ${head}
        <div class="rc-bubble">
          <div class="rc-text ${asMarkdown ? MARKDOWN_CLASS : ''}" data-role="${escapeHtml(textRole)}">${textHtml}</div>
          ${action}
        </div>
        <span class="rc-time" data-role="${escapeHtml(timeRole)}" title="${escapeHtml(new Date(message.at).toLocaleString())}">${escapeHtml(formatTimeLabel(message.at))}</span>
      </div>
    </div>`;
  }
}

/** 附加属性串（fork 钮的 data-at-seq / data-session 走这里）。 */
function extraAttrs(attrs: Readonly<Record<string, string>> | undefined): string {
  if (!attrs) return '';
  return Object.entries(attrs)
    .map(([key, value]) => ` ${key}="${escapeHtml(value)}"`)
    .join('');
}

/** 时间戳文案（「14:32」）。 */
function formatTimeLabel(at: number): string {
  const date = new Date(at);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * 注入阅读列样式（幂等 —— 同一份样式只留一份）。
 *
 * why 作用域前缀 `.rc-*`：样式要能落在**任何**容器里（面板的 Shadow DOM、
 *   裸页面、别的组件的抽屉）—— 前缀类名保证不外泄到别人的 DOM 上。
 * why 颜色全走 --srf-*：双皮肤同源（像素皮 / 现代皮换色板都能吃到）。
 */
function injectStyles(container: HTMLElement): void {
  const root = container.getRootNode() as Document | ShadowRoot;
  const host =
    root instanceof Document ? root.head : root instanceof ShadowRoot ? root : document.head;
  if (!host) return;
  const existing = host.querySelector('style[data-rc-style]');
  if (existing) return;
  const style = document.createElement('style');
  style.setAttribute('data-rc-style', 'true');
  style.textContent = READING_COLUMN_CSS + MARKDOWN_CSS + MOTION_REDUCED_CSS;
  host.appendChild(style);
}

/** 阅读列样式表（作用域前缀 `.rc-`）。 */
export const READING_COLUMN_CSS = `
.rc { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; }
.rc-list {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  min-height: 0;
  padding: var(--srf-spacing-xs);
  scrollbar-width: thin;
  scrollbar-color: var(--srf-border-strong) transparent;
}
.rc-list::-webkit-scrollbar { width: var(--srf-spacing-sm); }
.rc-list::-webkit-scrollbar-thumb { background: var(--srf-border-strong); border-radius: var(--srf-radius-pill); }
.rc-pad { width: 100%; }
.rc-rows { display: block; }
/* —— 消息分野：用户 / agent / 系统 —— */
.rc-msg {
  display: flex;
  align-items: flex-start;
  gap: var(--srf-spacing-xs);
  margin-bottom: var(--srf-spacing-xs);
}
.rc-msg[data-rc-role="user"] { flex-direction: row-reverse; }
.rc-msg[data-rc-role="system"] { display: block; }
.rc-avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 1.6em;
  height: 1.6em;
  border: var(--srf-border-width) solid var(--srf-border-strong);
  border-radius: var(--srf-radius-pill);
  background: var(--srf-panel-elevated);
  color: var(--srf-text-muted);
  font-size: var(--srf-font-size-caption);
  line-height: 1;
}
.rc-main { min-width: 0; max-width: 92%; display: grid; gap: var(--srf-spacing-xxs); }
.rc-msg[data-rc-role="user"] .rc-main { margin-left: auto; }
.rc-head { display: flex; align-items: center; gap: var(--srf-spacing-xs); }
.rc-author { font-size: var(--srf-font-size-caption); font-weight: var(--srf-font-weight-semibold); color: var(--srf-text); }
.rc-badge {
  padding: 0 var(--srf-spacing-xs);
  border: var(--srf-border-width) solid var(--srf-warn);
  border-radius: var(--srf-radius-pill);
  color: var(--srf-warn);
  font-size: var(--srf-font-size-caption);
  white-space: nowrap;
}
.rc-bubble {
  padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
  border: var(--srf-border-width) solid var(--srf-border);
  border-radius: var(--srf-radius);
  background: var(--srf-panel);
}
.rc-msg[data-rc-role="user"] .rc-bubble {
  background: var(--srf-panel-elevated);
  border-color: var(--srf-accent);
}
.rc-msg[data-rc-role="agent"] .rc-bubble { border-left: var(--srf-spacing-xxs) solid var(--srf-accent); }
.rc-msg[data-rc-role="system"] .rc-bubble {
  background: transparent;
  border-style: dashed;
  text-align: center;
}
.rc-msg[data-rc-role="system"] .rc-text { color: var(--srf-text-muted); font-size: var(--srf-font-size-caption); }
.rc-msg[data-tone="warn"] .rc-text { color: var(--srf-warn); }
.rc-msg[data-tone="error"] .rc-text { color: var(--srf-danger); }
.rc-text {
  font-size: var(--srf-font-size-content);
  line-height: var(--srf-line-height-content);
  overflow-wrap: anywhere;
}
.rc-text:not(.md-content) { white-space: pre-wrap; }
/* —— 时间戳：默认轻呈现（hover 显形）—— */
.rc-time {
  color: var(--srf-text-disabled);
  font-size: var(--srf-font-size-caption);
  font-family: var(--srf-font-mono);
  opacity: 0;
  transition: opacity var(--srf-motion-hover);
}
.rc-msg:hover .rc-time, .rc-head:hover ~ .rc-time { opacity: 1; }
/* —— 跨分钟分隔条 —— */
.rc-sep {
  display: flex;
  align-items: center;
  gap: var(--srf-spacing-xs);
  margin: var(--srf-spacing-xs) 0;
  color: var(--srf-text-disabled);
  font-size: var(--srf-font-size-caption);
  font-family: var(--srf-font-mono);
}
.rc-sep::before, .rc-sep::after {
  content: "";
  flex: 1;
  height: var(--srf-border-width);
  background: var(--srf-border);
}
.rc-sep-label { flex: none; }
.rc-action {
  margin-top: var(--srf-spacing-xxs);
  padding: var(--srf-spacing-xxs) var(--srf-spacing-xs);
  background: var(--srf-panel-elevated);
  color: var(--srf-accent);
  border: var(--srf-border-width) solid var(--srf-accent);
  border-radius: var(--srf-radius);
  font-family: var(--srf-font-ui);
  font-size: var(--srf-font-size-caption);
  cursor: pointer;
}
.rc-action:hover { background: var(--srf-accent); color: var(--srf-bg); }
/* —— 「回到最新」浮标（局部层 —— 走刻度表，不挑数字）—— */
.rc-jump {
  position: absolute;
  right: var(--srf-spacing-sm);
  bottom: var(--srf-spacing-sm);
  z-index: ${zVar('localTop')};
  padding: var(--srf-spacing-xs) var(--srf-spacing-sm);
  background: var(--srf-panel-elevated);
  color: var(--srf-accent);
  border: var(--srf-border-width) solid var(--srf-accent);
  border-radius: var(--srf-radius-pill);
  font-family: var(--srf-font-ui);
  font-size: var(--srf-font-size-caption);
  cursor: pointer;
  box-shadow: var(--srf-shadow);
}
.rc-jump[hidden] { display: none; }
.rc-jump:hover { background: var(--srf-accent); color: var(--srf-bg); }
`;
