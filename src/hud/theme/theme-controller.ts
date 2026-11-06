/**
 * 文件职责：HUD 皮肤切换的总线响应器 —— 响应 HudCommand `theme.set`，本地加载 / 启停 token 样式表，
 *   并把「当前皮肤」这一状态**记忆**下来（localStorage）+ 广播给订阅者（顶栏菜单项 / 设置屏高亮）。
 *   来源：docs/REFACTOR_PLAN_V3.md §3「HUD 主题与像素风」(整体切换、组件零改动)；
 *   @since v3.6（task_115）接通「切皮肤 → 视觉真变 + 刷新保持」。
 * 输入：宿主 document（HUD 挂载时传入）；通过 `apply()` 接收 HudCommand 中的 `theme.set`；
 *   可选的 `storage`（localStorage 记忆口，缺省 = 不记忆，保持纯逻辑可测）。
 * 输出：document.head 上挂的禁用 / 启用样式表（每套皮肤一张），控制 HUD 视觉整套切换；
 *   `current`（当前皮肤，唯一真相）+ `subscribe()`（皮肤变化通知）。
 * 禁止事项：
 *   1. 直接接收 `--srf-*` 之外的样式 —— 本文件不负责任何组件级样式；
 *   2. 走任何框架（Vue / React / Pinia）—— 纯原生 DOM 接口；
 *   3. 副作用溢出 document.body —— 允许写入 document.head，不准动 body 内容；
 *   4. 同一皮肤重复加载——内部用 id 跟踪已注入 stylesheet，避免内存泄漏；
 *   5. 在本文件内部静态 import *.css——避免 bundler / jest transform 耦合，
 *      CSS 源应由调用方（dev-entry / 测试）通过 `sources` 注入。
 *
 * 设计要点：
 *   - 切换 = 切换 stylesheet 的 `disabled` 属性；不卸载 / 不重建 DOM，re-paint 极快；
 *   - 各套 token 文件均以 raw 字符串内联进 `<style>` 标签，避免静态资源路径与打包配置耦合；
 *   - 单元测试可通过 `StyleInjector` 桩把任意 CSS 注入，受测代码无 document 依赖；
 *   - 不内联 CSS 字面量，方便单测和未来按需延迟加载更多皮肤；
 *   - **本控制器 = 皮肤的唯一真相**（task_115）：谁想知道「当前皮肤」问 `current`，
 *     想知道「皮肤变了」订阅 `subscribe` —— HUD 各处不再各存一份 currentTheme（那会走样）。
 *
 * ★ 持久化口径（task_115）：
 *   皮肤是**每客户端本地**的展示偏好（token 样式表就在本机 DOM 上），故记忆落在 localStorage
 *   而非 WorldState（见 core/types.ts 的「用户偏好」段 —— 进状态机 = 第二个真相源）。
 *   键名冻结在 core（core/theme/skin-registry.ts 的 SKIN_STORAGE_KEY），本文件只管读写，
 *   不自己写键名字面量（同 DEMO_MODE.storageKey 的纪律）。
 */

import { SKIN_STORAGE_KEY } from '../../core/theme/skin-registry';

import { syncIconsForSkin } from './skin-icons';
// 排版字阶（@since v3.8，task_137）：字阶随皮肤走 —— 像素皮用 +1px 的那套（像素网格对齐）。
import { typeScaleCssFor } from './type-scale';

/**
 * core 的 `theme.set` 命令载荷里认的皮肤 id（窄口径，见 core/types.ts）。
 * 皮肤库本身的完整词表见 skin-registry.ts 的 SkinId —— 本控制器按泛型放开，任意 id 都能切。
 */
export type ThemeId = 'default' | 'pixel';

/** 不同皮肤 stylesheet 的稳定 id，便于 `document.getElementById` 找回与避免重复挂载。 */
export const STYLE_ID_PREFIX = 'srf-theme-';

/** 测试用注入桩。允许测试代码传入伪 `style` 注入函数，把 document 副作用隔离掉。 */
export type StyleInjector = (id: string, css: string) => HTMLStyleElement;

/**
 * localStorage 的最小面（便于单测注入内存实现）。
 * why 不用完整 Storage 接口：只用到两个方法，最小面让测试桩不必实现全套 API。
 */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 默认记忆口：浏览器 localStorage。
 * 取不到（node / 隐私模式 / 沙箱）→ 返回 null = 本次不记忆（**不报错**：切皮肤照常可用）。
 */
export function defaultThemeStorage(): ThemeStorage | null {
  try {
    const store = (globalThis as { localStorage?: ThemeStorage }).localStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

/** 默认注入器：document 上挂 `<style>`；同 id 重复注入会被覆盖（避免泄漏）。 */
export const defaultStyleInjector: StyleInjector = (id, css) => {
  // 幂等：先清掉旧的同 id 标签，避免切换 / 重复挂载产生重复样式或意外覆盖。
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const style = document.createElement('style');
  style.id = id;
  style.appendChild(document.createTextNode(css));
  style.setAttribute('data-srf-theme', id.slice(STYLE_ID_PREFIX.length));
  document.head.appendChild(style);
  return style;
};

/**
 * 主题控制器：负责把所有 token 样式表挂到 document、决定当前激活哪一个。
 * 暴露 `apply(themeId)`，与 HudCommand.theme.set 一一对应。
 *
 * @since task_024：id 词表改为泛型 —— 控制器不再只认 default/pixel，新增皮肤不必改本文件
 *   （皮肤词表见 skin-registry.ts）。
 */
export interface ThemeController<Id extends string = string> {
  /** 切换 token 集合；同一 id 重复切换是 no-op。 */
  apply(themeId: Id): void;
  /** 当前激活皮肤。未知 = 还没切过（首次 apply 之前）。 */
  readonly current: Id | null;
  /**
   * 订阅皮肤变化（@since task_115）：皮肤真变时才回调（重复 apply 同一 id 不回调）。
   * 返回退订函数。why 需要：顶栏菜单项文案 / 设置屏高亮都靠它跟上皮肤 ——
   *   这些地方**不再各存一份 currentTheme**（各存一份迟早走样）。
   */
  subscribe(listener: (themeId: Id) => void): () => void;
}

export interface CreateThemeControllerOptions<Id extends string = string> {
  /**
   * 皮肤 id → CSS 字符串；由调用方提供，工厂不内联默认 CSS，方便单测。
   * 键类型取 string（不取 Id）：调用方（app / dev-entry）各自声明自己的 id 词表，
   * 这里再绑一次 Id 会让「只声明部分皮肤的调用方」被多余属性检查卡住。
   * id 词表的完整性由调用方自己的 Record<SkinId, string> 保证。
   */
  sources: Readonly<Record<string, string>>;
  /** 注入器；默认走 document.head。 */
  inject?: StyleInjector;
  /** 初始皮肤；可选，默认不预激活任何一套（首次 apply 才生效）。 */
  initial?: Id;
  /**
   * 记忆口（@since task_115）：给了就**记住皮肤**（切皮肤时写入、构造时读回）。
   * 缺省 = 不记忆（纯逻辑调用方 / 单测不受 localStorage 影响）。
   */
  storage?: ThemeStorage | null;
  /**
   * 记忆键名；缺省用 core 冻结的 SKIN_STORAGE_KEY（core/theme/skin-registry.ts）。
   * why 不在本文件写死字面量：键名是契约级事实（见 core 侧注）。
   */
  storageKey?: string;
}

/**
 * 工厂：构造一个主题控制器。
 * 注意：默认行为会**一次性把所有 token 都注入到 DOM**，并把非初始的样式表 `disabled`。
 * 这样首次切换不需要再装载，零额外等待。
 *
 * @since task_115：给了 `storage` 时，构造阶段先读回记忆的皮肤（记忆优先于 `initial`），
 *   `apply()` 时把新皮肤写进记忆 —— 刷新后仍是上次那套皮肤。
 */
export function createThemeController<Id extends string = string>(
  options: CreateThemeControllerOptions<Id>,
): ThemeController<Id> {
  const inject = options.inject ?? defaultStyleInjector;
  const styles = new Map<Id, HTMLStyleElement>();
  const listeners = new Set<(themeId: Id) => void>();
  const storage = options.storage ?? null;
  const storageKey = options.storageKey ?? SKIN_STORAGE_KEY;
  let current: Id | null = null;

  // 记忆优先于 initial：用户上次选的就是ta要的（初始皮肤只是「没记忆过时的兜底」）。
  // 合法性按「sources 里有没有这张皮」判（sources 此时还没灌进 styles，先查 sources）。
  const remembered = readRememberedId(storage, storageKey);
  const rememberedValid =
    remembered !== null && Object.prototype.hasOwnProperty.call(options.sources, remembered);
  const effectiveInitial = rememberedValid ? (remembered as Id) : options.initial;

  for (const id of Object.keys(options.sources) as Id[]) {
    // 字阶层随皮肤一起注入（@since v3.8，task_137）：皮肤表管颜色 / 形状，字阶管排版 ——
    //   两者拼成同一张 <style>，切皮即整张换（切走像素 = 连像素字阶一起消失）。
    const css = `${options.sources[id]}\n${typeScaleCssFor(id)}`;
    const node = inject(STYLE_ID_PREFIX + id, css);
    if (effectiveInitial !== id) node.disabled = true;
    styles.set(id, node);
  }
  if (effectiveInitial) current = effectiveInitial;
  // 图标集随皮肤一起到位（@since v3.8，task_135）：像素皮 = 真像素图形图标，
  // 其余皮 = 现代线条图标。必须在 HUD 挂载**之前**定好 —— HUD 首次渲染就用当前图标集画图标。
  if (effectiveInitial) syncIconsForSkin(effectiveInitial);

  const persist = (themeId: Id): void => {
    if (!storage) return;
    try {
      storage.setItem(storageKey, themeId);
    } catch {
      // localStorage 不可写（隐私模式 / 配额满）：皮肤仍然生效，只是不记忆 —— 不因此报错。
    }
  };

  const apply = (themeId: Id): void => {
    if (current === themeId) return;
    // 未知 id 直接报错：若放过，会把所有样式表 disable 掉，HUD 瞬间掉光 token（比报错更难查）。
    if (!styles.has(themeId)) throw new Error(`[theme-controller] unknown theme id: ${themeId}`);
    for (const [id, node] of styles) node.disabled = id !== themeId;
    current = themeId;
    persist(themeId);
    // 图标集跟着皮肤换（@since v3.8，task_135）：切皮 = 换图标集 + 就地刷新已画好的图标
    //（不重建 DOM → 布局骨架零变化）。
    syncIconsForSkin(themeId);
    // 快照后再回调：订阅者可能在回调里退订 / 重新订阅，直接遍历 Set 会多调一轮。
    for (const listener of Array.from(listeners)) listener(themeId);
  };

  return {
    apply,
    get current() { return current; },
    subscribe(listener: (themeId: Id) => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

/**
 * 读回记忆的皮肤 id；读不到 / 值非法 → null（= 按 initial 走）。
 * why 非法值当「没记过」：宁可退回默认皮肤，也不要切到不存在的皮肤（切了会掉光 token）。
 */
function readRememberedId(storage: ThemeStorage | null, key: string): string | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}
