/**
 * 文件职责：**演示模式（demo-mode）骨架** —— 顶栏「演示」开关的状态源 + localStorage 记忆 +
 *   两件副作用（其余面板内容由后续任务接线）：
 *   ① 字号放大 +30%：把 HUD 的字号 token 按倍率放大后覆盖注入（换皮肤后需 refreshTypography）；
 *   ② 工程面板过滤：标记了 `data-engineering` 的节点在演示模式下隐藏（json 视图 / 原始 id /
 *      时间戳列 / 日志 tab 的统一机制）。
 *   来源：docs/DEMO-PLAN.md §8（演示模式）+ §1（字号口径）。
 * 输入：localStorage（记忆）+ document（DOM 副作用）；参数取自唯一事实源 core/theme/visual-spec.ts。
 * 输出：`demoMode` 单例 —— enabled / subscribe / set / toggle / refreshTypography / filterEngineering。
 * 禁止事项：
 *   1. import world / phaser —— 铁律：hud 只认识 core；
 *   2. 发 HudCommand / 改 core 契约 —— 演示模式是**纯本地展示态**，不进总线（core/types.ts 不动）；
 *   3. 在本文件里写死倍率 / 键名 —— 一律取自唯一事实源（DEMO_MODE.fontScale / storageKey）；
 *   4. 直接点名具体面板 —— 本文件只提供机制；「哪些是工程件」由各面板自己标 `data-engineering`；
 *   5. 在模块顶层碰 DOM / localStorage —— 全部延迟到方法调用时（node 环境导入本模块不炸）。
 *
 * 字号放大的实现口径（为什么不是 calc）：
 *   字号 token（--srf-font-size-*）被 canvas 消费者直接读成 px 字符串用
 *   （见 components/growth-chart.ts），写成 `calc(11px * 1.3)` 会让 canvas 拿到非法 font 串。
 *   故这里把**放大后的绝对 px** 写进覆盖样式表：读 token 的地方（CSS 与 canvas）都拿到合法值。
 */

import { DEMO_MODE } from '../../core/theme/visual-spec';

/** 覆盖样式表的稳定 id。 */
export const DEMO_MODE_STYLE_ID = 'srf-demo-mode';

/** 打在 `<html>` 上的标记属性（值 'on'）—— CSS 侧可用 `:root[data-demo-mode="on"]` 兜底选择。 */
export const DEMO_MODE_ATTRIBUTE = 'data-demo-mode';

/** 受放大的字号 token（与皮肤 token 文件里的键一一对应）。 */
export const DEMO_FONT_SIZE_TOKENS: readonly string[] = [
  '--srf-font-size-xs',
  '--srf-font-size-sm',
  '--srf-font-size-md',
  '--srf-font-size-lg',
];

/** localStorage 的最小面（便于单测注入内存实现）。 */
export interface DemoModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 依赖注入：默认走浏览器的 localStorage / document（延迟解析，node 环境安全）。 */
export interface DemoModeDeps {
  /** 取 localStorage；返回 null = 无记忆能力（隐私模式等），此时只做本次会话内的开关。 */
  readonly storage?: () => DemoModeStorage | null;
  /** 取 document；返回 null = 无 DOM（纯逻辑环境），此时只保留状态，不做副作用。 */
  readonly document?: () => Document | null;
}

/** 演示模式控制器。 */
export interface DemoModeController {
  /** 当前是否开启（首次读取时从 localStorage 恢复）。 */
  readonly enabled: boolean;
  /** 订阅开关变化；返回退订函数。 */
  subscribe(listener: (enabled: boolean) => void): () => void;
  /** 设置开关（并写入 localStorage 记忆 + 应用副作用）。 */
  set(enabled: boolean): void;
  /** 翻转开关；返回翻转后的状态。 */
  toggle(): boolean;
  /** 重新计算字号覆盖（换皮肤后调用 —— 各皮肤的基准字号不同）。 */
  refreshTypography(): void;
  /** 工程件过滤：把 `data-engineering` 标记的节点按当前开关隐藏 / 恢复。 */
  filterEngineering(root: ParentNode): void;
}

/** 默认的 localStorage 取法（浏览器全局；不存在时返回 null）。 */
function defaultStorage(): DemoModeStorage | null {
  try {
    const store = (globalThis as { localStorage?: DemoModeStorage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/** 默认的 document 取法（浏览器全局；不存在时返回 null）。 */
function defaultDocument(): Document | null {
  const doc = (globalThis as { document?: Document }).document;
  return doc ?? null;
}

/**
 * 读当前生效皮肤的**基准字号**（px）。
 * 优先读皮肤样式表源码（theme-controller 注入的 `<style id="srf-theme-*">`）——
 *   它是「当前皮肤声明了什么」的最直接真相；读不到再退回 computed style。
 * 读不到返回 null = 本次不放大（宁可不放大，也不写一个来路不明的字号）。
 */
export function readBaseFontSizes(doc: Document): Record<string, number> | null {
  const sizes: Record<string, number> = {};
  const sheets = Array.from(doc.querySelectorAll('style[id^="srf-theme-"]'));
  const active = sheets.find((node) => !(node as HTMLStyleElement).disabled);
  const css = active?.textContent ?? '';
  const re = /(--srf-font-size-[a-z]+)\s*:\s*([0-9.]+)px/g;
  let match = re.exec(css);
  while (match !== null) {
    sizes[match[1]] = Number.parseFloat(match[2]);
    match = re.exec(css);
  }
  if (Object.keys(sizes).length === DEMO_FONT_SIZE_TOKENS.length) return sizes;

  // 退回 computed style（样式表由别的途径注入时）。
  const computed = doc.defaultView?.getComputedStyle(doc.documentElement);
  if (!computed) return null;
  for (const token of DEMO_FONT_SIZE_TOKENS) {
    const raw = computed.getPropertyValue(token).trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value)) return null;
    sizes[token] = value;
  }
  return sizes;
}

/**
 * 生成字号覆盖 CSS（把基准字号乘以倍率）。
 * 纯函数 —— 单测直接断言文本。
 */
export function buildDemoTypographyCss(baseSizes: Record<string, number>, scale: number): string {
  const lines = DEMO_FONT_SIZE_TOKENS.map((token) => {
    const base = baseSizes[token];
    if (!Number.isFinite(base)) return `  ${token}: ${baseSizes[token]};`;
    const scaled = Math.round(base * scale * 100) / 100;
    return `  ${token}: ${scaled}px;`;
  });
  return `:root[${DEMO_MODE_ATTRIBUTE}="on"] {\n${lines.join('\n')}\n}\n`;
}

/**
 * 工厂：构造演示模式控制器。
 * 默认行为：首次访问 `enabled` 时从 localStorage 恢复（值 'on' = 开）。
 */
export function createDemoModeController(deps: DemoModeDeps = {}): DemoModeController {
  const resolveStorage = deps.storage ?? defaultStorage;
  const resolveDocument = deps.document ?? defaultDocument;

  const listeners = new Set<(enabled: boolean) => void>();
  let enabled = false;
  let initialized = false;

  const persist = (value: boolean): void => {
    const store = resolveStorage();
    if (!store) return;
    try {
      store.setItem(DEMO_MODE.storageKey, value ? 'on' : 'off');
    } catch {
      // localStorage 不可写（隐私模式 / 配额满）：开关仍然生效，只是不记忆 —— 不因此报错。
    }
  };

  /** 覆盖样式表（幂等：同 id 重建）。 */
  const installTypography = (doc: Document): void => {
    const base = readBaseFontSizes(doc);
    const existing = doc.getElementById(DEMO_MODE_STYLE_ID);
    if (!base) {
      existing?.remove();
      return;
    }
    const style = doc.createElement('style');
    style.id = DEMO_MODE_STYLE_ID;
    style.setAttribute('data-srf-demo-mode', 'true');
    style.textContent = buildDemoTypographyCss(base, DEMO_MODE.fontScale);
    existing?.remove();
    doc.head.appendChild(style);
  };

  /** DOM 副作用：开 = 打标记 + 注入字号覆盖；关 = 撤标记 + 撤覆盖。 */
  const applyDom = (): void => {
    const doc = resolveDocument();
    if (!doc) return;
    const root = doc.documentElement;
    if (enabled) {
      root.setAttribute(DEMO_MODE_ATTRIBUTE, 'on');
      installTypography(doc);
    } else {
      root.removeAttribute(DEMO_MODE_ATTRIBUTE);
      doc.getElementById(DEMO_MODE_STYLE_ID)?.remove();
    }
  };

  /** 首次访问时恢复记忆状态（并把状态落到 DOM）。 */
  const ensureInitialized = (): void => {
    if (initialized) return;
    initialized = true;
    const store = resolveStorage();
    try {
      enabled = store?.getItem(DEMO_MODE.storageKey) === 'on';
    } catch {
      enabled = false;
    }
    applyDom();
  };

  const notify = (): void => {
    // 快照后再回调：订阅者可能在回调里退订 + 重新订阅（如主屏重渲），
    // 直接遍历 Set 会把新加进来的订阅者在本轮也调一遍（多一次无谓重渲）。
    for (const listener of Array.from(listeners)) listener(enabled);
  };

  const set = (next: boolean): void => {
    ensureInitialized();
    if (enabled === next) return;
    enabled = next;
    persist(enabled);
    applyDom();
    notify();
  };

  const filterEngineering = (root: ParentNode): void => {
    const nodes = root.querySelectorAll('[data-engineering]');
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      if (enabled) {
        el.setAttribute('hidden', '');
        el.style.display = 'none';
      } else {
        el.removeAttribute('hidden');
        el.style.display = '';
      }
    });
  };

  return {
    get enabled(): boolean {
      ensureInitialized();
      return enabled;
    },
    subscribe(listener: (enabled: boolean) => void): () => void {
      ensureInitialized();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set,
    toggle(): boolean {
      set(!this.enabled);
      return this.enabled;
    },
    refreshTypography(): void {
      ensureInitialized();
      if (!enabled) return;
      const doc = resolveDocument();
      if (!doc) return;
      installTypography(doc);
    },
    filterEngineering,
  };
}

/**
 * 进程内共享的演示模式控制器（顶栏开关与各面板共用同一个实例）。
 * why 单例：开关状态是**跨面板**的展示态，做成多份必然对不上（面板以为开着、顶栏以为关着）。
 */
export const demoMode: DemoModeController = createDemoModeController();

/**
 * 工程件是否应当显示（演示模式下工程件一律隐藏）。
 * 组件用它决定「这一块要不要渲染」—— 组件自己判断，不靠 CSS 事后隐藏。
 */
export function engineeringVisible(): boolean {
  return !demoMode.enabled;
}
