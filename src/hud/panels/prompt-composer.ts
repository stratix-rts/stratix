/**
 * 文件职责：多行提示词 composer（@since v3.9，task_144）—— 命令面板的**输入面**。
 *   把「一行 <input>」升级成「一块能装大段提示词的编辑区」：自动长高、Enter 提交、
 *   Shift+Enter 换行、IME 安全、↑↓ 历史导航、Esc 清空/失焦。
 *
 * why 独立成文件（不并进 command-panel.ts）：
 *   输入面是**一套交互契约**（键位 / 合成态 / 历史 / 高度），不是一行 DOM。
 *   塞进 900 行的面板文件里，键位表与渲染逻辑会互相淹没；独立成模块后
 *   「Enter 到底提交不提交」这类问题可以直接单测（jsdom 里发真事件即可）。
 *
 * 输入：一个 <textarea> 元素 + 回调（提交时把原文交出去）。
 * 输出：受控的编辑区状态（高度 / 历史 / 合成态）+ onSubmit 回调。
 *
 * 禁止事项：
 *   1. import core / world / phaser —— 本文件是纯 DOM 组件，零业务依赖；
 *   2. 在这里**执行**命令 —— 提交只把原文交出去，执行归 command-panel（命令构造在那儿）；
 *   3. 硬编码颜色 / 字体 —— 视觉全在 command-panel 的样式表里（走 --srf-* token）；
 *   4. 泄漏监听器 —— destroy() 必须摘掉全部监听（元素反复挂卸会累积，perf 硬约束）。
 */

/** 历史存储键（localStorage；换键 = 换一份历史，不会读到旧格式）。 */
export const COMPOSER_HISTORY_KEY = 'stratix.command.history.v1';
/** 历史条数上限（会话内持久；超过就丢最旧的）。 */
export const COMPOSER_MAX_HISTORY = 50;
/** 编辑区最大行数（超过就在编辑区内部滚动，不再继续长高）。 */
export const COMPOSER_MAX_ROWS = 10;
/**
 * 合成标记的「陈旧」阈值（ms）：超过这么久还没收到 compositionend，
 *   就认为标记漏收了 —— 以浏览器为准放行（否则输入面会被永久锁死）。
 */
const COMPOSING_STALE_MS = 5000;

export interface PromptComposerOptions {
  /** 提交回调（Enter / ⌘Enter）。收到的是**未 trim 的原文**（trim 由调用方按语义决定）。 */
  readonly onSubmit: (raw: string) => void;
  /** localStorage 键（测试可注入临时键，避免污染真实历史）。 */
  readonly storageKey?: string;
  /** 最大行数（默认 COMPOSER_MAX_ROWS）。 */
  readonly maxRows?: number;
  /** 历史条数上限（默认 COMPOSER_MAX_HISTORY）。 */
  readonly maxHistory?: number;
}

/**
 * 读历史（容错：localStorage 不可用 / 数据被改坏 → 当空历史，不抛）。
 * why 容错：历史是**便利功能**，读不到就不该把整个输入面拖垮。
 */
export function loadComposerHistory(storageKey: string = COMPOSER_HISTORY_KEY): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

/** 写历史（容错同上：写不进去就算了，不能因为存个历史把提交搞崩）。 */
export function saveComposerHistory(
  entries: readonly string[],
  storageKey: string = COMPOSER_HISTORY_KEY
): void {
  try {
    globalThis.localStorage?.setItem(storageKey, JSON.stringify(entries));
  } catch {
    /* 忽略：无痕模式 / 配额满 —— 历史丢了不影响输入面可用 */
  }
}

/**
 * 光标所在行是不是首行 / 末行（按 \n 判逻辑行，不管软换行）。
 * why 需要它：↑↓ 在首/末行时用来翻历史，在中间时必须让光标正常移动（不抢键）。
 */
export function caretAtLineEdges(
  value: string,
  selectionStart: number
): { first: boolean; last: boolean } {
  const pos = Math.max(0, Math.min(selectionStart, value.length));
  return {
    first: !value.slice(0, pos).includes('\n'),
    last: !value.slice(pos).includes('\n'),
  };
}

/**
 * composer 控制器：把一个 <textarea> 变成 prompt composer。
 * 生命周期：new → （挂载）→ destroy（必须调用，否则监听器泄漏）。
 */
export class PromptComposer {
  private readonly el: HTMLTextAreaElement;
  private readonly opts: Required<Omit<PromptComposerOptions, 'onSubmit'>> & {
    onSubmit: (raw: string) => void;
  };
  /** IME 合成中（中文用户命门：合成过程中按 Enter 是「选词」，不是「提交」）。 */
  private composing = false;
  /** 本轮合成是否已收到 compositionend（收到 = 浏览器说合成结束了）。 */
  private compositionEnded = false;
  /** 本轮合成的起始时刻（用于「标记漏收」的防呆放行）。 */
  private composingSince = 0;
  /** 历史导航游标（null = 没在翻历史）。 */
  private historyIndex: number | null = null;
  /** 翻历史前存下的草稿（翻回最新一条之后按 ↓ 要能回到它）。 */
  private draftBeforeHistory = '';
  private history: string[];
  private readonly handlers: Array<[string, EventListener]> = [];

  constructor(el: HTMLTextAreaElement, options: PromptComposerOptions) {
    this.el = el;
    this.opts = {
      onSubmit: options.onSubmit,
      storageKey: options.storageKey ?? COMPOSER_HISTORY_KEY,
      maxRows: options.maxRows ?? COMPOSER_MAX_ROWS,
      maxHistory: options.maxHistory ?? COMPOSER_MAX_HISTORY,
    };
    this.history = loadComposerHistory(this.opts.storageKey);

    this.bind('input', this.onInput);
    this.bind('keydown', this.onKeyDown);
    this.bind('compositionstart', this.onCompositionStart);
    this.bind('compositionend', this.onCompositionEnd);
    this.bind('paste', this.onPaste);
    this.bind('blur', this.onBlur);
    this.autoGrow();
  }

  /** 当前文本。 */
  get value(): string {
    return this.el.value;
  }

  /** 覆写文本（外部回填，如命令执行后清空 / 预填）。会重算高度。 */
  setValue(next: string): void {
    this.el.value = next;
    this.autoGrow();
  }

  /** 清空（提交成功后用）。 */
  clear(): void {
    this.historyIndex = null;
    this.setValue('');
  }

  /** 聚焦（外部调用，例如「回车执行后把焦点还给输入面」）。 */
  focus(): void {
    this.el.focus();
  }

  /**
   * 自动长高：高度跟内容走，到上限（maxRows 行）就停住、内部滚动。
   * why 用 scrollHeight 而不是 rows：rows 只能给整数行，长提示词要么跳行要么被裁。
   * why 先置 height='auto'：textarea 的高度一旦被写死，scrollHeight 就停在旧值上（量不出真实内容）。
   */
  autoGrow(): void {
    const el = this.el;
    const styles = typeof getComputedStyle === 'function' ? getComputedStyle(el) : null;
    const lineHeight = parseFloat(styles?.lineHeight ?? '') || 20;
    const border = (parseFloat(styles?.borderTopWidth ?? '') || 0) + (parseFloat(styles?.borderBottomWidth ?? '') || 0);
    // 内边距也要算进高度：box-sizing:border-box 下，高度 = 内容 + 内边距 + 边框，
    // 少算内边距 → 文字被裁掉半行（实测：占位文字压在回放条上）。
    const padding =
      (parseFloat(styles?.paddingTop ?? '') || 0) + (parseFloat(styles?.paddingBottom ?? '') || 0);
    const maxHeight = lineHeight * this.opts.maxRows + padding + border;
    el.style.height = 'auto';
    // jsdom 不做布局 → scrollHeight 恒为 0；退回「按 \n 数行」的估算，测试与真实环境都拿得到合理高度。
    const logicalLines = el.value.split('\n').length;
    const estimated = lineHeight * logicalLines + padding + border;
    const content = Math.max(el.scrollHeight, estimated);
    const next = Math.min(content, maxHeight);
    el.style.height = `${next}px`;
    el.style.overflowY = content > maxHeight ? 'auto' : 'hidden';
    // 多行 = 「展开态」（紧凑形态据此把编辑区浮成面板；单行时贴底栏不突兀）。
    el.dataset.expanded = content > lineHeight + padding + border ? 'true' : 'false';
    el.dataset.rows = String(Math.max(1, Math.ceil((content - padding - border) / lineHeight)));
  }

  /** 提交（Enter / ⌘Enter 走这里）：记历史 → 交出去。 */
  private submit(): void {
    const raw = this.el.value;
    this.pushHistory(raw);
    this.opts.onSubmit(raw);
  }

  /** 记一条历史（连续重复不记；超出上限丢最旧的）。 */
  private pushHistory(raw: string): void {
    const entry = raw.trim();
    if (entry.length === 0) return;
    if (this.history[0] === entry) return;
    this.history = [entry, ...this.history.filter((x) => x !== entry)].slice(0, this.opts.maxHistory);
    saveComposerHistory(this.history, this.opts.storageKey);
    this.historyIndex = null;
  }

  /**
   * ↑ / ↓ 历史导航。
   * @param direction -1 = 更旧（↑），+1 = 更新（↓）。
   * @returns true = 本次被 composer 接管（调用方要 preventDefault）；false = 不抢键。
   */
  navigateHistory(direction: -1 | 1): boolean {
    if (this.history.length === 0) return false;
    const value = this.el.value;
    const edges = caretAtLineEdges(value, this.el.selectionStart ?? value.length);

    // 光标在中间行：↑↓ 归光标（不抢键）—— 用户正在编辑中间的文本，别把人拽走。
    if (direction === -1 && !edges.first) return false;
    if (direction === 1 && !edges.last) return false;

    if (this.historyIndex === null) {
      if (direction === 1) return false; // 没在翻历史时，↓ 不动（否则会吞掉光标下移）
      this.draftBeforeHistory = value;
      this.historyIndex = 0;
    } else {
      // 历史是「新 → 旧」排的：↑（direction=-1）往旧走（index+1），↓（direction=1）往新走（index-1）。
      const next = this.historyIndex - direction;
      if (next < 0) {
        // 越过最新一条 → 回到翻历史前的草稿。
        this.historyIndex = null;
        this.setValue(this.draftBeforeHistory);
        this.el.setSelectionRange(this.el.value.length, this.el.value.length);
        return true;
      }
      if (next >= this.history.length) return false; // 到底了：交还光标
      this.historyIndex = next;
    }
    const entry = this.history[this.historyIndex] ?? '';
    this.setValue(entry);
    this.el.setSelectionRange(entry.length, entry.length);
    return true;
  }

  // —— 事件处理 ——
  private bind<K extends keyof HTMLElementEventMap>(
    type: K,
    handler: (ev: HTMLElementEventMap[K]) => void
  ): void {
    this.el.addEventListener(type, handler as EventListener);
    this.handlers.push([type, handler as EventListener]);
  }

  private readonly onInput = (): void => {
    this.autoGrow();
  };

  /** 粘贴：交给浏览器默认行为（多行长文本一个字符都不丢），粘贴后重算高度。 */
  private readonly onPaste = (): void => {
    // 默认粘贴会先派 input 事件 → onInput 已经重算过一次；这里再兜一次底
    // （某些浏览器粘贴后 input 事件延后到下一帧）。
    setTimeout(() => this.autoGrow(), 0);
  };

  private readonly onCompositionStart = (): void => {
    this.composing = true;
    this.compositionEnded = false;
    this.composingSince = Date.now();
  };

  /**
   * 合成结束：记下「已结束」，并在**微任务**里解除合成态。
   * why 微任务而不是 setTimeout(0)：定时器会被浏览器往后排（实测 CDP 派发的按键
   *   能抢在定时器前面到），合成态迟迟不解除 → 后面每一次回车都被当成「选词」，
   *   输入面等于废掉。微任务在当前任务的末尾就跑掉，够挡住「同一拍里补发的 Enter」。
   * why 还要记 compositionEnded：防「合成结束事件漏收」把输入面永久锁死
   *   （浏览器说没在合成，就以浏览器为准）。
   */
  private readonly onCompositionEnd = (): void => {
    this.compositionEnded = true;
    queueMicrotask(() => {
      this.composing = false;
    });
  };

  private readonly onKeyDown = (ev: KeyboardEvent): void => {
    // ↑↓ 历史导航：只在光标位于首/末行时接管。
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
      if (this.navigateHistory(ev.key === 'ArrowUp' ? -1 : 1)) {
        ev.preventDefault();
        ev.stopPropagation();
      }
      return;
    }

    if (ev.key === 'Escape') {
      // Esc：有字 → 清空草稿（第一下别急着把焦点也丢了）；没字 → 失焦。
      if (this.el.value.length > 0) {
        ev.preventDefault();
        ev.stopPropagation();
        this.clear();
      } else {
        this.el.blur();
      }
      return;
    }

    if (ev.key !== 'Enter') return;

    // IME 合成中：Enter 是「选词」，不是「提交」（中文用户命门）。
    // 判据三层，从硬到软：
    //   ① 浏览器自己说在合成（isComposing / keyCode 229）—— 最可信，直接挡；
    //   ② 我们的合成标记还在、且没收到 compositionend —— 挡（个别浏览器不报 isComposing）；
    //   ③ 标记"老"到不可能还在合成 —— 以浏览器为准，放行（防呆：标记漏收会锁死输入面）。
    const meta = ev.metaKey || ev.ctrlKey;
    if (!meta) {
      if (ev.isComposing === true || ev.keyCode === 229) return;
      if (this.composing && !this.compositionEnded) {
        const stale = Date.now() - this.composingSince > COMPOSING_STALE_MS;
        if (!stale) return;
        this.composing = false;
      }
    }
    // Shift+Enter = 换行（不提交）；⌘Enter / Ctrl+Enter = 永远提交。
    if (ev.shiftKey && !meta) return;

    ev.preventDefault();
    ev.stopPropagation();
    this.submit();
  };

  /** 失焦：展开态（多行）收回去，编辑区回到 1 行，但**内容留着**（草稿不丢）。 */
  private readonly onBlur = (): void => {
    if (this.el.dataset.expanded !== 'true') return;
    const styles = typeof getComputedStyle === 'function' ? getComputedStyle(this.el) : null;
    const lineHeight = parseFloat(styles?.lineHeight ?? '') || 20;
    const border =
      (parseFloat(styles?.borderTopWidth ?? '') || 0) + (parseFloat(styles?.borderBottomWidth ?? '') || 0);
    const padding =
      (parseFloat(styles?.paddingTop ?? '') || 0) + (parseFloat(styles?.paddingBottom ?? '') || 0);
    this.el.style.height = `${lineHeight + padding + border}px`;
    this.el.style.overflowY = 'hidden';
    this.el.dataset.expanded = 'false';
    this.el.dataset.rows = '1';
  };

  /** 摘掉全部监听（元素卸载时必须调 —— 否则反复挂卸会累积监听器）。 */
  destroy(): void {
    for (const [type, handler] of this.handlers) {
      this.el.removeEventListener(type, handler);
    }
    this.handlers.length = 0;
  }
}
